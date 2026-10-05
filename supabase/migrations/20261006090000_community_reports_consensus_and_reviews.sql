-- Magaalo mobile: crowd reports, learned consensus alerts, and navigation reviews.
create extension if not exists pg_cron;

-- Per-user trust learned from how often a reporter agrees with the eventual consensus.
-- Trust is the mean of a Beta(agreed + 2, disagreed + 2) posterior, so new users start at 0.5.
create table public.reporter_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  agreed integer not null default 0 check (agreed >= 0),
  disagreed integer not null default 0 check (disagreed >= 0),
  updated_at timestamptz not null default now()
);
alter table public.reporter_reputation enable row level security;
grant select on public.reporter_reputation to authenticated;
create policy reputation_read_own on public.reporter_reputation for select to authenticated using (user_id = (select auth.uid()));

-- stance = true means the condition is present (road closed, building exists, flooded...),
-- stance = false means a user saw it is NOT present (road open again, building gone).
create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic text not null check (topic in ('road_closure','traffic','flooding','hazard','building')),
  stance boolean not null default true,
  longitude double precision not null check (longitude between 45.12 and 45.49),
  latitude double precision not null check (latitude between 1.93 and 2.23),
  note text not null default '' check (length(note) <= 500),
  source text not null default 'manual' check (source in ('manual','navigation','review')),
  scored boolean not null default false,
  created_at timestamptz not null default now()
);
create index community_reports_topic_created on public.community_reports(topic, created_at desc);
create index community_reports_user_created on public.community_reports(user_id, created_at desc);
alter table public.community_reports enable row level security;
grant select, delete on public.community_reports to authenticated;
grant insert (user_id, topic, stance, longitude, latitude, note, source) on public.community_reports to authenticated;
create policy reports_read_own on public.community_reports for select to authenticated using (user_id = (select auth.uid()));
create policy reports_insert_own on public.community_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy reports_delete_own on public.community_reports for delete to authenticated using (user_id = (select auth.uid()));

-- Public, model-generated alerts. Rebuilt by refresh_map_alerts().
create table public.map_alerts (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  stance boolean not null,
  status text not null check (status in ('suspected','confirmed')),
  probability real not null,
  longitude double precision not null,
  latitude double precision not null,
  radius_m real not null,
  supporters integer not null,
  deniers integer not null,
  first_reported_at timestamptz not null,
  last_reported_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.map_alerts enable row level security;
grant select on public.map_alerts to anon, authenticated;
create policy alerts_public_read on public.map_alerts for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.map_alerts;

-- Rate limiting and duplicate protection.
create function public.community_reports_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.community_reports
      where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many reports in the last hour. Please try again later.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.community_reports r
      where r.user_id = new.user_id and r.topic = new.topic and r.stance = new.stance
        and r.created_at > now() - interval '15 minutes'
        and extensions.st_dwithin(
          extensions.st_makepoint(r.longitude, r.latitude)::extensions.geography,
          extensions.st_makepoint(new.longitude, new.latitude)::extensions.geography, 40)) then
    raise exception 'You already reported this here a few minutes ago.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger community_reports_guard before insert on public.community_reports
  for each row execute function public.community_reports_guard();

-- Consensus model:
--  1. Cluster recent reports per topic with DBSCAN (metres, UTM 38N).
--  2. Keep each user's latest vote per cluster.
--  3. Weight each vote by learned trust x exponential time decay (topic half-life).
--  4. p(present) = sigmoid(-2 + 1.6 * sum(+/- weight)); p(absent) is the mirror.
--  5. Publish alerts with p >= 0.3; "confirmed" requires p >= 0.6 and >= 2 distinct users.
--  6. When a cluster is decisive (p >= 0.8, >= 3 voters), score each unscored report
--     against the outcome and update the reporter's Beta posterior (online learning).
create function public.refresh_map_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare published integer;
begin
  perform pg_advisory_xact_lock(724001);

  create temp table _votes on commit drop as
  with cfg(topic, half_life, window_h, eps) as (values
    ('road_closure', 12.0, 72.0, 45.0),
    ('traffic',       1.0,  3.0, 80.0),
    ('flooding',     12.0, 72.0, 60.0),
    ('hazard',       12.0, 72.0, 40.0),
    ('building',   2160.0, 8760.0, 25.0)),
  recent as (
    select r.*, c.half_life, c.eps
    from public.community_reports r join cfg c on c.topic = r.topic
    where r.created_at > now() - c.window_h * interval '1 hour'
  ),
  clustered as (
    select r.*, extensions.st_clusterdbscan(
      extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(r.longitude, r.latitude), 4326), 32638),
      eps := r.eps::double precision, minpoints := 1) over (partition by r.topic) as cid
    from recent r
  ),
  latest as (
    select distinct on (topic, cid, user_id) * from clustered
    order by topic, cid, user_id, created_at desc
  )
  select l.id, l.user_id, l.topic, l.cid, l.stance, l.longitude, l.latitude, l.created_at, l.scored, l.eps,
    (coalesce(rep.agreed, 0) + 2.0) / (coalesce(rep.agreed, 0) + coalesce(rep.disagreed, 0) + 4.0)
      * exp(-ln(2.0) * extract(epoch from now() - l.created_at) / 3600.0 / l.half_life) as weight
  from latest l left join public.reporter_reputation rep on rep.user_id = l.user_id;

  create temp table _clusters on commit drop as
  select topic, cid,
    avg(longitude) as lon, avg(latitude) as lat, max(eps) as eps,
    1 / (1 + exp(-(-2.0 + 1.6 * sum(case when stance then weight else -weight end)))) as p_present,
    1 / (1 + exp(-(-2.0 - 1.6 * sum(case when stance then weight else -weight end)))) as p_absent,
    count(*) filter (where stance) as supporters,
    count(*) filter (where not stance) as deniers,
    min(created_at) as first_at, max(created_at) as last_at
  from _votes group by topic, cid;

  delete from public.map_alerts where true;
  insert into public.map_alerts (topic, stance, status, probability, longitude, latitude, radius_m,
    supporters, deniers, first_reported_at, last_reported_at)
  select c.topic, side.stance,
    case when side.p >= 0.6 and side.n >= 2 then 'confirmed' else 'suspected' end,
    side.p, c.lon, c.lat, c.eps, c.supporters, c.deniers, c.first_at, c.last_at
  from _clusters c
  cross join lateral (
    select true as stance, c.p_present as p, c.supporters as n
    union all
    -- Only buildings publish the "absent" side (building no longer exists).
    select false, c.p_absent, c.deniers where c.topic = 'building'
  ) side
  where side.p >= 0.3 and side.n >= 1;
  get diagnostics published = row_count;

  with decisive as (
    select topic, cid, p_present >= 0.8 as outcome from _clusters
    where (p_present >= 0.8 or p_absent >= 0.8) and supporters + deniers >= 3
  ), scored as (
    select v.id, v.user_id, v.stance = d.outcome as agreed
    from _votes v join decisive d using (topic, cid) where not v.scored
  ), bump as (
    insert into public.reporter_reputation as rep (user_id, agreed, disagreed)
    select user_id, count(*) filter (where agreed), count(*) filter (where not agreed) from scored group by user_id
    on conflict (user_id) do update set agreed = rep.agreed + excluded.agreed,
      disagreed = rep.disagreed + excluded.disagreed, updated_at = now()
    returning 1
  )
  update public.community_reports r set scored = true from scored s where r.id = s.id;

  return published;
end;
$$;
revoke all on function public.refresh_map_alerts() from public, anon, authenticated;

create function public.community_reports_refresh() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_map_alerts();
  return null;
end;
$$;
create trigger community_reports_refresh after insert or delete on public.community_reports
  for each statement execute function public.community_reports_refresh();

-- Decay alerts over time even when no new reports arrive.
select cron.schedule('magaalo-refresh-map-alerts', '*/10 * * * *', 'select public.refresh_map_alerts()');

-- Reviews left after a navigation session.
create table public.navigation_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  route_accuracy smallint check (route_accuracy between 1 and 5),
  mode text not null check (mode in ('driving','walking','cycling')),
  destination_name text not null default '' check (length(destination_name) <= 140),
  destination_longitude double precision not null check (destination_longitude between 45.12 and 45.49),
  destination_latitude double precision not null check (destination_latitude between 1.93 and 2.23),
  distance_m real check (distance_m >= 0),
  duration_s real check (duration_s >= 0),
  issues text[] not null default '{}' check (issues <@ array['road_closed','wrong_turn','place_missing','traffic','bad_road','unsafe']::text[]),
  comment text not null default '' check (length(comment) <= 1000),
  created_at timestamptz not null default now()
);
create index navigation_reviews_user_created on public.navigation_reviews(user_id, created_at desc);
alter table public.navigation_reviews enable row level security;
grant select, delete on public.navigation_reviews to authenticated;
grant insert (user_id, rating, route_accuracy, mode, destination_name, destination_longitude, destination_latitude,
  distance_m, duration_s, issues, comment) on public.navigation_reviews to authenticated;
create policy reviews_read_own on public.navigation_reviews for select to authenticated using (user_id = (select auth.uid()));
create policy reviews_insert_own on public.navigation_reviews for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy reviews_delete_own on public.navigation_reviews for delete to authenticated using (user_id = (select auth.uid()));

-- Aggregated rating near a destination (comments stay private).
create function public.destination_rating(lon double precision, lat double precision)
returns table (average real, reviews integer)
language sql stable security definer set search_path = '' as $$
  select avg(rating)::real, count(*)::integer from public.navigation_reviews
  where extensions.st_dwithin(
    extensions.st_makepoint(destination_longitude, destination_latitude)::extensions.geography,
    extensions.st_makepoint(lon, lat)::extensions.geography, 60);
$$;
revoke all on function public.destination_rating(double precision, double precision) from public;
grant execute on function public.destination_rating(double precision, double precision) to anon, authenticated;

grant all on public.reporter_reputation, public.community_reports, public.map_alerts, public.navigation_reviews to service_role;
