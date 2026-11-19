import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors, Brand } from '@/constants/theme';
import { formatCurrency, phpToSats } from '@/constants/currencies';
import { confirmWithBiometrics } from '@/services/biometrics';
import {
  DEFAULT_BINANCE_BTC_ADDRESS,
  DEFAULT_BINANCE_BTC_NETWORK,
  fetchBinancePortfolio,
  getBinanceDepositConfig,
  withdrawBinanceUsdtToWallet,
  type BinanceDepositInfo,
} from '@/services/binance';
import { fetchExchangeRates } from '@/services/currency-api';
import { depositFunds, walletErrorMessage } from '@/services/supabase';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function AddMoneyScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<
    'card' | 'lightning' | 'binance_btc' | 'binance_usdt'
  >('card');
  const [phpPerUsd, setPhpPerUsd] = useState(58.5);
  const [availableBinanceUsdt, setAvailableBinanceUsdt] = useState<number | null>(null);
  const [binanceDeposit, setBinanceDeposit] = useState<BinanceDepositInfo>({
    btcDepositAddress: DEFAULT_BINANCE_BTC_ADDRESS,
    btcNetwork: DEFAULT_BINANCE_BTC_NETWORK,
    btcMemo: null,
    accountLabel: 'YTCash Binance Treasury',
  });

  useEffect(() => {
    getBinanceDepositConfig()
      .then(setBinanceDeposit)
      .catch(() => {});
    fetchExchangeRates('PHP')
      .then((fx) => {
        if (fx?.rates?.USD) setPhpPerUsd(1 / fx.rates.USD);
      })
      .catch(() => {});
    fetchBinancePortfolio()
      .then((port) => {
        if (port.connected) {
          setAvailableBinanceUsdt(port.availableUsdtToWithdraw ?? port.totalPortfolioUsdt);
        }
      })
      .catch(() => {});
  }, []);

  const quickAmounts = [100, 500, 1000, 2000, 5000];
  const numAmount = parseFloat(amount) || 0;
  const satsAmount = phpToSats(numAmount);

  async function handleAddMoney() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (!(await confirmWithBiometrics(user?.id, `Confirm adding ${formatCurrency(amt)}`))) return;

    setLoading(true);
    try {
      if (selectedMethod === 'binance_usdt') {
        const usdtNeeded = Math.round((amt / phpPerUsd) * 10000) / 10000;
        const res = await withdrawBinanceUsdtToWallet({
          usdtAmount: usdtNeeded,
          phpRate: phpPerUsd,
        });
        await refreshProfile();
        Alert.alert(
          'Binance USDT Credited!',
          `${res.usdtAmount.toFixed(2)} USDT (@ ₱${res.phpRate.toFixed(2)}) has been converted and ${formatCurrency(
            res.phpCredited,
          )} (${satsAmount.toLocaleString()} sats) was added to your YTCash wallet.`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
        return;
      }

      await depositFunds(amt, selectedMethod === 'card' ? 'card' : 'lightning');
      await refreshProfile();

      Alert.alert(
        'Deposit Confirmed!',
        `${formatCurrency(amt)} (${satsAmount.toLocaleString()} sats) has been added to your wallet.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert('Deposit Failed', walletErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Deposit Funds</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.card}>
        <View style={styles.balanceHeader}>
          <View>
            <Text style={styles.balanceLabel}>CURRENT WALLET BALANCE</Text>
            <Text style={styles.balanceValue}>{formatCurrency(profile?.balance ?? 0)}</Text>
          </View>
          <BitcoinBadge size={44} glow={false} />
        </View>

        <Text style={styles.label}>AMOUNT TO DEPOSIT (PHP)</Text>
        <View style={styles.amountBox}>
          <View style={styles.amountRow}>
            <Text style={styles.currencySymbol}>₱</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={BitcoinColors.textMuted}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>

          {numAmount > 0 && (
            <View style={styles.satsConversionRow}>
              <Text style={styles.satsConversionIcon}>⚡</Text>
              <Text style={styles.satsConversionText}>
                Yields ≈ {satsAmount.toLocaleString()} SATS
              </Text>
            </View>
          )}
        </View>

        {/* Quick amounts */}
        <View style={styles.quickRow}>
          {quickAmounts.map((qa) => (
            <TouchableOpacity
              key={qa}
              style={[styles.quickChip, amount === String(qa) && styles.quickChipActive]}
              onPress={() => setAmount(String(qa))}>
              <Text style={[styles.quickText, amount === String(qa) && styles.quickTextActive]}>
                ₱{qa.toLocaleString()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Payment methods */}
        <Text style={styles.methodsTitle}>DEPOSIT CHANNEL</Text>

        <TouchableOpacity
          style={[styles.methodCard, selectedMethod === 'card' && styles.methodCardActive]}
          onPress={() => setSelectedMethod('card')}
          activeOpacity={0.8}>
          <View style={styles.methodIconWrap}>
            <Ionicons name="card" size={22} color={BitcoinColors.orange} />
          </View>
          <View style={styles.methodInfo}>
            <Text style={styles.methodName}>Credit / Debit Card</Text>
            <Text style={styles.methodSub}>Instant fiat settlement via Stripe</Text>
          </View>
          <Ionicons
            name={selectedMethod === 'card' ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selectedMethod === 'card' ? BitcoinColors.orange : BitcoinColors.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, selectedMethod === 'lightning' && styles.methodCardActive]}
          onPress={() => setSelectedMethod('lightning')}
          activeOpacity={0.8}>
          <View style={[styles.methodIconWrap, { backgroundColor: 'rgba(255, 208, 38, 0.15)' }]}>
            <Ionicons name="flash" size={22} color={BitcoinColors.lightning} />
          </View>
          <View style={styles.methodInfo}>
            <Text style={styles.methodName}>Bitcoin Lightning Invoice</Text>
            <Text style={styles.methodSub}>Pay with any Lightning wallet (Strike, Cash App, Blink)</Text>
          </View>
          <Ionicons
            name={selectedMethod === 'lightning' ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selectedMethod === 'lightning' ? BitcoinColors.orange : BitcoinColors.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, selectedMethod === 'binance_usdt' && styles.methodCardActive]}
          onPress={() => setSelectedMethod('binance_usdt')}
          activeOpacity={0.8}>
          <View style={[styles.methodIconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.16)' }]}>
            <Ionicons name="swap-horizontal" size={22} color={BitcoinColors.green} />
          </View>
          <View style={styles.methodInfo}>
            <Text style={styles.methodName}>Withdraw USDT from Linked Binance</Text>
            <Text style={styles.methodSub}>
              {availableBinanceUsdt !== null
                ? `Available: $${availableBinanceUsdt.toFixed(2)} USDT • Instant PHP conversion`
                : 'Convert linked Binance USDT directly into your YTCash PHP wallet'}
            </Text>
          </View>
          <Ionicons
            name={selectedMethod === 'binance_usdt' ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selectedMethod === 'binance_usdt' ? BitcoinColors.orange : BitcoinColors.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, selectedMethod === 'binance_btc' && styles.methodCardActive]}
          onPress={() => setSelectedMethod('binance_btc')}
          activeOpacity={0.8}>
          <View style={[styles.methodIconWrap, { backgroundColor: 'rgba(247, 147, 26, 0.18)' }]}>
            <Ionicons name="logo-bitcoin" size={22} color={BitcoinColors.gold} />
          </View>
          <View style={styles.methodInfo}>
            <Text style={styles.methodName}>Binance Bitcoin (BTC) Deposit</Text>
            <Text style={styles.methodSub}>
              Send BTC directly to {binanceDeposit.accountLabel} ({binanceDeposit.btcNetwork})
            </Text>
          </View>
          <Ionicons
            name={selectedMethod === 'binance_btc' ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selectedMethod === 'binance_btc' ? BitcoinColors.orange : BitcoinColors.textMuted}
          />
        </TouchableOpacity>

        {selectedMethod === 'binance_btc' && (
          <View style={styles.binanceDepositBox}>
            <Text style={styles.binanceDepositTitle}>
              SEND BITCOIN ({binanceDeposit.btcNetwork.toUpperCase()}) TO:
            </Text>
            <View style={styles.binanceQrWrap}>
              <Image
                source={{
                  uri: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&bgcolor=121722&color=F7931A&data=${encodeURIComponent(
                    `bitcoin:${binanceDeposit.btcDepositAddress}`,
                  )}`,
                }}
                style={styles.binanceQr}
                contentFit="contain"
              />
            </View>
            <Text style={styles.binanceAddressText} selectable>
              {binanceDeposit.btcDepositAddress}
            </Text>
            <View style={styles.binanceActionRow}>
              <TouchableOpacity
                style={styles.binanceShareBtn}
                onPress={() =>
                  Share.share({
                    message: `Binance BTC Deposit Address (${binanceDeposit.btcNetwork}):\n${binanceDeposit.btcDepositAddress}`,
                  }).catch(() => {})
                }
                activeOpacity={0.8}>
                <Ionicons name="share-social-outline" size={14} color={BitcoinColors.orange} />
                <Text style={styles.binanceShareText}>Copy / Share Address</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.binanceShareBtn}
                onPress={() => router.push('/binance')}
                activeOpacity={0.8}>
                <Ionicons name="settings-outline" size={14} color={BitcoinColors.gold} />
                <Text style={[styles.binanceShareText, { color: BitcoinColors.gold }]}>
                  Manage in Binance Hub
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.addBtn, loading && styles.addBtnDisabled]}
          onPress={handleAddMoney}
          disabled={loading}
          activeOpacity={0.85}>
          <LinearGradient colors={Brand.gradientButton} style={styles.addBtnGradient}>
            <Ionicons name="flash" size={18} color="#07090E" />
            <Text style={styles.addBtnText}>
              {loading
                ? 'Processing Deposit...'
                : `Deposit ${amount ? formatCurrency(numAmount) : 'Funds'}`}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Security verified • End-to-end encrypted • Zero processing fees
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  scroll: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: BitcoinColors.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: BitcoinColors.border,
  },
  backBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  card: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
  },
  balanceValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  amountBox: {
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    borderRadius: 16,
    padding: 16,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '900',
    color: BitcoinColors.orange,
    marginRight: 10,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  satsConversionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    gap: 4,
  },
  satsConversionIcon: {
    color: BitcoinColors.lightning,
    fontSize: 12,
  },
  satsConversionText: {
    color: BitcoinColors.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  quickChip: {
    flex: 1,
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  quickChipActive: {
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderColor: BitcoinColors.orange,
  },
  quickText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  quickTextActive: {
    color: BitcoinColors.orange,
  },
  methodsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 10,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  methodCardActive: {
    borderColor: 'rgba(247, 147, 26, 0.5)',
    backgroundColor: 'rgba(247, 147, 26, 0.06)',
  },
  methodIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  methodInfo: {
    flex: 1,
  },
  methodName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  methodSub: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  addBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 18,
  },
  addBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 8,
  },
  addBtnText: {
    color: '#07090E',
    fontWeight: '800',
    fontSize: 15,
  },
  addBtnDisabled: {
    opacity: 0.6,
  },
  disclaimer: {
    textAlign: 'center',
    fontSize: 11,
    color: BitcoinColors.textMuted,
    marginTop: 14,
  },
  binanceDepositBox: {
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  binanceDepositTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  binanceQrWrap: {
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#121722',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    marginBottom: 10,
  },
  binanceQr: {
    width: 150,
    height: 150,
  },
  binanceAddressText: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.gold,
    textAlign: 'center',
    lineHeight: 18,
  },
  binanceActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  binanceShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  binanceShareText: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
});
