import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import {
  ASSETS_CATALOG,
  claimDailyCoinStockReward,
  defaultDepositAddress,
  getAssetBalances,
  getAssetTransfers,
  getCustomAddresses,
  recordAssetWithdrawal,
  saveCustomAddress,
  type AssetCategory,
  type AssetDefinition,
  type AssetTransferRecord,
} from '@/services/assets';

type DirectTab = 'send' | 'receive';

const CATEGORY_OPTIONS: { id: AssetCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'crypto', label: 'Cryptocurrency', icon: 'logo-bitcoin' },
  { id: 'tokens', label: 'Tokens', icon: 'layers-outline' },
  { id: 'coin_stocks', label: 'Coin Stocks', icon: 'trending-up' },
];

export default function DirectPayAssetsScreen() {
  const { user } = useAuth();
  const userId = user?.id ?? 'guest-user';

  const [tab, setTab] = useState<DirectTab>('receive');
  const [category, setCategory] = useState<AssetCategory>('crypto');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('btc');
  const [selectedNetwork, setSelectedNetwork] = useState<string>('Bitcoin (SegWit)');

  const [balances, setBalances] = useState<Record<string, number>>({});
  const [customAddresses, setCustomAddresses] = useState<Record<string, string>>({});
  const [transfers, setTransfers] = useState<AssetTransferRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Receive / custom address editing
  const [editingAddress, setEditingAddress] = useState(false);
  const [customAddrInput, setCustomAddrInput] = useState('');

  // Send / withdraw form
  const [recipientAddress, setRecipientAddress] = useState('');
  const [sendAmountText, setSendAmountText] = useState('');
  const [busy, setBusy] = useState(false);

  const categoryAssets = useMemo(
    () => ASSETS_CATALOG.filter((a) => a.category === category),
    [category],
  );

  const selectedAsset: AssetDefinition = useMemo(
    () => categoryAssets.find((a) => a.id === selectedAssetId) ?? categoryAssets[0],
    [categoryAssets, selectedAssetId],
  );

  const activeNetwork = selectedAsset.networks.includes(selectedNetwork)
    ? selectedNetwork
    : selectedAsset.networks[0];

  const load = useCallback(async () => {
    try {
      const [bal, addrs, hist] = await Promise.all([
        getAssetBalances(userId),
        getCustomAddresses(userId),
        getAssetTransfers(userId),
      ]);
      setBalances(bal);
      setCustomAddresses(addrs);
      setTransfers(hist);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function handleSelectCategory(next: AssetCategory) {
    setCategory(next);
    const first = ASSETS_CATALOG.find((a) => a.category === next)!;
    setSelectedAssetId(first.id);
    setSelectedNetwork(first.networks[0]);
    setEditingAddress(false);
    setSendAmountText('');
    setRecipientAddress('');
  }

  function handleSelectAsset(asset: AssetDefinition) {
    setSelectedAssetId(asset.id);
    setSelectedNetwork(asset.networks[0]);
    setEditingAddress(false);
    setSendAmountText('');
  }

  const addrKey = `${selectedAsset.symbol}_${activeNetwork}`;
  const depositAddress =
    customAddresses[addrKey] || defaultDepositAddress(userId, selectedAsset, activeNetwork);
  const qrUri = `https://api.qrserver.com/v1/create-qr-code/?size=210x210&bgcolor=121722&color=F7931A&data=${encodeURIComponent(
    depositAddress,
  )}`;

  const currentBalance = balances[selectedAsset.symbol] ?? 0;
  const usdValue = currentBalance * selectedAsset.priceUsd;

  async function handleShareAddress() {
    await Share.share({
      message: `My YTCash ${selectedAsset.symbol} (${activeNetwork}) address:\n${depositAddress}`,
    }).catch(() => {});
  }

  async function handleSaveCustomAddress() {
    if (customAddrInput.trim().length < 8) {
      Alert.alert('Invalid address', 'Enter a valid blockchain wallet address.');
      return;
    }
    await saveCustomAddress(userId, addrKey, customAddrInput.trim());
    setEditingAddress(false);
    setCustomAddrInput('');
    await load();
    Alert.alert('Saved', `${selectedAsset.symbol} (${activeNetwork}) deposit address updated.`);
  }

  async function handleWithdraw() {
    const amt = Number(sendAmountText);
    if (!amt || amt <= 0) {
      Alert.alert('Invalid amount', `Enter the ${selectedAsset.symbol} amount to send.`);
      return;
    }
    if (amt > currentBalance) {
      Alert.alert(
        'Insufficient balance',
        `You have ${currentBalance} ${selectedAsset.symbol} available.`,
      );
      return;
    }
    if (recipientAddress.trim().length < 6) {
      Alert.alert(
        'Destination required',
        selectedAsset.category === 'coin_stocks'
          ? 'Enter the recipient YTCash Wallet ID or email.'
          : `Enter a valid ${activeNetwork} wallet address.`,
      );
      return;
    }

    setBusy(true);
    try {
      const { balances: nextBal } = await recordAssetWithdrawal({
        userId,
        asset: selectedAsset,
        network: activeNetwork,
        amount: amt,
        toAddress: recipientAddress.trim(),
      });
      setBalances(nextBal);
      setSendAmountText('');
      setRecipientAddress('');
      await load();
      Alert.alert(
        'Withdrawal Submitted',
        `Sent ${amt} ${selectedAsset.symbol} on ${activeNetwork}.`,
      );
    } catch (e: any) {
      Alert.alert('Could not send', e?.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClaimCoinStock() {
    setBusy(true);
    try {
      const targetSymbol =
        selectedAsset.category === 'coin_stocks' ? selectedAsset.symbol : 'YTC-STK';
      const { earned, balances: nextBal } = await claimDailyCoinStockReward(userId, targetSymbol);
      setBalances(nextBal);
      await load();
      Alert.alert(
        'Coin Stocks Earned!',
        `You earned +${earned} ${targetSymbol} shares for using YTCash today.`,
      );
    } catch (e: any) {
      Alert.alert('Daily Reward', e?.message ?? 'Try again tomorrow.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Transfer Assets" />

      {/* Top Tabs: Send Assets vs Receive Assets */}
      <View style={styles.tabs}>
        {(['send', 'receive'] as const).map((key) => {
          const selected = tab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => setTab(key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected }}>
              <Ionicons
                name={key === 'send' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                size={16}
                color={selected ? BitcoinColors.orange : BitcoinColors.textSecondary}
              />
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {key === 'send' ? 'Send Assets' : 'Receive Assets'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

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
        {/* Asset Category Selector: Cryptocurrency | Tokens | Coin Stocks */}
        <Text style={styles.sectionLabel}>ASSET TYPE</Text>
        <View style={styles.categoryRow}>
          {CATEGORY_OPTIONS.map((opt) => {
            const active = category === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.catBtn, active && styles.catBtnActive]}
                onPress={() => handleSelectCategory(opt.id)}
                activeOpacity={0.85}>
                <Ionicons
                  name={opt.icon}
                  size={16}
                  color={active ? BitcoinColors.orange : BitcoinColors.textSecondary}
                />
                <Text style={[styles.catText, active && styles.catTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Asset Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.assetChipsRow}>
          {categoryAssets.map((asset) => {
            const active = asset.id === selectedAsset.id;
            const bal = balances[asset.symbol] ?? 0;
            return (
              <TouchableOpacity
                key={asset.id}
                style={[styles.assetChip, active && styles.assetChipActive]}
                onPress={() => handleSelectAsset(asset)}
                activeOpacity={0.85}>
                <View style={[styles.assetDot, { backgroundColor: asset.iconColor }]} />
                <View>
                  <Text style={[styles.assetSymbol, active && styles.assetSymbolActive]}>
                    {asset.symbol}
                  </Text>
                  <Text style={styles.assetBal}>
                    {bal} {asset.category === 'coin_stocks' ? 'shares' : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Balance + Network Card */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.assetTitle}>{selectedAsset.name}</Text>
              <Text style={styles.assetDesc}>{selectedAsset.description}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.balanceNum}>
                {currentBalance} {selectedAsset.symbol}
              </Text>
              <Text style={styles.balanceUsd}>≈ ${usdValue.toFixed(2)} USD</Text>
            </View>
          </View>

          <Text style={styles.networkLabel}>
            {category === 'coin_stocks' ? 'LEDGER' : 'BLOCKCHAIN NETWORK'}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.networkRow}>
            {selectedAsset.networks.map((net) => {
              const active = net === activeNetwork;
              return (
                <TouchableOpacity
                  key={net}
                  style={[styles.netChip, active && styles.netChipActive]}
                  onPress={() => setSelectedNetwork(net)}
                  activeOpacity={0.8}>
                  <Text style={[styles.netText, active && styles.netTextActive]}>{net}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Coin Stocks Earn Banner */}
        {category === 'coin_stocks' && (
          <View style={styles.earnCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.earnTitle}>Earn Coin Stocks Using YTCash</Text>
              <Text style={styles.earnSub}>
                Just like company stock, earn shares daily and on every P2P exchange, cash scan, or
                asset transfer.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.claimBtn}
              onPress={handleClaimCoinStock}
              disabled={busy}
              activeOpacity={0.85}>
              {busy ? (
                <ActivityIndicator size="small" color="#07090E" />
              ) : (
                <Text style={styles.claimBtnText}>Claim Daily</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Main Action Card: Receive Assets (QR Deposit) vs Send Assets (Withdraw) */}
        {tab === 'receive' ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {category === 'coin_stocks'
                  ? `Receive ${selectedAsset.symbol} Shares`
                  : `Deposit ${selectedAsset.symbol} (${activeNetwork})`}
              </Text>
              {category !== 'coin_stocks' && (
                <TouchableOpacity
                  onPress={() => {
                    setCustomAddrInput(depositAddress);
                    setEditingAddress((v) => !v);
                  }}
                  activeOpacity={0.8}>
                  <Text style={styles.linkText}>{editingAddress ? 'Cancel' : 'Edit Address'}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.qrBox}>
              <Image source={{ uri: qrUri }} style={styles.qrImage} contentFit="contain" />
            </View>

            <Text style={styles.addrLabel}>
              {category === 'coin_stocks' ? 'YTCASH COIN STOCK WALLET ID' : 'WALLET DEPOSIT ADDRESS'}
            </Text>
            <View style={styles.addrBox}>
              <Text style={styles.addrText} selectable>
                {depositAddress}
              </Text>
            </View>

            {editingAddress && (
              <View style={styles.editAddrWrap}>
                <TextInput
                  style={styles.input}
                  value={customAddrInput}
                  onChangeText={setCustomAddrInput}
                  placeholder={`Paste your ${selectedAsset.symbol} address`}
                  placeholderTextColor={BitcoinColors.textMuted}
                />
                <TouchableOpacity
                  style={styles.saveAddrBtn}
                  onPress={handleSaveCustomAddress}
                  activeOpacity={0.85}>
                  <Text style={styles.saveAddrText}>Save Deposit Address</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleShareAddress}
              activeOpacity={0.85}>
              <LinearGradient
                colors={Brand.gradientButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtnGradient}>
                <Ionicons name="share-outline" size={16} color="#07090E" />
                <Text style={styles.primaryBtnText}>Share / Copy Wallet Address</Text>
              </LinearGradient>
            </TouchableOpacity>

            <Text style={styles.warningNote}>
              {category === 'coin_stocks'
                ? 'Share this QR or ID with other YTCash users to receive Coin Stock shares.'
                : `Only send ${selectedAsset.symbol} over the ${activeNetwork} network to this address.`}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {category === 'coin_stocks'
                ? `Send ${selectedAsset.symbol} Shares`
                : `Withdraw / Send ${selectedAsset.symbol}`}
            </Text>
            <Text style={styles.assetDesc}>
              {category === 'coin_stocks'
                ? 'Transfer your earned Coin Stock shares to another YTCash user.'
                : `Withdraw ${selectedAsset.symbol} to an external ${activeNetwork} wallet address.`}
            </Text>

            <Text style={styles.inputLabel}>
              {category === 'coin_stocks'
                ? 'RECIPIENT YTCASH WALLET ID OR EMAIL'
                : `RECIPIENT ${activeNetwork.toUpperCase()} ADDRESS`}
            </Text>
            <TextInput
              style={styles.input}
              value={recipientAddress}
              onChangeText={setRecipientAddress}
              placeholder={
                category === 'coin_stocks'
                  ? 'ytc-stk-... or user@email.com'
                  : `Paste ${selectedAsset.symbol} (${activeNetwork}) address`
              }
              placeholderTextColor={BitcoinColors.textMuted}
              autoCapitalize="none"
            />

            <View style={styles.rowBetween}>
              <Text style={styles.inputLabel}>AMOUNT ({selectedAsset.symbol})</Text>
              <TouchableOpacity
                onPress={() => setSendAmountText(String(currentBalance))}
                activeOpacity={0.8}>
                <Text style={styles.linkText}>Max: {currentBalance}</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={sendAmountText}
              onChangeText={(t) => setSendAmountText(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={BitcoinColors.textMuted}
            />

            {recipientAddress.trim().length >= 8 && (
              <View style={styles.miniQrRow}>
                <Image
                  source={{
                    uri: `https://api.qrserver.com/v1/create-qr-code/?size=96x96&bgcolor=121722&color=06B6D4&data=${encodeURIComponent(
                      recipientAddress.trim(),
                    )}`,
                  }}
                  style={styles.miniQr}
                  contentFit="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniQrTitle}>Destination QR Preview</Text>
                  <Text style={styles.miniQrSub} numberOfLines={2}>
                    {recipientAddress.trim()}
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleWithdraw}
              disabled={busy}
              activeOpacity={0.85}>
              <LinearGradient
                colors={Brand.gradientButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtnGradient}>
                {busy ? (
                  <ActivityIndicator color="#07090E" />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={16} color="#07090E" />
                    <Text style={styles.primaryBtnText}>
                      {category === 'coin_stocks'
                        ? `Send ${selectedAsset.symbol}`
                        : `Withdraw ${selectedAsset.symbol}`}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Recent Asset Activity */}
        <Text style={styles.sectionTitle}>RECENT ASSET ACTIVITY</Text>
        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={{ marginTop: 16 }} />
        ) : transfers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="wallet-outline" size={24} color={BitcoinColors.orange} />
            <Text style={styles.emptyText}>
              No asset transfers yet. Deposit via QR, withdraw to a wallet, or claim daily Coin
              Stocks above.
            </Text>
          </View>
        ) : (
          transfers.map((tr) => (
            <View key={tr.id} style={styles.txRow}>
              <View style={styles.txIcon}>
                <Ionicons
                  name={
                    tr.direction === 'earn'
                      ? 'trending-up'
                      : tr.direction === 'send'
                      ? 'arrow-up'
                      : 'arrow-down'
                  }
                  size={16}
                  color={tr.direction === 'send' ? BitcoinColors.red : BitcoinColors.green}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle}>
                  {tr.direction === 'earn'
                    ? `Earned ${tr.amount} ${tr.symbol}`
                    : tr.direction === 'send'
                    ? `Sent ${tr.amount} ${tr.symbol}`
                    : `Received ${tr.amount} ${tr.symbol}`}
                </Text>
                <Text style={styles.txSub} numberOfLines={1}>
                  {tr.network} • {tr.address}
                </Text>
              </View>
              <Text style={styles.txDate}>
                {new Date(tr.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 14,
    padding: 4,
    borderRadius: 14,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  tabSelected: { backgroundColor: 'rgba(247, 147, 26, 0.16)' },
  tabText: { fontSize: 13, fontWeight: '700', color: BitcoinColors.textSecondary },
  tabTextSelected: { color: BitcoinColors.orange },
  scroll: { padding: 20, paddingBottom: 44, gap: 14 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    letterSpacing: 1,
  },
  categoryRow: { flexDirection: 'row', gap: 8 },
  catBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  catBtnActive: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.14)',
  },
  catText: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textSecondary },
  catTextActive: { color: BitcoinColors.orange },
  assetChipsRow: { gap: 8, paddingVertical: 2 },
  assetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  assetChipActive: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
  },
  assetDot: { width: 10, height: 10, borderRadius: 5 },
  assetSymbol: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  assetSymbolActive: { color: BitcoinColors.orange },
  assetBal: { fontSize: 10, color: BitcoinColors.textMuted },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  assetTitle: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  assetDesc: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 3, lineHeight: 17 },
  balanceNum: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  balanceUsd: { fontSize: 11, color: BitcoinColors.textMuted, marginTop: 2 },
  networkLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    letterSpacing: 0.9,
    marginTop: 14,
    marginBottom: 8,
  },
  networkRow: { gap: 8 },
  netChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  netChipActive: {
    borderColor: BitcoinColors.cyan,
    backgroundColor: 'rgba(6, 182, 212, 0.14)',
  },
  netText: { fontSize: 11, fontWeight: '700', color: BitcoinColors.textSecondary },
  netTextActive: { color: BitcoinColors.cyan },
  earnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  earnTitle: { fontSize: 13, fontWeight: '800', color: BitcoinColors.green },
  earnSub: { fontSize: 11, color: BitcoinColors.textSecondary, marginTop: 2, lineHeight: 16 },
  claimBtn: {
    backgroundColor: BitcoinColors.green,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  claimBtnText: { fontSize: 12, fontWeight: '800', color: '#07090E' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  linkText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.cyan },
  qrBox: {
    alignSelf: 'center',
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  qrImage: { width: 190, height: 190 },
  addrLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    letterSpacing: 0.9,
    marginTop: 14,
    marginBottom: 6,
  },
  addrBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  addrText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
  editAddrWrap: { marginTop: 10, gap: 8 },
  saveAddrBtn: {
    backgroundColor: BitcoinColors.cyan,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveAddrText: { fontSize: 12, fontWeight: '800', color: '#07090E' },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13,
    color: '#FFFFFF',
  },
  miniQrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  miniQr: { width: 52, height: 52, borderRadius: 6 },
  miniQrTitle: { fontSize: 12, fontWeight: '800', color: BitcoinColors.cyan },
  miniQrSub: { fontSize: 11, color: BitcoinColors.textSecondary, marginTop: 2 },
  primaryBtn: { marginTop: 16, borderRadius: 12, overflow: 'hidden' },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 8,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
  warningNote: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginTop: 6,
  },
  emptyCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 8,
  },
  emptyText: { fontSize: 12, color: BitcoinColors.textSecondary, textAlign: 'center', lineHeight: 18 },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  txIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: BitcoinColors.darkBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txTitle: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  txSub: { fontSize: 11, color: BitcoinColors.textMuted, marginTop: 2 },
  txDate: { fontSize: 11, color: BitcoinColors.textSecondary, fontWeight: '700' },
});
