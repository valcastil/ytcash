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

import { p2pStatusColor } from '@/components/p2p-order-row';
import { ScreenHeader } from '@/components/screen-header';
import { formatCurrency } from '@/constants/currencies';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { confirmWithBiometrics } from '@/services/biometrics';
import {
  acceptP2POrder,
  cancelP2POrder,
  completeP2POrder,
  declineP2POrder,
  formatDistance,
  getP2POrder,
  getReleaseCode,
  orderStatusLabel,
  P2P_CODE_LENGTH,
  p2pErrorMessage,
  releaseP2POrder,
  subscribeToP2POrders,
  type P2POrder,
} from '@/services/p2p';

export default function P2POrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, refreshProfile } = useAuth();
  const userId = user?.id ?? null;

  const [order, setOrder] = useState<P2POrder | null>(null);
  const [releaseCode, setReleaseCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await getP2POrder(id);
      setOrder(next);
      setLoadError(null);
      if (next && next.sender_id === userId && (next.status === 'matched' || next.status === 'accepted')) {
        setReleaseCode(await getReleaseCode(next.id));
      }
    } catch (e) {
      setLoadError(p2pErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    return subscribeToP2POrders(`order-${id}`, load);
  }, [id, load]);

  /** Runs an order action, then refreshes the order and wallet balance. */
  async function run(action: () => Promise<unknown>, failTitle: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await Promise.all([load(), refreshProfile()]);
    } catch (e) {
      Alert.alert(failTitle, p2pErrorMessage(e));
      await load();
    } finally {
      setBusy(false);
    }
  }

  function confirmThen(title: string, message: string, confirmLabel: string, destructive: boolean, onConfirm: () => void) {
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Cash Delivery" />
        <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
      </View>
    );
  }

  if (!order || !userId) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Cash Delivery" />
        <View style={styles.messageCard}>
          <Ionicons name="information-circle-outline" size={28} color={BitcoinColors.textSecondary} />
          <Text style={styles.messageText}>
            {loadError ?? 'This delivery is no longer available to you. It may have been passed to another partner.'}
          </Text>
          {loadError && (
            <TouchableOpacity onPress={load} style={styles.outlineBtn} activeOpacity={0.8}>
              <Text style={styles.outlineBtnText}>Try again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  const role: 'sender' | 'partner' = order.sender_id === userId ? 'sender' : 'partner';
  const color = p2pStatusColor(order);
  const expired = Date.now() > new Date(order.expires_at).getTime();
  const amountText = formatCurrency(order.amount);
  const locked = order.failed_code_attempts >= 5;

  async function handleComplete() {
    if (!order) return;
    const code = codeInput.trim();
    if (code.length !== P2P_CODE_LENGTH) {
      setCodeError(`Enter the ${P2P_CODE_LENGTH}-digit code from the receiver.`);
      return;
    }
    setCodeError(null);
    if (!(await confirmWithBiometrics(userId, `Confirm receiving ${amountText}`))) return;
    await run(async () => {
      const result = await completeP2POrder(order.id, code);
      if (!result.ok) {
        setCodeInput('');
        setCodeError(
          result.reason === 'locked'
            ? 'Too many wrong codes. Ask the sender to release the payment from their app.'
            : `That code is not right. ${result.attempts_left ?? 0} tries left.`,
        );
      }
    }, 'Could not confirm');
  }

  function openMaps() {
    if (!order) return;
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${order.receiver_lat},${order.receiver_lng}`,
    ).catch(() => {});
  }

  function callReceiver() {
    if (!order) return;
    Linking.openURL(`tel:${order.receiver_phone.replace(/[^\d+]/g, '')}`).catch(() => {});
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Cash Delivery" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Summary */}
        <View style={[styles.card, { borderColor: color + '55' }]}>
          <View style={[styles.statusPill, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
            <View style={[styles.statusDot, { backgroundColor: color }]} />
            <Text style={[styles.statusText, { color }]}>{orderStatusLabel(order, role).toUpperCase()}</Text>
          </View>
          <Text style={styles.amount}>{amountText}</Text>
          <Text style={styles.amountSub}>
            {role === 'sender'
              ? `cash delivery to ${order.receiver_name}`
              : `to hand to ${order.receiver_name} in cash`}
          </Text>
        </View>

        {/* What happens next */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{role === 'sender' ? 'STATUS' : 'WHAT TO DO'}</Text>
          <Text style={styles.bodyText}>{nextStepText(order, role, expired)}</Text>
        </View>

        {/* Sender: release code */}
        {role === 'sender' && releaseCode && (order.status === 'matched' || order.status === 'accepted') && (
          <View style={[styles.card, styles.codeCard]}>
            <Text style={styles.sectionLabel}>RELEASE CODE</Text>
            <Text style={styles.code} selectable accessibilityLabel={`Release code ${releaseCode.split('').join(' ')}`}>
              {releaseCode.slice(0, 3)} {releaseCode.slice(3)}
            </Text>
            <Text style={styles.bodyText}>
              Send this code to {order.receiver_name} only. They give it to the partner after counting the
              cash. Anyone with this code can release your {amountText}.
            </Text>
          </View>
        )}

        {/* Partner: receiver details */}
        {role === 'partner' && order.status !== 'cancelled' && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>RECEIVER</Text>
            <DetailRow icon="person-outline" value={order.receiver_name} />
            <DetailRow icon="call-outline" value={order.receiver_phone} />
            <DetailRow icon="location-outline" value={order.receiver_address} />
            {order.distance_km !== null && (
              <DetailRow icon="navigate-outline" value={`${formatDistance(order.distance_km)} from your area`} />
            )}
            {order.status !== 'completed' && (
              <View style={styles.linkRow}>
                <TouchableOpacity style={styles.outlineBtn} onPress={callReceiver} activeOpacity={0.8}>
                  <Ionicons name="call" size={14} color={BitcoinColors.orange} />
                  <Text style={styles.outlineBtnText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlineBtn} onPress={openMaps} activeOpacity={0.8}>
                  <Ionicons name="map" size={14} color={BitcoinColors.orange} />
                  <Text style={styles.outlineBtnText}>Open in Maps</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Sender: delivery details */}
        {role === 'sender' && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>DELIVERY</Text>
            <DetailRow icon="person-outline" value={order.receiver_name} />
            <DetailRow icon="call-outline" value={order.receiver_phone} />
            <DetailRow icon="location-outline" value={order.receiver_address} />
            {order.status !== 'cancelled' && order.partner_name !== '' && (
              <DetailRow
                icon="bicycle-outline"
                value={`Partner: ${order.partner_name}${
                  order.distance_km !== null ? `, ${formatDistance(order.distance_km)} from the receiver` : ''
                }`}
              />
            )}
          </View>
        )}

        {/* Partner: confirm with code */}
        {role === 'partner' && order.status === 'accepted' && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>CONFIRM HAND-OVER</Text>
            {locked ? (
              <Text style={styles.errorText}>
                Too many wrong codes. Ask the sender to release the payment from their app.
              </Text>
            ) : (
              <>
                <Text style={styles.bodyText}>
                  After {order.receiver_name} has counted the cash, ask for their {P2P_CODE_LENGTH}-digit code.
                </Text>
                <TextInput
                  style={styles.codeInput}
                  value={codeInput}
                  onChangeText={(t) => {
                    setCodeInput(t.replace(/[^\d]/g, '').slice(0, P2P_CODE_LENGTH));
                    setCodeError(null);
                  }}
                  placeholder="000000"
                  placeholderTextColor={BitcoinColors.textMuted}
                  keyboardType="number-pad"
                  maxLength={P2P_CODE_LENGTH}
                  accessibilityLabel="Release code from the receiver"
                />
                {codeError && <Text style={styles.errorText}>{codeError}</Text>}
                <PrimaryButton
                  label={`Confirm and receive ${amountText}`}
                  busy={busy}
                  onPress={handleComplete}
                />
              </>
            )}
          </View>
        )}

        {/* Actions */}
        {role === 'partner' && order.status === 'matched' && (
          <PrimaryButton
            label="Accept delivery"
            busy={busy}
            onPress={() => run(() => acceptP2POrder(order.id), 'Could not accept')}
          />
        )}

        {role === 'partner' && (order.status === 'matched' || order.status === 'accepted') && (
          <SecondaryButton
            label={order.status === 'matched' ? 'Decline' : "I can't deliver this"}
            disabled={busy}
            onPress={() =>
              confirmThen(
                order.status === 'matched' ? 'Decline this delivery?' : 'Give up this delivery?',
                'It will be passed to the next closest partner. Only do this if you have not handed over any cash.',
                order.status === 'matched' ? 'Decline' : 'Give up',
                true,
                () => run(() => declineP2POrder(order.id), 'Could not decline'),
              )
            }
          />
        )}

        {role === 'sender' && order.status === 'accepted' && (
          <PrimaryButton
            label={`Release ${amountText} to ${order.partner_name}`}
            busy={busy}
            onPress={() =>
              confirmThen(
                'Release the payment?',
                `Only do this once ${order.receiver_name} confirms they have the cash. ${amountText} goes to ${order.partner_name} and cannot be taken back.`,
                'Release',
                false,
                async () => {
                  if (await confirmWithBiometrics(userId, `Confirm releasing ${amountText}`)) {
                    run(() => releaseP2POrder(order.id), 'Could not release');
                  }
                },
              )
            }
          />
        )}

        {role === 'sender' && (order.status === 'matched' || (order.status === 'accepted' && expired)) && (
          <SecondaryButton
            label="Cancel and refund"
            disabled={busy}
            onPress={() =>
              confirmThen(
                'Cancel this delivery?',
                `${amountText} goes back to your wallet.`,
                'Cancel delivery',
                true,
                () => run(() => cancelP2POrder(order.id), 'Could not cancel'),
              )
            }
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function nextStepText(order: P2POrder, role: 'sender' | 'partner', expired: boolean): string {
  const amount = formatCurrency(order.amount);
  if (order.status === 'completed') {
    return role === 'sender'
      ? `${order.receiver_name} received the cash and ${amount} was paid to ${order.partner_name}.`
      : `Done. ${amount} was added to your wallet.`;
  }
  if (order.status === 'cancelled') {
    if (role === 'partner') return 'This delivery was cancelled. Do not hand over any cash.';
    return order.cancel_reason === 'no_partner'
      ? `No partner near the receiver could take this delivery. ${amount} is back in your wallet.`
      : `You cancelled this delivery. ${amount} is back in your wallet.`;
  }
  if (role === 'sender') {
    if (order.status === 'matched') {
      return `${order.partner_name} is the closest partner to the receiver and has been asked to deliver. ${amount} is held safely until the cash is handed over.`;
    }
    return expired
      ? `${order.partner_name} accepted but has not confirmed delivery within 24 hours. You can cancel for a refund.`
      : `${order.partner_name} accepted and will bring ${amount} in cash to ${order.receiver_name}. Share the release code with the receiver now.`;
  }
  if (order.status === 'matched') {
    return `${order.sender_name} wants ${amount} in cash delivered near you. Accept if you can hand it over; you receive ${amount} in your wallet when it is confirmed.`;
  }
  return `Bring ${amount} in cash to ${order.receiver_name}. Check their name, let them count it, then enter the code they give you.`;
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
    <TouchableOpacity
      style={styles.primaryBtn}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.85}
      accessibilityRole="button">
      <LinearGradient
        colors={Brand.gradientButton}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.primaryBtnGradient}>
        {busy && <ActivityIndicator size="small" color="#07090E" />}
        <Text style={styles.primaryBtnText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.secondaryBtn}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button">
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  loader: {
    marginTop: 40,
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
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
    gap: 12,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 19,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
  },
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
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  amount: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 12,
  },
  amountSub: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#E2E8F0',
  },
  codeCard: {
    borderColor: 'rgba(255, 215, 0, 0.35)',
  },
  code: {
    fontSize: 36,
    fontWeight: '900',
    color: BitcoinColors.gold,
    letterSpacing: 6,
    textAlign: 'center',
    marginVertical: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  detailIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  detailText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#FFFFFF',
  },
  linkRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
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
  outlineBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.orange,
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
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    color: BitcoinColors.red,
    marginTop: 8,
  },
  primaryBtn: {
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#07090E',
    textAlign: 'center',
  },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
