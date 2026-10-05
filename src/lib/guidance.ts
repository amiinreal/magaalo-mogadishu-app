import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistance, type Language } from '../i18n';
import type { MapAlert } from './community';
import { inside, metersBetween, pointAlong, routeProgress, type LngLat, type Point } from './geo';
import { instructionFor, spokenInstruction } from './instructions';
import type { Mode, Route, Step } from './routing';

export type GuidanceStatus = 'gps' | 'weak' | 'ok' | 'offroute' | 'outside';

export type Guidance = {
  status: GuidanceStatus;
  position: { lat: number; lng: number; heading: number | null; accuracy: number | null } | null;
  nextStep?: Step;
  instruction: string;
  distanceToNext: number;
  remaining: number;
  etaSeconds: number;
  closureAhead: MapAlert | null;
  offRoutePoints: Point[];
};

type Options = {
  route: Route | null;
  mode: Mode;
  active: boolean;
  simulate: boolean;
  lang: Language;
  voice: boolean;
  alerts: MapAlert[];
  onReroute: (from: Point) => void;
  onArrive: () => void;
};

const SIM_SPEED: Record<Mode, number> = { driving: 22, walking: 3, cycling: 9 }; // m/s, 2× real time
const ANNOUNCE: Record<Mode, number[]> = { driving: [600, 180, 40], walking: [60, 15], cycling: [150, 40] };

let somaliVoice: boolean | null = null;
async function hasSomaliVoice() {
  if (somaliVoice === null) {
    somaliVoice = await Speech.getAvailableVoicesAsync()
      .then(v => v.some(x => x.language?.toLowerCase().startsWith('so'))).catch(() => false);
  }
  return somaliVoice;
}

export function useGuidance({ route, mode, active, simulate, lang, voice, alerts, onReroute, onArrive }: Options): Guidance {
  const [state, setState] = useState<Omit<Guidance, 'offRoutePoints'>>({
    status: 'gps', position: null, instruction: '', distanceToNext: 0, remaining: 0, etaSeconds: 0, closureAhead: null,
  });
  const offRoute = useRef<Point[]>([]);
  const index = useRef(0), lastReroute = useRef(0), spoken = useRef(new Set<string>()), arrived = useRef(false);
  const callbacks = useRef({ onReroute, onArrive });
  callbacks.current = { onReroute, onArrive };
  const settings = useRef({ lang, voice, alerts });
  settings.current = { lang, voice, alerts };

  // Cumulative distance along the route makes "distance to next turn" follow the road, not a straight line.
  const cumulative = useMemo(() => {
    const out = [0];
    route?.coords.forEach((c, i) => { if (i) out.push(out[i - 1] + metersBetween(route.coords[i - 1], c)); });
    return out;
  }, [route]);

  useEffect(() => {
    index.current = 0; spoken.current.clear(); arrived.current = false;
  }, [route]);

  useEffect(() => {
    if (!active) offRoute.current = [];
  }, [active]);

  useEffect(() => {
    if (!active || !route) return;
    const coords = route.coords, total = cumulative[cumulative.length - 1] || route.distance;
    const pace = route.duration > 0 ? route.distance / route.duration : 8;

    // Speaks in Somali when the phone has a Somali voice, otherwise in English.
    const say = async (phrase: (l: Language) => string) => {
      if (!settings.current.voice) return;
      const somali = settings.current.lang === 'so' && await hasSomaliVoice();
      Speech.stop();
      Speech.speak(phrase(somali ? 'so' : 'en'), { language: somali ? 'so-SO' : 'en-US', rate: 0.95 });
    };

    const update = (point: LngLat, accuracy: number | null, heading: number | null) => {
      const { lang } = settings.current;
      const position = { lng: point[0], lat: point[1], accuracy, heading };
      if (!inside(point[0], point[1])) { setState(s => ({ ...s, status: 'outside', position })); return; }
      if (accuracy != null && accuracy > 80) { setState(s => ({ ...s, status: 'weak', position })); return; }

      const progress = routeProgress(point, coords, index.current);
      index.current = progress.index;
      const along = cumulative[progress.index] + metersBetween(coords[progress.index], progress.snap);
      const remaining = Math.max(0, total - along);

      if (!arrived.current && (metersBetween(point, coords[coords.length - 1]) < 30 || remaining < 15)) {
        arrived.current = true;
        say(l => instructionFor(l, { kind: 'arrive', distance: 0, location: point, routeIndex: 0 }));
        callbacks.current.onArrive();
        return;
      }

      if (progress.distance > Math.max(50, (accuracy ?? 10) * 1.5)) {
        setState(s => ({ ...s, status: 'offroute', position }));
        if (Date.now() - lastReroute.current > 15000) {
          lastReroute.current = Date.now();
          offRoute.current.push({ lat: point[1], lng: point[0] });
          callbacks.current.onReroute({ lat: point[1], lng: point[0] });
        }
        return;
      }

      const stepIdx = route.steps.findIndex(s => s.routeIndex > progress.index && s.kind !== 'depart');
      const nextStep = stepIdx >= 0 ? route.steps[stepIdx] : route.steps[route.steps.length - 1];
      const distanceToNext = Math.max(0, (cumulative[nextStep?.routeIndex ?? coords.length - 1] ?? total) - along);
      const instruction = nextStep ? instructionFor(lang, nextStep) : '';

      // Voice prompts at fixed distance thresholds before each maneuver.
      if (nextStep) {
        for (const threshold of ANNOUNCE[mode]) {
          const key = `${stepIdx}:${threshold}`;
          if (distanceToNext <= threshold && !spoken.current.has(key)) {
            ANNOUNCE[mode].filter(t => t >= threshold).forEach(t => spoken.current.add(`${stepIdx}:${t}`));
            const immediate = threshold === Math.min(...ANNOUNCE[mode]);
            say(l => immediate ? instructionFor(l, nextStep) : spokenInstruction(l, formatDistance(l, distanceToNext, true), instructionFor(l, nextStep)));
            break;
          }
        }
      }

      // A closure confirmed by the community after the route was planned, lying on the road ahead.
      const ahead = coords.slice(progress.index, progress.index + 400);
      const closureAhead = settings.current.alerts.find(a => a.status === 'confirmed' && a.stance && a.topic === 'road_closure' &&
        routeProgress([a.longitude, a.latitude], ahead, 0).distance < 25) ?? null;

      setState({ status: 'ok', position, nextStep, instruction, distanceToNext, remaining, etaSeconds: remaining / pace, closureAhead });
    };

    if (simulate) {
      let travelled = 0;
      const timer = setInterval(() => {
        travelled += SIM_SPEED[mode];
        const { point, bearing } = pointAlong(coords, travelled);
        update(point, 5, bearing);
      }, 1000);
      return () => clearInterval(timer);
    }

    let sub: Location.LocationSubscription | undefined, cancelled = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 },
      p => update([p.coords.longitude, p.coords.latitude], p.coords.accuracy, p.coords.heading),
    ).then(s => { if (cancelled) s.remove(); else sub = s; }).catch(() => setState(s => ({ ...s, status: 'gps' })));
    return () => { cancelled = true; sub?.remove(); Speech.stop(); };
  }, [active, route, simulate, mode, cumulative]);

  return { ...state, offRoutePoints: offRoute.current };
}
