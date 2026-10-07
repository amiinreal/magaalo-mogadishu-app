import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Text } from '../components/Typography';
import { Page } from '../components/Page';
import { Button, LinkButton, Row, styles } from '../components/ui';
import { colors } from '../config';
import { useI18n } from '../i18n';
import { myStats } from '../lib/community';
import { supabase } from '../lib/supabase';
import { useApp } from '../state/AppState';

export default function AccountScreen() {
  const { t } = useI18n();
  const { session } = useApp();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState<{ trust: number; reports: number; reviews: number } | null>(null);

  useEffect(() => {
    if (session) myStats().then(setStats).catch(() => {});
  }, [session?.user.id]);

  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) { setMessage(t('account.checkEmail')); setMode('signIn'); }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (session) {
    return (
      <Page title={t('account.title')} backToMap>
        <Text style={[styles.title, { fontSize: 18, marginBottom: 12 }]}>{session.user.email}</Text>
        {stats ? (
          <>
            <Row icon="shield-checkmark-outline" label={`${t('account.trust')}: ${Math.round(stats.trust * 100)}%`} hint={t('account.trustHint')} />
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.soft, marginLeft: 30, marginBottom: 10 }}>
              <View style={{ width: `${Math.round(stats.trust * 100)}%`, height: 8, borderRadius: 4, backgroundColor: colors.green }} />
            </View>
            <Row icon="flag-outline" label={t('account.reports')} right={<Text style={styles.rowLabel}>{stats.reports}</Text>} />
            <Row icon="star-outline" label={t('account.reviews')} right={<Text style={styles.rowLabel}>{stats.reviews}</Text>} />
          </>
        ) : null}
        <Button style={{ marginTop: 18 }} variant="secondary" icon="log-out-outline" label={t('account.signOut')} onPress={() => supabase.auth.signOut()} />
      </Page>
    );
  }

  return (
    <Page title={mode === 'signIn' ? t('account.signIn') : t('account.signUp')}>
      <Text style={[styles.sub, { marginBottom: 16 }]}>{t('account.why')}</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder={t('account.email')} placeholderTextColor={colors.muted}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" style={[styles.TextInput, { marginBottom: 10 }]} />
      <TextInput value={password} onChangeText={setPassword} placeholder={t('account.password')} placeholderTextColor={colors.muted}
        secureTextEntry autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
        style={[styles.TextInput, { marginBottom: 14 }]} onSubmitEditing={submit} />
      {message ? <Text style={[styles.sub, { color: colors.green, marginBottom: 12 }]}>{message}</Text> : null}
      <Button label={mode === 'signIn' ? t('account.signIn') : t('account.signUp')} busy={busy}
        disabled={!email.includes('@') || password.length < 6} onPress={submit} />
      <View style={{ alignItems: 'center', marginTop: 6 }}>
        <LinkButton label={mode === 'signIn' ? t('account.toSignUp') : t('account.toSignIn')} onPress={() => { setMessage(''); setMode(mode === 'signIn' ? 'signUp' : 'signIn'); }} />
      </View>
    </Page>
  );
}
