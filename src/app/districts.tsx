import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Page } from '../components/Page';
import { Row, styles } from '../components/ui';
import { DISTRICTS } from '../config';
import { useI18n } from '../i18n';
import { useApp } from '../state/AppState';

// Districts without a sourced boundary polygon yet (see the Atlas README).
const NO_POLYGON = new Set(['Darussalam', 'Garasbaley', 'Gubadley']);

export default function DistrictsScreen() {
  const { t } = useI18n();
  const { setMapIntent } = useApp();
  return (
    <Page title={t('districts.title')}>
      <Text style={[styles.sub, { marginBottom: 8 }]}>{t('districts.hint')}</Text>
      {DISTRICTS.map(([name, color]) => (
        <Row key={name} label={name}
          right={<View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: color, opacity: NO_POLYGON.has(name) ? 0.35 : 1 }} />}
          onPress={NO_POLYGON.has(name) ? undefined : () => { setMapIntent({ type: 'district', name }); router.dismissAll(); }} />
      ))}
    </Page>
  );
}
