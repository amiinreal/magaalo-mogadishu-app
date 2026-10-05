import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { colors } from '../../config';
import { useI18n, type StringKey } from '../../i18n';
import type { Topic } from '../../lib/community';
import { Button, LinkButton, Row, Sheet, styles, Title, type IconName } from '../ui';

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

export function SuggestSheet({ onLayout, name, busy, onExists, onMissing, onAddMissing }: SheetProps & {
  name?: string; busy: boolean; onExists: () => void; onMissing: () => void; onAddMissing: () => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet onLayout={onLayout}>
      <Title sub={name || t('suggest.subtitle')}>{t('suggest.title')}</Title>
      <Row icon="checkmark" label={t('suggest.exists')} onPress={busy ? undefined : onExists} />
      <Row icon="close-circle-outline" label={t('suggest.notExists')} onPress={busy ? undefined : onMissing} />
      <Row icon="add-circle-outline" label={t('suggest.addMissing')} onPress={busy ? undefined : onAddMissing} color={colors.blue} />
      <Text style={[styles.rowHint, { marginTop: 4 }]}>{t('suggest.tapOption')}</Text>
    </Sheet>
  );
}
