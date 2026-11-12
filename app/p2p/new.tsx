import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { formatCurrency } from '@/constants/currencies';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { confirmWithBiometrics } from '@/services/biometrics';
import {
  formatMoney,
  formatRate,
  fxErrorMessage,
  quoteSecondsLeft,
  requestQuote,
  type FxQuote,
  type QuoteCurrency,
  type QuoteSide,
} from '@/services/fx';
import { searchAddress, type AddressMatch } from '@/services/geocoding';
import {
  createP2POrder,
  createP2POrderFromQuote,
  P2P_MAX_AMOUNT,
  P2P_MIN_AMOUNT,
  p2pErrorMessage,
} from '@/services/p2p';

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

/** How the sender pays: a foreign currency at a quoted rate, or their PHP wallet balance. */
type PayIn = QuoteCurrency | 'PHP';
const PAY_OPTIONS: { value: PayIn; label: string }[] = [
  { value: 'AED', label: 'AED' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'PHP', label: 'PHP wallet' },
];

function cleanAmount(text: string): string {
  return text.replace(/[^0-9.]/g, '');
}

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function NewP2POrderScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const balance = profile?.balance ?? 0;

  const [payIn, setPayIn] = useState<PayIn>('AED');
  const [payText, setPayText] = useState('');
  const [receiveText, setReceiveText] = useState('');
  /** Which of the two amount boxes the user typed in last. */
  const [side, setSide] = useState<QuoteSide>('pay');
  const [quote, setQuote] = useState<FxQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const quoteRequest = useRef(0);

  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [address, setAddress] = useState('');
  const [matches, setMatches] = useState<AddressMatch[] | null>(null);
  const [place, setPlace] = useState<AddressMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [submitting, setSubmitting] = useState(false);

  const usingQuote = payIn !== 'PHP';
  const typedAmount = parseFloat(side === 'pay' ? payText : receiveText) || 0;
  const walletAmount = parseFloat(receiveText) || 0;
  const quoteExpired = quote !== null && secondsLeft <= 0;

  // ─── Quote ────────────────────────────────────────────
  const fetchQuote = useCallback(
    async (currency: QuoteCurrency, quoteSide: QuoteSide, amount: number) => {
      const request = ++quoteRequest.current;
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const next = await requestQuote(currency, quoteSide, amount);
        if (request !== quoteRequest.current) return; // a newer request replaced this one
        setQuote(next);
        setSecondsLeft(quoteSecondsLeft(next));
        // Fill in the box the user did not type in.
        if (quoteSide === 'pay') setReceiveText(next.receive_amount.toFixed(2));
        else setPayText(next.pay_amount.toFixed(2));
      } catch (e) {
        if (request !== quoteRequest.current) return;
        setQuote(null);
        setQuoteError(fxErrorMessage(e));
      } finally {
        if (request === quoteRequest.current) setQuoteLoading(false);
      }
    },
    [],
  );

  // Ask for a quote shortly after the user stops typing.
  useEffect(() => {
    if (!usingQuote || step !== 'form') return;
    if (typedAmount <= 0) {
      quoteRequest.current++;
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    const timer = setTimeout(() => fetchQuote(payIn as QuoteCurrency, side, typedAmount), 600);
    return () => clearTimeout(timer);
    // payText / receiveText are covered by typedAmount.
  }, [usingQuote, step, payIn, side, typedAmount, fetchQuote]);

  // Count down the time the rate is held.
  useEffect(() => {
    if (!quote) return;
    const tick = () => setSecondsLeft(quoteSecondsLeft(quote));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [quote]);

  function refreshQuote() {
    if (usingQuote && typedAmount > 0) fetchQuote(payIn as QuoteCurrency, side, typedAmount);
  }

  function selectPayIn(next: PayIn) {
    setPayIn(next);
    setQuote(null);
    setQuoteError(null);
    if (next === 'PHP') {
      setPayText('');
    } else if (receiveText) {
      // Keep what the receiver gets and re-price it in the new currency.
      setSide('receive');
    }
  }

  function onPayChange(text: string) {
    setPayText(cleanAmount(text));
    setSide('pay');
  }

  function onReceiveChange(text: string) {
    setReceiveText(cleanAmount(text));
    setSide('receive');
  }

  // ─── Address ──────────────────────────────────────────
  function onAddressChange(text: string) {
    setAddress(text);
    // The matched location belongs to the text that was searched; clear it when the text changes.
    setPlace(null);
    setMatches(null);
    setSearchError(null);
  }

  async function handleFindAddress() {
    if (address.trim().length < 5) {
      setSearchError('Enter the street, barangay and city.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setPlace(null);
    try {
      const results = await searchAddress(address);
      setMatches(results);
      if (results.length === 0) {
        setSearchError('No match found. Try adding the barangay, city or province.');
      }
    } catch (e: any) {
      setMatches(null);
      setSearchError(e?.message ?? 'Address search failed. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  }

  // ─── Review and confirm ───────────────────────────────
  function validate(): string | null {
    if (usingQuote) {
      if (quoteLoading) return 'Wait a moment while we get your rate.';
      if (!quote) return quoteError ?? 'Enter how much you want to send.';
      if (quoteExpired) return 'The rate has expired. A new one is being fetched.';
    } else {
      if (walletAmount < P2P_MIN_AMOUNT || walletAmount > P2P_MAX_AMOUNT) {
        return `Enter an amount between ${formatCurrency(P2P_MIN_AMOUNT)} and ${formatCurrency(P2P_MAX_AMOUNT)}.`;
      }
      if (walletAmount > balance) return 'Your wallet balance is too low for this amount.';
    }
    if (receiverName.trim().length < 2) return "Enter the receiver's full name.";
    if (receiverPhone.replace(/[^\d]/g, '').length < 7) return "Enter the receiver's mobile number.";
    if (!place) return 'Tap "Find address" and choose the matching location.';
    return null;
  }

  function handleReview() {
    if (usingQuote && quoteExpired) refreshQuote();
    const problem = validate();
    if (problem) {
      Alert.alert('Check the details', problem);
      return;
    }
    setStep('review');
  }

  async function handleConfirm() {
    if (!place || submitting) return;
    if (usingQuote && (!quote || quoteExpired)) {
      refreshQuote();
      return;
    }

    const payLabel = usingQuote && quote ? formatMoney(quote.pay_amount, quote.from_currency) : formatCurrency(walletAmount);
    if (!(await confirmWithBiometrics(user?.id, `Confirm paying ${payLabel}`))) return;

    setSubmitting(true);
    try {
      const receiver = {
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        receiverAddress: address.trim(),
        lat: place.lat,
        lng: place.lng,
      };
      const order =
        usingQuote && quote
          ? await createP2POrderFromQuote({ ...receiver, quoteId: quote.id })
          : await createP2POrder({ ...receiver, amount: walletAmount });
      await refreshProfile();
      router.replace({ pathname: '/p2p/[id]', params: { id: order.id } });
    } catch (e) {
      const message = p2pErrorMessage(e);
      Alert.alert('Could not create delivery', message);
      // A quote that can no longer be used is replaced so the user sees the new price.
      if (usingQuote && /quote|rate expired/i.test(message)) refreshQuote();
    } finally {
      setSubmitting(false);
    }
  }

  const receiveAmount = usingQuote ? quote?.receive_amount ?? 0 : walletAmount;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title={step === 'form' ? 'New Cash Delivery' : 'Review Delivery'} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === 'form' ? (
          <View style={styles.card}>
            <Text style={styles.label}>PAY IN</Text>
            <View style={styles.payOptions}>
              {PAY_OPTIONS.map((option) => {
                const selected = option.value === payIn;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.payOption, selected && styles.payOptionSelected]}
                    onPress={() => selectPayIn(option.value)}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.payOptionText, selected && styles.payOptionTextSelected]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {usingQuote && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>YOU PAY ({payIn})</Text>
                <View style={styles.amountBox}>
                  <Text style={styles.currencyCode}>{payIn}</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={payText}
                    onChangeText={onPayChange}
                    placeholder="0.00"
                    placeholderTextColor={BitcoinColors.textMuted}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Amount you pay in ${payIn}, fee included`}
                  />
                </View>
              </>
            )}

            <View style={[styles.labelRow, styles.labelSpaced]}>
              <Text style={styles.label}>{usingQuote ? 'RECEIVER GETS (PHP)' : 'AMOUNT (PHP)'}</Text>
              {!usingQuote && <Text style={styles.balanceText}>Available: {formatCurrency(balance)}</Text>}
            </View>
            <View style={styles.amountBox}>
              <Text style={styles.currencySymbol}>₱</Text>
              <TextInput
                style={styles.amountInput}
                value={receiveText}
                onChangeText={onReceiveChange}
                placeholder="0.00"
                placeholderTextColor={BitcoinColors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount the receiver gets in pesos"
              />
            </View>
            <View style={styles.chipsRow}>
              {QUICK_AMOUNTS.map((value) => (
                <TouchableOpacity
                  key={value}
                  style={styles.chip}
                  onPress={() => onReceiveChange(String(value))}
                  activeOpacity={0.75}>
                  <Text style={styles.chipText}>₱{value.toLocaleString()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {usingQuote && (quote || quoteLoading || quoteError) && (
              <View style={[styles.quoteBox, quoteError ? styles.quoteBoxError : null]}>
                {quoteError ? (
                  <Text style={styles.quoteErrorText}>{quoteError}</Text>
                ) : quote ? (
                  <>
                    <QuoteLine label="Exchange rate" value={formatRate(quote)} />
                    <QuoteLine label="Transfer fee (included)" value={formatMoney(quote.fee_amount, quote.from_currency)} />
                    <View style={styles.quoteFooter}>
                      {quoteLoading ? (
                        <ActivityIndicator size="small" color={BitcoinColors.orange} />
                      ) : (
                        <Ionicons
                          name={quoteExpired ? 'refresh' : 'lock-closed'}
                          size={13}
                          color={quoteExpired ? BitcoinColors.orange : BitcoinColors.green}
                        />
                      )}
                      {quoteExpired ? (
                        <TouchableOpacity onPress={refreshQuote} accessibilityRole="button">
                          <Text style={styles.quoteRefresh}>Rate expired. Tap to refresh.</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.quoteHeld}>
                          {quoteLoading ? 'Updating rate…' : `Rate held for ${formatCountdown(secondsLeft)}`}
                        </Text>
                      )}
                    </View>
                  </>
                ) : (
                  <View style={styles.quoteFooter}>
                    <ActivityIndicator size="small" color={BitcoinColors.orange} />
                    <Text style={styles.quoteHeld}>Getting your rate…</Text>
                  </View>
                )}
              </View>
            )}

            <Text style={[styles.label, styles.labelSpaced]}>RECEIVER&apos;S FULL NAME</Text>
            <TextInput
              style={styles.input}
              value={receiverName}
              onChangeText={setReceiverName}
              placeholder="As shown on their ID"
              placeholderTextColor={BitcoinColors.textMuted}
              autoCapitalize="words"
              maxLength={80}
            />

            <Text style={[styles.label, styles.labelSpaced]}>RECEIVER&apos;S MOBILE NUMBER</Text>
            <TextInput
              style={styles.input}
              value={receiverPhone}
              onChangeText={setReceiverPhone}
              placeholder="+63 9XX XXX XXXX"
              placeholderTextColor={BitcoinColors.textMuted}
              keyboardType="phone-pad"
              maxLength={30}
            />

            <Text style={[styles.label, styles.labelSpaced]}>RECEIVER&apos;S ADDRESS</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={address}
              onChangeText={onAddressChange}
              placeholder="Street, barangay, city, province"
              placeholderTextColor={BitcoinColors.textMuted}
              multiline
              maxLength={300}
            />
            <TouchableOpacity
              style={styles.findBtn}
              onPress={handleFindAddress}
              disabled={searching}
              activeOpacity={0.8}
              accessibilityRole="button">
              {searching ? (
                <ActivityIndicator size="small" color={BitcoinColors.orange} />
              ) : (
                <Ionicons name="search" size={16} color={BitcoinColors.orange} />
              )}
              <Text style={styles.findBtnText}>{searching ? 'Searching…' : 'Find address'}</Text>
            </TouchableOpacity>

            {searchError && <Text style={styles.errorText}>{searchError}</Text>}

            {place ? (
              <View style={styles.placeBox}>
                <Ionicons name="checkmark-circle" size={18} color={BitcoinColors.green} />
                <View style={styles.placeTextWrap}>
                  <Text style={styles.placeTitle}>Location found</Text>
                  <Text style={styles.placeLabel}>{place.label}</Text>
                </View>
                <TouchableOpacity onPress={() => setPlace(null)} accessibilityRole="button">
                  <Text style={styles.changeLink}>Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              matches &&
              matches.length > 0 && (
                <View style={styles.matchList}>
                  <Text style={styles.matchHint}>Choose the closest match:</Text>
                  {matches.map((match, i) => (
                    <TouchableOpacity
                      key={`${match.lat},${match.lng},${i}`}
                      style={styles.matchRow}
                      onPress={() => setPlace(match)}
                      activeOpacity={0.75}
                      accessibilityRole="button">
                      <Ionicons name="location-outline" size={16} color={BitcoinColors.orange} />
                      <Text style={styles.matchText}>{match.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleReview} activeOpacity={0.85}>
              <LinearGradient
                colors={Brand.gradientButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtnGradient}>
                <Text style={styles.primaryBtnText}>Review delivery</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.reviewAmount}>{formatCurrency(receiveAmount)}</Text>
            <Text style={styles.reviewAmountSub}>in cash to {receiverName.trim()}</Text>

            <View style={styles.divider} />

            {usingQuote && quote && (
              <>
                <ReviewRow label="You pay" value={formatMoney(quote.pay_amount, quote.from_currency)} />
                <ReviewRow label="Transfer fee" value={`${formatMoney(quote.fee_amount, quote.from_currency)} (included)`} />
                <ReviewRow label="Exchange rate" value={formatRate(quote)} />
                <ReviewRow
                  label="Rate held"
                  value={quoteLoading ? 'Updating…' : quoteExpired ? 'Expired' : `for ${formatCountdown(secondsLeft)}`}
                />
                <View style={styles.divider} />
              </>
            )}

            <ReviewRow label="Receiver" value={receiverName.trim()} />
            <ReviewRow label="Mobile" value={receiverPhone.trim()} />
            <ReviewRow label="Address" value={address.trim()} />
            <ReviewRow label="Matched near" value={place?.label ?? ''} />

            <View style={styles.infoBox}>
              <Ionicons name="lock-closed" size={16} color={BitcoinColors.orange} />
              <Text style={styles.infoText}>
                {usingQuote
                  ? `Test payment: no card is charged yet. ${formatCurrency(receiveAmount)} is held until the receiver has the cash, and you get a release code to pass to them. If you cancel before a partner accepts, the pesos go to your YTCash wallet.`
                  : `${formatCurrency(receiveAmount)} leaves your wallet now and is held until the receiver has the cash. You get a release code to pass to the receiver. You can cancel for a full refund until a partner accepts.`}
              </Text>
            </View>

            <View style={styles.reviewButtons}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setStep('form')}
                disabled={submitting}
                activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, styles.reviewPrimary]}
                onPress={handleConfirm}
                disabled={submitting || quoteLoading}
                activeOpacity={0.85}>
                <LinearGradient
                  colors={Brand.gradientButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtnGradient}>
                  {(submitting || quoteLoading) && <ActivityIndicator size="small" color="#07090E" />}
                  <Text style={styles.primaryBtnText}>
                    {submitting
                      ? 'Finding partner…'
                      : usingQuote && quoteExpired
                      ? 'Get new rate'
                      : usingQuote && quote
                      ? `Pay ${formatMoney(quote.pay_amount, quote.from_currency)}`
                      : 'Find nearest partner'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function QuoteLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.quoteLine}>
      <Text style={styles.quoteLabel}>{label}</Text>
      <Text style={styles.quoteValue}>{value}</Text>
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
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
    paddingBottom: 40,
  },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  labelSpaced: {
    marginTop: 18,
  },
  balanceText: {
    fontSize: 11,
    fontWeight: '600',
    color: BitcoinColors.textMuted,
    marginBottom: 8,
  },
  payOptions: {
    flexDirection: 'row',
    gap: 6,
  },
  payOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  payOptionSelected: {
    backgroundColor: 'rgba(247, 147, 26, 0.16)',
    borderColor: 'rgba(247, 147, 26, 0.5)',
  },
  payOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  payOptionTextSelected: {
    color: BitcoinColors.orange,
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: '800',
    color: BitcoinColors.orange,
    marginRight: 6,
  },
  currencyCode: {
    fontSize: 15,
    fontWeight: '800',
    color: BitcoinColors.orange,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    paddingVertical: 12,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.orangeLight,
  },
  quoteBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  quoteBoxError: {
    backgroundColor: 'rgba(244, 63, 94, 0.06)',
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
  quoteLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  quoteLabel: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
  },
  quoteValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  quoteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  quoteHeld: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.green,
  },
  quoteRefresh: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  quoteErrorText: {
    fontSize: 12,
    lineHeight: 17,
    color: BitcoinColors.red,
  },
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
  inputMultiline: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  findBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
  },
  findBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    color: BitcoinColors.red,
    marginTop: 8,
  },
  placeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  placeTextWrap: {
    flex: 1,
  },
  placeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.green,
  },
  placeLabel: {
    fontSize: 12,
    lineHeight: 17,
    color: '#E2E8F0',
    marginTop: 2,
  },
  changeLink: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  matchList: {
    marginTop: 12,
  },
  matchHint: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginBottom: 6,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 6,
  },
  matchText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#E2E8F0',
  },
  primaryBtn: {
    marginTop: 20,
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 10,
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#07090E',
  },
  reviewAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  reviewAmountSub: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: BitcoinColors.border,
    marginVertical: 16,
  },
  reviewRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  reviewLabel: {
    width: 96,
    fontSize: 12,
    color: BitcoinColors.textMuted,
  },
  reviewValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#E2E8F0',
  },
  reviewButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  secondaryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reviewPrimary: {
    flex: 1,
    marginTop: 0,
  },
});
