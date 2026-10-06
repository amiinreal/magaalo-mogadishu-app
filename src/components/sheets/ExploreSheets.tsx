import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors } from '../../config';
import { formatAgo, useI18n, type StringKey } from '../../i18n';
import { destinationRating, type MapAlert } from '../../lib/community';
import { searchPlaces, type Place } from '../../lib/search';
import { useApp } from '../../state/AppState';
import { Button, Chip, Row, Sheet, styles, Title, ToggleRow, type IconName } from '../ui';

type SheetProps = { onLayout: (h: number) => void };

export function categoryIcon(category = ''): IconName {
  const c = category.toLowerCase();
  if (c.includes('street') || c.includes('road')) return 'navigate-outline';
  if (c.includes('market') || c.includes('shop') || c.includes('store') || c.includes('mall')) return 'storefront-outline';
  if (c.includes('restaurant') || c.includes('cafe') || c.includes('food')) return 'restaurant-outline';
  if (c.includes('hospital') || c.includes('clinic') || c.includes('pharmacy') || c.includes('doctor')) return 'medkit-outline';
  if (c.includes('school') || c.includes('university') || c.includes('college')) return 'school-outline';
  if (c.includes('worship') || c.includes('mosque')) return 'moon-outline';
  if (c.includes('hotel') || c.includes('guest')) return 'bed-outline';
  if (c.includes('fuel') || c.includes('petrol') || c.includes('gas')) return 'speedometer-outline';
  if (c.includes('bank') || c.includes('atm')) return 'cash-outline';
  if (c.includes('airport') || c.includes('aerodrome')) return 'airplane-outline';
  if (c.includes('beach')) return 'sunny-outline';
  if (c.includes('bus') || c.includes('station')) return 'bus-outline';
  if (c.includes('building')) return 'business-outline';
  return 'location-outline';
}

function capitalize(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }

export function placeSubtitle(place: Place, mogadishu: string) {
  return [capitalize(place.category), place.address || mogadishu].filter(Boolean).join(' · ');
}

// The website's "Around the city · Discover" cards.
const DISCOVER: { query: string; title: StringKey; hint: StringKey; icon: IconName }[] = [
  { query: 'Liido Beach', title: 'discover.liido', hint: 'discover.liidoHint', icon: 'water-outline' },
  { query: 'Bakaaraha Market', title: 'discover.bakaaraha', hint: 'discover.bakaarahaHint', icon: 'storefront-outline' },
  { query: 'Aden Adde International Airport', title: 'discover.airport', hint: 'discover.airportHint', icon: 'airplane-outline' },
];

export function ExploreSheet({ onLayout, onOpenPlace, onSaved, onPickHome, onPickWork, onDiscover, onImprove }: SheetProps & {
  onOpenPlace: (p: Place) => void; onSaved: () => void; onPickHome: () => void; onPickWork: () => void;
  onDiscover: (query: string) => void; onImprove: () => void;
}) {
  const { t } = useI18n();
  const { saved } = useApp();
  return (
    <Sheet onLayout={onLayout}>
      <Title>{t('explore.whereGoing')}</Title>
      <Row icon="home-outline" label={t('explore.home')} hint={saved.home?.name ?? t('explore.homeHint')}
        onPress={() => (saved.home ? onOpenPlace(saved.home) : onPickHome())} />
      <Row icon="briefcase-outline" label={t('explore.work')} hint={saved.work?.name ?? t('explore.workHint')}
        onPress={() => (saved.work ? onOpenPlace(saved.work) : onPickWork())} />
      <Row icon="bookmark-outline" label={t('explore.saved')} hint={t('explore.savedHint')} onPress={onSaved} />
      <Text style={[styles.rowHint, { marginTop: 6, letterSpacing: 1 }]}>{t('discover.title').toUpperCase()}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
        {DISCOVER.map(d => (
          <Pressable key={d.query} accessibilityRole="button" onPress={() => onDiscover(d.query)}
            style={{ width: 150, padding: 12, borderRadius: 14, backgroundColor: colors.soft }}>
            <Ionicons name={d.icon} size={20} color={colors.green} />
            <Text style={[styles.rowLabel, { marginTop: 6 }]} numberOfLines={1}>{t(d.title)}</Text>
            <Text style={styles.rowHint} numberOfLines={2}>{t(d.hint)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Row icon="create-outline" label={t('improve.title')} hint={t('improve.hint')} onPress={onImprove} color={colors.blue} />
    </Sheet>
  );
}

export function SearchSheet({ onLayout, initialQuery, near, onSelect, onChooseOnMap, onClose }: SheetProps & {
  initialQuery: string; near?: { lat: number; lng: number }; onSelect: (p: Place) => void; onChooseOnMap: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const { saved } = useApp();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Place[] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim(), token = ++seq.current;
    if (q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      searchPlaces(q, near).then(r => { if (token === seq.current) { setResults(r); setLoading(false); } });
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const list = results ?? saved.recents;
  return (
    <Sheet onLayout={onLayout} style={{ top: 0, paddingTop: 54 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text style={[styles.title, { flex: 1 }]}>{t('search.title')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.ink} />
        </Pressable>
      </View>
      <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', marginBottom: 6 }]}>
        <Ionicons name="search" size={18} color={colors.muted} style={{ marginRight: 8 }} />
        <TextInput
          autoFocus value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} placeholderTextColor={colors.muted}
          style={{ flex: 1, fontSize: 16, color: colors.ink }} returnKeyType="search" autoCorrect={false}
          onSubmitEditing={() => results?.[0] && onSelect(results[0])}
        />
        {loading ? <ActivityIndicator size="small" color={colors.blue} /> : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
        {!results && saved.recents.length ? <Text style={[styles.rowHint, { marginTop: 8 }]}>{t('search.recent').toUpperCase()}</Text> : null}
        {list.map(p => (
          <Row key={`${p.id}-${p.lat}`} icon={results ? categoryIcon(p.category) : 'time-outline'} label={p.name}
            hint={placeSubtitle(p, t('common.mogadishu'))} onPress={() => onSelect(p)} />
        ))}
        {results && !results.length && !loading ? <Text style={[styles.sub, { marginVertical: 12 }]}>{t('search.noResults', { query: query.trim() })}</Text> : null}
        <Row icon="locate-outline" label={t('search.chooseOnMap')} hint={t('search.chooseOnMapHint')} onPress={onChooseOnMap} />
      </ScrollView>
    </Sheet>
  );
}

export type AccessInfo = { street: string | null; distance: number; source: 'network' | 'device' } | null;

export function PlaceSheet({ onLayout, place, access, onDirections, onSuggest, onReportBuilding }: SheetProps & {
  place: Place; access: AccessInfo | undefined; onDirections: () => void; onSuggest: () => void; onReportBuilding: (exists: boolean) => void;
}) {
  const { t } = useI18n();
  const { isSaved, toggleSaved, setHome, setWork } = useApp();
  const [rating, setRating] = useState<{ average: number; reviews: number } | null>(null);
  useEffect(() => {
    setRating(null);
    destinationRating(place.lat, place.lng).then(setRating).catch(() => {});
  }, [place.lat, place.lng]);
  const saved = isSaved(place);
  const suggestLabel = place.kind === 'road' ? (place.name ? t('suggest.roadCorrection') : t('suggest.streetName')) : t('place.suggest');
  return (
    <Sheet onLayout={onLayout}>
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Title sub={placeSubtitle(place, t('common.mogadishu'))}>{place.name}</Title>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={saved ? t('place.saved') : t('place.save')} onPress={() => toggleSaved(place)} hitSlop={10}>
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={24} color={saved ? colors.blue : colors.ink} />
          </Pressable>
        </View>
        <Text style={[styles.sub, { marginTop: -4, marginBottom: 8 }]}>
          {rating ? t('place.rating', { rating: rating.average.toFixed(1), count: rating.reviews }) : t('place.noReviews')}
        </Text>
        {/* Where this place meets the road network: routes end here, then a short walk to the door. */}
        {place.kind !== 'road' ? (
          <Row icon="git-network-outline" label={access === undefined ? t('place.accessFinding') : access ? (access.street ? t('place.onStreet', { street: access.street }) : t('place.unnamedRoad')) : t('place.noAccess')}
            hint={access ? t('place.accessHint', { m: access.distance }) : undefined} />
        ) : null}
        <Button label={t('place.directions')} icon="navigate" onPress={onDirections} />
        {place.phone ? <Row icon="call-outline" label={place.phone} onPress={() => Linking.openURL(`tel:${place.phone!.replace(/[^\d+]/g, '')}`)} color={colors.blue} /> : null}
        {place.website ? <Row icon="globe-outline" label={place.website.replace(/^https?:\/\//, '')} onPress={() => Linking.openURL(/^https?:/.test(place.website!) ? place.website! : `https://${place.website}`)} color={colors.blue} /> : null}
        {place.openingHours ? <Row icon="time-outline" label={place.openingHours} /> : null}
        <Row icon="create-outline" label={suggestLabel} hint={t('place.suggestHint')} onPress={onSuggest} />
        {place.kind === 'building' ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Chip label={t('suggest.exists')} icon="checkmark" onPress={() => onReportBuilding(true)} />
            <Chip label={t('suggest.notExists')} icon="close" onPress={() => onReportBuilding(false)} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label={t('place.setHome')} icon="home-outline" onPress={() => setHome(place)} />
          <Chip label={t('place.setWork')} icon="briefcase-outline" onPress={() => setWork(place)} />
        </View>
        {place.source ? <Text style={[styles.rowHint, { marginTop: 10 }]}>{place.source}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

export function PickSheet({ onLayout, title, hint, confirm, onConfirm, onCancel }: SheetProps & {
  title: string; hint: string; confirm: string; onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={hint}>{title}</Title>
      <Button label={confirm} onPress={onConfirm} />
      <View style={{ alignItems: 'center' }}><Pressable onPress={onCancel} style={{ padding: 10 }}><Text style={styles.sub}>{t('common.cancel')}</Text></Pressable></View>
    </Sheet>
  );
}

export function LayersSheet({ onLayout, onClose }: SheetProps & { onClose: () => void }) {
  const { t } = useI18n();
  const { settings, updateSettings } = useApp();
  return (
    <Sheet onLayout={onLayout}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[styles.title, { flex: 1 }]}>{t('layers.title')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={12}>
          <Ionicons name="close-circle" size={28} color={colors.muted} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
        <Chip label={t('layers.street')} icon="map-outline" active={settings.basemap === 'street'} onPress={() => updateSettings({ basemap: 'street' })} />
        <Chip label={t('layers.satellite')} icon="earth-outline" active={settings.basemap === 'satellite'} onPress={() => updateSettings({ basemap: 'satellite' })} />
      </View>
      <ScrollView style={{ maxHeight: 380 }}>
        <ToggleRow icon="grid-outline" label={t('layers.districts')} hint={t('layers.districtsHint')} value={settings.districts} onChange={v => updateSettings({ districts: v })} />
        {settings.districts ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 30, marginBottom: 6, gap: 10 }}>
            <Text style={[styles.rowHint, { flex: 1 }]}>{t('layers.intensity', { p: settings.districtOpacity })}</Text>
            <Chip label="−" onPress={() => updateSettings({ districtOpacity: Math.max(0, settings.districtOpacity - 8) })} />
            <Chip label="+" onPress={() => updateSettings({ districtOpacity: Math.min(80, settings.districtOpacity + 8) })} />
          </View>
        ) : null}
        <ToggleRow icon="git-network-outline" label={t('layers.roads')} hint={t('layers.roadsHint')} value={settings.roads} onChange={v => updateSettings({ roads: v })} />
        <ToggleRow icon="business-outline" label={t('layers.buildings')} hint={t('layers.buildingsHint')} value={settings.buildings} onChange={v => updateSettings({ buildings: v })} />
        <ToggleRow icon="storefront-outline" label={t('layers.places')} hint={t('layers.placesHint')} value={settings.places} onChange={v => updateSettings({ places: v })} />
        <ToggleRow icon="people-outline" label={t('layers.community')} hint={t('layers.communityHint')} value={settings.community} onChange={v => updateSettings({ community: v })} />
        <ToggleRow icon="bus-outline" label={t('layers.transport')} hint={t('layers.transportHint')} value={settings.transport} onChange={v => updateSettings({ transport: v })} />
        <ToggleRow icon="flag-outline" label={t('layers.reports')} hint={t('layers.reportsHint')} value={settings.reports} onChange={v => updateSettings({ reports: v })} />
      </ScrollView>
    </Sheet>
  );
}

export const ALERT_TITLE: Record<string, StringKey> = {
  road_closure: 'alert.road_closure', flooding: 'alert.flooding', traffic: 'alert.traffic', hazard: 'alert.hazard', building: 'alert.building',
};

export function alertTitle(alert: MapAlert, t: (k: StringKey) => string) {
  return alert.topic === 'building' && !alert.stance ? t('alert.buildingGone') : t(ALERT_TITLE[alert.topic] ?? 'alert.hazard');
}

export function AlertSheet({ onLayout, alert, onVote, onClose, busy }: SheetProps & {
  alert: MapAlert; onVote: (present: boolean) => void; onClose: () => void; busy: boolean;
}) {
  const { t, lang } = useI18n();
  const confirmed = alert.status === 'confirmed';
  const count = alert.stance ? alert.supporters : alert.deniers;
  return (
    <Sheet onLayout={onLayout}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Title sub={`${confirmed ? t('alert.confirmed', { n: count }) : t('alert.suspected')} · ${t('alert.confidence', { p: Math.round(alert.probability * 100) })}`}>
            {alertTitle(alert, t)}
          </Title>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={12}>
          <Ionicons name="close-circle" size={28} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={[styles.sub, { marginTop: -4, marginBottom: 12 }]}>{t('alert.updated', { ago: formatAgo(lang, alert.last_reported_at) })}</Text>
      <Text style={[styles.rowLabel, { marginBottom: 10 }]}>{t('alert.stillThere')}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {/* For a "building gone" alert, "still there" means it is still gone, i.e. stance=false. */}
        <Button style={{ flex: 1 }} label={t('alert.yes')} busy={busy} onPress={() => onVote(alert.stance)} />
        <Button style={{ flex: 1 }} variant="secondary" label={t('alert.no')} disabled={busy} onPress={() => onVote(!alert.stance)} />
      </View>
    </Sheet>
  );
}
