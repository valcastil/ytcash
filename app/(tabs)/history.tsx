import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { Brand } from '@/constants/theme';
import { CURRENCIES, formatCurrency } from '@/constants/currencies';
import { getTransactions, type Transaction } from '@/services/supabase';

type FilterType = 'all' | 'send' | 'receive' | 'scan' | 'add';

export default function HistoryScreen() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getTransactions(user.id, 50);
      setTransactions(data);
    } catch (e) {
      console.error('HistoryScreen load:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTransactions();
    setRefreshing(false);
  }, [loadTransactions]);

  const filtered = filter === 'all'
    ? transactions
    : transactions.filter((tx) => tx.type === filter);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'send', label: 'Sent' },
    { key: 'receive', label: 'Received' },
    { key: 'scan', label: 'Scanned' },
    { key: 'add', label: 'Added' },
  ];

  function txIcon(type: string): any {
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

  function renderTransaction({ item: tx }: { item: Transaction }) {
    const color = txColor(tx);
    const isOutgoing = tx.from_user === user?.id;

    return (
      <View style={styles.txCard}>
        <View style={[styles.txIconCircle, { backgroundColor: color + '15' }]}>
          <Ionicons name={txIcon(tx.type)} size={24} color={color} />
        </View>
        <View style={styles.txInfo}>
          <Text style={styles.txType}>
            {tx.type === 'send' ? 'Sent Money' :
             tx.type === 'receive' ? 'Received Money' :
             tx.type === 'scan' ? 'Cash Scanned' :
             tx.type === 'add' ? 'Money Added' : 'Transaction'}
          </Text>
          {tx.note ? <Text style={styles.txNote} numberOfLines={1}>{tx.note}</Text> : null}
          <Text style={styles.txDate}>
            {new Date(tx.created_at).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
        <View style={styles.txRight}>
          <Text style={[styles.txAmount, { color }]}>
            {isOutgoing ? '-' : '+'}{formatCurrency(tx.amount, tx.currency)}
          </Text>
          {tx.currency !== 'PHP' && (
            <Text style={styles.txConverted}>
              {'\u2248'} {formatCurrency(tx.converted_amount)}
            </Text>
          )}
          <View style={[styles.statusBadge, tx.status === 'completed' ? styles.statusCompleted : styles.statusPending]}>
            <Text style={[styles.statusText, tx.status === 'completed' ? styles.statusTextCompleted : styles.statusTextPending]}>
              {tx.status}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Brand.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Transaction History</Text>
      </View>

      {/* Filters */}
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterActive]}
            onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="receipt-outline" size={56} color="#E5E7EB" />
            <Text style={styles.emptyText}>No transactions found</Text>
            <Text style={styles.emptySub}>
              {filter !== 'all' ? 'Try a different filter' : 'Your transaction history will appear here'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: Brand.primary },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#fff' },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
  },
  filterActive: { backgroundColor: Brand.primary },
  filterText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  filterTextActive: { color: '#fff' },
  list: { padding: 16, paddingBottom: 30 },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  txIconCircle: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  txInfo: { flex: 1 },
  txType: { fontSize: 15, fontWeight: '600', color: '#1A1A2E' },
  txNote: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  txDate: { fontSize: 12, color: '#9CA3AF', marginTop: 3 },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontSize: 16, fontWeight: '700' },
  txConverted: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusCompleted: { backgroundColor: '#E3FCEF' },
  statusPending: { backgroundColor: '#FEF3C7' },
  statusText: { fontSize: 11, fontWeight: '600' },
  statusTextCompleted: { color: '#36B37E' },
  statusTextPending: { color: '#F59E0B' },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 17, fontWeight: '600', color: '#6B7280', marginTop: 14 },
  emptySub: { fontSize: 14, color: '#9CA3AF', marginTop: 4, textAlign: 'center' },
});
