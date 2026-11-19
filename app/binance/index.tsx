import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { BitcoinBadge } from '@/components/bitcoin-badge';
import { formatCurrency, phpToSats } from '@/constants/currencies';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { confirmWithBiometrics } from '@/services/biometrics';
import {
  fetchBinanceLiveTickers,
  fetchBinancePortfolio,
  getUserBinanceKeyStatus,
  removeUserBinanceKeys,
  saveUserBinanceKeys,
  updateBinanceDepositAddress,
  withdrawBinanceUsdtToWallet,
  type BinanceKeyStatus,
  type BinancePortfolioPayload,
  type BinanceTicker24h,
  type UsdtNetworkOption,
} from '@/services/binance';
import { fetchExchangeRates } from '@/services/currency-api';

type ActiveTab = 'portfolio' | 'withdraw_usdt' | 'connect' | 'deposit';

const USDT_NETWORKS: { key: UsdtNetworkOption; label: string; sub: string }[] = [
  { key: 'BSC', label: 'BSC (BEP20)', sub: 'BNB Smart Chain • Fast & low fee' },
  { key: 'TRX', label: 'TRX (TRC20)', sub: 'Tron Network • Widely supported' },
  { key: 'MATIC', label: 'Polygon', sub: 'Polygon POS • Low fee' },
  { key: 'SOL', label: 'Solana', sub: 'Solana Network • Instant' },
  { key: 'ETH', label: 'ETH (ERC20)', sub: 'Ethereum Mainnet' },
];

export default function BinanceScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [tab, setTab] = useState<ActiveTab>('portfolio');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [portfolio, setPortfolio] = useState<BinancePortfolioPayload | null>(null);
  const [tickers, setTickers] = useState<BinanceTicker24h[]>([]);
  const [keyStatus, setKeyStatus] = useState<BinanceKeyStatus | null>(null);
  const [phpPerUsd, setPhpPerUsd] = useState(58.5);

  // Withdraw USDT to YTCash Wallet form
  const [usdtAmountInput, setUsdtAmountInput] = useState('');
  const [usdtNetwork, setUsdtNetwork] = useState<UsdtNetworkOption>('BSC');
  const [usdtWalletType, setUsdtWalletType] = useState<0 | 1>(0); // 0 = Spot, 1 = Funding
  const [usdtDestAddress, setUsdtDestAddress] = useState('');
  const [withdrawingUsdt, setWithdrawingUsdt] = useState(false);

  // Connect API Key form
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiSecretInput, setApiSecretInput] = useState('');
  const [accountLabelInput, setAccountLabelInput] = useState('My Binance Account');
  const [useTestnetInput, setUseTestnetInput] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);

  // BTC Deposit Address form
  const [editingDeposit, setEditingDeposit] = useState(false);
  const [btcAddressInput, setBtcAddressInput] = useState('');
  const [btcNetworkInput, setBtcNetworkInput] = useState('BTC (Bitcoin)');
  const [btcMemoInput, setBtcMemoInput] = useState('');
  const [btcLabelInput, setBtcLabelInput] = useState('YTCash Binance Treasury');
  const [savingDeposit, setSavingDeposit] = useState(false);

  const loadAll = useCallback(async (force = false) => {
    try {
      const [port, liveTickers, status, fx] = await Promise.all([
        fetchBinancePortfolio(force),
        fetchBinanceLiveTickers(force),
        getUserBinanceKeyStatus(),
        fetchExchangeRates('PHP'),
      ]);
      setPortfolio(port);
      setTickers(liveTickers);
      setKeyStatus(status);

      const usdRate = fx?.rates?.USD;
      if (usdRate && usdRate > 0) {
        setPhpPerUsd(1 / usdRate);
      }

      if (port?.deposit) {
        setBtcAddressInput(port.deposit.btcDepositAddress);
        setBtcNetworkInput(port.deposit.btcNetwork);
        setBtcMemoInput(port.deposit.btcMemo ?? '');
        setBtcLabelInput(port.deposit.accountLabel);
        if (port.deposit.usdtDepositAddress) {
          setUsdtDestAddress(port.deposit.usdtDepositAddress);
        }
        if (port.deposit.usdtNetwork) {
          setUsdtNetwork(port.deposit.usdtNetwork as UsdtNetworkOption);
        }
      }
      if (status?.label) {
        setAccountLabelInput(status.label);
        setUseTestnetInput(status.use_testnet);
      }
    } catch (e) {
      console.warn('Binance loadAll:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll(false);
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll(true);
    setRefreshing(false);
  }, [loadAll]);

  async function handleSaveKeys() {
    const key = apiKeyInput.trim();
    const secret = apiSecretInput.trim();
    if (key.length < 16 || secret.length < 16) {
      Alert.alert(
        'Invalid Credentials',
        'Please enter your full Binance API Key and API Secret (at least 16 characters each).',
      );
      return;
    }

    if (!(await confirmWithBiometrics(user?.id, 'Confirm linking your Binance API Key'))) return;

    setSavingKeys(true);
    try {
      const saved = await saveUserBinanceKeys({
        apiKey: key,
        apiSecret: secret,
        label: accountLabelInput.trim() || 'My Binance Account',
        useTestnet: useTestnetInput,
      });
      setKeyStatus(saved);
      setApiKeyInput('');
      setApiSecretInput('');
      await loadAll(true);
      setTab('portfolio');
      if (saved.warning) {
        Alert.alert(
          'API Key Saved (With Binance Notice)',
          `${saved.warning}\n\nTip: If you see code -2015, make sure "Restrict access to trusted IPs only" is set to Unrestricted (or includes your mobile/Wi-Fi IP) and "Enable Reading" is checked in Binance API Management.`,
        );
      } else {
        Alert.alert(
          'Binance Account Linked!',
          `Your read-only Binance API Key (${saved.masked_api_key}) is now connected and your live balances are synced.`,
        );
      }
    } catch (err: any) {
      Alert.alert(
        'Could Not Save Keys',
        err?.message?.includes('binance_save_keys')
          ? 'Run the latest supabase/migration.sql (Section 14) in your Supabase SQL Editor first.'
          : err?.message ?? 'Failed to save Binance credentials.',
      );
    } finally {
      setSavingKeys(false);
    }
  }

  async function handleRemoveKeys() {
    Alert.alert(
      'Disconnect Personal Binance Key?',
      'Your custom API key will be removed from the server and the app will fall back to the server environment credentials.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setSavingKeys(true);
            try {
              await removeUserBinanceKeys();
              await loadAll(true);
              Alert.alert('Disconnected', 'Reverted to server fallback credentials.');
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Could not remove keys');
            } finally {
              setSavingKeys(false);
            }
          },
        },
      ],
    );
  }

  async function handleSaveDepositAddress() {
    const addr = btcAddressInput.trim();
    if (addr.length < 20) {
      Alert.alert('Invalid Address', 'Please enter a valid Binance Bitcoin deposit address.');
      return;
    }
    if (!(await confirmWithBiometrics(user?.id, 'Confirm updating Binance BTC deposit address'))) {
      return;
    }

    setSavingDeposit(true);
    try {
      await updateBinanceDepositAddress({
        address: addr,
        network: btcNetworkInput.trim() || 'BTC (Bitcoin)',
        memo: btcMemoInput.trim() || null,
        accountLabel: btcLabelInput.trim() || 'YTCash Binance Treasury',
      });
      setEditingDeposit(false);
      await loadAll(true);
      Alert.alert(
        'Bitcoin Deposit Address Saved!',
        'All users can now view and scan this Bitcoin deposit address to deposit to your Binance account.',
      );
    } catch (err: any) {
      Alert.alert(
        'Could Not Update Address',
        err?.message?.includes('binance_set_deposit_address')
          ? 'Run the latest supabase/migration.sql (Section 14) in your Supabase SQL Editor first.'
          : err?.message ?? 'Failed to update deposit address.',
      );
    } finally {
      setSavingDeposit(false);
    }
  }

  async function handleShareAddress(address: string, network: string) {
    try {
      await Share.share({
        title: 'YTCash Binance Bitcoin Deposit Address',
        message: `Binance BTC Deposit Address (${network}):\n${address}`,
      });
    } catch {
      // Ignore share cancellation
    }
  }

  async function handleWithdrawUsdtToWallet() {
    const usdtVal = parseFloat(usdtAmountInput);
    const availUsdt =
      portfolio?.availableUsdtToWithdraw ?? portfolio?.totalPortfolioUsdt ?? 0;

    if (!portfolio?.connected) {
      Alert.alert(
        'Binance Account Not Connected',
        'Please connect your Binance API Key & Secret in the API Keys tab first.',
      );
      setTab('connect');
      return;
    }

    if (isNaN(usdtVal) || usdtVal <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid USDT amount greater than 0.');
      return;
    }

    if (usdtVal > availUsdt + 0.0001) {
      Alert.alert(
        'Insufficient Binance USDT',
        `You requested $${usdtVal.toFixed(2)} USDT, but your available Binance USDT balance is $${availUsdt.toFixed(2)} USDT.`,
      );
      return;
    }

    const estPhp = usdtVal * phpPerUsd;
    const estSats = phpToSats(estPhp);

    if (
      !(await confirmWithBiometrics(
        user?.id,
        `Confirm withdrawing ${usdtVal.toFixed(2)} USDT (${formatCurrency(estPhp)}) to YTCash Wallet`,
      ))
    ) {
      return;
    }

    setWithdrawingUsdt(true);
    try {
      // Save optional treasury USDT address if entered
      if (usdtDestAddress.trim().length >= 20) {
        await updateBinanceDepositAddress({
          address: btcAddressInput,
          usdtAddress: usdtDestAddress.trim(),
          usdtNetwork,
        }).catch(() => {});
      }

      const result = await withdrawBinanceUsdtToWallet({
        usdtAmount: usdtVal,
        phpRate: phpPerUsd,
        network: usdtNetwork,
        destinationAddress: usdtDestAddress.trim() || undefined,
        walletType: usdtWalletType,
      });

      await Promise.all([loadAll(true), refreshProfile()]);
      setUsdtAmountInput('');
      setTab('portfolio');

      Alert.alert(
        'USDT Credited to YTCash Wallet!',
        `${result.usdtAmount.toFixed(2)} USDT has been converted at ₱${result.phpRate.toFixed(2)}/USDT and ${formatCurrency(
          result.phpCredited,
        )} (${estSats.toLocaleString()} sats) was added to your YTCash PHP wallet balance immediately.${
          result.binanceWithdrawId ? `\n\nBinance Withdrawal ID: ${result.binanceWithdrawId}` : ''
        }`,
      );
    } catch (err: any) {
      Alert.alert(
        'Could Not Withdraw USDT',
        err?.message ?? 'Something went wrong while transferring USDT to your YTCash wallet.',
      );
    } finally {
      setWithdrawingUsdt(false);
    }
  }

  const totalUsdt = portfolio?.totalPortfolioUsdt ?? 0;
  const totalPhp = totalUsdt * phpPerUsd;
  const depositAddr = portfolio?.deposit?.btcDepositAddress || btcAddressInput;
  const depositNetwork = portfolio?.deposit?.btcNetwork || btcNetworkInput;
  const depositLabel = portfolio?.deposit?.accountLabel || btcLabelInput;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&bgcolor=121722&color=F7931A&data=${encodeURIComponent(
    `bitcoin:${depositAddr}`,
  )}`;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Binance Exchange</Text>
          <Text style={styles.headerSub} numberOfLines={2}>
            OpenClaw Portfolio, USDT Withdraw & BTC Deposit
          </Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="refresh" size={20} color={BitcoinColors.orange} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(
          [
            { key: 'portfolio', label: 'Portfolio', icon: 'stats-chart' },
            { key: 'withdraw_usdt', label: 'Withdraw\nUSDT', icon: 'swap-horizontal' },
            { key: 'deposit', label: 'BTC\nDeposit', icon: 'qr-code' },
            { key: 'connect', label: 'API\nKeys', icon: 'key' },
          ] as const
        ).map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.8}>
              <Ionicons
                name={t.icon}
                size={16}
                color={active ? '#07090E' : BitcoinColors.textSecondary}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={2}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <BitcoinBadge size={54} glow={true} />
          <ActivityIndicator size="large" color={BitcoinColors.orange} style={{ marginTop: 16 }} />
          <Text style={styles.loaderText}>Syncing with Binance API...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={BitcoinColors.orange}
              colors={[BitcoinColors.orange]}
            />
          }>
          {/* ─── TAB 1: PORTFOLIO & LIVE PRICES ─── */}
          {tab === 'portfolio' && (
            <>
              {/* Hero Portfolio Value Card */}
              <LinearGradient
                colors={['#1E160A', '#131825', '#0C0F17']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.sourceBadgeRow}>
                      <View
                        style={[
                          styles.statusDot,
                          {
                            backgroundColor: portfolio?.connected
                              ? BitcoinColors.green
                              : BitcoinColors.orange,
                          },
                        ]}
                      />
                      <Text style={styles.sourceBadgeText}>
                        {portfolio?.connected
                          ? portfolio.credentialSource === 'user'
                            ? `PERSONAL KEY (${portfolio.maskedApiKey})`
                            : `SERVER FALLBACK (${portfolio.maskedApiKey})`
                          : keyStatus?.has_custom_keys
                          ? `KEY SAVED (${keyStatus.masked_api_key})`
                          : 'PUBLIC MARKET FEED'}
                      </Text>
                    </View>
                    <Text style={styles.heroLabel}>TOTAL BINANCE PORTFOLIO</Text>
                    <Text style={styles.heroAmount}>
                      ${totalUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      <Text style={styles.heroUnit}>USDT</Text>
                    </Text>
                    <Text style={styles.heroPhpEquiv}>≈ {formatCurrency(totalPhp, 'PHP')}</Text>
                  </View>
                  <BitcoinBadge size={48} glow={true} />
                </View>

                {/* Spot vs Futures Breakdown */}
                <View style={styles.breakdownRow}>
                  <View style={styles.breakdownPill}>
                    <Text style={styles.breakdownLabel}>SPOT / FUNDING</Text>
                    <Text style={styles.breakdownValue}>
                      ${(portfolio?.spotTotalUsdt ?? 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.breakdownPill}>
                    <Text style={styles.breakdownLabel}>USD-M FUTURES</Text>
                    <Text style={styles.breakdownValue}>
                      ${(portfolio?.futuresUsdtTotal ?? 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.breakdownPill}>
                    <Text style={styles.breakdownLabel}>STATUS</Text>
                    <Text
                      style={[
                        styles.breakdownValue,
                        { color: portfolio?.connected ? BitcoinColors.green : BitcoinColors.orange },
                      ]}>
                      {portfolio?.connected ? 'LIVE' : 'OFFLINE'}
                    </Text>
                  </View>
                </View>

                {portfolio?.warning && (
                  <View style={styles.warningBox}>
                    <Ionicons name="information-circle" size={16} color={BitcoinColors.orange} />
                    <Text style={styles.warningText}>{portfolio.warning}</Text>
                  </View>
                )}

                <View style={styles.heroActionRow}>
                  <TouchableOpacity
                    style={[styles.heroSecondaryBtn, styles.heroWithdrawBtn]}
                    onPress={() => setTab('withdraw_usdt')}
                    activeOpacity={0.8}>
                    <Ionicons name="swap-horizontal" size={16} color="#10B981" />
                    <Text style={[styles.heroSecondaryBtnText, { color: '#10B981' }]}>
                      Withdraw USDT to Wallet
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.heroSecondaryBtn}
                    onPress={() => setTab('deposit')}
                    activeOpacity={0.8}>
                    <Ionicons name="qr-code-outline" size={16} color={BitcoinColors.gold} />
                    <Text style={[styles.heroSecondaryBtnText, { color: BitcoinColors.gold }]}>
                      BTC Deposit Address
                    </Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>

              {/* Spot Balances */}
              <View style={styles.card}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>SPOT ACCOUNT HOLDINGS</Text>
                  {portfolio?.connected && (
                    <Text style={styles.sectionMeta}>
                      {portfolio.spotAssets.length} active asset
                      {portfolio.spotAssets.length === 1 ? '' : 's'}
                    </Text>
                  )}
                </View>

                {!portfolio?.connected || portfolio.spotAssets.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="wallet-outline" size={28} color={BitcoinColors.orange} />
                    <Text style={styles.emptyTitle}>
                      {portfolio?.connected
                        ? 'No non-zero Spot balances found'
                        : 'Connect your Binance API key to view balances'}
                    </Text>
                    <Text style={styles.emptySub}>
                      {portfolio?.connected
                        ? 'Deposit BTC or USDT into your Binance Spot wallet to see holdings here.'
                        : 'Each user can link their own read-only Binance API key & secret, or fall back to the server environment credentials.'}
                    </Text>
                  </View>
                ) : (
                  portfolio.spotAssets.map((item) => (
                    <View key={item.asset} style={styles.assetRow}>
                      <View style={styles.assetBadge}>
                        <Text style={styles.assetSymbol}>{item.asset.slice(0, 4)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.assetName}>{item.asset}</Text>
                        <Text style={styles.assetSub}>
                          Free: {item.free >= 1 ? item.free.toFixed(4) : item.free.toFixed(8)}
                          {item.locked > 0
                            ? ` • Locked: ${item.locked >= 1 ? item.locked.toFixed(4) : item.locked.toFixed(8)}`
                            : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.assetUsdt}>${item.valueUsdt.toFixed(2)}</Text>
                        <Text style={styles.assetPhp}>
                          {formatCurrency(item.valueUsdt * phpPerUsd, 'PHP')}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* Futures Open Positions (if any) */}
              {portfolio?.futuresPositions && portfolio.futuresPositions.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>USD-M FUTURES POSITIONS</Text>
                  {portfolio.futuresPositions.map((pos) => {
                    const isProfit = pos.unrealizedPnl >= 0;
                    return (
                      <View key={`${pos.symbol}-${pos.side}`} style={styles.assetRow}>
                        <View
                          style={[
                            styles.assetBadge,
                            {
                              backgroundColor:
                                pos.side === 'LONG'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(244, 63, 94, 0.15)',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.assetSymbol,
                              {
                                color:
                                  pos.side === 'LONG' ? BitcoinColors.green : BitcoinColors.red,
                              },
                            ]}>
                            {pos.side}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.assetName}>
                            {pos.symbol} ({pos.leverage}x)
                          </Text>
                          <Text style={styles.assetSub}>
                            Size: {pos.size} @ ${pos.entryPrice.toFixed(2)} (Mark: $
                            {pos.markPrice.toFixed(2)})
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.assetUsdt,
                            { color: isProfit ? BitcoinColors.green : BitcoinColors.red },
                          ]}>
                          {isProfit ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Live Binance Market Tickers (OpenClaw Whitelist) */}
              <View style={styles.card}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>BINANCE LIVE MARKET PRICES (24H)</Text>
                  <View style={styles.liveTag}>
                    <View style={styles.livePulse} />
                    <Text style={styles.liveTagText}>LIVE</Text>
                  </View>
                </View>

                {tickers.map((t) => {
                  const up = t.priceChangePercent >= 0;
                  const phpPrice = t.lastPrice * phpPerUsd;
                  return (
                    <View key={t.symbol} style={styles.tickerRow}>
                      <View style={styles.assetBadge}>
                        <Text style={styles.assetSymbol}>{t.baseAsset}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.assetName}>{t.baseAsset} / USDT</Text>
                        <Text style={styles.assetSub}>
                          24h Low ${t.lowPrice.toLocaleString()} • High $
                          {t.highPrice.toLocaleString()}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.assetUsdt}>
                          $
                          {t.lastPrice >= 1
                            ? t.lastPrice.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : t.lastPrice.toFixed(4)}
                        </Text>
                        <Text style={styles.assetPhp}>{formatCurrency(phpPrice, 'PHP')}</Text>
                        <View
                          style={[
                            styles.changePill,
                            {
                              backgroundColor: up
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(244, 63, 94, 0.15)',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.changeText,
                              { color: up ? BitcoinColors.green : BitcoinColors.red },
                            ]}>
                            {up ? '+' : ''}
                            {t.priceChangePercent.toFixed(2)}%
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ─── TAB 2: WITHDRAW USDT TO YTCASH WALLET ─── */}
          {tab === 'withdraw_usdt' && (
            <View style={styles.card}>
              <View style={styles.depositHeader}>
                <BitcoinBadge size={52} glow={true} />
                <Text style={styles.depositTitle}>Withdraw USDT to YTCash Wallet</Text>
                <Text style={styles.depositSub}>
                  Convert and transfer available USDT from your linked Binance account directly into
                  your YTCash PHP wallet balance at live market rates.
                </Text>
              </View>

              {/* Balances Comparison Box */}
              <View style={styles.breakdownRow}>
                <View style={styles.breakdownPill}>
                  <Text style={styles.breakdownLabel}>BINANCE AVAILABLE USDT</Text>
                  <Text style={[styles.breakdownValue, { color: BitcoinColors.green }]}>
                    $
                    {(
                      portfolio?.availableUsdtToWithdraw ??
                      portfolio?.totalPortfolioUsdt ??
                      0
                    ).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    USDT
                  </Text>
                </View>
                <View style={styles.breakdownPill}>
                  <Text style={styles.breakdownLabel}>YTCASH PHP WALLET</Text>
                  <Text style={styles.breakdownValue}>
                    {formatCurrency(profile?.balance ?? 0, 'PHP')}
                  </Text>
                </View>
              </View>

              {/* USDT Amount Input */}
              <View style={{ marginTop: 16 }}>
                <View style={[styles.sectionHeaderRow, { flexWrap: 'wrap', gap: 8 }]}>
                  <Text style={[styles.inputLabel, { marginTop: 0, marginBottom: 0 }]}>
                    AMOUNT TO WITHDRAW (USDT)
                  </Text>
                  <TouchableOpacity
                    style={styles.maxPillBtn}
                    onPress={() => {
                      const avail =
                        portfolio?.availableUsdtToWithdraw ?? portfolio?.totalPortfolioUsdt ?? 0;
                      if (avail > 0) setUsdtAmountInput(avail.toFixed(2));
                    }}
                    activeOpacity={0.75}>
                    <Text style={styles.maxPillText}>
                      USE MAX ($
                      {(
                        portfolio?.availableUsdtToWithdraw ??
                        portfolio?.totalPortfolioUsdt ??
                        0
                      ).toFixed(2)}
                      )
                    </Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[styles.input, { fontSize: 22, fontWeight: '900' }]}
                  value={usdtAmountInput}
                  onChangeText={(t) => setUsdtAmountInput(t.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor={BitcoinColors.textMuted}
                  keyboardType="decimal-pad"
                />

                {/* Quick USDT Chips */}
                <View style={[styles.breakdownRow, { marginTop: 10 }]}>
                  {[10, 25, 50, 100].map((amt) => (
                    <TouchableOpacity
                      key={amt}
                      style={[
                        styles.breakdownPill,
                        {
                          alignItems: 'center',
                          borderColor:
                            usdtAmountInput === String(amt)
                              ? BitcoinColors.orange
                              : 'rgba(255,255,255,0.08)',
                        },
                      ]}
                      onPress={() => setUsdtAmountInput(String(amt))}
                      activeOpacity={0.75}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF' }}>
                        ${amt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Source Binance Wallet (Spot vs Funding) */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>SOURCE BINANCE WALLET</Text>
              <View style={[styles.breakdownRow, { marginTop: 4 }]}>
                {(
                  [
                    { type: 0 as const, label: 'Spot Wallet' },
                    { type: 1 as const, label: 'Funding Wallet' },
                  ]
                ).map((w) => {
                  const selected = usdtWalletType === w.type;
                  return (
                    <TouchableOpacity
                      key={w.type}
                      style={[
                        styles.breakdownPill,
                        {
                          alignItems: 'center',
                          borderColor: selected ? BitcoinColors.orange : 'rgba(255,255,255,0.08)',
                          backgroundColor: selected
                            ? 'rgba(247, 147, 26, 0.14)'
                            : 'rgba(255,255,255,0.05)',
                        },
                      ]}
                      onPress={() => setUsdtWalletType(w.type)}
                      activeOpacity={0.8}>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '800',
                          color: selected ? BitcoinColors.orange : '#FFFFFF',
                        }}>
                        {w.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Network Selection (Mode A: /sapi/v1/capital/withdraw/apply) */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>TRANSFER NETWORK</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {USDT_NETWORKS.map((net) => {
                  const selected = usdtNetwork === net.key;
                  return (
                    <TouchableOpacity
                      key={net.key}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: selected ? BitcoinColors.orange : BitcoinColors.border,
                        backgroundColor: selected
                          ? 'rgba(247, 147, 26, 0.15)'
                          : BitcoinColors.cardElevated,
                      }}
                      onPress={() => setUsdtNetwork(net.key)}
                      activeOpacity={0.8}>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '800',
                          color: selected ? BitcoinColors.orange : '#FFFFFF',
                        }}>
                        {net.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Optional Destination USDT Address for On-Chain Mode A */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>
                TREASURY USDT ADDRESS (OPTIONAL • FOR ON-CHAIN API WITHDRAW)
              </Text>
              <TextInput
                style={styles.input}
                value={usdtDestAddress}
                onChangeText={setUsdtDestAddress}
                placeholder="Leave blank for instant own-account PHP wallet conversion"
                placeholderTextColor={BitcoinColors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/* Live Conversion Summary Box */}
              <View style={[styles.depositInfoBox, { marginTop: 16 }]}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>LIVE CONVERSION RATE</Text>
                  <Text style={styles.summaryValue}>
                    1 USDT = {formatCurrency(phpPerUsd, 'PHP')}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>SETTLEMENT MODE</Text>
                  <Text style={[styles.summaryValue, { color: BitcoinColors.green }]}>
                    {portfolio?.canWithdraw && usdtDestAddress.trim().length >= 20
                      ? `Mode A (Binance API ${usdtNetwork} + Instant Credit)`
                      : 'Instant Own-Account Convert & Credit'}
                  </Text>
                </View>
                <View style={[styles.summaryRow, { marginBottom: 0 }]}>
                  <Text style={styles.summaryLabel}>YTCASH WALLET RECEIVES</Text>
                  <Text style={styles.summaryTotalValue}>
                    {formatCurrency((parseFloat(usdtAmountInput) || 0) * phpPerUsd, 'PHP')}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleWithdrawUsdtToWallet}
                disabled={withdrawingUsdt}
                activeOpacity={0.85}>
                <LinearGradient colors={Brand.gradientButton} style={styles.primaryBtnGradient}>
                  {withdrawingUsdt ? (
                    <ActivityIndicator size="small" color="#07090E" />
                  ) : (
                    <Ionicons name="flash" size={18} color="#07090E" />
                  )}
                  <Text style={styles.primaryBtnText}>
                    {withdrawingUsdt
                      ? 'Converting & Crediting Wallet...'
                      : `Withdraw ${
                          parseFloat(usdtAmountInput) > 0
                            ? `$${parseFloat(usdtAmountInput).toFixed(2)} USDT`
                            : 'USDT'
                        } to YTCash`}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* ─── TAB 3: BINANCE BITCOIN DEPOSIT ADDRESS ─── */}
          {tab === 'deposit' && (
            <View style={styles.card}>
              <View style={styles.depositHeader}>
                <BitcoinBadge size={52} glow={true} />
                <Text style={styles.depositTitle}>Deposit Bitcoin to Binance</Text>
                <Text style={styles.depositSub}>
                  Send BTC from any external wallet or exchange directly to the{' '}
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{depositLabel}</Text>{' '}
                  Binance deposit address below.
                </Text>
              </View>

              {/* QR Code */}
              <View style={styles.qrBox}>
                <Image source={{ uri: qrUrl }} style={styles.qrImage} contentFit="contain" />
              </View>

              {/* Network & Address Details */}
              <View style={styles.depositInfoBox}>
                <Text style={styles.inputLabel}>NETWORK</Text>
                <View style={styles.networkRow}>
                  <Ionicons name="shield-checkmark" size={16} color={BitcoinColors.green} />
                  <Text style={styles.networkValue}>{depositNetwork}</Text>
                </View>

                <Text style={[styles.inputLabel, { marginTop: 14 }]}>
                  BINANCE BITCOIN DEPOSIT ADDRESS
                </Text>
                <Text style={styles.addressValue} selectable>
                  {depositAddr}
                </Text>

                {portfolio?.deposit?.btcMemo ? (
                  <>
                    <Text style={[styles.inputLabel, { marginTop: 14 }]}>MEMO / TAG</Text>
                    <Text style={styles.addressValue} selectable>
                      {portfolio.deposit.btcMemo}
                    </Text>
                  </>
                ) : null}
              </View>

              <View style={styles.depositBtnRow}>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => handleShareAddress(depositAddr, depositNetwork)}
                  activeOpacity={0.85}>
                  <LinearGradient colors={Brand.gradientButton} style={styles.primaryBtnGradient}>
                    <Ionicons name="share-social" size={18} color="#07090E" />
                    <Text style={styles.primaryBtnText}>Copy / Share BTC Address</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              {/* Update BTC Deposit Address Section */}
              <TouchableOpacity
                style={styles.editToggleBtn}
                onPress={() => setEditingDeposit(!editingDeposit)}
                activeOpacity={0.8}>
                <Ionicons
                  name={editingDeposit ? 'chevron-up' : 'create-outline'}
                  size={16}
                  color={BitcoinColors.orange}
                />
                <Text style={styles.editToggleText}>
                  {editingDeposit
                    ? 'Hide Deposit Address Settings'
                    : 'Set My Binance Bitcoin Deposit Address'}
                </Text>
              </TouchableOpacity>

              {editingDeposit && (
                <View style={styles.editBox}>
                  <Text style={styles.inputLabel}>ACCOUNT LABEL</Text>
                  <TextInput
                    style={styles.input}
                    value={btcLabelInput}
                    onChangeText={setBtcLabelInput}
                    placeholder="YTCash Binance Treasury"
                    placeholderTextColor={BitcoinColors.textMuted}
                  />

                  <Text style={styles.inputLabel}>BITCOIN NETWORK</Text>
                  <TextInput
                    style={styles.input}
                    value={btcNetworkInput}
                    onChangeText={setBtcNetworkInput}
                    placeholder="BTC (Bitcoin) / SegWit / BEP20"
                    placeholderTextColor={BitcoinColors.textMuted}
                  />

                  <Text style={styles.inputLabel}>YOUR BINANCE BTC DEPOSIT ADDRESS</Text>
                  <TextInput
                    style={styles.input}
                    value={btcAddressInput}
                    onChangeText={setBtcAddressInput}
                    placeholder="Paste your Binance BTC deposit address (e.g. 1... or bc1...)"
                    placeholderTextColor={BitcoinColors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleSaveDepositAddress}
                    disabled={savingDeposit}
                    activeOpacity={0.85}>
                    <LinearGradient colors={Brand.gradientButton} style={styles.primaryBtnGradient}>
                      {savingDeposit && <ActivityIndicator size="small" color="#07090E" />}
                      <Text style={styles.primaryBtnText}>
                        {savingDeposit ? 'Saving Address...' : 'Save Binance BTC Deposit Address'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* ─── TAB 3: CONNECT PERSONAL BINANCE API KEYS ─── */}
          {tab === 'connect' && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>CONNECT YOUR BINANCE ACCOUNT</Text>
              <Text style={styles.bodyText}>
                Enter a <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Read-Only</Text>{' '}
                Binance API Key and Secret to view your Spot and USD-M Futures portfolio inside
                YTCash. Your secret is stored strictly on the server (never exposed to other users)
                and automatically falls back to the server environment credentials when not set.
              </Text>

              {/* Current Status Pill */}
              <View style={styles.keyStatusCard}>
                <Ionicons
                  name={keyStatus?.has_custom_keys ? 'checkmark-circle' : 'cloud-outline'}
                  size={22}
                  color={keyStatus?.has_custom_keys ? BitcoinColors.green : BitcoinColors.orange}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.keyStatusTitle}>
                    {keyStatus?.has_custom_keys
                      ? `Linked: ${keyStatus.label} (${keyStatus.masked_api_key})`
                      : 'Using Server Environment Fallback'}
                  </Text>
                  <Text style={styles.keyStatusSub}>
                    {keyStatus?.has_custom_keys
                      ? `Updated ${new Date(keyStatus.updated_at!).toLocaleDateString()}`
                      : 'No personal API key saved for your account yet.'}
                  </Text>
                </View>
              </View>

              <Text style={styles.inputLabel}>ACCOUNT LABEL</Text>
              <TextInput
                style={styles.input}
                value={accountLabelInput}
                onChangeText={setAccountLabelInput}
                placeholder="My Binance Account"
                placeholderTextColor={BitcoinColors.textMuted}
              />

              <Text style={styles.inputLabel}>BINANCE API KEY</Text>
              <TextInput
                style={styles.input}
                value={apiKeyInput}
                onChangeText={setApiKeyInput}
                placeholder="Paste your Binance API Key"
                placeholderTextColor={BitcoinColors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>BINANCE API SECRET</Text>
              <TextInput
                style={styles.input}
                value={apiSecretInput}
                onChangeText={setApiSecretInput}
                placeholder="Paste your Binance API Secret"
                placeholderTextColor={BitcoinColors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Use Binance Spot Testnet</Text>
                  <Text style={styles.switchSub}>
                    Connect to testnet.binance.vision instead of live api.binance.com
                  </Text>
                </View>
                <Switch
                  value={useTestnetInput}
                  onValueChange={setUseTestnetInput}
                  trackColor={{ false: BitcoinColors.border, true: 'rgba(247, 147, 26, 0.5)' }}
                  thumbColor={useTestnetInput ? BitcoinColors.orange : '#CBD5E1'}
                />
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleSaveKeys}
                disabled={savingKeys}
                activeOpacity={0.85}>
                <LinearGradient colors={Brand.gradientButton} style={styles.primaryBtnGradient}>
                  {savingKeys ? (
                    <ActivityIndicator size="small" color="#07090E" />
                  ) : (
                    <Ionicons name="lock-closed" size={16} color="#07090E" />
                  )}
                  <Text style={styles.primaryBtnText}>
                    {savingKeys ? 'Saving & Verifying...' : 'Save Binance API Key & Secret'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>

              {keyStatus?.has_custom_keys && (
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={handleRemoveKeys}
                  disabled={savingKeys}
                  activeOpacity={0.8}>
                  <Ionicons name="trash-outline" size={16} color={BitcoinColors.red} />
                  <Text style={styles.removeBtnText}>
                    Remove Personal Key (Use Server Fallback)
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: BitcoinColors.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: BitcoinColors.border,
  },
  backBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerSub: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 4,
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    gap: 4,
  },
  tabBtnActive: {
    backgroundColor: BitcoinColors.orange,
    shadowColor: BitcoinColors.orange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 4,
  },
  tabText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
  },
  tabTextActive: {
    color: '#07090E',
    fontWeight: '900',
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  heroCard: {
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    marginBottom: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sourceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.gold,
    letterSpacing: 0.6,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
  },
  heroAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
  },
  heroUnit: {
    fontSize: 14,
    fontWeight: '700',
    color: BitcoinColors.orange,
  },
  heroPhpEquiv: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  breakdownRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  breakdownPill: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  breakdownLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    letterSpacing: 0.6,
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 3,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: '#E2E8F0',
  },
  heroActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  heroSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
  },
  heroWithdrawBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  heroSecondaryBtnText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: BitcoinColors.orange,
    textAlign: 'center',
  },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: BitcoinColors.orange,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 12,
    lineHeight: 18,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    gap: 12,
  },
  tickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    gap: 12,
  },
  assetBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(247, 147, 26, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  assetSymbol: {
    fontSize: 11,
    fontWeight: '900',
    color: BitcoinColors.orange,
  },
  assetName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  assetSub: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  assetUsdt: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  assetPhp: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  changePill: {
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  changeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BitcoinColors.green,
  },
  liveTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.green,
  },
  depositHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  depositTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 12,
  },
  depositSub: {
    fontSize: 12,
    lineHeight: 18,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  qrBox: {
    alignSelf: 'center',
    padding: 14,
    borderRadius: 20,
    backgroundColor: '#121722',
    borderWidth: 1.5,
    borderColor: 'rgba(247, 147, 26, 0.45)',
    marginBottom: 16,
  },
  qrImage: {
    width: 200,
    height: 200,
  },
  depositInfoBox: {
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  networkValue: {
    fontSize: 14,
    fontWeight: '800',
    color: BitcoinColors.green,
  },
  addressValue: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.gold,
    marginTop: 6,
    lineHeight: 19,
  },
  depositBtnRow: {
    marginTop: 14,
  },
  editToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
    paddingVertical: 10,
  },
  editToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  editBox: {
    marginTop: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  bodyText: {
    fontSize: 12,
    lineHeight: 18,
    color: BitcoinColors.textSecondary,
    marginTop: 6,
    marginBottom: 14,
  },
  keyStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 16,
  },
  keyStatusTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  keyStatusSub: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#FFFFFF',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  switchTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  switchSub: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  primaryBtn: {
    marginTop: 16,
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 8,
  },
  primaryBtnText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: '#07090E',
    textAlign: 'center',
  },
  maxPillBtn: {
    backgroundColor: 'rgba(247, 147, 26, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  maxPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 0.6,
  },
  summaryValue: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'right',
  },
  summaryTotalValue: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    color: BitcoinColors.gold,
    textAlign: 'right',
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
  removeBtnText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.red,
    textAlign: 'center',
  },
});
