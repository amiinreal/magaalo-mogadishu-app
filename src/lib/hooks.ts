import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAlerts, subscribeAlerts, type MapAlert } from './community';

export type Fix = { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; timestamp: number };

/** Foreground location for the blue dot. Returns null until permission is granted. */
export function useDeviceLocation(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | undefined, cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setPermission(status === 'granted' ? 'granted' : 'denied');
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 },
        p => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, timestamp: p.timestamp }),
      );
      if (cancelled) sub.remove();
    })().catch(() => setPermission('denied'));
    return () => { cancelled = true; sub?.remove(); };
  }, [enabled]);
  return { fix, permission };
}

const ALERTS_CACHE = 'magaalo.alerts.v1';

/** Community alerts from the consensus model, kept live through Supabase Realtime. */
export function useAlerts() {
  const [alerts, setAlerts] = useState<MapAlert[]>([]);
  const refresh = useCallback(async () => {
    try {
      const next = await fetchAlerts();
      setAlerts(next);
      AsyncStorage.setItem(ALERTS_CACHE, JSON.stringify(next)).catch(() => {});
    } catch {
      const cached = await AsyncStorage.getItem(ALERTS_CACHE).catch(() => null);
      if (cached) setAlerts(JSON.parse(cached));
    }
  }, []);
  useEffect(() => {
    refresh();
    const unsubscribe = subscribeAlerts(refresh);
    const poll = setInterval(refresh, 120000); // fallback when Realtime is unavailable
    return () => { unsubscribe(); clearInterval(poll); };
  }, [refresh]);
  return { alerts, refresh };
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener(state => setOnline(state.isConnected !== false && state.isInternetReachable !== false)), []);
  return online;
}

/** Calls `fn` at most once per `ms`, keeping the latest call (for map-center updates). */
export function useThrottled<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  const last = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>(undefined), saved = useRef(fn);
  saved.current = fn;
  return useCallback((...args: T) => {
    clearTimeout(timer.current);
    const wait = Math.max(0, ms - (Date.now() - last.current));
    timer.current = setTimeout(() => { last.current = Date.now(); saved.current(...args); }, wait);
  }, [ms]);
}
