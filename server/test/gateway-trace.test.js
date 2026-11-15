// "What Privilege did": the trace attached to POST /api/evaluate (the lab's own simulated gateway, Mock and Live) and to
// POST /api/privilege-check (the real AI Guard hop, here against a fake fetch). The assertions are the honesty rule (assertTrace),
// no secret in the trace, and that each decision is what decide() really recorded. scripts/gateway-trace.test.mjs pins the vendored files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrace } from '../src/gatewayTrace.js';
import { aiGuardFailure, evaluateTrace } from '../src/gatewayExchanges.js';
import { SCENARIOS } from '../src/data.js';
import { post, withServer } from './helpers.js';

const W = (id) => ({ 'x-workspace': id });
const BEARER = ['SECRET', 'BEARER1234'].join(''); // built at run time: no key-shaped literal in the source
const byId = (t) => Object.fromEntries(t.decisions.map((d) => [d.id, d]));

test('every scripted call, in Mock and in Live, gets a simulated trace: mock source, all checked, a .invalid host, honesty contract met', async () => {
  await withServer(async (url) => {
    for (const mode of ['mock', 'live']) for (const vertical of ['finance', 'health', 'retail']) for (const sc of SCENARIOS) {
      const body = await (await post(url, '/api/evaluate', { mode, vertical, scenario: sc.id }, W(`w-gt-${mode}`))).json();
      const t = body.trace;
      assert.deepEqual(assertTrace(t), [], `${mode}/${vertical}/${sc.id}`);
      assert.equal(t.source, 'mock');
      assert.deepEqual(t.decisions.map((d) => d.id), ['pattern', 'purpose', 'similarity', 'behaviour']);
      assert.ok(t.decisions.every((d) => d.basis === 'checked'));
      assert.ok(new URL(t.request.url).hostname.endsWith('.invalid'));
      assert.equal(t.response.status, body.blocked ? 403 : body.heldForPerson ? 202 : 200);
      assert.equal(t.response.body.decision, body.decision);
      // a refusal in the verdict is a failed decision, and only the deterministic ones can fail
      const failed = t.decisions.filter((d) => d.outcome === 'fail').map((d) => d.id);
      assert.equal(failed.length > 0, body.decision === 'deny', `${mode}/${vertical}/${sc.id}`);
      assert.ok(failed.every((id) => ['pattern', 'purpose'].includes(id)));
      // a held call is "for information" on the signal that held it, never a pass
      if (body.heldForPerson) assert.ok(t.decisions.some((d) => d.outcome === 'info' && /held for a person/.test(d.evidence)), `${mode}/${vertical}/${sc.id}`);
    }
  });
});

test('each decision is what decide() recorded: the refusing signal fails, the others read from their own findings', async () => {
  await withServer(async (url) => {
    const run = async (scenario, extra = {}) => (await post(url, '/api/evaluate', { mode: 'live', scenario, ...extra }, W('w-gt-d'))).json();
    const ok = (await run('legit-lookup')).trace;
    assert.deepEqual(Object.values(byId(ok)).map((d) => d.outcome), ['pass', 'pass', 'pass', 'pass']);
    const bulk = await run('bulk-export');
    assert.equal(bulk.decision, 'deny');
    assert.equal(byId(bulk.trace).pattern.outcome, 'fail');
    assert.equal(byId(bulk.trace).purpose.outcome, 'fail'); // invoices.export is outside the declared Methods as well
    assert.equal(byId(bulk.trace).similarity.outcome, 'info'); // held, not passed
    const reworded = await run('reworded-payee');
    assert.equal(reworded.decision, 'ask');
    assert.deepEqual(Object.values(byId(reworded.trace)).map((d) => d.outcome), ['pass', 'pass', 'info', 'pass']);
    const none = await run('no-purpose');
    assert.equal(byId(none.trace).purpose.outcome, 'fail');
    assert.match(byId(none.trace).purpose.evidence, /no purpose/);
    // a new agent has a baseline in the learning phase: nothing was scored, so it is "for information", never a pass
    const fresh = await run('new-agent');
    assert.equal(fresh.decision, 'allow');
    assert.equal(byId(fresh.trace).behaviour.outcome, 'info');
    assert.match(byId(fresh.trace).behaviour.evidence, /learning|nothing is scored/);
    // negative control: the same call under a policy that does not refuse patterns is an alert, which is not a failure and not a pass
    const soft = await run('bulk-export', { policy: { intent: { patternRefuse: false }, purpose: { refuseNone: false, refuseOutside: false, refuseAxis: false } } });
    assert.notEqual(soft.decision, 'deny');
    assert.equal(byId(soft.trace).pattern.outcome, 'info');
    assert.match(byId(soft.trace).pattern.evidence, /alert raised/);
    // Mock reads the same decision from the table row
    const mock = await (await post(url, '/api/evaluate', { mode: 'mock', scenario: 'bulk-export' }, W('w-gt-d'))).json();
    assert.equal(byId(mock.trace).pattern.outcome, 'fail');
    assert.match(mock.trace.record, /Mock: the signals were read from the generated mock table/);
  });
});

test('a call of the visitor\'s own (Live) is traced too, and typed text reaches the trace only as the reply shows it (masked)', async () => {
  await withServer(async (url) => {
    const typed = `password ${BEARER}`;
    const body = await (await post(url, '/api/evaluate', { mode: 'live', call: { tool: 'invoices.lookup', description: typed, args: { record: 'INV-1003' } } }, W('w-gt-c'))).json();
    assert.deepEqual(assertTrace(body.trace), []);
    assert.equal(body.trace.source, 'mock');
    assert.ok(!JSON.stringify(body.trace).includes(BEARER));
    assert.deepEqual(body.trace.request.body, body.call);
  });
});

// ---- the real hop, against a fake gateway ----
const ENV = ['CENTRAL_AGENT_A2A_URL', 'CENTRAL_AGENT_A2A_BEARER'];
async function withFakeGateway(handler, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.CENTRAL_AGENT_A2A_URL = 'https://aigw.example.invalid/a2a';
  process.env.CENTRAL_AGENT_A2A_BEARER = BEARER;
  const real = globalThis.fetch; const seen = [];
  globalThis.fetch = async (u, init) => {
    if (!String(u).includes('aigw.example.invalid')) return real(u, init);
    seen.push({ u: String(u), auth: init?.headers?.authorization });
    return handler();
  };
  try { await fn(seen); } finally {
    globalThis.fetch = real;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const reply = (status, body, headers = {}) => () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

test('real hop: allow, block and redact answers each get a real trace: nothing checked, the verdict observed, no secret anywhere', async () => {
  const cases = [
    { name: 'allow', h: reply(200, { jsonrpc: '2.0', id: 'x', result: { status: { state: 'completed' } } }, { 'x-request-id': 'req-9', 'set-cookie': `sid=${BEARER}` }), decision: 'allow', verdict: 'pass', outcomes: ['pass', 'pass', 'pass'] },
    { name: 'block', h: reply(200, { jsonrpc: '2.0', id: 'x', error: { code: -32600, message: `request blocked by security policy ${BEARER}` } }), decision: 'deny', verdict: 'fail', outcomes: ['pass', 'fail', 'fail'] },
    { name: 'redact', h: reply(200, { jsonrpc: '2.0', id: 'x', result: { status: { state: 'completed' }, text: '[REDACTED:card]' } }), decision: 'deny', verdict: 'fail', outcomes: ['pass', 'pass', 'fail'] },
  ];
  for (const c of cases) {
    await withFakeGateway(c.h, async (seen) => {
      await withServer(async (url) => {
        const res = await post(url, '/api/privilege-check', { text: 'an ordinary call' }, W('w-gt-r'));
        assert.equal(res.status, 200);
        const body = await res.json();
        const t = body.trace;
        assert.equal(body.mapped.decision, c.decision, c.name);
        assert.deepEqual(assertTrace(t), [], c.name);
        assert.equal(t.source, 'real');
        assert.ok(t.decisions.every((d) => d.basis === 'inferred' || d.basis === 'observed'), c.name);
        assert.deepEqual(t.decisions.map((d) => d.outcome), c.outcomes, c.name);
        assert.equal(byId(t).verdict.basis, 'observed');
        assert.equal(t.request.url, 'https://aigw.example.invalid/a2a/jsonrpc'); // no query, and exactly where the lab called
        assert.deepEqual(t.request.body.params.metadata, { source: 'intent-purpose-behaviour-lab' });
        assert.deepEqual(Object.keys(t.request.headers).sort(), ['authorization', 'content-type']);
        assert.match(t.request.headers.authorization, /^Bearer <token, \d+ characters, kept on the server>$/);
        assert.equal(seen[0].auth, `Bearer ${BEARER}`); // the real bearer did go to the gateway ...
        assert.ok(!JSON.stringify(t).includes(BEARER), c.name); // ... and is nowhere in the trace, even when the gateway echoes it in its own answer
        assert.ok(!JSON.stringify({ ...body, raw: undefined }).includes(BEARER), c.name);
        assert.equal(t.response.headers['set-cookie'], undefined, 'response headers are an allowlist');
      });
    });
  }
});

test('real hop: a 401 is an inferred refusal, an answer of unknown shape is for information, and a timeout is a failure trace with no response', async () => {
  await withFakeGateway(reply(401, 'invalid token'), async () => {
    await withServer(async (url) => {
      const body = await (await post(url, '/api/privilege-check', { text: 'x' }, W('w-gt-r2'))).json();
      assert.deepEqual(assertTrace(body.trace), []);
      assert.equal(body.trace.response.status, 401);
      assert.deepEqual(body.trace.decisions.map((d) => [d.id, d.outcome, d.basis]), [['authenticated', 'fail', 'inferred'], ['grant', 'skipped', 'inferred'], ['verdict', 'info', 'observed']]);
    });
  });
  await withFakeGateway(reply(200, { jsonrpc: '2.0', id: 'x', result: {} }), async () => {
    await withServer(async (url) => {
      const t = (await (await post(url, '/api/privilege-check', { text: 'x' }, W('w-gt-r3'))).json()).trace;
      assert.deepEqual(assertTrace(t), []);
      assert.equal(byId(t).verdict.outcome, 'info');
    });
  });
  await withFakeGateway(() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, async () => {
    await withServer(async (url) => {
      const res = await post(url, '/api/privilege-check', { text: 'x' }, W('w-gt-r4'));
      assert.equal(res.status, 504);
      const body = await res.json();
      assert.deepEqual(assertTrace(body.trace), []);
      assert.equal(body.trace.response, null);
      assert.equal(body.trace.decisions[0].outcome, 'fail');
      assert.ok(!JSON.stringify(body).includes(BEARER));
    });
  });
});

test('the unit builders keep the honesty rule on their own: a real trace never says checked; the failure trace never shows the bearer', () => {
  const cfg = { bearer: BEARER };
  const t = aiGuardFailure({ cfg, sent: { url: `https://aigw.example.invalid/a2a/jsonrpc?x=${BEARER}`, body: { note: BEARER } }, error: 'no answer' });
  assert.deepEqual(assertTrace(t), []);
  assert.ok(!JSON.stringify(t).includes(BEARER));
  assert.equal(t.request.url, 'https://aigw.example.invalid/a2a/jsonrpc', 'the query string is never shown');
  const cast = { castHost: 'fabrikam' };
  const out = { call: { tool: 'a.b', args: {} }, reasons: [], signals: { intent: { deterministic: { matched: [] }, semantic: { riskScore: 0 } }, purpose: { declared: null } }, decision: 'allow', reasonCode: 'ALLOW', decidedBy: 'none', mode: 'live' };
  assert.deepEqual(assertTrace(evaluateTrace({ cast, out, traceparent: 'x' })), []);
});
