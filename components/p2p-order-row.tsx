import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { formatCurrency } from '@/constants/currencies';
import { BitcoinColors } from '@/constants/theme';
import { orderStatusLabel, type P2POrder } from '@/services/p2p';

export function p2pStatusColor(order: P2POrder): string {
  switch (order.status) {
    case 'matched':
      return BitcoinColors.orange;
    case 'accepted':
      return BitcoinColors.cyan;
    case 'completed':
      return BitcoinColors.green;
    case 'cancelled':
      return BitcoinColors.textMuted;
  }
}

interface P2POrderRowProps {
  order: P2POrder;
  role: 'sender' | 'partner';
  onPress: () => void;
}

export function P2POrderRow({ order, role, onPress }: P2POrderRowProps) {
  const color = p2pStatusColor(order);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
      <View style={[styles.icon, { backgroundColor: color + '1F', borderColor: color + '40' }]}>
        <Ionicons name={role === 'sender' ? 'paper-plane' : 'cash'} size={19} color={color} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {role === 'sender' ? `To ${order.receiver_name}` : `Cash for ${order.receiver_name}`}
        </Text>
        <Text style={[styles.status, { color }]} numberOfLines={1}>
          {orderStatusLabel(order, role)}
        </Text>
      </View>
      <View style={styles.amountWrap}>
        <Text style={styles.amount}>{formatCurrency(order.amount)}</Text>
        <Text style={styles.date}>
          {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={BitcoinColors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    gap: 12,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  amountWrap: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  date: {
    fontSize: 11,
    color: BitcoinColors.textMuted,
    marginTop: 2,
  },
});
