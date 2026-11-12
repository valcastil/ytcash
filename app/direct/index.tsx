import React, { useCallback, useEffect, useState } from 'react';
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
import {
  directErrorMessage,
  directStatusColor,
  directStatusLabel,
  isDirectOpen,
  listDirectOrders,
  listPayoutAccounts,
  PAY_METHOD_LABEL,
  PAY_METHODS,
  removePayoutAccount,
  savePayoutAccount,
  subscribeToDirect,
  type DirectOrder,
  type PayMethod,
  type PayoutAccount,
} from '@/services/direct';
import { getPartnerProfile } from '@/services/p2p';

type Tab = 'send' | 'deliver';

const STEPS = [
  'Enter your friend’s address and pick the nearest partner on the map.',
  'Chat with the partner. They bring the cash to your friend.',
  'Your friend gives the partner the OTP code you sent them.',
  'Only then do you pay the partner from your GCash, GoTyme or Maya.',
];

export default function DirectPayHubScreen() {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;

  const [tab, setTab] = useState<Tab>('send');
  const [sent, setSent] = useState<DirectOrder[]>([]);
  const [assigned, setAssigned] = useState<DirectOrder[]>([]);
  const [accounts, setAccounts] = useState<PayoutAccount[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<PayMethod | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [orders, payout, partner] = await Promise.all([
        listDirectOrders(userId),
        listPayoutAccounts(userId),
        getPartnerProfile(userId).catch(() => null),
      ]);
      setSent(orders.sent);
      setAssigned(orders.assigned);
      setAccounts(payout);
      setAvailable(partner?.is_available ?? false);
      setLoadError(null);
    } catch (e) {
      setLoadError(directErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!userId) return;
    return subscribeToDirect(`hub-${userId}`, load);
  }, [userId, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function startEdit(method: PayMethod) {
    const existing = accounts.find((a) => a.method === method);
    setAccountName(existing?.account_name ?? profile?.full_name ?? '');
    setAccountNumber(existing?.account_number ?? '');
    setEditing(method);
  }

  async function handleSave() {
    if (!editing || saving) return;
    if (accountName.trim().length < 2 || accountNumber.replace(/[^\d]/g, '').length < 7) {
      Alert.alert('Check the details', 'Enter the name on the account and its number.');
      return;
    }
    setSaving(true);
    try {
      await savePayoutAccount(editing, accountName.trim(), accountNumber);
      setEditing(null);
      await load();
    } catch (e) {
      Alert.alert('Could not save', directErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(method: PayMethod) {
    setSaving(true);
    try {
      await removePayoutAccount(method);
      setEditing(null);
      await load();
    } catch (e) {
      Alert.alert('Could not remove', directErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const list = tab === 'send' ? sent : assigned;
  const openAssigned = assigned.filter(isDirectOpen).length;
  const listed = available && accounts.length > 0;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Direct Pay" />

      <View style={styles.tabs}>
        {(['send', 'deliver'] as const).map((key) => {
          const selected = tab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => setTab(key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected }}>
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {key === 'send' ? 'Send cash' : 'Deliver cash'}
              </Text>
              {key === 'deliver' && openAssigned > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{openAssigned}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BitcoinColors.orange} colors={[BitcoinColors.orange]} />
        }>
        {tab === 'send' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pay the partner yourself, after delivery</Text>
            {STEPS.map((step, i) => (
              <View key={step} style={styles.stepRow}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepNumber}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/direct/new')} activeOpacity={0.85} accessibilityRole="button">
              <LinearGradient colors={Brand.gradientButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtnGradient}>
                <Ionicons name="map" size={16} color="#07090E" />
                <Text style={styles.primaryBtnText}>Find a partner</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Where senders pay you</Text>
            <Text style={styles.cardBody}>
              Add at least one account to receive Direct Pay requests. Senders see the number only after you have
              handed over the cash.
            </Text>

            {PAY_METHODS.map((method) => {
              const account = accounts.find((a) => a.method === method);
              const isEditing = editing === method;
              return (
                <View key={method} style={styles.accountBlock}>
                  <TouchableOpacity
                    style={styles.accountRow}
                    onPress={() => (isEditing ? setEditing(null) : startEdit(method))}
                    activeOpacity={0.8}
                    accessibilityRole="button">
                    <View style={styles.flex}>
                      <Text style={styles.accountMethod}>{PAY_METHOD_LABEL[method]}</Text>
                      <Text style={styles.accountDetail}>
                        {account ? `${account.account_name} · ${account.account_number}` : 'Not added'}
                      </Text>
                    </View>
                    <Text style={styles.accountAction}>{isEditing ? 'Close' : account ? 'Edit' : 'Add'}</Text>
                  </TouchableOpacity>

                  {isEditing && (
                    <View style={styles.accountForm}>
                      <TextInput
                        style={styles.input}
                        value={accountName}
                        onChangeText={setAccountName}
                        placeholder="Name on the account"
                        placeholderTextColor={BitcoinColors.textMuted}
                        autoCapitalize="words"
                        maxLength={80}
                      />
                      <TextInput
                        style={[styles.input, styles.inputSpaced]}
                        value={accountNumber}
                        onChangeText={(t) => setAccountNumber(t.replace(/[^\d\s+-]/g, ''))}
                        placeholder={method === 'gotyme' ? 'Account number' : '09XX XXX XXXX'}
                        placeholderTextColor={BitcoinColors.textMuted}
                        keyboardType="number-pad"
                        maxLength={24}
                      />
                      <View style={styles.formButtons}>
                        {account && (
                          <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(method)} disabled={saving} activeOpacity={0.8}>
                            <Text style={styles.removeText}>Remove</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
                          {saving && <ActivityIndicator size="small" color="#07090E" />}
                          <Text style={styles.saveText}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}

            <View style={styles.listedRow}>
              <Ionicons
                name={listed ? 'checkmark-circle' : 'information-circle-outline'}
                size={16}
                color={listed ? BitcoinColors.green : BitcoinColors.orange}
              />
              <Text style={styles.listedText}>
                {listed
                  ? 'You are listed. Senders near your area can see your first name and general area on the map.'
                  : accounts.length === 0
                  ? 'Add an account above to be listed.'
                  : 'Turn on "Deliver cash near me" to be listed.'}
              </Text>
              {!available && (
                <TouchableOpacity onPress={() => router.push('/p2p')} accessibilityRole="button">
                  <Text style={styles.linkText}>Open</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>{tab === 'send' ? 'YOUR DELIVERIES' : 'REQUESTS FOR YOU'}</Text>

        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : loadError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{loadError}</Text>
          </View>
        ) : list.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{tab === 'send' ? 'No deliveries yet.' : 'No requests yet.'}</Text>
          </View>
        ) : (
          list.map((order) => {
            const role = tab === 'send' ? 'sender' : 'partner';
            const color = directStatusColor(order);
            return (
              <TouchableOpacity
                key={order.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/direct/[id]', params: { id: order.id } })}
                activeOpacity={0.75}
                accessibilityRole="button">
                <View style={styles.flex}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {role === 'sender' ? `To ${order.receiver_name}` : `Cash for ${order.receiver_name}`}
                  </Text>
                  <Text style={[styles.rowStatus, { color }]} numberOfLines={1}>
                    {directStatusLabel(order, role)}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.rowAmount}>{formatCurrency(order.amount)}</Text>
                  <Text style={styles.rowMeta}>{PAY_METHOD_LABEL[order.method]}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={BitcoinColors.textMuted} />
              </TouchableOpacity>
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
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 16,
    padding: 4,
    borderRadius: 14,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  tab: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 10, borderRadius: 10, gap: 6 },
  tabSelected: { backgroundColor: 'rgba(247, 147, 26, 0.16)' },
  tabText: { fontSize: 13, fontWeight: '700', color: BitcoinColors.textSecondary },
  tabTextSelected: { color: BitcoinColors.orange },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BitcoinColors.orange,
  },
  tabBadgeText: { fontSize: 11, fontWeight: '800', color: '#07090E' },
  scroll: { padding: 20, paddingBottom: 40 },
  loader: { marginTop: 24 },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF', marginBottom: 10 },
  cardBody: { fontSize: 12, lineHeight: 18, color: BitcoinColors.textSecondary, marginBottom: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
  },
  stepNumber: { fontSize: 11, fontWeight: '800', color: BitcoinColors.orange },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#E2E8F0' },
  primaryBtn: { marginTop: 8, borderRadius: 14, overflow: 'hidden' },
  primaryBtnGradient: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 13, gap: 8 },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
  accountBlock: { borderTopWidth: 1, borderTopColor: BitcoinColors.border },
  accountRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  accountMethod: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  accountDetail: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 2 },
  accountAction: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange },
  accountForm: { paddingBottom: 14 },
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
  inputSpaced: { marginTop: 8 },
  formButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
  removeBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(244, 63, 94, 0.5)' },
  removeText: { fontSize: 13, fontWeight: '800', color: BitcoinColors.red },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: BitcoinColors.orange,
  },
  saveText: { fontSize: 13, fontWeight: '800', color: '#07090E' },
  listedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  listedText: { flex: 1, fontSize: 12, lineHeight: 17, color: BitcoinColors.textSecondary },
  linkText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1.1,
    marginTop: 26,
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
  emptyText: { fontSize: 13, lineHeight: 19, color: BitcoinColors.textSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 12,
  },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  rowStatus: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  rowMeta: { fontSize: 11, color: BitcoinColors.textMuted, marginTop: 2 },
});
