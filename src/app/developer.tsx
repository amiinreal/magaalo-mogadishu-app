import { useState } from 'react';
import { Text, View } from 'react-native';
import { Page } from '../components/Page';
import { Button, Row, styles, ToggleRow } from '../components/ui';
import { MAP_STORAGE, OSRM_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, VALHALLA_URL } from '../config';
import { useI18n } from '../i18n';
import { useDeviceLocation } from '../lib/hooks';
import { useApp } from '../state/AppState';

type Check = { name: string; ok: boolean; ms: number; detail?: string };

async function timed(name: string, run: () => Promise<Response>): Promise<Check> {
  const start = Date.now();
  try {
    const response = await run();
    return { name, ok: response.ok, ms: Date.now() - start, detail: response.ok ? undefined : `HTTP ${response.status}` };
  } catch (error) {
    return { name, ok: false, ms: Date.now() - start, detail: error instanceof Error ? error.message : String(error) };
  }
}

export default function DeveloperScreen() {
  const { t } = useI18n();
  const { settings, updateSettings } = useApp();
  const { fix, permission } = useDeviceLocation(true);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setChecks(await Promise.all([
      timed('Supabase API', () => fetch(`${SUPABASE_URL}/rest/v1/map_alerts?select=id&limit=1`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } })),
      timed('Map tiles', () => fetch(`${MAP_STORAGE}/districts.geojson`, { method: 'HEAD' })),
      timed('Valhalla routing', () => fetch(`${VALHALLA_URL.replace('/route', '/status')}`)),
      timed('OSRM routing', () => fetch(`${OSRM_URL}/driving/45.318,2.046;45.32,2.05?overview=false`)),
    ]));
    setRunning(false);
  };

  return (
    <Page title={t('dev.title')} backToMap>
      <ToggleRow icon="code-slash-outline" label={t('settings.developer')} hint={t('dev.onDevice')} value={settings.developer}
        onChange={developer => updateSettings({ developer })} />
      <Text style={[styles.rowHint, { marginVertical: 6 }]}>{t('dev.optional')}</Text>
      <Row icon="navigate-circle-outline" label={t('dev.gps')} hint={t('dev.gpsHint')} />
      <View style={{ marginLeft: 30, marginBottom: 8 }}>
        <Text style={styles.rowHint}>
          {permission !== 'granted' ? `Permission: ${permission}` : fix
            ? `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)} · ±${Math.round(fix.accuracy ?? 0)} m · heading ${fix.heading != null ? Math.round(fix.heading) : '—'}° · ${fix.speed != null ? (fix.speed * 3.6).toFixed(1) : '—'} km/h`
            : '…'}
        </Text>
      </View>
      <ToggleRow icon="bug-outline" label={t('dev.mapDebug')} hint={t('dev.mapDebugHint')} value={settings.mapDebug}
        onChange={mapDebug => updateSettings({ mapDebug, developer: true })} />
      <ToggleRow icon="car-sport-outline" label={t('dev.simulate')} hint={t('dev.simulateHint')} value={settings.simulate}
        onChange={simulate => updateSettings({ simulate, developer: true })} />
      <Row icon="pulse-outline" label={t('dev.connection')} hint={t('dev.connectionHint')} />
      {checks?.map(c => (
        <Text key={c.name} style={[styles.rowHint, { marginLeft: 30 }]}>
          {c.ok ? '✓' : '✕'} {c.name} · {c.ms} ms{c.detail ? ` · ${c.detail}` : ''}
        </Text>
      ))}
      <Button style={{ marginTop: 12 }} variant="secondary" icon="refresh" label={t('dev.check')} busy={running} onPress={run} />
      <Text style={[styles.rowHint, { marginTop: 14 }]}>{t('dev.footer')}</Text>
    </Page>
  );
}
