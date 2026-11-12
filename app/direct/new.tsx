import React, { useMemo, useState } from 'react';
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

import { PartnerMap } from '@/components/partner-map';
import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors, Brand } from '@/constants/theme';
import {
  createDirectOrder,
  DIRECT_REGIONS,
  directErrorMessage,
  findNearbyPartners,
  formatDirectAmount,
  formatKm,
  PAY_METHOD_LABEL,
  type DirectRegion,
  type NearbyPartner,
  type PayMethod,
} from '@/services/direct';
import { searchAddress, type AddressMatch } from '@/services/geocoding';

export default function NewDirectOrderScreen() {
  const [step, setStep] = useState<'details' | 'partner'>('details');

  const [region, setRegion] = useState<DirectRegion>(DIRECT_REGIONS[0]);
  const [amount, setAmount] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [address, setAddress] = useState('');
  const [matches, setMatches] = useState<AddressMatch[] | null>(null);
  const [place, setPlace] = useState<AddressMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [partners, setPartners] = useState<NearbyPartner[]>([]);
  const [finding, setFinding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const numAmount = parseFloat(amount) || 0;
  const money = (value: number) => formatDirectAmount(value, region.currency);

  function selectRegion(next: DirectRegion) {
    if (next.currency === region.currency) return;
    setRegion(next);
    // Amounts, addresses and partners belong to one country, so start those again.
    setAmount('');
    setPlace(null);
    setMatches(null);
    setSearchError(null);
    setPartners([]);
    setSelectedId(null);
    setMethod(null);
  }
  const selected = partners.find((p) => p.partner_id === selectedId) ?? null;

  const receiverPoint = useMemo(
    () => (place ? { lat: place.lat, lng: place.lng, label: receiverName.trim() || 'Receiver' } : null),
    [place, receiverName],
  );
  const mapPartners = useMemo(
    () => partners.map((p) => ({ id: p.partner_id, name: p.name, lat: p.lat, lng: p.lng })),
    [partners],
  );

  function selectPartner(id: string) {
    const partner = partners.find((p) => p.partner_id === id);
    if (!partner) return;
    setSelectedId(id);
    // Keep the chosen app if this partner takes it; otherwise use their first one.
    setMethod((current) => (current && partner.methods.includes(current) ? current : partner.methods[0] ?? null));
  }

  function onAddressChange(text: string) {
    setAddress(text);
    setPlace(null);
    setMatches(null);
    setSearchError(null);
  }

  async function handleFindAddress() {
    if (address.trim().length < 5) {
      setSearchError('Enter the street, area and city.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setPlace(null);
    try {
      const results = await searchAddress(address, region.country);
      setMatches(results);
      if (results.length === 0) setSearchError(`No match found in ${region.label}. Try adding the area or city.`);
    } catch (e: any) {
      setMatches(null);
      setSearchError(e?.message ?? 'Address search failed. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  }

  function validateDetails(): string | null {
    if (numAmount < region.min || numAmount > region.max) {
      return `Enter an amount between ${money(region.min)} and ${money(region.max)}.`;
    }
    if (receiverName.trim().length < 2) return "Enter your friend's full name.";
    if (receiverPhone.replace(/[^\d]/g, '').length < 7) return "Enter your friend's mobile number.";
    if (!place) return 'Tap "Find address" and choose the matching location.';
    return null;
  }

  async function handleFindPartners() {
    const problem = validateDetails();
    if (problem || !place) {
      Alert.alert('Check the details', problem ?? '');
      return;
    }
    setFinding(true);
    try {
      const found = await findNearbyPartners(place.lat, place.lng, region.currency);
      setPartners(found);
      // The list is nearest first, so the first partner is the closest one.
      setSelectedId(found[0]?.partner_id ?? null);
      setMethod(found[0]?.methods[0] ?? null);
      setStep('partner');
    } catch (e) {
      Alert.alert('Could not search for partners', directErrorMessage(e));
    } finally {
      setFinding(false);
    }
  }

  async function handleSendRequest() {
    if (!place || !selected || !method || submitting) return;
    setSubmitting(true);
    try {
      const order = await createDirectOrder({
        partnerId: selected.partner_id,
        amount: numAmount,
        method,
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        receiverAddress: address.trim(),
        lat: place.lat,
        lng: place.lng,
      });
      router.replace({ pathname: '/direct/[id]', params: { id: order.id } });
    } catch (e) {
      Alert.alert('Could not send request', directErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title={step === 'details' ? 'Send Cash to a Friend' : 'Choose a Partner'} />

      {step === 'details' ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.label}>DELIVER IN</Text>
            <View style={styles.methods}>
              {DIRECT_REGIONS.map((option) => {
                const isSelected = option.currency === region.currency;
                return (
                  <TouchableOpacity
                    key={option.currency}
                    style={[styles.method, isSelected && styles.methodSelected]}
                    onPress={() => selectRegion(option)}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}>
                    <Text style={[styles.methodText, isSelected && styles.methodTextSelected]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.regionApps}>You will pay the partner by {region.apps}.</Text>

            <Text style={[styles.label, styles.labelSpaced]}>CASH YOUR FRIEND GETS ({region.currency})</Text>
            <View style={styles.amountBox}>
              <Text style={[styles.currencySymbol, region.symbol.length > 1 && styles.currencyCode]}>{region.symbol}</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                placeholderTextColor={BitcoinColors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel={`Cash amount in ${region.currency}`}
              />
            </View>
            <View style={styles.chipsRow}>
              {region.quickAmounts.map((value) => (
                <TouchableOpacity key={value} style={styles.chip} onPress={() => setAmount(String(value))} activeOpacity={0.75}>
                  <Text style={styles.chipText}>
                    {region.symbol}
                    {value.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>FRIEND&apos;S FULL NAME</Text>
            <TextInput
              style={styles.input}
              value={receiverName}
              onChangeText={setReceiverName}
              placeholder="As shown on their ID"
              placeholderTextColor={BitcoinColors.textMuted}
              autoCapitalize="words"
              maxLength={80}
            />

            <Text style={[styles.label, styles.labelSpaced]}>FRIEND&apos;S MOBILE NUMBER</Text>
            <TextInput
              style={styles.input}
              value={receiverPhone}
              onChangeText={setReceiverPhone}
              placeholder={region.phonePlaceholder}
              placeholderTextColor={BitcoinColors.textMuted}
              keyboardType="phone-pad"
              maxLength={30}
            />

            <Text style={[styles.label, styles.labelSpaced]}>FRIEND&apos;S ADDRESS</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={address}
              onChangeText={onAddressChange}
              placeholder={region.addressPlaceholder}
              placeholderTextColor={BitcoinColors.textMuted}
              multiline
              maxLength={300}
            />
            <TouchableOpacity style={styles.findBtn} onPress={handleFindAddress} disabled={searching} activeOpacity={0.8} accessibilityRole="button">
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
                <View style={styles.flex}>
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

            <PrimaryButton label={finding ? 'Searching…' : 'Find nearest partner'} busy={finding} onPress={handleFindPartners} />
          </View>
        </ScrollView>
      ) : (
        <View style={styles.flex}>
          <View style={styles.mapWrap}>
            <PartnerMap receiver={receiverPoint} partners={mapPartners} selectedId={selectedId} onSelect={selectPartner} />
          </View>

          <ScrollView style={styles.flex} contentContainerStyle={styles.partnerScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: BitcoinColors.green }]} />
              <Text style={styles.legendText}>{receiverName.trim()}</Text>
              <View style={[styles.legendDot, { backgroundColor: BitcoinColors.orange }]} />
              <Text style={styles.legendText}>Chosen partner (area is approximate)</Text>
            </View>

            {partners.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>No partner near this address yet</Text>
                <Text style={styles.emptyText}>
                  Nobody within 30 km accepts {region.apps} right now. Try again later or use a different address.
                </Text>
              </View>
            ) : (
              <>
                {partners.map((partner, i) => {
                  const isSelected = partner.partner_id === selectedId;
                  return (
                    <TouchableOpacity
                      key={partner.partner_id}
                      style={[styles.partnerRow, isSelected && styles.partnerRowSelected]}
                      onPress={() => selectPartner(partner.partner_id)}
                      activeOpacity={0.8}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}>
                      <View style={[styles.partnerPin, isSelected && styles.partnerPinSelected]}>
                        <Text style={[styles.partnerPinText, isSelected && styles.partnerPinTextSelected]}>{i + 1}</Text>
                      </View>
                      <View style={styles.flex}>
                        <View style={styles.partnerNameRow}>
                          <Text style={styles.partnerName}>{partner.name}</Text>
                          {i === 0 && (
                            <View style={styles.nearestPill}>
                              <Text style={styles.nearestText}>NEAREST</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.partnerMeta}>
                          {formatKm(partner.distance_km)} from {receiverName.trim()}
                          {partner.completed_orders > 0 ? ` · ${partner.completed_orders} completed` : ' · new partner'}
                        </Text>
                        <Text style={styles.partnerMethods}>
                          Accepts {partner.methods.map((m) => PAY_METHOD_LABEL[m]).join(', ')}
                        </Text>
                      </View>
                      <Ionicons
                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                        size={20}
                        color={isSelected ? BitcoinColors.orange : BitcoinColors.textMuted}
                      />
                    </TouchableOpacity>
                  );
                })}

                {selected && (
                  <View style={styles.card}>
                    <Text style={styles.label}>YOU WILL PAY {selected.name.toUpperCase()} WITH</Text>
                    <View style={styles.methods}>
                      {selected.methods.map((m) => {
                        const isSelected = m === method;
                        return (
                          <TouchableOpacity
                            key={m}
                            style={[styles.method, isSelected && styles.methodSelected]}
                            onPress={() => setMethod(m)}
                            activeOpacity={0.8}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: isSelected }}>
                            <Text style={[styles.methodText, isSelected && styles.methodTextSelected]}>{PAY_METHOD_LABEL[m]}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={styles.noteText}>
                      You pay {money(numAmount)} to {selected.name} only after your friend has the cash and has
                      given them the OTP code. You can chat with {selected.name} as soon as the request is sent.
                    </Text>
                    <PrimaryButton
                      label={submitting ? 'Sending…' : `Ask ${selected.name} to deliver ${money(numAmount)}`}
                      busy={submitting}
                      onPress={handleSendRequest}
                    />
                  </View>
                )}
              </>
            )}

            <TouchableOpacity onPress={() => setStep('details')} style={styles.backLink} accessibilityRole="button">
              <Text style={styles.backLinkText}>Change amount or address</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function PrimaryButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} disabled={busy} activeOpacity={0.85} accessibilityRole="button">
      <LinearGradient colors={Brand.gradientButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtnGradient}>
        {busy && <ActivityIndicator size="small" color="#07090E" />}
        <Text style={styles.primaryBtnText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  flex: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 12,
  },
  label: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textSecondary, letterSpacing: 1, marginBottom: 8 },
  labelSpaced: { marginTop: 18 },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
  },
  currencySymbol: { fontSize: 24, fontWeight: '800', color: BitcoinColors.orange, marginRight: 6 },
  currencyCode: { fontSize: 15, marginRight: 8 },
  regionApps: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 8 },
  amountInput: { flex: 1, fontSize: 26, fontWeight: '800', color: '#FFFFFF', paddingVertical: 12 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  chipText: { fontSize: 12, fontWeight: '700', color: BitcoinColors.orangeLight },
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
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
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
  findBtnText: { fontSize: 13, fontWeight: '800', color: BitcoinColors.orange },
  errorText: { fontSize: 12, lineHeight: 17, color: BitcoinColors.red, marginTop: 8 },
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
  placeTitle: { fontSize: 12, fontWeight: '800', color: BitcoinColors.green },
  placeLabel: { fontSize: 12, lineHeight: 17, color: '#E2E8F0', marginTop: 2 },
  changeLink: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange },
  matchList: { marginTop: 12 },
  matchHint: { fontSize: 12, color: BitcoinColors.textSecondary, marginBottom: 6 },
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
  matchText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#E2E8F0' },
  primaryBtn: { marginTop: 18, borderRadius: 14, overflow: 'hidden' },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 8,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E', textAlign: 'center' },
  mapWrap: { height: 260, borderBottomWidth: 1, borderBottomColor: BitcoinColors.border },
  partnerScroll: { padding: 16, paddingBottom: 40 },
  legendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 11, color: BitcoinColors.textSecondary, marginRight: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  emptyText: { fontSize: 13, lineHeight: 19, color: BitcoinColors.textSecondary, marginTop: 6 },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  partnerRowSelected: { borderColor: 'rgba(247, 147, 26, 0.6)', backgroundColor: 'rgba(247, 147, 26, 0.06)' },
  partnerPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#475569',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  partnerPinSelected: { backgroundColor: BitcoinColors.orange },
  partnerPinText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  partnerPinTextSelected: { color: '#07090E' },
  partnerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partnerName: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  nearestPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  nearestText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: BitcoinColors.green },
  partnerMeta: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 2 },
  partnerMethods: { fontSize: 12, color: BitcoinColors.textMuted, marginTop: 2 },
  methods: { flexDirection: 'row', gap: 8 },
  method: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  methodSelected: { backgroundColor: 'rgba(247, 147, 26, 0.16)', borderColor: 'rgba(247, 147, 26, 0.5)' },
  methodText: { fontSize: 13, fontWeight: '700', color: BitcoinColors.textSecondary },
  methodTextSelected: { color: BitcoinColors.orange },
  noteText: { fontSize: 12, lineHeight: 18, color: BitcoinColors.textSecondary, marginTop: 12 },
  backLink: { alignSelf: 'center', padding: 10 },
  backLinkText: { fontSize: 13, fontWeight: '700', color: BitcoinColors.orange },
});
