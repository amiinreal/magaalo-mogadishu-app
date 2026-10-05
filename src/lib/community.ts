import type { Mode } from './routing';
import { supabase } from './supabase';

export type Topic = 'road_closure' | 'traffic' | 'flooding' | 'hazard' | 'building';

export type MapAlert = {
  id: string;
  topic: Topic;
  stance: boolean;
  status: 'suspected' | 'confirmed';
  probability: number;
  longitude: number;
  latitude: number;
  radius_m: number;
  supporters: number;
  deniers: number;
  first_reported_at: string;
  last_reported_at: string;
};

export type ReviewIssue = 'road_closed' | 'wrong_turn' | 'place_missing' | 'traffic' | 'bad_road' | 'unsafe';

export async function fetchAlerts(): Promise<MapAlert[]> {
  const { data, error } = await supabase.from('map_alerts').select('*').order('probability', { ascending: false }).limit(500);
  if (error) throw error;
  return data as MapAlert[];
}

/** Live updates: the consensus model rewrites map_alerts whenever reports arrive. */
export function subscribeAlerts(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = supabase
    .channel('map-alerts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'map_alerts' }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 400); // a refresh replaces all rows; batch the burst
    })
    .subscribe();
  return () => { clearTimeout(timer); supabase.removeChannel(channel); };
}

export async function sendReport(input: { topic: Topic; stance: boolean; lat: number; lng: number; note?: string; source?: 'manual' | 'navigation' | 'review' }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error('Sign in required'), { code: 'auth' });
  const { error } = await supabase.from('community_reports').insert({
    user_id: user.id, topic: input.topic, stance: input.stance, latitude: input.lat, longitude: input.lng,
    note: (input.note ?? '').slice(0, 500), source: input.source ?? 'manual',
  });
  if (error) throw new Error(error.message);
}

export async function sendReview(input: {
  rating: number; mode: Mode; destinationName: string; lat: number; lng: number;
  distance?: number; duration?: number; issues: ReviewIssue[]; comment: string;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error('Sign in required'), { code: 'auth' });
  const { error } = await supabase.from('navigation_reviews').insert({
    user_id: user.id, rating: input.rating, route_accuracy: input.rating, mode: input.mode,
    destination_name: input.destinationName.slice(0, 140), destination_latitude: input.lat, destination_longitude: input.lng,
    distance_m: input.distance, duration_s: input.duration, issues: input.issues, comment: input.comment.slice(0, 1000),
  });
  if (error) throw new Error(error.message);
}

export async function destinationRating(lat: number, lng: number) {
  const { data } = await supabase.rpc('destination_rating', { lon: lng, lat });
  const row = Array.isArray(data) ? data[0] : data;
  return row && row.reviews > 0 ? { average: Number(row.average), reviews: Number(row.reviews) } : null;
}

export async function myStats() {
  const [rep, reports, reviews] = await Promise.all([
    supabase.from('reporter_reputation').select('agreed,disagreed').maybeSingle(),
    supabase.from('community_reports').select('id', { count: 'exact', head: true }),
    supabase.from('navigation_reviews').select('id', { count: 'exact', head: true }),
  ]);
  const agreed = rep.data?.agreed ?? 0, disagreed = rep.data?.disagreed ?? 0;
  // Same Beta(agreed + 2, disagreed + 2) mean the server uses to weight votes.
  return { trust: (agreed + 2) / (agreed + disagreed + 4), reports: reports.count ?? 0, reviews: reviews.count ?? 0 };
}
