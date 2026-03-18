import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { Brand, Colors } from '@/constants/theme';
import { CURRENCIES, formatCurrency } from '@/constants/currencies';
import { getTransactions, type Transaction } from '@/services/supabase';
import { fetchExchangeRates, type ExchangeRates } from '@/services/currency-api';

export default function HomeScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [txns, exRates] = await Promise.all([
        getTransactions(user.id, 5),
        fetchExchangeRates('PHP'),
      ]);
      setTransactions(txns);
      setRates(exRates);
    } catch (e) {
      console.error('HomeScreen loadData:', e);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadData(), refreshProfile()]);
    setRefreshing(false);
  }, [loadData, refreshProfile]);

  const balance = profile?.balance ?? 0;

  const quickActions = [
    { key: 'send', icon: 'paper-plane' as const, label: 'Send', route: '/(tabs)/send', color: '#22C55E' },
    { key: 'scan', icon: 'camera' as const, label: 'Scan Cash', route: '/(tabs)/scan', color: '#F7931A' },
    { key: 'qr', icon: 'qr-code' as const, label: 'QR Pay', route: '/qr-scanner', color: '#E8850D' },
    { key: 'add', icon: 'add-circle' as const, label: 'Add Money', route: '/add-money', color: '#F7931A' },
  ];

  function txIcon(type: string) {
    switch (type) {
      case 'send': return 'arrow-up-circle';
      case 'receive': return 'arrow-down-circle';
      case 'scan': return 'camera';
      case 'add': return 'add-circle';
      default: return 'swap-horizontal';
    }
  }

  function txColor(tx: Transaction) {
    return tx.from_user === user?.id ? '#FF5630' : '#36B37E';
  }

  return (
    <ScrollView
      style={styles.root}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {/* Header + Balance */}
      <LinearGradient colors={[Brand.primary, Brand.primaryDark]} style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>
              {getGreeting()},{' '}
              <Text style={styles.greetingName}>{profile?.full_name?.split(' ')[0] ?? 'User'}</Text>
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/profile')} style={styles.avatarBtn}>
            <Ionicons name="person-circle" size={40} color="rgba(255,255,255,0.9)" />
          </TouchableOpacity>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Total Balance</Text>
          <Text style={styles.balanceAmount}>{formatCurrency(balance)}</Text>
          <Text style={styles.balanceSub}>Philippine Peso</Text>
        </View>
      </LinearGradient>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          {quickActions.map((a) => (
            <TouchableOpacity
              key={a.key}
              style={styles.actionItem}
              onPress={() => router.push(a.route as any)}>
              <View style={[styles.actionCircle, { backgroundColor: a.color }]}>
                <Ionicons name={a.icon} size={24} color="#fff" />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Exchange Rates */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Exchange Rates (to PHP)</Text>
        <View style={styles.ratesCard}>
          {Object.entries(CURRENCIES)
            .filter(([code]) => code !== 'PHP')
            .map(([code, info]) => {
              const rate = rates?.rates?.[code];
              const phpPer1 = rate ? (1 / rate) : null;
              return (
                <View key={code} style={styles.rateRow}>
                  <Text style={styles.rateFlag}>{info.flag}</Text>
                  <Text style={styles.rateCode}>{code}</Text>
                  <Text style={styles.rateValue}>
                    {phpPer1 ? `1 ${code} = ${formatCurrency(phpPer1)}` : '...'}
                  </Text>
                </View>
              );
            })}
        </View>
      </View>

      {/* Recent Transactions */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/history')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {transactions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={48} color="#E5E7EB" />
            <Text style={styles.emptyText}>No transactions yet</Text>
            <Text style={styles.emptySub}>Send money or scan cash to get started</Text>
          </View>
        ) : (
          transactions.map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={[styles.txIcon, { backgroundColor: txColor(tx) + '20' }]}>
                <Ionicons name={txIcon(tx.type) as any} size={22} color={txColor(tx)} />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txType}>
                  {tx.type === 'send' ? 'Sent' : tx.type === 'receive' ? 'Received' : tx.type === 'scan' ? 'Cash Scanned' : 'Added'}
                </Text>
                <Text style={styles.txDate}>
                  {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={[styles.txAmount, { color: txColor(tx) }]}>
                {tx.from_user === user?.id ? '-' : '+'}{formatCurrency(tx.amount, tx.currency)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  header: { paddingTop: 56, paddingBottom: 32, paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  greeting: { color: 'rgba(255,255,255,0.85)', fontSize: 16 },
  greetingName: { fontWeight: '700', color: '#fff' },
  avatarBtn: { padding: 4 },
  balanceCard: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  balanceLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 4 },
  balanceAmount: { color: '#fff', fontSize: 34, fontWeight: '800' },
  balanceSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  section: { paddingHorizontal: 20, marginTop: 22 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A2E', marginBottom: 14 },
  seeAll: { color: Brand.primary, fontSize: 14, fontWeight: '600', marginBottom: 14 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionItem: { alignItems: 'center', width: '23%' },
  actionCircle: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  actionLabel: { fontSize: 12, color: '#6B7280', fontWeight: '500', textAlign: 'center' },
  ratesCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  rateRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  rateFlag: { fontSize: 22, marginRight: 10 },
  rateCode: { fontSize: 15, fontWeight: '600', color: '#1A1A2E', width: 44 },
  rateValue: { flex: 1, textAlign: 'right', fontSize: 14, color: '#6B7280' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#6B7280', marginTop: 12 },
  emptySub: { fontSize: 13, color: '#9CA3AF', marginTop: 4 },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  txIcon: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  txInfo: { flex: 1 },
  txType: { fontSize: 14, fontWeight: '600', color: '#1A1A2E' },
  txDate: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
});
