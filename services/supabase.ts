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
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('getProfile error:', error.message);
    return null;
  }
  return data;
}

export async function upsertProfile(profile: Partial<UserProfile> & { id: string }) {
  const { data, error } = await supabase
    .from('users')
    .upsert(profile, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBalance(userId: string, delta: number) {
  const { data, error } = await supabase.rpc('update_balance', {
    user_id: userId,
    delta,
  });
  if (error) throw error;
  return data;
}

// ─── Transaction helpers ────────────────────────────────
export async function createTransaction(tx: Omit<Transaction, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('transactions')
    .insert(tx)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTransactions(userId: string, limit = 20) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .or(`from_user.eq.${userId},to_user.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── Cash scanning helpers ──────────────────────────────
export async function recordScannedCash(scan: Omit<ScannedCash, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('scanned_cash')
    .insert(scan)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function checkDuplicateSerial(serial: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('scanned_cash')
    .select('id', { count: 'exact', head: true })
    .eq('serial_number', serial);
  if (error) throw error;
  return (count ?? 0) > 0;
}
