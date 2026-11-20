import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { formatCurrency } from '@/constants/currencies';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import {
  acceptCashRequest,
  cancelCashRequest,
  cashierMethodLabel,
  cashRequestStatusLabel,
  completeCashHandover,
  confirmFundsReceived,
  getCashRequest,
  listCashRequestMessages,
  markFundsTransferred,
  sendCashRequestMessage,
  type CashDeliveryRequest,
  type CashRequestMessage,
} from '@/services/mobile-cashier';

const QUICK_CHIPS = [
  "I'm heading to your location now",
  "I've arrived at the location",
  'Funds transferred, please check',
  'Transfer received, handing over cash',
];

export default function CashRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;

  const [req, setReq] = useState<CashDeliveryRequest | null>(null);
  const [messages, setMessages] = useState<CashRequestMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [refInput, setRefInput] = useState('');
  const [chatText, setChatText] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [r, msgs] = await Promise.all([getCashRequest(id), listCashRequestMessages(id)]);
      setReq(r);
      setMessages(msgs);
    } catch {
      // Handled by empty state.
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function postSystemNote(body: string) {
    if (!req || !userId) return;
    await sendCashRequestMessage(
      req.id,
      userId,
      profile?.full_name || user?.email?.split('@')[0] || 'User',
      body,
    );
  }

  async function handleAccept() {
    if (!req) return;
    setBusy(true);
    try {
      const updated = await acceptCashRequest(req.id);
      if (updated) setReq(updated);
      await postSystemNote('Accepted request and heading to your location.');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkTransferred() {
    if (!req) return;
    if (refInput.trim().length < 4) {
      Alert.alert('Reference required', 'Enter the transfer reference number from your payment app.');
      return;
    }
    setBusy(true);
    try {
      const updated = await markFundsTransferred(req.id, refInput.trim());
      if (updated) setReq(updated);
      await postSystemNote(
        `Transferred ${formatCurrency(req.amount, req.currency)} via ${cashierMethodLabel(req.payment_method)} (Ref: ${refInput.trim()}).`,
      );
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmFundsReceived() {
    if (!req) return;
    Alert.alert(
      'Confirm Funds Received',
      'Confirm that the transfer has arrived in your GCash / Maya / GoTyme / Bank account before handing over cash.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Yes, Received',
          onPress: async () => {
            setBusy(true);
            try {
              const updated = await confirmFundsReceived(req.id);
              if (updated) setReq(updated);
              await postSystemNote('Confirmed funds received! Ready to hand over cash.');
              await load();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  async function handleCompleteHandover() {
    if (!req) return;
    Alert.alert(
      'Complete Cash Handover',
      'Confirm that the physical cash has been handed over?',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Confirm Completed',
          onPress: async () => {
            setBusy(true);
            try {
              const updated = await completeCashHandover(req.id);
              if (updated) setReq(updated);
              await postSystemNote('Cash handover completed!');
              await load();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  async function handleCancel() {
    if (!req) return;
    Alert.alert('Cancel Cash Request?', 'Are you sure you want to cancel this request?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Request',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const updated = await cancelCashRequest(req.id);
            if (updated) setReq(updated);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function handleSendChat(override?: string) {
    if (!req || !userId) return;
    const text = (override ?? chatText).trim();
    if (!text) return;
    if (!override) setChatText('');
    await postSystemNote(text);
    await load();
  }

  function openMaps() {
    if (!req) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${req.lat},${req.lng}`);
  }

  async function copyAccountNumber() {
    if (!req) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(req.cashier_account_number).catch(() => {});
      Alert.alert('Copied', 'Account number copied to clipboard.');
      return;
    }
    await Share.share({
      message: `${cashierMethodLabel(req.payment_method)} — ${req.cashier_account_name}: ${req.cashier_account_number}`,
    }).catch(() => {});
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Mobile Cashier Delivery" />
        <ActivityIndicator color={BitcoinColors.orange} style={{ marginTop: 40 }} />
      </View>
    );
  }

  if (!req) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Mobile Cashier Delivery" />
        <View style={{ padding: 28, alignItems: 'center' }}>
          <Text style={{ color: BitcoinColors.textSecondary }}>Cash request not found.</Text>
        </View>
      </View>
    );
  }

  const isCashier = req.cashier_id === userId;
  const isClosed = req.status === 'completed' || req.status === 'cancelled';

  const statusColor =
    req.status === 'completed'
      ? BitcoinColors.green
      : req.status === 'cancelled'
      ? BitcoinColors.red
      : req.status === 'funds_confirmed'
      ? BitcoinColors.cyan
      : BitcoinColors.orange;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Mobile Cashier Delivery" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Status Card */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={[styles.badge, { borderColor: statusColor }]}>
                <Text style={[styles.badgeText, { color: statusColor }]}>
                  {cashRequestStatusLabel(req.status)}
                </Text>
              </View>
              <Text style={styles.orderId}>#{req.id.slice(0, 8)}</Text>
            </View>

            <Text style={styles.amountBig}>{formatCurrency(req.amount, req.currency)}</Text>
            <Text style={styles.subText}>
              {isCashier
                ? `Requester: ${req.requester_name}`
                : `Mobile Cashier: ${req.cashier_name}`}
            </Text>
          </View>

          {/* Delivery Location */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={styles.rowCenter}>
                <Ionicons name="location" size={16} color={BitcoinColors.orange} />
                <Text style={styles.cardTitle}>Delivery Location</Text>
              </View>
              <TouchableOpacity onPress={openMaps} activeOpacity={0.8}>
                <Text style={styles.linkText}>Open Google Maps</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.locationText}>{req.location_label}</Text>
            {req.notes ? <Text style={styles.notesText}>Note: {req.notes}</Text> : null}
          </View>

          {/* Mobile Cashier Receiving Account */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                Pay via {cashierMethodLabel(req.payment_method)}
              </Text>
              <TouchableOpacity onPress={copyAccountNumber} activeOpacity={0.8}>
                <Text style={styles.linkText}>Copy #</Text>
              </TouchableOpacity>
            </View>
            {req.cashier_bank_name ? (
              <Text style={styles.acctLine}>Bank: {req.cashier_bank_name}</Text>
            ) : null}
            <Text style={styles.acctLine}>Account Name: {req.cashier_account_name}</Text>
            <Text style={styles.acctNum}>{req.cashier_account_number}</Text>
            {req.transfer_reference ? (
              <View style={styles.refBox}>
                <Text style={styles.refText}>Transfer Ref: {req.transfer_reference}</Text>
              </View>
            ) : null}
          </View>

          {/* Role Actions */}
          {!isClosed && (
            <View style={styles.card}>
              {isCashier ? (
                req.status === 'requested' ? (
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleAccept}
                    disabled={busy}
                    activeOpacity={0.85}>
                    <LinearGradient
                      colors={Brand.gradientButton}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.primaryBtnGrad}>
                      <Ionicons name="navigate" size={16} color="#07090E" />
                      <Text style={styles.primaryBtnText}>Accept &amp; Go to Location</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ) : req.status === 'on_the_way' ? (
                  <Text style={styles.waitText}>
                    Head to the user&apos;s location. Once they transfer{' '}
                    {formatCurrency(req.amount, req.currency)} to your{' '}
                    {cashierMethodLabel(req.payment_method)}, verify &amp; hand over the cash.
                  </Text>
                ) : req.status === 'funds_sent' ? (
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleConfirmFundsReceived}
                    disabled={busy}
                    activeOpacity={0.85}>
                    <LinearGradient
                      colors={Brand.gradientButton}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.primaryBtnGrad}>
                      <Ionicons name="checkmark-circle" size={16} color="#07090E" />
                      <Text style={styles.primaryBtnText}>Confirm Funds Received</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleCompleteHandover}
                    disabled={busy}
                    activeOpacity={0.85}>
                    <LinearGradient
                      colors={Brand.gradientButton}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.primaryBtnGrad}>
                      <Ionicons name="cash" size={16} color="#07090E" />
                      <Text style={styles.primaryBtnText}>Give Cash &amp; Complete</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )
              ) : req.status === 'requested' || req.status === 'on_the_way' ? (
                <View style={{ gap: 10 }}>
                  <Text style={styles.waitText}>
                    Transfer {formatCurrency(req.amount, req.currency)} to the Mobile Cashier&apos;s{' '}
                    {cashierMethodLabel(req.payment_method)} account above, then enter the reference
                    number so they can release the cash.
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={refInput}
                    onChangeText={setRefInput}
                    placeholder="Enter payment reference number..."
                    placeholderTextColor={BitcoinColors.textMuted}
                  />
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleMarkTransferred}
                    disabled={busy}
                    activeOpacity={0.85}>
                    <LinearGradient
                      colors={Brand.gradientButton}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.primaryBtnGrad}>
                      <Text style={styles.primaryBtnText}>I&apos;ve Transferred Funds</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              ) : req.status === 'funds_sent' ? (
                <Text style={styles.waitText}>
                  Waiting for {req.cashier_name} to confirm the funds arrived in their account.
                </Text>
              ) : (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleCompleteHandover}
                  disabled={busy}
                  activeOpacity={0.85}>
                  <LinearGradient
                    colors={Brand.gradientButton}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtnGrad}>
                    <Text style={styles.primaryBtnText}>Confirm Cash Received</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={handleCancel}
                disabled={busy}
                activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel Request</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Chat */}
          <Text style={styles.sectionTitle}>DELIVERY CHAT</Text>
          <View style={styles.card}>
            {messages.length === 0 ? (
              <Text style={styles.chatEmpty}>No messages yet.</Text>
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === userId;
                return (
                  <View
                    key={m.id}
                    style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={styles.bubbleSender}>{mine ? 'You' : m.sender_name}</Text>
                    <Text style={styles.bubbleBody}>{m.body}</Text>
                  </View>
                );
              })
            )}

            {!isClosed && (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.quickRow}>
                  {QUICK_CHIPS.map((q) => (
                    <TouchableOpacity
                      key={q}
                      style={styles.quickChip}
                      onPress={() => handleSendChat(q)}
                      activeOpacity={0.8}>
                      <Text style={styles.quickChipText}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={styles.chatInputRow}>
                  <TextInput
                    style={styles.chatInput}
                    value={chatText}
                    onChangeText={setChatText}
                    placeholder="Message..."
                    placeholderTextColor={BitcoinColors.textMuted}
                  />
                  <TouchableOpacity
                    style={styles.sendBtn}
                    onPress={() => handleSendChat()}
                    activeOpacity={0.8}>
                    <Ionicons name="send" size={16} color="#07090E" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  scroll: { padding: 20, paddingBottom: 44, gap: 14 },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  orderId: { fontSize: 11, color: BitcoinColors.textMuted, fontWeight: '700' },
  amountBig: { fontSize: 28, fontWeight: '900', color: '#FFFFFF', marginTop: 10 },
  subText: { fontSize: 13, color: BitcoinColors.textSecondary, marginTop: 4 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  linkText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.cyan },
  locationText: { fontSize: 13, color: '#FFFFFF', marginTop: 8, lineHeight: 19 },
  notesText: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 6 },
  acctLine: { fontSize: 13, color: BitcoinColors.textSecondary, marginTop: 6 },
  acctNum: { fontSize: 18, fontWeight: '900', color: BitcoinColors.orange, marginTop: 4 },
  refBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  refText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.green },
  waitText: { fontSize: 12, color: BitcoinColors.textSecondary, lineHeight: 18 },
  input: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#FFFFFF',
  },
  primaryBtn: { borderRadius: 12, overflow: 'hidden' },
  primaryBtnGrad: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 8,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
  cancelBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  cancelText: { fontSize: 13, fontWeight: '700', color: BitcoinColors.red },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginTop: 4,
  },
  chatEmpty: { fontSize: 12, color: BitcoinColors.textMuted, textAlign: 'center', paddingVertical: 8 },
  bubble: { maxWidth: '86%', padding: 10, borderRadius: 12, marginBottom: 8 },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(247, 147, 26, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  bubbleSender: { fontSize: 10, fontWeight: '800', color: BitcoinColors.textMuted, marginBottom: 2 },
  bubbleBody: { fontSize: 13, color: '#FFFFFF' },
  quickRow: { gap: 6, paddingTop: 4, paddingBottom: 8 },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  quickChipText: { fontSize: 11, fontWeight: '700', color: BitcoinColors.textSecondary },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatInput: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#FFFFFF',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: BitcoinColors.orange,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
