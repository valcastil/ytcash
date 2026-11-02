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
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors, Brand } from '@/constants/theme';
import { formatCurrency, phpToSats } from '@/constants/currencies';
import { createTransaction, updateBalance } from '@/services/supabase';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function AddMoneyScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'lightning'>('card');

  const quickAmounts = [100, 500, 1000, 2000, 5000];
  const numAmount = parseFloat(amount) || 0;
  const satsAmount = phpToSats(numAmount);

  async function handleAddMoney() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
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
        note: `Deposit via ${selectedMethod === 'card' ? 'Stripe Card' : 'Lightning Network'}`,
      });
      await refreshProfile();

      Alert.alert(
        'Deposit Confirmed!',
        `${formatCurrency(amt)} (${satsAmount.toLocaleString()} sats) has been added to your wallet.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Deposit Funds</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.card}>
        <View style={styles.balanceHeader}>
          <View>
            <Text style={styles.balanceLabel}>CURRENT WALLET BALANCE</Text>
            <Text style={styles.balanceValue}>{formatCurrency(profile?.balance ?? 0)}</Text>
          </View>
          <BitcoinBadge size={44} glow={false} />
        </View>

        <Text style={styles.label}>AMOUNT TO DEPOSIT (PHP)</Text>
        <View style={styles.amountBox}>
          <View style={styles.amountRow}>
            <Text style={styles.currencySymbol}>₱</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={BitcoinColors.textMuted}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>

          {numAmount > 0 && (
            <View style={styles.satsConversionRow}>
              <Text style={styles.satsConversionIcon}>⚡</Text>
              <Text style={styles.satsConversionText}>
                Yields ≈ {satsAmount.toLocaleString()} SATS
              </Text>
            </View>
          )}
        </View>

        {/* Quick amounts */}
        <View style={styles.quickRow}>
          {quickAmounts.map((qa) => (
            <TouchableOpacity
              key={qa}
              style={[styles.quickChip, amount === String(qa) && styles.quickChipActive]}
              onPress={() => setAmount(String(qa))}>
              <Text style={[styles.quickText, amount === String(qa) && styles.quickTextActive]}>
                ₱{qa.toLocaleString()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Payment methods */}
        <Text style={styles.methodsTitle}>DEPOSIT CHANNEL</Text>

        <TouchableOpacity
          style={[styles.methodCard, selectedMethod === 'card' && styles.methodCardActive]}
          onPress={() => setSelectedMethod('card')}
          activeOpacity={0.8}>
          <View style={styles.methodIconWrap}>
            <Ionicons name="card" size={22} color={BitcoinColors.orange} />
          </View>
          <View style={styles.methodInfo}>
            <Text style={styles.methodName}>Credit / Debit Card</Text>
            <Text style={styles.methodSub}>Instant fiat settlement via Stripe</Text>
          </View>
          <Ionicons
            name={selectedMethod === 'card' ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selectedMethod === 'card' ? BitcoinColors.orange : BitcoinColors.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, selectedMethod === 'lightning' && styles.methodCardActive]}
          onPress={() => setSelectedMethod('lightning')}
          activeOpacity={0.8}>
          <View style={[styles.methodIconWrap, { backgroundColor: 'rgba(255, 208, 38, 0.15)' }]}>
            <Ionicons name="flash" size={22} color={BitcoinColors.lightning} />
          </View>
          <View style={styles.methodInfo}>
            <Text style={styles.methodName}>Bitcoin Lightning Invoice</Text>
            <Text style={styles.methodSub}>Pay with any Lightning wallet (Strike, Cash App, Blink)</Text>
          </View>
          <Ionicons
            name={selectedMethod === 'lightning' ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selectedMethod === 'lightning' ? BitcoinColors.orange : BitcoinColors.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.addBtn, loading && styles.addBtnDisabled]}
          onPress={handleAddMoney}
          disabled={loading}
          activeOpacity={0.85}>
          <LinearGradient colors={Brand.gradientButton} style={styles.addBtnGradient}>
            <Ionicons name="flash" size={18} color="#07090E" />
            <Text style={styles.addBtnText}>
              {loading
                ? 'Processing Deposit...'
                : `Deposit ${amount ? formatCurrency(numAmount) : 'Funds'}`}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Security verified • End-to-end encrypted • Zero processing fees
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  scroll: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: BitcoinColors.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: BitcoinColors.border,
  },
  backBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  card: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
  },
  balanceValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  amountBox: {
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    borderRadius: 16,
    padding: 16,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '900',
    color: BitcoinColors.orange,
    marginRight: 10,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  satsConversionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    gap: 4,
  },
  satsConversionIcon: {
    color: BitcoinColors.lightning,
    fontSize: 12,
  },
  satsConversionText: {
    color: BitcoinColors.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  quickChip: {
    flex: 1,
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  quickChipActive: {
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderColor: BitcoinColors.orange,
  },
  quickText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  quickTextActive: {
    color: BitcoinColors.orange,
  },
  methodsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 10,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  methodCardActive: {
    borderColor: 'rgba(247, 147, 26, 0.5)',
    backgroundColor: 'rgba(247, 147, 26, 0.06)',
  },
  methodIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  methodInfo: {
    flex: 1,
  },
  methodName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  methodSub: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  addBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 18,
  },
  addBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 8,
  },
  addBtnText: {
    color: '#07090E',
    fontWeight: '800',
    fontSize: 15,
  },
  addBtnDisabled: {
    opacity: 0.6,
  },
  disclaimer: {
    textAlign: 'center',
    fontSize: 11,
    color: BitcoinColors.textMuted,
    marginTop: 14,
  },
});
