import AsyncStorage from '@react-native-async-storage/async-storage';
import { ATLAS_WEBSITE, MAP_STORAGE } from '../config';
import { inside } from './geo';

export type Place = {
  id: string;
  name: string;
  nameSo?: string;
  category: string;
  address?: string;
  lat: number;
  lng: number;
  street?: boolean;
  /** What was tapped: a named place, a building footprint, a road, or a dropped pin. */
  kind?: 'place' | 'building' | 'road' | 'pin';
  /** OSM/Overture id, used for the network access point and for suggestions. */
  featureId?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  source?: string;
  /** Geometry in lng/lat for roads and buildings (sent with suggestions). */
  geometry?: { type: string; coordinates: unknown };
};

const CACHE_KEY = 'magaalo.searchIndex.v1';
let indexPromise: Promise<Place[]> | null = null;

type RawPlace = Record<string, unknown> & { id?: string; lon?: number | string; lat?: number | string };

function categoryOf(p: RawPlace) {
  return String(p.category || p.basic_category || p.taxonomy || (p.highway ? 'street' : '') || p.shop || p.amenity ||
    p.tourism || p.office || p.leisure || 'place').replace(/_/g, ' ');
}

// Strip Arabic duplicates such as "Hotel East Afrika فندق شرق أفريقيا" for display.
function displayName(p: RawPlace) {
  const name = String(p['name:en'] || p.name || p['name:so'] || '');
  const latin = name.replace(/[؀-ۿ]+/g, '').replace(/\s+/g, ' ').trim();
  return latin || name;
}

function compact(raw: RawPlace[]): Place[] {
  return raw.flatMap((p, i) => {
    const lat = Number(p.lat), lng = Number(p.lon);
    if (!inside(lng, lat)) return [];
    return [{
      id: String(p.id ?? i), featureId: p.id ? String(p.id) : undefined, kind: p.highway ? 'road' : 'place',
      name: displayName(p), nameSo: p['name:so'] ? String(p['name:so']) : undefined,
      category: categoryOf(p), address: p.address ? String(p.address) : p['addr:street'] ? String(p['addr:street']) : undefined,
      lat, lng, street: Boolean(p.highway),
    }];
  });
}

/** The same 3,000+ entry index the Atlas website searches, cached on the device for offline use. */
export function loadIndex(): Promise<Place[]> {
  indexPromise ||= (async () => {
    try {
      // The website's own index (same file the website searches), Supabase storage as a backup.
      let response = await fetch(`${ATLAS_WEBSITE}/data/search-index.json`).catch(() => null);
      if (!response?.ok) response = await fetch(`${MAP_STORAGE}/search-index.json`);
      if (!response.ok) throw new Error(String(response.status));
      const places = compact(await response.json());
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(places)).catch(() => {});
      return places;
    } catch {
      const cached = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
      if (cached) return JSON.parse(cached) as Place[];
      indexPromise = null;
      return [];
    }
  })();
  return indexPromise;
}

export const normalizeText = (value: string) =>
  value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Somali ↔ English search synonyms, so "suuq" finds markets and "isbitaal" finds hospitals.
const SYNONYMS: Record<string, string[]> = {
  suuq: ['market', 'marketplace', 'shop', 'mall'], dukaan: ['shop', 'store', 'retail'],
  isbitaal: ['hospital', 'clinic'], cusbitaal: ['hospital', 'clinic'], masjid: ['mosque', 'place of worship'],
  jaamacad: ['university', 'college'], dugsi: ['school'], iskuul: ['school'], makhaayad: ['restaurant', 'cafe'],
  maqaaxi: ['cafe', 'coffee'], hudheel: ['hotel'], hotel: ['hotel', 'guest house'], bangi: ['bank', 'atm'],
  farmashi: ['pharmacy', 'chemist'], shidaal: ['fuel', 'petrol', 'gas station'], booliis: ['police'],
  garoon: ['airport', 'stadium'], xeeb: ['beach'], wadada: ['street', 'road'], waddo: ['street', 'road'],
  restaurant: ['restaurant', 'fast food', 'cafe'], petrol: ['fuel', 'gas station'], market: ['market', 'marketplace'],
};

export const CATEGORY_QUERIES = {
  restaurants: 'restaurant', petrol: 'fuel', markets: 'market', hospitals: 'hospital', mosques: 'mosque',
  hotels: 'hotel', banks: 'bank', schools: 'school', pharmacies: 'pharmacy',
} as const;

export async function searchPlaces(text: string, near?: { lat: number; lng: number }, limit = 12): Promise<Place[]> {
  const query = normalizeText(text), words = query.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const index = await loadIndex();
  const ranked: { place: Place; score: number }[] = [];
  for (const place of index) {
    const name = normalizeText(place.name);
    const haystack = normalizeText([place.name, place.nameSo, place.category, place.address].filter(Boolean).join(' '));
    const direct = words.every(w => haystack.includes(w));
    const expanded = direct || words.every(w => haystack.includes(w) || (SYNONYMS[w] ?? []).some(a => haystack.includes(a)));
    if (!expanded) continue;
    let score = direct ? 0 : 40;
    if (name === query) score -= 40; else if (name.startsWith(query)) score -= 28; else if (name.includes(query)) score -= 16;
    if (place.street) score += 4;
    if (near) score += Math.min(20, Math.hypot(place.lat - near.lat, place.lng - near.lng) * 200);
    ranked.push({ place, score });
  }
  if (!ranked.length) return nominatim(text);
  const seen = new Set<string>();
  return ranked.sort((a, b) => a.score - b.score).flatMap(({ place }) => {
    const key = `${normalizeText(place.name)}:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [place];
  }).slice(0, limit);
}

/** The website's /api/search (OpenStreetMap Nominatim, bounded to Mogadishu) when the local index has no match. */
async function nominatim(text: string): Promise<Place[]> {
  const params = new URLSearchParams({ q: `${text}, Mogadishu, Somalia` });
  try {
    const response = await fetch(`${ATLAS_WEBSITE}/api/search?${params}`);
    if (!response.ok) return [];
    const rows = (await response.json()) as { place_id: number; lat: string; lon: string; name?: string; display_name: string; type?: string; osm_type?: string; osm_id?: number }[];
    return rows.flatMap(r => {
      const lat = Number(r.lat), lng = Number(r.lon);
      if (!inside(lng, lat)) return [];
      const name = r.name || r.display_name.split(',')[0];
      return [{ id: `nominatim:${r.place_id}`, featureId: r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : undefined, kind: 'place' as const,
        name, category: (r.type || 'place').replace(/_/g, ' '), address: r.display_name.split(',').slice(1, 3).join(',').trim(), lat, lng }];
    });
  } catch {
    return [];
  }
}

/** Converts a place record from the website's atlas.json (place_features) into a Place. */
export function placeFromFeature(feature: { id: string; geometry: { coordinates: unknown }; properties: Record<string, unknown> }): Place {
  const p = feature.properties, [lng, lat] = feature.geometry.coordinates as [number, number];
  return {
    id: feature.id, featureId: feature.id, kind: 'place', name: displayName(p as RawPlace) || 'Unnamed place', nameSo: p['name:so'] ? String(p['name:so']) : undefined,
    category: categoryOf(p as RawPlace), address: p.address ? String(p.address) : p['addr:street'] ? String(p['addr:street']) : undefined, lat, lng,
    phone: p.phone ? String(p.phone) : undefined, website: p.website ? String(p.website) : undefined,
    openingHours: p.opening_hours ? String(p.opening_hours) : undefined,
    source: p.source === 'Overture Maps' ? `Overture Maps · ${feature.id.replace('overture/', '')}` : `OpenStreetMap · ${feature.id}`,
  };
}
