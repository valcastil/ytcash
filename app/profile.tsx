import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors } from '@/constants/theme';
import { formatCurrency, phpToSats } from '@/constants/currencies';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function ProfileScreen() {
  const { user, profile, signOut } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          try {
            await signOut();
          } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Failed to sign out');
          } finally {
            setLoggingOut(false);
          }
        },
      },
    ]);
  }

  const menuItems = [
    { icon: 'shield-checkmark-outline' as const, label: 'Identity Verification', badge: profile?.kyc_verified ? 'Verified' : 'Not verified', onPress: () => router.push('/kyc') },
    { icon: 'key-outline' as const, label: 'Backup & Recovery Key', badge: 'Active', onPress: () => {} },
    { icon: 'flash-outline' as const, label: 'Lightning Channels', badge: 'Connected', onPress: () => {} },
    { icon: 'card-outline' as const, label: 'Withdraw to Bank or GCash', onPress: () => router.push('/withdraw') },
    { icon: 'notifications-outline' as const, label: 'Ledger Notifications', onPress: () => {} },
    { icon: 'lock-closed-outline' as const, label: 'Security & Biometrics', onPress: () => router.push('/kyc') },
    { icon: 'help-circle-outline' as const, label: 'Help & Support', onPress: () => {} },
    { icon: 'document-text-outline' as const, label: 'Legal & Privacy', onPress: () => {} },
  ];

  const balance = profile?.balance ?? 0;
  const sats = phpToSats(balance);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account & Security</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Avatar Card */}
      <View style={styles.avatarCard}>
        <View style={styles.avatarWrapper}>
          <BitcoinBadge size={72} glow={true} />
        </View>
        <Text style={styles.userName}>{profile?.full_name ?? 'Bitcoin Holder'}</Text>
        <Text style={styles.userEmail}>{user?.email ?? ''}</Text>

        <View style={styles.balancePill}>
          <Text style={styles.balanceLabel}>Total Balance: </Text>
          <Text style={styles.balanceValue}>{formatCurrency(balance)}</Text>
          <Text style={styles.balanceSats}> • {sats.toLocaleString()} sats</Text>
        </View>
      </View>

      {/* Menu List */}
      <View style={styles.menu}>
        {menuItems.map((item, i) => (
          <TouchableOpacity key={i} style={styles.menuItem} onPress={item.onPress} activeOpacity={0.75}>
            <View style={styles.menuIconWrap}>
              <Ionicons name={item.icon} size={20} color={BitcoinColors.orange} />
            </View>
            <Text style={styles.menuLabel}>{item.label}</Text>
            <View style={styles.menuRight}>
              {item.badge && (
                <View
                  style={[
                    styles.badge,
                    item.badge === 'Verified' || item.badge === 'Active' || item.badge === 'Connected'
                      ? styles.badgeGreen
                      : styles.badgeYellow,
                  ]}>
                  <Text
                    style={[
                      styles.badgeText,
                      item.badge === 'Verified' || item.badge === 'Active' || item.badge === 'Connected'
                        ? styles.badgeTextGreen
                        : styles.badgeTextYellow,
                    ]}>
                    {item.badge}
                  </Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={BitcoinColors.textMuted} />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        disabled={loggingOut}
        activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={20} color={BitcoinColors.red} />
        <Text style={styles.logoutText}>{loggingOut ? 'Signing out...' : 'Sign Out of Wallet'}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>YTCash • Bitcoin Layer 2 Powered • v1.0.0</Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  scroll: {
    paddingBottom: 30,
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
  avatarCard: {
    backgroundColor: BitcoinColors.cardBg,
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.3)',
  },
  avatarWrapper: {
    marginBottom: 14,
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  userEmail: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    marginTop: 4,
  },
  balancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 14,
  },
  balanceLabel: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
  },
  balanceValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  balanceSats: {
    fontSize: 12,
    fontWeight: '700',
    color: BitcoinColors.gold,
  },
  menu: {
    backgroundColor: BitcoinColors.cardBg,
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeGreen: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeYellow: {
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextGreen: {
    color: '#10B981',
  },
  badgeTextYellow: {
    color: BitcoinColors.orange,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 14,
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.25)',
    borderRadius: 16,
    gap: 8,
  },
  logoutText: {
    color: BitcoinColors.red,
    fontSize: 14,
    fontWeight: '700',
  },
  version: {
    textAlign: 'center',
    fontSize: 11,
    color: BitcoinColors.textMuted,
    marginTop: 20,
  },
});
