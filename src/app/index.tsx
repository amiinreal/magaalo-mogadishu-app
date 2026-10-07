import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapView, type CommunitySuggestion, type Geometry, type MapEvent, type MapFeature, type MapHandle, type MapMarker } from '../components/MapView';
import { AlertSheet, ExploreSheet, LayersSheet, PickSheet, PlaceSheet, SearchSheet, type AccessInfo } from '../components/sheets/ExploreSheets';
import {
  CommunitySheet, DrawSheet, ImproveSheet, ReportPinSheet, ReportSentSheet, ReportSheet, SuggestionFormSheet, SUGGEST_CHOICES,
  type ReportChoice, type SuggestChoice,
} from '../components/sheets/ReportSheets';
import { ArrivedSheet, ClosureSheet, NavigationBanner, NavigationSheet, RouteHeader, RouteSheet } from '../components/sheets/TripSheets';
import { Banner, Chip, RoundButton, type IconName } from '../components/ui';
import { CITY_CENTER, colors } from '../config';
import { useI18n, type StringKey } from '../i18n';
import { sendReport, sendReview, submitSuggestion, type MapAlert, type ReviewIssue, type SuggestionKind, type Topic } from '../lib/community';
import { inside, metersBetween, type LngLat, type Point } from '../lib/geo';
import { useGuidance } from '../lib/guidance';
import { useAlerts, useDeviceLocation, useOnline } from '../lib/hooks';
import { planRoute, type Mode, type Route } from '../lib/routing';
import { CATEGORY_QUERIES, placeFromFeature, type Place } from '../lib/search';
import { useApp } from '../state/AppState';

type SearchPurpose = 'go' | 'home' | 'work';
type Screen =
  | { kind: 'explore' }
  | { kind: 'search'; query: string; purpose: SearchPurpose }
  | { kind: 'place'; place: Place }
  | { kind: 'pick'; target: 'to' | 'from' }
  | { kind: 'route' }
  | { kind: 'arrived' }
  | { kind: 'report' }
  | { kind: 'reportPin'; choice: ReportChoice }
  | { kind: 'reportSent' }
  | { kind: 'improve' }
  | { kind: 'draw'; choice: SuggestChoice; points: number }
  | { kind: 'suggestForm'; suggestionKind: SuggestionKind; geometry: Geometry; name: string; osmId?: string; back?: Screen }
  | { kind: 'community'; suggestion: CommunitySuggestion }
  | { kind: 'layers' }
  | { kind: 'alert'; alert: MapAlert };

/** `to` is what the user chose; `dest` is where that place meets the road network (what OSRM routes to). */
type Trip = {
  from: (Point & { label: string }) | null; to: Place; dest: Point; mode: Mode;
  routes: Route[]; selected: number; loading: boolean; error?: string;
};
type Closure = { alert: MapAlert; route: Route | null; extra: number | null };

const CHIPS: [keyof typeof CATEGORY_QUERIES, IconName][] = [
  ['restaurants', 'restaurant-outline'], ['petrol', 'speedometer-outline'], ['markets', 'storefront-outline'],
  ['hospitals', 'medkit-outline'], ['mosques', 'moon-outline'], ['hotels', 'bed-outline'], ['banks', 'cash-outline'],
];

/** A representative point for any GeoJSON geometry (first vertex of the outer ring/line is enough for a sheet). */
function anchor(geometry: Geometry, fallback: Point): Point {
  const flat = (c: unknown): LngLat | null => Array.isArray(c) && typeof c[0] === 'number' ? (c as LngLat) : Array.isArray(c) ? flat(c[0]) : null;
  const p = flat(geometry.coordinates);
  return p ? { lng: p[0], lat: p[1] } : fallback;
}

export default function MapScreen() {
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const { session, settings, updateSettings, addRecent, setHome, setWork, mapIntent, setMapIntent } = useApp();
  const online = useOnline();
  const { alerts, refresh: refreshAlerts } = useAlerts();
  const { fix } = useDeviceLocation(true);
  const map = useRef<MapHandle>(null);

  const [screen, setScreen] = useState<Screen>({ kind: 'explore' });
  const [sheetHeight, setSheetHeight] = useState(240);
  const [center, setCenter] = useState<Point>(CITY_CENTER);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [follow, setFollow] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [closure, setClosure] = useState<Closure | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ title: string; hint?: string; icon: IconName } | null>(null);
  const [access, setAccess] = useState<Record<string, (NonNullable<AccessInfo> & { point?: Point }) | null>>({});
  const dismissedClosures = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((title: string, hint?: string, icon: IconName = 'checkmark-circle') => {
    clearTimeout(toastTimer.current);
    setToast({ title, hint, icon });
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  const route = trip?.routes[trip.selected] ?? null;
  const simulate = settings.developer && settings.simulate;
  const fixInside = fix && inside(fix.lng, fix.lat) ? fix : null;

  // ---- Places & their road access points ----
  const accessKey = (p: Place) => p.featureId ?? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const lookupAccess = useCallback(async (p: Place) => {
    const key = accessKey(p);
    if (access[key] !== undefined) return access[key];
    const a = p.kind === 'road' ? null : await map.current?.access(p.lat, p.lng, p.featureId, p.kind === 'place' ? 'place' : 'building') ?? null;
    const info = a ? { street: a.street, distance: a.distance, source: a.source, point: { lat: a.lat, lng: a.lng } } : null;
    setAccess(prev => ({ ...prev, [key]: info }));
    return info;
  }, [access]);

  const openPlace = (place: Place, fly = true) => {
    setScreen({ kind: 'place', place });
    if (fly) map.current?.flyTo(place.lat, place.lng, 17);
    lookupAccess(place);
  };

  // ---- Routing (Magaalo website /api/route → OSRM) ----
  const plan = useCallback(async (next: Omit<Trip, 'routes' | 'selected' | 'loading'>) => {
    const from = next.from ?? (fixInside ? { lat: fixInside.lat, lng: fixInside.lng, label: t('route.yourLocation') } : null);
    if (!from) {
      setTrip({ ...next, routes: [], selected: 0, loading: false, error: fix ? t('route.outside') : t('route.locationNeeded') });
      return;
    }
    setTrip({ ...next, routes: [], selected: 0, loading: true });
    try {
      const routes = await planRoute(from, next.dest, next.mode, alerts);
      setTrip({ ...next, routes, selected: 0, loading: false });
    } catch (error) {
      setTrip({ ...next, routes: [], selected: 0, loading: false, error: (error as { status?: number }).status === 422 ? (error as Error).message : t('route.failed') });
    }
  }, [fixInside?.lat, fixInside?.lng, fix, alerts, t]);

  const openDirections = async (place: Place) => {
    addRecent(place);
    setScreen({ kind: 'route' });
    const a = await lookupAccess(place);
    plan({ from: trip?.from ?? null, to: place, dest: a?.point ?? { lat: place.lat, lng: place.lng }, mode: trip?.mode ?? 'driving' });
  };

  const guidance = useGuidance({
    route, mode: trip?.mode ?? 'driving', active: navigating, simulate, lang, voice: settings.voice, alerts,
    onReroute: async from => {
      if (!trip) return;
      try {
        const routes = await planRoute(from, trip.dest, trip.mode, alerts);
        setTrip(prev => prev && { ...prev, routes: routes.slice(0, 1), selected: 0 });
        showToast(t('nav.routeUpdated'), undefined, 'git-branch-outline');
      } catch { /* keep the old route; we'll retry on the next off-route fix */ }
    },
    onArrive: () => {
      setNavigating(false); setFollow(false); setClosure(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setScreen({ kind: 'arrived' });
    },
  });

  // A closure confirmed mid-trip: pre-compute the detour so "Continue · +N min" is honest.
  useEffect(() => {
    const ahead = guidance.closureAhead;
    if (!navigating || !ahead || !trip || closure || dismissedClosures.current.has(ahead.id) || !guidance.position) return;
    const from = { lat: guidance.position.lat, lng: guidance.position.lng };
    setClosure({ alert: ahead, route: null, extra: null });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    planRoute(from, trip.dest, trip.mode, alerts).then(([r]) => {
      setClosure(c => c && { ...c, route: r, extra: Math.round((r.duration - guidance.etaSeconds) / 60) });
    }).catch(() => setClosure(c => c && { ...c, extra: 0 }));
  }, [guidance.closureAhead?.id, navigating]);

  // ---- Intents from other screens (saved places, districts, my suggestions) ----
  useFocusEffect(useCallback(() => {
    if (!mapIntent) return;
    if (mapIntent.type === 'place') openPlace(mapIntent.place);
    else { updateSettings({ districts: true }); map.current?.fitDistrict(mapIntent.name); setScreen({ kind: 'explore' }); }
    setMapIntent(null);
  }, [mapIntent]));

  // ---- Reports (community consensus model) ----
  const requireSignIn = () => { if (session) return true; router.push('/account'); return false; };
  const submitReport = async (topic: Topic, stance: boolean, at: Point, note = '', source: 'manual' | 'navigation' = 'manual') => {
    if (!requireSignIn()) return false;
    if (simulate && navigating) { showToast(t('report.simulated'), undefined, 'information-circle'); return false; }
    setBusy(true);
    try {
      await sendReport({ topic, stance, lat: at.lat, lng: at.lng, note, source });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t('report.thanks'), t('report.willCheck'));
      refreshAlerts();
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('common.error'), undefined, 'alert-circle');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const chooseReport = async (choice: ReportChoice) => {
    // While driving, one tap sends at the current position — no map fiddling.
    if (navigating && guidance.position) {
      await submitReport(choice.topic, choice.stance, guidance.position, '', 'navigation');
      setScreen({ kind: 'route' });
      return;
    }
    const at = fixInside ?? center;
    map.current?.flyTo(at.lat, at.lng, 17);
    setScreen({ kind: 'reportPin', choice });
  };

  // ---- Moderated suggestions (website /api/suggestions) ----
  const suggestFor = (place: Place): Screen => {
    if (place.kind === 'road' && place.geometry) return { kind: 'suggestForm', suggestionKind: 'street_name', geometry: place.geometry as Geometry, name: place.name, osmId: place.featureId, back: { kind: 'place', place } };
    if (place.kind === 'building' && place.geometry) return { kind: 'suggestForm', suggestionKind: place.name ? 'business' : 'missing_building', geometry: place.geometry as Geometry, name: place.name ?? '', osmId: place.featureId, back: { kind: 'place', place } };
    return { kind: 'suggestForm', suggestionKind: 'business', geometry: { type: 'Point', coordinates: [place.lng, place.lat] }, name: place.kind === 'pin' ? '' : place.name, osmId: place.featureId, back: { kind: 'place', place } };
  };
  const startDrawing = (choice: SuggestChoice) => {
    if (!requireSignIn()) return;
    map.current?.draw(choice.draw);
    setScreen({ kind: 'draw', choice, points: 0 });
  };
  const sendSuggestion = async (s: Extract<Screen, { kind: 'suggestForm' }>, name: string, notes: string) => {
    if (!requireSignIn()) return;
    // The website only accepts polygons for missing buildings.
    if (s.suggestionKind === 'missing_building' && s.geometry.type !== 'Polygon' && s.geometry.type !== 'MultiPolygon') {
      showToast(t('suggestion.needsOutline'), undefined, 'alert-circle');
      startDrawing(SUGGEST_CHOICES.find(c => c.kind === 'missing_building')!);
      return;
    }
    setBusy(true);
    try {
      await submitSuggestion({ kind: s.suggestionKind, name, notes, geometry: s.geometry, osmId: s.osmId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t('suggestion.sent'), t('suggestion.sentHint'));
      setScreen({ kind: 'explore' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('common.error'), undefined, 'alert-circle');
    } finally {
      setBusy(false);
    }
  };

  const endTrip = () => {
    setNavigating(false); setFollow(false); setClosure(null);
    setTrip(null); setScreen({ kind: 'explore' });
  };

  // ---- Map events ----
  const browsing = !navigating && ['explore', 'place', 'layers', 'alert', 'community'].includes(screen.kind);
  const onMapEvent = (e: MapEvent) => {
    switch (e.type) {
      case 'center': setCenter({ lat: e.lat, lng: e.lng }); break;
      case 'unfollow': setFollow(false); break;
      case 'outside': showToast(t('nav.outside'), undefined, 'alert-circle'); break;
      case 'status': if (e.message === 'satellite-failed') showToast(t('map.satelliteFailed'), undefined, 'cloud-offline-outline'); break;
      case 'atlas': AsyncStorage.setItem('magaalo.atlasInfo', JSON.stringify(e)).catch(() => {}); break;
      case 'alternative': setTrip(prev => prev && { ...prev, selected: e.index < prev.selected ? e.index : e.index + 1 }); break;
      case 'drawPoints': setScreen(s => (s.kind === 'draw' ? { ...s, points: e.count } : s)); break;
      case 'drawn':
        if (e.geometry && screen.kind === 'draw') {
          setScreen({ kind: 'suggestForm', suggestionKind: screen.choice.kind, geometry: e.geometry, name: '' });
        }
        break;
      case 'alert': {
        const alert = alerts.find(a => a.id === e.id);
        if (alert && browsing) setScreen({ kind: 'alert', alert });
        break;
      }
      case 'community':
        if (browsing) setScreen({ kind: 'community', suggestion: e.suggestion });
        break;
      case 'place':
        if (browsing) openPlace(placeFromFeature(e.feature as MapFeature & { properties: Record<string, unknown> }), false);
        break;
      case 'longpress':
        if (browsing) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          openPlace({ id: `pin:${e.lat},${e.lng}`, kind: 'pin', name: t('search.droppedPin'), category: `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`, lat: e.lat, lng: e.lng }, false);
        }
        break;
      case 'feature':
        if (browsing) {
          const f = e.feature, p = f.properties, building = f.geometry.type.includes('Polygon');
          const name = String(p['name:en'] ?? p.name ?? p['addr:street'] ?? '');
          openPlace({
            id: f.id, featureId: f.id, kind: building ? 'building' : 'road', geometry: f.geometry,
            name: name || (building ? t('place.building') : t('place.road')),
            category: building ? (p.building && p.building !== 'yes' ? `${p.building} building` : 'building') : `${String(p.highway ?? 'road').replace(/_/g, ' ')} road`,
            lat: e.lat, lng: e.lng, source: `OpenStreetMap · ${f.id}`,
          }, false);
        }
        break;
      case 'press':
        if (['place', 'layers', 'alert', 'community'].includes(screen.kind)) setScreen({ kind: 'explore' });
        break;
    }
  };

  // ---- What the map shows ----
  const currentAccess = screen.kind === 'place' ? access[accessKey(screen.place)] : undefined;
  const markers = useMemo<MapMarker[]>(() => {
    if (screen.kind === 'place') {
      const out: MapMarker[] = [{ id: 'dest', kind: 'destination', lat: screen.place.lat, lng: screen.place.lng }];
      if (currentAccess?.point) out.push({ id: 'access', kind: 'access', ...currentAccess.point });
      return out;
    }
    if (!trip || (!['route', 'arrived'].includes(screen.kind) && !navigating)) return [];
    const out: MapMarker[] = [{ id: 'dest', kind: 'destination', lat: trip.to.lat, lng: trip.to.lng }];
    if (trip.from && !navigating) out.push({ id: 'start', kind: 'start', lat: trip.from.lat, lng: trip.from.lng });
    return out;
  }, [screen, trip, navigating, currentAccess]);

  const showRoute = !!trip && (screen.kind === 'route' || navigating);
  const routeCoords = showRoute ? route?.coords ?? null : null;
  const alternatives = useMemo(() => (showRoute && !navigating && trip ? trip.routes.filter((_, i) => i !== trip.selected).map(r => r.coords) : []), [showRoute, navigating, trip]);
  // Dashed last metres from the road to the building, when the building sits away from the road.
  const walkTo = useMemo<LngLat | null>(() => {
    if (!showRoute || !trip || !route) return null;
    const end = route.coords[route.coords.length - 1], to: LngLat = [trip.to.lng, trip.to.lat];
    return metersBetween(end, to) > 8 ? to : null;
  }, [showRoute, trip, route]);
  const userPosition = navigating && guidance.position ? guidance.position : fix ? { lat: fix.lat, lng: fix.lng, heading: fix.heading, accuracy: fix.accuracy } : null;
  const topPad = insets.top + (navigating ? 150 : screen.kind === 'route' ? 130 : 110);

  const locate = () => {
    if (navigating) { setFollow(true); return; }
    if (fixInside) map.current?.flyTo(fixInside.lat, fixInside.lng, 17);
    else showToast(fix ? t('route.outside') : t('route.locationNeeded'), undefined, 'locate');
  };

  const showTopSearch = !navigating && ['explore', 'place', 'layers', 'alert', 'report', 'reportSent', 'community', 'improve'].includes(screen.kind);
  const showPin = screen.kind === 'pick' || screen.kind === 'reportPin';

  // ---- Sheets ----
  const onLayout = setSheetHeight;
  let sheet: React.ReactNode = null;
  if (screen.kind === 'explore') {
    sheet = <ExploreSheet onLayout={onLayout} onOpenPlace={p => openPlace(p)}
      onSaved={() => router.push('/saved')} onPickHome={() => setScreen({ kind: 'search', query: '', purpose: 'home' })}
      onPickWork={() => setScreen({ kind: 'search', query: '', purpose: 'work' })}
      onDiscover={query => setScreen({ kind: 'search', query, purpose: 'go' })}
      onImprove={() => { if (requireSignIn()) setScreen({ kind: 'improve' }); }} />;
  } else if (screen.kind === 'search') {
    sheet = <SearchSheet onLayout={onLayout} initialQuery={screen.query} near={fixInside ?? center}
      onClose={() => setScreen({ kind: 'explore' })}
      onChooseOnMap={() => setScreen({ kind: 'pick', target: 'to' })}
      onSelect={p => {
        if (screen.purpose === 'home') { setHome(p); setScreen({ kind: 'explore' }); return; }
        if (screen.purpose === 'work') { setWork(p); setScreen({ kind: 'explore' }); return; }
        addRecent(p); openPlace(p);
      }} />;
  } else if (screen.kind === 'place') {
    const place = screen.place;
    sheet = <PlaceSheet key={place.id} onLayout={onLayout} place={place} access={access[accessKey(place)]} onDirections={() => openDirections(place)}
      onSuggest={() => { if (requireSignIn()) setScreen(suggestFor(place)); }}
      onReportBuilding={async exists => { if (await submitReport('building', exists, place, place.name)) setScreen({ kind: 'reportSent' }); }} />;
  } else if (screen.kind === 'pick') {
    sheet = <PickSheet onLayout={onLayout} title={screen.target === 'to' ? t('search.chooseOnMap') : t('route.yourLocation')}
      hint={t('report.moveMap')} confirm={t('search.pinHere')} onCancel={() => setScreen(screen.target === 'from' ? { kind: 'route' } : { kind: 'explore' })}
      onConfirm={() => {
        if (!inside(center.lng, center.lat)) { showToast(t('nav.outside'), undefined, 'alert-circle'); return; }
        const label = `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
        if (screen.target === 'from' && trip) { setScreen({ kind: 'route' }); plan({ ...trip, from: { ...center, label } }); }
        else openPlace({ id: `pin:${label}`, kind: 'pin', name: t('search.droppedPin'), category: label, lat: center.lat, lng: center.lng }, false);
      }} />;
  } else if (screen.kind === 'route' && trip && !navigating) {
    sheet = <RouteSheet onLayout={onLayout} routes={trip.routes} selected={trip.selected} loading={trip.loading} error={trip.error}
      onSelect={i => setTrip({ ...trip, selected: i })} onRetry={() => plan(trip)}
      onStart={() => { setNavigating(true); setFollow(true); setStartedAt(Date.now()); dismissedClosures.current.clear(); }} />;
  } else if (navigating && closure && screen.kind === 'route') {
    sheet = <ClosureSheet onLayout={onLayout} alert={closure.alert} extraMinutes={closure.extra} busy={busy}
      onContinue={() => {
        dismissedClosures.current.add(closure.alert.id);
        if (closure.route) setTrip(prev => prev && { ...prev, routes: [closure.route!], selected: 0 });
        setClosure(null);
      }}
      onOpen={async () => {
        dismissedClosures.current.add(closure.alert.id);
        await submitReport('road_closure', false, { lat: closure.alert.latitude, lng: closure.alert.longitude }, '', 'navigation');
        setClosure(null);
      }} />;
  } else if (navigating && screen.kind === 'route') {
    sheet = <NavigationSheet onLayout={onLayout} guidance={guidance} onEnd={endTrip} />;
  } else if (screen.kind === 'arrived' && trip) {
    sheet = <ArrivedSheet onLayout={onLayout} destination={trip.to.name} signedIn={!!session} simulated={simulate}
      onSignIn={() => router.push('/account')} onSkip={endTrip}
      onSubmit={async review => {
        try {
          await submitTripReview(trip, route, startedAt, review, guidance.offRoutePoints);
          showToast(t('arrive.thanks'));
          refreshAlerts();
          endTrip();
        } catch (error) {
          showToast(error instanceof Error ? error.message : t('common.error'), undefined, 'alert-circle');
        }
      }} />;
  } else if (screen.kind === 'report') {
    sheet = <ReportSheet onLayout={onLayout} onChoose={chooseReport} onCancel={() => setScreen(navigating ? { kind: 'route' } : { kind: 'explore' })} />;
  } else if (screen.kind === 'reportPin') {
    sheet = <ReportPinSheet onLayout={onLayout} subtitle={`${t(screen.choice.label)} · ${t('report.selectedSection')}`} busy={busy}
      onSend={async note => {
        if (await submitReport(screen.choice.topic, screen.choice.stance, center, note)) setScreen({ kind: 'reportSent' });
      }} />;
  } else if (screen.kind === 'reportSent') {
    sheet = <ReportSentSheet onLayout={onLayout} onDone={() => setScreen({ kind: 'explore' })} />;
  } else if (screen.kind === 'improve') {
    sheet = <ImproveSheet onLayout={onLayout} onChoose={startDrawing} onMine={() => router.push('/suggestions')} onCancel={() => setScreen({ kind: 'explore' })} />;
  } else if (screen.kind === 'draw') {
    sheet = <DrawSheet onLayout={onLayout} mode={screen.choice.draw} points={screen.points}
      onUndo={() => map.current?.undoDraw()} onFinish={() => map.current?.finishDraw()}
      onCancel={() => { map.current?.draw(null); setScreen({ kind: 'improve' }); }} />;
  } else if (screen.kind === 'suggestForm') {
    const form = screen;
    sheet = <SuggestionFormSheet key={`${form.suggestionKind}-${JSON.stringify(form.geometry).length}`} onLayout={onLayout}
      kind={form.suggestionKind} initialName={form.name} busy={busy}
      onKind={k => setScreen({ ...form, suggestionKind: k })}
      onSubmit={(name, notes) => sendSuggestion(form, name, notes)}
      onCancel={() => setScreen(form.back ?? { kind: 'explore' })} />;
  } else if (screen.kind === 'community') {
    const s = screen.suggestion, at = anchor(s.geometry, center);
    sheet = <CommunitySheet onLayout={onLayout} suggestion={s} onClose={() => setScreen({ kind: 'explore' })}
      onDirections={() => openDirections({ id: s.id, kind: 'place', name: s.name, category: t(`kind.${s.kind}` as StringKey), ...at })} />;
  } else if (screen.kind === 'layers') {
    sheet = <LayersSheet onLayout={onLayout} onShowAll={() => { setScreen({ kind: 'explore' }); map.current?.fitCity(); }} onClose={() => setScreen({ kind: 'explore' })} />;
  } else if (screen.kind === 'alert') {
    const alert = screen.alert;
    sheet = <AlertSheet onLayout={onLayout} alert={alert} busy={busy} onClose={() => setScreen({ kind: 'explore' })}
      onVote={async present => {
        if (await submitReport(alert.topic, present, { lat: alert.latitude, lng: alert.longitude })) setScreen({ kind: 'explore' });
      }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F0F1EB' }}>
      <StatusBar style={navigating || settings.basemap === 'satellite' ? 'light' : 'dark'} />
      <MapView
        ref={map}
        config={{
          basemap: settings.basemap, roads: settings.roads, buildings: settings.buildings, places: settings.places, community: settings.community,
          transport: settings.transport, districts: settings.districts, alerts: settings.reports, districtOpacity: settings.districtOpacity,
          debug: settings.developer && settings.mapDebug,
        }}
        alerts={alerts}
        route={routeCoords}
        alternatives={alternatives}
        walkTo={walkTo}
        fitRouteOnChange={screen.kind === 'route' && !navigating}
        markers={markers}
        user={userPosition}
        follow={follow}
        padding={{ top: topPad, bottom: sheetHeight + 20 }}
        onEvent={onMapEvent}
      />

      {showPin ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="location" size={44} color={screen.kind === 'reportPin' ? colors.red : colors.blue} style={{ marginTop: -44 }} />
          </View>
        </View>
      ) : null}

      {showTopSearch ? (
        <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16 }}>
          <View style={top.searchBar}>
            <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: '100%' }} accessibilityRole="search"
              onPress={() => setScreen({ kind: 'search', query: '', purpose: 'go' })}>
              <Ionicons name="search" size={22} color={colors.ink} style={{ marginHorizontal: 14 }} />
              <Text style={{ fontSize: 17, color: colors.ink }}>{t('search.placeholder')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('settings.title')} onPress={() => router.push('/settings')} style={top.avatar}>
              <Ionicons name={session ? 'person' : 'person-outline'} size={20} color={colors.green} />
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10, paddingRight: 12 }}>
            {CHIPS.map(([key, icon]) => (
              <Chip key={key} icon={icon} label={t(`chips.${key}` as StringKey)} onPress={() => setScreen({ kind: 'search', query: CATEGORY_QUERIES[key], purpose: 'go' })} />
            ))}
            <Chip label={t('chips.more')} icon="ellipsis-horizontal" onPress={() => router.push('/districts')} />
          </ScrollView>
          {!online ? <Banner icon="cloud-offline-outline" tone="light" title={t('offline.title')} hint={t('offline.hint')} /> : null}
        </View>
      ) : null}

      {screen.kind === 'route' && trip && !navigating ? (
        <RouteHeader fromLabel={trip.from?.label ?? t('route.yourLocation')} toLabel={trip.to.name} mode={trip.mode}
          onBack={() => { const to = trip.to; setTrip(null); openPlace(to, false); }}
          onPickFrom={() => setScreen({ kind: 'pick', target: 'from' })}
          onMode={mode => plan({ from: trip.from, to: trip.to, dest: trip.dest, mode })} />
      ) : null}

      {navigating ? (
        <NavigationBanner guidance={guidance} simulate={simulate} voice={settings.voice} following={follow}
          onVoice={() => updateSettings({ voice: !settings.voice })} onRecenter={() => setFollow(true)} />
      ) : null}

      {showTopSearch && screen.kind !== 'report' ? (
        <View style={{ position: 'absolute', right: 16, top: insets.top + 126 + (online ? 0 : 64), gap: 12 }}>
          <RoundButton icon="layers-outline" label={t('layers.title')} onPress={() => setScreen({ kind: 'layers' })} />
          <RoundButton icon="locate" label={t('map.myLocation')} tint={colors.blue} onPress={locate} />
        </View>
      ) : null}

      {(showTopSearch || (navigating && screen.kind === 'route' && !closure)) && !['report', 'reportSent', 'improve'].includes(screen.kind) ? (
        <View style={{ position: 'absolute', right: 14, bottom: sheetHeight + 14 }}>
          <RoundButton icon="flag" label={t('report.title')} background={colors.amber} tint={colors.ink} size={52}
            onPress={() => setScreen({ kind: 'report' })} />
        </View>
      ) : null}

      {sheet}

      {toast ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 12, right: 12, top: insets.top + (navigating ? 140 : 66) }}>
          <Banner icon={toast.icon} title={toast.title} hint={toast.hint} />
        </View>
      ) : null}
    </View>
  );
}

async function submitTripReview(trip: Trip, route: Route | null, startedAt: number,
  review: { rating: number; issues: ReviewIssue[]; comment: string }, offRoutePoints: Point[]) {
  await sendReview({
    rating: review.rating, mode: trip.mode, destinationName: trip.to.name, lat: trip.to.lat, lng: trip.to.lng,
    distance: route?.distance, duration: startedAt ? (Date.now() - startedAt) / 1000 : route?.duration,
    issues: review.issues, comment: review.comment,
  });
  // Reviews feed the community model: where the driver left the route is likely where the road was closed.
  const derived: Promise<unknown>[] = [];
  if (review.issues.includes('road_closed')) {
    for (const p of offRoutePoints.slice(0, 3)) derived.push(sendReport({ topic: 'road_closure', stance: true, lat: p.lat, lng: p.lng, source: 'review' }));
  }
  if (review.issues.includes('place_missing')) {
    derived.push(sendReport({ topic: 'building', stance: false, lat: trip.to.lat, lng: trip.to.lng, note: trip.to.name, source: 'review' }));
  }
  await Promise.allSettled(derived);
}

const top = StyleSheet.create({
  searchBar: {
    height: 56, borderRadius: 20, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', marginRight: 7 },
});
