import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
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
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { confirmWithBiometrics } from '@/services/biometrics';
import {
  acceptDirectOrder,
  cancelDirectOrder,
  confirmDirectDelivery,
  confirmDirectPayment,
  declineDirectOrder,
  DIRECT_CODE_LENGTH,
  directErrorMessage,
  directStatusColor,
  directStatusLabel,
  formatDirectAmount,
  formatKm,
  getDirectCode,
  getDirectOrder,
  getPaymentDetails,
  isDirectOpen,
  listDirectMessages,
  markDirectPaid,
  PAY_METHOD_LABEL,
  reportDirectUnpaid,
  sendDirectMessage,
  subscribeToDirect,
  type DirectMessage,
  type DirectOrder,
} from '@/services/direct';

type Role = 'sender' | 'partner';

/** How far along the four steps an order is. */
function stepsDone(order: DirectOrder): number {
  switch (order.status) {
    case 'accepted':
      return 1;
    case 'delivered':
    case 'disputed':
    case 'unpaid':
      return 2;
    case 'paid':
      return 3;
    case 'completed':
      return 4;
    default:
      return 0;
  }
}

export default function DirectOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [order, setOrder] = useState<DirectOrder | null>(null);
  const [otp, setOtp] = useState<string | null>(null);
  const [payTo, setPayTo] = useState<{ account_name: string; account_number: string } | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await getDirectOrder(id);
      setOrder(next);
      setLoadError(null);
      if (next) {
        const [code, details, chat] = await Promise.all([
          next.sender_id === userId && (next.status === 'requested' || next.status === 'accepted')
            ? getDirectCode(next.id)
            : Promise.resolve(null),
          getPaymentDetails(next.id),
          listDirectMessages(next.id).catch(() => []),
        ]);
        setOtp(code);
        setPayTo(details);
        setMessages(chat);
      }
    } catch (e) {
      setLoadError(directErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    return subscribeToDirect(`order-${id}`, load);
  }, [id, load]);

  // Live updates may not be switched on for every project, so also check periodically while open.
  const open = order ? isDirectOpen(order) : false;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [open, load]);

  async function run(action: () => Promise<unknown>, failTitle: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      Alert.alert(failTitle, directErrorMessage(e));
      await load();
    } finally {
      setBusy(false);
    }
  }

  function confirmThen(title: string, message: string, label: string, destructive: boolean, onConfirm: () => void) {
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      { text: label, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ]);
  }

  if (loading || !order || !userId) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Direct Pay" />
        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : (
          <View style={styles.messageCard}>
            <Text style={styles.messageText}>{loadError ?? 'This delivery is not available to you.'}</Text>
          </View>
        )}
      </View>
    );
  }

  const role: Role = order.sender_id === userId ? 'sender' : 'partner';
  const color = directStatusColor(order);
  const amountText = formatDirectAmount(order.amount, order.currency);
  const app = PAY_METHOD_LABEL[order.method];
  const done = stepsDone(order);
  const locked = order.failed_code_attempts >= 5;
  const awaitingPayment = order.status === 'delivered' || order.status === 'disputed' || order.status === 'unpaid';

  const steps =
    role === 'sender'
      ? [
          `${order.partner_name} accepts`,
          `${order.receiver_name} gets the cash and gives the OTP`,
          `You pay ${order.partner_name} by ${app}`,
          `${order.partner_name} confirms the payment`,
        ]
      : [
          'You accept',
          `You hand over the cash and enter the OTP`,
          `${order.sender_name} pays your ${app}`,
          'You confirm the payment',
        ];

  async function handleEnterCode() {
    if (!order) return;
    const code = codeInput.trim();
    if (code.length !== DIRECT_CODE_LENGTH) {
      setCodeError(`Enter the ${DIRECT_CODE_LENGTH}-digit OTP from the receiver.`);
      return;
    }
    setCodeError(null);
    await run(async () => {
      const result = await confirmDirectDelivery(order.id, code);
      if (!result.ok) {
        setCodeInput('');
        setCodeError(
          result.reason === 'locked'
            ? 'Too many wrong codes. Ask the sender to check the OTP with you in the chat.'
            : `That code is not right. ${result.attempts_left ?? 0} tries left.`,
        );
      }
    }, 'Could not confirm');
  }

  async function handleMarkPaid() {
    if (!order) return;
    if (reference.trim().length < 4) {
      Alert.alert('Add the reference', `Enter the reference number shown in ${app} after you paid.`);
      return;
    }
    if (!(await confirmWithBiometrics(userId, `Confirm you paid ${amountText}`))) return;
    await run(() => markDirectPaid(order.id, reference), 'Could not save');
  }

  async function handleSendMessage() {
    if (!order || sending) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await sendDirectMessage(order.id, body);
      setDraft('');
      setMessages(await listDirectMessages(order.id));
    } catch (e) {
      Alert.alert('Message not sent', directErrorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const other = role === 'sender' ? order.partner_name : order.sender_name;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Direct Pay" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Summary */}
        <View style={[styles.card, { borderColor: color + '55' }]}>
          <View style={[styles.statusPill, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
            <View style={[styles.statusDot, { backgroundColor: color }]} />
            <Text style={[styles.statusText, { color }]}>{directStatusLabel(order, role).toUpperCase()}</Text>
          </View>
          <Text style={styles.amount}>{amountText}</Text>
          <Text style={styles.amountSub}>
            {role === 'sender' ? `cash to ${order.receiver_name} via ${order.partner_name}` : `cash for ${order.receiver_name}, paid by ${app}`}
          </Text>
        </View>

        {/* Steps */}
        {!['declined', 'cancelled'].includes(order.status) && (
          <View style={styles.card}>
            {steps.map((label, i) => {
              const isDone = i < done;
              const isNext = i === done && done < 4;
              return (
                <View key={label} style={styles.stepRow}>
                  <View style={[styles.stepBadge, isDone && styles.stepBadgeDone, isNext && styles.stepBadgeNext]}>
                    {isDone ? (
                      <Ionicons name="checkmark" size={13} color="#07090E" />
                    ) : (
                      <Text style={[styles.stepNumber, isNext && styles.stepNumberNext]}>{i + 1}</Text>
                    )}
                  </View>
                  <Text style={[styles.stepText, isDone && styles.stepTextDone, isNext && styles.stepTextNext]}>{label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {(order.status === 'declined' || order.status === 'cancelled') && (
          <View style={styles.card}>
            <Text style={styles.bodyText}>
              {order.status === 'declined'
                ? role === 'sender'
                  ? `${order.partner_name} cannot deliver this one. No money was sent. You can choose another partner.`
                  : 'You declined this request.'
                : role === 'sender'
                ? 'You cancelled this delivery. No money was sent.'
                : 'The sender cancelled this delivery. Do not hand over any cash.'}
            </Text>
          </View>
        )}

        {/* Sender: OTP */}
        {role === 'sender' && otp && (order.status === 'requested' || order.status === 'accepted') && (
          <View style={[styles.card, styles.codeCard]}>
            <Text style={styles.label}>OTP CODE FOR {order.receiver_name.toUpperCase()}</Text>
            <Text style={styles.code} selectable accessibilityLabel={`OTP code ${otp.split('').join(' ')}`}>
              {otp.slice(0, 3)} {otp.slice(3)}
            </Text>
            <Text style={styles.bodyText}>
              Send this code to {order.receiver_name} only, not to the partner. They give it to {order.partner_name}{' '}
              after counting the cash. Once it is entered, you owe {order.partner_name} {amountText}.
            </Text>
          </View>
        )}

        {/* Sender: pay now */}
        {role === 'sender' && awaitingPayment && (
          <View style={[styles.card, styles.payCard]}>
            <Text style={styles.label}>PAY {order.partner_name.toUpperCase()} NOW</Text>
            {order.status !== 'delivered' && (
              <Text style={styles.warnText}>
                {order.partner_name} reported that this has not been paid. You cannot start new deliveries until it is.
              </Text>
            )}
            <Text style={styles.bodyText}>
              {order.receiver_name} has the cash. Open your {app} app and send {amountText} to:
            </Text>
            {payTo ? (
              <View style={styles.payBox}>
                <Text style={styles.payApp}>{app}</Text>
                <Text style={styles.payNumber} selectable>
                  {payTo.account_number}
                </Text>
                <Text style={styles.payName} selectable>
                  {payTo.account_name}
                </Text>
              </View>
            ) : (
              <Text style={styles.warnText}>The account details could not be loaded. Pull down to refresh.</Text>
            )}
            <Text style={[styles.label, styles.labelSpaced]}>{app.toUpperCase()} REFERENCE NUMBER</Text>
            <TextInput
              style={styles.input}
              value={reference}
              onChangeText={setReference}
              placeholder="From your payment receipt"
              placeholderTextColor={BitcoinColors.textMuted}
              autoCapitalize="characters"
              maxLength={60}
            />
            <PrimaryButton label={`I have paid ${amountText}`} busy={busy} onPress={handleMarkPaid} />
          </View>
        )}

        {role === 'sender' && order.status === 'paid' && (
          <View style={styles.card}>
            <Text style={styles.bodyText}>
              You marked this as paid (reference {order.payment_reference}). Waiting for {order.partner_name} to confirm
              they received it.
            </Text>
          </View>
        )}

        {/* Partner: receiver details */}
        {role === 'partner' && ['requested', 'accepted'].includes(order.status) && (
          <View style={styles.card}>
            <Text style={styles.label}>DELIVER TO</Text>
            <DetailRow icon="person-outline" value={order.receiver_name} />
            {order.status === 'accepted' && <DetailRow icon="call-outline" value={order.receiver_phone} />}
            <DetailRow icon="location-outline" value={order.receiver_address} />
            {order.distance_km !== null && <DetailRow icon="navigate-outline" value={`${formatKm(order.distance_km)} from your area`} />}
            {order.status === 'accepted' && (
              <View style={styles.linkRow}>
                <TouchableOpacity
                  style={styles.outlineBtn}
                  onPress={() => Linking.openURL(`tel:${order.receiver_phone.replace(/[^\d+]/g, '')}`).catch(() => {})}
                  activeOpacity={0.8}>
                  <Ionicons name="call" size={14} color={BitcoinColors.orange} />
                  <Text style={styles.outlineBtnText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.outlineBtn}
                  onPress={() =>
                    Linking.openURL(
                      `https://www.google.com/maps/search/?api=1&query=${order.receiver_lat},${order.receiver_lng}`,
                    ).catch(() => {})
                  }
                  activeOpacity={0.8}>
                  <Ionicons name="map" size={14} color={BitcoinColors.orange} />
                  <Text style={styles.outlineBtnText}>Open in Google Maps</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Partner: warning before accepting */}
        {role === 'partner' && order.status === 'requested' && (
          <View style={styles.infoBox}>
            <Ionicons name="alert-circle" size={16} color={BitcoinColors.orange} />
            <Text style={styles.infoText}>
              You hand over {amountText} of your own cash first and {order.sender_name} pays your {app} afterwards.
              YTCash does not hold this money. Only accept if you are comfortable with that.
            </Text>
          </View>
        )}

        {/* Partner: enter OTP */}
        {role === 'partner' && order.status === 'accepted' && (
          <View style={styles.card}>
            <Text style={styles.label}>ENTER THE RECEIVER&apos;S OTP</Text>
            {locked ? (
              <Text style={styles.warnText}>Too many wrong codes. Ask the sender to check the OTP with you in the chat.</Text>
            ) : (
              <>
                <Text style={styles.bodyText}>
                  After {order.receiver_name} has counted the cash, ask for their {DIRECT_CODE_LENGTH}-digit code. Entering
                  it tells {order.sender_name} to pay you.
                </Text>
                <TextInput
                  style={styles.codeInput}
                  value={codeInput}
                  onChangeText={(t) => {
                    setCodeInput(t.replace(/[^\d]/g, '').slice(0, DIRECT_CODE_LENGTH));
                    setCodeError(null);
                  }}
                  placeholder="000000"
                  placeholderTextColor={BitcoinColors.textMuted}
                  keyboardType="number-pad"
                  maxLength={DIRECT_CODE_LENGTH}
                  accessibilityLabel="OTP code from the receiver"
                />
                {codeError && <Text style={styles.warnText}>{codeError}</Text>}
                <PrimaryButton label="Confirm cash handed over" busy={busy} onPress={handleEnterCode} />
              </>
            )}
          </View>
        )}

        {/* Partner: waiting for / checking payment */}
        {role === 'partner' && (awaitingPayment || order.status === 'paid') && (
          <View style={[styles.card, styles.payCard]}>
            <Text style={styles.label}>{order.status === 'paid' ? 'CHECK YOUR PAYMENT' : 'WAITING FOR PAYMENT'}</Text>
            <Text style={styles.bodyText}>
              {order.status === 'paid'
                ? `${order.sender_name} says they sent ${amountText} to your ${app}. Reference: ${order.payment_reference}. Check your ${app} before confirming.`
                : order.status === 'delivered'
                ? `${order.sender_name} has been told to send ${amountText} to your ${app}${payTo ? ` (${payTo.account_number})` : ''}.`
                : `You reported this as not paid. If the payment arrives, confirm it below.`}
            </Text>
            <PrimaryButton
              label={`I received ${amountText}`}
              busy={busy}
              onPress={() =>
                confirmThen(
                  'Confirm you were paid?',
                  `Only confirm after you see ${amountText} in your ${app}. This cannot be undone.`,
                  'I was paid',
                  false,
                  () => run(() => confirmDirectPayment(order.id), 'Could not confirm'),
                )
              }
            />
            {(order.status === 'delivered' || order.status === 'paid') && (
              <SecondaryButton
                label="Report: not paid"
                disabled={busy}
                onPress={() =>
                  confirmThen(
                    'Report non-payment?',
                    `${order.sender_name} will be blocked from new deliveries until this is paid. You can report 30 minutes after the hand-over.`,
                    'Report',
                    true,
                    () => run(() => reportDirectUnpaid(order.id), 'Could not report'),
                  )
                }
              />
            )}
          </View>
        )}

        {order.status === 'completed' && (
          <View style={styles.card}>
            <Text style={styles.bodyText}>
              {role === 'sender'
                ? `Done. ${order.receiver_name} received ${amountText} and ${order.partner_name} confirmed your payment.`
                : `Done. You delivered ${amountText} and confirmed the payment.`}
            </Text>
          </View>
        )}

        {/* Actions */}
        {role === 'partner' && order.status === 'requested' && (
          <PrimaryButton label="Accept delivery" busy={busy} onPress={() => run(() => acceptDirectOrder(order.id), 'Could not accept')} />
        )}
        {role === 'partner' && (order.status === 'requested' || order.status === 'accepted') && (
          <SecondaryButton
            label={order.status === 'requested' ? 'Decline' : "I can't deliver this"}
            disabled={busy}
            onPress={() =>
              confirmThen(
                'Decline this delivery?',
                'Only do this if you have not handed over any cash.',
                'Decline',
                true,
                () => run(() => declineDirectOrder(order.id), 'Could not decline'),
              )
            }
          />
        )}
        {role === 'sender' && (order.status === 'requested' || order.status === 'accepted') && (
          <SecondaryButton
            label="Cancel delivery"
            disabled={busy}
            onPress={() =>
              confirmThen(
                'Cancel this delivery?',
                'Tell the partner in the chat too, so they do not travel for nothing.',
                'Cancel delivery',
                true,
                () => run(() => cancelDirectOrder(order.id), 'Could not cancel'),
              )
            }
          />
        )}

        {/* Chat */}
        <View style={[styles.card, styles.chatCard]}>
          <Text style={styles.label}>CHAT WITH {other.toUpperCase()}</Text>
          {messages.length === 0 ? (
            <Text style={styles.chatEmpty}>
              No messages yet. Agree a time and place here. Never share the OTP in this chat.
            </Text>
          ) : (
            messages.map((message) => {
              const mine = message.author_id === userId;
              return (
                <View key={message.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={styles.bubbleText} selectable>
                    {message.body}
                  </Text>
                  <Text style={styles.bubbleTime}>
                    {mine ? 'You' : other} ·{' '}
                    {new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
              );
            })
          )}
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              value={draft}
              onChangeText={setDraft}
              placeholder={`Message ${other}`}
              placeholderTextColor={BitcoinColors.textMuted}
              maxLength={500}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
              onPress={handleSendMessage}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message">
              {sending ? <ActivityIndicator size="small" color="#07090E" /> : <Ionicons name="send" size={16} color="#07090E" />}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DetailRow({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={BitcoinColors.textSecondary} style={styles.detailIcon} />
      <Text style={styles.detailText} selectable>
        {value}
      </Text>
    </View>
  );
}

function PrimaryButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} disabled={busy} activeOpacity={0.85} accessibilityRole="button">
      <LinearGradient colors={Brand.gradientButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtnGradient}>
        {busy && <ActivityIndicator size="small" color="#07090E" />}
        <Text style={styles.primaryBtnText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.secondaryBtn} onPress={onPress} disabled={disabled} activeOpacity={0.8} accessibilityRole="button">
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  loader: { marginTop: 40 },
  scroll: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 12,
  },
  messageCard: {
    margin: 20,
    padding: 24,
    borderRadius: 18,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    alignItems: 'center',
  },
  messageText: { fontSize: 13, lineHeight: 19, color: BitcoinColors.textSecondary, textAlign: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  amount: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', textAlign: 'center', marginTop: 12 },
  amountSub: { fontSize: 13, color: BitcoinColors.textSecondary, textAlign: 'center', marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  stepBadgeDone: { backgroundColor: BitcoinColors.green, borderColor: BitcoinColors.green },
  stepBadgeNext: { borderColor: BitcoinColors.orange, backgroundColor: 'rgba(247, 147, 26, 0.15)' },
  stepNumber: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textMuted },
  stepNumberNext: { color: BitcoinColors.orange },
  stepText: { flex: 1, fontSize: 13, lineHeight: 18, color: BitcoinColors.textMuted },
  stepTextDone: { color: BitcoinColors.textSecondary },
  stepTextNext: { color: '#FFFFFF', fontWeight: '700' },
  label: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textSecondary, letterSpacing: 1, marginBottom: 8 },
  labelSpaced: { marginTop: 16 },
  bodyText: { fontSize: 13, lineHeight: 19, color: '#E2E8F0' },
  warnText: { fontSize: 12, lineHeight: 17, color: BitcoinColors.red, marginTop: 8, marginBottom: 4 },
  codeCard: { borderColor: 'rgba(255, 215, 0, 0.35)' },
  code: {
    fontSize: 36,
    fontWeight: '900',
    color: BitcoinColors.gold,
    letterSpacing: 6,
    textAlign: 'center',
    marginVertical: 8,
  },
  payCard: { borderColor: 'rgba(255, 215, 0, 0.35)' },
  payBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    alignItems: 'center',
  },
  payApp: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: BitcoinColors.textSecondary },
  payNumber: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1, marginTop: 4 },
  payName: { fontSize: 14, fontWeight: '700', color: BitcoinColors.textSecondary, marginTop: 2 },
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
  codeInput: {
    marginTop: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingVertical: 12,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  detailIcon: { marginRight: 10, marginTop: 1 },
  detailText: { flex: 1, fontSize: 14, lineHeight: 19, color: '#FFFFFF' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
  },
  outlineBtnText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
    marginBottom: 12,
  },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#E2E8F0' },
  primaryBtn: { marginTop: 12, borderRadius: 14, overflow: 'hidden' },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 8,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E', textAlign: 'center' },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  chatCard: { marginTop: 12 },
  chatEmpty: { fontSize: 12, lineHeight: 18, color: BitcoinColors.textMuted, marginBottom: 10 },
  bubble: { maxWidth: '85%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, marginBottom: 8 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: 'rgba(247, 147, 26, 0.18)' },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: BitcoinColors.cardElevated },
  bubbleText: { fontSize: 14, lineHeight: 19, color: '#FFFFFF' },
  bubbleTime: { fontSize: 10, color: BitcoinColors.textMuted, marginTop: 3 },
  chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  chatInput: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#FFFFFF',
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BitcoinColors.orange,
  },
  sendBtnDisabled: { opacity: 0.4 },
});
