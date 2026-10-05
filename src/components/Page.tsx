import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../config';
import { useI18n } from '../i18n';
import { Button } from './ui';

/** Full-screen page with a back chevron, as in the Figma settings/saved/language screens. */
export function Page({ title, children, footer, backToMap }: { title: string; children: ReactNode; footer?: ReactNode; backToMap?: boolean }) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 56 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} hitSlop={10}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {(footer || backToMap) ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 14), paddingTop: 8 }}>
          {footer}
          {backToMap ? <Button label={t('settings.backToMap')} variant="dark" onPress={() => router.dismissAll()} /> : null}
        </View>
      ) : null}
    </View>
  );
}
