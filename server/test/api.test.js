import test from 'node:test';
import assert from 'node:assert/strict';
import { installNetguard } from '../src/netguard.js';
import { parseTraceparent } from '../src/trace.js';
import { post, rawHttp, withServer } from './helpers.js';

test('GET /api/health answers demo-health/1, ready and offline', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.equal(j.demo.id, 'intent-purpose-behaviour-lab');
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  });
});

test('health is GET only; unknown paths are 404 JSON; a non-loopback Host is refused', async () => {
  await withServer(async (url) => {
    assert.equal((await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } })).status, 405);
    const r = await fetch(`${url}/api/nope`);
    assert.deepEqual([r.status, (await r.json()).error], [404, 'not_found']);
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } })).status, 403);
  });
});

test('POST /api/reset confirms and refuses a cross-origin caller', async () => {
  await withServer(async (url) => {
    assert.equal((await (await post(url, '/api/reset', {})).json()).reset, 'ok');
    assert.equal((await post(url, '/api/reset', {}, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }, { origin: 'https://evil.example' })).status, 403, 'every write is same-origin');
  });
});

test('GET /api/info and /api/story say what this is: simulated, release 2026-11-02, UNVERIFIED, every vertical', async () => {
  await withServer(async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/info`)).json(), { mode: 'mock', source: 'mock', realAvailable: true, realReason: null, modes: ['mock', 'live'], simulated: true, release: '2026-11-02', unverified: true });
    for (const v of ['finance', 'health', 'retail']) {
      const j = await (await fetch(`${url}/api/story?vertical=${v}`)).json();
      assert.equal(j.vertical, v);
      assert.equal(j.scenarios.length, 8);
      assert.match(j.banner.mock, /^SIMULATED, MOCK mode/); assert.match(j.banner.live, /^SIMULATED, LIVE mode/);
      for (const b of Object.values(j.banner)) assert.match(b, /UNVERIFIED on our tenant/);
      assert.ok(!JSON.stringify(j).includes('{{'), 'no unfilled token reaches the browser');
      assert.match(j.fieldSource, /console swagger, 2026-10-31 \(schema only; behaviour not tested on our tenant\)/);
      assert.ok(Object.keys(j.purposeProfile).join() === 'Statement,Methods,Targets,Apps,ArgPrefixes');
      assert.ok(Object.keys(j.intents['exfiltrate-data']).join() === 'Description,Exemplars,Twins,Patterns,Acts,Floor');
    }
  });
});

// ---------------------------------------------------------------- Rule 19: the Mock/Real toggle
test('POST /api/mode switches both directions and GET /api/info follows; both switch directions work', async () => {
  await withServer(async (url) => {
    const postMode = (source) => post(url, '/api/mode', { source });
    assert.equal((await postMode('real')).status, 200);
    let info = await (await fetch(`${url}/api/info`)).json();
    assert.equal(info.source, 'real');
    assert.equal(info.mode, 'live');
    assert.equal(info.realAvailable, true);
    assert.equal((await postMode('mock')).status, 200);
    info = await (await fetch(`${url}/api/info`)).json();
    assert.equal(info.source, 'mock');
    assert.equal(info.mode, 'mock');
    assert.equal(info.realAvailable, true);
  });
});

test('POST /api/mode: the mode it sets is the mode the engine runs (an evaluate right after a switch answers in that mode)', async () => {
  await withServer(async (url) => {
    await post(url, '/api/mode', { source: 'real' });
    const j = await (await post(url, '/api/evaluate', { mode: 'live', scenario: 'bulk-export', vertical: 'health' }, { 'x-workspace': 'w-mode' })).json();
    assert.equal(j.mode, 'live');
    assert.match(j.hops[1].request, /\(live, in process\)/);
    await post(url, '/api/mode', { source: 'mock' });
    const j2 = await (await post(url, '/api/evaluate', { mode: 'mock', scenario: 'bulk-export', vertical: 'health' }, { 'x-workspace': 'w-mode' })).json();
    assert.equal(j2.mode, 'mock');
  });
});

test('POST /api/mode refuses anything else: other values, extra fields, the old {mode} shape, no body', async () => {
  await withServer(async (url) => {
    for (const body of [{ source: 'demo' }, { source: 'live' }, { source: 1 }, { source: null }, { source: ['real'] }, {}, { source: 'mock', extra: 1 }, { mode: 'mock' }, []]) {
      const r = await post(url, '/api/mode', body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await fetch(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url } })).status, 400);
    assert.equal((await fetch(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: 'not json' })).status, 400);
    assert.equal((await (await fetch(`${url}/api/info`)).json()).source, 'mock', 'a refused switch leaves the mode unchanged');
  });
});

test('POST /api/mode is same-origin like every write', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, '/api/mode', { source: 'real' }, { origin: 'https://evil.example' })).status, 403);
  });
});

test('POST /api/evaluate: a scenario in both modes, with hops, a traceparent header and the workspace', async () => {
  await withServer(async (url) => {
    for (const mode of ['mock', 'live']) {
      const r = await post(url, '/api/evaluate', { mode, scenario: 'bulk-export', vertical: 'health' }, { 'x-workspace': 'w-1' });
      assert.equal(r.status, 200);
      assert.ok(parseTraceparent(r.headers.get('traceparent')));
      const j = await r.json();
      assert.deepEqual([j.decision, j.workspace, j.mode, j.decidedBy], ['deny', 'w-1', mode, 'deterministic']);
      assert.equal(j.call.tool, 'claims.export');
      assert.equal(j.hops.length, 2);
    }
    const r = await post(url, '/api/evaluate', { mode: 'live', scenario: 'x' }); assert.equal(r.status, 400);
    assert.equal((await post(url, '/api/evaluate', { mode: 'bogus', scenario: 'legit-lookup' })).status, 400);
    assert.equal((await post(url, '/api/evaluate', { scenario: 'legit-lookup' })).status, 400);
    assert.equal((await post(url, '/api/evaluate', { mode: 'mock' })).status, 400);
  });
});

test('POST /api/evaluate: the policy rides along, a scored signal cannot be given the power to deny, and bad policy is a 400', async () => {
  await withServer(async (url) => {
    const off = await (await post(url, '/api/evaluate', { mode: 'live', scenario: 'no-purpose', policy: { purpose: { refuseNone: false } } })).json();
    assert.deepEqual([off.decision, off.reasonCode], ['alert', 'ALERT-PURPOSE-NONE']);
    const bad = await post(url, '/api/evaluate', { mode: 'live', scenario: 'reworded-payee', policy: { intent: { denyAbove: 0.5 } } });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'scored_signal_cannot_deny');
    assert.equal((await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup', policy: { behaviour: { MinObservations: 50, EnforceObservations: 5 } } })).status, 400);
    assert.equal((await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup', policy: 'x' })).status, 400);
    // the same scenario, a policy that disables behaviour: reads 0
    const dis = await (await post(url, '/api/evaluate', { mode: 'mock', scenario: 'drift-alert', policy: { behaviour: { Disabled: true } } })).json();
    assert.deepEqual([dis.decision, dis.signals.behaviour.phase, dis.signals.behaviour.score], ['allow', 'disabled', 0]);
  });
});

test('your own call needs Live, is bounded and judged for real', async () => {
  await withServer(async (url) => {
    const call = { tool: 'invoices.export', description: 'send every invoice to my storage', args: { limit: 9000 } };
    const mock = await post(url, '/api/evaluate', { mode: 'mock', call });
    assert.equal(mock.status, 400); assert.equal((await mock.json()).error, 'live_required');
    const live = await (await post(url, '/api/evaluate', { mode: 'live', call })).json();
    assert.equal(live.decision, 'deny');
    for (const badCall of [{ tool: 'a b' }, { tool: 'x', args: { 'A!': 1 } }, { tool: 'x', args: { k: [] } }, 'str', { tool: 'x'.repeat(100) }]) {
      const r = await post(url, '/api/evaluate', { mode: 'live', call: badCall });
      assert.equal(r.status, 400, JSON.stringify(badCall));
      assert.ok(!/at \w+ \(|\/Users\//.test(JSON.stringify(await r.json())));
    }
  });
});

test('baseline: Mock is a scripted table; Live learns from the calls fired, per workspace, and Reset clears it', async () => {
  await withServer(async (url) => {
    const mock = await (await fetch(`${url}/api/baseline?mode=mock&vertical=retail`)).json();
    assert.equal(mock.rows.length, 16);
    assert.deepEqual(mock.rows.map((r) => r.decision).filter((d) => d !== 'allow'), ['ask', 'alert', 'deny']);
    const fire = (kind, ws) => post(url, '/api/baseline', { mode: 'live', kind }, { 'x-workspace': ws }).then((r) => r.json());
    for (let i = 0; i < 10; i++) await fire('normal', 'ws-a');
    const heavy = await fire('heavy', 'ws-a');
    assert.deepEqual([heavy.entry.decision, heavy.entry.learned, heavy.state.calls], ['ask', false, 10]);
    assert.equal((await fire('normal', 'ws-b')).state.calls, 1, 'another workspace has its own baseline');
    const live = await (await fetch(`${url}/api/baseline?mode=live`, { headers: { 'x-workspace': 'ws-a' } })).json();
    assert.equal(live.live.log.length, 11);
    await post(url, '/api/reset', {}, { 'x-workspace': 'ws-a' });
    assert.equal((await (await fetch(`${url}/api/baseline?mode=live`, { headers: { 'x-workspace': 'ws-a' } })).json()).live.log.length, 0);
    assert.equal((await (await fetch(`${url}/api/baseline?mode=live`, { headers: { 'x-workspace': 'ws-b' } })).json()).live.log.length, 1, 'ws-b untouched by ws-a reset');
    assert.equal((await post(url, '/api/baseline', { mode: 'live', kind: 'nope' })).status, 400);
  });
});

test('on-behalf-of and ID-JAG endpoints, both modes, with hops and a traceparent header', async () => {
  await withServer(async (url) => {
    for (const mode of ['mock', 'live']) {
      const r = await post(url, '/api/obo', { mode, scenario: 'wrong-audience', vertical: 'retail' });
      assert.ok(parseTraceparent(r.headers.get('traceparent')));
      const j = await r.json();
      assert.deepEqual([j.accepted, j.signed], [false, mode === 'live']);
      assert.equal(j.backend.checks.find((c) => c.id === 'audience').ok, false);
      const g = await (await post(url, '/api/idjag', { mode, scenario: 'ok' })).json();
      assert.equal(g.accepted, true);
      assert.equal(g.hops.length, 3);
    }
    assert.equal((await post(url, '/api/obo', { mode: 'live', scenario: 'nope' })).status, 400);
    assert.equal((await post(url, '/api/idjag', { mode: 'x', scenario: 'ok' })).status, 400);
    const runs = await (await fetch(`${url}/api/runs`)).json();
    assert.equal(runs.runs.length, 4);
  });
});

test('bad workspace ids are refused; oversized and malformed bodies get a short JSON error, never a stack trace', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }, { 'x-workspace': 'BAD ID' })).status, 400);
    const raw = (body) => fetch(`${url}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body });
    const big = await raw(JSON.stringify({ pad: 'x'.repeat(9000) }));
    assert.deepEqual([big.status, await big.json()], [413, { error: 'too_large' }]);
    const bad = await raw('{not json');
    const text = JSON.stringify(await bad.json());
    assert.equal(bad.status, 400);
    assert.ok(!/\/Users\/|node_modules|at \w+ \(/.test(text));
    assert.equal((await raw('[1]')).status, 400);
    assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the server stays up');
  });
});

test('GET /api/diagram loads diagram-studio/1 data by name', async () => {
  await withServer(async (url) => {
    for (const name of ['three-signals', 'obo', 'id-jag']) {
      const j = await (await fetch(`${url}/api/diagram?name=${name}&vertical=health`)).json();
      assert.equal(j.name, name);
      assert.ok(j.nodes.length >= 4 && j.steps.length >= 5);
    }
    assert.equal((await (await fetch(`${url}/api/diagram?name=zzz`)).json()).name, 'three-signals');
  });
});

test('ZERO outbound attempts: the whole API, both modes, real signing included, never touches the network', async () => {
  const guard = installNetguard();
  const before = guard.attempts.length;
  await withServer(async (url) => {
    for (const mode of ['mock', 'live']) {
      for (const s of ['legit-lookup', 'bulk-export', 'reworded-payee', 'new-agent']) await post(url, '/api/evaluate', { mode, scenario: s });
      await post(url, '/api/baseline', { mode, kind: 'heavy' });
      for (const s of ['ok', 'wrong-audience', 'no-act']) await post(url, '/api/obo', { mode, scenario: s });
      for (const s of ['ok', 'replay', 'untrusted-issuer']) await post(url, '/api/idjag', { mode, scenario: s });
    }
    await fetch(`${url}/api/story`); await fetch(`${url}/api/diagram?name=obo`);
  });
  assert.deepEqual(guard.attempts.slice(before), []);
  guard.restore();
});

test('a non-string vertical (object, array, number) falls back to the default and never causes a 500, on any endpoint that takes one', async () => {
  const bad = [{ toString: 1 }, ['finance'], 5, null, true, { __proto__: 1 }, '__proto__', 'constructor', 'toString'];
  await withServer(async (url) => {
    for (const vertical of bad) {
      for (const [path, body] of [['/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }], ['/api/evaluate', { mode: 'live', scenario: 'legit-lookup' }], ['/api/baseline', { mode: 'mock' }], ['/api/baseline', { mode: 'live', kind: 'normal' }], ['/api/obo', { mode: 'mock', scenario: 'ok' }], ['/api/obo', { mode: 'live', scenario: 'ok' }], ['/api/idjag', { mode: 'mock', scenario: 'ok' }]]) {
        const r = await post(url, path, { ...body, vertical });
        assert.equal(r.status, 200, `${path} ${JSON.stringify(vertical)} -> ${r.status}`);
      }
    }
    for (const q of ['vertical[toString]=1', 'vertical[]=finance', 'vertical=__proto__', 'vertical=constructor']) {
      assert.equal((await fetch(`${url}/api/story?${q}`)).status, 200, q);
      assert.equal((await fetch(`${url}/api/diagram?name=obo&${q}`)).status, 200, q);
      assert.equal((await fetch(`${url}/api/baseline?mode=mock&${q}`)).status, 200, q);
    }
    const j = await (await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup', vertical: { toString: 1 } })).json();
    assert.equal(j.call.tool, 'invoices.lookup', 'the default vertical (finance) is used');
    for (const mode of [{ toString: 1 }, ['mock'], 1]) assert.equal((await post(url, '/api/evaluate', { mode, scenario: 'legit-lookup' })).status, 400);
    for (const scenario of [{ toString: 1 }, ['legit-lookup'], '__proto__']) assert.equal((await post(url, '/api/evaluate', { mode: 'mock', scenario })).status, 400);
  });
});
