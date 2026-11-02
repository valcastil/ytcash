import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors } from '@/constants/theme';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function AuthCallback() {
  const router = useRouter();
  const { session, loading, refreshProfile } = useAuth();

  useEffect(() => {
    async function completeAuth() {
      if (session) {
        try {
          await refreshProfile();
        } catch (e) {
          console.warn('Error refreshing profile in callback:', e);
        }
        router.replace('/(tabs)');
      } else if (!loading) {
        // Wait a brief moment in case session is being established from deep link
        const timer = setTimeout(() => {
          if (!session) {
            router.replace('/(auth)/login');
          } else {
            router.replace('/(tabs)');
          }
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
    completeAuth();
  }, [session, loading, refreshProfile, router]);

  return (
    <View style={styles.container}>
      <BitcoinBadge size={80} glow={true} />
      <ActivityIndicator size="large" color={BitcoinColors.orange} style={{ marginTop: 28 }} />
      <Text style={styles.text}>Connecting to Bitcoin Wallet...</Text>
      <Text style={styles.subtext}>Verifying Google Account Authorization</Text>
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
    marginTop: 20,
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  subtext: {
    marginTop: 8,
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
  },
});
