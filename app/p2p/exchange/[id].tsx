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
import {
  agreeMeetupLocation,
  cancelExchangeTrade,
  confirmTradeComplete,
  formatExchangeMoney,
  getExchangeTrade,
  listTradeMessages,
  sendTradeMessage,
  tradeStatusLabel,
  type P2PExchangeMessage,
  type P2PExchangeTrade,
} from '@/services/p2p-exchange';

const QUICK_REPLIES = [
  'Public location works for me',
  "I'm on my way now",
  'Arrived at the meetup spot',
  'Cash counted & ready',
];

export default function P2PExchangeRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;

  const [trade, setTrade] = useState<P2PExchangeTrade | null>(null);
  const [messages, setMessages] = useState<P2PExchangeMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [editingSpot, setEditingSpot] = useState(false);
  const [spotInput, setSpotInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [chatText, setChatText] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [t, msgs] = await Promise.all([getExchangeTrade(id), listTradeMessages(id)]);
      setTrade(t);
      setMessages(msgs);
      if (t) {
        setSpotInput((prev) => prev || t.meetup_location);
        setTimeInput((prev) => prev || t.meetup_time);
      }
    } catch {
      // Handled by empty/retry UI.
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAgreeMeetup() {
    if (!trade || !userId) return;
    if (spotInput.trim().length < 4) {
      Alert.alert('Public location required', 'Enter a clear public venue to meet at.');
      return;
    }
    setBusy(true);
    try {
      const updated = await agreeMeetupLocation(
        trade.id,
        spotInput.trim(),
        timeInput.trim() || 'Today',
      );
      if (updated) setTrade(updated);
      setEditingSpot(false);
      await sendTradeMessage(
        trade.id,
        userId,
        profile?.full_name || 'You',
        `Agreed to meet at: ${spotInput.trim()} (${timeInput.trim() || 'Today'}).`,
      );
      await load();
    } catch (e: any) {
      Alert.alert('Could not update meetup', e?.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendChat(textOverride?: string) {
    if (!trade || !userId) return;
    const body = (textOverride ?? chatText).trim();
    if (!body) return;
    if (!textOverride) setChatText('');
    try {
      await sendTradeMessage(
        trade.id,
        userId,
        profile?.full_name || user?.email?.split('@')[0] || 'You',
        body,
      );
      await load();
    } catch (e: any) {
      Alert.alert('Message failed', e?.message ?? 'Try again.');
    }
  }

  async function handleComplete() {
    if (!trade || !userId) return;
    Alert.alert(
      'Confirm Cash Exchanged',
      'Only confirm after you have counted and received the cash in person at the public meetup.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Confirm Completed',
          onPress: async () => {
            setBusy(true);
            try {
              const updated = await confirmTradeComplete(trade, userId);
              if (updated) setTrade(updated);
              await sendTradeMessage(
                trade.id,
                userId,
                profile?.full_name || 'You',
                'Confirmed that the cash exchange is complete.',
              );
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
    if (!trade) return;
    Alert.alert('Cancel Exchange Trade?', 'Cancel this meetup request?', [
      { text: 'Keep trade', style: 'cancel' },
      {
        text: 'Cancel Trade',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const updated = await cancelExchangeTrade(trade.id, 'Cancelled by participant');
            if (updated) setTrade(updated);
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  function openInMaps() {
    if (!trade) return;
    const query = encodeURIComponent(trade.meetup_location);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="P2P Exchange Room" />
        <ActivityIndicator color={BitcoinColors.orange} style={{ marginTop: 40 }} />
      </View>
    );
  }

  if (!trade) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="P2P Exchange Room" />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Trade not found.</Text>
        </View>
      </View>
    );
  }

  const isMaker = trade.maker_id === userId;
  const counterparty = isMaker ? trade.taker_name : trade.maker_name;
  const isClosed = trade.status === 'completed' || trade.status === 'cancelled';

  const statusColor =
    trade.status === 'completed'
      ? BitcoinColors.green
      : trade.status === 'cancelled'
      ? BitcoinColors.red
      : trade.status === 'agreed'
      ? BitcoinColors.cyan
      : BitcoinColors.orange;

  return (
    <View style={styles.root}>
      <ScreenHeader title="P2P Exchange Room" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Status + Stepper */}
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <View style={[styles.statusBadge, { borderColor: statusColor }]}>
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {tradeStatusLabel(trade.status)}
                </Text>
              </View>
              <Text style={styles.tradeId}>#{trade.id.slice(0, 8)}</Text>
            </View>

            <View style={styles.amountRow}>
              <View>
                <Text style={styles.amountLabel}>EXCHANGE AMOUNT</Text>
                <Text style={styles.amountBig}>
                  {formatExchangeMoney(trade.offer_amount, trade.offer_currency)}
                </Text>
              </View>
              <Ionicons name="swap-horizontal" size={22} color={BitcoinColors.orange} />
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.amountLabel}>LOCAL CASH</Text>
                <Text style={styles.amountBig}>
                  {formatExchangeMoney(trade.local_amount, trade.local_currency)}
                </Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                Rate: 1 {trade.offer_currency} = {formatExchangeMoney(trade.rate, trade.local_currency)}
              </Text>
              <Text style={styles.metaText}>With: {counterparty}</Text>
            </View>
          </View>

          {/* Public Meetup Location Card */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.rowCenter}>
                <Ionicons name="location" size={18} color={BitcoinColors.orange} />
                <Text style={styles.cardTitle}>Public Meetup Location</Text>
              </View>
              <TouchableOpacity onPress={openInMaps} activeOpacity={0.8}>
                <Text style={styles.linkText}>Open Maps</Text>
              </TouchableOpacity>
            </View>

            {editingSpot ? (
              <View style={{ marginTop: 10, gap: 8 }}>
                <TextInput
                  style={styles.input}
                  value={spotInput}
                  onChangeText={setSpotInput}
                  placeholder="Public venue (mall, cafe, bank lobby)"
                  placeholderTextColor={BitcoinColors.textMuted}
                />
                <TextInput
                  style={styles.input}
                  value={timeInput}
                  onChangeText={setTimeInput}
                  placeholder="Meetup time (e.g. Today 3:30 PM)"
                  placeholderTextColor={BitcoinColors.textMuted}
                />
              </View>
            ) : (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.spotText}>{trade.meetup_location}</Text>
                <Text style={styles.timeText}>Time: {trade.meetup_time || 'To be agreed'}</Text>
              </View>
            )}

            {!isClosed && (
              <View style={styles.meetupActions}>
                {!trade.meetup_agreed || editingSpot ? (
                  <TouchableOpacity
                    style={styles.agreeBtn}
                    onPress={handleAgreeMeetup}
                    disabled={busy}
                    activeOpacity={0.85}>
                    <Ionicons name="checkmark-circle" size={16} color="#07090E" />
                    <Text style={styles.agreeBtnText}>Agree on Public Spot</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.agreedPill}>
                    <Ionicons name="shield-checkmark" size={14} color={BitcoinColors.green} />
                    <Text style={styles.agreedText}>Public meetup agreed</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.editSpotBtn}
                  onPress={() => setEditingSpot((v) => !v)}
                  activeOpacity={0.8}>
                  <Text style={styles.editSpotText}>
                    {editingSpot ? 'Done' : 'Change Spot / Time'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Safety reminder */}
          <View style={styles.safetyBanner}>
            <Ionicons name="shield-half-outline" size={16} color={BitcoinColors.orange} />
            <Text style={styles.safetyText}>
              Always meet in a busy public venue during daylight. Count and verify banknotes in person before confirming.
            </Text>
          </View>

          {/* Chat */}
          <Text style={styles.sectionTitle}>MEETUP COORDINATION CHAT</Text>
          <View style={styles.chatBox}>
            {messages.length === 0 ? (
              <Text style={styles.chatEmpty}>
                Send a message to coordinate your exact public meeting spot and time.
              </Text>
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
                  {QUICK_REPLIES.map((q) => (
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
                    placeholder="Message counterparty..."
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

          {/* Trade Actions */}
          {!isClosed && (
            <View style={styles.footerActions}>
              <TouchableOpacity
                style={styles.completeBtn}
                onPress={handleComplete}
                disabled={busy}
                activeOpacity={0.85}>
                <LinearGradient
                  colors={Brand.gradientButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.completeGradient}>
                  {busy ? (
                    <ActivityIndicator color="#07090E" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-done" size={18} color="#07090E" />
                      <Text style={styles.completeText}>Confirm Cash Exchanged</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={handleCancel}
                disabled={busy}
                activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel Trade</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  scroll: {
    padding: 20,
    paddingBottom: 44,
  },
  emptyWrap: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: BitcoinColors.textSecondary,
    fontSize: 14,
  },
  statusCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  tradeId: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
    fontWeight: '700',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  amountLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    letterSpacing: 0.8,
  },
  amountBig: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  metaText: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    fontWeight: '600',
  },
  card: {
    marginTop: 14,
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.cyan,
  },
  spotText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  timeText: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginTop: 4,
  },
  input: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#FFFFFF',
  },
  meetupActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  agreeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BitcoinColors.green,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  agreeBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#07090E',
  },
  agreedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
  },
  agreedText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.green,
  },
  editSpotBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  editSpotText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
  },
  safetyText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: BitcoinColors.textSecondary,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 8,
  },
  chatBox: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 8,
  },
  chatEmpty: {
    fontSize: 12,
    color: BitcoinColors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  bubble: {
    maxWidth: '86%',
    padding: 10,
    borderRadius: 12,
  },
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
  bubbleSender: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    marginBottom: 2,
  },
  bubbleBody: {
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 18,
  },
  quickRow: {
    gap: 6,
    paddingTop: 6,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
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
  footerActions: {
    marginTop: 18,
    gap: 10,
  },
  completeBtn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  completeGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  completeText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#07090E',
  },
  cancelBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.35)',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '800',
    color: BitcoinColors.red,
  },
});
