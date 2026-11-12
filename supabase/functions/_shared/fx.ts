// Keeps the market exchange rates used for quotes up to date.
// The app calls this before asking for a quote; it does nothing if the rates
// were refreshed recently, so it is cheap to call often.

import type { FetchLike } from './didit.ts';

export const RATES_URL = 'https://open.er-api.com/v6/latest/PHP';
export const QUOTE_CURRENCIES = ['AED', 'USD', 'EUR'];
/** Rates newer than this are left alone. */
export const REFRESH_AFTER_SECONDS = 600;

export interface FxDb {
  /** Seconds since the oldest quote currency was refreshed, or null if unknown. */
  ratesAgeSeconds(): Promise<number | null>;
  /** Stores a rate (PHP per 1 unit). Returns false when the database refuses it. */
  setRate(currency: string, phpPerUnit: number): Promise<boolean>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export function createFxRatesHandler(db: FxDb, fetchFn: FetchLike) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

    const age = await db.ratesAgeSeconds();
    if (age !== null && age < REFRESH_AFTER_SECONDS) return json({ refreshed: false, reason: 'fresh' });

    let rates: Record<string, unknown> | null = null;
    try {
      const response = await fetchFn(RATES_URL, { signal: AbortSignal.timeout(10_000) });
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (body?.result === 'success' && body.rates && typeof body.rates === 'object') rates = body.rates;
    } catch {
      rates = null;
    }
    // Quotes keep working on the last stored rates until those are too old.
    if (!rates) return json({ refreshed: false, reason: 'source_unavailable' });

    const updated: string[] = [];
    for (const currency of QUOTE_CURRENCIES) {
      // The feed gives units of currency per 1 PHP; quotes need PHP per 1 unit.
      const perPhp = Number(rates[currency]);
      if (!Number.isFinite(perPhp) || perPhp <= 0) continue;
      if (await db.setRate(currency, 1 / perPhp)) updated.push(currency);
    }
    return json({ refreshed: updated.length > 0, updated });
  };
}
