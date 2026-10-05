import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapView, type MapEvent, type MapHandle, type MapMarker, type TransportOverlay } from '../components/MapView';
import { AlertSheet, ExploreSheet, LayersSheet, PickSheet, PlaceSheet, SearchSheet } from '../components/sheets/ExploreSheets';
import { REPORT_CHOICES, ReportPinSheet, ReportSentSheet, ReportSheet, SuggestSheet, type ReportChoice } from '../components/sheets/ReportSheets';
import { ArrivedSheet, ClosureSheet, NavigationBanner, NavigationSheet, RouteHeader, RouteSheet } from '../components/sheets/TripSheets';
import { Banner, Chip, RoundButton, type IconName } from '../components/ui';
import { CITY_CENTER, colors } from '../config';
import { useI18n, type StringKey } from '../i18n';
import { sendReport, sendReview, type MapAlert, type ReviewIssue, type Topic } from '../lib/community';
import { inside, type Point } from '../lib/geo';
import { useGuidance } from '../lib/guidance';
import { useAlerts, useDeviceLocation, useOnline } from '../lib/hooks';
import { planRoute, type Mode, type Route } from '../lib/routing';
import { CATEGORY_QUERIES, type Place } from '../lib/search';
import { supabase } from '../lib/supabase';
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
  | { kind: 'suggest'; place: Place }
  | { kind: 'layers' }
  | { kind: 'alert'; alert: MapAlert };

type Trip = { from: (Point & { label: string }) | null; to: Place; mode: Mode; routes: Route[]; selected: number; loading: boolean; error?: string };
type Closure = { alert: MapAlert; route: Route | null; extra: number | null };

const CHIPS: [keyof typeof CATEGORY_QUERIES, IconName][] = [
  ['restaurants', 'restaurant-outline'], ['petrol', 'speedometer-outline'], ['markets', 'storefront-outline'],
  ['hospitals', 'medkit-outline'], ['mosques', 'moon-outline'], ['hotels', 'bed-outline'], ['banks', 'cash-outline'],
];

function KeepAwake() { useKeepAwake(); return null; }

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
  const [transport, setTransport] = useState<TransportOverlay[]>([]);
  const dismissedClosures = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((title: string, hint?: string, icon: IconName = 'checkmark-circle') => {
    clearTimeout(toastTimer.current);
    setToast({ title, hint, icon });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const route = trip?.routes[trip.selected] ?? null;
  const simulate = settings.developer && settings.simulate;
  const fixInside = fix && inside(fix.lng, fix.lat) ? fix : null;

  // ---- Routing ----
  const plan = useCallback(async (next: Omit<Trip, 'routes' | 'selected' | 'loading'>) => {
    const from = next.from ?? (fixInside ? { lat: fixInside.lat, lng: fixInside.lng, label: t('route.yourLocation') } : null);
    if (!from) {
      setTrip({ ...next, routes: [], selected: 0, loading: false, error: fix ? t('route.outside') : t('route.locationNeeded') });
      return;
    }
    setTrip({ ...next, routes: [], selected: 0, loading: true });
    try {
      const routes = await planRoute(from, next.to, next.mode, alerts);
      setTrip({ ...next, routes, selected: 0, loading: false });
    } catch {
      setTrip({ ...next, routes: [], selected: 0, loading: false, error: t('route.failed') });
    }
  }, [fixInside?.lat, fixInside?.lng, fix, alerts, t]);

  const openDirections = (place: Place) => {
    addRecent(place);
    setScreen({ kind: 'route' });
    plan({ from: trip?.from ?? null, to: place, mode: trip?.mode ?? 'driving' });
  };

  const guidance = useGuidance({
    route, mode: trip?.mode ?? 'driving', active: navigating, simulate, lang, voice: settings.voice, alerts,
    onReroute: async from => {
      if (!trip) return;
      try {
        const routes = await planRoute(from, trip.to, trip.mode, alerts);
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
    planRoute(from, trip.to, trip.mode, alerts).then(([r]) => {
      setClosure(c => c && { ...c, route: r, extra: Math.round((r.duration - guidance.etaSeconds) / 60) });
    }).catch(() => setClosure(c => c && { ...c, extra: 0 }));
  }, [guidance.closureAhead?.id, navigating]);

  // ---- Intents from other screens (saved places, districts) ----
  useFocusEffect(useCallback(() => {
    if (!mapIntent) return;
    if (mapIntent.type === 'place') { setScreen({ kind: 'place', place: mapIntent.place }); map.current?.flyTo(mapIntent.place.lat, mapIntent.place.lng, 16); }
    else { updateSettings({ districts: true }); map.current?.fitDistrict(mapIntent.name); setScreen({ kind: 'explore' }); }
    setMapIntent(null);
  }, [mapIntent]));

  // ---- Transport overlay ----
  useEffect(() => {
    if (!settings.transport) { setTransport([]); return; }
    supabase.from('transport_routes').select('geometry, transport_stops(name, latitude, longitude, stop_order)').eq('active', true)
      .then(({ data }) => setTransport((data ?? []).map(r => ({ geometry: r.geometry, stops: (r.transport_stops ?? []) as TransportOverlay['stops'] }))));
  }, [settings.transport]);

  // ---- Reports ----
  const submitReport = async (topic: Topic, stance: boolean, at: Point, note = '', source: 'manual' | 'navigation' = 'manual') => {
    if (!session) { router.push('/account'); return false; }
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

  const startReport = () => {
    if (!session) { router.push('/account'); return; }
    setScreen({ kind: 'report' });
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

  const endTrip = () => {
    setNavigating(false); setFollow(false); setClosure(null);
    setTrip(null); setScreen({ kind: 'explore' });
  };

  // ---- Map events ----
  const onMapEvent = (e: MapEvent) => {
    switch (e.type) {
      case 'center': setCenter({ lat: e.lat, lng: e.lng }); break;
      case 'unfollow': setFollow(false); break;
      case 'alternative': setTrip(prev => prev && { ...prev, selected: e.index < prev.selected ? e.index : e.index + 1 }); break;
      case 'alert': {
        const alert = alerts.find(a => a.id === e.id);
        if (alert && !navigating) setScreen({ kind: 'alert', alert });
        break;
      }
      case 'longpress':
        if (!navigating && ['explore', 'place', 'layers', 'alert'].includes(screen.kind)) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setScreen({ kind: 'place', place: { id: `pin:${e.lat},${e.lng}`, name: t('search.droppedPin'), category: `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`, lat: e.lat, lng: e.lng } });
        }
        break;
      case 'feature':
        if (!navigating && ['explore', 'place', 'layers', 'alert'].includes(screen.kind)) {
          const building = e.group === 'buildings';
          setScreen({ kind: 'place', place: {
            id: e.id, name: e.name || (building ? t('layers.buildings') : t('layers.roadNames')),
            category: building ? 'building' : (e.props?.highway ? `${e.props.highway} street` : 'street'), lat: e.lat, lng: e.lng,
          } });
        }
        break;
      case 'press':
        if (['place', 'layers', 'alert'].includes(screen.kind)) setScreen({ kind: 'explore' });
        break;
    }
  };

  // ---- What the map shows ----
  const markers = useMemo<MapMarker[]>(() => {
    if (screen.kind === 'place' || screen.kind === 'suggest') return [{ id: 'dest', kind: 'destination', lat: screen.place.lat, lng: screen.place.lng }];
    if (!trip || !['route', 'arrived'].includes(screen.kind) && !navigating) return [];
    const out: MapMarker[] = [{ id: 'dest', kind: 'destination', lat: trip.to.lat, lng: trip.to.lng }];
    if (trip.from && !navigating) out.push({ id: 'start', kind: 'start', lat: trip.from.lat, lng: trip.from.lng });
    return out;
  }, [screen, trip, navigating]);

  const showRoute = !!trip && (screen.kind === 'route' || navigating);
  const routeCoords = showRoute ? route?.coords ?? null : null;
  const alternatives = useMemo(() => (showRoute && !navigating && trip ? trip.routes.filter((_, i) => i !== trip.selected).map(r => r.coords) : []), [showRoute, navigating, trip]);
  const userPosition = navigating && guidance.position ? guidance.position : fix ? { lat: fix.lat, lng: fix.lng, heading: fix.heading, accuracy: fix.accuracy } : null;
  const topPad = insets.top + (navigating ? 150 : screen.kind === 'route' ? 130 : 110);

  const locate = () => {
    if (navigating) { setFollow(true); return; }
    if (fixInside) map.current?.flyTo(fixInside.lat, fixInside.lng, 16);
    else showToast(fix ? t('route.outside') : t('route.locationNeeded'), undefined, 'locate');
  };

  const showTopSearch = !navigating && ['explore', 'place', 'layers', 'alert', 'report', 'reportSent'].includes(screen.kind);
  const showPin = screen.kind === 'pick' || screen.kind === 'reportPin';

  // ---- Sheets ----
  const onLayout = setSheetHeight;
  let sheet: React.ReactNode = null;
  if (screen.kind === 'explore') {
    sheet = <ExploreSheet onLayout={onLayout} onOpenPlace={p => { setScreen({ kind: 'place', place: p }); map.current?.flyTo(p.lat, p.lng, 16); }}
      onSaved={() => router.push('/saved')} onPickHome={() => setScreen({ kind: 'search', query: '', purpose: 'home' })}
      onPickWork={() => setScreen({ kind: 'search', query: '', purpose: 'work' })} />;
  } else if (screen.kind === 'search') {
    sheet = <SearchSheet onLayout={onLayout} initialQuery={screen.query} near={fixInside ?? center}
      onClose={() => setScreen({ kind: 'explore' })}
      onChooseOnMap={() => setScreen({ kind: 'pick', target: 'to' })}
      onSelect={p => {
        if (screen.purpose === 'home') { setHome(p); setScreen({ kind: 'explore' }); return; }
        if (screen.purpose === 'work') { setWork(p); setScreen({ kind: 'explore' }); return; }
        addRecent(p); setScreen({ kind: 'place', place: p }); map.current?.flyTo(p.lat, p.lng, 16);
      }} />;
  } else if (screen.kind === 'place') {
    sheet = <PlaceSheet onLayout={onLayout} place={screen.place} onDirections={() => openDirections(screen.place)}
      onSuggest={() => setScreen({ kind: 'suggest', place: screen.place })} />;
  } else if (screen.kind === 'pick') {
    sheet = <PickSheet onLayout={onLayout} title={screen.target === 'to' ? t('search.chooseOnMap') : t('route.yourLocation')}
      hint={t('report.moveMap')} confirm={t('search.pinHere')} onCancel={() => setScreen(screen.target === 'from' ? { kind: 'route' } : { kind: 'explore' })}
      onConfirm={() => {
        if (!inside(center.lng, center.lat)) { showToast(t('nav.outside'), undefined, 'alert-circle'); return; }
        const label = `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
        if (screen.target === 'from' && trip) { setScreen({ kind: 'route' }); plan({ ...trip, from: { ...center, label } }); }
        else setScreen({ kind: 'place', place: { id: `pin:${label}`, name: t('search.droppedPin'), category: label, lat: center.lat, lng: center.lng } });
      }} />;
  } else if (screen.kind === 'route' && trip && !navigating) {
    sheet = <RouteSheet onLayout={onLayout} routes={trip.routes} selected={trip.selected} loading={trip.loading} error={trip.error}
      onSelect={i => setTrip({ ...trip, selected: i })} onRetry={() => plan(trip)}
      onStart={() => { setNavigating(true); setFollow(true); setStartedAt(Date.now()); dismissedClosures.current.clear(); }} />;
  } else if (navigating && closure && (screen.kind === 'route')) {
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
  } else if (screen.kind === 'suggest') {
    const at = { lat: screen.place.lat, lng: screen.place.lng };
    sheet = <SuggestSheet onLayout={onLayout} name={screen.place.name} busy={busy}
      onExists={async () => { if (await submitReport('building', true, at, screen.place.name)) setScreen({ kind: 'reportSent' }); }}
      onMissing={async () => { if (await submitReport('building', false, at, screen.place.name)) setScreen({ kind: 'reportSent' }); }}
      onAddMissing={() => { map.current?.flyTo(at.lat, at.lng, 18); setScreen({ kind: 'reportPin', choice: REPORT_CHOICES.find(c => c.topic === 'building')! }); }} />;
  } else if (screen.kind === 'layers') {
    sheet = <LayersSheet onLayout={onLayout} onClose={() => setScreen({ kind: 'explore' })} />;
  } else if (screen.kind === 'alert') {
    const alert = screen.alert;
    sheet = <AlertSheet onLayout={onLayout} alert={alert} busy={busy} onClose={() => setScreen({ kind: 'explore' })}
      onVote={async present => {
        if (await submitReport(alert.topic, present, { lat: alert.latitude, lng: alert.longitude })) setScreen({ kind: 'explore' });
      }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#eef1ed' }}>
      <StatusBar style={navigating ? 'light' : 'dark'} />
      {navigating ? <KeepAwake /> : null}
      <MapView
        ref={map}
        config={{ basemap: settings.basemap, districts: settings.districts, buildings: settings.buildings, roadNames: settings.roadNames, reports: settings.reports, debug: settings.developer && settings.mapDebug }}
        alerts={alerts}
        route={routeCoords}
        alternatives={alternatives}
        fitRouteOnChange={screen.kind === 'route' && !navigating}
        markers={markers}
        user={userPosition}
        follow={follow}
        padding={{ top: topPad, bottom: sheetHeight + 20 }}
        transport={transport}
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
        <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12 }}>
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
          onBack={() => { setTrip(null); setScreen({ kind: 'place', place: trip.to }); }}
          onPickFrom={() => setScreen({ kind: 'pick', target: 'from' })}
          onMode={mode => plan({ from: trip.from, to: trip.to, mode })} />
      ) : null}

      {navigating ? (
        <NavigationBanner guidance={guidance} simulate={simulate} voice={settings.voice} following={follow}
          onVoice={() => updateSettings({ voice: !settings.voice })} onRecenter={() => setFollow(true)} />
      ) : null}

      {showTopSearch && screen.kind !== 'report' ? (
        <View style={{ position: 'absolute', right: 14, top: insets.top + 120 + (online ? 0 : 64), gap: 12 }}>
          <RoundButton icon="layers-outline" label={t('layers.title')} onPress={() => setScreen({ kind: 'layers' })} />
          <RoundButton icon="locate" label="My location" tint={colors.blue} onPress={locate} />
        </View>
      ) : null}

      {(showTopSearch || (navigating && screen.kind === 'route' && !closure)) && screen.kind !== 'report' && screen.kind !== 'reportSent' ? (
        <View style={{ position: 'absolute', right: 14, bottom: sheetHeight + 14 }}>
          <RoundButton icon="flag" label={t('report.title')} background={colors.amber} tint={colors.ink} size={52} onPress={startReport} />
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
    height: 56, borderRadius: 28, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', marginRight: 7 },
});


