import React, { useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { Brand } from '@/constants/theme';

export default function LoginScreen() {
  const { signIn, signInWithPhone } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<'email' | 'phone'>('email');

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
        <LinearGradient colors={[Brand.primary, Brand.primaryDark]} style={styles.header}>
          <Text style={styles.logo}>YTCash</Text>
          <Text style={styles.tagline}>Your Digital Wallet</Text>
        </LinearGradient>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          {/* Method toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, method === 'email' && styles.toggleActive]}
              onPress={() => setMethod('email')}>
              <Text style={[styles.toggleText, method === 'email' && styles.toggleTextActive]}>
                Email
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, method === 'phone' && styles.toggleActive]}
              onPress={() => setMethod('phone')}>
              <Text style={[styles.toggleText, method === 'phone' && styles.toggleTextActive]}>
                Phone
              </Text>
            </TouchableOpacity>
          </View>

          {method === 'email' ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#999"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </>
          ) : (
            <View style={styles.phoneRow}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>+63</Text>
              </View>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder="9XX XXX XXXX"
                placeholderTextColor="#999"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                maxLength={10}
              />
            </View>
          )}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}>
            <Text style={styles.loginBtnText}>
              {loading ? 'Please wait...' : method === 'email' ? 'Sign In' : 'Send OTP'}
            </Text>
          </TouchableOpacity>

          {method === 'email' && (
            <TouchableOpacity style={styles.forgot}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.footerLink}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { flexGrow: 1 },
  header: {
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
  },
  logo: { fontSize: 44, fontWeight: '800', color: '#fff' },
  tagline: { fontSize: 15, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: -25,
    borderRadius: 16,
    padding: 24,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#1A1A2E', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 20, marginTop: 4 },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    marginBottom: 20,
    padding: 3,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  toggleActive: { backgroundColor: Brand.primary },
  toggleText: { fontSize: 14, color: '#6B7280', fontWeight: '600' },
  toggleTextActive: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1A1A2E',
    backgroundColor: '#FAFAFA',
    marginBottom: 14,
  },
  phoneRow: { flexDirection: 'row', gap: 10 },
  countryCode: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
    marginBottom: 14,
  },
  countryCodeText: { fontSize: 16, color: '#1A1A2E', fontWeight: '600' },
  phoneInput: { flex: 1 },
  loginBtn: {
    backgroundColor: Brand.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  forgot: { alignItems: 'center', marginTop: 16 },
  forgotText: { color: Brand.primary, fontSize: 14 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 30,
    paddingBottom: 40,
  },
  footerText: { fontSize: 14, color: '#6B7280' },
  footerLink: { fontSize: 14, color: Brand.primary, fontWeight: '700' },
});
