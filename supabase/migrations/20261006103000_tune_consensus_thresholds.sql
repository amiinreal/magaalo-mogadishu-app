-- Calibrate consensus: 3 new reporters (or 2 with a good track record) confirm an alert;
-- single reports are published as 'suspected' so other users can verify them.
create or replace function public.refresh_map_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare published integer;
begin
  perform pg_advisory_xact_lock(724001);
  -- Several refreshes can run in one transaction (e.g. a batch insert), so never rely on ON COMMIT alone.
  drop table if exists pg_temp._votes, pg_temp._clusters;

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
    1 / (1 + exp(-(-2.0 + 1.8 * sum(case when stance then weight else -weight end)))) as p_present,
    1 / (1 + exp(-(-2.0 - 1.8 * sum(case when stance then weight else -weight end)))) as p_absent,
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
  where side.p >= 0.2 and side.n >= 1;
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

  drop table if exists pg_temp._votes, pg_temp._clusters;
  return published;
end;
$$;

revoke all on function public.refresh_map_alerts() from public, anon, authenticated;
