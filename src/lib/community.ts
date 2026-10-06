import type { Geometry } from '../components/MapView';
import type { Mode } from './routing';
import { supabase } from './supabase';
import { notDeployed, website } from './website';

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

/** The website's moderated suggestion kinds (map_suggestions). */
export type SuggestionKind = 'street_name' | 'missing_building' | 'business' | 'transport_stop' | 'road_issue';
export type Suggestion = {
  id: string; kind: SuggestionKind; name: string; notes: string; geometry: Geometry; osm_id: string | null;
  status: 'pending' | 'approved' | 'rejected'; review_notes?: string; created_at: string;
};

const authError = () => Object.assign(new Error('Sign in required'), { code: 'auth' });
async function requireSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw authError();
}

// ---------------- Alerts (community consensus) ----------------
export async function fetchAlerts(): Promise<MapAlert[]> {
  try {
    return (await website<{ alerts: MapAlert[] }>('/api/alerts')).alerts;
  } catch (error) {
    if (!notDeployed(error)) throw error;
    const { data, error: dbError } = await supabase.from('map_alerts').select('*').order('probability', { ascending: false }).limit(500);
    if (dbError) throw dbError;
    return data as MapAlert[];
  }
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

// ---------------- Reports, reviews, ratings: website first, same database directly if the website is older ----------------
export async function sendReport(input: { topic: Topic; stance: boolean; lat: number; lng: number; note?: string; source?: 'manual' | 'navigation' | 'review' }) {
  await requireSession();
  const body = { topic: input.topic, stance: input.stance, latitude: input.lat, longitude: input.lng, note: (input.note ?? '').slice(0, 500), source: input.source ?? 'manual' };
  try {
    await website('/api/reports', body);
  } catch (error) {
    if (!notDeployed(error)) throw error;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw authError();
    const { error: dbError } = await supabase.from('community_reports').insert({ user_id: user.id, ...body });
    if (dbError) throw new Error(dbError.message);
  }
}

export async function sendReview(input: {
  rating: number; mode: Mode; destinationName: string; lat: number; lng: number;
  distance?: number; duration?: number; issues: ReviewIssue[]; comment: string;
}) {
  await requireSession();
  const body = {
    rating: input.rating, mode: input.mode, destination_name: input.destinationName.slice(0, 140), latitude: input.lat, longitude: input.lng,
    distance_m: input.distance, duration_s: input.duration, issues: input.issues, comment: input.comment.slice(0, 1000),
  };
  try {
    await website('/api/reviews', body);
  } catch (error) {
    if (!notDeployed(error)) throw error;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw authError();
    const { error: dbError } = await supabase.from('navigation_reviews').insert({
      user_id: user.id, rating: body.rating, route_accuracy: body.rating, mode: body.mode, destination_name: body.destination_name,
      destination_latitude: body.latitude, destination_longitude: body.longitude, distance_m: body.distance_m, duration_s: body.duration_s,
      issues: body.issues, comment: body.comment,
    });
    if (dbError) throw new Error(dbError.message);
  }
}

export async function destinationRating(lat: number, lng: number) {
  try {
    const r = await website<{ average: number | null; reviews: number }>(`/api/rating?lon=${lng}&lat=${lat}`);
    return r.reviews > 0 && r.average != null ? { average: r.average, reviews: r.reviews } : null;
  } catch (error) {
    if (!notDeployed(error)) return null;
    const { data } = await supabase.rpc('destination_rating', { lon: lng, lat });
    const row = Array.isArray(data) ? data[0] : data;
    return row && row.reviews > 0 ? { average: Number(row.average), reviews: Number(row.reviews) } : null;
  }
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

// ---------------- Moderated suggestions (the website's data-collection flow) ----------------
export async function submitSuggestion(input: { kind: SuggestionKind; name: string; notes: string; geometry: Geometry; osmId?: string | null }) {
  await requireSession();
  const osm_id = input.osmId && /^(node|way|relation)\//.test(input.osmId) ? input.osmId : null;
  return (await website<{ suggestion: Suggestion }>('/api/suggestions', {
    kind: input.kind, name: input.name.trim().slice(0, 140), notes: input.notes.trim().slice(0, 1200), geometry: input.geometry, osm_id,
  })).suggestion;
}

export async function mySuggestions() {
  await requireSession();
  return (await website<{ suggestions: Suggestion[] }>('/api/me/suggestions')).suggestions;
}
