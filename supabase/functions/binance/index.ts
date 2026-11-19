// Read-only Binance portfolio, live ticker prices, and Bitcoin deposit address lookup.
// Per-user API keys stored in `public.user_binance_keys` are used first; if none are
// configured for the user, falls back to server environment variables:
//   BINANCE_API_KEY, BINANCE_API_SECRET, BINANCE_USE_TESTNET, BINANCE_BTC_DEPOSIT_ADDRESS
// Deploy: supabase functions deploy binance
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  createBinanceHandler,
  type BinanceDb,
  type BinanceEnv,
} from '../_shared/binance.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const env: BinanceEnv = {
  fallbackApiKey: Deno.env.get('BINANCE_API_KEY') || undefined,
  fallbackApiSecret: Deno.env.get('BINANCE_API_SECRET') || undefined,
  fallbackUseTestnet: Deno.env.get('BINANCE_USE_TESTNET') === 'true',
  fallbackBtcDepositAddress: Deno.env.get('BINANCE_BTC_DEPOSIT_ADDRESS') || undefined,
  fallbackBtcNetwork: Deno.env.get('BINANCE_BTC_NETWORK') || 'BTC (Bitcoin)',
};

const db: BinanceDb = {
  async getUserId(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    return error ? null : data.user?.id ?? null;
  },
  async getUserCredentials(userId) {
    const { data, error } = await admin
      .from('user_binance_keys')
      .select('api_key, api_secret, label, use_testnet')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      apiKey: data.api_key,
      apiSecret: data.api_secret,
      label: data.label,
      useTestnet: Boolean(data.use_testnet),
      source: 'user',
    };
  },
  async getDepositConfig() {
    const { data, error } = await admin
      .from('binance_deposit_config')
      .select('btc_deposit_address, btc_network, btc_memo, account_label')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    return {
      btcDepositAddress: data.btc_deposit_address,
      btcNetwork: data.btc_network,
      btcMemo: data.btc_memo,
      accountLabel: data.account_label,
    };
  },
};

Deno.serve(createBinanceHandler(env, db, fetch));
