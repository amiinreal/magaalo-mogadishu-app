import { useLocalSearchParams } from 'expo-router';
import { Linking, Text } from 'react-native';
import { Page } from '../components/Page';
import { Button, LinkButton, styles } from '../components/ui';
import { ATLAS_WEBSITE } from '../config';
import { useI18n } from '../i18n';
import { useApp } from '../state/AppState';

export default function InfoScreen() {
  const { topic } = useLocalSearchParams<{ topic: 'privacy' | 'help' }>();
  const { t } = useI18n();
  const { clearHistory } = useApp();
  const privacy = topic === 'privacy';
  return (
    <Page title={privacy ? t('settings.privacy') : t('settings.help')}>
      <Text style={[styles.rowLabel, { fontWeight: '400', lineHeight: 23 }]}>{privacy ? t('privacy.body') : t('help.body')}</Text>
      {privacy ? (
        <Button style={{ marginTop: 20 }} variant="secondary" icon="trash-outline" label={t('settings.clearHistory')} onPress={clearHistory} />
      ) : (
        <LinkButton label="Magaalo Atlas ↗" onPress={() => Linking.openURL(ATLAS_WEBSITE)} />
      )}
    </Page>
  );
}
