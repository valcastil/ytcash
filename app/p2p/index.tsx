import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { P2POrderRow } from '@/components/p2p-order-row';
import { PartnerMap } from '@/components/partner-map';
import { ScreenHeader } from '@/components/screen-header';
import { formatCurrency } from '@/constants/currencies';
import type { MapPartner } from '@/constants/partner-map-html';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { usePresence } from '@/contexts/presence';
import {
  CASHIER_PAY_METHODS,
  cashierMethodLabel,
  cashRequestStatusLabel,
  createCashDeliveryRequest,
  getMyCashierProfile,
  listCashiersWithPaymentsNear,
  listMyCashRequests,
  saveMyCashierProfile,
  type CashDeliveryRequest,
  type CashierPayMethod,
  type CashierPaymentAccount,
  type MobileCashierProfile,
} from '@/services/mobile-cashier';
import { fetchExchangeRates } from '@/services/currency-api';
import { searchAddress, type AddressMatch } from '@/services/geocoding';
import { requestPreciseLocation } from '@/services/location';
import {
  distanceKm,
  formatDistance,
  getPartnerProfile,
  isOrderActive,
  listMobileCashiersNear,
  listP2POrders,
  p2pErrorMessage,
  savePartnerProfile,
  setPartnerAvailability,
  subscribeToP2POrders,
  type NearbyMobileCashier,
  type P2POrder,
  type P2PPartnerProfile,
} from '@/services/p2p';
import {
  createTradeFromOffer,
  formatExchangeMoney,
  getExchangeCurrency,
  listExchangeOffers,
  listMyOffers,
  listMyTrades,
  LOCAL_CURRENCY_CODES,
  OFFER_CURRENCY_CODES,
  tradeStatusLabel,
  updateOfferStatus,
  type ExchangeSide,
  type P2PExchangeOffer,
  type P2PExchangeTrade,
} from '@/services/p2p-exchange';

type Tab = 'send' | 'deliver';
type ExchangeSubTab = 'market' | 'my_offers' | 'my_trades';

export default function P2PHubScreen() {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;

  const [tab, setTab] = useState<Tab>('send');

  // ─── Binance-style P2P Exchange state ────────────────────
  const [subTab, setSubTab] = useState<ExchangeSubTab>('market');
  // 'buy' tab = user wants to buy offerCurrency (so matches maker side='sell')
  // 'sell' tab = user wants to sell offerCurrency (so matches maker side='buy')
  const [takerMode, setTakerMode] = useState<'buy' | 'sell'>('buy');
  const [offerCurrency, setOfferCurrency] = useState<string>('USD');
  const [localCurrency, setLocalCurrency] = useState<string>('PHP');
  const [marketRate, setMarketRate] = useState<number | null>(null);

  const [offers, setOffers] = useState<P2PExchangeOffer[]>([]);
  const [myOffers, setMyOffers] = useState<P2PExchangeOffer[]>([]);
  const [myTrades, setMyTrades] = useState<P2PExchangeTrade[]>([]);
  const [exchangeLoading, setExchangeLoading] = useState(true);

  // Take-offer modal state
  const [selectedOffer, setSelectedOffer] = useState<P2PExchangeOffer | null>(null);
  const [tradeAmountText, setTradeAmountText] = useState('');
  const [tradeSpotText, setTradeSpotText] = useState('');
  const [tradeTimeText, setTradeTimeText] = useState('Today, 3:00 PM');
  const [creatingTrade, setCreatingTrade] = useState(false);

  // ─── Cash Delivery Partner & Live Area Map state ──────────
  const { onlineUsers } = usePresence();
  const [sent, setSent] = useState<P2POrder[]>([]);
  const [assigned, setAssigned] = useState<P2POrder[]>([]);
  const [partner, setPartner] = useState<P2PPartnerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingPartner, setSavingPartner] = useState(false);

  const [areaQuery, setAreaQuery] = useState('');
  const [areaMatches, setAreaMatches] = useState<AddressMatch[] | null>(null);
  const [searchingArea, setSearchingArea] = useState(false);
  const [selectedArea, setSelectedArea] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [nearbyCashiers, setNearbyCashiers] = useState<NearbyMobileCashier[]>([]);
  const [areaCashiers, setAreaCashiers] = useState<(MobileCashierProfile & { km: number })[]>([]);
  const [loadingAreaDots, setLoadingAreaDots] = useState(false);
  const [selectedMapDotId, setSelectedMapDotId] = useState<string | null>(null);

  // ─── Mobile Cashier Payment Options & Cash Requests ──────
  const [selectedMethods, setSelectedMethods] = useState<CashierPayMethod[]>(['gcash']);
  const [accountsMap, setAccountsMap] = useState<
    Record<CashierPayMethod, { account_name: string; account_number: string; bank_name: string }>
  >({
    gcash: { account_name: '', account_number: '', bank_name: '' },
    maya: { account_name: '', account_number: '', bank_name: '' },
    gotyme: { account_name: '', account_number: '', bank_name: '' },
    bank_transfer: { account_name: '', account_number: '', bank_name: '' },
  });
  const [savingCashier, setSavingCashier] = useState(false);
  const [cashRequests, setCashRequests] = useState<CashDeliveryRequest[]>([]);

  // Request cash modal
  const [requestCashier, setRequestCashier] = useState<MobileCashierProfile | null>(null);
  const [requestAmountText, setRequestAmountText] = useState('1000');
  const [requestMethod, setRequestMethod] = useState<CashierPayMethod>('gcash');
  const [requestNotes, setRequestNotes] = useState('');
  const [submittingCashReq, setSubmittingCashReq] = useState(false);

  const selectDeliveryArea = useCallback(async (label: string, lat: number, lng: number) => {
    setSelectedArea({ label, lat, lng });
    setAreaMatches(null);
    setSelectedMapDotId(null);
    setLoadingAreaDots(true);
    try {
      const [cashiers, richCashiers] = await Promise.all([
        listMobileCashiersNear(lat, lng, 30),
        listCashiersWithPaymentsNear(lat, lng, 30),
      ]);
      setAreaCashiers(richCashiers);
      const richIds = new Set(richCashiers.map((c) => c.user_id));
      const merged: NearbyMobileCashier[] = [
        ...richCashiers.map((c) => ({
          id: c.user_id,
          name: c.display_name,
          lat: c.lat,
          lng: c.lng,
          km: c.km,
        })),
        ...cashiers.filter((c) => !richIds.has(c.id)),
      ].sort((a, b) => a.km - b.km);
      setNearbyCashiers(merged);
    } catch {
      setNearbyCashiers([]);
      setAreaCashiers([]);
    } finally {
      setLoadingAreaDots(false);
    }
  }, []);

  async function handleSearchDeliveryArea() {
    const q = areaQuery.trim();
    if (q.length < 3) {
      Alert.alert('Enter a location', 'Type a city, neighborhood, or street address to search.');
      return;
    }
    setSearchingArea(true);
    try {
      const results = await searchAddress(q);
      if (results.length === 1) {
        await selectDeliveryArea(results[0].label, results[0].lat, results[0].lng);
      } else {
        setAreaMatches(results);
      }
    } catch {
      Alert.alert('Search failed', 'Could not look up that address right now.');
    } finally {
      setSearchingArea(false);
    }
  }

  async function handleUseGpsForDelivery() {
    setSearchingArea(true);
    try {
      const result = await requestPreciseLocation();
      if (result.status !== 'granted') {
        explainLocationProblem(result.status);
        return;
      }
      let label = 'Your Current Location';
      try {
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: result.coords.lat,
          longitude: result.coords.lng,
        });
        if (geo) {
          const parts = [geo.name || geo.street, geo.district || geo.city, geo.region].filter(Boolean);
          if (parts.length > 0) label = parts.join(', ');
        }
      } catch {
        // Fallback to generic label if reverse geocoding is unavailable.
      }
      setAreaQuery(label);
      await selectDeliveryArea(label, result.coords.lat, result.coords.lng);
    } finally {
      setSearchingArea(false);
    }
  }

  const loadExchange = useCallback(async () => {
    setExchangeLoading(true);
    try {
      const makerSide: ExchangeSide = takerMode === 'buy' ? 'sell' : 'buy';
      const [marketList, mine, trades] = await Promise.all([
        listExchangeOffers({
          side: makerSide,
          offerCurrency: offerCurrency === 'ALL' ? undefined : offerCurrency,
          localCurrency,
        }),
        userId ? listMyOffers(userId) : Promise.resolve([]),
        userId ? listMyTrades(userId) : Promise.resolve([]),
      ]);
      setOffers(marketList);
      setMyOffers(mine);
      setMyTrades(trades);
    } catch {
      // Errors handled gracefully; fallback keeps marketplace usable.
    } finally {
      setExchangeLoading(false);
    }
  }, [takerMode, offerCurrency, localCurrency, userId]);

  useEffect(() => {
    let active = true;
    async function loadRate() {
      if (offerCurrency === 'ALL') {
        setMarketRate(null);
        return;
      }
      try {
        const res = await fetchExchangeRates(offerCurrency);
        if (active) setMarketRate(res.rates[localCurrency] ?? null);
      } catch {
        if (active) setMarketRate(null);
      }
    }
    loadRate();
    return () => {
      active = false;
    };
  }, [offerCurrency, localCurrency]);

  const loadDelivery = useCallback(async () => {
    if (!userId) return;
    try {
      const [orders, p, cashierProf, reqs] = await Promise.all([
        listP2POrders(userId),
        getPartnerProfile(userId),
        getMyCashierProfile(userId),
        listMyCashRequests(userId),
      ]);
      setSent(orders.sent);
      setAssigned(orders.assigned);
      setPartner(p);
      setCashRequests(reqs);
      if (cashierProf) {
        if (cashierProf.accepted_methods?.length) {
          setSelectedMethods(cashierProf.accepted_methods);
        }
        if (cashierProf.payment_accounts?.length) {
          setAccountsMap((prev) => {
            const next = { ...prev };
            for (const acct of cashierProf.payment_accounts) {
              next[acct.method] = {
                account_name: acct.account_name ?? '',
                account_number: acct.account_number ?? '',
                bank_name: acct.bank_name ?? '',
              };
            }
            return next;
          });
        }
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(p2pErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadExchange();
      loadDelivery();
    }, [loadExchange, loadDelivery]),
  );

  useEffect(() => {
    if (!userId) return;
    return subscribeToP2POrders(`hub-${userId}`, loadDelivery);
  }, [userId, loadDelivery]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadExchange(), loadDelivery()]);
    setRefreshing(false);
  }

  function openTakeOffer(offer: P2PExchangeOffer) {
    if (userId && offer.maker_id === userId) {
      Alert.alert('Your own offer', 'You can pause or close your offer from the My Offers tab.');
      return;
    }
    setSelectedOffer(offer);
    setTradeAmountText(String(offer.min_limit));
    setTradeSpotText(offer.meetup_location);
    setTradeTimeText('Today, 3:00 PM');
  }

  async function handleConfirmTakeOffer() {
    if (!selectedOffer) return;
    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in to start a P2P cash exchange.');
      return;
    }
    const amt = Number(tradeAmountText);
    if (!amt || amt < selectedOffer.min_limit || amt > selectedOffer.max_limit) {
      Alert.alert(
        'Amount out of range',
        `Enter an amount between ${formatExchangeMoney(selectedOffer.min_limit, selectedOffer.offer_currency)} and ${formatExchangeMoney(selectedOffer.max_limit, selectedOffer.offer_currency)}.`,
      );
      return;
    }
    if (tradeSpotText.trim().length < 4) {
      Alert.alert('Public location required', 'Specify a public meeting spot.');
      return;
    }

    setCreatingTrade(true);
    try {
      const trade = await createTradeFromOffer({
        offer: selectedOffer,
        takerId: userId,
        takerName: profile?.full_name || user?.email?.split('@')[0] || 'YTCash User',
        offerAmount: amt,
        meetupLocation: tradeSpotText.trim(),
        meetupTime: tradeTimeText.trim() || 'Today',
      });
      setSelectedOffer(null);
      await loadExchange();
      router.push({ pathname: '/p2p/exchange/[id]', params: { id: trade.id } });
    } catch (e: any) {
      Alert.alert('Could not start exchange', e?.message ?? 'Try again.');
    } finally {
      setCreatingTrade(false);
    }
  }

  async function handleToggleOffer(offer: P2PExchangeOffer) {
    const next = offer.status === 'active' ? 'paused' : 'active';
    await updateOfferStatus(offer.id, next);
    await loadExchange();
  }

  async function handleCloseOffer(offer: P2PExchangeOffer) {
    Alert.alert('Close Offer?', 'Remove this offer from the P2P marketplace?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Close Offer',
        style: 'destructive',
        onPress: async () => {
          await updateOfferStatus(offer.id, 'closed');
          await loadExchange();
        },
      },
    ]);
  }

  function explainLocationProblem(status: 'denied' | 'blocked' | 'unavailable') {
    if (status === 'blocked') {
      Alert.alert(
        'Location is turned off',
        'Allow location access for YTCash in your device settings to deliver cash near you.',
        [
          { text: 'Not now', style: 'cancel' },
          ...(Platform.OS === 'web'
            ? []
            : [{ text: 'Open Settings', onPress: () => Linking.openSettings() }]),
        ],
      );
    } else if (status === 'unavailable') {
      Alert.alert(
        'Location unavailable',
        'We could not get your location right now. Check that location services are on and try again.',
      );
    }
  }

  function toggleCashierMethod(method: CashierPayMethod) {
    setSelectedMethods((prev) => {
      if (prev.includes(method)) {
        if (prev.length === 1) {
          Alert.alert('At least one method', 'Select at least one payment method to accept.');
          return prev;
        }
        return prev.filter((m) => m !== method);
      }
      return [...prev, method];
    });
  }

  function buildPaymentAccounts(): CashierPaymentAccount[] {
    const fallbackName = profile?.full_name || user?.email?.split('@')[0] || 'Mobile Cashier';
    return selectedMethods.map((m) => ({
      method: m,
      account_name: accountsMap[m].account_name.trim() || fallbackName,
      account_number: accountsMap[m].account_number.trim(),
      bank_name: m === 'bank_transfer' ? accountsMap[m].bank_name.trim() : undefined,
    }));
  }

  async function saveCashierSettings(lat: number, lng: number, isAvailable: boolean) {
    if (!userId) return;
    await saveMyCashierProfile({
      userId,
      displayName: profile?.full_name || user?.email?.split('@')[0] || 'Mobile Cashier',
      lat,
      lng,
      isAvailable,
      acceptedMethods: selectedMethods,
      paymentAccounts: buildPaymentAccounts(),
    });
  }

  async function handleSaveCashierPayments() {
    if (!userId || savingCashier) return;
    const missing = selectedMethods.find((m) => !accountsMap[m].account_number.trim());
    if (missing) {
      Alert.alert(
        'Account number required',
        `Enter your ${cashierMethodLabel(missing)} account or mobile number.`,
      );
      return;
    }
    setSavingCashier(true);
    try {
      let lat = partner?.lat ?? selectedArea?.lat ?? 14.5995;
      let lng = partner?.lng ?? selectedArea?.lng ?? 120.9842;
      if (!partner) {
        const gps = await requestPreciseLocation();
        if (gps.status === 'granted') {
          lat = gps.coords.lat;
          lng = gps.coords.lng;
        }
      }
      await saveCashierSettings(lat, lng, available);
      if (selectedArea) {
        await selectDeliveryArea(selectedArea.label, selectedArea.lat, selectedArea.lng);
      }
      Alert.alert('Saved', 'Your Mobile Cashier payment methods are updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Try again.');
    } finally {
      setSavingCashier(false);
    }
  }

  function openRequestCashModal(cashier: NearbyMobileCashier) {
    const rich = areaCashiers.find((c) => c.user_id === cashier.id);
    const fallbackProfile: MobileCashierProfile = rich ?? {
      user_id: cashier.id,
      display_name: cashier.name,
      lat: cashier.lat,
      lng: cashier.lng,
      is_available: true,
      accepted_methods: ['gcash', 'maya', 'gotyme', 'bank_transfer'],
      payment_accounts: [],
      updated_at: new Date().toISOString(),
    };
    setRequestCashier(fallbackProfile);
    setRequestMethod(fallbackProfile.accepted_methods[0] ?? 'gcash');
    setRequestAmountText('1000');
    setRequestNotes('');
  }

  async function handleSubmitCashRequest() {
    if (!requestCashier || !selectedArea) return;
    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in to request cash delivery.');
      return;
    }
    if (requestCashier.user_id === userId) {
      Alert.alert('Your own profile', 'You cannot request cash from your own Mobile Cashier profile.');
      return;
    }
    const amt = Number(requestAmountText);
    if (!amt || amt < 100) {
      Alert.alert('Invalid amount', 'Enter a cash amount of at least ₱100.');
      return;
    }
    setSubmittingCashReq(true);
    try {
      const created = await createCashDeliveryRequest({
        requesterId: userId,
        requesterName: profile?.full_name || user?.email?.split('@')[0] || 'YTCash User',
        cashier: requestCashier,
        amount: amt,
        currency: 'PHP',
        paymentMethod: requestMethod,
        locationLabel: selectedArea.label,
        lat: selectedArea.lat,
        lng: selectedArea.lng,
        notes: requestNotes,
      });
      setRequestCashier(null);
      await loadDelivery();
      router.push({ pathname: '/p2p/cash-request/[id]', params: { id: created.id } });
    } catch (e: any) {
      Alert.alert('Could not create request', e?.message ?? 'Try again.');
    } finally {
      setSubmittingCashReq(false);
    }
  }

  async function updateArea(isAvailable: boolean) {
    if (!userId) return;
    const result = await requestPreciseLocation();
    if (result.status !== 'granted') {
      explainLocationProblem(result.status);
      return;
    }
    const saved = await savePartnerProfile(userId, result.coords, isAvailable);
    setPartner(saved);
    await saveCashierSettings(result.coords.lat, result.coords.lng, isAvailable);
  }

  async function handleTogglePartner(next: boolean) {
    if (!userId || savingPartner) return;
    setSavingPartner(true);
    try {
      if (next) {
        await updateArea(true);
      } else {
        await setPartnerAvailability(userId, false);
        setPartner((p) => (p ? { ...p, is_available: false } : p));
      }
    } catch (e) {
      Alert.alert('Could not update', p2pErrorMessage(e));
    } finally {
      setSavingPartner(false);
    }
  }

  async function handleUpdateArea() {
    if (savingPartner) return;
    setSavingPartner(true);
    try {
      await updateArea(true);
    } catch (e) {
      Alert.alert('Could not update', p2pErrorMessage(e));
    } finally {
      setSavingPartner(false);
    }
  }

  const available = partner?.is_available ?? false;
  const activeAssigned = assigned.filter(isOrderActive).length;
  const activeTradesCount = myTrades.filter(
    (t) => t.status === 'proposed' || t.status === 'agreed',
  ).length;
  const deliveryList = tab === 'send' ? sent : assigned;

  const calculatedLocal =
    selectedOffer && Number(tradeAmountText) > 0
      ? Number(tradeAmountText) * selectedOffer.rate
      : 0;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Peer to Peer (P2P)" />

      {/* Primary Tabs: Exchange cash vs Deliver cash */}
      <View style={styles.tabs}>
        {(['send', 'deliver'] as const).map((key) => {
          const selected = tab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => setTab(key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected }}>
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {key === 'send' ? 'Exchange cash' : 'Deliver cash'}
              </Text>
              {key === 'deliver' && activeAssigned > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{activeAssigned}</Text>
                </View>
              )}
              {key === 'send' && activeTradesCount > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{activeTradesCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BitcoinColors.orange}
            colors={[BitcoinColors.orange]}
          />
        }>
        {tab === 'send' ? (
          <>
            {/* Binance P2P style Top Action Header */}
            <View style={styles.p2pHeaderCard}>
              <View style={styles.buySellRow}>
                <View style={styles.buySellToggle}>
                  <TouchableOpacity
                    style={[styles.bsBtn, takerMode === 'buy' && styles.bsBtnBuy]}
                    onPress={() => {
                      setTakerMode('buy');
                      setSubTab('market');
                    }}
                    activeOpacity={0.85}>
                    <Text style={[styles.bsText, takerMode === 'buy' && styles.bsTextActive]}>
                      Buy
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.bsBtn, takerMode === 'sell' && styles.bsBtnSell]}
                    onPress={() => {
                      setTakerMode('sell');
                      setSubTab('market');
                    }}
                    activeOpacity={0.85}>
                    <Text style={[styles.bsText, takerMode === 'sell' && styles.bsTextActive]}>
                      Sell
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.postOfferBtn}
                  onPress={() => router.push('/p2p/post-offer')}
                  activeOpacity={0.85}>
                  <Ionicons name="add-circle" size={16} color="#07090E" />
                  <Text style={styles.postOfferText}>Post Offer</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.p2pSubtitle}>
                {takerMode === 'buy'
                  ? 'Buy foreign currency with local cash at an agreed public meetup.'
                  : 'Exchange your foreign currency for local cash at an agreed public meetup.'}
              </Text>

              {/* Currency Filter Row */}
              <Text style={styles.filterLabel}>CURRENCY</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}>
                {['ALL', ...OFFER_CURRENCY_CODES].map((code) => {
                  const selected = offerCurrency === code;
                  const info = code === 'ALL' ? null : getExchangeCurrency(code);
                  return (
                    <TouchableOpacity
                      key={code}
                      style={[styles.filterChip, selected && styles.filterChipSelected]}
                      onPress={() => setOfferCurrency(code)}
                      activeOpacity={0.8}>
                      {info && <Text style={styles.filterFlag}>{info.flag}</Text>}
                      <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                        {code === 'ALL' ? 'All' : code}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.localRow}>
                <Text style={styles.filterLabelInline}>LOCAL CASH:</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}>
                  {LOCAL_CURRENCY_CODES.map((code) => {
                    const selected = localCurrency === code;
                    const info = getExchangeCurrency(code);
                    return (
                      <TouchableOpacity
                        key={code}
                        style={[styles.localChip, selected && styles.localChipSelected]}
                        onPress={() => setLocalCurrency(code)}
                        activeOpacity={0.8}>
                        <Text style={[styles.localChipText, selected && styles.localChipTextSelected]}>
                          {info.flag} {code}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {marketRate && offerCurrency !== 'ALL' && (
                <View style={styles.rateBanner}>
                  <Ionicons name="pulse" size={14} color={BitcoinColors.cyan} />
                  <Text style={styles.rateBannerText}>
                    Live ref: 1 {offerCurrency} ≈ {formatExchangeMoney(marketRate, localCurrency)}
                  </Text>
                </View>
              )}
            </View>

            {/* Sub-tabs: Marketplace | My Offers | My Trades */}
            <View style={styles.subTabRow}>
              {(
                [
                  { id: 'market', label: 'Marketplace' },
                  { id: 'my_offers', label: `My Offers (${myOffers.length})` },
                  { id: 'my_trades', label: `My Trades (${myTrades.length})` },
                ] as const
              ).map((item) => {
                const active = subTab === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.subTab, active && styles.subTabActive]}
                    onPress={() => setSubTab(item.id)}
                    activeOpacity={0.8}>
                    <Text style={[styles.subTabText, active && styles.subTabTextActive]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Content for Exchange Cash */}
            {exchangeLoading ? (
              <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
            ) : subTab === 'market' ? (
              offers.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="swap-horizontal" size={28} color={BitcoinColors.orange} />
                  <Text style={styles.emptyText}>
                    No {takerMode === 'buy' ? 'sell' : 'buy'} offers for{' '}
                    {offerCurrency === 'ALL' ? 'any currency' : offerCurrency} → {localCurrency}{' '}
                    yet.
                  </Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => router.push('/p2p/post-offer')}
                    activeOpacity={0.8}>
                    <Text style={styles.retryText}>+ Post the first offer</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                offers.map((offer) => {
                  const isMine = offer.maker_id === userId;
                  return (
                    <View key={offer.id} style={styles.offerCard}>
                      {/* Maker row */}
                      <View style={styles.offerTopRow}>
                        <View style={styles.makerRow}>
                          <View style={styles.makerAvatar}>
                            <Text style={styles.makerAvatarText}>
                              {offer.maker_name.slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                          <View>
                            <View style={styles.makerNameRow}>
                              <Text style={styles.makerName}>{offer.maker_name}</Text>
                              {offer.maker_verified && (
                                <Ionicons
                                  name="checkmark-circle"
                                  size={14}
                                  color={BitcoinColors.orange}
                                />
                              )}
                            </View>
                            <Text style={styles.makerStats}>
                              {offer.completed_trades} trades • In-Person Cash
                            </Text>
                          </View>
                        </View>

                        <View style={styles.pairBadge}>
                          <Text style={styles.pairBadgeText}>
                            {offer.offer_currency}/{offer.local_currency}
                          </Text>
                        </View>
                      </View>

                      {/* Rate + Action Row */}
                      <View style={styles.offerMidRow}>
                        <View>
                          <Text style={styles.priceLabel}>RATE</Text>
                          <Text style={styles.priceValue}>
                            {formatExchangeMoney(offer.rate, offer.local_currency)}
                            <Text style={styles.priceUnit}> / {offer.offer_currency}</Text>
                          </Text>
                          <Text style={styles.limitText}>
                            Available:{' '}
                            <Text style={styles.limitStrong}>
                              {formatExchangeMoney(offer.available_amount, offer.offer_currency)}
                            </Text>
                          </Text>
                          <Text style={styles.limitText}>
                            Limit:{' '}
                            <Text style={styles.limitStrong}>
                              {formatExchangeMoney(offer.min_limit, offer.offer_currency)} –{' '}
                              {formatExchangeMoney(offer.max_limit, offer.offer_currency)}
                            </Text>
                          </Text>
                        </View>

                        <TouchableOpacity
                          style={[
                            styles.tradeBtn,
                            isMine
                              ? styles.tradeBtnMine
                              : takerMode === 'buy'
                              ? styles.tradeBtnBuy
                              : styles.tradeBtnSell,
                          ]}
                          onPress={() => openTakeOffer(offer)}
                          activeOpacity={0.85}>
                          <Text style={styles.tradeBtnText}>
                            {isMine
                              ? 'Your Ad'
                              : takerMode === 'buy'
                              ? `Buy ${offer.offer_currency}`
                              : `Sell ${offer.offer_currency}`}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Public Meetup Location */}
                      <View style={styles.meetupBox}>
                        <Ionicons name="location" size={14} color={BitcoinColors.cyan} />
                        <Text style={styles.meetupText} numberOfLines={2}>
                          Public Meetup: {offer.meetup_location}
                        </Text>
                      </View>
                      {offer.notes ? (
                        <Text style={styles.offerNotes} numberOfLines={2}>
                          {offer.notes}
                        </Text>
                      ) : null}
                    </View>
                  );
                })
              )
            ) : subTab === 'my_offers' ? (
              myOffers.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="megaphone-outline" size={26} color={BitcoinColors.orange} />
                  <Text style={styles.emptyText}>You have not posted any exchange offers yet.</Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => router.push('/p2p/post-offer')}
                    activeOpacity={0.8}>
                    <Text style={styles.retryText}>+ Post Exchange Offer</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                myOffers.map((offer) => (
                  <View key={offer.id} style={styles.offerCard}>
                    <View style={styles.offerTopRow}>
                      <Text style={styles.makerName}>
                        {offer.side === 'sell' ? 'Selling' : 'Buying'} {offer.offer_currency} →{' '}
                        {offer.local_currency}
                      </Text>
                      <View style={styles.pairBadge}>
                        <Text style={styles.pairBadgeText}>{offer.status.toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.priceValue}>
                      {formatExchangeMoney(offer.rate, offer.local_currency)}
                      <Text style={styles.priceUnit}> / {offer.offer_currency}</Text>
                    </Text>
                    <Text style={styles.limitText}>
                      Available: {formatExchangeMoney(offer.available_amount, offer.offer_currency)} •
                      Limit: {formatExchangeMoney(offer.min_limit, offer.offer_currency)} –{' '}
                      {formatExchangeMoney(offer.max_limit, offer.offer_currency)}
                    </Text>
                    <View style={styles.meetupBox}>
                      <Ionicons name="location" size={14} color={BitcoinColors.cyan} />
                      <Text style={styles.meetupText}>{offer.meetup_location}</Text>
                    </View>
                    <View style={styles.myOfferActions}>
                      <TouchableOpacity
                        style={styles.secondarySmallBtn}
                        onPress={() => handleToggleOffer(offer)}
                        activeOpacity={0.8}>
                        <Text style={styles.secondarySmallText}>
                          {offer.status === 'active' ? 'Pause Offer' : 'Resume Offer'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.dangerSmallBtn}
                        onPress={() => handleCloseOffer(offer)}
                        activeOpacity={0.8}>
                        <Text style={styles.dangerSmallText}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )
            ) : myTrades.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="chatbubbles-outline" size={26} color={BitcoinColors.orange} />
                <Text style={styles.emptyText}>
                  No active P2P exchange trades yet. Pick an offer from the Marketplace to agree on a
                  public meetup.
                </Text>
              </View>
            ) : (
              myTrades.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.offerCard}
                  onPress={() => router.push({ pathname: '/p2p/exchange/[id]', params: { id: t.id } })}
                  activeOpacity={0.85}>
                  <View style={styles.offerTopRow}>
                    <Text style={styles.makerName}>
                      {formatExchangeMoney(t.offer_amount, t.offer_currency)} ⇄{' '}
                      {formatExchangeMoney(t.local_amount, t.local_currency)}
                    </Text>
                    <View style={styles.pairBadge}>
                      <Text style={styles.pairBadgeText}>{tradeStatusLabel(t.status)}</Text>
                    </View>
                  </View>
                  <Text style={styles.limitText}>
                    With: {t.maker_id === userId ? t.taker_name : t.maker_name} • Rate:{' '}
                    {formatExchangeMoney(t.rate, t.local_currency)}/{t.offer_currency}
                  </Text>
                  <View style={styles.meetupBox}>
                    <Ionicons name="location" size={14} color={BitcoinColors.cyan} />
                    <Text style={styles.meetupText}>
                      {t.meetup_location} ({t.meetup_time})
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </>
        ) : (
          /* ─── Deliver Cash Tab: Live Area Map + Mobile Cashier ─── */
          <>
            {/* Location / Address Search & Live Map */}
            <View style={[styles.card, { marginBottom: 14 }]}>
              <Text style={styles.cardTitle}>Find Live Users &amp; Mobile Cashiers</Text>
              <Text style={styles.cardBody}>
                Enter a location or address to see a live map of YTCash users and registered Mobile
                Cashiers in that area.
              </Text>

              <View style={styles.areaSearchRow}>
                <TextInput
                  style={styles.areaSearchInput}
                  value={areaQuery}
                  onChangeText={setAreaQuery}
                  placeholder="Enter city, area, or street address..."
                  placeholderTextColor={BitcoinColors.textMuted}
                  returnKeyType="search"
                  onSubmitEditing={handleSearchDeliveryArea}
                />
                <TouchableOpacity
                  style={styles.areaSearchBtn}
                  onPress={handleSearchDeliveryArea}
                  disabled={searchingArea}
                  activeOpacity={0.85}>
                  {searchingArea ? (
                    <ActivityIndicator size="small" color="#07090E" />
                  ) : (
                    <Ionicons name="search" size={18} color="#07090E" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.areaGpsBtn}
                  onPress={handleUseGpsForDelivery}
                  disabled={searchingArea}
                  activeOpacity={0.85}>
                  <Ionicons name="locate" size={18} color={BitcoinColors.orange} />
                </TouchableOpacity>
              </View>

              {areaMatches && areaMatches.length > 0 && (
                <View style={styles.areaMatchesBox}>
                  {areaMatches.slice(0, 5).map((m, idx) => (
                    <TouchableOpacity
                      key={`${m.lat}-${m.lng}-${idx}`}
                      style={styles.areaMatchItem}
                      onPress={() => {
                        setAreaQuery(m.label);
                        selectDeliveryArea(m.label, m.lat, m.lng);
                      }}>
                      <Ionicons name="location-outline" size={15} color={BitcoinColors.orange} />
                      <Text style={styles.areaMatchText} numberOfLines={2}>
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {areaMatches && areaMatches.length === 0 && (
                <Text style={styles.areaEmptyHint}>
                  No matching address found. Try a broader city or landmark name.
                </Text>
              )}

              {selectedArea && (() => {
                const cashierIds = new Set(nearbyCashiers.map((c) => c.id));
                const nearbyOnlineUsers = onlineUsers
                  .filter((u) => u.lat !== null && u.lng !== null && !cashierIds.has(u.id))
                  .map((u) => ({
                    id: u.id,
                    name: u.name,
                    lat: u.lat as number,
                    lng: u.lng as number,
                    km: distanceKm(selectedArea.lat, selectedArea.lng, u.lat as number, u.lng as number),
                  }))
                  .filter((u) => u.km <= 30)
                  .sort((a, b) => a.km - b.km);

                const mapDots: MapPartner[] = [
                  ...nearbyCashiers.map((c) => ({
                    id: c.id,
                    name: `${c.name} (Mobile Cashier)`,
                    lat: c.lat,
                    lng: c.lng,
                    kind: 'cashier' as const,
                  })),
                  ...nearbyOnlineUsers.map((u) => ({
                    id: u.id,
                    name: `${u.name} (App User Online)`,
                    lat: u.lat,
                    lng: u.lng,
                    kind: 'user' as const,
                  })),
                ];

                return (
                  <View style={styles.liveMapSection}>
                    <View style={styles.liveMapWrap}>
                      <PartnerMap
                        receiver={{
                          lat: selectedArea.lat,
                          lng: selectedArea.lng,
                          label: selectedArea.label,
                        }}
                        partners={mapDots}
                        selectedId={selectedMapDotId}
                        onSelect={setSelectedMapDotId}
                      />
                    </View>

                    <View style={styles.legendRow}>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: BitcoinColors.green }]} />
                        <Text style={styles.legendText}>Location</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: BitcoinColors.orange }]} />
                        <Text style={styles.legendText}>
                          Mobile Cashiers ({nearbyCashiers.length})
                        </Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: BitcoinColors.cyan }]} />
                        <Text style={styles.legendText}>
                          App Users ({nearbyOnlineUsers.length})
                        </Text>
                      </View>
                    </View>

                    {loadingAreaDots ? (
                      <ActivityIndicator color={BitcoinColors.orange} style={{ marginTop: 10 }} />
                    ) : mapDots.length === 0 ? (
                      <Text style={styles.areaEmptyHint}>
                        No live app users or Mobile Cashiers within 30 km of this address right now.
                      </Text>
                    ) : (
                      <View style={styles.dotsList}>
                        {nearbyCashiers.map((c) => {
                          const rich = areaCashiers.find((rc) => rc.user_id === c.id);
                          const methods = rich?.accepted_methods ?? ['gcash', 'maya', 'gotyme', 'bank_transfer'];
                          const isMe = c.id === userId;
                          return (
                            <TouchableOpacity
                              key={`cashier-${c.id}`}
                              style={[
                                styles.dotRow,
                                selectedMapDotId === c.id && styles.dotRowSelected,
                              ]}
                              onPress={() => setSelectedMapDotId(c.id)}
                              activeOpacity={0.85}>
                              <View style={[styles.dotPulse, { backgroundColor: BitcoinColors.orange }]} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.dotName}>
                                  {c.name} {isMe ? '(You)' : ''}
                                </Text>
                                <Text style={styles.dotMeta}>
                                  Mobile Cashier • {formatDistance(c.km)}
                                </Text>
                                <View style={styles.methodTagsRow}>
                                  {methods.map((m) => (
                                    <View key={m} style={styles.methodTag}>
                                      <Text style={styles.methodTagText}>{cashierMethodLabel(m)}</Text>
                                    </View>
                                  ))}
                                </View>
                              </View>
                              {!isMe ? (
                                <TouchableOpacity
                                  style={styles.requestCashBtn}
                                  onPress={() => openRequestCashModal(c)}
                                  activeOpacity={0.85}>
                                  <Text style={styles.requestCashBtnText}>Request Cash</Text>
                                </TouchableOpacity>
                              ) : (
                                <View style={styles.cashierPill}>
                                  <Text style={styles.cashierPillText}>Cashier</Text>
                                </View>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                        {nearbyOnlineUsers.map((u) => (
                          <TouchableOpacity
                            key={`user-${u.id}`}
                            style={[
                              styles.dotRow,
                              selectedMapDotId === u.id && styles.dotRowSelected,
                            ]}
                            onPress={() => setSelectedMapDotId(u.id)}
                            activeOpacity={0.8}>
                            <View style={[styles.dotPulse, { backgroundColor: BitcoinColors.cyan }]} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.dotName}>{u.name}</Text>
                              <Text style={styles.dotMeta}>
                                App User Online • {formatDistance(u.km)}
                              </Text>
                            </View>
                            <View style={styles.onlinePill}>
                              <Text style={styles.onlinePillText}>Live</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })()}
            </View>

            <View style={styles.card}>
              <View style={styles.partnerRow}>
                <View style={styles.partnerTextWrap}>
                  <Text style={styles.cardTitle}>Register as Mobile Cashier</Text>
                  <Text style={styles.cardBody}>
                    Go live as a Mobile Cashier in your area so nearby users see your live dot and
                    can request cash delivery.
                  </Text>
                </View>
                {savingPartner ? (
                  <ActivityIndicator color={BitcoinColors.orange} />
                ) : (
                  <Switch
                    value={available}
                    onValueChange={handleTogglePartner}
                    trackColor={{ false: BitcoinColors.border, true: 'rgba(16, 185, 129, 0.5)' }}
                    thumbColor={available ? BitcoinColors.green : '#CBD5E1'}
                    accessibilityLabel="Deliver cash near me"
                  />
                )}
              </View>
              {available && (
                <View style={styles.areaRow}>
                  <Ionicons name="location" size={15} color={BitcoinColors.green} />
                  <Text style={styles.areaText}>
                    Your area was set{' '}
                    {partner
                      ? new Date(partner.updated_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : ''}
                    .
                  </Text>
                  <TouchableOpacity
                    onPress={handleUpdateArea}
                    disabled={savingPartner}
                    accessibilityRole="button">
                    <Text style={styles.areaLink}>Update to here</Text>
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                style={styles.withdrawRow}
                onPress={() => router.push('/withdraw')}
                activeOpacity={0.8}
                accessibilityRole="button">
                <Ionicons name="wallet-outline" size={16} color={BitcoinColors.orange} />
                <Text style={styles.withdrawText}>Withdraw earnings to GCash, Maya or bank</Text>
                <Ionicons name="chevron-forward" size={16} color={BitcoinColors.textMuted} />
              </TouchableOpacity>

              {/* Mobile Cashier Accepted Payment Methods */}
              <View style={styles.cashierMethodsSection}>
                <Text style={styles.cashierMethodsTitle}>ACCEPTED PAYMENT METHODS</Text>
                <Text style={styles.cashierMethodsSub}>
                  Select how users can transfer funds to your account before you hand over cash:
                </Text>

                <View style={styles.cashierChipsWrap}>
                  {CASHIER_PAY_METHODS.map((pm) => {
                    const active = selectedMethods.includes(pm.id);
                    return (
                      <TouchableOpacity
                        key={pm.id}
                        style={[styles.cashierChip, active && styles.cashierChipActive]}
                        onPress={() => toggleCashierMethod(pm.id)}
                        activeOpacity={0.8}>
                        <Ionicons
                          name={active ? 'checkbox' : 'square-outline'}
                          size={15}
                          color={active ? BitcoinColors.orange : BitcoinColors.textMuted}
                        />
                        <Text style={[styles.cashierChipText, active && styles.cashierChipTextActive]}>
                          {pm.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {selectedMethods.map((methodId) => {
                  const meta = CASHIER_PAY_METHODS.find((m) => m.id === methodId)!;
                  const acct = accountsMap[methodId];
                  return (
                    <View key={methodId} style={styles.acctEditorBox}>
                      <Text style={styles.acctEditorTitle}>{meta.label} Receiving Account</Text>
                      {meta.needsBankName && (
                        <TextInput
                          style={styles.acctInput}
                          value={acct.bank_name}
                          onChangeText={(t) =>
                            setAccountsMap((p) => ({
                              ...p,
                              [methodId]: { ...p[methodId], bank_name: t },
                            }))
                          }
                          placeholder="Bank Name (e.g. BPI, BDO, UnionBank)"
                          placeholderTextColor={BitcoinColors.textMuted}
                        />
                      )}
                      <TextInput
                        style={styles.acctInput}
                        value={acct.account_name}
                        onChangeText={(t) =>
                          setAccountsMap((p) => ({
                            ...p,
                            [methodId]: { ...p[methodId], account_name: t },
                          }))
                        }
                        placeholder="Account Name"
                        placeholderTextColor={BitcoinColors.textMuted}
                      />
                      <TextInput
                        style={styles.acctInput}
                        value={acct.account_number}
                        onChangeText={(t) =>
                          setAccountsMap((p) => ({
                            ...p,
                            [methodId]: { ...p[methodId], account_number: t },
                          }))
                        }
                        placeholder={meta.placeholder}
                        placeholderTextColor={BitcoinColors.textMuted}
                      />
                    </View>
                  );
                })}

                <TouchableOpacity
                  style={styles.saveCashierBtn}
                  onPress={handleSaveCashierPayments}
                  disabled={savingCashier}
                  activeOpacity={0.85}>
                  {savingCashier ? (
                    <ActivityIndicator size="small" color="#07090E" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color="#07090E" />
                      <Text style={styles.saveCashierBtnText}>Save Payment Methods</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {cashRequests.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>MOBILE CASHIER REQUESTS</Text>
                {cashRequests.map((cr) => {
                  const amCashier = cr.cashier_id === userId;
                  return (
                    <TouchableOpacity
                      key={cr.id}
                      style={styles.offerCard}
                      onPress={() =>
                        router.push({ pathname: '/p2p/cash-request/[id]', params: { id: cr.id } })
                      }
                      activeOpacity={0.85}>
                      <View style={styles.offerTopRow}>
                        <Text style={styles.makerName}>
                          {formatCurrency(cr.amount, cr.currency)} •{' '}
                          {cashierMethodLabel(cr.payment_method)}
                        </Text>
                        <View style={styles.pairBadge}>
                          <Text style={styles.pairBadgeText}>
                            {cashRequestStatusLabel(cr.status)}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.limitText}>
                        {amCashier
                          ? `Deliver to: ${cr.requester_name}`
                          : `Cashier: ${cr.cashier_name}`}
                      </Text>
                      <View style={styles.meetupBox}>
                        <Ionicons name="location" size={14} color={BitcoinColors.cyan} />
                        <Text style={styles.meetupText} numberOfLines={1}>
                          {cr.location_label}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            <Text style={styles.sectionTitle}>REQUESTS FOR YOU</Text>

            {loading ? (
              <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
            ) : loadError ? (
              <View style={styles.emptyCard}>
                <Ionicons name="cloud-offline-outline" size={26} color={BitcoinColors.red} />
                <Text style={styles.emptyText}>{loadError}</Text>
                <TouchableOpacity onPress={loadDelivery} style={styles.retryBtn} activeOpacity={0.8}>
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : deliveryList.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="cash-outline" size={26} color={BitcoinColors.orange} />
                <Text style={styles.emptyText}>
                  {available
                    ? 'No requests yet. New ones near you appear here.'
                    : 'Turn on "Deliver cash near me" to receive requests.'}
                </Text>
              </View>
            ) : (
              deliveryList.map((order) => (
                <P2POrderRow
                  key={order.id}
                  order={order}
                  role="partner"
                  onPress={() => router.push({ pathname: '/p2p/[id]', params: { id: order.id } })}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Take Offer / Start Public Meetup Modal */}
      <Modal
        visible={Boolean(selectedOffer)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedOffer(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {takerMode === 'buy' ? 'Buy' : 'Sell'} {selectedOffer?.offer_currency} with{' '}
                {selectedOffer?.maker_name}
              </Text>
              <TouchableOpacity onPress={() => setSelectedOffer(null)}>
                <Ionicons name="close" size={22} color={BitcoinColors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedOffer && (
              <>
                <Text style={styles.modalRate}>
                  Rate: 1 {selectedOffer.offer_currency} ={' '}
                  {formatExchangeMoney(selectedOffer.rate, selectedOffer.local_currency)}
                </Text>

                <Text style={styles.modalLabel}>
                  AMOUNT ({selectedOffer.offer_currency}) • Limit{' '}
                  {selectedOffer.min_limit}–{selectedOffer.max_limit}
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeAmountText}
                  onChangeText={(t) => setTradeAmountText(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="Amount"
                  placeholderTextColor={BitcoinColors.textMuted}
                />

                <View style={styles.modalTotalBox}>
                  <Text style={styles.modalTotalLabel}>Local Cash Equivalent</Text>
                  <Text style={styles.modalTotalValue}>
                    {formatExchangeMoney(calculatedLocal, selectedOffer.local_currency)}
                  </Text>
                </View>

                <Text style={styles.modalLabel}>AGREED PUBLIC MEETUP LOCATION</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeSpotText}
                  onChangeText={setTradeSpotText}
                  placeholder="Public mall, cafe, or bank lobby"
                  placeholderTextColor={BitcoinColors.textMuted}
                />

                <Text style={styles.modalLabel}>PROPOSED MEETUP TIME</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeTimeText}
                  onChangeText={setTradeTimeText}
                  placeholder="e.g. Today, 3:00 PM"
                  placeholderTextColor={BitcoinColors.textMuted}
                />

                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={handleConfirmTakeOffer}
                  disabled={creatingTrade}
                  activeOpacity={0.85}>
                  <LinearGradient
                    colors={Brand.gradientButton}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtnGradient}>
                    {creatingTrade ? (
                      <ActivityIndicator color="#07090E" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Start Meetup & Open Chat</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setSelectedOffer(null)}
                  activeOpacity={0.8}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Request Cash from Mobile Cashier Modal */}
      <Modal
        visible={Boolean(requestCashier)}
        transparent
        animationType="fade"
        onRequestClose={() => setRequestCashier(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Request Cash from {requestCashier?.display_name}
              </Text>
              <TouchableOpacity onPress={() => setRequestCashier(null)}>
                <Ionicons name="close" size={22} color={BitcoinColors.textSecondary} />
              </TouchableOpacity>
            </View>

            {requestCashier && (
              <>
                <Text style={styles.modalRate}>
                  Cashier will go to your location and hand over cash once funds are transferred.
                </Text>

                <Text style={styles.modalLabel}>CASH AMOUNT NEEDED (PHP)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={requestAmountText}
                  onChangeText={(t) => setRequestAmountText(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="1000"
                  placeholderTextColor={BitcoinColors.textMuted}
                />

                <Text style={styles.modalLabel}>TRANSFER PAYMENT VIA</Text>
                <View style={styles.cashierChipsWrap}>
                  {requestCashier.accepted_methods.map((m) => {
                    const active = requestMethod === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        style={[styles.cashierChip, active && styles.cashierChipActive]}
                        onPress={() => setRequestMethod(m)}
                        activeOpacity={0.8}>
                        <Text style={[styles.cashierChipText, active && styles.cashierChipTextActive]}>
                          {cashierMethodLabel(m)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>DELIVERY NOTES (LANDMARK / FLOOR)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={requestNotes}
                  onChangeText={setRequestNotes}
                  placeholder="e.g. Main lobby near coffee shop"
                  placeholderTextColor={BitcoinColors.textMuted}
                />

                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={handleSubmitCashRequest}
                  disabled={submittingCashReq}
                  activeOpacity={0.85}>
                  <LinearGradient
                    colors={Brand.gradientButton}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtnGradient}>
                    {submittingCashReq ? (
                      <ActivityIndicator color="#07090E" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Send Cash Request</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setRequestCashier(null)}
                  activeOpacity={0.8}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
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
  tabSelected: {
    backgroundColor: 'rgba(247, 147, 26, 0.16)',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  tabTextSelected: {
    color: BitcoinColors.orange,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BitcoinColors.orange,
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#07090E',
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  p2pHeaderCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  buySellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  buySellToggle: {
    flexDirection: 'row',
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  bsBtn: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 9,
  },
  bsBtnBuy: {
    backgroundColor: BitcoinColors.green,
  },
  bsBtnSell: {
    backgroundColor: BitcoinColors.red,
  },
  bsText: {
    fontSize: 13,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
  },
  bsTextActive: {
    color: '#07090E',
  },
  postOfferBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: BitcoinColors.orange,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  postOfferText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#07090E',
  },
  p2pSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: BitcoinColors.textSecondary,
    marginTop: 10,
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    letterSpacing: 0.9,
    marginTop: 12,
    marginBottom: 6,
  },
  filterRow: {
    gap: 6,
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  filterChipSelected: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.16)',
  },
  filterFlag: {
    fontSize: 12,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  filterTextSelected: {
    color: BitcoinColors.orange,
  },
  localRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  filterLabelInline: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
  },
  localChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  localChipSelected: {
    borderColor: BitcoinColors.cyan,
    backgroundColor: 'rgba(6, 182, 212, 0.14)',
  },
  localChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  localChipTextSelected: {
    color: BitcoinColors.cyan,
  },
  rateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  rateBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.cyan,
  },
  subTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    marginBottom: 12,
  },
  subTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    alignItems: 'center',
  },
  subTabActive: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
  },
  subTabText: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
  },
  subTabTextActive: {
    color: BitcoinColors.orange,
  },
  offerCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 12,
  },
  offerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  makerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  makerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(247, 147, 26, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  makerAvatarText: {
    fontSize: 14,
    fontWeight: '900',
    color: BitcoinColors.orange,
  },
  makerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  makerName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  makerStats: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
    marginTop: 1,
  },
  pairBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  pairBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
  },
  offerMidRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 12,
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textMuted,
    letterSpacing: 0.7,
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 2,
  },
  priceUnit: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  limitText: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 3,
  },
  limitStrong: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tradeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tradeBtnBuy: {
    backgroundColor: BitcoinColors.green,
  },
  tradeBtnSell: {
    backgroundColor: BitcoinColors.red,
  },
  tradeBtnMine: {
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  tradeBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#07090E',
  },
  meetupBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  meetupText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.cyan,
  },
  offerNotes: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 5,
    lineHeight: 16,
  },
  myOfferActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  secondarySmallBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    alignItems: 'center',
  },
  secondarySmallText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dangerSmallBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.35)',
    alignItems: 'center',
  },
  dangerSmallText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.red,
  },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  cardBody: {
    fontSize: 12,
    lineHeight: 18,
    color: BitcoinColors.textSecondary,
    marginTop: 6,
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#07090E',
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  partnerTextWrap: {
    flex: 1,
  },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  areaText: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
  },
  areaLink: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  withdrawRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  withdrawText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1.1,
    marginTop: 26,
    marginBottom: 12,
  },
  loader: {
    marginTop: 24,
  },
  emptyCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
  },
  retryText: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  modalRate: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.orange,
    marginTop: 6,
  },
  modalLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#FFFFFF',
  },
  modalTotalBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  modalTotalLabel: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    fontWeight: '700',
  },
  modalTotalValue: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  modalSubmitBtn: {
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalCancelBtn: {
    marginTop: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  areaSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  areaSearchInput: {
    flex: 1,
    height: 44,
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#FFFFFF',
  },
  areaSearchBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: BitcoinColors.orange,
    justifyContent: 'center',
    alignItems: 'center',
  },
  areaGpsBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  areaMatchesBox: {
    marginTop: 8,
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    overflow: 'hidden',
  },
  areaMatchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: BitcoinColors.border,
  },
  areaMatchText: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
  },
  areaEmptyHint: {
    fontSize: 12,
    color: BitcoinColors.textMuted,
    marginTop: 10,
    textAlign: 'center',
  },
  liveMapSection: {
    marginTop: 14,
  },
  liveMapWrap: {
    height: 250,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10,
    alignItems: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  dotsList: {
    marginTop: 10,
    gap: 8,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  dotRowSelected: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
  },
  dotPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  dotMeta: {
    fontSize: 11,
    color: BitcoinColors.textSecondary,
    marginTop: 1,
  },
  cashierPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(247, 147, 26, 0.16)',
  },
  cashierPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  onlinePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(6, 182, 212, 0.16)',
  },
  onlinePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.cyan,
  },
  methodTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 5,
  },
  methodTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(247, 147, 26, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  methodTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: BitcoinColors.orange,
  },
  requestCashBtn: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BitcoinColors.orange,
  },
  requestCashBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#07090E',
  },
  cashierMethodsSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
  },
  cashierMethodsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 0.9,
  },
  cashierMethodsSub: {
    fontSize: 12,
    color: BitcoinColors.textMuted,
    marginTop: 4,
    lineHeight: 17,
  },
  cashierChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  cashierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  cashierChipActive: {
    borderColor: BitcoinColors.orange,
    backgroundColor: 'rgba(247, 147, 26, 0.14)',
  },
  cashierChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  cashierChipTextActive: {
    color: BitcoinColors.orange,
  },
  acctEditorBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 8,
  },
  acctEditorTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  acctInput: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#FFFFFF',
  },
  saveCashierBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: BitcoinColors.orange,
  },
  saveCashierBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#07090E',
  },
});
