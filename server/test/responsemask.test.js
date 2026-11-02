// The response mask (maskDeep) is a second layer: it must leave the app's own, legitimate answers byte-for-byte alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { maskDeep } from '../src/mask.js';
import { BASELINE_KINDS, SCENARIOS } from '../src/data.js';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { MOCK_TABLE } from '../src/mockTable.js';
import { createWorkspaces } from '../src/workspaces.js';

test('the response mask changes nothing in any scripted answer: every scenario, vertical and mode, baseline, hops and all', async () => {
  await withServer(async (url) => {
    const post = (path, b) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(b) }).then((r) => r.json());
    let checked = 0;
    for (const vertical of ['finance', 'health', 'retail']) {
      for (const mode of ['mock', 'live']) {
        for (const s of SCENARIOS) {
          const j = await post('/api/evaluate', { mode, vertical, scenario: s.id });
          assert.ok(j.hops, `${vertical} ${mode} ${s.id}`);
          assert.deepEqual(maskDeep(j), j, `${vertical} ${mode} ${s.id}`); checked += 1;
        }
      }
      assert.deepEqual(maskDeep(await post('/api/baseline', { mode: 'mock', vertical })), await post('/api/baseline', { mode: 'mock', vertical }));
      for (const kind of BASELINE_KINDS) { const j = await post('/api/baseline', { mode: 'live', vertical, kind }); assert.deepEqual(maskDeep(j), j, kind); checked += 1; }
      const g = await (await fetch(`${url}/api/baseline?mode=live&vertical=${vertical}`)).json();
      assert.deepEqual(maskDeep(g), g);
    }
    assert.ok(checked >= 6 * 8 + 3 * BASELINE_KINDS.length, `only ${checked} answers were compared`);
    const dump = JSON.stringify(await post('/api/evaluate', { mode: 'live', scenario: 'bulk-export' }));
    assert.ok(dump.includes('Authorization: Bearer <MOCK-ISSUED token>'));
  });
});

test('the response layer holds even if a code path forgot to clean its input: a poisoned table row is masked, in strings and in object keys', async () => {
  const table = structuredClone(MOCK_TABLE);
  const row = table.scenarios.finance['payee-change'];
  row.intent.deterministic.matched = [{ id: 'x', class: 'password hunter2xyz', label: 'my token is hunter2xyz' }];
  row.intent['api_key = hunter2xyz'] = 1;
  table.baseline.finance[0].intent.deterministic.matched = [{ id: 'x', class: 'token is hunter2xyz', label: 'x' }];
  const health = createHealth({ intervalMs: 3_600_000 }); await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, table, configFile: '/nonexistent/customer.config.json' }) });
  try {
    const base = url.replace(/\/$/, '');
    const r = await fetch(`${base}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ mode: 'mock', scenario: 'payee-change' }) });
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(text.includes('[masked]'), 'the poisoned row was masked, not dropped');
    assert.ok(!text.includes('hunter2xyz'), text.slice(0, 400));
    assert.ok(text.includes('"[masked]":1'), 'a poisoned object key is masked too');
    for (const [method, path, body] of [['POST', '/api/baseline', { mode: 'mock' }], ['GET', '/api/baseline?mode=mock']]) {
      const b = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', origin: base }, body: body && JSON.stringify(body) });
      const bt = await b.text();
      assert.equal(b.status, 200, path);
      assert.ok(bt.includes('[masked]') && !bt.includes('hunter2xyz'), `${method} ${path}: ${bt.slice(0, 200)}`);
    }
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});

test('the response layer also covers the Live baseline answers (a poisoned learner is masked in POST and GET)', async () => {
  const real = createWorkspaces();
  const poisoned = Object.assign(Object.create(real), {
    baseline: (id) => { const b = real.baseline(id); b.learner.tools.set('api_key = hunter2xyz', 1); return b; },
  });
  const health = createHealth({ intervalMs: 3_600_000 }); await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, workspaces: poisoned, configFile: '/nonexistent/customer.config.json' }) });
  try {
    const base = url.replace(/\/$/, '');
    const post = await fetch(`${base}/api/baseline`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ mode: 'live', kind: 'normal' }) });
    const get = await fetch(`${base}/api/baseline?mode=live`);
    for (const r of [post, get]) { const t = await r.text(); assert.equal(r.status, 200); assert.ok(t.includes('[masked]') && !t.includes('hunter2xyz'), t.slice(0, 300)); }
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});
