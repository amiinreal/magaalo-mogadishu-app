import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from '../components/Typography';
import { Page } from '../components/Page';
import { Row, styles } from '../components/ui';
import { colors } from '../config';
import { useI18n, type StringKey } from '../i18n';
import { mySuggestions, type Suggestion } from '../lib/community';

const BADGE: Record<Suggestion['status'], string> = { pending: colors.amber, approved: colors.green, rejected: colors.red };

/** The website's "My suggestions": everything this account submitted for moderator review. */
export default function SuggestionsScreen() {
  const { t } = useI18n();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { mySuggestions().then(setItems).catch(e => setError(e instanceof Error ? e.message : t('common.error'))); }, []);
  return (
    <Page title={t('improve.mine')} backToMap>
      <Text style={[styles.sub, { marginBottom: 8 }]}>{t('improve.reviewed')}</Text>
      {!items && !error ? <ActivityIndicator color={colors.blue} style={{ marginTop: 20 }} /> : null}
      {error ? <Text style={[styles.sub, { color: colors.red }]}>{error}</Text> : null}
      {items?.length === 0 ? <Text style={styles.sub}>{t('suggestion.none')}</Text> : null}
      {items?.map(s => (
        <Row key={s.id} label={s.name}
          hint={[t(`kind.${s.kind}` as StringKey), s.review_notes].filter(Boolean).join(' · ')}
          right={<View style={{ backgroundColor: BADGE[s.status], borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{t(`status.${s.status}` as StringKey)}</Text>
          </View>} />
      ))}
    </Page>
  );
}
