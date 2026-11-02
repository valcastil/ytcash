import { Platform } from 'react-native';

// Official Bitcoin Brand Colors & Modern Crypto Theme Palette
export const BitcoinColors = {
  orange: '#F7931A',       // The iconic Bitcoin Orange
  orangeDark: '#E8850D',   // Deep amber orange
  orangeLight: '#FFA940',  // Bright amber
  gold: '#FFD700',         // Satoshi gold
  goldMuted: '#B8860B',    // Dark goldenrod
  lightning: '#FFD026',    // Lightning yellow

  // Dark Matrix / Obsidian Carbon
  void: '#07090E',         // Deepest background
  darkBg: '#0B0E14',       // Primary background
  cardBg: '#121722',       // Surface / card background
  cardElevated: '#171E2C', // Higher elevation card
  border: '#1F2738',       // Subtle border
  borderGlow: 'rgba(247, 147, 26, 0.35)', // Glowing border
  borderGold: 'rgba(255, 215, 0, 0.25)',

  // Accents
  green: '#10B981',        // Confirmed / Receive green
  greenGlow: 'rgba(16, 185, 129, 0.2)',
  red: '#F43F5E',          // Send / Outgoing red
  cyan: '#06B6D4',         // Tech cyan

  // Neutrals & Text
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  surfaceLight: 'rgba(255, 255, 255, 0.05)',
  surfaceHighlight: 'rgba(247, 147, 26, 0.08)',
};

export const Colors = {
  light: {
    text: '#0F172A',
    background: '#F8FAFC',
    tint: BitcoinColors.orange,
    icon: '#64748B',
    tabIconDefault: '#94A3B8',
    tabIconSelected: BitcoinColors.orange,
    card: '#FFFFFF',
    border: '#E2E8F0',
    cardElevated: '#F1F5F9',
    success: BitcoinColors.green,
    error: BitcoinColors.red,
    warning: BitcoinColors.orange,
  },
  dark: {
    text: BitcoinColors.textPrimary,
    background: BitcoinColors.darkBg,
    tint: BitcoinColors.orange,
    icon: BitcoinColors.textSecondary,
    tabIconDefault: '#64748B',
    tabIconSelected: BitcoinColors.orange,
    card: BitcoinColors.cardBg,
    cardElevated: BitcoinColors.cardElevated,
    border: BitcoinColors.border,
    success: BitcoinColors.green,
    error: BitcoinColors.red,
    warning: BitcoinColors.orange,
  },
};

export const Brand = {
  primary: BitcoinColors.orange,
  primaryDark: BitcoinColors.orangeDark,
  primaryLight: BitcoinColors.orangeLight,
  accent: BitcoinColors.gold,
  lightning: BitcoinColors.lightning,
  dark: BitcoinColors.darkBg,
  card: BitcoinColors.cardBg,
  cardElevated: BitcoinColors.cardElevated,
  border: BitcoinColors.border,
  borderGlow: BitcoinColors.borderGlow,

  // Gradients
  gradient: [BitcoinColors.orange, BitcoinColors.orangeDark] as const,
  gradientGold: [BitcoinColors.gold, BitcoinColors.orange] as const,
  gradientDark: [BitcoinColors.cardBg, BitcoinColors.darkBg] as const,
  gradientCard: [BitcoinColors.cardElevated, BitcoinColors.cardBg] as const,
  gradientHero: ['#1E160A', BitcoinColors.cardBg] as const,
  gradientGlow: ['rgba(247, 147, 26, 0.25)', 'rgba(18, 23, 34, 0.95)'] as const,
  gradientButton: ['#FF9F1C', '#F7931A'] as const,
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
