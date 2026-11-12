// Request handlers for the KYC Edge Functions, with their dependencies passed in
// so they can be tested without a network or database.

import {
  createDiditSession,
  fetchDiditStatus,
  verifyDiditWebhook,
  type FetchLike,
} from './didit.ts';

export interface KycEnv {
  diditApiKey?: string;
  diditWorkflowId?: string;
  diditWebhookSecret?: string;
  diditWebhookSecretPrevious?: string;
  callbackUrl: string;
  /**
   * 'test' while the Didit key belongs to a sandbox application: results are
   * simulated, so verifications are recorded as tests. 'live' for real checks.
   */
  diditMode: 'test' | 'live';
  /** Test mode only. See DiditConfig.sandboxScenario. */
  diditSandboxScenario?: string;
}

/** Database access the handlers need. Implemented with the service-role client. */
export interface KycDb {
  /** Returns the signed-in user's id for a JWT, or null if it is not valid. */
  getUserId(jwt: string): Promise<string | null>;
  /** 'verified' | 'manual' | 'limit' | 'auto' | 'didit' */
  canStart(userId: string): Promise<string>;
  recordSession(userId: string, sessionId: string, isTest: boolean): Promise<{ id: string }>;
  applyStatus(sessionId: string, diditStatus: string): Promise<void>;
  /** Didit session ids of this user's verifications that are still undecided. */
  openSessions(userId: string): Promise<string[]>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * POST /kyc  { action: 'start' | 'refresh' }   (requires the user's JWT)
 *
 * start   → { mode: 'didit', session_token, url, ... } when Didit can be used,
 *           { mode: 'manual', reason } when the app should use manual review,
 *           { mode: 'verified' } when there is nothing to do.
 * refresh → re-reads undecided Didit sessions, in case a webhook was missed.
 */
export function createKycHandler(env: KycEnv, db: KycDb, fetchFn: FetchLike) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const userId = jwt ? await db.getUserId(jwt) : null;
    if (!userId) return json({ error: 'NOT_SIGNED_IN' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action === 'refresh' ? 'refresh' : 'start';
    const configured = Boolean(env.diditApiKey && env.diditWorkflowId);

    if (action === 'refresh') {
      if (!configured) return json({ refreshed: 0 });
      let refreshed = 0;
      for (const sessionId of (await db.openSessions(userId)).slice(0, 3)) {
        const status = await fetchDiditStatus(fetchFn, env.diditApiKey!, sessionId);
        if (status) {
          await db.applyStatus(sessionId, status);
          refreshed++;
        }
      }
      return json({ refreshed });
    }

    const decision = await db.canStart(userId);
    if (decision === 'verified') return json({ mode: 'verified' });
    if (decision === 'manual') return json({ mode: 'manual', reason: 'manual_mode' });
    if (decision === 'limit') return json({ error: 'TOO_MANY_ATTEMPTS' }, 429);

    const didItOnly = decision === 'didit';
    const isTest = env.diditMode !== 'live';
    if (!configured) {
      return didItOnly
        ? json({ error: 'KYC_UNAVAILABLE' }, 503)
        : json({ mode: 'manual', reason: 'not_configured' });
    }

    const session = await createDiditSession(
      fetchFn,
      {
        apiKey: env.diditApiKey!,
        workflowId: env.diditWorkflowId!,
        callbackUrl: env.callbackUrl,
        sandboxScenario: isTest ? env.diditSandboxScenario : undefined,
      },
      userId,
    );
    if (!session.ok) {
      // Log the category only; never the key or the provider's response body.
      console.warn(`Didit session not created: ${session.reason} (HTTP ${session.status})`);
      return didItOnly
        ? json({ error: 'KYC_UNAVAILABLE' }, 503)
        : json({ mode: 'manual', reason: session.reason });
    }

    const verification = await db.recordSession(userId, session.sessionId, isTest);
    return json({
      mode: 'didit',
      verification_id: verification.id,
      session_id: session.sessionId,
      session_token: session.sessionToken,
      url: session.url,
      test: isTest,
    });
  };
}

/**
 * POST /kyc-webhook  (called by Didit; authenticated by its HMAC signature, not a JWT)
 */
export function createWebhookHandler(env: KycEnv, db: Pick<KycDb, 'applyStatus'>, now: () => number) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!env.diditWebhookSecret) return json({ error: 'NOT_CONFIGURED' }, 503);

    const rawBody = await req.text();
    if (rawBody.length > 1_000_000) return json({ error: 'TOO_LARGE' }, 413);

    const verdict = await verifyDiditWebhook({
      rawBody,
      headers: req.headers,
      secret: env.diditWebhookSecret,
      previousSecret: env.diditWebhookSecretPrevious,
      now: now(),
    });
    if (!verdict.valid) return json({ error: 'INVALID_SIGNATURE', reason: verdict.reason }, 401);

    const { webhook_type, session_id, status } = verdict.payload;
    if (webhook_type !== 'status.updated' || typeof session_id !== 'string' || typeof status !== 'string') {
      return json({ ok: true, ignored: true });
    }

    try {
      await db.applyStatus(session_id, status);
    } catch (e) {
      console.error('Could not apply Didit status:', (e as Error)?.message);
      return json({ error: 'TEMPORARY_FAILURE' }, 500); // Didit retries on 5xx
    }
    return json({ ok: true });
  };
}
