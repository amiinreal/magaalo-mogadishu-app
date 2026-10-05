// Publishable keys are safe to ship in a client; row level security protects the data.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://rfalepyhfrnvvkolxbwk.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_-GioI9OImUtfLzU5QTJ7wg_nZ3ety1J';

// Same public bucket the Magaalo Atlas website uses for tiles, districts and the search index.
export const MAP_STORAGE = `${SUPABASE_URL}/storage/v1/object/public/mogadishu-map`;
export const ATLAS_WEBSITE = 'https://magaalo-mogadishu-atlas.amiinrealz.chatgpt.site';

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
export const OSRM_URL = 'https://router.project-osrm.org/route/v1';

export const BOUNDS = { south: 1.93, west: 45.12, north: 2.23, east: 45.49 };
export const CITY_CENTER = { lat: 2.046, lng: 45.318 };

export const colors = {
  ink: '#16302b',
  muted: '#6b7a76',
  line: '#e6ebe7',
  paper: '#ffffff',
  soft: '#f3f6f3',
  blue: '#2f6fe8',
  blueSoft: '#e8f0fe',
  green: '#1d4b40',
  amber: '#f2b33d',
  red: '#d23b3b',
  water: '#bfe0ec',
};

export const DISTRICTS: [string, string][] = [
  ['Abdiaziz', '#68a990'], ['Bondhere', '#ebaf6a'], ['Daynile', '#90ab65'], ['Dharkenley', '#ba88c1'],
  ['Hamar Jajab', '#d99374'], ['Hamar Weyne', '#c8b35d'], ['Heliwaa', '#8d9ad6'], ['Hodan', '#7dacaa'],
  ['Howl Wadaag', '#e18a9b'], ['Kaaraan', '#75a2d0'], ['Kaxda', '#aa9270'], ['Shangaani', '#dbbd80'],
  ['Shibis', '#ad90d0'], ['Waaberi', '#83bb76'], ['Wadajir', '#77b6c1'], ['Warta Nabada', '#d78b61'],
  ['Yaaqshiid', '#b2bf6b'], ['Darussalam', '#64b9a3'], ['Garasbaley', '#cd94b1'], ['Gubadley', '#bca3de'],
];
