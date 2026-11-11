import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { P2POrderRow } from '@/components/p2p-order-row';
import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { requestRoundedLocation } from '@/services/location';
import {
  getPartnerProfile,
  isOrderActive,
  listP2POrders,
  p2pErrorMessage,
  savePartnerProfile,
  setPartnerAvailability,
  subscribeToP2POrders,
  type P2POrder,
  type P2PPartnerProfile,
} from '@/services/p2p';

type Tab = 'send' | 'deliver';

export default function P2PHubScreen() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [tab, setTab] = useState<Tab>('send');
  const [sent, setSent] = useState<P2POrder[]>([]);
  const [assigned, setAssigned] = useState<P2POrder[]>([]);
  const [partner, setPartner] = useState<P2PPartnerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingPartner, setSavingPartner] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [orders, profile] = await Promise.all([listP2POrders(userId), getPartnerProfile(userId)]);
      setSent(orders.sent);
      setAssigned(orders.assigned);
      setPartner(profile);
      setLoadError(null);
    } catch (e) {
      setLoadError(p2pErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Reload when returning from the new-order or detail screens.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!userId) return;
    return subscribeToP2POrders(`hub-${userId}`, load);
  }, [userId, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function explainLocationProblem(status: 'denied' | 'blocked' | 'unavailable') {
    if (status === 'blocked') {
      Alert.alert(
        'Location is turned off',
        'Allow location access for YTCash in your device settings to deliver cash near you.',
        [
          { text: 'Not now', style: 'cancel' },
          ...(Platform.OS === 'web' ? [] : [{ text: 'Open Settings', onPress: () => Linking.openSettings() }]),
        ],
      );
    } else if (status === 'unavailable') {
      Alert.alert(
        'Location unavailable',
        'We could not get your location right now. Check that location services are on and try again.',
      );
    }
  }

  async function updateArea(isAvailable: boolean) {
    if (!userId) return;
    const result = await requestRoundedLocation();
    if (result.status !== 'granted') {
      explainLocationProblem(result.status);
      return;
    }
    setPartner(await savePartnerProfile(userId, result.coords, isAvailable));
  }

  async function handleTogglePartner(next: boolean) {
    if (!userId || savingPartner) return;
    setSavingPartner(true);
    try {
      if (next) {
        // Turning on always refreshes the area, so requests match where the partner is now.
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
  const list = tab === 'send' ? sent : assigned;

  return (
    <View style={styles.root}>
      <ScreenHeader title="P2P Cash Delivery" />

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
                {key === 'send' ? 'Send cash' : 'Deliver cash'}
              </Text>
              {key === 'deliver' && activeAssigned > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{activeAssigned}</Text>
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
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Send cash to someone in the Philippines</Text>
            <Text style={styles.cardBody}>
              Enter the receiver&apos;s address and we match you with the closest cash partner. Your money
              stays locked until the receiver has the cash in hand.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push('/p2p/new')}
              activeOpacity={0.85}
              accessibilityRole="button">
              <LinearGradient
                colors={Brand.gradientButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtnGradient}>
                <Ionicons name="paper-plane" size={16} color="#07090E" />
                <Text style={styles.primaryBtnText}>New cash delivery</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.partnerRow}>
              <View style={styles.partnerTextWrap}>
                <Text style={styles.cardTitle}>Deliver cash near me</Text>
                <Text style={styles.cardBody}>
                  Hand cash to receivers in your area and get the same amount in your wallet. Senders see
                  only your first name and how far you are from the receiver.
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
                    ? new Date(partner.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : ''}
                  .
                </Text>
                <TouchableOpacity onPress={handleUpdateArea} disabled={savingPartner} accessibilityRole="button">
                  <Text style={styles.areaLink}>Update to here</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>{tab === 'send' ? 'YOUR DELIVERIES' : 'REQUESTS FOR YOU'}</Text>

        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : loadError ? (
          <View style={styles.emptyCard}>
            <Ionicons name="cloud-offline-outline" size={26} color={BitcoinColors.red} />
            <Text style={styles.emptyText}>{loadError}</Text>
            <TouchableOpacity onPress={load} style={styles.retryBtn} activeOpacity={0.8}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : list.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name={tab === 'send' ? 'paper-plane-outline' : 'cash-outline'}
              size={26}
              color={BitcoinColors.orange}
            />
            <Text style={styles.emptyText}>
              {tab === 'send'
                ? 'No cash deliveries yet.'
                : available
                ? 'No requests yet. New ones near you appear here.'
                : 'Turn on "Deliver cash near me" to receive requests.'}
            </Text>
          </View>
        ) : (
          list.map((order) => (
            <P2POrderRow
              key={order.id}
              order={order}
              role={tab === 'send' ? 'sender' : 'partner'}
              onPress={() => router.push({ pathname: '/p2p/[id]', params: { id: order.id } })}
            />
          ))
        )}
      </ScrollView>
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
    marginTop: 16,
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
  primaryBtn: {
    marginTop: 16,
    borderRadius: 14,
    overflow: 'hidden',
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
});
