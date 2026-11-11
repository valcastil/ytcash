import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { usePresence } from '@/contexts/presence';
import { BitcoinColors, Brand } from '@/constants/theme';
import {
  CURRENCIES,
  formatCurrency,
  phpToBtc,
  phpToSats,
  APPROX_PHP_PER_BTC,
} from '@/constants/currencies';
import { getTransactions, type Transaction } from '@/services/supabase';
import { fetchExchangeRates, type ExchangeRates } from '@/services/currency-api';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function HomeScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const { onlineUsers, status: presenceStatus } = usePresence();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [displayMode, setDisplayMode] = useState<'fiat' | 'sats'>('fiat');

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
  const btcBalance = phpToBtc(balance);
  const satsBalance = phpToSats(balance);

  const quickActions = [
    {
      key: 'send',
      icon: 'arrow-up' as const,
      label: 'Send',
      sub: 'Transfer',
      route: '/(tabs)/send',
      color: BitcoinColors.orange,
    },
    {
      key: 'scan',
      icon: 'camera' as const,
      label: 'Scan Cash',
      sub: 'Digitize',
      route: '/(tabs)/scan',
      color: '#10B981',
    },
    {
      key: 'qr',
      icon: 'qr-code' as const,
      label: 'QR Pay',
      sub: 'Invoice',
      route: '/qr-scanner',
      color: BitcoinColors.lightning,
    },
    {
      key: 'add',
      icon: 'add' as const,
      label: 'Deposit',
      sub: 'Top Up',
      route: '/add-money',
      color: '#06B6D4',
    },
  ];

  function txIcon(type: string) {
    switch (type) {
      case 'send':
        return 'arrow-up-right';
      case 'receive':
        return 'arrow-down-left';
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

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={BitcoinColors.orange}
          colors={[BitcoinColors.orange]}
        />
      }>
      {/* Top Header / Profile Bar */}
      <View style={styles.topBar}>
        <View style={styles.brandingRow}>
          <BitcoinBadge size={34} glow={false} />
          <View style={styles.brandingTextWrap}>
            <Text style={styles.appName}>
              YT<Text style={styles.appNameAccent}>CASH</Text>
            </Text>
            <View style={styles.networkBadge}>
              <View style={styles.networkDot} />
              <Text style={styles.networkText}>⚡ LIGHTNING READY</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity onPress={() => router.push('/profile')} style={styles.avatarBtn}>
          <LinearGradient colors={[BitcoinColors.orange, '#9945FF']} style={styles.avatarGradient}>
            <Ionicons name="person" size={18} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Hero Bitcoin Balance Card */}
      <View style={styles.heroCardContainer}>
        <LinearGradient
          colors={['#1E160A', '#131825', '#0C0F17']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}>
          {/* Subtle geometric / coin background accent */}
          <View style={styles.heroCardHeader}>
            <View>
              <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>
              <TouchableOpacity
                onPress={() => setDisplayMode(displayMode === 'fiat' ? 'sats' : 'fiat')}
                activeOpacity={0.7}
                style={styles.balanceRow}>
                {displayMode === 'fiat' ? (
                  <Text style={styles.balanceAmount}>{formatCurrency(balance)}</Text>
                ) : (
                  <Text style={styles.balanceAmountSats}>
                    {satsBalance.toLocaleString()}{' '}
                    <Text style={styles.satsUnit}>SATS</Text>
                  </Text>
                )}
                <View style={styles.togglePill}>
                  <Text style={styles.togglePillText}>
                    {displayMode === 'fiat' ? 'PHP ⇄ SATS' : 'SATS ⇄ PHP'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <BitcoinBadge size={52} glow={true} />
          </View>

          {/* Crypto Equiv Pill */}
          <View style={styles.cryptoEquivRow}>
            <View style={styles.cryptoPill}>
              <Text style={styles.cryptoPillSymbol}>₿</Text>
              <Text style={styles.cryptoPillText}>~{btcBalance.toFixed(6)} BTC</Text>
            </View>
            <View style={[styles.cryptoPill, styles.satsPill]}>
              <Text style={styles.satsLightning}>⚡</Text>
              <Text style={styles.satsPillText}>{satsBalance.toLocaleString()} sats</Text>
            </View>
          </View>

          {/* Card footer CTA buttons */}
          <View style={styles.cardActionRow}>
            <TouchableOpacity
              style={styles.cardPrimaryBtn}
              onPress={() => router.push('/(tabs)/send')}
              activeOpacity={0.8}>
              <LinearGradient
                colors={Brand.gradientButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cardBtnGradient}>
                <Ionicons name="arrow-up" size={16} color="#0B0E14" />
                <Text style={styles.cardPrimaryBtnText}>Send Money</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cardSecondaryBtn}
              onPress={() => router.push('/add-money')}
              activeOpacity={0.8}>
              <Ionicons name="add" size={16} color={BitcoinColors.orange} />
              <Text style={styles.cardSecondaryBtnText}>Deposit</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Quick Actions Grid */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>QUICK ACTIONS</Text>
        <View style={styles.actionsGrid}>
          {quickActions.map((a) => (
            <TouchableOpacity
              key={a.key}
              style={styles.actionCard}
              onPress={() => router.push(a.route as any)}
              activeOpacity={0.75}>
              <View style={[styles.actionIconWrap, { backgroundColor: a.color + '1A', borderColor: a.color + '4D' }]}>
                <Ionicons name={a.icon} size={22} color={a.color} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
              <Text style={styles.actionSub}>{a.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* P2P Cash Delivery */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.onlineCard, styles.p2pCard]}
          onPress={() => router.push('/p2p')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Open P2P cash delivery">
          <View style={[styles.onlineIconWrap, styles.p2pIconWrap]}>
            <Ionicons name="people" size={22} color={BitcoinColors.orange} />
          </View>
          <View style={styles.onlineTextWrap}>
            <Text style={styles.onlineTitle}>P2P Cash Delivery</Text>
            <Text style={[styles.onlineSub, styles.p2pSub]}>
              Send cash through the partner closest to your receiver
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={BitcoinColors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Users Online — opens the live map */}
      <View style={[styles.section, styles.sectionTight]}>
        <TouchableOpacity
          style={styles.onlineCard}
          onPress={() => router.push('/online-map')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Open the map of users online">
          <View style={styles.onlineIconWrap}>
            <Ionicons name="earth" size={22} color={BitcoinColors.green} />
          </View>
          <View style={styles.onlineTextWrap}>
            <Text style={styles.onlineTitle}>Users Online</Text>
            <View style={styles.onlineSubRow}>
              <View
                style={[
                  styles.onlineDot,
                  presenceStatus !== 'online' && { backgroundColor: BitcoinColors.textMuted },
                ]}
              />
              <Text style={styles.onlineSub}>
                {presenceStatus === 'online'
                  ? `${onlineUsers.length} online now · View map`
                  : presenceStatus === 'connecting'
                  ? 'Connecting…'
                  : 'View map'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={BitcoinColors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Bitcoin & Market Rates Spotlight */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>MARKET & EXCHANGE RATES</Text>
          <View style={styles.liveIndicator}>
            <View style={styles.livePulse} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>

        {/* Featured Bitcoin Spotlight Card */}
        <View style={styles.btcSpotlightCard}>
          <LinearGradient
            colors={['rgba(247, 147, 26, 0.12)', 'rgba(18, 23, 34, 0.95)']}
            style={styles.btcSpotlightGradient}>
            <View style={styles.btcSpotlightTop}>
              <View style={styles.btcHeaderGroup}>
                <BitcoinBadge size={36} glow={false} />
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.btcTitle}>Bitcoin</Text>
                  <Text style={styles.btcSubtitle}>BTC / PHP • Benchmark</Text>
                </View>
              </View>
              <View style={styles.changeBadge}>
                <Ionicons name="trending-up" size={13} color="#10B981" />
                <Text style={styles.changeBadgeText}>+3.84%</Text>
              </View>
            </View>

            <View style={styles.btcPriceRow}>
              <Text style={styles.btcPrice}>
                {formatCurrency(APPROX_PHP_PER_BTC, 'PHP')}
              </Text>
              <Text style={styles.satsExchangeTag}>
                1 PHP ≈ {(100000000 / APPROX_PHP_PER_BTC).toFixed(1)} sats
              </Text>
            </View>
          </LinearGradient>
        </View>

        {/* Global FX Rates */}
        <View style={styles.ratesContainer}>
          {Object.entries(CURRENCIES)
            .filter(([code]) => code !== 'PHP' && code !== 'BTC' && code !== 'SATS')
            .map(([code, info]) => {
              const rate = rates?.rates?.[code];
              const phpPer1 = rate ? 1 / rate : null;
              return (
                <View key={code} style={styles.rateRow}>
                  <View style={styles.rateLeft}>
                    <Text style={styles.rateFlag}>{info.flag}</Text>
                    <View>
                      <Text style={styles.rateCode}>{code}</Text>
                      <Text style={styles.rateName}>{info.name}</Text>
                    </View>
                  </View>
                  <Text style={styles.rateValue}>
                    {phpPer1 ? `1 ${code} = ${formatCurrency(phpPer1)}` : 'Loading...'}
                  </Text>
                </View>
              );
            })}
        </View>
      </View>

      {/* Recent Ledger Transactions */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>RECENT TRANSACTIONS</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/history')}>
            <Text style={styles.seeAll}>View All</Text>
          </TouchableOpacity>
        </View>

        {transactions.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="receipt-outline" size={32} color={BitcoinColors.orange} />
            </View>
            <Text style={styles.emptyText}>No activity recorded yet</Text>
            <Text style={styles.emptySub}>
              Send money or scan physical cash to generate your first Bitcoin ledger entry.
            </Text>
          </View>
        ) : (
          transactions.map((tx) => {
            const isOutgoing = tx.from_user === user?.id;
            const color = txColor(tx);
            const satsEquiv = phpToSats(tx.amount);
            return (
              <View key={tx.id} style={styles.txRow}>
                <View style={[styles.txIcon, { backgroundColor: color + '1F', borderColor: color + '40' }]}>
                  <Ionicons name={txIcon(tx.type) as any} size={20} color={color} />
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txType}>
                    {tx.type === 'send'
                      ? 'Payment Sent'
                      : tx.type === 'receive'
                      ? 'Payment Received'
                      : tx.type === 'scan'
                      ? 'Cash Scanned'
                      : 'Funds Deposited'}
                  </Text>
                  <Text style={styles.txDate}>
                    {new Date(tx.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <View style={styles.txAmountWrap}>
                  <Text style={[styles.txAmount, { color }]}>
                    {isOutgoing ? '-' : '+'}
                    {formatCurrency(tx.amount, tx.currency)}
                  </Text>
                  <Text style={styles.txSatsSub}>
                    {isOutgoing ? '-' : '+'}
                    {satsEquiv.toLocaleString()} sats
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  brandingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandingTextWrap: {
    marginLeft: 10,
  },
  appName: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  appNameAccent: {
    color: BitcoinColors.orange,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5,
  },
  networkText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 0.6,
  },
  avatarBtn: {
    padding: 2,
  },
  avatarGradient: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  heroCardContainer: {
    paddingHorizontal: 20,
    marginTop: 4,
  },
  heroCard: {
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    elevation: 8,
    shadowColor: BitcoinColors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  heroCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  balanceRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  balanceAmount: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  balanceAmountSats: {
    fontSize: 30,
    fontWeight: '900',
    color: BitcoinColors.gold,
    letterSpacing: -0.5,
  },
  satsUnit: {
    fontSize: 14,
    fontWeight: '700',
    color: BitcoinColors.orange,
  },
  togglePill: {
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
    marginTop: 4,
  },
  togglePillText: {
    color: BitcoinColors.orangeLight,
    fontSize: 10,
    fontWeight: '700',
  },
  cryptoEquivRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
  },
  cryptoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cryptoPillSymbol: {
    color: BitcoinColors.orange,
    fontSize: 13,
    fontWeight: '800',
    marginRight: 4,
  },
  cryptoPillText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  satsPill: {
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderColor: 'rgba(247, 147, 26, 0.25)',
  },
  satsLightning: {
    color: BitcoinColors.lightning,
    fontSize: 11,
    marginRight: 3,
  },
  satsPillText: {
    color: BitcoinColors.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  cardActionRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  cardPrimaryBtn: {
    flex: 1.2,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  cardPrimaryBtnText: {
    color: '#07090E',
    fontWeight: '800',
    fontSize: 14,
  },
  cardSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
    borderRadius: 14,
    paddingVertical: 12,
    gap: 4,
  },
  cardSecondaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 26,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1.1,
    marginBottom: 12,
  },
  seeAll: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.orange,
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionCard: {
    width: '23%',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  actionSub: {
    fontSize: 9,
    fontWeight: '500',
    color: BitcoinColors.textMuted,
    marginTop: 2,
  },
  onlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  onlineIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  onlineTextWrap: {
    flex: 1,
  },
  onlineTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  onlineSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 6,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BitcoinColors.green,
  },
  onlineSub: {
    fontSize: 12,
    fontWeight: '600',
    color: BitcoinColors.textSecondary,
  },
  sectionTight: {
    marginTop: 12,
  },
  p2pCard: {
    borderColor: 'rgba(247, 147, 26, 0.35)',
  },
  p2pIconWrap: {
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  p2pSub: {
    marginTop: 3,
    lineHeight: 17,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 12,
    gap: 4,
  },
  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10B981',
  },
  btcSpotlightCard: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    marginBottom: 12,
  },
  btcSpotlightGradient: {
    padding: 16,
  },
  btcSpotlightTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btcHeaderGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btcTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  btcSubtitle: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 3,
  },
  changeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#10B981',
  },
  btcPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 14,
  },
  btcPrice: {
    fontSize: 22,
    fontWeight: '900',
    color: BitcoinColors.gold,
    letterSpacing: -0.3,
  },
  satsExchangeTag: {
    fontSize: 11,
    fontWeight: '600',
    color: BitcoinColors.orangeLight,
  },
  ratesContainer: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  rateLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rateFlag: {
    fontSize: 20,
    marginRight: 10,
  },
  rateCode: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  rateName: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
  },
  rateValue: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  emptyCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 4,
  },
  emptySub: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  txIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
  txDate: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
    marginTop: 2,
  },
  txAmountWrap: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '800',
  },
  txSatsSub: {
    fontSize: 10,
    fontWeight: '600',
    color: BitcoinColors.textMuted,
    marginTop: 2,
  },
});
