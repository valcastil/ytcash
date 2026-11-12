// Refreshes the market rates behind foreign-currency quotes.
// Deploy:  supabase functions deploy fx-rates
import { createClient } from 'npm:@supabase/supabase-js@2';

import { createFxRatesHandler, QUOTE_CURRENCIES, type FxDb } from '../_shared/fx.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const db: FxDb = {
  async ratesAgeSeconds() {
    const { data, error } = await admin
      .from('wallet_fx_reference')
      .select('updated_at')
      .in('currency', QUOTE_CURRENCIES)
      .order('updated_at', { ascending: true })
      .limit(1);
    if (error || !data?.length) return null;
    return (Date.now() - new Date(data[0].updated_at).getTime()) / 1000;
  },
  async setRate(currency, phpPerUnit) {
    const { data, error } = await admin.rpc('fx_set_reference_rate', {
      p_currency: currency,
      p_php_per_unit: phpPerUnit,
    });
    return !error && data === true;
  },
};

Deno.serve(createFxRatesHandler(db, fetch));
