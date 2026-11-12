import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { formatCurrency } from '@/constants/currencies';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { confirmWithBiometrics } from '@/services/biometrics';
import { isKycAdmin } from '@/services/kyc';
import {
  cancelWithdrawal,
  listMyWithdrawals,
  listPendingWithdrawals,
  maskAccount,
  methodLabel,
  requestWithdrawal,
  WITHDRAWAL_METHODS,
  WITHDRAWAL_STATUS_LABEL,
  withdrawalErrorMessage,
  type Withdrawal,
  type WithdrawalMethod,
  type WithdrawalStatus,
} from '@/services/withdrawals';

const STATUS_COLOR: Record<WithdrawalStatus, string> = {
  pending: BitcoinColors.orange,
  paid: BitcoinColors.green,
  rejected: BitcoinColors.red,
  cancelled: BitcoinColors.textMuted,
};

export default function WithdrawScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const userId = user?.id ?? null;
  const balance = profile?.balance ?? 0;
  const verified = profile?.kyc_verified ?? false;

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<WithdrawalMethod>('gcash');
  const [accountName, setAccountName] = useState(profile?.full_name ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [history, setHistory] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const methodInfo = WITHDRAWAL_METHODS.find((m) => m.value === method)!;
  const numAmount = parseFloat(amount) || 0;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [mine, isAdmin] = await Promise.all([listMyWithdrawals(userId), isKycAdmin()]);
      setHistory(mine);
      setAdmin(isAdmin);
      if (isAdmin) setQueueCount((await listPendingWithdrawals().catch(() => [])).length);
      setLoadError(null);
    } catch (e) {
      setLoadError(withdrawalErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
      refreshProfile();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), refreshProfile()]);
    setRefreshing(false);
  }

  function validate(): string | null {
    if (numAmount < 100 || numAmount > 50000) return 'Enter an amount between ₱100 and ₱50,000.';
    if (numAmount > balance) return 'Your wallet balance is too low for this amount.';
    if (accountName.trim().length < 2) return 'Enter the name on the account.';
    if (accountNumber.replace(/[^\d]/g, '').length < 7) return `Enter a valid ${methodInfo.label} number.`;
    if (method === 'bank' && bankName.trim().length < 2) return 'Enter the name of the bank.';
    return null;
  }

  function handleSubmit() {
    const problem = validate();
    if (problem) {
      Alert.alert('Check the details', problem);
      return;
    }
    const destination = `${method === 'bank' ? bankName.trim() : methodInfo.label} ${maskAccount(accountNumber.replace(/[^\d]/g, ''))}`;
    Alert.alert(
      `Withdraw ${formatCurrency(numAmount)}?`,
      `To ${accountName.trim()}, ${destination}. The amount leaves your wallet now and is sent by our team, usually within one business day.`,
      [
        { text: 'Back', style: 'cancel' },
        { text: 'Withdraw', onPress: submit },
      ],
    );
  }

  async function submit() {
    if (submitting) return;
    if (!(await confirmWithBiometrics(userId, `Confirm withdrawing ${formatCurrency(numAmount)}`))) return;
    setSubmitting(true);
    try {
      await requestWithdrawal({ amount: numAmount, method, accountName: accountName.trim(), accountNumber, bankName: bankName.trim() });
      setAmount('');
      await Promise.all([load(), refreshProfile()]);
    } catch (e) {
      Alert.alert('Could not request withdrawal', withdrawalErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel(item: Withdrawal) {
    Alert.alert('Cancel this withdrawal?', `${formatCurrency(item.amount + item.fee)} goes back to your wallet.`, [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Cancel withdrawal',
        style: 'destructive',
        onPress: async () => {
          setCancellingId(item.id);
          try {
            await cancelWithdrawal(item.id);
          } catch (e) {
            Alert.alert('Could not cancel', withdrawalErrorMessage(e));
          } finally {
            setCancellingId(null);
            await Promise.all([load(), refreshProfile()]);
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Withdraw" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BitcoinColors.orange} colors={[BitcoinColors.orange]} />
        }>
        {admin && (
          <TouchableOpacity
            style={[styles.card, styles.adminCard]}
            onPress={() => router.push('/withdraw/review')}
            activeOpacity={0.8}
            accessibilityRole="button">
            <View style={styles.adminIcon}>
              <Ionicons name="shield-checkmark" size={20} color={BitcoinColors.cyan} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.adminTitle}>Pay out withdrawals</Text>
              <Text style={styles.adminSub}>{queueCount === 0 ? 'Nothing waiting' : `${queueCount} waiting for payout`}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={BitcoinColors.textMuted} />
          </TouchableOpacity>
        )}

        <View style={styles.card}>
          <Text style={styles.balanceLabel}>AVAILABLE TO WITHDRAW</Text>
          <Text style={styles.balance}>{formatCurrency(balance)}</Text>
        </View>

        {!verified ? (
          <View style={styles.card}>
            <View style={styles.noticeRow}>
              <Ionicons name="shield-outline" size={20} color={BitcoinColors.orange} />
              <Text style={styles.noticeText}>Verify your identity before withdrawing to a bank or e-wallet.</Text>
            </View>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => router.push('/kyc')} activeOpacity={0.8}>
              <Text style={styles.outlineBtnText}>Verify identity</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>AMOUNT (PHP)</Text>
            <View style={styles.amountBox}>
              <Text style={styles.currencySymbol}>₱</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                placeholderTextColor={BitcoinColors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount to withdraw in pesos"
              />
              <TouchableOpacity onPress={() => setAmount(String(Math.min(balance, 50000)))} accessibilityRole="button">
                <Text style={styles.maxLink}>Max</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>SEND TO</Text>
            <View style={styles.methods}>
              {WITHDRAWAL_METHODS.map((m) => {
                const selected = m.value === method;
                return (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.method, selected && styles.methodSelected]}
                    onPress={() => setMethod(m.value)}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.methodText, selected && styles.methodTextSelected]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {method === 'bank' && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>BANK NAME</Text>
                <TextInput
                  style={styles.input}
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder="e.g. BDO, BPI, Metrobank"
                  placeholderTextColor={BitcoinColors.textMuted}
                  maxLength={60}
                />
              </>
            )}

            <Text style={[styles.label, styles.labelSpaced]}>ACCOUNT NAME</Text>
            <TextInput
              style={styles.input}
              value={accountName}
              onChangeText={setAccountName}
              placeholder="Name on the account"
              placeholderTextColor={BitcoinColors.textMuted}
              autoCapitalize="words"
              maxLength={80}
            />

            <Text style={[styles.label, styles.labelSpaced]}>{methodInfo.numberLabel}</Text>
            <TextInput
              style={styles.input}
              value={accountNumber}
              onChangeText={(t) => setAccountNumber(t.replace(/[^\d\s+-]/g, ''))}
              placeholder={methodInfo.placeholder}
              placeholderTextColor={BitcoinColors.textMuted}
              keyboardType="number-pad"
              maxLength={24}
            />

            <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting} activeOpacity={0.85}>
              <LinearGradient colors={Brand.gradientButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtnGradient}>
                {submitting && <ActivityIndicator size="small" color="#07090E" />}
                <Text style={styles.primaryBtnText}>{submitting ? 'Requesting…' : 'Request withdrawal'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle}>YOUR WITHDRAWALS</Text>
        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : loadError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{loadError}</Text>
          </View>
        ) : history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No withdrawals yet.</Text>
          </View>
        ) : (
          history.map((item) => {
            const color = STATUS_COLOR[item.status];
            return (
              <View key={item.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>
                      {methodLabel(item)} {maskAccount(item.account_number)}
                    </Text>
                    <Text style={[styles.rowStatus, { color }]}>{WITHDRAWAL_STATUS_LABEL[item.status]}</Text>
                  </View>
                  <View style={styles.rowAmountWrap}>
                    <Text style={styles.rowAmount}>{formatCurrency(item.amount)}</Text>
                    <Text style={styles.rowDate}>
                      {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                </View>
                {item.status === 'paid' && item.payout_reference && (
                  <Text style={styles.rowNote} selectable>
                    Reference: {item.payout_reference}
                  </Text>
                )}
                {item.status === 'rejected' && item.admin_note && <Text style={styles.rowNote}>{item.admin_note}</Text>}
                {item.status === 'pending' && (
                  <TouchableOpacity
                    onPress={() => handleCancel(item)}
                    disabled={cancellingId === item.id}
                    style={styles.cancelBtn}
                    accessibilityRole="button">
                    <Text style={styles.cancelText}>{cancellingId === item.id ? 'Cancelling…' : 'Cancel'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  flex: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  loader: { marginTop: 24 },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 12,
  },
  adminCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: 'rgba(6, 182, 212, 0.35)' },
  adminIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  adminTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  adminSub: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 2 },
  balanceLabel: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textSecondary, letterSpacing: 1 },
  balance: { fontSize: 30, fontWeight: '900', color: '#FFFFFF', marginTop: 6 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#E2E8F0' },
  outlineBtn: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
  },
  outlineBtnText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange },
  label: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textSecondary, letterSpacing: 1, marginBottom: 8 },
  labelSpaced: { marginTop: 18 },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
  },
  currencySymbol: { fontSize: 24, fontWeight: '800', color: BitcoinColors.orange, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 26, fontWeight: '800', color: '#FFFFFF', paddingVertical: 12 },
  maxLink: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange, padding: 6 },
  methods: { flexDirection: 'row', gap: 8 },
  method: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  methodSelected: { backgroundColor: 'rgba(247, 147, 26, 0.16)', borderColor: 'rgba(247, 147, 26, 0.5)' },
  methodText: { fontSize: 12, fontWeight: '700', color: BitcoinColors.textSecondary },
  methodTextSelected: { color: BitcoinColors.orange },
  input: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#FFFFFF',
  },
  primaryBtn: { marginTop: 20, borderRadius: 14, overflow: 'hidden' },
  primaryBtnGradient: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, gap: 8 },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1.1,
    marginTop: 14,
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  emptyText: { fontSize: 13, color: BitcoinColors.textSecondary, textAlign: 'center' },
  row: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  rowStatus: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  rowAmountWrap: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  rowDate: { fontSize: 11, color: BitcoinColors.textMuted, marginTop: 2 },
  rowNote: { fontSize: 12, lineHeight: 17, color: BitcoinColors.textSecondary, marginTop: 8 },
  cancelBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 4 },
  cancelText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.red },
});
