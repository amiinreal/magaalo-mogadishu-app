import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Place } from '../lib/search';
import { supabase } from '../lib/supabase';

// Map layers mirror the website's "Map layers" panel.
export type Settings = {
  voice: boolean;
  basemap: 'street' | 'satellite';
  roads: boolean;
  buildings: boolean;
  places: boolean;
  community: boolean;
  transport: boolean;
  districts: boolean;
  districtOpacity: number;
  reports: boolean;
  developer: boolean;
  simulate: boolean;
  mapDebug: boolean;
};

export type Saved = { home?: Place; work?: Place; places: Place[]; recents: Place[] };

const DEFAULT_SETTINGS: Settings = {
  voice: true, basemap: 'satellite', roads: true, buildings: true, places: true, community: true, transport: false,
  districts: false, districtOpacity: 24, reports: true, developer: false, simulate: false, mapDebug: false,
};
const SETTINGS_KEY = 'magaalo.settings.v2';
const SAVED_KEY = 'magaalo.saved.v1';

type AppContext = {
  session: Session | null;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  saved: Saved;
  setHome: (place?: Place) => void;
  setWork: (place?: Place) => void;
  toggleSaved: (place: Place) => void;
  isSaved: (place: Place) => boolean;
  addRecent: (place: Place) => void;
  clearHistory: () => void;
  /** Set by screens that pushed focus/destination for the map (e.g. districts, saved places). */
  mapIntent: MapIntent | null;
  setMapIntent: (intent: MapIntent | null) => void;
};

export type MapIntent = { type: 'place'; place: Place } | { type: 'district'; name: string };

const Ctx = createContext<AppContext | null>(null);
const samePlace = (a: Place, b: Place) => a.id === b.id || (Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState<Saved>({ places: [], recents: [] });
  const [mapIntent, setMapIntent] = useState<MapIntent | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    AsyncStorage.multiGet([SETTINGS_KEY, SAVED_KEY]).then(([[, s], [, v]]) => {
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
      if (v) setSaved({ places: [], recents: [], ...JSON.parse(v) });
    }).catch(() => {});
    return () => data.subscription.unsubscribe();
  }, []);

  const persistSaved = useCallback((update: (prev: Saved) => Saved) => {
    setSaved(prev => {
      const next = update(prev);
      AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      if (!next.developer) next.simulate = next.mapDebug = false;
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<AppContext>(() => ({
    session, settings, updateSettings, saved, mapIntent, setMapIntent,
    setHome: place => persistSaved(p => ({ ...p, home: place })),
    setWork: place => persistSaved(p => ({ ...p, work: place })),
    toggleSaved: place => persistSaved(p => ({
      ...p, places: p.places.some(x => samePlace(x, place)) ? p.places.filter(x => !samePlace(x, place)) : [place, ...p.places].slice(0, 100),
    })),
    isSaved: place => saved.places.some(x => samePlace(x, place)),
    addRecent: place => persistSaved(p => ({ ...p, recents: [place, ...p.recents.filter(x => !samePlace(x, place))].slice(0, 8) })),
    clearHistory: () => persistSaved(p => ({ ...p, recents: [] })),
  }), [session, settings, updateSettings, saved, mapIntent, persistSaved]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
