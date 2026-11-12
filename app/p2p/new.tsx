import React, { useState } from 'react';
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
import { searchAddress, type AddressMatch } from '@/services/geocoding';
import { createP2POrder, P2P_MAX_AMOUNT, P2P_MIN_AMOUNT, p2pErrorMessage } from '@/services/p2p';

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export default function NewP2POrderScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const balance = profile?.balance ?? 0;

  const [amount, setAmount] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [address, setAddress] = useState('');
  const [matches, setMatches] = useState<AddressMatch[] | null>(null);
  const [place, setPlace] = useState<AddressMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [submitting, setSubmitting] = useState(false);

  const numAmount = parseFloat(amount) || 0;

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

  function validate(): string | null {
    if (numAmount < P2P_MIN_AMOUNT || numAmount > P2P_MAX_AMOUNT) {
      return `Enter an amount between ${formatCurrency(P2P_MIN_AMOUNT)} and ${formatCurrency(P2P_MAX_AMOUNT)}.`;
    }
    if (numAmount > balance) return 'Your wallet balance is too low for this amount.';
    if (receiverName.trim().length < 2) return "Enter the receiver's full name.";
    if (receiverPhone.replace(/[^\d]/g, '').length < 7) return "Enter the receiver's mobile number.";
    if (!place) return 'Tap "Find address" and choose the matching location.';
    return null;
  }

  function handleReview() {
    const problem = validate();
    if (problem) {
      Alert.alert('Check the details', problem);
      return;
    }
    setStep('review');
  }

  async function handleConfirm() {
    if (!place || submitting) return;
    if (!(await confirmWithBiometrics(user?.id, `Confirm sending ${formatCurrency(numAmount)}`))) return;
    setSubmitting(true);
    try {
      const order = await createP2POrder({
        amount: numAmount,
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        receiverAddress: address.trim(),
        lat: place.lat,
        lng: place.lng,
      });
      await refreshProfile();
      router.replace({ pathname: '/p2p/[id]', params: { id: order.id } });
    } catch (e) {
      Alert.alert('Could not create delivery', p2pErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title={step === 'form' ? 'New Cash Delivery' : 'Review Delivery'} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === 'form' ? (
          <View style={styles.card}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>AMOUNT (PHP)</Text>
              <Text style={styles.balanceText}>Available: {formatCurrency(balance)}</Text>
            </View>
            <View style={styles.amountBox}>
              <Text style={styles.currencySymbol}>₱</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                placeholderTextColor={BitcoinColors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount in pesos"
              />
            </View>
            <View style={styles.chipsRow}>
              {QUICK_AMOUNTS.map((value) => (
                <TouchableOpacity
                  key={value}
                  style={styles.chip}
                  onPress={() => setAmount(String(value))}
                  activeOpacity={0.75}>
                  <Text style={styles.chipText}>₱{value.toLocaleString()}</Text>
                </TouchableOpacity>
              ))}
            </View>

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
            <Text style={styles.reviewAmount}>{formatCurrency(numAmount)}</Text>
            <Text style={styles.reviewAmountSub}>in cash to {receiverName.trim()}</Text>

            <View style={styles.divider} />

            <ReviewRow label="Receiver" value={receiverName.trim()} />
            <ReviewRow label="Mobile" value={receiverPhone.trim()} />
            <ReviewRow label="Address" value={address.trim()} />
            <ReviewRow label="Matched near" value={place?.label ?? ''} />

            <View style={styles.infoBox}>
              <Ionicons name="lock-closed" size={16} color={BitcoinColors.orange} />
              <Text style={styles.infoText}>
                {formatCurrency(numAmount)} leaves your wallet now and is held until the receiver has the
                cash. You get a release code to pass to the receiver. You can cancel for a full refund
                until a partner accepts.
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
                disabled={submitting}
                activeOpacity={0.85}>
                <LinearGradient
                  colors={Brand.gradientButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtnGradient}>
                  {submitting && <ActivityIndicator size="small" color="#07090E" />}
                  <Text style={styles.primaryBtnText}>
                    {submitting ? 'Finding partner…' : 'Find nearest partner'}
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
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
  },
  labelSpaced: {
    marginTop: 18,
    marginBottom: 8,
  },
  balanceText: {
    fontSize: 11,
    fontWeight: '600',
    color: BitcoinColors.textMuted,
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
