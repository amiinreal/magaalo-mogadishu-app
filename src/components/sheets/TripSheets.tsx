import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { Text } from '../Typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../config';
import { formatAgo, formatClock, formatDistance, useI18n } from '../../i18n';
import type { MapAlert, ReviewIssue } from '../../lib/community';
import type { Guidance } from '../../lib/guidance';
import { maneuverIcon } from '../../lib/instructions';
import type { Mode, Route } from '../../lib/routing';
import { Button, Chip, LinkButton, RoundButton, Sheet, Stars, styles, Title, type IconName } from '../ui';

type SheetProps = { onLayout: (h: number) => void };
const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

export function RouteHeader({ fromLabel, toLabel, mode, onMode, onBack, onPickFrom }: {
  fromLabel: string; toLabel: string; mode: Mode; onMode: (m: Mode) => void; onBack: () => void; onPickFrom: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const modes: [Mode, string, IconName][] = [['driving', t('route.drive'), 'car-outline'], ['walking', t('route.walk'), 'walk-outline'], ['cycling', t('route.cycle'), 'bicycle-outline']];
  return (
    <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16 }}>
      <View style={[styles.banner, { backgroundColor: '#fff', alignItems: 'center' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} hitSlop={10} style={{ marginRight: 10 }}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Pressable onPress={onPickFrom} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: colors.blue, marginRight: 10 }} />
            <Text style={{ color: colors.muted, fontSize: 14 }} numberOfLines={1}>{fromLabel}</Text>
          </Pressable>
          <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 20 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
            <Ionicons name="location" size={14} color={colors.red} style={{ marginRight: 8, marginLeft: -2 }} />
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{toLabel}</Text>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {modes.map(([m, label, icon]) => <Chip key={m} label={label} icon={icon} active={mode === m} onPress={() => onMode(m)} />)}
      </View>
    </View>
  );
}

export function RouteSheet({ onLayout, routes, selected, loading, error, onSelect, onStart, onRetry }: SheetProps & {
  routes: Route[]; selected: number; loading: boolean; error?: string; onSelect: (i: number) => void; onStart: () => void; onRetry: () => void;
}) {
  const { t, lang } = useI18n();
  const route = routes[selected];
  if (loading || !route) {
    return (
      <Sheet onLayout={onLayout}>
        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 18 }}>
            <ActivityIndicator color={colors.blue} /><Text style={[styles.rowLabel, { marginLeft: 12 }]}>{t('route.finding')}</Text>
          </View>
        ) : (
          <><Text style={[styles.sub, { marginBottom: 12 }]}>{error || t('route.failed')}</Text><Button label={t('common.retry')} icon="refresh" onPress={onRetry} /></>
        )}
      </Sheet>
    );
  }
  const arrive = formatClock(new Date(Date.now() + route.duration * 1000));
  const note = route.avoided === 1 ? t('route.avoidsClosure') : route.avoided > 1 ? t('route.avoidsClosures', { n: route.avoided }) : t('route.fastest');
  return (
    <Sheet onLayout={onLayout}>
      <Text style={[styles.title, { fontSize: 26 }]}>{t('route.minutes', { n: minutes(route.duration) })}</Text>
      <Text style={styles.sub}>{formatDistance(lang, route.distance)} · {t('route.arriveAt', { time: arrive })}</Text>
      <Text style={[styles.sub, { color: route.avoided ? colors.green : colors.muted, fontWeight: '600', marginBottom: 12 }]}>{note}</Text>
      <Button label={t('route.start')} icon="navigate" onPress={onStart} />
      {routes.map((r, i) => i === selected ? null : (
        <Pressable key={i} onPress={() => onSelect(i)} style={{ padding: 14, marginTop: 10, borderRadius: 14, backgroundColor: colors.soft }} accessibilityRole="button">
          <Text style={styles.rowHint}>{t('route.alternative', { min: minutes(r.duration), distance: formatDistance(lang, r.distance) })}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

export function NavigationBanner({ guidance, simulate, voice, onVoice, onRecenter, following }: {
  guidance: Guidance; simulate: boolean; voice: boolean; onVoice: () => void; onRecenter: () => void; following: boolean;
}) {
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const status = guidance.status;
  const title = status === 'ok' ? formatDistance(lang, guidance.distanceToNext)
    : status === 'offroute' ? t('nav.rerouting') : status === 'outside' ? t('nav.outside')
    : status === 'weak' ? t('nav.gpsWeak', { m: Math.round(guidance.position?.accuracy ?? 0) }) : t('nav.waitingGps');
  return (
    <>
      <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, backgroundColor: colors.green, borderRadius: 20, padding: 20, elevation: 8 }}
        accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name={(status === 'ok' ? maneuverIcon(guidance.nextStep) : 'navigate') as IconName} size={42} color="#fff" style={{ marginRight: 14 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 32, fontWeight: '800' }}>{title}</Text>
            <Text style={{ color: 'rgba(255,255,255,.85)', fontSize: 15, marginTop: 2 }} numberOfLines={2}>
              {status === 'offroute' ? t('nav.offRoute') : guidance.instruction || t('instr.follow')}
            </Text>
          </View>
        </View>
        {simulate ? <Text style={{ color: colors.amber, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{t('nav.simulating').toUpperCase()}</Text> : null}
      </View>
      <View style={{ position: 'absolute', right: 14, top: insets.top + 150, gap: 12 }}>
        <RoundButton icon={voice ? 'volume-high' : 'volume-mute'} label={t('settings.voice')} onPress={onVoice} />
        {!following ? <RoundButton icon="locate" label={t('map.myLocation')} onPress={onRecenter} tint={colors.blue} /> : null}
      </View>
    </>
  );
}

export function NavigationSheet({ onLayout, guidance, onEnd }: SheetProps & { guidance: Guidance; onEnd: () => void }) {
  const { t, lang } = useI18n();
  const arrival = formatClock(new Date(Date.now() + guidance.etaSeconds * 1000));
  return (
    <Sheet onLayout={onLayout}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { fontSize: 24 }]}>{t('route.minutes', { n: minutes(guidance.etaSeconds) })}</Text>
          <Text style={styles.sub}>{t('nav.arrival', { distance: formatDistance(lang, guidance.remaining), time: arrival })}</Text>
        </View>
        <Button label={t('nav.end')} variant="dark" onPress={onEnd} style={{ width: 120 }} />
      </View>
    </Sheet>
  );
}

export function ClosureSheet({ onLayout, alert, extraMinutes, onContinue, onOpen, busy }: SheetProps & {
  alert: MapAlert; extraMinutes: number | null; onContinue: () => void; onOpen: () => void; busy: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={t('closure.reportedBy', { n: alert.supporters, ago: formatAgo(lang, alert.last_reported_at) })}>{t('closure.ahead')}</Title>
      <Text style={[styles.rowLabel, { fontWeight: '500', marginBottom: 12 }]}>{t('closure.newRoute')}</Text>
      <Button label={extraMinutes == null ? t('nav.rerouting') : t('closure.continue', { n: Math.max(0, extraMinutes) })} busy={extraMinutes == null} onPress={onContinue} />
      <Pressable onPress={onOpen} disabled={busy} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12 }}>
        <Ionicons name="git-merge-outline" size={20} color={colors.ink} style={{ width: 30 }} />
        <View>
          <Text style={styles.rowLabel}>{t('closure.isOpen')}</Text>
          <Text style={styles.rowHint}>{t('closure.letOthers')}</Text>
        </View>
      </Pressable>
    </Sheet>
  );
}

const ISSUES: ReviewIssue[] = ['road_closed', 'wrong_turn', 'place_missing', 'traffic', 'bad_road', 'unsafe'];

export function ArrivedSheet({ onLayout, destination, signedIn, simulated, onSubmit, onSkip, onSignIn }: SheetProps & {
  destination: string; signedIn: boolean; simulated: boolean;
  onSubmit: (review: { rating: number; issues: ReviewIssue[]; comment: string }) => Promise<void>; onSkip: () => void; onSignIn: () => void;
}) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSend = signedIn && !simulated;
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={destination}>{t('arrive.title')}</Title>
      <Text style={[styles.sub, { marginTop: -6, marginBottom: 10 }]}>{t('arrive.question')}</Text>
      <Stars value={rating} onChange={setRating} />
      {rating > 0 && rating < 5 ? (
        <>
          <Text style={[styles.rowHint, { marginTop: 12, marginBottom: 6 }]}>{t('arrive.issues')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {ISSUES.map(issue => (
              <Chip key={issue} label={t(`issue.${issue}`)} active={issues.includes(issue)}
                onPress={() => setIssues(list => list.includes(issue) ? list.filter(x => x !== issue) : [...list, issue])} />
            ))}
          </View>
        </>
      ) : null}
      {showComment ? (
        <TextInput value={comment} onChangeText={setComment} placeholder={t('arrive.comment')} placeholderTextColor={colors.muted}
          multiline maxLength={1000} style={[styles.TextInput, { height: 70, marginTop: 12, paddingTop: 10, textAlignVertical: 'top' }]} />
      ) : <LinkButton label={t('arrive.comment')} onPress={() => setShowComment(true)} />}
      {!signedIn ? <Text style={[styles.rowHint, { marginVertical: 6 }]}>{t('arrive.signIn')}</Text> : null}
      <Button
        style={{ marginTop: 8 }}
        label={signedIn ? t('arrive.done') : t('account.signIn')}
        busy={busy}
        disabled={signedIn && !rating}
        onPress={async () => {
          if (!signedIn) { onSignIn(); return; }
          if (!canSend) { onSkip(); return; }
          setBusy(true);
          try { await onSubmit({ rating, issues, comment }); } finally { setBusy(false); }
        }}
      />
      <View style={{ alignItems: 'center' }}><LinkButton label={t('arrive.skip')} color={colors.muted} onPress={onSkip} /></View>
    </Sheet>
  );
}
