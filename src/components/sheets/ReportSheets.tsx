import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { colors } from '../../config';
import { useI18n, type StringKey } from '../../i18n';
import type { SuggestionKind, Topic } from '../../lib/community';
import type { DrawMode } from '../MapView';
import { Button, Chip, LinkButton, Row, Sheet, styles, Title, type IconName } from '../ui';

type SheetProps = { onLayout: (h: number) => void };

export type ReportChoice = { topic: Topic; stance: boolean; label: StringKey; icon: IconName };

export const REPORT_CHOICES: ReportChoice[] = [
  { topic: 'road_closure', stance: true, label: 'report.roadClosed', icon: 'remove-circle-outline' },
  { topic: 'road_closure', stance: false, label: 'report.roadOpen', icon: 'checkmark' },
  { topic: 'building', stance: true, label: 'report.building', icon: 'business-outline' },
  { topic: 'traffic', stance: true, label: 'report.traffic', icon: 'car-outline' },
  { topic: 'flooding', stance: true, label: 'report.flooding', icon: 'water-outline' },
  { topic: 'hazard', stance: true, label: 'report.other', icon: 'flag-outline' },
];

export function ReportSheet({ onLayout, onChoose, onCancel }: SheetProps & { onChoose: (c: ReportChoice) => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet onLayout={onLayout}>
      <Title>{t('report.title')}</Title>
      {REPORT_CHOICES.map(c => <Row key={c.label} icon={c.icon} label={t(c.label)} onPress={() => onChoose(c)} />)}
      <Text style={[styles.rowHint, { marginTop: 4 }]}>{t('report.safety')}</Text>
      <View style={{ alignItems: 'center' }}><LinkButton label={t('common.cancel')} color={colors.muted} onPress={onCancel} /></View>
    </Sheet>
  );
}

export function ReportPinSheet({ onLayout, subtitle, busy, onSend }: SheetProps & {
  subtitle: string; busy: boolean; onSend: (note: string) => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={subtitle}>{t('report.rightSpot')}</Title>
      <Text style={[styles.rowLabel, { fontWeight: '500', marginBottom: 12 }]}>{t('report.moveMap')}</Text>
      {showNote ? (
        <TextInput value={note} onChangeText={setNote} placeholder={t('report.addNote')} placeholderTextColor={colors.muted}
          maxLength={500} style={[styles.input, { marginBottom: 12 }]} />
      ) : null}
      <Button label={busy ? t('report.sending') : t('report.send')} busy={busy} onPress={() => onSend(note)} />
      {!showNote ? <LinkButton label={t('report.addNote')} onPress={() => setShowNote(true)} /> : null}
    </Sheet>
  );
}

export function ReportSentSheet({ onLayout, onDone }: SheetProps & { onDone: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet onLayout={onLayout}>
      <Title>{t('report.keepExploring')}</Title>
      <Button label={t('report.backToMap')} onPress={onDone} />
      <Text style={[styles.rowHint, { marginTop: 8 }]}>{t('report.noSteps')}</Text>
    </Sheet>
  );
}

// ---------------- Moderated suggestions: the website's "Improve the public map" flow ----------------
export type SuggestChoice = { kind: SuggestionKind; draw: DrawMode; label: StringKey; hint: StringKey; icon: IconName };
export const SUGGEST_CHOICES: SuggestChoice[] = [
  { kind: 'street_name', draw: 'LineString', label: 'improve.street', hint: 'improve.streetHint', icon: 'git-commit-outline' },
  { kind: 'missing_building', draw: 'Polygon', label: 'improve.building', hint: 'improve.buildingHint', icon: 'business-outline' },
  { kind: 'business', draw: 'Point', label: 'improve.business', hint: 'improve.businessHint', icon: 'storefront-outline' },
  { kind: 'transport_stop', draw: 'Point', label: 'improve.stop', hint: 'improve.stopHint', icon: 'bus-outline' },
  { kind: 'road_issue', draw: 'LineString', label: 'improve.roadIssue', hint: 'improve.roadIssueHint', icon: 'git-network-outline' },
];

export function ImproveSheet({ onLayout, onChoose, onMine, onCancel }: SheetProps & { onChoose: (c: SuggestChoice) => void; onMine: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={t('improve.reviewed')}>{t('improve.title')}</Title>
      {SUGGEST_CHOICES.map(c => <Row key={c.kind} icon={c.icon} label={t(c.label)} hint={t(c.hint)} onPress={() => onChoose(c)} />)}
      <Row icon="list-outline" label={t('improve.mine')} onPress={onMine} color={colors.blue} />
      <View style={{ alignItems: 'center' }}><LinkButton label={t('common.cancel')} color={colors.muted} onPress={onCancel} /></View>
    </Sheet>
  );
}

export function DrawSheet({ onLayout, mode, points, onUndo, onFinish, onCancel }: SheetProps & {
  mode: DrawMode; points: number; onUndo: () => void; onFinish: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const needed = mode === 'Polygon' ? 3 : mode === 'LineString' ? 2 : 1;
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={t('draw.points', { n: points })}>{t(mode === 'Point' ? 'draw.point' : mode === 'LineString' ? 'draw.line' : 'draw.polygon')}</Title>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button style={{ flex: 1 }} variant="secondary" icon="arrow-undo" label={t('draw.undo')} disabled={!points} onPress={onUndo} />
        {mode !== 'Point' ? <Button style={{ flex: 1 }} label={t('draw.finish')} disabled={points < needed} onPress={onFinish} /> : null}
      </View>
      <View style={{ alignItems: 'center' }}><LinkButton label={t('common.cancel')} color={colors.muted} onPress={onCancel} /></View>
    </Sheet>
  );
}

export function SuggestionFormSheet({ onLayout, kind, initialName, busy, onKind, onSubmit, onCancel }: SheetProps & {
  kind: SuggestionKind; initialName: string; busy: boolean; onKind: (k: SuggestionKind) => void;
  onSubmit: (name: string, notes: string) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState('');
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={t('improve.reviewed')}>{t('suggestion.title')}</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {SUGGEST_CHOICES.map(c => <Chip key={c.kind} label={t(`kind.${c.kind}` as StringKey)} active={kind === c.kind} onPress={() => onKind(c.kind)} />)}
      </View>
      <TextInput value={name} onChangeText={setName} placeholder={t('suggestion.name')} placeholderTextColor={colors.muted} maxLength={140}
        style={[styles.input, { marginBottom: 8 }]} />
      <TextInput value={notes} onChangeText={setNotes} placeholder={t('suggestion.notes')} placeholderTextColor={colors.muted} maxLength={1200} multiline
        style={[styles.input, { height: 70, paddingTop: 10, textAlignVertical: 'top', marginBottom: 10 }]} />
      <Button label={t('suggestion.submit')} busy={busy} disabled={!name.trim()} onPress={() => onSubmit(name, notes)} />
      <View style={{ alignItems: 'center' }}><LinkButton label={t('common.cancel')} color={colors.muted} onPress={onCancel} /></View>
    </Sheet>
  );
}

export function CommunitySheet({ onLayout, suggestion, onDirections, onClose }: SheetProps & {
  suggestion: { name: string; notes: string; kind: string }; onDirections: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={t('community.reviewed')}>{suggestion.name}</Title>
      {suggestion.notes ? <Text style={[styles.rowLabel, { fontWeight: '400', marginBottom: 12 }]}>{suggestion.notes}</Text> : null}
      <Button label={t('place.directions')} icon="navigate" onPress={onDirections} />
      <View style={{ alignItems: 'center' }}><LinkButton label={t('common.close')} color={colors.muted} onPress={onClose} /></View>
    </Sheet>
  );
}
