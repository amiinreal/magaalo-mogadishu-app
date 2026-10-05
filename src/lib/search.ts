import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAP_STORAGE } from '../config';
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
      id: String(p.id ?? i), name: displayName(p), nameSo: p['name:so'] ? String(p['name:so']) : undefined,
      category: categoryOf(p), address: p.address ? String(p.address) : p['addr:street'] ? String(p['addr:street']) : undefined,
      lat, lng, street: Boolean(p.highway),
    }];
  });
}

/** The same 3,000+ entry index the Atlas website searches, cached on the device for offline use. */
export function loadIndex(): Promise<Place[]> {
  indexPromise ||= (async () => {
    try {
      const response = await fetch(`${MAP_STORAGE}/search-index.json`);
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
  const seen = new Set<string>();
  return ranked.sort((a, b) => a.score - b.score).flatMap(({ place }) => {
    const key = `${normalizeText(place.name)}:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [place];
  }).slice(0, limit);
}
