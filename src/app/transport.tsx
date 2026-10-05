import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Page } from '../components/Page';
import { Row, styles, ToggleRow } from '../components/ui';
import { colors } from '../config';
import { useI18n } from '../i18n';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppState';

type TransportRoute = { id: string; name: string; mode: 'bus' | 'taxi' | 'minibus'; description: string; transport_stops: { id: string }[] };

export default function TransportScreen() {
  const { t } = useI18n();
  const { settings, updateSettings } = useApp();
  const [routes, setRoutes] = useState<TransportRoute[] | null>(null);
  useEffect(() => {
    supabase.from('transport_routes').select('id, name, mode, description, transport_stops(id)').eq('active', true).order('name')
      .then(({ data }) => setRoutes((data ?? []) as TransportRoute[]));
  }, []);
  return (
    <Page title={t('transport.title')} backToMap>
      <Text style={[styles.sub, { marginBottom: 8 }]}>{t('transport.hint')}</Text>
      <ToggleRow icon="map-outline" label={t('layers.transport')} value={settings.transport} onChange={transport => updateSettings({ transport })} />
      {routes === null ? <ActivityIndicator color={colors.blue} style={{ marginTop: 20 }} /> : null}
      {routes?.length === 0 ? <Text style={[styles.sub, { marginTop: 12 }]}>{t('transport.empty')}</Text> : null}
      {routes?.map(r => (
        <Row key={r.id} icon={r.mode === 'taxi' ? 'car-outline' : 'bus-outline'} label={r.name}
          hint={[t('transport.stops', { n: r.transport_stops.length }), r.description].filter(Boolean).join(' · ')} />
      ))}
    </Page>
  );
}
