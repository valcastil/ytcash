import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE: an OAuth redirect carries a one-time code that only this device can
    // redeem (it holds the matching verifier). Tokens never travel in a URL, so a
    // crafted ytcash:// link cannot sign the user into someone else's account.
    flowType: 'pkce',
  },
});

// ─── Types ──────────────────────────────────────────────
export interface UserProfile {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  balance: number;
  kyc_verified: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  from_user: string | null;
  to_user: string | null;
  amount: number;
  currency: string;
  converted_amount: number;
  converted_currency: string;
  type: 'send' | 'receive' | 'scan' | 'add' | 'withdraw';
  status: 'pending' | 'completed' | 'failed';
  note: string | null;
  created_at: string;
}

export interface ScannedCash {
  id: string;
  user_id: string;
  currency: string;
  denomination: number;
  serial_number: string | null;
  php_equivalent: number;
  exchange_rate: number;
  created_at: string;
}

// ─── User helpers ───────────────────────────────────────
export async function getProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) {
      if (error.code !== 'PGRST205' && error.code !== 'PGRST116') {
        console.warn('getProfile error:', error.message);
      }
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Makes sure the signed-in user has a profile row. The server fills it in from
 * the auth record, so the app never supplies balance, email or phone.
 */
export async function ensureProfile(): Promise<UserProfile | null> {
  const { data, error } = await supabase.rpc('ensure_profile');
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

// ─── Wallet actions ─────────────────────────────────────
// Balances and the ledger are read-only to the app. Every change goes through
// a database function that acts on the signed-in user only (see section 10 of
// supabase/migration.sql).

const WALLET_ERRORS: Record<string, string> = {
  NOT_SIGNED_IN: 'Please sign in again to continue.',
  PROFILE_MISSING: 'Your wallet is not set up yet. Sign out and back in, then try again.',
  INVALID_AMOUNT: 'That amount is not allowed. Enter a smaller amount and try again.',
  INVALID_RECIPIENT: 'That recipient cannot receive this payment.',
  INSUFFICIENT_BALANCE: 'You do not have enough balance for this.',
  DEPOSITS_DISABLED: 'Deposits are not available right now.',
  DAILY_LIMIT_REACHED: 'You have reached today\'s limit. Try again tomorrow.',
  INVALID_SCAN: 'Those banknotes could not be verified. Scan them again.',
  RATE_OUT_OF_RANGE: 'The exchange rate could not be confirmed. Check your connection and scan again.',
};

/** Turns a wallet function error into a sentence a user can act on. */
export function walletErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? '';
  const code = Object.keys(WALLET_ERRORS).find((key) => raw.includes(key));
  if (code) return WALLET_ERRORS[code];
  if (raw.includes('wallet_') && (raw.includes('does not exist') || raw.includes('schema cache'))) {
    return 'The wallet is not set up on the server yet. Run supabase/migration.sql and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

function firstRow<T>(data: T | T[] | null): T | null {
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

export interface Recipient {
  id: string;
  full_name: string | null;
}

/** Finds another user by their exact email or phone number. */
export async function findRecipient(identifier: string): Promise<Recipient | null> {
  const { data, error } = await supabase.rpc('wallet_find_recipient', {
    p_identifier: identifier.trim(),
  });
  if (error) throw error;
  return firstRow<Recipient>(data);
}

/** Sends money from the signed-in user's wallet. Debit and credit happen together or not at all. */
export async function sendMoney(toUserId: string, amount: number, note?: string | null) {
  const { data, error } = await supabase.rpc('wallet_send', {
    p_to: toUserId,
    p_amount: amount,
    p_note: note ?? null,
  });
  if (error) throw error;
  return firstRow<Transaction>(data);
}

/** Adds funds to the signed-in user's wallet (simulated deposit; limits are enforced server-side). */
export async function depositFunds(amount: number, method: 'card' | 'lightning') {
  const { data, error } = await supabase.rpc('wallet_deposit', {
    p_amount: amount,
    p_method: method,
  });
  if (error) throw error;
  return firstRow<Transaction>(data);
}

export interface ScannedNoteInput {
  currency: string;
  denomination: number;
  /** PHP per one unit of the note's currency. */
  rate: number;
}

/**
 * Credits scanned banknotes. The server checks each note and works out the PHP
 * total itself; the returned transaction holds the amount actually credited.
 */
export async function addScannedCash(notes: ScannedNoteInput[]) {
  const { data, error } = await supabase.rpc('wallet_add_scanned_cash', { p_notes: notes });
  if (error) throw error;
  return firstRow<Transaction>(data);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Transaction helpers ────────────────────────────────
export async function getTransactions(userId: string, limit = 20) {
  if (!UUID_RE.test(userId)) return [];
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .or(`from_user.eq.${userId},to_user.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn('getTransactions error:', error.message);
      }
      return [];
    }
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Cash scanning helpers ──────────────────────────────
export async function checkDuplicateSerial(serial: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('scanned_cash')
    .select('id', { count: 'exact', head: true })
    .eq('serial_number', serial);
  if (error) throw error;
  return (count ?? 0) > 0;
}
