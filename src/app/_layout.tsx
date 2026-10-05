import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider } from '../i18n';
import { AppProvider } from '../state/AppState';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#fff' } }}>
            <Stack.Screen name="index" options={{ animation: 'none' }} />
          </Stack>
        </AppProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
