import { Tabs } from 'expo-router';
import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { BitcoinColors } from '@/constants/theme';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  // Dynamic bottom padding to safely clear Android gesture/3-button navigation and iOS home indicator
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'ios' ? 24 : 12);
  const tabBarHeight = 56 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: BitcoinColors.orange,
        tabBarInactiveTintColor: BitcoinColors.textMuted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#0A0D14',
          borderTopColor: '#1A2234',
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: bottomPadding,
          paddingTop: 8,
          elevation: 10,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.35,
          shadowRadius: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.3,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeIconWrap : undefined}>
              <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={23} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="send"
        options={{
          title: 'Send',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeIconWrap : undefined}>
              <Ionicons name={focused ? 'arrow-up-circle' : 'arrow-up-circle-outline'} size={23} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan Cash',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.scanTabPill, focused && styles.scanTabPillFocused]}>
              <Ionicons name="scan" size={22} color={focused ? '#FFFFFF' : BitcoinColors.orange} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Ledger',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeIconWrap : undefined}>
              <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={23} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  activeIconWrap: {
    shadowColor: BitcoinColors.orange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  scanTabPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanTabPillFocused: {
    backgroundColor: BitcoinColors.orange,
    borderColor: BitcoinColors.gold,
    shadowColor: BitcoinColors.orange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
});
