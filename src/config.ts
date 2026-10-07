// Publishable keys are safe to ship in a client; row level security protects the data.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://rfalepyhfrnvvkolxbwk.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_-GioI9OImUtfLzU5QTJ7wg_nZ3ety1J';

// The Magaalo Atlas website is the app's data and routing service: /data (map, places, districts,
// road network), /api/route (OSRM), /api/suggestions (moderated contributions), /api/alerts, /api/transport.
export const ATLAS_WEBSITE = process.env.EXPO_PUBLIC_ATLAS_URL ?? 'https://magaalo-mogadishu-atlas.amiinrealz.chatgpt.site';
// Same public bucket the website reads tiles from (the website falls back to its own /data copy).
export const MAP_STORAGE = `${SUPABASE_URL}/storage/v1/object/public/mogadishu-map`;

// Used only if the website cannot be reached — the same servers the website itself calls.
export const OSRM_SERVERS = {
  driving: ['https://router.project-osrm.org/route/v1/driving', 'https://routing.openstreetmap.de/routed-car/route/v1/driving'],
  walking: ['https://routing.openstreetmap.de/routed-foot/route/v1/driving'],
  cycling: ['https://routing.openstreetmap.de/routed-bike/route/v1/driving'],
};
export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

export const BOUNDS = { south: 1.93, west: 45.12, north: 2.23, east: 45.49 };
export const CITY_CENTER = { lat: 2.046, lng: 45.318 };

export const colors = {
  ink: '#172F34',
  muted: '#647579',
  line: '#E4E9E6',
  paper: '#ffffff',
  soft: '#F3F5F4',
  blue: '#2874EF',
  blueSoft: '#EAF2FF',
  green: '#174D45',
  amber: '#F3BF4F',
  red: '#C54435',
  water: '#C8E4EF',
};

export const DISTRICTS: [string, string][] = [
  ['Abdiaziz', '#68a990'], ['Bondhere', '#ebaf6a'], ['Daynile', '#90ab65'], ['Dharkenley', '#ba88c1'],
  ['Hamar Jajab', '#d99374'], ['Hamar Weyne', '#c8b35d'], ['Heliwaa', '#8d9ad6'], ['Hodan', '#7dacaa'],
  ['Howl Wadaag', '#e18a9b'], ['Kaaraan', '#75a2d0'], ['Kaxda', '#aa9270'], ['Shangaani', '#dbbd80'],
  ['Shibis', '#ad90d0'], ['Waaberi', '#83bb76'], ['Wadajir', '#77b6c1'], ['Warta Nabada', '#d78b61'],
  ['Yaaqshiid', '#b2bf6b'], ['Darussalam', '#64b9a3'], ['Garasbaley', '#cd94b1'], ['Gubadley', '#bca3de'],
];
