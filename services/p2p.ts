import { supabase } from '@/services/supabase';
import type { Coords } from '@/services/presence';

// ─── P2P cash delivery ──────────────────────────────────
// Every money movement happens inside Postgres functions (see section 9 of
// supabase/migration.sql). The app only calls those functions and reads rows
// it is allowed to see.

export const P2P_MIN_AMOUNT = 100;
export const P2P_MAX_AMOUNT = 50000;
export const P2P_CODE_LENGTH = 6;

export type P2POrderStatus = 'matched' | 'accepted' | 'completed' | 'cancelled';

export interface P2POrder {
  id: string;
  sender_id: string;
  partner_id: string | null;
  sender_name: string;
  partner_name: string;
  amount: number;
  currency: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  receiver_lat: number;
  receiver_lng: number;
  distance_km: number | null;
  status: P2POrderStatus;
  cancel_reason: string | null;
  failed_code_attempts: number;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  expires_at: string;
}

export interface P2PPartnerProfile {
  user_id: string;
  lat: number;
  lng: number;
  is_available: boolean;
  updated_at: string;
}

export interface CompleteResult {
  ok: boolean;
  reason?: 'wrong_code' | 'locked';
  attempts_left?: number;
}

export interface NewOrderInput {
  amount: number;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  lat: number;
  lng: number;
}

const ORDER_COLUMNS =
  'id, sender_id, partner_id, sender_name, partner_name, amount, currency, receiver_name, ' +
  'receiver_phone, receiver_address, receiver_lat, receiver_lng, distance_km, status, ' +
  'cancel_reason, failed_code_attempts, created_at, accepted_at, completed_at, cancelled_at, expires_at';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_SIGNED_IN: 'Please sign in again to continue.',
  KYC_REQUIRED: 'Verify your identity first. Open Account, then Identity Verification.',
  INVALID_AMOUNT: `Enter an amount between ₱${P2P_MIN_AMOUNT.toLocaleString()} and ₱${P2P_MAX_AMOUNT.toLocaleString()}.`,
  INVALID_RECEIVER: "Check the receiver's name, phone number and address.",
  NO_PARTNER_NEARBY:
    'No cash partner is available near that address yet. Nothing was taken from your wallet.',
  INSUFFICIENT_BALANCE: 'Your wallet balance is too low for this amount.',
  ORDER_NOT_AVAILABLE: 'This order has changed and that action is no longer available.',
  ORDER_IN_PROGRESS:
    'A partner has accepted this order, so it can no longer be cancelled. You can cancel if it is not delivered within 24 hours.',
};

/** Turns a database error into a sentence a user can act on. */
export function p2pErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? '';
  const code = Object.keys(ERROR_MESSAGES).find((key) => raw.includes(key));
  if (code) return ERROR_MESSAGES[code];
  if (raw.includes('p2p_') && (raw.includes('does not exist') || raw.includes('schema cache'))) {
    return 'P2P is not set up on the server yet. Run supabase/migration.sql and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

function toOrder(row: any): P2POrder {
  return {
    ...row,
    amount: Number(row.amount),
    distance_km: row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
  };
}

function single(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}

async function callOrderAction(fn: string, orderId: string): Promise<P2POrder> {
  const { data, error } = await supabase.rpc(fn, { p_order_id: orderId });
  if (error) throw error;
  return toOrder(single(data));
}

// ─── Orders ─────────────────────────────────────────────
export async function createP2POrder(input: NewOrderInput): Promise<P2POrder> {
  const { data, error } = await supabase.rpc('p2p_create_order', {
    p_amount: input.amount,
    p_receiver_name: input.receiverName,
    p_receiver_phone: input.receiverPhone,
    p_receiver_address: input.receiverAddress,
    p_lat: input.lat,
    p_lng: input.lng,
  });
  if (error) throw error;
  return toOrder(single(data));
}

export async function listP2POrders(
  userId: string,
): Promise<{ sent: P2POrder[]; assigned: P2POrder[] }> {
  const { data, error } = await supabase
    .from('p2p_orders')
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

/** Returns null when the order does not exist or is no longer visible to this user. */
export async function getP2POrder(orderId: string): Promise<P2POrder | null> {
  const { data, error } = await supabase
    .from('p2p_orders')
    .select(ORDER_COLUMNS)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data ? toOrder(data) : null;
}

/** Only the sender can read this; for anyone else it comes back null. */
export async function getReleaseCode(orderId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('p2p_order_codes')
    .select('code')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) return null;
  return data?.code ?? null;
}

export const acceptP2POrder = (id: string) => callOrderAction('p2p_accept_order', id);
export const declineP2POrder = (id: string) => callOrderAction('p2p_decline_order', id);
export const cancelP2POrder = (id: string) => callOrderAction('p2p_cancel_order', id);
export const releaseP2POrder = (id: string) => callOrderAction('p2p_release_order', id);

export async function completeP2POrder(orderId: string, code: string): Promise<CompleteResult> {
  const { data, error } = await supabase.rpc('p2p_complete_order', {
    p_order_id: orderId,
    p_code: code,
  });
  if (error) throw error;
  return (single(data) ?? { ok: false }) as CompleteResult;
}

/** Calls back whenever an order this user can see changes. Returns an unsubscribe function. */
export function subscribeToP2POrders(key: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`p2p-orders-${key}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'p2p_orders' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── Cash partner profile ───────────────────────────────
export async function getPartnerProfile(userId: string): Promise<P2PPartnerProfile | null> {
  const { data, error } = await supabase
    .from('p2p_partners')
    .select('user_id, lat, lng, is_available, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function savePartnerProfile(
  userId: string,
  coords: Coords,
  isAvailable: boolean,
): Promise<P2PPartnerProfile> {
  const { data, error } = await supabase
    .from('p2p_partners')
    .upsert(
      {
        user_id: userId,
        lat: coords.lat,
        lng: coords.lng,
        is_available: isAvailable,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('user_id, lat, lng, is_available, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function setPartnerAvailability(userId: string, isAvailable: boolean) {
  const { error } = await supabase
    .from('p2p_partners')
    .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

// ─── Display helpers ────────────────────────────────────
export function isOrderActive(order: P2POrder): boolean {
  return order.status === 'matched' || order.status === 'accepted';
}

export function orderStatusLabel(order: P2POrder, role: 'sender' | 'partner'): string {
  switch (order.status) {
    case 'matched':
      return role === 'sender' ? 'Waiting for partner' : 'New request';
    case 'accepted':
      return role === 'sender' ? 'Partner on the way' : 'Deliver cash';
    case 'completed':
      return 'Delivered';
    case 'cancelled':
      return order.cancel_reason === 'no_partner' ? 'No partner · refunded' : 'Cancelled · refunded';
  }
}

export function formatDistance(km: number | null): string {
  if (km === null) return '';
  return km < 1 ? 'under 1 km away' : `about ${Math.round(km)} km away`;
}
