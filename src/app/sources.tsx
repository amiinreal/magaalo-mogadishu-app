import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Linking, } from 'react-native';
import { Text } from '../components/Typography';
import { Page } from '../components/Page';
import { LinkButton, Row, styles } from '../components/ui';
import { ATLAS_WEBSITE } from '../config';
import { useI18n } from '../i18n';

type NetworkSummary = {
  roads: { ways: number; length_km: number; junctions: number; dead_ends: number; components: number; main_component_share: number; isolated_ways: number };
  gap_model: { predicted_missing_connections: number; holdout_recall_at_0_7: number; joins_separate_components: number };
  access: { buildings: number; buildings_linked: number; buildings_on_named_street: number; median_distance_m: number; places_linked: number };
};
type AtlasInfo = { counts: Record<string, number>; osm_timestamp: string };

const n = (v?: number) => (v ?? 0).toLocaleString();

/** The website's "Sources & coverage", plus what the road-network pipeline found. */
export default function SourcesScreen() {
  const { t } = useI18n();
  const [atlas, setAtlas] = useState<AtlasInfo | null>(null);
  const [network, setNetwork] = useState<NetworkSummary | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('magaalo.atlasInfo').then(v => v && setAtlas(JSON.parse(v))).catch(() => {});
    fetch(`${ATLAS_WEBSITE}/data/network/summary.json`).then(r => (r.ok ? r.json() : null)).then(setNetwork).catch(() => {});
  }, []);
  return (
    <Page title={t('sources.title')} backToMap>
      <Row icon="earth-outline" label={t('sources.imagery')} hint={t('sources.imageryHint')} />
      <Row icon="grid-outline" label={t('sources.districts')} hint={t('sources.districtsHint')} />
      <Row icon="git-network-outline" label={t('sources.roads')}
        hint={atlas ? t('sources.roadsCounts', { date: atlas.osm_timestamp.slice(0, 10), roads: n(atlas.counts.road_features), buildings: n(atlas.counts.building_features), places: n(atlas.counts.place_features) }) : t('sources.roadsHint')} />
      <Row icon="navigate-outline" label={t('sources.routing')} hint={t('sources.routingHint')} />
      {network ? (
        <>
          <Text style={[styles.rowLabel, { marginTop: 14 }]}>{t('network.title')}</Text>
          <Row icon="git-merge-outline" label={t('network.connected', { p: (network.roads.main_component_share * 100).toFixed(1) })}
            hint={t('network.graph', { junctions: n(network.roads.junctions), km: n(Math.round(network.roads.length_km)), fragments: n(network.roads.components - 1) })} />
          <Row icon="analytics-outline" label={t('network.gaps', { n: n(network.gap_model.predicted_missing_connections) })}
            hint={t('network.gapsHint', { joins: n(network.gap_model.joins_separate_components), recall: Math.round(network.gap_model.holdout_recall_at_0_7 * 100) })} />
          <Row icon="business-outline" label={t('network.linked', { linked: n(network.access.buildings_linked), total: n(network.access.buildings) })}
            hint={t('network.linkedHint', { m: network.access.median_distance_m, named: n(network.access.buildings_on_named_street), places: n(network.access.places_linked) })} />
        </>
      ) : null}
      <Text style={[styles.rowHint, { marginTop: 12 }]}>{t('help.body')}</Text>
      <LinkButton label="Magaalo Atlas ↗" onPress={() => Linking.openURL(ATLAS_WEBSITE)} />
    </Page>
  );
}
