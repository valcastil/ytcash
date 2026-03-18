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
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { Brand } from '@/constants/theme';
import { formatCurrency } from '@/constants/currencies';
import { supabase, createTransaction, updateBalance } from '@/services/supabase';

export default function SendMoneyScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [recipientProfile, setRecipientProfile] = useState<any>(null);

  async function lookupRecipient() {
    if (!recipient.trim()) {
      Alert.alert('Error', 'Please enter a phone number or email');
      return;
    }

    setLoading(true);
    try {
      const isEmail = recipient.includes('@');
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, phone')
        .eq(isEmail ? 'email' : 'phone', recipient.trim())
        .single();

      if (error || !data) {
        Alert.alert('Not Found', 'No user found with that email or phone number.');
        return;
      }
      if (data.id === user?.id) {
        Alert.alert('Error', 'You cannot send money to yourself.');
        return;
      }

      setRecipientProfile(data);
      setStep('confirm');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (amt > (profile?.balance ?? 0)) {
      Alert.alert('Insufficient Balance', 'You do not have enough balance for this transfer.');
      return;
    }

    setLoading(true);
    try {
      await createTransaction({
        from_user: user!.id,
        to_user: recipientProfile.id,
        amount: amt,
        currency: 'PHP',
        converted_amount: amt,
        converted_currency: 'PHP',
        type: 'send',
        status: 'completed',
        note: note || null,
      });

      await updateBalance(user!.id, -amt);
      await updateBalance(recipientProfile.id, amt);
      await refreshProfile();

      Alert.alert(
        'Success!',
        `${formatCurrency(amt)} sent to ${recipientProfile.full_name ?? 'user'}.`,
        [{ text: 'OK', onPress: resetForm }],
      );
    } catch (err: any) {
      Alert.alert('Transfer Failed', err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setRecipient('');
    setAmount('');
    setNote('');
    setRecipientProfile(null);
    setStep('input');
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Send Money</Text>
          <Text style={styles.headerSub}>
            Available: {formatCurrency(profile?.balance ?? 0)}
          </Text>
        </View>

        {step === 'input' ? (
          <View style={styles.card}>
            <Text style={styles.label}>Recipient</Text>
            <TextInput
              style={styles.input}
              placeholder="Email or phone number"
              placeholderTextColor="#999"
              value={recipient}
              onChangeText={setRecipient}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.label}>Amount (PHP)</Text>
            <View style={styles.amountRow}>
              <Text style={styles.currencySymbol}>{'\u20B1'}</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="0.00"
                placeholderTextColor="#999"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />
            </View>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={[styles.input, styles.noteInput]}
              placeholder="What's this for?"
              placeholderTextColor="#999"
              value={note}
              onChangeText={setNote}
              multiline
            />

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={lookupRecipient}
              disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Searching...' : 'Continue'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.confirmTitle}>Confirm Transfer</Text>

            <View style={styles.confirmRow}>
              <Ionicons name="person-circle" size={48} color={Brand.primary} />
              <View style={styles.confirmInfo}>
                <Text style={styles.confirmName}>{recipientProfile?.full_name ?? 'User'}</Text>
                <Text style={styles.confirmDetail}>
                  {recipientProfile?.email ?? recipientProfile?.phone}
                </Text>
              </View>
            </View>

            <View style={styles.confirmAmountBox}>
              <Text style={styles.confirmAmountLabel}>Amount</Text>
              <Text style={styles.confirmAmount}>{formatCurrency(parseFloat(amount) || 0)}</Text>
            </View>

            {note ? (
              <View style={styles.confirmNoteBox}>
                <Text style={styles.confirmNoteLabel}>Note</Text>
                <Text style={styles.confirmNote}>{note}</Text>
              </View>
            ) : null}

            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, loading && styles.btnDisabled]}
                onPress={handleSend}
                disabled={loading}>
                <Ionicons name="paper-plane" size={18} color="#fff" />
                <Text style={styles.sendBtnText}>{loading ? 'Sending...' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { flexGrow: 1, paddingBottom: 30 },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: Brand.primary },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    padding: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: '#1A1A2E',
    backgroundColor: '#FAFAFA',
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, backgroundColor: '#FAFAFA' },
  currencySymbol: { fontSize: 22, fontWeight: '700', color: '#1A1A2E', paddingLeft: 14 },
  amountInput: { flex: 1, paddingHorizontal: 10, paddingVertical: 13, fontSize: 24, fontWeight: '700', color: '#1A1A2E' },
  noteInput: { height: 80, textAlignVertical: 'top' },
  btn: { backgroundColor: Brand.primary, borderRadius: 10, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  confirmTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', textAlign: 'center', marginBottom: 20 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  confirmInfo: { marginLeft: 14 },
  confirmName: { fontSize: 17, fontWeight: '700', color: '#1A1A2E' },
  confirmDetail: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  confirmAmountBox: { backgroundColor: '#F5F5F5', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  confirmAmountLabel: { fontSize: 13, color: '#6B7280', marginBottom: 4 },
  confirmAmount: { fontSize: 32, fontWeight: '800', color: '#1A1A2E' },
  confirmNoteBox: { backgroundColor: '#F5F5F5', borderRadius: 12, padding: 14, marginBottom: 12 },
  confirmNoteLabel: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  confirmNote: { fontSize: 14, color: '#1A1A2E' },
  confirmButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  sendBtn: { flex: 1, backgroundColor: '#36B37E', borderRadius: 10, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  sendBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
