import { router } from 'expo-router';
import { } from 'react-native';
import { Text } from '../components/Typography';
import { Page } from '../components/Page';
import { categoryIcon, placeSubtitle } from '../components/sheets/ExploreSheets';
import { Button, LinkButton, Row, styles } from '../components/ui';
import { colors } from '../config';
import { useI18n } from '../i18n';
import type { Place } from '../lib/search';
import { useApp } from '../state/AppState';

export default function SavedScreen() {
  const { t } = useI18n();
  const { saved, toggleSaved, setMapIntent } = useApp();
  const open = (place: Place) => { setMapIntent({ type: 'place', place }); router.dismissAll(); };
  return (
    <Page title={t('saved.title')} footer={<Button label={t('common.done')} onPress={() => router.back()} />}>
      {saved.home ? <Row icon="home-outline" label={t('explore.home')} hint={saved.home.name} onPress={() => open(saved.home!)} /> : null}
      {saved.work ? <Row icon="briefcase-outline" label={t('explore.work')} hint={saved.work.name} onPress={() => open(saved.work!)} /> : null}
      {saved.places.map(p => (
        <Row key={`${p.id}-${p.lat}`} icon={categoryIcon(p.category)} label={p.name} hint={placeSubtitle(p, t('common.mogadishu'))} onPress={() => open(p)}
          right={<LinkButton label={t('saved.remove')} color={colors.muted} onPress={() => toggleSaved(p)} />} />
      ))}
      {!saved.places.length && !saved.home && !saved.work ? <Text style={[styles.sub, { marginTop: 12 }]}>{t('saved.empty')}</Text> : null}
    </Page>
  );
}
