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
import { Brand } from '@/constants/theme';
import { formatCurrency } from '@/constants/currencies';

export default function ProfileScreen() {
  const { user, profile, signOut } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
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
    { icon: 'person-outline' as const, label: 'Personal Information', onPress: () => {} },
    { icon: 'shield-checkmark-outline' as const, label: 'KYC Verification', badge: profile?.kyc_verified ? 'Verified' : 'Pending', onPress: () => {} },
    { icon: 'card-outline' as const, label: 'Payment Methods', onPress: () => {} },
    { icon: 'notifications-outline' as const, label: 'Notifications', onPress: () => {} },
    { icon: 'lock-closed-outline' as const, label: 'Security & Privacy', onPress: () => {} },
    { icon: 'help-circle-outline' as const, label: 'Help & Support', onPress: () => {} },
    { icon: 'document-text-outline' as const, label: 'Terms & Conditions', onPress: () => {} },
    { icon: 'information-circle-outline' as const, label: 'About YTCash', onPress: () => {} },
  ];

  return (
    <ScrollView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Avatar Card */}
      <View style={styles.avatarCard}>
        <View style={styles.avatarCircle}>
          <Ionicons name="person" size={40} color={Brand.primary} />
        </View>
        <Text style={styles.userName}>{profile?.full_name ?? 'User'}</Text>
        <Text style={styles.userEmail}>{user?.email ?? ''}</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Balance: </Text>
          <Text style={styles.balanceValue}>{formatCurrency(profile?.balance ?? 0)}</Text>
        </View>
      </View>

      {/* Menu */}
      <View style={styles.menu}>
        {menuItems.map((item, i) => (
          <TouchableOpacity key={i} style={styles.menuItem} onPress={item.onPress}>
            <Ionicons name={item.icon} size={22} color="#6B7280" />
            <Text style={styles.menuLabel}>{item.label}</Text>
            <View style={styles.menuRight}>
              {item.badge && (
                <View style={[styles.badge, item.badge === 'Verified' ? styles.badgeGreen : styles.badgeYellow]}>
                  <Text style={[styles.badgeText, item.badge === 'Verified' ? styles.badgeTextGreen : styles.badgeTextYellow]}>
                    {item.badge}
                  </Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color="#DFE1E6" />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} disabled={loggingOut}>
        <Ionicons name="log-out-outline" size={22} color="#FF5630" />
        <Text style={styles.logoutText}>{loggingOut ? 'Signing out...' : 'Sign Out'}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>YTCash v1.0.0</Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: Brand.primary,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  avatarCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF3E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  userName: { fontSize: 20, fontWeight: '700', color: '#1A1A2E' },
  userEmail: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  balanceRow: { flexDirection: 'row', marginTop: 12 },
  balanceLabel: { fontSize: 14, color: '#6B7280' },
  balanceValue: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  menu: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  menuLabel: { flex: 1, fontSize: 15, color: '#1A1A2E', marginLeft: 14 },
  menuRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeGreen: { backgroundColor: '#E3FCEF' },
  badgeYellow: { backgroundColor: '#FFFAE6' },
  badgeText: { fontSize: 11, fontWeight: '600' },
  badgeTextGreen: { color: '#36B37E' },
  badgeTextYellow: { color: '#FFAB00' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: '#FF5630' },
  version: { textAlign: 'center', fontSize: 12, color: '#97A0AF', marginTop: 20 },
});
