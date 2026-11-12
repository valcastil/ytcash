import { createFxRatesHandler, type FxDb } from '../_shared/fx.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

function fakeDb(age: number | null, accept: (c: string, r: number) => boolean = () => true) {
  const set: Record<string, number> = {};
  const db: FxDb = {
    ratesAgeSeconds: () => Promise.resolve(age),
    setRate: (c, r) => {
      const ok = accept(c, r);
      if (ok) set[c] = r;
      return Promise.resolve(ok);
    },
  };
  return { db, set };
}

const feed = (rates: unknown, result = 'success', status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify({ result, rates }), { status }));
const post = (h: (r: Request) => Promise<Response>) => h(new Request('https://x/fx-rates', { method: 'POST' }));

Deno.test('fx-rates: converts the feed to PHP per unit and stores each currency', async () => {
  const { db, set } = fakeDb(3600);
  const body = await (await post(createFxRatesHandler(db, feed({ PHP: 1, AED: 0.0625, USD: 0.0172, EUR: 0.0156, JPY: 2.6 })))).json();
  assert(body.refreshed === true && body.updated.join() === 'AED,USD,EUR', JSON.stringify(body));
  assert(Math.abs(set.AED - 16) < 1e-9 && Math.abs(set.USD - 58.1395) < 0.001 && !('JPY' in set), JSON.stringify(set));
});

Deno.test('fx-rates: does nothing when rates are fresh', async () => {
  const { db, set } = fakeDb(120);
  let called = false;
  const body = await (await post(createFxRatesHandler(db, () => ((called = true), feed({ AED: 0.06 })())))).json();
  assert(body.refreshed === false && !called && Object.keys(set).length === 0, JSON.stringify(body));
});

Deno.test('fx-rates: keeps the stored rates when the feed is down or malformed', async () => {
  for (const fetchFn of [
    () => Promise.reject(new Error('network')),
    feed({ AED: 0.06 }, 'error'),
    feed(null),
    feed({ AED: 0.06 }, 'success', 500),
  ]) {
    const { db, set } = fakeDb(null);
    const body = await (await post(createFxRatesHandler(db, fetchFn as never))).json();
    assert(body.refreshed === false && Object.keys(set).length === 0, JSON.stringify(body));
  }
});

Deno.test('fx-rates: skips bad values and reports only what the database accepted', async () => {
  const { db, set } = fakeDb(9999, (c) => c !== 'USD');
  const body = await (await post(createFxRatesHandler(db, feed({ AED: 0.0625, USD: 0.017, EUR: 0, GBP: 'x' })))).json();
  assert(body.updated.join() === 'AED' && Object.keys(set).join() === 'AED', JSON.stringify(body));
});
