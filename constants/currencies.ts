export interface CurrencyInfo {
  name: string;
  symbol: string;
  code: string;
  flag: string;
  denominations: number[];
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  PHP: {
    name: 'Philippine Peso',
    symbol: '₱',
    code: 'PHP',
    flag: '\u{1F1F5}\u{1F1ED}',
    denominations: [20, 50, 100, 200, 500, 1000],
  },
  BTC: {
    name: 'Bitcoin',
    symbol: '₿',
    code: 'BTC',
    flag: '₿',
    denominations: [0.0001, 0.001, 0.01, 0.1, 1],
  },
  SATS: {
    name: 'Satoshis',
    symbol: 'sats',
    code: 'SATS',
    flag: '⚡',
    denominations: [1000, 5000, 10000, 50000, 100000],
  },
  USD: {
    name: 'US Dollar',
    symbol: '$',
    code: 'USD',
    flag: '\u{1F1FA}\u{1F1F8}',
    denominations: [1, 5, 10, 20, 50, 100],
  },
  EUR: {
    name: 'Euro',
    symbol: '€',
    code: 'EUR',
    flag: '\u{1F1EA}\u{1F1FA}',
    denominations: [5, 10, 20, 50, 100, 200, 500],
  },
  AED: {
    name: 'UAE Dirham',
    symbol: 'د.إ',
    code: 'AED',
    flag: '\u{1F1E6}\u{1F1EA}',
    denominations: [5, 10, 20, 50, 100, 200, 500, 1000],
  },
};

export const DEFAULT_CURRENCY = 'PHP';

// Benchmark reference rate: 1 BTC ~ 5,450,000 PHP (approx $95k USD)
export const APPROX_PHP_PER_BTC = 5450000;
export const SATS_PER_BTC = 100000000;

export function phpToBtc(phpAmount: number): number {
  if (!phpAmount || phpAmount <= 0) return 0;
  return phpAmount / APPROX_PHP_PER_BTC;
}

export function phpToSats(phpAmount: number): number {
  if (!phpAmount || phpAmount <= 0) return 0;
  return Math.round((phpAmount / APPROX_PHP_PER_BTC) * SATS_PER_BTC);
}

export function formatCurrency(amount: number, code: string = 'PHP'): string {
  if (code === 'BTC') {
    return `₿${amount.toFixed(6)}`;
  }
  if (code === 'SATS') {
    return `${Math.round(amount).toLocaleString()} sats`;
  }
  const currency = CURRENCIES[code];
  if (!currency) return `${amount.toFixed(2)}`;
  return `${currency.symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
