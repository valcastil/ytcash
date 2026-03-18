import { DEFAULT_CURRENCY } from '@/constants/currencies';

const API_BASE = 'https://v6.exchangerate-api.com/v6';
const API_KEY = process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY ?? 'demo';

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  lastUpdated: string;
}

let cachedRates: ExchangeRates | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export async function fetchExchangeRates(base: string = 'PHP'): Promise<ExchangeRates> {
  const now = Date.now();
  if (cachedRates && cachedRates.base === base && now - cacheTimestamp < CACHE_DURATION) {
    return cachedRates;
  }

  try {
    const response = await fetch(`${API_BASE}/${API_KEY}/latest/${base}`);
    const json = await response.json();

    if (json.result === 'success') {
      cachedRates = {
        base: json.base_code,
        rates: json.conversion_rates,
        lastUpdated: json.time_last_update_utc,
      };
      cacheTimestamp = now;
      return cachedRates;
    }
    throw new Error(json['error-type'] ?? 'Exchange rate fetch failed');
  } catch (error) {
    // Fallback rates if API fails
    console.warn('Using fallback exchange rates:', error);
    return {
      base: 'PHP',
      rates: {
        PHP: 1,
        USD: 0.0178,
        EUR: 0.0163,
        AED: 0.0654,
      },
      lastUpdated: new Date().toISOString(),
    };
  }
}

export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string = DEFAULT_CURRENCY,
): Promise<{ converted: number; rate: number }> {
  const rates = await fetchExchangeRates(fromCurrency);
  const rate = rates.rates[toCurrency] ?? 1;
  return {
    converted: amount * rate,
    rate,
  };
}

export async function getPhpEquivalent(
  amount: number,
  fromCurrency: string,
): Promise<{ phpAmount: number; rate: number }> {
  if (fromCurrency === 'PHP') {
    return { phpAmount: amount, rate: 1 };
  }
  const { converted, rate } = await convertCurrency(amount, fromCurrency, 'PHP');
  return { phpAmount: converted, rate };
}
