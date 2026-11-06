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

export default function LoginScreen() {
  const { signIn, signInWithPhone, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [method, setMethod] = useState<'email' | 'phone'>('email');

  useEffect(() => {
    if (Platform.OS !== 'web') {
      WebBrowser.warmUpAsync();
      return () => {
        WebBrowser.coolDownAsync();
      };
    }
  }, []);

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err.message && !err.message.includes('canceled') && !err.message.includes('dismissed')) {
        Alert.alert('Google Sign In', err.message ?? 'Failed to authenticate with Google');
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleLogin() {
    setLoading(true);
    try {
      if (method === 'email') {
        if (!email || !password) {
          Alert.alert('Error', 'Please fill in all fields');
          return;
        }
        await signIn(email.trim(), password);
      } else {
        if (!phone) {
          Alert.alert('Error', 'Please enter your phone number');
          return;
        }
        await signInWithPhone(`+63${phone}`);
        Alert.alert('OTP Sent', 'Check your phone for the verification code.');
      }
    } catch (err: any) {
      Alert.alert('Login Failed', err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header Hero */}
        <LinearGradient
          colors={['#1E160A', '#111520', BitcoinColors.darkBg]}
          style={styles.header}>
          <BitcoinBadge size={76} glow={true} />
          <Text style={styles.logo}>
            YT<Text style={{ color: BitcoinColors.orange }}>CASH</Text>
          </Text>
          <View style={styles.taglinePill}>
            <Text style={styles.taglineText}>⚡ BITCOIN POWERED WALLET</Text>
          </View>
        </LinearGradient>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Authenticate to access your secure wallet</Text>

          {/* Method toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, method === 'email' && styles.toggleActive]}
              onPress={() => setMethod('email')}
              activeOpacity={0.8}>
              <Text style={[styles.toggleText, method === 'email' && styles.toggleTextActive]}>
                Email Access
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, method === 'phone' && styles.toggleActive]}
              onPress={() => setMethod('phone')}
              activeOpacity={0.8}>
              <Text style={[styles.toggleText, method === 'phone' && styles.toggleTextActive]}>
                Phone OTP
              </Text>
            </TouchableOpacity>
          </View>

          {method === 'email' ? (
            <>
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
              <Text style={styles.inputLabel}>PASSWORD</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••••••"
                placeholderTextColor={BitcoinColors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </>
          ) : (
            <>
              <Text style={styles.inputLabel}>MOBILE PHONE NUMBER</Text>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryCodeText}>+63</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.phoneInput]}
                  placeholder="9XX XXX XXXX"
                  placeholderTextColor={BitcoinColors.textMuted}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            </>
          )}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}>
            <LinearGradient colors={Brand.gradientButton} style={styles.loginBtnGradient}>
              <Text style={styles.loginBtnText}>
                {loading ? 'Authenticating...' : method === 'email' ? 'Unlock Wallet' : 'Request OTP Code'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {method === 'email' && (
            <TouchableOpacity style={styles.forgot}>
              <Text style={styles.forgotText}>Forgot Master Password?</Text>
            </TouchableOpacity>
          )}

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google Sign In */}
          <GoogleButton
            mode="signin"
            loading={googleLoading}
            disabled={loading || googleLoading}
            onPress={handleGoogleLogin}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to YTCash? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.footerLink}>Create Bitcoin Wallet</Text>
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
  toggle: {
    flexDirection: 'row',
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 12,
    marginBottom: 20,
    padding: 4,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: BitcoinColors.orange,
  },
  toggleText: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    fontWeight: '700',
  },
  toggleTextActive: {
    color: '#07090E',
    fontWeight: '800',
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
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countryCode: {
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: BitcoinColors.cardElevated,
    marginBottom: 14,
  },
  countryCodeText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  phoneInput: {
    flex: 1,
  },
  loginBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
  },
  loginBtnGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  loginBtnText: {
    color: '#07090E',
    fontSize: 15,
    fontWeight: '800',
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  forgot: {
    alignItems: 'center',
    marginTop: 16,
  },
  forgotText: {
    fontSize: 12,
    color: BitcoinColors.orangeLight,
    fontWeight: '600',
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
