import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UsersMap, type UsersMapHandle } from '@/components/users-map';
import type { MapUser } from '@/constants/map-html';
import { BitcoinColors } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { usePresence } from '@/contexts/presence';

export default function OnlineMapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    onlineUsers,
    status,
    shareLocation,
    enableLocationSharing,
    disableLocationSharing,
    refreshLocation,
    reconnect,
  } = usePresence();

  const mapRef = useRef<UsersMapHandle>(null);
  const [updatingShare, setUpdatingShare] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const meId = user?.id ?? null;

  // Pick up a fresh position each time the screen is opened.
  useEffect(() => {
    refreshLocation();
  }, [refreshLocation]);

  const mapUsers = useMemo<MapUser[]>(
    () =>
      onlineUsers.flatMap((u) =>
        u.lat !== null && u.lng !== null ? [{ id: u.id, name: u.name, lat: u.lat, lng: u.lng }] : [],
      ),
    [onlineUsers],
  );

  const onlineCount = onlineUsers.length;
  const hiddenCount = onlineCount - mapUsers.length;

  async function handleToggleShare(next: boolean) {
    if (updatingShare) return;
    setUpdatingShare(true);
    try {
      if (!next) {
        await disableLocationSharing();
        return;
      }

      const result = await enableLocationSharing();
      if (result === 'blocked') {
        Alert.alert(
          'Location is turned off',
          'Allow location access for YTCash in your device settings to appear on the map.',
          [
            { text: 'Not now', style: 'cancel' },
            ...(Platform.OS === 'web'
              ? []
              : [{ text: 'Open Settings', onPress: () => Linking.openSettings() }]),
          ],
        );
      } else if (result === 'unavailable') {
        Alert.alert(
          'Location unavailable',
          'We could not get your location right now. Check that location services are on and try again.',
        );
      }
      // 'denied' needs no alert: the user just said no to the system prompt.
    } finally {
      setUpdatingShare(false);
    }
  }

  const statusLabel =
    status === 'online'
      ? `${onlineCount} ONLINE`
      : status === 'connecting'
      ? 'CONNECTING'
      : 'OFFLINE';
  const live = status === 'online';

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) + 12 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Users Online</Text>
        <View style={[styles.liveIndicator, !live && styles.liveIndicatorOff]}>
          {status === 'connecting' ? (
            <ActivityIndicator size="small" color={BitcoinColors.textSecondary} style={styles.liveSpinner} />
          ) : (
            <View style={[styles.livePulse, !live && styles.livePulseOff]} />
          )}
          <Text style={[styles.liveText, !live && styles.liveTextOff]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Map */}
      <View style={styles.mapWrap}>
        <UsersMap ref={mapRef} users={mapUsers} meId={meId} onError={() => setMapFailed(true)} />

        {status === 'error' && (
          <View style={styles.banner}>
            <Ionicons name="cloud-offline-outline" size={18} color={BitcoinColors.red} />
            <Text style={styles.bannerText}>
              Can&apos;t reach the live user list. Check your connection and try again.
            </Text>
            <TouchableOpacity onPress={reconnect} style={styles.bannerBtn} activeOpacity={0.8}>
              <Text style={styles.bannerBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {live && mapUsers.length === 0 && !mapFailed && (
          <View style={styles.emptyHint} pointerEvents="none">
            <Text style={styles.emptyHintText}>
              {onlineCount > 1
                ? 'Nobody online is sharing a location yet.'
                : 'No one is on the map yet. Share your location to be the first.'}
            </Text>
          </View>
        )}

        {mapUsers.length > 0 && (
          <TouchableOpacity
            style={styles.fitBtn}
            onPress={() => mapRef.current?.fit()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Show everyone on the map">
            <Ionicons name="scan-outline" size={20} color={BitcoinColors.orange} />
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom panel */}
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <View style={styles.shareRow}>
          <View
            style={[
              styles.shareIcon,
              shareLocation && { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.35)' },
            ]}>
            <Ionicons
              name={shareLocation ? 'location' : 'location-outline'}
              size={20}
              color={shareLocation ? BitcoinColors.green : BitcoinColors.textSecondary}
            />
          </View>
          <View style={styles.shareTextWrap}>
            <Text style={styles.shareTitle}>
              {shareLocation ? 'You are on the map' : 'Show me on the map'}
            </Text>
            <Text style={styles.shareSub}>
              Other users see your first name and general area (about 1 km), only while the app is open.
            </Text>
          </View>
          <Switch
            value={shareLocation}
            onValueChange={handleToggleShare}
            disabled={updatingShare}
            trackColor={{ false: BitcoinColors.border, true: 'rgba(16, 185, 129, 0.5)' }}
            thumbColor={shareLocation ? BitcoinColors.green : '#CBD5E1'}
            accessibilityLabel="Show me on the map"
          />
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>ONLINE NOW</Text>
          {hiddenCount > 0 && (
            <Text style={styles.listMeta}>
              {hiddenCount} not sharing location
            </Text>
          )}
        </View>

        {onlineCount === 0 ? (
          <Text style={styles.listEmpty}>
            {status === 'connecting' ? 'Looking for users…' : 'No users online right now.'}
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}>
            {onlineUsers.map((u) => {
              const isMe = u.id === meId;
              const located = u.lat !== null && u.lng !== null;
              return (
                <View key={u.id} style={[styles.chip, isMe && styles.chipMe]}>
                  <View style={[styles.chipDot, isMe && { backgroundColor: BitcoinColors.green }]} />
                  <Text style={styles.chipName} numberOfLines={1}>
                    {isMe ? 'You' : u.name}
                  </Text>
                  <Ionicons
                    name={located ? 'location' : 'eye-off-outline'}
                    size={13}
                    color={located ? BitcoinColors.orange : BitcoinColors.textMuted}
                  />
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
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
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    gap: 5,
    minWidth: 36,
  },
  liveIndicatorOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: BitcoinColors.border,
  },
  liveSpinner: {
    transform: [{ scale: 0.6 }],
    width: 10,
    height: 10,
  },
  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BitcoinColors.green,
  },
  livePulseOff: {
    backgroundColor: BitcoinColors.textMuted,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.green,
    letterSpacing: 0.4,
  },
  liveTextOff: {
    color: BitcoinColors.textSecondary,
  },
  mapWrap: {
    flex: 1,
  },
  banner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.4)',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#E2E8F0',
  },
  bannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
  },
  bannerBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: BitcoinColors.orange,
  },
  emptyHint: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 16,
    alignItems: 'center',
  },
  emptyHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
    textAlign: 'center',
    backgroundColor: 'rgba(11, 14, 20, 0.85)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  fitBtn: {
    position: 'absolute',
    right: 12,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  panel: {
    backgroundColor: BitcoinColors.cardBg,
    borderTopWidth: 1,
    borderTopColor: BitcoinColors.border,
    paddingTop: 14,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  shareIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  shareTextWrap: {
    flex: 1,
  },
  shareTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  shareSub: {
    fontSize: 11,
    lineHeight: 16,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 10,
  },
  listTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1.1,
  },
  listMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: BitcoinColors.textMuted,
  },
  listEmpty: {
    fontSize: 12,
    color: BitcoinColors.textMuted,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  chips: {
    paddingHorizontal: 20,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 180,
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipMe: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BitcoinColors.orange,
  },
  chipName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 1,
  },
});
