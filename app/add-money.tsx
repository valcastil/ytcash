import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { Brand } from '@/constants/theme';
import { formatCurrency } from '@/constants/currencies';
import { createTransaction, updateBalance } from '@/services/supabase';

export default function AddMoneyScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const quickAmounts = [100, 500, 1000, 2000, 5000];

  async function handleAddMoney() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
      // In production, this would go through Stripe payment flow
      // For now, we simulate adding money directly
      await updateBalance(user!.id, amt);
      await createTransaction({
        from_user: null,
        to_user: user!.id,
        amount: amt,
        currency: 'PHP',
        converted_amount: amt,
        converted_currency: 'PHP',
        type: 'add',
        status: 'completed',
        note: 'Added via card',
      });
      await refreshProfile();

      Alert.alert('Success!', `${formatCurrency(amt)} has been added to your wallet.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to add money. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Money</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.card}>
        <Text style={styles.balanceLabel}>Current Balance</Text>
        <Text style={styles.balanceValue}>{formatCurrency(profile?.balance ?? 0)}</Text>

        <Text style={styles.label}>Amount to Add (PHP)</Text>
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

        {/* Quick amounts */}
        <View style={styles.quickRow}>
          {quickAmounts.map((qa) => (
            <TouchableOpacity
              key={qa}
              style={[styles.quickChip, amount === String(qa) && styles.quickChipActive]}
              onPress={() => setAmount(String(qa))}>
              <Text style={[styles.quickText, amount === String(qa) && styles.quickTextActive]}>
                {'\u20B1'}{qa.toLocaleString()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Payment methods */}
        <Text style={styles.methodsTitle}>Payment Method</Text>
        <View style={styles.methodCard}>
          <Ionicons name="card" size={24} color={Brand.primary} />
          <View style={styles.methodInfo}>
            <Text style={styles.methodName}>Credit / Debit Card</Text>
            <Text style={styles.methodSub}>Powered by Stripe</Text>
          </View>
          <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
        </View>

        <TouchableOpacity
          style={[styles.addBtn, loading && styles.addBtnDisabled]}
          onPress={handleAddMoney}
          disabled={loading}>
          <Text style={styles.addBtnText}>
            {loading ? 'Processing...' : `Add ${amount ? formatCurrency(parseFloat(amount) || 0) : 'Money'}`}
          </Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Payments are processed securely via Stripe. No card data is stored on our servers.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: Brand.primary,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    padding: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  balanceLabel: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  balanceValue: { fontSize: 28, fontWeight: '800', color: '#1A1A2E', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 8 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FAFAFA',
  },
  currencySymbol: { fontSize: 24, fontWeight: '700', color: '#1A1A2E', paddingLeft: 14 },
  amountInput: { flex: 1, paddingHorizontal: 10, paddingVertical: 14, fontSize: 28, fontWeight: '700', color: '#1A1A2E' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 24 },
  quickChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F5F5F5' },
  quickChipActive: { backgroundColor: Brand.primary },
  quickText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  quickTextActive: { color: '#fff' },
  methodsTitle: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 10 },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 2,
    borderColor: Brand.primary,
    borderRadius: 12,
    marginBottom: 20,
    gap: 12,
  },
  methodInfo: { flex: 1 },
  methodName: { fontSize: 15, fontWeight: '600', color: '#1A1A2E' },
  methodSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  addBtn: {
    backgroundColor: Brand.primary,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disclaimer: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 14, lineHeight: 16 },
});
