import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors } from '@/constants/theme';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function AuthCallback() {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (session) {
      router.replace('/(tabs)');
    } else if (!loading) {
      router.replace('/(auth)/login');
    }
  }, [session, loading, router]);

  return (
    <View style={styles.container}>
      <BitcoinBadge size={80} glow={true} />
      <ActivityIndicator size="large" color={BitcoinColors.orange} style={{ marginTop: 24 }} />
      <Text style={styles.text}>Connecting to Wallet...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  text: {
    marginTop: 18,
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
