import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Page } from '../components/Page';
import { Row, styles, ToggleRow } from '../components/ui';
import { colors } from '../config';
import { useI18n } from '../i18n';
import { website } from '../lib/website';
import { useApp } from '../state/AppState';

type Transport = {
  routes: { id: string; name: string; mode: 'bus' | 'taxi' | 'minibus'; description: string }[];
  stops: { id: string; route_id: string | null }[];
  positions: { vehicle_id: string }[];
};

/** The website's "City transport" (/api/transport): verified routes, stops and live vehicle positions. */
export default function TransportScreen() {
  const { t } = useI18n();
  const { settings, updateSettings } = useApp();
  const [data, setData] = useState<Transport | null>(null);
  useEffect(() => {
    const load = () => website<Transport>('/api/transport').then(setData).catch(() => setData({ routes: [], stops: [], positions: [] }));
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Page title={t('transport.title')} backToMap>
      <Text style={[styles.sub, { marginBottom: 8 }]}>{t('transport.hint')}</Text>
      <ToggleRow icon="map-outline" label={t('layers.transport')} hint={t('layers.transportHint')} value={settings.transport} onChange={transport => updateSettings({ transport })} />
      {data === null ? <ActivityIndicator color={colors.blue} style={{ marginTop: 20 }} /> : null}
      {data?.routes.length === 0 ? <Text style={[styles.sub, { marginTop: 12 }]}>{t('transport.empty')}</Text> : null}
      {data?.routes.map(r => (
        <Row key={r.id} icon={r.mode === 'taxi' ? 'car-outline' : 'bus-outline'} label={r.name}
          hint={[t('transport.stops', { n: data.stops.filter(s => s.route_id === r.id).length }), r.description].filter(Boolean).join(' · ')} />
      ))}
    </Page>
  );
}
