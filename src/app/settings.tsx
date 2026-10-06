import { router } from 'expo-router';
import { Text } from 'react-native';
import { Page } from '../components/Page';
import { Row, styles, ToggleRow } from '../components/ui';
import { useI18n } from '../i18n';
import { useApp } from '../state/AppState';

export default function SettingsScreen() {
  const { t, lang } = useI18n();
  const { settings, updateSettings, session } = useApp();
  return (
    <Page title={t('settings.title')} backToMap>
      <Row icon="person-circle-outline" label={t('settings.account')}
        hint={session?.user.email ? t('settings.signedInAs', { email: session.user.email }) : t('settings.guest')}
        onPress={() => router.push('/account')} />
      <Row icon="language-outline" label={t('settings.language')} hint={lang === 'so' ? 'Soomaali' : 'English'} onPress={() => router.push('/language')} />
      <ToggleRow icon="volume-high-outline" label={t('settings.voice')} hint={settings.voice ? t('common.on') : t('common.off')}
        value={settings.voice} onChange={voice => updateSettings({ voice })} />
      <Row icon="layers-outline" label={t('settings.mapAppearance')}
        hint={settings.basemap === 'satellite' ? t('layers.satellite') : t('layers.street')}
        onPress={() => updateSettings({ basemap: settings.basemap === 'street' ? 'satellite' : 'street' })} />
      <Row icon="bookmark-outline" label={t('explore.saved')} hint={t('explore.savedHint')} onPress={() => router.push('/saved')} />
      <Row icon="grid-outline" label={t('districts.title')} hint={t('districts.hint')} onPress={() => router.push('/districts')} />
      <Row icon="bus-outline" label={t('transport.title')} hint={t('transport.hint')} onPress={() => router.push('/transport')} />
      <Row icon="lock-closed-outline" label={t('settings.privacy')} hint={t('settings.privacyHint')} onPress={() => router.push('/info?topic=privacy')} />
      <ToggleRow icon="code-slash-outline" label={t('settings.developer')} hint={settings.developer ? t('dev.onDevice') : t('common.off')}
        value={settings.developer} onChange={developer => { updateSettings({ developer }); if (developer) router.push('/developer'); }} />
      {settings.developer ? <Row icon="construct-outline" label={t('dev.title')} hint={t('dev.optional')} onPress={() => router.push('/developer')} /> : null}
      <Row icon="create-outline" label={t('improve.mine')} hint={t('improve.reviewed')} onPress={() => router.push('/suggestions')} />
      <Row icon="help-circle-outline" label={t('sources.title')} hint={t('settings.helpHint')} onPress={() => router.push('/sources')} />
      <Text style={[styles.rowHint, { marginTop: 14 }]}>{t('settings.footer')}</Text>
    </Page>
  );
}
