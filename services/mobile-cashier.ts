import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/services/supabase';
import { distanceKm } from '@/services/p2p';

export type CashierPayMethod = 'gcash' | 'maya' | 'gotyme' | 'bank_transfer';

export const CASHIER_PAY_METHODS: {
  id: CashierPayMethod;
  label: string;
  placeholder: string;
  needsBankName?: boolean;
}[] = [
  { id: 'gcash', label: 'GCash', placeholder: '09XX XXX XXXX' },
  { id: 'maya', label: 'Maya', placeholder: '09XX XXX XXXX' },
  { id: 'gotyme', label: 'GoTyme', placeholder: 'GoTyme Account / Mobile #' },
  {
    id: 'bank_transfer',
    label: 'Bank Transfer',
    placeholder: 'Bank Account Number',
    needsBankName: true,
  },
];

export function cashierMethodLabel(method: CashierPayMethod): string {
  return CASHIER_PAY_METHODS.find((m) => m.id === method)?.label ?? method;
}

export interface CashierPaymentAccount {
  method: CashierPayMethod;
  account_name: string;
  account_number: string;
  bank_name?: string;
}

export interface MobileCashierProfile {
  user_id: string;
  display_name: string;
  lat: number;
  lng: number;
  is_available: boolean;
  accepted_methods: CashierPayMethod[];
  payment_accounts: CashierPaymentAccount[];
  updated_at: string;
}

export type CashRequestStatus =
  | 'requested'
  | 'on_the_way'
  | 'funds_sent'
  | 'funds_confirmed'
  | 'completed'
  | 'cancelled';

export interface CashDeliveryRequest {
  id: string;
  requester_id: string;
  requester_name: string;
  cashier_id: string;
  cashier_name: string;
  amount: number;
  currency: string;
  payment_method: CashierPayMethod;
  cashier_account_name: string;
  cashier_account_number: string;
  cashier_bank_name: string | null;
  location_label: string;
  lat: number;
  lng: number;
  notes: string;
  transfer_reference: string | null;
  status: CashRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface CashRequestMessage {
  id: string;
  request_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

const CASHIERS_KEY = 'ytcash_mobile_cashiers_v1';
const REQUESTS_KEY = 'ytcash_cash_requests_v1';
const MESSAGES_KEY = 'ytcash_cash_request_messages_v1';

function isMissingTableError(err: unknown): boolean {
  const msg = ((err as { message?: string; code?: string })?.message ?? '').toLowerCase();
  const code = (err as { code?: string })?.code ?? '';
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  );
}

function makeUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function readLocalCashiers(): Promise<MobileCashierProfile[]> {
  const raw = await AsyncStorage.getItem(CASHIERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MobileCashierProfile[];
  } catch {
    return [];
  }
}

async function writeLocalCashiers(list: MobileCashierProfile[]): Promise<void> {
  await AsyncStorage.setItem(CASHIERS_KEY, JSON.stringify(list));
}

async function readLocalRequests(): Promise<CashDeliveryRequest[]> {
  const raw = await AsyncStorage.getItem(REQUESTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CashDeliveryRequest[];
  } catch {
    return [];
  }
}

async function writeLocalRequests(list: CashDeliveryRequest[]): Promise<void> {
  await AsyncStorage.setItem(REQUESTS_KEY, JSON.stringify(list));
}

async function readLocalMessages(requestId: string): Promise<CashRequestMessage[]> {
  const raw = await AsyncStorage.getItem(MESSAGES_KEY);
  if (!raw) return [];
  try {
    const all = JSON.parse(raw) as CashRequestMessage[];
    return all.filter((m) => m.request_id === requestId);
  } catch {
    return [];
  }
}

async function appendLocalMessage(msg: CashRequestMessage): Promise<void> {
  const raw = await AsyncStorage.getItem(MESSAGES_KEY);
  let all: CashRequestMessage[] = [];
  if (raw) {
    try {
      all = JSON.parse(raw) as CashRequestMessage[];
    } catch {
      all = [];
    }
  }
  all.push(msg);
  await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(all));
}

export async function getMyCashierProfile(userId: string): Promise<MobileCashierProfile | null> {
  try {
    const { data, error } = await supabase
      .from('p2p_mobile_cashiers')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return (data as MobileCashierProfile | null) ?? null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalCashiers();
    return all.find((c) => c.user_id === userId) ?? null;
  }
}

export async function saveMyCashierProfile(input: {
  userId: string;
  displayName: string;
  lat: number;
  lng: number;
  isAvailable: boolean;
  acceptedMethods: CashierPayMethod[];
  paymentAccounts: CashierPaymentAccount[];
}): Promise<MobileCashierProfile> {
  const payload: MobileCashierProfile = {
    user_id: input.userId,
    display_name: input.displayName,
    lat: input.lat,
    lng: input.lng,
    is_available: input.isAvailable,
    accepted_methods: input.acceptedMethods,
    payment_accounts: input.paymentAccounts,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('p2p_mobile_cashiers')
      .upsert(payload, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data as MobileCashierProfile;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalCashiers();
    const filtered = all.filter((c) => c.user_id !== input.userId);
    await writeLocalCashiers([payload, ...filtered]);
    return payload;
  }
}

export async function listCashiersWithPaymentsNear(
  lat: number,
  lng: number,
  radiusKm: number = 30,
): Promise<(MobileCashierProfile & { km: number })[]> {
  try {
    const { data, error } = await supabase
      .from('p2p_mobile_cashiers')
      .select('*')
      .eq('is_available', true);
    if (error) throw error;
    return ((data ?? []) as MobileCashierProfile[])
      .map((c) => ({ ...c, km: distanceKm(lat, lng, c.lat, c.lng) }))
      .filter((c) => c.km <= radiusKm)
      .sort((a, b) => a.km - b.km);
  } catch (err) {
    if (!isMissingTableError(err)) return [];
    const all = await readLocalCashiers();
    return all
      .filter((c) => c.is_available)
      .map((c) => ({ ...c, km: distanceKm(lat, lng, c.lat, c.lng) }))
      .filter((c) => c.km <= radiusKm)
      .sort((a, b) => a.km - b.km);
  }
}

export async function createCashDeliveryRequest(input: {
  requesterId: string;
  requesterName: string;
  cashier: MobileCashierProfile;
  amount: number;
  currency?: string;
  paymentMethod: CashierPayMethod;
  locationLabel: string;
  lat: number;
  lng: number;
  notes?: string;
}): Promise<CashDeliveryRequest> {
  const acct = input.cashier.payment_accounts.find((a) => a.method === input.paymentMethod);
  const payload = {
    requester_id: input.requesterId,
    requester_name: input.requesterName,
    cashier_id: input.cashier.user_id,
    cashier_name: input.cashier.display_name,
    amount: input.amount,
    currency: input.currency ?? 'PHP',
    payment_method: input.paymentMethod,
    cashier_account_name: acct?.account_name || input.cashier.display_name,
    cashier_account_number: acct?.account_number || 'Share in chat',
    cashier_bank_name: acct?.bank_name ?? null,
    location_label: input.locationLabel.trim(),
    lat: input.lat,
    lng: input.lng,
    notes: (input.notes ?? '').trim(),
    transfer_reference: null,
    status: 'requested' as CashRequestStatus,
  };

  try {
    const { data, error } = await supabase
      .from('p2p_cash_requests')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return { ...data, amount: Number(data.amount) } as CashDeliveryRequest;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const now = new Date().toISOString();
    const req: CashDeliveryRequest = {
      ...payload,
      id: makeUuid(),
      created_at: now,
      updated_at: now,
    };
    const all = await readLocalRequests();
    await writeLocalRequests([req, ...all]);
    return req;
  }
}

export async function listMyCashRequests(userId: string): Promise<CashDeliveryRequest[]> {
  try {
    const { data, error } = await supabase
      .from('p2p_cash_requests')
      .select('*')
      .or(`requester_id.eq.${userId},cashier_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })) as CashDeliveryRequest[];
  } catch (err) {
    if (!isMissingTableError(err)) return [];
    const all = await readLocalRequests();
    return all.filter((r) => r.requester_id === userId || r.cashier_id === userId);
  }
}

export async function getCashRequest(id: string): Promise<CashDeliveryRequest | null> {
  try {
    const { data, error } = await supabase
      .from('p2p_cash_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? ({ ...data, amount: Number(data.amount) } as CashDeliveryRequest) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalRequests();
    return all.find((r) => r.id === id) ?? null;
  }
}

async function updateCashRequest(
  id: string,
  updates: Partial<CashDeliveryRequest>,
): Promise<CashDeliveryRequest | null> {
  const patch = { ...updates, updated_at: new Date().toISOString() };
  try {
    const { data, error } = await supabase
      .from('p2p_cash_requests')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? ({ ...data, amount: Number(data.amount) } as CashDeliveryRequest) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalRequests();
    let updated: CashDeliveryRequest | null = null;
    const next = all.map((r) => {
      if (r.id !== id) return r;
      updated = { ...r, ...patch };
      return updated;
    });
    await writeLocalRequests(next);
    return updated;
  }
}

export const acceptCashRequest = (id: string) =>
  updateCashRequest(id, { status: 'on_the_way' });

export const markFundsTransferred = (id: string, reference: string) =>
  updateCashRequest(id, { status: 'funds_sent', transfer_reference: reference.trim() });

export const confirmFundsReceived = (id: string) =>
  updateCashRequest(id, { status: 'funds_confirmed' });

export const completeCashHandover = (id: string) =>
  updateCashRequest(id, { status: 'completed' });

export const cancelCashRequest = (id: string) =>
  updateCashRequest(id, { status: 'cancelled' });

export async function listCashRequestMessages(requestId: string): Promise<CashRequestMessage[]> {
  try {
    const { data, error } = await supabase
      .from('p2p_cash_request_messages')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as CashRequestMessage[];
  } catch (err) {
    if (!isMissingTableError(err)) return [];
    return readLocalMessages(requestId);
  }
}

export async function sendCashRequestMessage(
  requestId: string,
  senderId: string,
  senderName: string,
  body: string,
): Promise<CashRequestMessage> {
  const trimmed = body.trim();
  try {
    const { data, error } = await supabase
      .from('p2p_cash_request_messages')
      .insert({ request_id: requestId, sender_id: senderId, sender_name: senderName, body: trimmed })
      .select('*')
      .single();
    if (error) throw error;
    return data as CashRequestMessage;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const msg: CashRequestMessage = {
      id: makeUuid(),
      request_id: requestId,
      sender_id: senderId,
      sender_name: senderName,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    await appendLocalMessage(msg);
    return msg;
  }
}

export function cashRequestStatusLabel(status: CashRequestStatus): string {
  switch (status) {
    case 'requested':
      return 'Waiting for Cashier';
    case 'on_the_way':
      return 'Cashier Heading to Location';
    case 'funds_sent':
      return 'Funds Transferred · Verifying';
    case 'funds_confirmed':
      return 'Funds Confirmed · Handing Cash';
    case 'completed':
      return 'Cash Handed Over';
    case 'cancelled':
      return 'Cancelled';
  }
}
