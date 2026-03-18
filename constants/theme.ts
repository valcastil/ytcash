import { Platform } from 'react-native';

const tintColorLight = '#F7931A';
const tintColorDark = '#FFB84D';

export const Colors = {
  light: {
    text: '#1A1A2E',
    background: '#F5F5F5',
    tint: tintColorLight,
    icon: '#6B7280',
    tabIconDefault: '#6B7280',
    tabIconSelected: tintColorLight,
    card: '#FFFFFF',
    border: '#E5E7EB',
    success: '#22C55E',
    error: '#EF4444',
    warning: '#F59E0B',
  },
  dark: {
    text: '#F3F4F6',
    background: '#0F0F0F',
    tint: tintColorDark,
    icon: '#9CA3AF',
    tabIconDefault: '#9CA3AF',
    tabIconSelected: tintColorDark,
    card: '#1A1A2E',
    border: '#2D2D3F',
    success: '#22C55E',
    error: '#EF4444',
    warning: '#F59E0B',
  },
};

export const Brand = {
  primary: '#F7931A',
  primaryDark: '#E8850D',
  primaryLight: '#FFB84D',
  accent: '#FFD700',
  gradient: ['#F7931A', '#E8850D'] as const,
  gradientDark: ['#1A1A2E', '#0F0F0F'] as const,
  gradientAccent: ['#FFD700', '#F7931A'] as const,
  dark: '#1A1A2E',
  darkDeep: '#0F0F0F',
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
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
