import { Text as NativeText, StyleSheet, type TextProps } from 'react-native';

/** Match the Figma type scale without losing native text accessibility or scaling. */
export function Text({ style, ...props }: TextProps) {
  const weight = StyleSheet.flatten(style)?.fontWeight;
  const numericWeight = weight === 'bold' ? 700 : Number(weight ?? 400);
  const fontFamily = numericWeight >= 600 ? 'DMSans_700Bold' : numericWeight >= 500 ? 'DMSans_500Medium' : 'DMSans_400Regular';
  return <NativeText {...props} style={[style, { fontFamily, fontWeight: 'normal' }]} />;
}
