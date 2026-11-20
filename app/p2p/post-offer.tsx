import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { fetchExchangeRates } from '@/services/currency-api';
import { searchAddress, type AddressMatch } from '@/services/geocoding';
import {
  createExchangeOffer,
  getExchangeCurrency,
  LOCAL_CURRENCY_CODES,
  OFFER_CURRENCY_CODES,
  PUBLIC_MEETUP_SUGGESTIONS,
  type ExchangeSide,
} from '@/services/p2p-exchange';

function cleanNum(text: string): string {
  return text.replace(/[^0-9.]/g, '');
}

export default function PostP2POfferScreen() {
  const { user, profile } = useAuth();
  const [side, setSide] = useState<ExchangeSide>('sell');
  const [offerCurrency, setOfferCurrency] = useState('USD');
  const [localCurrency, setLocalCurrency] = useState('PHP');
  const [rateText, setRateText] = useState('');
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [loadingRate, setLoadingRate] = useState(false);

  const [totalText, setTotalText] = useState('500');
  const [minText, setMinText] = useState('50');
  const [maxText, setMaxText] = useState('500');

  const [meetupLocation, setMeetupLocation] = useState('');
  const [meetupCity, setMeetupCity] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<AddressMatch | null>(null);
  const [addressMatches, setAddressMatches] = useState<AddressMatch[] | null>(null);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [notes, setNotes] = useState('');
  const [publicSafeAgreed, setPublicSafeAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadRate() {
      setLoadingRate(true);
      try {
        const res = await fetchExchangeRates(offerCurrency);
        const r = res.rates[localCurrency];
        if (active && r && r > 0) {
          const rounded = Number(r.toFixed(localCurrency === 'JPY' ? 2 : 4));
          setLiveRate(rounded);
          setRateText((prev) => (prev ? prev : String(rounded)));
        }
      } catch {
        // Ignore offline errors; user can type rate manually.
      } finally {
        if (active) setLoadingRate(false);
      }
    }
    loadRate();
    return () => {
      active = false;
    };
  }, [offerCurrency, localCurrency]);

  function handleSelectOfferCurrency(code: string) {
    setOfferCurrency(code);
    setRateText('');
    if (code === localCurrency) {
      setLocalCurrency(code === 'PHP' ? 'USD' : 'PHP');
    }
  }

  function handleSelectLocalCurrency(code: string) {
    setLocalCurrency(code);
    setRateText('');
    if (code === offerCurrency) {
      setOfferCurrency(code === 'USD' ? 'EUR' : 'USD');
    }
  }

  async function handleSearchPlace() {
    const q = meetupLocation.trim();
    if (q.length < 3) {
      Alert.alert('Enter a place name', 'Type a mall, plaza, or public landmark to search.');
      return;
    }
    setSearchingAddress(true);
    try {
      const results = await searchAddress(q);
      setAddressMatches(results);
    } catch {
      setAddressMatches([]);
    } finally {
      setSearchingAddress(false);
    }
  }

  async function handleSubmit() {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in to post a P2P exchange offer.');
      return;
    }
    const rate = Number(rateText);
    const total = Number(totalText);
    const min = Number(minText);
    const max = Number(maxText);

    if (!rate || rate <= 0) {
      Alert.alert('Invalid rate', 'Enter a valid exchange rate.');
      return;
    }
    if (!total || total <= 0) {
      Alert.alert('Invalid amount', 'Enter the total amount you want to exchange.');
      return;
    }
    if (!min || min <= 0 || min > max || max > total) {
      Alert.alert('Invalid limits', 'Ensure Min Limit ≤ Max Limit ≤ Total Amount.');
      return;
    }
    if (meetupLocation.trim().length < 4) {
      Alert.alert(
        'Public meetup location required',
        'Enter a well-known public venue (e.g. mall, cafe, bank lobby) where you agree to meet.',
      );
      return;
    }
    if (!publicSafeAgreed) {
      Alert.alert('Safety agreement', 'Confirm that you will meet only in a public location.');
      return;
    }

    setSubmitting(true);
    try {
      await createExchangeOffer({
        makerId: user.id,
        makerName: profile?.full_name || user.email?.split('@')[0] || 'YTCash User',
        makerVerified: Boolean(profile?.kyc_verified),
        side,
        offerCurrency,
        localCurrency,
        rate,
        totalAmount: total,
        minLimit: min,
        maxLimit: max,
        meetupLocation: meetupLocation.trim(),
        meetupCity: meetupCity.trim(),
        meetupLat: selectedPlace?.lat ?? null,
        meetupLng: selectedPlace?.lng ?? null,
        notes: notes.trim(),
      });
      Alert.alert('Offer posted', 'Your P2P cash exchange offer is now live in the marketplace.');
      router.back();
    } catch (e: any) {
      Alert.alert('Could not post offer', e?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const offerInfo = getExchangeCurrency(offerCurrency);
  const localInfo = getExchangeCurrency(localCurrency);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Post Exchange Offer" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Side toggle */}
          <Text style={styles.label}>I WANT TO</Text>
          <View style={styles.sideRow}>
            <TouchableOpacity
              style={[styles.sideBtn, side === 'sell' && styles.sideBtnSellActive]}
              onPress={() => setSide('sell')}
              activeOpacity={0.85}>
              <Text style={[styles.sideTitle, side === 'sell' && styles.sideTitleSell]}>
                Exchange / Sell {offerCurrency}
              </Text>
              <Text style={styles.sideSub}>I have {offerCurrency}, want {localCurrency}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sideBtn, side === 'buy' && styles.sideBtnBuyActive]}
              onPress={() => setSide('buy')}
              activeOpacity={0.85}>
              <Text style={[styles.sideTitle, side === 'buy' && styles.sideTitleBuy]}>
                Buy {offerCurrency}
              </Text>
              <Text style={styles.sideSub}>I have {localCurrency}, want {offerCurrency}</Text>
            </TouchableOpacity>
          </View>

          {/* Currency pair */}
          <Text style={styles.label}>CURRENCY OFFERED / REQUESTED</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {OFFER_CURRENCY_CODES.map((code) => {
              const c = getExchangeCurrency(code);
              const selected = offerCurrency === code;
              return (
                <TouchableOpacity
                  key={code}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => handleSelectOfferCurrency(code)}
                  activeOpacity={0.8}>
                  <Text style={styles.chipFlag}>{c.flag}</Text>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{code}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>LOCAL CURRENCY (IN-PERSON CASH)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {LOCAL_CURRENCY_CODES.map((code) => {
              const c = getExchangeCurrency(code);
              const selected = localCurrency === code;
              return (
                <TouchableOpacity
                  key={code}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => handleSelectLocalCurrency(code)}
                  activeOpacity={0.8}>
                  <Text style={styles.chipFlag}>{c.flag}</Text>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{code}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Exchange Rate */}
          <View style={styles.rateHeader}>
            <Text style={styles.label}>
              EXCHANGE RATE (1 {offerCurrency} = ? {localCurrency})
            </Text>
            {loadingRate ? (
              <ActivityIndicator size="small" color={BitcoinColors.orange} />
            ) : liveRate ? (
              <TouchableOpacity onPress={() => setRateText(String(liveRate))} activeOpacity={0.8}>
                <Text style={styles.useLiveText}>
                  Use market: {localInfo.symbol}
                  {liveRate}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.inputWrap}>
            <Text style={styles.prefix}>{localInfo.symbol}</Text>
            <TextInput
              style={styles.input}
              value={rateText}
              onChangeText={(t) => setRateText(cleanNum(t))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={BitcoinColors.textMuted}
            />
            <Text style={styles.suffix}>per {offerCurrency}</Text>
          </View>

          {/* Amount & Limits */}
          <Text style={styles.label}>TOTAL AMOUNT ({offerCurrency})</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.prefix}>{offerInfo.symbol}</Text>
            <TextInput
              style={styles.input}
              value={totalText}
              onChangeText={(t) => setTotalText(cleanNum(t))}
              keyboardType="decimal-pad"
              placeholder="500"
              placeholderTextColor={BitcoinColors.textMuted}
            />
          </View>

          <View style={styles.limitRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>MIN LIMIT ({offerCurrency})</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.prefix}>{offerInfo.symbol}</Text>
                <TextInput
                  style={styles.input}
                  value={minText}
                  onChangeText={(t) => setMinText(cleanNum(t))}
                  keyboardType="decimal-pad"
                  placeholder="50"
                  placeholderTextColor={BitcoinColors.textMuted}
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>MAX LIMIT ({offerCurrency})</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.prefix}>{offerInfo.symbol}</Text>
                <TextInput
                  style={styles.input}
                  value={maxText}
                  onChangeText={(t) => setMaxText(cleanNum(t))}
                  keyboardType="decimal-pad"
                  placeholder="500"
                  placeholderTextColor={BitcoinColors.textMuted}
                />
              </View>
            </View>
          </View>

          {/* Public Meetup Location */}
          <Text style={styles.label}>AGREED PUBLIC MEETUP LOCATION</Text>
          <View style={styles.locationRow}>
            <TextInput
              style={[styles.textInput, { flex: 1 }]}
              value={meetupLocation}
              onChangeText={(t) => {
                setMeetupLocation(t);
                setSelectedPlace(null);
              }}
              placeholder="e.g. SM Mall of Asia Main Atrium, Pasay"
              placeholderTextColor={BitcoinColors.textMuted}
            />
            <TouchableOpacity
              style={styles.findBtn}
              onPress={handleSearchPlace}
              disabled={searchingAddress}
              activeOpacity={0.8}>
              {searchingAddress ? (
                <ActivityIndicator size="small" color={BitcoinColors.orange} />
              ) : (
                <Ionicons name="search" size={18} color={BitcoinColors.orange} />
              )}
            </TouchableOpacity>
          </View>

          {addressMatches && addressMatches.length > 0 && (
            <View style={styles.matchesBox}>
              {addressMatches.slice(0, 4).map((m, idx) => (
                <TouchableOpacity
                  key={`${m.lat}-${m.lng}-${idx}`}
                  style={styles.matchItem}
                  onPress={() => {
                    setMeetupLocation(m.label);
                    setSelectedPlace(m);
                    setAddressMatches(null);
                  }}>
                  <Ionicons name="location-outline" size={15} color={BitcoinColors.orange} />
                  <Text style={styles.matchText} numberOfLines={2}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {PUBLIC_MEETUP_SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.suggestionChip}
                onPress={() =>
                  setMeetupLocation((prev) => (prev.trim() ? `${prev.trim()} (${s})` : s))
                }
                activeOpacity={0.8}>
                <Ionicons name="location" size={12} color={BitcoinColors.cyan} />
                <Text style={styles.suggestionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>CITY / AREA (OPTIONAL)</Text>
          <TextInput
            style={styles.textInput}
            value={meetupCity}
            onChangeText={setMeetupCity}
            placeholder="e.g. Makati, BGC, Dubai Marina"
            placeholderTextColor={BitcoinColors.textMuted}
          />

          <Text style={styles.label}>MEETUP TERMS / NOTES (OPTIONAL)</Text>
          <TextInput
            style={[styles.textInput, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. Crisp $100 bills. Daytime meetup at coffee shop inside mall."
            placeholderTextColor={BitcoinColors.textMuted}
            multiline
          />

          <View style={styles.safetyCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.safetyTitle}>Public Location Safety</Text>
              <Text style={styles.safetySub}>
                Meet only in busy public places (malls, banks, cafes) and verify bills before completing.
              </Text>
            </View>
            <Switch
              value={publicSafeAgreed}
              onValueChange={setPublicSafeAgreed}
              trackColor={{ false: BitcoinColors.border, true: 'rgba(16, 185, 129, 0.45)' }}
              thumbColor={publicSafeAgreed ? BitcoinColors.green : '#CBD5E1'}
            />
          </View>

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}>
            <LinearGradient
              colors={Brand.gradientButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitGradient}>
              {submitting ? (
                <ActivityIndicator color="#07090E" />
              ) : (
                <>
                  <Ionicons name="megaphone-outline" size={18} color="#07090E" />
                  <Text style={styles.submitText}>Publish P2P Offer</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingBottom: 48,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 0.9,
    marginTop: 16,
    marginBottom: 8,
  },
  sideRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sideBtn: {
    flex: 1,
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  sideBtnSellActive: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
  },
  sideBtnBuyActive: {
    borderColor: BitcoinColors.green,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  sideTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sideTitleSell: {
    color: BitcoinColors.orange,
  },
  sideTitleBuy: {
    color: BitcoinColors.green,
  },
  sideSub: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 3,
  },
  chipRow: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  chipSelected: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.16)',
  },
  chipFlag: {
    fontSize: 14,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  chipTextSelected: {
    color: BitcoinColors.orange,
  },
  rateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  useLiveText: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.cyan,
    marginTop: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    height: 48,
  },
  prefix: {
    fontSize: 15,
    fontWeight: '800',
    color: BitcoinColors.orange,
    marginRight: 6,
  },
  suffix: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textMuted,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  limitRow: {
    flexDirection: 'row',
    gap: 10,
  },
  locationRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  textInput: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#FFFFFF',
  },
  findBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchesBox: {
    marginTop: 8,
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    overflow: 'hidden',
  },
  matchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: BitcoinColors.border,
  },
  matchText: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
    marginTop: 8,
  },
  suggestionText: {
    fontSize: 11,
    fontWeight: '700',
    color: BitcoinColors.cyan,
  },
  notesInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  safetyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  safetyTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: BitcoinColors.green,
  },
  safetySub: {
    fontSize: 11,
    lineHeight: 16,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  submitBtn: {
    marginTop: 22,
    borderRadius: 14,
    overflow: 'hidden',
  },
  submitGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  submitText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#07090E',
  },
});
