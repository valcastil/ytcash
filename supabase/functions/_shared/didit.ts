// Didit API helpers shared by the `kyc` and `kyc-webhook` Edge Functions.
// Docs: https://docs.didit.me (Create Session v3, Webhooks).
// Nothing in here logs or returns the API key or webhook secret.

export const DIDIT_BASE_URL = 'https://verification.didit.me';

/** Webhooks older or newer than this many seconds are rejected (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DiditConfig {
  apiKey: string;
  workflowId: string;
  /** Where Didit sends the user when the hosted flow ends. */
  callbackUrl: string;
  /**
   * Test mode only: a scenario from Didit's sandbox catalog (e.g. "approve") that makes the
   * session end in a known result. Didit rejects it for live applications.
   */
  sandboxScenario?: string;
}

export type CreateSessionResult =
  | { ok: true; sessionId: string; sessionToken: string; url: string }
  | { ok: false; reason: 'quota_exhausted' | 'unauthorized' | 'rate_limited' | 'provider_error'; status: number };

/** Creates a hosted verification session bound to one of our users. */
export async function createDiditSession(
  fetchFn: FetchLike,
  config: DiditConfig,
  userId: string,
): Promise<CreateSessionResult> {
  let response: Response;
  try {
    response = await fetchFn(`${DIDIT_BASE_URL}/v3/session/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey },
      body: JSON.stringify({
        workflow_id: config.workflowId,
        vendor_data: userId,
        callback: config.callbackUrl,
        metadata: { app: 'ytcash' },
        ...(config.sandboxScenario ? { sandbox_scenario: config.sandboxScenario } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: 'provider_error', status: 0 };
  }

  if (response.status === 201 || response.status === 200) {
    const body = await response.json().catch(() => null);
    if (
      body && typeof body.session_id === 'string' && typeof body.session_token === 'string' &&
      typeof body.url === 'string' && body.url.startsWith('https://')
    ) {
      return { ok: true, sessionId: body.session_id, sessionToken: body.session_token, url: body.url };
    }
    return { ok: false, reason: 'provider_error', status: response.status };
  }

  const text = (await response.text().catch(() => '')).toLowerCase();
  if (response.status === 400 && text.includes('credit')) {
    return { ok: false, reason: 'quota_exhausted', status: 400 };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'unauthorized', status: response.status };
  }
  if (response.status === 429) {
    return { ok: false, reason: 'rate_limited', status: 429 };
  }
  return { ok: false, reason: 'provider_error', status: response.status };
}

/** Asks Didit for a session's current status. Returns null when it cannot be read. */
export async function fetchDiditStatus(
  fetchFn: FetchLike,
  apiKey: string,
  sessionId: string,
): Promise<string | null> {
  try {
    const response = await fetchFn(
      `${DIDIT_BASE_URL}/v3/session/${encodeURIComponent(sessionId)}/decision/`,
      { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body && typeof body.status === 'string' ? body.status : null;
  } catch {
    return null;
  }
}

// ─── Webhook signatures ─────────────────────────────────

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparison that takes the same time whether or not the strings match. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** JSON with keys sorted at every level and no whitespace (Didit's X-Signature-V2 form). */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sort((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export interface WebhookCheck {
  rawBody: string;
  headers: Headers;
  secret: string;
  /** The replaced secret, accepted for 24h after rotating it in the Didit console. */
  previousSecret?: string;
  /** Current time in Unix seconds. */
  now: number;
}

export type WebhookVerdict =
  | { valid: true; payload: Record<string, unknown> }
  | { valid: false; reason: 'missing_headers' | 'stale' | 'bad_signature' | 'bad_json' };

/**
 * Accepts a webhook only if it is fresh and carries a valid HMAC over the full body
 * (X-Signature on the raw bytes, or X-Signature-V2 on the canonical JSON).
 * The deprecated X-Signature-Simple is not accepted because it does not cover the decision.
 */
export async function verifyDiditWebhook(check: WebhookCheck): Promise<WebhookVerdict> {
  const timestamp = Number(check.headers.get('x-timestamp'));
  const raw = [check.headers.get('x-signature'), check.headers.get('x-signature-previous')];
  const v2 = [check.headers.get('x-signature-v2'), check.headers.get('x-signature-v2-previous')];
  if (!Number.isFinite(timestamp) || timestamp <= 0 || ![...raw, ...v2].some(Boolean)) {
    return { valid: false, reason: 'missing_headers' };
  }
  if (Math.abs(check.now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'stale' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(check.rawBody);
  } catch {
    return { valid: false, reason: 'bad_json' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'bad_json' };
  }

  const secrets = [check.secret, check.previousSecret].filter((s): s is string => Boolean(s));
  const canonical = canonicalJson(payload);
  let matched = false;
  for (const secret of secrets) {
    const expectedRaw = await hmacSha256Hex(secret, check.rawBody);
    const expectedV2 = await hmacSha256Hex(secret, canonical);
    // Evaluate every candidate so timing does not reveal which one matched.
    for (const given of raw) if (given && timingSafeEqual(given.toLowerCase(), expectedRaw)) matched = true;
    for (const given of v2) if (given && timingSafeEqual(given.toLowerCase(), expectedV2)) matched = true;
  }
  if (!matched) return { valid: false, reason: 'bad_signature' };

  // The body also carries a timestamp; a signed-but-old body with a fresh header is still a replay.
  const bodyTime = Number((payload as Record<string, unknown>).timestamp);
  if (Number.isFinite(bodyTime) && bodyTime > 0 && Math.abs(check.now - bodyTime) > WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'stale' };
  }

  return { valid: true, payload: payload as Record<string, unknown> };
}

/** Exposed for tests. */
export const _internal = { hmacSha256Hex };
