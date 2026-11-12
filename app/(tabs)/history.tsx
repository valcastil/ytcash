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
import { BitcoinColors } from '@/constants/theme';
import { formatCurrency, phpToSats } from '@/constants/currencies';
import { getTransactions, type Transaction } from '@/services/supabase';
import { BitcoinBadge } from '@/components/bitcoin-badge';

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

  const filtered =
    filter === 'all'
      ? transactions
      : transactions.filter((tx) => tx.type === filter);

  const filters: { key: FilterType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'all', label: 'All', icon: 'layers' },
    { key: 'send', label: 'Sent', icon: 'arrow-up' },
    { key: 'receive', label: 'Received', icon: 'arrow-down' },
    { key: 'scan', label: 'Scanned', icon: 'scan' },
    { key: 'add', label: 'Deposits', icon: 'flash' },
  ];

  function txIcon(type: string): keyof typeof Ionicons.glyphMap {
    switch (type) {
      case 'send':
        return 'arrow-up';
      case 'receive':
        return 'arrow-down';
      case 'scan':
        return 'scan';
      case 'add':
        return 'flash';
      default:
        return 'swap-horizontal';
    }
  }

  function txColor(tx: Transaction) {
    return tx.from_user === user?.id ? BitcoinColors.red : BitcoinColors.green;
  }

  function renderTransaction({ item: tx }: { item: Transaction }) {
    const color = txColor(tx);
    const isOutgoing = tx.from_user === user?.id;
    const satsEquiv = phpToSats(tx.amount);

    return (
      <View style={styles.txCard}>
        <View style={[styles.txIconCircle, { backgroundColor: color + '15', borderColor: color + '35' }]}>
          <Ionicons name={txIcon(tx.type)} size={22} color={color} />
        </View>

        <View style={styles.txInfo}>
          <Text style={styles.txType}>
            {tx.type === 'send'
              ? 'Payment Sent'
              : tx.type === 'receive'
              ? 'Payment Received'
              : tx.type === 'scan'
              ? 'Banknote Digitized'
              : tx.type === 'add'
              ? 'Wallet Deposit'
              : 'Transaction'}
          </Text>
          {tx.note ? (
            <Text style={styles.txNote} numberOfLines={1}>
              {tx.note}
            </Text>
          ) : null}
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
            {isOutgoing ? '-' : '+'}
            {formatCurrency(tx.amount, tx.currency)}
          </Text>
          <Text style={styles.txSatsText}>
            {isOutgoing ? '-' : '+'}
            {satsEquiv.toLocaleString()} sats
          </Text>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Settled</Text>
          </View>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <BitcoinBadge size={52} glow={true} />
        <ActivityIndicator size="large" color={BitcoinColors.orange} style={{ marginTop: 20 }} />
        <Text style={styles.loadingText}>Syncing Ledger...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <BitcoinBadge size={32} glow={false} />
          <Text style={styles.headerTitle}>Bitcoin Ledger</Text>
        </View>
        <Text style={styles.headerSub}>Complete cryptographic transaction audit trail</Text>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={filters}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.filterList}
          renderItem={({ item: f }) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                style={[styles.filterChip, active && styles.filterActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.8}>
                <Ionicons
                  name={f.icon}
                  size={14}
                  color={active ? '#07090E' : BitcoinColors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Transactions List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BitcoinColors.orange}
            colors={[BitcoinColors.orange]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="receipt-outline" size={36} color={BitcoinColors.orange} />
            </View>
            <Text style={styles.emptyText}>No ledger entries found</Text>
            <Text style={styles.emptySub}>
              {filter !== 'all'
                ? 'Try selecting a different filter category.'
                : 'Transactions will appear here with cryptographic confirmation.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BitcoinColors.darkBg,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
    marginTop: 8,
  },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: BitcoinColors.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: BitcoinColors.border,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginTop: 4,
  },
  filterRow: {
    backgroundColor: BitcoinColors.cardBg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BitcoinColors.border,
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  filterActive: {
    backgroundColor: BitcoinColors.orange,
    borderColor: BitcoinColors.gold,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  filterTextActive: {
    color: '#07090E',
  },
  list: {
    padding: 16,
    paddingBottom: 36,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  txIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginRight: 12,
  },
  txInfo: {
    flex: 1,
  },
  txType: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  txNote: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  txDate: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
    marginTop: 3,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '800',
  },
  txSatsText: {
    fontSize: 11,
    fontWeight: '600',
    color: BitcoinColors.gold,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    gap: 4,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#10B981',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  emptySub: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
});
