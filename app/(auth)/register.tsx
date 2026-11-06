import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors, Brand } from '@/constants/theme';
import { BitcoinBadge } from '@/components/bitcoin-badge';
import { GoogleButton } from '@/components/google-button';

export default function RegisterScreen() {
  const { signUp, signInWithGoogle } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      WebBrowser.warmUpAsync();
      return () => {
        WebBrowser.coolDownAsync();
      };
    }
  }, []);

  async function handleGoogleSignUp() {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err.message && !err.message.includes('canceled') && !err.message.includes('dismissed')) {
        Alert.alert('Google Sign Up', err.message ?? 'Failed to authenticate with Google');
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleRegister() {
    if (!fullName || !email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      await signUp(email.trim(), password, fullName.trim());
      Alert.alert(
        'Bitcoin Wallet Initialized',
        'Verification link sent to your email. Confirm it to activate your wallet.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }],
      );
    } catch (err: any) {
      Alert.alert('Registration Failed', err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <LinearGradient
          colors={['#1E160A', '#111520', BitcoinColors.darkBg]}
          style={styles.header}>
          <BitcoinBadge size={76} glow={true} />
          <Text style={styles.logo}>
            YT<Text style={{ color: BitcoinColors.orange }}>CASH</Text>
          </Text>
          <View style={styles.taglinePill}>
            <Text style={styles.taglineText}>⚡ CREATE SOVEREIGN WALLET</Text>
          </View>
        </LinearGradient>

        <View style={styles.card}>
          <Text style={styles.title}>New Wallet</Text>
          <Text style={styles.subtitle}>Generate your cryptographic digital wallet</Text>

          <Text style={styles.inputLabel}>FULL NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="Satoshi Nakamoto"
            placeholderTextColor={BitcoinColors.textMuted}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

          <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
          <TextInput
            style={styles.input}
            placeholder="name@domain.com"
            placeholderTextColor={BitcoinColors.textMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.inputLabel}>MASTER PASSWORD</Text>
          <TextInput
            style={styles.input}
            placeholder="At least 6 characters"
            placeholderTextColor={BitcoinColors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <Text style={styles.inputLabel}>CONFIRM PASSWORD</Text>
          <TextInput
            style={styles.input}
            placeholder="Re-enter password"
            placeholderTextColor={BitcoinColors.textMuted}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.registerBtn, loading && styles.registerBtnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}>
            <LinearGradient colors={Brand.gradientButton} style={styles.registerBtnGradient}>
              <Text style={styles.registerBtnText}>
                {loading ? 'Initializing Wallet...' : 'Create Bitcoin Wallet'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google Sign Up */}
          <GoogleButton
            mode="signup"
            loading={googleLoading}
            disabled={loading || googleLoading}
            onPress={handleGoogleSignUp}
          />

          <Text style={styles.terms}>
            By signing up, you agree to our{' '}
            <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>.
          </Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have a wallet? </Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.footerLink}>Unlock Wallet</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  scroll: {
    flexGrow: 1,
  },
  header: {
    paddingTop: 68,
    paddingBottom: 40,
    alignItems: 'center',
  },
  logo: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginTop: 12,
  },
  taglinePill: {
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    marginTop: 8,
  },
  taglineText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.gold,
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    marginHorizontal: 20,
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#FFFFFF',
    backgroundColor: BitcoinColors.cardElevated,
    marginBottom: 14,
  },
  registerBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
  },
  registerBtnGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  registerBtnText: {
    color: '#07090E',
    fontSize: 15,
    fontWeight: '800',
  },
  registerBtnDisabled: {
    opacity: 0.6,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: '700',
    color: BitcoinColors.textMuted,
    letterSpacing: 0.8,
  },
  terms: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 16,
  },
  termsLink: {
    color: BitcoinColors.orangeLight,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  footerText: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
  },
  footerLink: {
    fontSize: 13,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
});
