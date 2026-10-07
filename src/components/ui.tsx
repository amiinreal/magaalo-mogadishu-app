import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../config';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Sheet({ children, onLayout, style }: { children: ReactNode; onLayout?: (height: number) => void; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 4 }, style]}
      onLayout={(e: LayoutChangeEvent) => onLayout?.(e.nativeEvent.layout.height)}
    >
      <View style={styles.handle} />
      {children}
    </View>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.title} accessibilityRole="header">{children}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Button({ label, onPress, variant = 'primary', icon, busy, disabled, style }: {
  label: string; onPress: () => void; variant?: 'primary' | 'dark' | 'secondary' | 'danger'; icon?: IconName; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const bg = { primary: colors.blue, dark: colors.green, secondary: colors.soft, danger: colors.red }[variant];
  const fg = variant === 'secondary' ? colors.ink : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
      {!busy && <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function LinkButton({ label, onPress, color = colors.blue }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={{ paddingVertical: 8 }}>
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ icon, label, hint, onPress, right, color = colors.ink }: {
  icon?: IconName; label: string; hint?: string; onPress?: () => void; right?: ReactNode; color?: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.soft }]}
    >
      {icon ? <Ionicons name={icon} size={20} color={color} style={styles.rowIcon} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color }]} numberOfLines={1}>{label}</Text>
        {hint ? <Text style={styles.rowHint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function ToggleRow({ icon, label, hint, value, onChange }: { icon?: IconName; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row icon={icon} label={label} hint={hint} onPress={() => onChange(!value)}
      right={<Switch value={value} onValueChange={onChange} trackColor={{ true: colors.blue, false: '#cfd6d3' }} thumbColor="#fff" />} />
  );
}

export function Chip({ label, icon, active, onPress }: { label: string; icon?: IconName; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: colors.blueSoft, borderColor: colors.blue }]}
    >
      {icon ? <Ionicons name={icon} size={15} color={active ? colors.blue : colors.ink} style={{ marginRight: 5 }} /> : null}
      <Text style={[styles.chipText, active && { color: colors.blue }]}>{label}</Text>
    </Pressable>
  );
}

export function RoundButton({ icon, onPress, label, tint = colors.ink, background = '#fff', size = 46 }: {
  icon: IconName; onPress: () => void; label: string; tint?: string; background?: string; size?: number;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.round, { width: size, height: size, borderRadius: size / 2, backgroundColor: background, opacity: pressed ? 0.8 : 1 }]}>
      <Ionicons name={icon} size={size * 0.46} color={tint} />
    </Pressable>
  );
}

export function Stars({ value, onChange, size = 34 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} stars`} disabled={!onChange} onPress={() => onChange?.(n)}
          style={[styles.star, { width: size + 6, height: size + 6, borderColor: n <= value ? colors.amber : colors.line }]}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size * 0.6} color={n <= value ? colors.amber : colors.blue} />
        </Pressable>
      ))}
    </View>
  );
}

export function Banner({ icon, title, hint, tone = 'dark' }: { icon: IconName; title: string; hint?: string; tone?: 'dark' | 'light' }) {
  const dark = tone === 'dark';
  return (
    <View style={[styles.banner, { backgroundColor: dark ? colors.green : '#fff' }]}>
      <Ionicons name={icon} size={18} color={dark ? '#fff' : colors.ink} style={{ marginRight: 8, marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: dark ? '#fff' : colors.ink, fontWeight: '700', fontSize: 14 }}>{title}</Text>
        {hint ? <Text style={{ color: dark ? 'rgba(255,255,255,.8)' : colors.muted, fontSize: 12, marginTop: 2 }}>{hint}</Text> : null}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 20, paddingTop: 8, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 14,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#d5dbd8', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 3 },
  button: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderRadius: 10, minHeight: 48 },
  rowIcon: { width: 40, padding: 8, marginRight: 10, borderRadius: 12, backgroundColor: colors.soft, overflow: 'hidden' },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, color: colors.muted, marginTop: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 14, height: 36,
    borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  round: { alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5 },
  star: { borderRadius: 999, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', borderRadius: 14, padding: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 6 },
  TextInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, fontFamily: 'DMSans_400Regular', color: colors.ink, backgroundColor: '#fff' },
});
