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
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { formatCurrency } from '@/constants/currencies';
import { BitcoinColors } from '@/constants/theme';
import {
  listPendingWithdrawals,
  markWithdrawalPaid,
  methodLabel,
  rejectWithdrawal,
  withdrawalErrorMessage,
  type Withdrawal,
} from '@/services/withdrawals';

/** Which request has its "mark paid" or "reject" box open. */
type OpenAction = { id: string; kind: 'pay' | 'reject' } | null;

export default function WithdrawalReviewScreen() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenAction>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listPendingWithdrawals());
      setError(null);
    } catch (e) {
      setError(withdrawalErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function toggle(id: string, kind: 'pay' | 'reject') {
    setText('');
    setOpen((current) => (current?.id === id && current.kind === kind ? null : { id, kind }));
  }

  async function save(item: Withdrawal) {
    if (!open || busy) return;
    if (open.kind === 'pay' && text.trim().length < 3) {
      Alert.alert('Add the reference', 'Enter the reference number of the transfer you sent.');
      return;
    }
    if (open.kind === 'reject' && text.trim().length < 5) {
      Alert.alert('Add a reason', 'Tell the user what to fix, for example "Account name does not match your ID".');
      return;
    }
    setBusy(true);
    try {
      if (open.kind === 'pay') await markWithdrawalPaid(item.id, text);
      else await rejectWithdrawal(item.id, text);
      setOpen(null);
      setText('');
    } catch (e) {
      Alert.alert('Could not save', withdrawalErrorMessage(e));
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Pay Out Withdrawals" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BitcoinColors.orange} colors={[BitcoinColors.orange]} />
        }>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={16} color={BitcoinColors.orange} />
          <Text style={styles.infoText}>
            Send the money yourself first, then mark the request paid with the transfer reference. Marking paid
            cannot be undone. The amount is already out of the user&apos;s wallet.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-outline" size={26} color={BitcoinColors.green} />
            <Text style={styles.emptyText}>Nothing waiting for payout.</Text>
          </View>
        ) : (
          items.map((item) => {
            const isOpen = open?.id === item.id;
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
                  <Text style={styles.date}>
                    {new Date(item.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <DetailRow label="User" value={item.user_name} />
                <DetailRow label="Send to" value={methodLabel(item)} />
                <DetailRow label="Account name" value={item.account_name} />
                <DetailRow label="Number" value={item.account_number} />
                {item.fee > 0 && <DetailRow label="Fee kept" value={formatCurrency(item.fee)} />}

                {isOpen && (
                  <>
                    <TextInput
                      style={styles.input}
                      value={text}
                      onChangeText={setText}
                      placeholder={open.kind === 'pay' ? 'Transfer reference number' : 'Reason (shown to the user)'}
                      placeholderTextColor={BitcoinColors.textMuted}
                      maxLength={open.kind === 'pay' ? 60 : 300}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, open.kind === 'pay' ? styles.payBtn : styles.rejectBtn]}
                      onPress={() => save(item)}
                      disabled={busy}
                      activeOpacity={0.85}>
                      {busy && <ActivityIndicator size="small" color={open.kind === 'pay' ? '#07090E' : '#FFFFFF'} />}
                      <Text style={open.kind === 'pay' ? styles.payText : styles.rejectText}>
                        {open.kind === 'pay' ? `Confirm ${formatCurrency(item.amount)} was sent` : 'Reject and refund'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                <View style={styles.buttons}>
                  <TouchableOpacity
                    style={[styles.btn, styles.rejectOutline, isOpen && open.kind === 'reject' && styles.btnActive]}
                    onPress={() => toggle(item.id, 'reject')}
                    disabled={busy}
                    activeOpacity={0.85}>
                    <Text style={styles.rejectOutlineText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.payOutline, isOpen && open.kind === 'pay' && styles.btnActive]}
                    onPress={() => toggle(item.id, 'pay')}
                    disabled={busy}
                    activeOpacity={0.85}>
                    <Text style={styles.payOutlineText}>Mark paid</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  scroll: { padding: 20, paddingBottom: 40 },
  loader: { marginTop: 40 },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
    marginBottom: 14,
  },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#E2E8F0' },
  emptyCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 10,
  },
  emptyText: { fontSize: 13, color: BitcoinColors.textSecondary, textAlign: 'center' },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  amount: { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  date: { fontSize: 12, color: BitcoinColors.textMuted },
  detailRow: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  detailLabel: { width: 104, fontSize: 12, color: BitcoinColors.textMuted },
  detailValue: { flex: 1, fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  input: {
    marginTop: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#FFFFFF',
  },
  saveBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 13,
    borderRadius: 14,
  },
  payBtn: { backgroundColor: BitcoinColors.green },
  payText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
  rejectBtn: { backgroundColor: BitcoinColors.red },
  rejectText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1 },
  btnActive: { opacity: 0.55 },
  rejectOutline: { borderColor: 'rgba(244, 63, 94, 0.5)', backgroundColor: 'rgba(244, 63, 94, 0.08)' },
  rejectOutlineText: { fontSize: 13, fontWeight: '800', color: BitcoinColors.red },
  payOutline: { borderColor: 'rgba(16, 185, 129, 0.5)', backgroundColor: 'rgba(16, 185, 129, 0.08)' },
  payOutlineText: { fontSize: 13, fontWeight: '800', color: BitcoinColors.green },
});
