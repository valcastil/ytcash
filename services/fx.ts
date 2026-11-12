import { supabase } from '@/services/supabase';

// ─── Foreign-currency quotes ────────────────────────────
// The rate and fee are worked out and held on the server (section 12 of
// supabase/migration.sql). The app only asks for a quote and shows it.

export type QuoteCurrency = 'AED' | 'USD' | 'EUR';
export type QuoteSide = 'pay' | 'receive';

export interface FxQuote {
  id: string;
  from_currency: QuoteCurrency;
  /** PHP per 1 unit of from_currency, after our margin. */
  rate: number;
  /** In from_currency. pay_amount = send_amount + fee_amount. */
  send_amount: number;
  fee_amount: number;
  pay_amount: number;
  /** PHP the receiver gets. */
  receive_amount: number;
  rate_as_of: string;
  expires_at: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  NOT_SIGNED_IN: 'Please sign in again to continue.',
  CURRENCY_NOT_SUPPORTED: 'That currency is not supported yet.',
  RATE_UNAVAILABLE: 'Exchange rates are not available right now. Please try again later.',
  INVALID_AMOUNT: 'Enter an amount greater than zero.',
  AMOUNT_OUT_OF_RANGE: 'The receiver can get between ₱100 and ₱50,000 per delivery.',
  TOO_MANY_QUOTES: 'Too many quotes in a short time. Wait a few minutes and try again.',
};

export function fxErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? '';
  const code = Object.keys(ERROR_MESSAGES).find((key) => raw.includes(key));
  if (code) return ERROR_MESSAGES[code];
  if (raw.includes('fx_') && (raw.includes('does not exist') || raw.includes('schema cache'))) {
    return 'Quotes are not set up on the server yet. Run supabase/migration.sql and try again.';
  }
  return raw || 'Could not get a quote. Please try again.';
}

let lastRefresh = 0;

/** Asks the server to refresh market rates. Best effort: quotes still work on the stored rates. */
async function refreshRates(): Promise<void> {
  if (Date.now() - lastRefresh < 5 * 60 * 1000) return;
  lastRefresh = Date.now();
  await supabase.functions.invoke('fx-rates', { body: {} }).catch(() => null);
}

export async function requestQuote(currency: QuoteCurrency, side: QuoteSide, amount: number): Promise<FxQuote> {
  await refreshRates();
  const { data, error } = await supabase.rpc('fx_request_quote', {
    p_from_currency: currency,
    p_side: side,
    p_amount: amount,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ...row,
    rate: Number(row.rate),
    send_amount: Number(row.send_amount),
    fee_amount: Number(row.fee_amount),
    pay_amount: Number(row.pay_amount),
    receive_amount: Number(row.receive_amount),
  };
}

export function quoteSecondsLeft(quote: FxQuote, now: number = Date.now()): number {
  return Math.max(0, Math.floor((new Date(quote.expires_at).getTime() - now) / 1000));
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatRate(quote: Pick<FxQuote, 'from_currency' | 'rate'>): string {
  return `1 ${quote.from_currency} = ₱${quote.rate.toFixed(4)}`;
}
