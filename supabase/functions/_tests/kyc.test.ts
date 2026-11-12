// Run with:  deno test supabase/functions/_tests
import { _internal, canonicalJson, timingSafeEqual, verifyDiditWebhook } from '../_shared/didit.ts';
import { createKycHandler, createWebhookHandler, type KycDb, type KycEnv } from '../_shared/handlers.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

const SECRET = 'whsec_test_secret';
const NOW = 1_800_000_000;
const ENV: KycEnv = {
  diditApiKey: 'key',
  diditWorkflowId: 'wf',
  diditWebhookSecret: SECRET,
  callbackUrl: 'ytcash://kyc',
  diditMode: 'test',
};

function fakeDb(overrides: Partial<KycDb> = {}) {
  const calls: string[] = [];
  const db: KycDb = {
    getUserId: (jwt) => Promise.resolve(jwt === 'good' ? 'user-1' : null),
    canStart: () => Promise.resolve('auto'),
    recordSession: (u, s, t) => (calls.push(`record:${u}:${s}:${t ? 'test' : 'live'}`), Promise.resolve({ id: 'ver-1' })),
    applyStatus: (s, st) => (calls.push(`apply:${s}:${st}`), Promise.resolve()),
    openSessions: () => Promise.resolve(['sess-1']),
    ...overrides,
  };
  return { db, calls };
}

const diditOk = () =>
  Promise.resolve(
    new Response(JSON.stringify({ session_id: 'sess-1', session_token: 'tok', url: 'https://verify.didit.me/session/tok' }), { status: 201 }),
  );

function start(handler: (r: Request) => Promise<Response>, jwt = 'good', action = 'start') {
  return handler(
    new Request('https://x/kyc', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
  );
}

async function signedWebhook(payload: unknown, opts: { secret?: string; ts?: number; header?: string; body?: string } = {}) {
  const body = opts.body ?? JSON.stringify(payload);
  const header = opts.header ?? 'x-signature';
  const message = header.includes('v2') ? canonicalJson(JSON.parse(body)) : body;
  const signature = await _internal.hmacSha256Hex(opts.secret ?? SECRET, message);
  return new Request('https://x/kyc-webhook', {
    method: 'POST',
    headers: { [header]: signature, 'x-timestamp': String(opts.ts ?? NOW), 'content-type': 'application/json' },
    body,
  });
}

const EVENT = { webhook_type: 'status.updated', session_id: 'sess-1', status: 'Approved', timestamp: NOW, vendor_data: 'user-1', decision: { id_verifications: [{ status: 'Approved' }] } };

// ─── signatures ───
Deno.test('canonicalJson sorts keys at every level and is compact', () => {
  assert(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 'é' }], c: null } }) === '{"a":{"c":null,"d":[{"y":"é","z":1}]},"b":1}', 'canonical form');
});

Deno.test('timingSafeEqual', () => {
  assert(timingSafeEqual('abc', 'abc') && !timingSafeEqual('abc', 'abd') && !timingSafeEqual('abc', 'ab'), 'compare');
});

Deno.test('webhook: valid raw-body signature is accepted and applied', async () => {
  const { db, calls } = fakeDb();
  const res = await createWebhookHandler(ENV, db, () => NOW)(await signedWebhook(EVENT));
  assert(res.status === 200 && calls.join() === 'apply:sess-1:Approved', `got ${res.status} ${calls}`);
});

Deno.test('webhook: valid V2 signature is accepted even if the body was re-encoded', async () => {
  const { db, calls } = fakeDb();
  const reordered = JSON.stringify({ status: 'Approved', session_id: 'sess-1', webhook_type: 'status.updated', timestamp: NOW }, null, 2);
  const res = await createWebhookHandler(ENV, db, () => NOW)(await signedWebhook(null, { header: 'x-signature-v2', body: reordered }));
  assert(res.status === 200 && calls.length === 1, `got ${res.status}`);
});

Deno.test('webhook: wrong secret is rejected', async () => {
  const { db, calls } = fakeDb();
  const res = await createWebhookHandler(ENV, db, () => NOW)(await signedWebhook(EVENT, { secret: 'attacker' }));
  assert(res.status === 401 && calls.length === 0, `got ${res.status}`);
});

Deno.test('webhook: tampered body is rejected', async () => {
  const { db, calls } = fakeDb();
  const req = await signedWebhook({ ...EVENT, status: 'Declined' });
  const forged = new Request(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(EVENT) });
  const res = await createWebhookHandler(ENV, db, () => NOW)(forged);
  assert(res.status === 401 && calls.length === 0, `got ${res.status}`);
});

Deno.test('webhook: unsigned request is rejected', async () => {
  const { db, calls } = fakeDb();
  const res = await createWebhookHandler(ENV, db, () => NOW)(
    new Request('https://x', { method: 'POST', body: JSON.stringify(EVENT), headers: { 'x-timestamp': String(NOW) } }),
  );
  assert(res.status === 401 && calls.length === 0, `got ${res.status}`);
});

Deno.test('webhook: only the deprecated Simple signature is not enough', async () => {
  const { db, calls } = fakeDb();
  const simple = await _internal.hmacSha256Hex(SECRET, `${NOW}:sess-1:Approved:status.updated`);
  const res = await createWebhookHandler(ENV, db, () => NOW)(
    new Request('https://x', { method: 'POST', body: JSON.stringify(EVENT), headers: { 'x-timestamp': String(NOW), 'x-signature-simple': simple } }),
  );
  assert(res.status === 401 && calls.length === 0, `got ${res.status}`);
});

Deno.test('webhook: replayed (old) delivery is rejected', async () => {
  const { db, calls } = fakeDb();
  const res = await createWebhookHandler(ENV, db, () => NOW + 301)(await signedWebhook(EVENT));
  assert(res.status === 401 && calls.length === 0, `got ${res.status}`);
});

Deno.test('webhook: old signed body with a fresh timestamp header is rejected', async () => {
  const { db, calls } = fakeDb();
  const res = await createWebhookHandler(ENV, db, () => NOW + 4000)(await signedWebhook(EVENT, { ts: NOW + 4000 }));
  assert(res.status === 401 && calls.length === 0, `got ${res.status}`);
});

Deno.test('webhook: previous secret accepted during rotation', async () => {
  const { db, calls } = fakeDb();
  const res = await createWebhookHandler({ ...ENV, diditWebhookSecret: 'new', diditWebhookSecretPrevious: SECRET }, db, () => NOW)(
    await signedWebhook(EVENT, { header: 'x-signature-previous' }),
  );
  assert(res.status === 200 && calls.length === 1, `got ${res.status}`);
});

Deno.test('webhook: other event types are acknowledged but ignored', async () => {
  const { db, calls } = fakeDb();
  const res = await createWebhookHandler(ENV, db, () => NOW)(await signedWebhook({ ...EVENT, webhook_type: 'data.updated' }));
  assert(res.status === 200 && calls.length === 0, `got ${res.status}`);
});

Deno.test('webhook: database failure returns 500 so Didit retries', async () => {
  const { db } = fakeDb({ applyStatus: () => Promise.reject(new Error('db down')) });
  const res = await createWebhookHandler(ENV, db, () => NOW)(await signedWebhook(EVENT));
  assert(res.status === 500, `got ${res.status}`);
});

Deno.test('webhook: refuses to run without a configured secret', async () => {
  const { db } = fakeDb();
  const res = await createWebhookHandler({ ...ENV, diditWebhookSecret: undefined }, db, () => NOW)(await signedWebhook(EVENT));
  assert(res.status === 503, `got ${res.status}`);
});

Deno.test('verifyDiditWebhook rejects non-object JSON', async () => {
  const body = '[1,2]';
  const sig = await _internal.hmacSha256Hex(SECRET, body);
  const v = await verifyDiditWebhook({ rawBody: body, headers: new Headers({ 'x-signature': sig, 'x-timestamp': String(NOW) }), secret: SECRET, now: NOW });
  assert(!v.valid, 'array body rejected');
});

// ─── start / fallback ───
Deno.test('start: requires a valid user token', async () => {
  const { db } = fakeDb();
  const res = await start(createKycHandler(ENV, db, diditOk), 'bad');
  assert(res.status === 401, `got ${res.status}`);
});

Deno.test('start: creates a Didit session bound to the caller and sends the key only to Didit', async () => {
  const { db, calls } = fakeDb();
  let seen: { url: string; init?: RequestInit } | null = null;
  const res = await start(createKycHandler(ENV, db, (url, init) => ((seen = { url, init }), diditOk())));
  const body = await res.json();
  const sent = JSON.parse(String(seen!.init!.body));
  assert(body.mode === 'didit' && body.session_token === 'tok' && body.verification_id === 'ver-1', JSON.stringify(body));
  assert(seen!.url === 'https://verification.didit.me/v3/session/' && sent.vendor_data === 'user-1' && sent.workflow_id === 'wf', 'request shape');
  assert((seen!.init!.headers as Record<string, string>)['x-api-key'] === 'key' && !JSON.stringify(body).includes('key"'), 'key not leaked');
  assert(calls.join() === 'record:user-1:sess-1:test' && body.test === true, calls.join());
  assert(!('sandbox_scenario' in sent), 'no scenario unless configured');
});

Deno.test('start: test mode passes the sandbox scenario and marks the verification as a test', async () => {
  const { db, calls } = fakeDb();
  let sent: Record<string, unknown> = {};
  const res = await start(
    createKycHandler({ ...ENV, diditSandboxScenario: 'approve' }, db, (_u, init) => ((sent = JSON.parse(String(init!.body))), diditOk())),
  );
  const body = await res.json();
  assert(sent.sandbox_scenario === 'approve' && body.test === true && calls[0].endsWith(':test'), JSON.stringify(sent));
});

Deno.test('start: live mode never sends a sandbox scenario and records a real verification', async () => {
  const { db, calls } = fakeDb();
  let sent: Record<string, unknown> = {};
  const res = await start(
    createKycHandler({ ...ENV, diditMode: 'live', diditSandboxScenario: 'approve' }, db, (_u, init) => ((sent = JSON.parse(String(init!.body))), diditOk())),
  );
  const body = await res.json();
  assert(!('sandbox_scenario' in sent) && body.test === false && calls[0].endsWith(':live'), JSON.stringify(sent));
});

Deno.test('start: falls back to manual when Didit is not configured yet', async () => {
  const { db } = fakeDb();
  const res = await start(createKycHandler({ ...ENV, diditApiKey: undefined }, db, diditOk));
  const body = await res.json();
  assert(body.mode === 'manual' && body.reason === 'not_configured', JSON.stringify(body));
});

Deno.test('start: falls back to manual when free credits are exhausted', async () => {
  const { db, calls } = fakeDb();
  const noCredits = () => Promise.resolve(new Response(JSON.stringify({ detail: "You don't have enough credits to perform this request." }), { status: 400 }));
  const body = await (await start(createKycHandler(ENV, db, noCredits))).json();
  assert(body.mode === 'manual' && body.reason === 'quota_exhausted' && calls.length === 0, JSON.stringify(body));
});

Deno.test('start: falls back to manual on a bad key, rate limit, outage or network error', async () => {
  for (const [fetchFn, reason] of [
    [() => Promise.resolve(new Response('{}', { status: 401 })), 'unauthorized'],
    [() => Promise.resolve(new Response('{}', { status: 429 })), 'rate_limited'],
    [() => Promise.resolve(new Response('oops', { status: 502 })), 'provider_error'],
    [() => Promise.reject(new Error('network')), 'provider_error'],
    [() => Promise.resolve(new Response(JSON.stringify({ url: 'http://evil' }), { status: 201 })), 'provider_error'],
  ] as const) {
    const { db } = fakeDb();
    const body = await (await start(createKycHandler(ENV, db, fetchFn as never))).json();
    assert(body.mode === 'manual' && body.reason === reason, `${reason}: ${JSON.stringify(body)}`);
  }
});

Deno.test('start: manual-only mode never calls Didit', async () => {
  const { db } = fakeDb({ canStart: () => Promise.resolve('manual') });
  let called = false;
  const body = await (await start(createKycHandler(ENV, db, () => ((called = true), diditOk())))).json();
  assert(body.mode === 'manual' && !called, JSON.stringify(body));
});

Deno.test('start: Didit-only mode reports unavailable instead of falling back', async () => {
  const { db } = fakeDb({ canStart: () => Promise.resolve('didit') });
  const res = await start(createKycHandler(ENV, db, () => Promise.resolve(new Response('{}', { status: 500 }))));
  assert(res.status === 503, `got ${res.status}`);
});

Deno.test('start: already-verified users get nothing to do', async () => {
  const { db } = fakeDb({ canStart: () => Promise.resolve('verified') });
  const body = await (await start(createKycHandler(ENV, db, diditOk))).json();
  assert(body.mode === 'verified', JSON.stringify(body));
});

Deno.test('refresh: pulls the latest status for open sessions', async () => {
  const { db, calls } = fakeDb();
  const decision = (url: string) => (assert(url.endsWith('/v3/session/sess-1/decision/'), url), Promise.resolve(new Response(JSON.stringify({ status: 'Approved' }), { status: 200 })));
  const body = await (await start(createKycHandler(ENV, db, decision), 'good', 'refresh')).json();
  assert(body.refreshed === 1 && calls.join() === 'apply:sess-1:Approved', calls.join());
});
