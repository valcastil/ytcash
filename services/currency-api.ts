import { DEFAULT_CURRENCY } from '@/constants/currencies';

// Open ExchangeRate API endpoint (no API key required)
const OPEN_API_URL = 'https://open.er-api.com/v6/latest';
const API_KEY = process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY;

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

  const hasValidCustomKey =
    Boolean(API_KEY) &&
    API_KEY !== 'demo' &&
    API_KEY !== 'your-exchangerate-api-key' &&
    !API_KEY!.includes('your-');

  // Try custom key if configured, otherwise use the open public endpoint directly
  const primaryUrl = hasValidCustomKey
    ? `https://v6.exchangerate-api.com/v6/${API_KEY}/latest/${base}`
    : `${OPEN_API_URL}/${base}`;

  try {
    let response = await fetch(primaryUrl);
    let json = await response.json();

    // If custom key had an issue (e.g. inactive-account or quota exceeded), fall back to the open public endpoint
    if (json.result !== 'success' && hasValidCustomKey) {
      response = await fetch(`${OPEN_API_URL}/${base}`);
      json = await response.json();
    }

    if (json.result === 'success') {
      const rates = json.conversion_rates ?? json.rates ?? {};
      cachedRates = {
        base: json.base_code ?? base,
        rates,
        lastUpdated: json.time_last_update_utc ?? new Date().toISOString(),
      };
      cacheTimestamp = now;
      return cachedRates;
    }
  } catch {
    // If primary failed due to network, try open endpoint once
    try {
      const fallbackRes = await fetch(`${OPEN_API_URL}/${base}`);
      const fallbackJson = await fallbackRes.json();
      if (fallbackJson.result === 'success') {
        const rates = fallbackJson.conversion_rates ?? fallbackJson.rates ?? {};
        cachedRates = {
          base: fallbackJson.base_code ?? base,
          rates,
          lastUpdated: fallbackJson.time_last_update_utc ?? new Date().toISOString(),
        };
        cacheTimestamp = now;
        return cachedRates;
      }
    } catch {
      // Both attempts failed (e.g. offline device)
    }
  }

  // Offline fallback rates when no internet connection is available
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
