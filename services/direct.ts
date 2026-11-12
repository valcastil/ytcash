import { BitcoinColors } from '@/constants/theme';
import { supabase } from '@/services/supabase';

// ─── Direct Pay ─────────────────────────────────────────
// The sender pays the partner from their own payment app (GCash, GoTyme, Maya, UPI,
// SPEI or Mercado Pago, depending on the country the cash is delivered in) after
// the cash has been handed over. No money passes through YTCash; the app finds
// the partner, carries the OTP and the chat, and records who confirmed what.
// Rules live in section 13 of supabase/migration.sql.

export type PayMethod = 'gcash' | 'gotyme' | 'maya' | 'upi' | 'spei' | 'mercadopago';
export const PAY_METHODS: PayMethod[] = ['gcash', 'gotyme', 'maya', 'upi', 'spei', 'mercadopago'];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  gcash: 'GCash',
  gotyme: 'GoTyme',
  maya: 'Maya',
  upi: 'UPI',
  spei: 'SPEI',
  mercadopago: 'Mercado Pago',
};

/** The cash handed over and the payment are in the currency of the payment app. */
export type DirectCurrency = 'PHP' | 'INR' | 'MXN';
export const METHOD_CURRENCY: Record<PayMethod, DirectCurrency> = {
  gcash: 'PHP',
  gotyme: 'PHP',
  maya: 'PHP',
  upi: 'INR',
  spei: 'MXN',
  mercadopago: 'MXN',
};

/** How each app identifies the account to pay. */
export const PAY_ACCOUNT_FIELD: Record<PayMethod, { placeholder: string; kind: 'number' | 'upi' }> = {
  gcash: { placeholder: '09XX XXX XXXX', kind: 'number' },
  gotyme: { placeholder: 'Account number', kind: 'number' },
  maya: { placeholder: '09XX XXX XXXX', kind: 'number' },
  upi: { placeholder: 'UPI ID, e.g. name@bank', kind: 'upi' },
  spei: { placeholder: '18-digit CLABE', kind: 'number' },
  mercadopago: { placeholder: 'Mobile number or CLABE', kind: 'number' },
};

/** Returns what is wrong with an account number, or null if it looks right. The server checks again. */
export function payoutAccountProblem(method: PayMethod, value: string): string | null {
  const digits = value.replace(/[^\d]/g, '');
  if (method === 'upi') {
    return /^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,63}$/i.test(value.trim()) ? null : 'Enter a UPI ID like name@bank.';
  }
  if (method === 'spei') return digits.length === 18 ? null : 'A CLABE has 18 digits.';
  if (method === 'mercadopago') return digits.length >= 10 && digits.length <= 18 ? null : 'Enter a mobile number or CLABE.';
  return digits.length >= 7 ? null : 'Enter the account or mobile number.';
}

export interface DirectRegion {
  currency: DirectCurrency;
  label: string;
  /** ISO country code used for the address search. */
  country: string;
  symbol: string;
  min: number;
  max: number;
  quickAmounts: number[];
  phonePlaceholder: string;
  addressPlaceholder: string;
  /** The payment apps partners in this country accept, for display. */
  apps: string;
}

/** Where cash can be delivered. Limits match the server (section 13 of the migration). */
export const DIRECT_REGIONS: DirectRegion[] = [
  {
    currency: 'PHP',
    label: 'Philippines',
    country: 'ph',
    symbol: '₱',
    min: 100,
    max: 50000,
    quickAmounts: [500, 1000, 2000, 5000],
    phonePlaceholder: '+63 9XX XXX XXXX',
    addressPlaceholder: 'Street, barangay, city, province',
    apps: 'GCash, GoTyme or Maya',
  },
  {
    currency: 'INR',
    label: 'India',
    country: 'in',
    symbol: '₹',
    min: 100,
    max: 50000,
    quickAmounts: [500, 1000, 2000, 5000],
    phonePlaceholder: '+91 XXXXX XXXXX',
    addressPlaceholder: 'Street, area, city, state',
    apps: 'UPI',
  },
  {
    currency: 'MXN',
    label: 'Mexico',
    country: 'mx',
    symbol: 'MX$',
    min: 50,
    max: 15000,
    quickAmounts: [200, 500, 1000, 2000],
    phonePlaceholder: '+52 XX XXXX XXXX',
    addressPlaceholder: 'Street, colonia, city, state',
    apps: 'SPEI or Mercado Pago',
  },
];

const CURRENCY_SYMBOL: Record<DirectCurrency, string> = { PHP: '₱', INR: '₹', MXN: 'MX$' };

export function formatDirectAmount(amount: number, currency: DirectCurrency = 'PHP'): string {
  const number = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${CURRENCY_SYMBOL[currency] ?? `${currency} `}${number}`;
}

export const DIRECT_CODE_LENGTH = 6;

export type DirectStatus =
  | 'requested'
  | 'accepted'
  | 'delivered'
  | 'paid'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'disputed'
  | 'unpaid';

export interface DirectOrder {
  id: string;
  sender_id: string;
  partner_id: string;
  sender_name: string;
  partner_name: string;
  amount: number;
  currency: DirectCurrency;
  method: PayMethod;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  receiver_lat: number;
  receiver_lng: number;
  distance_km: number | null;
  status: DirectStatus;
  payment_reference: string | null;
  resolution_note: string | null;
  failed_code_attempts: number;
  created_at: string;
  delivered_at: string | null;
  paid_at: string | null;
}

export interface NearbyPartner {
  partner_id: string;
  name: string;
  /** Rounded to about 1 km. */
  lat: number;
  lng: number;
  distance_km: number;
  methods: PayMethod[];
  completed_orders: number;
}

export interface PayoutAccount {
  method: PayMethod;
  account_name: string;
  account_number: string;
}

export interface DirectMessage {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface DirectOrderInput {
  partnerId: string;
  amount: number;
  method: PayMethod;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  lat: number;
  lng: number;
}

const ORDER_COLUMNS =
  'id, sender_id, partner_id, sender_name, partner_name, amount, currency, method, receiver_name, receiver_phone, ' +
  'receiver_address, receiver_lat, receiver_lng, distance_km, status, payment_reference, resolution_note, ' +
  'failed_code_attempts, created_at, delivered_at, paid_at';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_SIGNED_IN: 'Please sign in again to continue.',
  KYC_REQUIRED: 'Verify your identity first. Open Account, then Identity Verification.',
  BLOCKED_UNPAID: 'A partner reported that you have not paid for a delivery. Pay that one first to continue.',
  PAY_PREVIOUS_FIRST: 'You have a delivery waiting for payment. Pay the partner before starting another.',
  TOO_MANY_OPEN: 'You already have 3 open requests. Cancel one or wait for a partner to respond.',
  INVALID_AMOUNT: 'That amount is outside the allowed range for one delivery.',
  INVALID_RECEIVER: "Check the receiver's name, phone number and address.",
  PARTNER_NOT_AVAILABLE: 'That partner is no longer available. Choose another one.',
  METHOD_NOT_ACCEPTED: 'That partner does not accept this payment app. Choose another app or partner.',
  ORDER_NOT_AVAILABLE: 'This delivery has changed and that action is no longer available.',
  REFERENCE_REQUIRED: 'Enter the reference number from your payment app.',
  TOO_EARLY: 'Give the sender 30 minutes to pay before reporting.',
  INVALID_ACCOUNT: 'Check the account name and number.',
  INVALID_MESSAGE: 'Messages can be up to 500 characters.',
  TOO_MANY_MESSAGES: 'You are sending messages too quickly. Wait a moment.',
};

export function directErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? '';
  const code = Object.keys(ERROR_MESSAGES).find((key) => raw.includes(key));
  if (code) return ERROR_MESSAGES[code];
  if (raw.includes('direct_') && (raw.includes('does not exist') || raw.includes('schema cache'))) {
    return 'Direct Pay is not set up on the server yet. Run supabase/migration.sql and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

function toOrder(row: any): DirectOrder {
  return {
    ...row,
    amount: Number(row.amount),
    currency: row.currency === 'INR' || row.currency === 'MXN' ? row.currency : 'PHP',
    distance_km: row.distance_km == null ? null : Number(row.distance_km),
  };
}

function single(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}

async function orderAction(fn: string, args: Record<string, unknown>): Promise<DirectOrder> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return toOrder(single(data));
}

// ─── Finding a partner ──────────────────────────────────
/** Partners near a point who accept a payment app in the given currency. */
export async function findNearbyPartners(
  lat: number,
  lng: number,
  currency: DirectCurrency = 'PHP',
): Promise<NearbyPartner[]> {
  const { data, error } = await supabase.rpc('direct_find_partners', {
    p_lat: lat,
    p_lng: lng,
    p_currency: currency,
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    partner_id: row.partner_id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    distance_km: Number(row.distance_km),
    methods: (row.methods ?? []) as PayMethod[],
    completed_orders: Number(row.completed_orders ?? 0),
  }));
}

// ─── Orders ─────────────────────────────────────────────
export function createDirectOrder(input: DirectOrderInput): Promise<DirectOrder> {
  return orderAction('direct_create_order', {
    p_partner_id: input.partnerId,
    p_amount: input.amount,
    p_method: input.method,
    p_receiver_name: input.receiverName,
    p_receiver_phone: input.receiverPhone,
    p_receiver_address: input.receiverAddress,
    p_lat: input.lat,
    p_lng: input.lng,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listDirectOrders(userId: string): Promise<{ sent: DirectOrder[]; assigned: DirectOrder[] }> {
  if (!UUID_RE.test(userId)) return { sent: [], assigned: [] };
  const { data, error } = await supabase
    .from('direct_orders')
    .select(ORDER_COLUMNS)
    .or(`sender_id.eq.${userId},partner_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const orders = (data ?? []).map(toOrder);
  return {
    sent: orders.filter((o) => o.sender_id === userId),
    assigned: orders.filter((o) => o.partner_id === userId),
  };
}

export async function getDirectOrder(orderId: string): Promise<DirectOrder | null> {
  const { data, error } = await supabase.from('direct_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
  if (error) throw error;
  return data ? toOrder(data) : null;
}

/** The OTP. Only the sender gets a value; for anyone else this is null. */
export async function getDirectCode(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.from('direct_order_codes').select('code').eq('order_id', orderId).maybeSingle();
  return error ? null : data?.code ?? null;
}

/** The account to pay. The sender only gets it once the cash has been handed over. */
export async function getPaymentDetails(orderId: string): Promise<{ account_name: string; account_number: string } | null> {
  const { data, error } = await supabase
    .from('direct_order_payment')
    .select('account_name, account_number')
    .eq('order_id', orderId)
    .maybeSingle();
  return error ? null : data ?? null;
}

export const acceptDirectOrder = (id: string) => orderAction('direct_accept_order', { p_order_id: id });
export const declineDirectOrder = (id: string) => orderAction('direct_decline_order', { p_order_id: id });
export const cancelDirectOrder = (id: string) => orderAction('direct_cancel_order', { p_order_id: id });
export const confirmDirectPayment = (id: string) => orderAction('direct_confirm_payment', { p_order_id: id });
export const reportDirectUnpaid = (id: string) => orderAction('direct_report_unpaid', { p_order_id: id });
export const markDirectPaid = (id: string, reference: string) =>
  orderAction('direct_mark_paid', { p_order_id: id, p_reference: reference.trim() });

export interface DeliveryResult {
  ok: boolean;
  reason?: 'wrong_code' | 'locked';
  attempts_left?: number;
}

export async function confirmDirectDelivery(orderId: string, code: string): Promise<DeliveryResult> {
  const { data, error } = await supabase.rpc('direct_confirm_delivery', { p_order_id: orderId, p_code: code });
  if (error) throw error;
  return (single(data) ?? { ok: false }) as DeliveryResult;
}

// ─── Chat ───────────────────────────────────────────────
export async function listDirectMessages(orderId: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('direct_order_messages')
    .select('id, author_id, body, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as DirectMessage[]).reverse();
}

export async function sendDirectMessage(orderId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('direct_send_message', { p_order_id: orderId, p_body: body });
  if (error) throw error;
}

/** Calls back when an order or its chat changes. Returns an unsubscribe function. */
export function subscribeToDirect(key: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`direct-${key}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_orders' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_order_messages' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── Partner payout accounts ────────────────────────────
export async function listPayoutAccounts(userId: string): Promise<PayoutAccount[]> {
  if (!UUID_RE.test(userId)) return [];
  const { data, error } = await supabase
    .from('partner_payout_accounts')
    .select('method, account_name, account_number')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as PayoutAccount[];
}

export async function savePayoutAccount(method: PayMethod, accountName: string, accountNumber: string) {
  const { error } = await supabase.rpc('partner_set_payout_account', {
    p_method: method,
    p_account_name: accountName,
    p_account_number: accountNumber,
  });
  if (error) throw error;
}

export async function removePayoutAccount(method: PayMethod) {
  const { error } = await supabase.rpc('partner_remove_payout_account', { p_method: method });
  if (error) throw error;
}

// ─── Display helpers ────────────────────────────────────
export function isDirectOpen(order: DirectOrder): boolean {
  return !['completed', 'declined', 'cancelled'].includes(order.status);
}

export function directStatusLabel(order: DirectOrder, role: 'sender' | 'partner'): string {
  switch (order.status) {
    case 'requested':
      return role === 'sender' ? 'Waiting for partner' : 'New request';
    case 'accepted':
      return role === 'sender' ? 'Partner delivering' : 'Deliver cash';
    case 'delivered':
      return role === 'sender' ? 'Pay the partner now' : 'Waiting for payment';
    case 'paid':
      return role === 'sender' ? 'Waiting for partner to confirm' : 'Check your payment';
    case 'completed':
      return 'Completed';
    case 'declined':
      return 'Declined by partner';
    case 'cancelled':
      return 'Cancelled';
    case 'disputed':
      return 'Reported as not paid';
    case 'unpaid':
      return 'Unpaid';
  }
}

export function formatKm(km: number | null): string {
  if (km === null) return '';
  return km < 1 ? 'under 1 km' : `about ${Math.round(km)} km`;
}

export function directStatusColor(order: DirectOrder): string {
  switch (order.status) {
    case 'requested':
      return BitcoinColors.orange;
    case 'accepted':
      return BitcoinColors.cyan;
    case 'delivered':
    case 'paid':
      return BitcoinColors.gold;
    case 'completed':
      return BitcoinColors.green;
    case 'disputed':
    case 'unpaid':
      return BitcoinColors.red;
    default:
      return BitcoinColors.textMuted;
  }
}
