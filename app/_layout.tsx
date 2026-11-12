import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/contexts/auth';
import { PresenceProvider } from '@/contexts/presence';
import { AppLock } from '@/components/app-lock';
import { Brand, BitcoinColors } from '@/constants/theme';

const BitcoinNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: BitcoinColors.orange,
    background: BitcoinColors.darkBg,
    card: BitcoinColors.cardBg,
    text: BitcoinColors.textPrimary,
    border: BitcoinColors.border,
  },
};

function AuthGate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isCallback = (segments[0] as string) === 'auth';

    if (!session && !inAuthGroup && !isCallback) {
      router.replace('/(auth)/login');
    } else if (session && (inAuthGroup || isCallback)) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BitcoinColors.darkBg }}>
        <ActivityIndicator size="large" color={Brand.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: BitcoinColors.cardBg },
        headerTintColor: BitcoinColors.orange,
        headerTitleStyle: { color: '#FFFFFF', fontWeight: '700' },
        contentStyle: { backgroundColor: BitcoinColors.darkBg },
      }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerShown: false }} />
      <Stack.Screen name="qr-scanner" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="add-money" options={{ headerShown: false }} />
      <Stack.Screen name="online-map" options={{ headerShown: false }} />
      <Stack.Screen name="p2p/index" options={{ headerShown: false }} />
      <Stack.Screen name="p2p/new" options={{ headerShown: false }} />
      <Stack.Screen name="p2p/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="kyc/index" options={{ headerShown: false }} />
      <Stack.Screen name="kyc/manual" options={{ headerShown: false }} />
      <Stack.Screen name="kyc/review/index" options={{ headerShown: false }} />
      <Stack.Screen name="kyc/review/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PresenceProvider>
          <ThemeProvider value={BitcoinNavTheme}>
            <AppLock>
              <AuthGate />
            </AppLock>
            <StatusBar style="light" />
          </ThemeProvider>
        </PresenceProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
