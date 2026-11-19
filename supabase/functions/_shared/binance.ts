// ─── Binance Account & Portfolio Handler (openclaw architecture) ─────────────
// Ports openclaw's BinanceClient / BinanceFuturesClient / check_account_profit.py:
// - Server-time sync (/api/v3/time) to prevent -1021 recvWindow drift
// - Sorted query-string HMAC-SHA256 signing via Web Crypto
// - Per-user API Key & Secret lookup (from public.user_binance_keys) with automatic
//   fallback to server environment variables (BINANCE_API_KEY / BINANCE_API_SECRET)
// - 30-second per-user memory cache to stay well under Binance rate limits
// - Live Spot & USD-M Futures read-only portfolio + deposit address lookup

export interface UserBinanceCredentials {
  apiKey: string;
  apiSecret: string;
  label: string;
  useTestnet: boolean;
  source: 'user' | 'server_env';
}

export interface BinanceDepositInfo {
  btcDepositAddress: string;
  btcNetwork: string;
  btcMemo: string | null;
  accountLabel: string;
}

export interface BinanceDb {
  getUserId(jwt: string): Promise<string | null>;
  getUserCredentials(userId: string): Promise<UserBinanceCredentials | null>;
  getDepositConfig(): Promise<BinanceDepositInfo | null>;
}

export interface BinanceEnv {
  fallbackApiKey?: string;
  fallbackApiSecret?: string;
  fallbackUseTestnet?: boolean;
  fallbackBtcDepositAddress?: string;
  fallbackBtcNetwork?: string;
}

export interface SpotAssetBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
  priceUsdt: number;
  valueUsdt: number;
}

export interface FuturesPositionSummary {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

export interface BinancePortfolioPayload {
  connected: boolean;
  credentialSource: 'user' | 'server_env' | 'none';
  accountLabel: string;
  maskedApiKey: string | null;
  useTestnet: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  makerCommissionPct: number;
  takerCommissionPct: number;
  spotAssets: SpotAssetBalance[];
  spotTotalUsdt: number;
  futuresUsdtFree: number;
  futuresUsdtTotal: number;
  futuresPositions: FuturesPositionSummary[];
  totalPortfolioUsdt: number;
  prices: Record<string, number>;
  deposit: BinanceDepositInfo;
  fetchedAt: string;
  warning?: string;
}

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const CACHE_TTL_MS = 30_000;

const portfolioCache = new Map<string, { ts: number; data: BinancePortfolioPayload }>();

function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return '****';
  return `${k.slice(0, 6)}...${k.slice(-4)}`;
}

/** HMAC-SHA256 hex signature matching openclaw's `create_signature(params, secret)`. */
export async function signBinanceQuery(
  params: Record<string, string | number>,
  secret: string,
): Promise<{ queryString: string; signature: string }> {
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(queryString));
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return { queryString, signature };
}

async function getServerTime(baseUrl: string, fetchFn: typeof fetch): Promise<number> {
  try {
    const res = await fetchFn(`${baseUrl}/api/v3/time`);
    if (res.ok) {
      const data = (await res.json()) as { serverTime?: number };
      if (typeof data.serverTime === 'number') return data.serverTime;
    }
  } catch {
    // Fall back to local clock if time endpoint is unreachable
  }
  return Date.now();
}

export async function fetchPublicPrices(
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, number>> {
  const prices: Record<string, number> = { USDT: 1, USDC: 1, FDUSD: 1, BUSD: 1 };
  try {
    const symbolsParam = encodeURIComponent(JSON.stringify(DEFAULT_SYMBOLS));
    const res = await fetchFn(`https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`);
    if (res.ok) {
      const list = (await res.json()) as Array<{ symbol: string; price: string }>;
      for (const item of list) {
        const p = Number(item.price);
        if (Number.isFinite(p) && p > 0) {
          prices[item.symbol] = p;
          if (item.symbol.endsWith('USDT')) {
            prices[item.symbol.slice(0, -4)] = p;
          }
        }
      }
    }
  } catch {
    // Ignore public ticker errors
  }
  return prices;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function createBinanceHandler(
  env: BinanceEnv,
  db: BinanceDb,
  fetchFn: typeof fetch = fetch,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    const userId = jwt ? await db.getUserId(jwt) : null;
    if (!userId) {
      return jsonResponse({ error: 'NOT_SIGNED_IN' }, 401);
    }

    let body: { action?: string; forceRefresh?: boolean; apiKey?: string; apiSecret?: string; useTestnet?: boolean } = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const action = body.action ?? 'portfolio';

    // Default deposit info from DB or env fallback
    const dbDeposit = await db.getDepositConfig().catch(() => null);
    const depositInfo: BinanceDepositInfo = dbDeposit ?? {
      btcDepositAddress: env.fallbackBtcDepositAddress || '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      btcNetwork: env.fallbackBtcNetwork || 'BTC (Bitcoin)',
      btcMemo: null,
      accountLabel: 'YTCash Binance Treasury',
    };

    if (action === 'prices') {
      const prices = await fetchPublicPrices(fetchFn);
      return jsonResponse({ prices, deposit: depositInfo, fetchedAt: new Date().toISOString() });
    }

    // Resolve credentials:
    // 1. Explicit test credentials passed in `verify_keys` action
    // 2. Per-user credentials stored in `public.user_binance_keys`
    // 3. Fallback to server environment variables (`BINANCE_API_KEY` & `BINANCE_API_SECRET`)
    let creds: UserBinanceCredentials | null = null;
    if (action === 'verify_keys' && body.apiKey && body.apiSecret) {
      creds = {
        apiKey: body.apiKey.trim(),
        apiSecret: body.apiSecret.trim(),
        label: 'Verified Binance Account',
        useTestnet: Boolean(body.useTestnet),
        source: 'user',
      };
    } else {
      creds = await db.getUserCredentials(userId);
      if (!creds && env.fallbackApiKey && env.fallbackApiSecret) {
        creds = {
          apiKey: env.fallbackApiKey.trim(),
          apiSecret: env.fallbackApiSecret.trim(),
          label: 'Shared Server Binance Account (Fallback)',
          useTestnet: Boolean(env.fallbackUseTestnet),
          source: 'server_env',
        };
      }
    }

    const prices = await fetchPublicPrices(fetchFn);

    if (!creds) {
      const emptyPayload: BinancePortfolioPayload = {
        connected: false,
        credentialSource: 'none',
        accountLabel: 'Not Connected',
        maskedApiKey: null,
        useTestnet: false,
        canTrade: false,
        canWithdraw: false,
        canDeposit: false,
        makerCommissionPct: 0,
        takerCommissionPct: 0,
        spotAssets: [],
        spotTotalUsdt: 0,
        futuresUsdtFree: 0,
        futuresUsdtTotal: 0,
        futuresPositions: [],
        totalPortfolioUsdt: 0,
        prices,
        deposit: depositInfo,
        fetchedAt: new Date().toISOString(),
      };
      return jsonResponse(emptyPayload);
    }

    const cacheKey = `${userId}:${creds.source}:${creds.apiKey.slice(0, 8)}`;
    const cached = portfolioCache.get(cacheKey);
    if (!body.forceRefresh && action === 'portfolio' && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return jsonResponse({ ...cached.data, deposit: depositInfo });
    }

    const spotBaseUrl = creds.useTestnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';

    const serverTime = await getServerTime(spotBaseUrl, fetchFn);
    const { queryString, signature } = await signBinanceQuery(
      { timestamp: serverTime, recvWindow: 10000 },
      creds.apiSecret,
    );

    const accountRes = await fetchFn(
      `${spotBaseUrl}/api/v3/account?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': creds.apiKey } },
    );

    const accountJson = (await accountRes.json().catch(() => ({}))) as Record<string, any>;

    if (!accountRes.ok || accountJson.code) {
      const apiMsg = accountJson.msg || `Binance HTTP ${accountRes.status}`;
      if (action === 'verify_keys') {
        return jsonResponse({ error: 'BINANCE_AUTH_FAILED', message: apiMsg }, 400);
      }
      const errPayload: BinancePortfolioPayload = {
        connected: false,
        credentialSource: creds.source,
        accountLabel: creds.label,
        maskedApiKey: maskKey(creds.apiKey),
        useTestnet: creds.useTestnet,
        canTrade: false,
        canWithdraw: false,
        canDeposit: false,
        makerCommissionPct: 0,
        takerCommissionPct: 0,
        spotAssets: [],
        spotTotalUsdt: 0,
        futuresUsdtFree: 0,
        futuresUsdtTotal: 0,
        futuresPositions: [],
        totalPortfolioUsdt: 0,
        prices,
        deposit: depositInfo,
        fetchedAt: new Date().toISOString(),
        warning: apiMsg,
      };
      return jsonResponse(errPayload);
    }

    // Parse non-zero Spot balances (matching openclaw's check_balance_working.py)
    const rawBalances: Array<{ asset: string; free: string; locked: string }> = Array.isArray(
      accountJson.balances,
    )
      ? accountJson.balances
      : [];

    const spotAssets: SpotAssetBalance[] = [];
    let spotTotalUsdt = 0;

    for (const b of rawBalances) {
      const free = Number(b.free) || 0;
      const locked = Number(b.locked) || 0;
      const total = free + locked;
      if (total <= 0) continue;

      const asset = String(b.asset).toUpperCase();
      const priceUsdt = prices[asset] ?? prices[`${asset}USDT`] ?? 0;
      const valueUsdt = total * priceUsdt;
      spotTotalUsdt += valueUsdt;

      spotAssets.push({
        asset,
        free,
        locked,
        total,
        priceUsdt,
        valueUsdt,
      });
    }

    spotAssets.sort((a, b) => b.valueUsdt - a.valueUsdt || b.total - a.total);

    // Try reading USD-M Futures balance & open positions (matching openclaw's check_account_profit.py)
    let futuresUsdtFree = 0;
    let futuresUsdtTotal = 0;
    const futuresPositions: FuturesPositionSummary[] = [];

    if (!creds.useTestnet) {
      try {
        const fSig = await signBinanceQuery(
          { timestamp: serverTime, recvWindow: 10000 },
          creds.apiSecret,
        );
        const fRes = await fetchFn(
          `https://fapi.binance.com/fapi/v2/account?${fSig.queryString}&signature=${fSig.signature}`,
          { headers: { 'X-MBX-APIKEY': creds.apiKey } },
        );
        if (fRes.ok) {
          const fData = (await fRes.json()) as Record<string, any>;
          futuresUsdtFree = Number(fData.availableBalance) || 0;
          futuresUsdtTotal = Number(fData.totalWalletBalance) || 0;

          const rawPositions: Array<Record<string, any>> = Array.isArray(fData.positions)
            ? fData.positions
            : [];
          for (const pos of rawPositions) {
            const amt = Number(pos.positionAmt) || 0;
            if (amt === 0) continue;
            futuresPositions.push({
              symbol: String(pos.symbol),
              side: amt > 0 ? 'LONG' : 'SHORT',
              size: Math.abs(amt),
              entryPrice: Number(pos.entryPrice) || 0,
              markPrice: Number(pos.markPrice) || 0,
              unrealizedPnl: Number(pos.unrealizedProfit) || 0,
              leverage: Number(pos.leverage) || 1,
            });
          }
        }
      } catch {
        // Futures account might not be enabled on this API key; ignore safely
      }
    }

    // Also try fetching the live BTC deposit address from Binance if the key has permission
    try {
      const depSig = await signBinanceQuery(
        { coin: 'BTC', timestamp: serverTime, recvWindow: 10000 },
        creds.apiSecret,
      );
      const depRes = await fetchFn(
        `https://api.binance.com/sapi/v1/capital/deposit/address?${depSig.queryString}&signature=${depSig.signature}`,
        { headers: { 'X-MBX-APIKEY': creds.apiKey } },
      );
      if (depRes.ok) {
        const depJson = (await depRes.json()) as { address?: string; tag?: string; coin?: string };
        if (depJson.address && depJson.address.length >= 20) {
          depositInfo.btcDepositAddress = depJson.address;
          if (depJson.tag) depositInfo.btcMemo = depJson.tag;
        }
      }
    } catch {
      // Key does not have deposit-address read permission; use configured BTC deposit address
    }

    const payload: BinancePortfolioPayload = {
      connected: true,
      credentialSource: creds.source,
      accountLabel: creds.label,
      maskedApiKey: maskKey(creds.apiKey),
      useTestnet: creds.useTestnet,
      canTrade: Boolean(accountJson.canTrade),
      canWithdraw: Boolean(accountJson.canWithdraw),
      canDeposit: Boolean(accountJson.canDeposit),
      makerCommissionPct: (Number(accountJson.makerCommission) || 0) / 100,
      takerCommissionPct: (Number(accountJson.takerCommission) || 0) / 100,
      spotAssets,
      spotTotalUsdt,
      futuresUsdtFree,
      futuresUsdtTotal,
      futuresPositions,
      totalPortfolioUsdt: spotTotalUsdt + futuresUsdtTotal,
      prices,
      deposit: depositInfo,
      fetchedAt: new Date().toISOString(),
    };

    portfolioCache.set(cacheKey, { ts: Date.now(), data: payload });
    return jsonResponse(payload);
  };
}
