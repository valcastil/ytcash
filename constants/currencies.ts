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
    symbol: '\u20B1',
    code: 'PHP',
    flag: '\u{1F1F5}\u{1F1ED}',
    denominations: [20, 50, 100, 200, 500, 1000],
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
    symbol: '\u20AC',
    code: 'EUR',
    flag: '\u{1F1EA}\u{1F1FA}',
    denominations: [5, 10, 20, 50, 100, 200, 500],
  },
  AED: {
    name: 'UAE Dirham',
    symbol: '\u062F.\u0625',
    code: 'AED',
    flag: '\u{1F1E6}\u{1F1EA}',
    denominations: [5, 10, 20, 50, 100, 200, 500, 1000],
  },
};

export const DEFAULT_CURRENCY = 'PHP';

export function formatCurrency(amount: number, code: string = 'PHP'): string {
  const currency = CURRENCIES[code];
  if (!currency) return `${amount.toFixed(2)}`;
  return `${currency.symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
