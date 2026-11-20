import AsyncStorage from '@react-native-async-storage/async-storage';

export type AssetCategory = 'crypto' | 'tokens' | 'coin_stocks';

export interface AssetDefinition {
  id: string;
  symbol: string;
  name: string;
  category: AssetCategory;
  networks: string[];
  defaultAddressPrefix: string;
  priceUsd: number;
  iconColor: string;
  description: string;
}

export interface AssetTransferRecord {
  id: string;
  direction: 'send' | 'receive' | 'earn';
  category: AssetCategory;
  symbol: string;
  network: string;
  amount: number;
  address: string;
  createdAt: string;
}

export const ASSETS_CATALOG: AssetDefinition[] = [
  // ─── Cryptocurrencies (Real Blockchains) ───────────────
  {
    id: 'btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    category: 'crypto',
    networks: ['Bitcoin (SegWit)', 'Lightning Network'],
    defaultAddressPrefix: 'bc1q',
    priceUsd: 95000,
    iconColor: '#F7931A',
    description: 'Native Bitcoin blockchain deposit & withdrawal address.',
  },
  {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ethereum',
    category: 'crypto',
    networks: ['Ethereum (ERC-20)', 'Arbitrum One', 'Base'],
    defaultAddressPrefix: '0x',
    priceUsd: 3200,
    iconColor: '#627EEA',
    description: 'Ethereum mainnet & L2 blockchain wallet address.',
  },
  {
    id: 'sol',
    symbol: 'SOL',
    name: 'Solana',
    category: 'crypto',
    networks: ['Solana (SPL)'],
    defaultAddressPrefix: '7xK',
    priceUsd: 195,
    iconColor: '#14F195',
    description: 'High-speed Solana blockchain deposit & withdrawal.',
  },
  {
    id: 'bnb',
    symbol: 'BNB',
    name: 'BNB',
    category: 'crypto',
    networks: ['BNB Smart Chain (BEP-20)'],
    defaultAddressPrefix: '0x',
    priceUsd: 620,
    iconColor: '#F3BA2F',
    description: 'BNB Smart Chain native asset.',
  },

  // ─── Tokens (Real Blockchain Tokens) ───────────────────
  {
    id: 'usdt',
    symbol: 'USDT',
    name: 'Tether USD',
    category: 'tokens',
    networks: ['TRC-20 (Tron)', 'BEP-20 (BSC)', 'ERC-20 (Ethereum)'],
    defaultAddressPrefix: 'T',
    priceUsd: 1,
    iconColor: '#26A17B',
    description: 'USD-pegged stablecoin across Tron, BSC & Ethereum.',
  },
  {
    id: 'usdc',
    symbol: 'USDC',
    name: 'USD Coin',
    category: 'tokens',
    networks: ['ERC-20 (Ethereum)', 'Solana (SPL)', 'Base'],
    defaultAddressPrefix: '0x',
    priceUsd: 1,
    iconColor: '#2775CA',
    description: 'Regulated USD stablecoin on Ethereum, Solana & Base.',
  },
  {
    id: 'link',
    symbol: 'LINK',
    name: 'Chainlink',
    category: 'tokens',
    networks: ['ERC-20 (Ethereum)'],
    defaultAddressPrefix: '0x',
    priceUsd: 18.5,
    iconColor: '#375BD2',
    description: 'Decentralized oracle network token.',
  },

  // ─── Coin Stocks (Earned while using YTCash) ───────────
  {
    id: 'ytc_stk',
    symbol: 'YTC-STK',
    name: 'YTCash Equity Stock',
    category: 'coin_stocks',
    networks: ['YTCash Rewards Ledger'],
    defaultAddressPrefix: 'ytc-stk-',
    priceUsd: 12.5,
    iconColor: '#F7931A',
    description: 'Company-style equity shares earned on every YTCash transaction & daily check-in.',
  },
  {
    id: 'ln_stk',
    symbol: 'LN-STK',
    name: 'YTCash Lightning Pool',
    category: 'coin_stocks',
    networks: ['YTCash Rewards Ledger'],
    defaultAddressPrefix: 'ln-stk-',
    priceUsd: 8.2,
    iconColor: '#06B6D4',
    description: 'Shares earned from BTC, P2P exchanges & crypto transfers.',
  },
  {
    id: 'cash_stk',
    symbol: 'CASH-STK',
    name: 'YTCash Cashier Stock',
    category: 'coin_stocks',
    networks: ['YTCash Rewards Ledger'],
    defaultAddressPrefix: 'cash-stk-',
    priceUsd: 5.4,
    iconColor: '#10B981',
    description: 'Shares earned by Mobile Cashiers & P2P cash delivery activity.',
  },
];

const DEFAULT_BALANCES: Record<string, number> = {
  BTC: 0.0024,
  ETH: 0.085,
  SOL: 1.5,
  BNB: 0.35,
  USDT: 150,
  USDC: 80,
  LINK: 4,
  'YTC-STK': 12.5,
  'LN-STK': 6,
  'CASH-STK': 10,
};

const BALANCES_KEY = 'ytcash_direct_asset_balances_v1';
const TRANSFERS_KEY = 'ytcash_direct_asset_transfers_v1';
const ADDRESSES_KEY = 'ytcash_direct_asset_addresses_v1';
const LAST_CLAIM_KEY = 'ytcash_coin_stock_last_claim_v1';

/** Deterministic realistic-looking wallet address per user + asset + network. */
export function defaultDepositAddress(userId: string, asset: AssetDefinition, network: string): string {
  const clean = (userId + asset.symbol + network).replace(/[^a-zA-Z0-9]/g, '');
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  const hex = (hash.toString(16).padStart(8, '0') + clean.toLowerCase()).slice(0, 32);

  if (asset.category === 'coin_stocks') {
    return `${asset.defaultAddressPrefix}${userId.slice(0, 8)}`;
  }
  if (network.includes('TRC-20')) {
    return `T${hex.slice(0, 33).toUpperCase()}`;
  }
  if (network.includes('Solana')) {
    return `7xK${hex.slice(0, 29)}`;
  }
  if (asset.symbol === 'BTC' && network.includes('Lightning')) {
    return `lnurl1dp68gurn8ghj7mrww4exctnzd96xserjv9mx7tmw${hex.slice(0, 12)}`;
  }
  if (asset.symbol === 'BTC') {
    return `bc1q${hex.slice(0, 34)}`;
  }
  return `0x${hex.slice(0, 40)}`;
}

export async function getAssetBalances(userId: string): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(`${BALANCES_KEY}_${userId}`);
  if (!raw) {
    await AsyncStorage.setItem(`${BALANCES_KEY}_${userId}`, JSON.stringify(DEFAULT_BALANCES));
    return { ...DEFAULT_BALANCES };
  }
  try {
    return { ...DEFAULT_BALANCES, ...(JSON.parse(raw) as Record<string, number>) };
  } catch {
    return { ...DEFAULT_BALANCES };
  }
}

export async function getCustomAddresses(userId: string): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(`${ADDRESSES_KEY}_${userId}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function saveCustomAddress(
  userId: string,
  key: string,
  address: string,
): Promise<void> {
  const current = await getCustomAddresses(userId);
  current[key] = address.trim();
  await AsyncStorage.setItem(`${ADDRESSES_KEY}_${userId}`, JSON.stringify(current));
}

export async function getAssetTransfers(userId: string): Promise<AssetTransferRecord[]> {
  const raw = await AsyncStorage.getItem(`${TRANSFERS_KEY}_${userId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AssetTransferRecord[];
  } catch {
    return [];
  }
}

export async function recordAssetWithdrawal(input: {
  userId: string;
  asset: AssetDefinition;
  network: string;
  amount: number;
  toAddress: string;
}): Promise<{ balances: Record<string, number>; record: AssetTransferRecord }> {
  const balances = await getAssetBalances(input.userId);
  const current = balances[input.asset.symbol] ?? 0;
  if (input.amount <= 0 || input.amount > current) {
    throw new Error(`Insufficient ${input.asset.symbol} balance.`);
  }
  balances[input.asset.symbol] = Number((current - input.amount).toFixed(6));
  await AsyncStorage.setItem(`${BALANCES_KEY}_${input.userId}`, JSON.stringify(balances));

  const record: AssetTransferRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    direction: 'send',
    category: input.asset.category,
    symbol: input.asset.symbol,
    network: input.network,
    amount: input.amount,
    address: input.toAddress.trim(),
    createdAt: new Date().toISOString(),
  };
  const existing = await getAssetTransfers(input.userId);
  await AsyncStorage.setItem(
    `${TRANSFERS_KEY}_${input.userId}`,
    JSON.stringify([record, ...existing].slice(0, 30)),
  );
  return { balances, record };
}

export async function claimDailyCoinStockReward(
  userId: string,
  symbol: string = 'YTC-STK',
): Promise<{ earned: number; balances: Record<string, number> }> {
  const last = await AsyncStorage.getItem(`${LAST_CLAIM_KEY}_${userId}`);
  const today = new Date().toISOString().slice(0, 10);
  if (last === today) {
    throw new Error("You already claimed today's Coin Stock reward. Come back tomorrow!");
  }
  const earned = symbol === 'YTC-STK' ? 1.5 : 1.0;
  const balances = await getAssetBalances(userId);
  balances[symbol] = Number(((balances[symbol] ?? 0) + earned).toFixed(4));
  await AsyncStorage.setItem(`${BALANCES_KEY}_${userId}`, JSON.stringify(balances));
  await AsyncStorage.setItem(`${LAST_CLAIM_KEY}_${userId}`, today);

  const record: AssetTransferRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    direction: 'earn',
    category: 'coin_stocks',
    symbol,
    network: 'YTCash Rewards Ledger',
    amount: earned,
    address: `YTCash App Activity Reward`,
    createdAt: new Date().toISOString(),
  };
  const existing = await getAssetTransfers(userId);
  await AsyncStorage.setItem(
    `${TRANSFERS_KEY}_${userId}`,
    JSON.stringify([record, ...existing].slice(0, 30)),
  );
  return { earned, balances };
}
