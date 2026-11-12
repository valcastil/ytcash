// Wires the handlers to the real environment: secrets and the service-role database client.
import { createClient } from 'npm:@supabase/supabase-js@2';

import type { KycDb, KycEnv } from './handlers.ts';

export function loadEnv(): KycEnv {
  return {
    diditApiKey: Deno.env.get('DIDIT_API_KEY') || undefined,
    diditWorkflowId: Deno.env.get('DIDIT_WORKFLOW_ID') || undefined,
    diditWebhookSecret: Deno.env.get('DIDIT_WEBHOOK_SECRET') || undefined,
    diditWebhookSecretPrevious: Deno.env.get('DIDIT_WEBHOOK_SECRET_PREVIOUS') || undefined,
    callbackUrl: Deno.env.get('KYC_CALLBACK_URL') || 'ytcash://kyc',
    // Test unless explicitly switched to live, so simulated results are never mistaken for real ones.
    diditMode: Deno.env.get('DIDIT_MODE') === 'live' ? 'live' : 'test',
    diditSandboxScenario: Deno.env.get('DIDIT_SANDBOX_SCENARIO') || undefined,
  };
}

export function createDb(): KycDb {
  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to every Edge Function.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }

  return {
    async getUserId(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      return error ? null : data.user?.id ?? null;
    },
    canStart: (userId) => rpc<string>('kyc_didit_can_start', { p_user_id: userId }),
    async recordSession(userId, sessionId, isTest) {
      const row = await rpc<{ id: string } | { id: string }[]>('kyc_didit_record_session', {
        p_user_id: userId,
        p_session_id: sessionId,
        p_is_test: isTest,
      });
      return Array.isArray(row) ? row[0] : row;
    },
    async applyStatus(sessionId, diditStatus) {
      await rpc('kyc_didit_apply_status', { p_session_id: sessionId, p_didit_status: diditStatus });
    },
    async openSessions(userId) {
      const { data, error } = await admin
        .from('kyc_verifications')
        .select('didit_session_id')
        .eq('user_id', userId)
        .eq('method', 'didit')
        .in('status', ['started', 'pending_review'])
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.didit_session_id).filter((id): id is string => Boolean(id));
    },
  };
}
