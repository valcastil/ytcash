import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { BitcoinColors } from '@/constants/theme';

interface BitcoinBadgeProps {
  size?: number;
  glow?: boolean;
}

export function BitcoinBadge({ size = 48, glow = true }: BitcoinBadgeProps) {
  const radius = size / 2;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {glow && (
        <View
          style={[
            styles.glowEffect,
            {
              width: size * 1.25,
              height: size * 1.25,
              borderRadius: (size * 1.25) / 2,
              backgroundColor: 'rgba(247, 147, 26, 0.22)',
            },
          ]}
        />
      )}
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id="btcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FFA940" />
            <Stop offset="50%" stopColor="#F7931A" />
            <Stop offset="100%" stopColor="#D97706" />
          </LinearGradient>
          <LinearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FFD700" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#F7931A" stopOpacity="0.3" />
          </LinearGradient>
        </Defs>

        {/* Outer glowing ring */}
        <Circle cx="32" cy="32" r="30.5" fill="none" stroke="url(#borderGrad)" strokeWidth="1.5" />

        {/* Primary coin body */}
        <Circle cx="32" cy="32" r="28" fill="url(#btcGrad)" />

        {/* Subtle inner rim */}
        <Circle cx="32" cy="32" r="25.5" fill="none" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1" />

        {/* Official tilted Bitcoin symbol ₿ */}
        <Path
          d="M42.8 28.2c.6-3.8-2.3-5.8-6.3-7.2l1.3-5.1-3.1-.8-1.2 5c-.8-.2-1.7-.4-2.5-.6l1.3-5-3.1-.8-1.3 5.1c-.7-.2-1.4-.3-2.1-.5l.02-.08-4.3-1.1-.8 3.3s2.3.5 2.2.6c1.3.3 1.5 1.2 1.5 1.8l-1.5 6.1c.1.02.2.06.3.1-.1-.03-.2-.07-.3-.1l-2.1 8.5c-.2.4-.6 1.1-1.6.8.03.04-2.2-.6-2.2-.6l-1.6 3.6 4.1 1c.8.2 1.5.4 2.3.6l-1.3 5.3 3.1.8 1.3-5.1c.9.2 1.7.4 2.5.6l-1.3 5.1 3.1.8 1.3-5.2c5.3 1 9.3.6 11-4.2 1.4-3.9-.1-6.1-2.9-7.5 2.1-.5 3.6-1.9 4-4.8zm-7.2 10.4c-1 3.9-7.5 1.8-9.6 1.3l1.7-6.9c2.1.5 8.8 1.5 7.9 5.6zm1-10.4c-.9 3.6-6.3 1.8-8.1 1.3l1.5-6.2c1.8.5 7.4 1.3 6.6 4.9z"
          fill="#FFFFFF"
        />
      </Svg>
    </View>
  );
}

interface BitcoinPillProps {
  sats?: number;
  btc?: number;
}

export function BitcoinPill({ sats, btc }: BitcoinPillProps) {
  return (
    <View style={styles.pillContainer}>
      <Text style={styles.pillLightning}>⚡</Text>
      {sats !== undefined ? (
        <Text style={styles.pillText}>{sats.toLocaleString()} sats</Text>
      ) : btc !== undefined ? (
        <Text style={styles.pillText}>₿{btc.toFixed(6)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  glowEffect: {
    position: 'absolute',
  },
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  pillLightning: {
    fontSize: 12,
    color: BitcoinColors.lightning,
  },
  pillText: {
    color: BitcoinColors.gold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
