import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/services/supabase';

export type ExchangeSide = 'sell' | 'buy';
export type OfferStatus = 'active' | 'paused' | 'closed';
export type TradeStatus = 'proposed' | 'agreed' | 'completed' | 'cancelled';

export interface ExchangeCurrency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

export const EXCHANGE_CURRENCIES: ExchangeCurrency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '\u{1F1EA}\u{1F1FA}' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', flag: '\u{1F1E6}\u{1F1EA}' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '\u{1F1F8}\u{1F1EC}' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '\u{1F1EF}\u{1F1F5}' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', flag: '\u{1F1F5}\u{1F1ED}' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '\u{1F1EE}\u{1F1F3}' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', flag: '\u{1F1F2}\u{1F1FD}' },
];

export const OFFER_CURRENCY_CODES = ['USD', 'EUR', 'AED', 'GBP', 'SGD', 'JPY'];
export const LOCAL_CURRENCY_CODES = ['PHP', 'AED', 'INR', 'MXN', 'USD', 'EUR'];

export const PUBLIC_MEETUP_SUGGESTIONS = [
  'Shopping Mall Main Atrium',
  'Coffee Shop inside Mall',
  'Bank Branch Lobby',
  'Airport Arrivals Hall',
  'City Center Plaza',
];

export function getExchangeCurrency(code: string): ExchangeCurrency {
  return (
    EXCHANGE_CURRENCIES.find((c) => c.code === code) ?? {
      code,
      name: code,
      symbol: `${code} `,
      flag: '💱',
    }
  );
}

export function formatExchangeMoney(amount: number, code: string): string {
  const info = getExchangeCurrency(code);
  const decimals = code === 'JPY' ? 0 : 2;
  return `${info.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export interface P2PExchangeOffer {
  id: string;
  maker_id: string;
  maker_name: string;
  maker_verified: boolean;
  side: ExchangeSide;
  offer_currency: string;
  local_currency: string;
  rate: number;
  total_amount: number;
  available_amount: number;
  min_limit: number;
  max_limit: number;
  meetup_location: string;
  meetup_city: string;
  meetup_lat: number | null;
  meetup_lng: number | null;
  notes: string;
  status: OfferStatus;
  completed_trades: number;
  created_at: string;
  updated_at: string;
}

export interface P2PExchangeTrade {
  id: string;
  offer_id: string | null;
  maker_id: string;
  taker_id: string;
  maker_name: string;
  taker_name: string;
  side: ExchangeSide;
  offer_currency: string;
  local_currency: string;
  rate: number;
  offer_amount: number;
  local_amount: number;
  meetup_location: string;
  meetup_time: string;
  meetup_agreed: boolean;
  maker_confirmed: boolean;
  taker_confirmed: boolean;
  status: TradeStatus;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface P2PExchangeMessage {
  id: string;
  trade_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

export interface CreateOfferInput {
  makerId: string;
  makerName: string;
  makerVerified: boolean;
  side: ExchangeSide;
  offerCurrency: string;
  localCurrency: string;
  rate: number;
  totalAmount: number;
  minLimit: number;
  maxLimit: number;
  meetupLocation: string;
  meetupCity?: string;
  meetupLat?: number | null;
  meetupLng?: number | null;
  notes?: string;
}

export interface CreateTradeInput {
  offer: P2PExchangeOffer;
  takerId: string;
  takerName: string;
  offerAmount: number;
  meetupLocation: string;
  meetupTime: string;
}

const OFFERS_STORAGE_KEY = 'ytcash_p2p_exchange_offers_v1';
const TRADES_STORAGE_KEY = 'ytcash_p2p_exchange_trades_v1';
const MESSAGES_STORAGE_KEY = 'ytcash_p2p_exchange_messages_v1';

const SEED_OFFERS: P2PExchangeOffer[] = [
  {
    id: 'seed-offer-usd-php-1',
    maker_id: '00000000-0000-0000-0000-000000000101',
    maker_name: 'Marco R.',
    maker_verified: true,
    side: 'sell',
    offer_currency: 'USD',
    local_currency: 'PHP',
    rate: 58.4,
    total_amount: 1200,
    available_amount: 1200,
    min_limit: 50,
    max_limit: 600,
    meetup_location: 'SM Mall of Asia (Main Atrium), Pasay',
    meetup_city: 'Metro Manila',
    meetup_lat: 14.5351,
    meetup_lng: 120.9822,
    notes: 'Crisp $100 or $50 bills. Daytime meetup at coffee shop inside the mall.',
    status: 'active',
    completed_trades: 42,
    created_at: new Date(Date.now() - 3600_000 * 6).toISOString(),
    updated_at: new Date(Date.now() - 3600_000 * 6).toISOString(),
  },
  {
    id: 'seed-offer-usd-php-2',
    maker_id: '00000000-0000-0000-0000-000000000102',
    maker_name: 'Elena V.',
    maker_verified: true,
    side: 'sell',
    offer_currency: 'USD',
    local_currency: 'PHP',
    rate: 58.65,
    total_amount: 800,
    available_amount: 800,
    min_limit: 100,
    max_limit: 800,
    meetup_location: 'BGC High Street Central Plaza, Taguig',
    meetup_city: 'Taguig',
    meetup_lat: 14.5506,
    meetup_lng: 121.0508,
    notes: 'Meet near the Starbucks Reserve. Both parties inspect bills before exchange.',
    status: 'active',
    completed_trades: 19,
    created_at: new Date(Date.now() - 3600_000 * 12).toISOString(),
    updated_at: new Date(Date.now() - 3600_000 * 12).toISOString(),
  },
  {
    id: 'seed-offer-usd-php-buy-1',
    maker_id: '00000000-0000-0000-0000-000000000103',
    maker_name: 'Kenji T.',
    maker_verified: true,
    side: 'buy',
    offer_currency: 'USD',
    local_currency: 'PHP',
    rate: 57.95,
    total_amount: 1500,
    available_amount: 1500,
    min_limit: 50,
    max_limit: 1000,
    meetup_location: 'Ayala Triangle Gardens, Makati',
    meetup_city: 'Makati',
    meetup_lat: 14.5572,
    meetup_lng: 121.0238,
    notes: 'Buying USD cash for PHP cash. Meet at public cafe with security.',
    status: 'active',
    completed_trades: 31,
    created_at: new Date(Date.now() - 3600_000 * 8).toISOString(),
    updated_at: new Date(Date.now() - 3600_000 * 8).toISOString(),
  },
  {
    id: 'seed-offer-aed-php-1',
    maker_id: '00000000-0000-0000-0000-000000000104',
    maker_name: 'Tariq A.',
    maker_verified: true,
    side: 'sell',
    offer_currency: 'AED',
    local_currency: 'PHP',
    rate: 15.85,
    total_amount: 4000,
    available_amount: 4000,
    min_limit: 200,
    max_limit: 2500,
    meetup_location: 'Greenbelt 5 Main Lobby, Makati',
    meetup_city: 'Makati',
    meetup_lat: 14.5522,
    meetup_lng: 121.0211,
    notes: 'Exchanging UAE Dirhams for Philippine Pesos in person.',
    status: 'active',
    completed_trades: 14,
    created_at: new Date(Date.now() - 3600_000 * 18).toISOString(),
    updated_at: new Date(Date.now() - 3600_000 * 18).toISOString(),
  },
  {
    id: 'seed-offer-eur-php-1',
    maker_id: '00000000-0000-0000-0000-000000000105',
    maker_name: 'Sofia M.',
    maker_verified: true,
    side: 'sell',
    offer_currency: 'EUR',
    local_currency: 'PHP',
    rate: 62.9,
    total_amount: 900,
    available_amount: 900,
    min_limit: 50,
    max_limit: 500,
    meetup_location: 'Alabang Town Center Activity Area, Muntinlupa',
    meetup_city: 'Muntinlupa',
    meetup_lat: 14.4239,
    meetup_lng: 121.0298,
    notes: 'Public mall meetup only between 10 AM and 6 PM.',
    status: 'active',
    completed_trades: 27,
    created_at: new Date(Date.now() - 3600_000 * 24).toISOString(),
    updated_at: new Date(Date.now() - 3600_000 * 24).toISOString(),
  },
];

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

async function readLocalOffers(): Promise<P2PExchangeOffer[]> {
  const raw = await AsyncStorage.getItem(OFFERS_STORAGE_KEY);
  if (!raw) {
    await AsyncStorage.setItem(OFFERS_STORAGE_KEY, JSON.stringify(SEED_OFFERS));
    return SEED_OFFERS;
  }
  try {
    return JSON.parse(raw) as P2PExchangeOffer[];
  } catch {
    return SEED_OFFERS;
  }
}

async function writeLocalOffers(offers: P2PExchangeOffer[]): Promise<void> {
  await AsyncStorage.setItem(OFFERS_STORAGE_KEY, JSON.stringify(offers));
}

async function readLocalTrades(): Promise<P2PExchangeTrade[]> {
  const raw = await AsyncStorage.getItem(TRADES_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as P2PExchangeTrade[];
  } catch {
    return [];
  }
}

async function writeLocalTrades(trades: P2PExchangeTrade[]): Promise<void> {
  await AsyncStorage.setItem(TRADES_STORAGE_KEY, JSON.stringify(trades));
}

async function readLocalMessages(tradeId: string): Promise<P2PExchangeMessage[]> {
  const raw = await AsyncStorage.getItem(MESSAGES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const all = JSON.parse(raw) as P2PExchangeMessage[];
    return all.filter((m) => m.trade_id === tradeId);
  } catch {
    return [];
  }
}

async function appendLocalMessage(msg: P2PExchangeMessage): Promise<void> {
  const raw = await AsyncStorage.getItem(MESSAGES_STORAGE_KEY);
  let all: P2PExchangeMessage[] = [];
  if (raw) {
    try {
      all = JSON.parse(raw) as P2PExchangeMessage[];
    } catch {
      all = [];
    }
  }
  all.push(msg);
  await AsyncStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(all));
}

function normalizeOffer(row: any): P2PExchangeOffer {
  return {
    ...row,
    rate: Number(row.rate),
    total_amount: Number(row.total_amount),
    available_amount: Number(row.available_amount),
    min_limit: Number(row.min_limit),
    max_limit: Number(row.max_limit),
    completed_trades: Number(row.completed_trades ?? 0),
    meetup_lat: row.meetup_lat == null ? null : Number(row.meetup_lat),
    meetup_lng: row.meetup_lng == null ? null : Number(row.meetup_lng),
  };
}

function normalizeTrade(row: any): P2PExchangeTrade {
  return {
    ...row,
    rate: Number(row.rate),
    offer_amount: Number(row.offer_amount),
    local_amount: Number(row.local_amount),
    meetup_agreed: Boolean(row.meetup_agreed),
    maker_confirmed: Boolean(row.maker_confirmed),
    taker_confirmed: Boolean(row.taker_confirmed),
  };
}

export async function listExchangeOffers(filters?: {
  side?: ExchangeSide;
  offerCurrency?: string;
  localCurrency?: string;
}): Promise<P2PExchangeOffer[]> {
  try {
    let query = supabase
      .from('p2p_exchange_offers')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(50);

    if (filters?.side) query = query.eq('side', filters.side);
    if (filters?.offerCurrency) query = query.eq('offer_currency', filters.offerCurrency);
    if (filters?.localCurrency) query = query.eq('local_currency', filters.localCurrency);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(normalizeOffer);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalOffers();
    return all.filter((o) => {
      if (o.status !== 'active') return false;
      if (filters?.side && o.side !== filters.side) return false;
      if (filters?.offerCurrency && o.offer_currency !== filters.offerCurrency) return false;
      if (filters?.localCurrency && o.local_currency !== filters.localCurrency) return false;
      return true;
    });
  }
}

export async function listMyOffers(userId: string): Promise<P2PExchangeOffer[]> {
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_offers')
      .select('*')
      .eq('maker_id', userId)
      .neq('status', 'closed')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(normalizeOffer);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalOffers();
    return all.filter((o) => o.maker_id === userId && o.status !== 'closed');
  }
}

export async function createExchangeOffer(input: CreateOfferInput): Promise<P2PExchangeOffer> {
  const payload = {
    maker_id: input.makerId,
    maker_name: input.makerName,
    maker_verified: input.makerVerified,
    side: input.side,
    offer_currency: input.offerCurrency,
    local_currency: input.localCurrency,
    rate: input.rate,
    total_amount: input.totalAmount,
    available_amount: input.totalAmount,
    min_limit: input.minLimit,
    max_limit: Math.min(input.maxLimit, input.totalAmount),
    meetup_location: input.meetupLocation.trim(),
    meetup_city: (input.meetupCity ?? '').trim(),
    meetup_lat: input.meetupLat ?? null,
    meetup_lng: input.meetupLng ?? null,
    notes: (input.notes ?? '').trim(),
    status: 'active' as OfferStatus,
  };

  try {
    const { data, error } = await supabase
      .from('p2p_exchange_offers')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeOffer(data);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const now = new Date().toISOString();
    const offer: P2PExchangeOffer = {
      ...payload,
      id: makeUuid(),
      completed_trades: 0,
      created_at: now,
      updated_at: now,
    };
    const all = await readLocalOffers();
    await writeLocalOffers([offer, ...all]);
    return offer;
  }
}

export async function updateOfferStatus(
  offerId: string,
  status: OfferStatus,
): Promise<P2PExchangeOffer | null> {
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_offers')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', offerId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeOffer(data) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalOffers();
    let updated: P2PExchangeOffer | null = null;
    const next = all.map((o) => {
      if (o.id !== offerId) return o;
      updated = { ...o, status, updated_at: new Date().toISOString() };
      return updated;
    });
    await writeLocalOffers(next);
    return updated;
  }
}

export async function listMyTrades(userId: string): Promise<P2PExchangeTrade[]> {
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_trades')
      .select('*')
      .or(`maker_id.eq.${userId},taker_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map(normalizeTrade);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalTrades();
    return all.filter((t) => t.maker_id === userId || t.taker_id === userId);
  }
}

export async function getExchangeTrade(tradeId: string): Promise<P2PExchangeTrade | null> {
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_trades')
      .select('*')
      .eq('id', tradeId)
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeTrade(data) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalTrades();
    return all.find((t) => t.id === tradeId) ?? null;
  }
}

export async function createTradeFromOffer(input: CreateTradeInput): Promise<P2PExchangeTrade> {
  const localAmount = Number((input.offerAmount * input.offer.rate).toFixed(2));
  const payload = {
    offer_id: input.offer.id.startsWith('seed-') ? null : input.offer.id,
    maker_id: input.offer.maker_id,
    taker_id: input.takerId,
    maker_name: input.offer.maker_name,
    taker_name: input.takerName,
    side: input.offer.side,
    offer_currency: input.offer.offer_currency,
    local_currency: input.offer.local_currency,
    rate: input.offer.rate,
    offer_amount: input.offerAmount,
    local_amount: localAmount,
    meetup_location: input.meetupLocation.trim() || input.offer.meetup_location,
    meetup_time: input.meetupTime.trim() || 'Today (agree in chat)',
    meetup_agreed: false,
    maker_confirmed: false,
    taker_confirmed: false,
    status: 'proposed' as TradeStatus,
  };

  try {
    const { data, error } = await supabase
      .from('p2p_exchange_trades')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeTrade(data);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const now = new Date().toISOString();
    const trade: P2PExchangeTrade = {
      ...payload,
      offer_id: input.offer.id,
      id: makeUuid(),
      cancel_reason: null,
      created_at: now,
      updated_at: now,
    };
    const all = await readLocalTrades();
    await writeLocalTrades([trade, ...all]);
    await appendLocalMessage({
      id: makeUuid(),
      trade_id: trade.id,
      sender_id: input.takerId,
      sender_name: input.takerName,
      body: `Requested to exchange ${formatExchangeMoney(trade.offer_amount, trade.offer_currency)} for ${formatExchangeMoney(trade.local_amount, trade.local_currency)} at ${trade.meetup_location} (${trade.meetup_time}).`,
      created_at: now,
    });
    return trade;
  }
}

export async function agreeMeetupLocation(
  tradeId: string,
  location: string,
  meetupTime: string,
): Promise<P2PExchangeTrade | null> {
  const updates = {
    meetup_location: location.trim(),
    meetup_time: meetupTime.trim(),
    meetup_agreed: true,
    status: 'agreed' as TradeStatus,
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_trades')
      .update(updates)
      .eq('id', tradeId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeTrade(data) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalTrades();
    let updated: P2PExchangeTrade | null = null;
    const next = all.map((t) => {
      if (t.id !== tradeId) return t;
      updated = { ...t, ...updates };
      return updated;
    });
    await writeLocalTrades(next);
    return updated;
  }
}

export async function confirmTradeComplete(
  trade: P2PExchangeTrade,
  userId: string,
): Promise<P2PExchangeTrade | null> {
  const isMaker = trade.maker_id === userId;
  const makerConfirmed = isMaker ? true : trade.maker_confirmed;
  const takerConfirmed = !isMaker ? true : trade.taker_confirmed;
  // In seed/demo mode where the maker is a sample user, confirming from taker completes immediately;
  // for real two-user trades, both parties confirm or either side can finalize once meetup is agreed.
  const isSeedMaker = trade.maker_id.startsWith('00000000-0000-0000-0000-');
  const shouldComplete = (makerConfirmed && takerConfirmed) || (isSeedMaker && takerConfirmed);
  const updates = {
    maker_confirmed: makerConfirmed,
    taker_confirmed: takerConfirmed,
    status: (shouldComplete ? 'completed' : trade.status) as TradeStatus,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('p2p_exchange_trades')
      .update(updates)
      .eq('id', trade.id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeTrade(data) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalTrades();
    let updated: P2PExchangeTrade | null = null;
    const next = all.map((t) => {
      if (t.id !== trade.id) return t;
      updated = { ...t, ...updates };
      return updated;
    });
    await writeLocalTrades(next);
    return updated;
  }
}

export async function cancelExchangeTrade(
  tradeId: string,
  reason: string = 'Cancelled by user',
): Promise<P2PExchangeTrade | null> {
  const updates = {
    status: 'cancelled' as TradeStatus,
    cancel_reason: reason,
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_trades')
      .update(updates)
      .eq('id', tradeId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeTrade(data) : null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const all = await readLocalTrades();
    let updated: P2PExchangeTrade | null = null;
    const next = all.map((t) => {
      if (t.id !== tradeId) return t;
      updated = { ...t, ...updates };
      return updated;
    });
    await writeLocalTrades(next);
    return updated;
  }
}

export async function listTradeMessages(tradeId: string): Promise<P2PExchangeMessage[]> {
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_messages')
      .select('*')
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as P2PExchangeMessage[];
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return readLocalMessages(tradeId);
  }
}

export async function sendTradeMessage(
  tradeId: string,
  senderId: string,
  senderName: string,
  body: string,
): Promise<P2PExchangeMessage> {
  const trimmed = body.trim();
  try {
    const { data, error } = await supabase
      .from('p2p_exchange_messages')
      .insert({
        trade_id: tradeId,
        sender_id: senderId,
        sender_name: senderName,
        body: trimmed,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as P2PExchangeMessage;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const msg: P2PExchangeMessage = {
      id: makeUuid(),
      trade_id: tradeId,
      sender_id: senderId,
      sender_name: senderName,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    await appendLocalMessage(msg);
    return msg;
  }
}

export function tradeStatusLabel(status: TradeStatus): string {
  switch (status) {
    case 'proposed':
      return 'Meetup proposed';
    case 'agreed':
      return 'Meetup agreed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
}
