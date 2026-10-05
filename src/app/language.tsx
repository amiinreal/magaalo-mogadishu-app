import { Ionicons } from '@expo/vector-icons';
import { Text } from 'react-native';
import { Page } from '../components/Page';
import { Row, styles } from '../components/ui';
import { colors } from '../config';
import { useI18n, type Language } from '../i18n';

const LANGUAGES: [Language, string][] = [['en', 'English'], ['so', 'Soomaali']];

export default function LanguageScreen() {
  const { t, lang, setLang } = useI18n();
  return (
    <Page title={t('language.title')}>
      {LANGUAGES.map(([code, name]) => (
        <Row key={code} icon={lang === code ? 'checkmark' : 'globe-outline'} label={name}
          hint={lang === code ? t('language.selected') : undefined} onPress={() => setLang(code)}
          right={lang === code ? <Ionicons name="radio-button-on" size={22} color={colors.blue} /> : <Ionicons name="radio-button-off" size={22} color={colors.muted} />} />
      ))}
      <Text style={[styles.rowHint, { marginTop: 14 }]}>{t('language.hint')}</Text>
      <Text style={[styles.rowHint, { marginTop: 6 }]}>{t('language.voiceNote')}</Text>
    </Page>
  );
}
