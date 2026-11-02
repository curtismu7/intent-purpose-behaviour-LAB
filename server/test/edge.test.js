// The HTTP edge (shared-masker docs/EXPRESS-RECIPE.md, adopted in step B): the response mask on hops and errors, 415 with a fixed body, 405 with Allow from one
// route table, the page shell for page addresses only, a 400 for a malformed escape, the workspace-id rule that refuses before a slot exists, the catch-all
// error handler, and write-time masking of what the workspace store keeps. Every secret here is built from fragments so the source holds no scanner-visible literal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROUTES, createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { MOCK_TABLE } from '../src/mockTable.js';
import { createWorkspaces } from '../src/workspaces.js';

const H = ['hunter', '2xyz'].join('');

async function serve(fn, { workspaces = createWorkspaces(), table, webDist } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const app = createApp({ health, workspaces, configFile: '/nonexistent/customer.config.json', ...(table ? { table } : {}), ...(webDist ? { webDist } : {}) });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app });
  const base = url.replace(/\/$/, '');
  try { await fn(base, workspaces); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}
const send = (base, method, p, { headers = {}, body } = {}) => fetch(`${base}${p}`, { method, redirect: 'manual', headers: { origin: base, ...headers }, body });
const json = { 'content-type': 'application/json' };

function makeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-edge-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}
function capture() {
  const chunks = []; const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  process.stderr.write = (c) => { chunks.push(String(c)); return true; };
  return { text: () => chunks.join(''), stop: () => { process.stdout.write = o; process.stderr.write = e; } };
}

test('response mask on hops: a poisoned table value that reaches the hop panes is masked there, and in the error details', async () => {
  const table = structuredClone(MOCK_TABLE);
  table.scenarios.finance['payee-change'].intent.deterministic.matched = [{ id: `password ${H}`, class: 'x', label: 'x' }];
  await serve(async (base) => {
    const r = await send(base, 'POST', '/api/evaluate', { headers: json, body: JSON.stringify({ mode: 'mock', vertical: 'finance', scenario: 'payee-change' }) });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(!JSON.stringify(j).includes(H), JSON.stringify(j.hops));
    assert.equal(j.hops[0].response.split('\n')[2], 'x-reason: DENY-INTENT-PATTERN:[masked]');
    assert.equal(j.hops[1].response.split('\n')[1], 'reason: DENY-INTENT-PATTERN:[masked]');
  }, { table });
});

test('the token flows still show their MOCK-ISSUED tokens raw (the one exempt part), and the rest of the answer is masked like any other', async () => {
  await serve(async (base) => {
    for (const path of ['/api/obo', '/api/idjag']) {
      const r = await send(base, 'POST', path, { headers: json, body: JSON.stringify({ mode: 'live', scenario: 'ok' }) });
      const j = await r.json();
      assert.equal(r.status, 200, path);
      assert.match(j.original.token, /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/, path);
      assert.ok(j.hops.some((h) => h.request.includes(j.original.token)), `${path}: the token is in a hop pane, raw`);
      assert.match(j.label, /^MOCK-ISSUED teaching tokens/);
    }
  });
});

test('415: any charset but utf-8 is a fixed body, the value is never answered and nothing is logged', async () => {
  const cap = capture();
  const seen = [];
  try {
    await serve(async (base) => {
      for (const cs of ['utf-7', 'latin1', 'iso-8859-1', H, 'utf-8; charset=utf-7', '"utf-7"']) {
        const r = await send(base, 'POST', '/api/evaluate', { headers: { 'content-type': `application/json; charset=${cs}` }, body: '{}' });
        seen.push([r.status, await r.text(), r.headers.get('content-type')]);
      }
      const g = await send(base, 'GET', '/api/story', { headers: { 'content-type': `text/plain; charset=${H}` } });
      seen.push([g.status, await g.text(), g.headers.get('content-type')]);
      const ok = await send(base, 'POST', '/api/evaluate', { headers: { 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ mode: 'mock', scenario: 'legit-lookup' }) });
      assert.equal(ok.status, 200, 'utf-8 in any case still works');
    });
  } finally { cap.stop(); }
  assert.equal(seen.length, 7);
  for (const [status, text, ct] of seen) { assert.equal(status, 415); assert.equal(text, '{"error":"unsupported_charset"}'); assert.match(ct, /application\/json/); }
  assert.ok(!cap.text().includes(H) && !cap.text().includes('utf-7'), 'nothing typed is logged');
});

test('405 comes from one route table: every route answers its listed methods and refuses the others with the sorted Allow list', async () => {
  const expectedAllow = (methods) => [...new Set(methods.flatMap((m) => (m === 'GET' ? ['GET', 'HEAD'] : [m])))].sort().join(', ');
  await serve(async (base) => {
    assert.equal(Object.keys(ROUTES).length, 11);
    for (const [route, methods] of Object.entries(ROUTES)) {
      for (const m of methods) {
        const r = await send(base, m, route, { headers: json, body: m === 'GET' ? undefined : '{}' });
        assert.notEqual(r.status, 405, `${m} ${route} is allowed`);
        if (route !== '/') assert.notEqual(r.status, 404, `${m} ${route} exists`); // '/' is the page, which needs a built web/dist (tested below)
      }
      for (const m of ['PUT', 'PATCH', 'DELETE', 'OPTIONS'].filter((x) => !methods.includes(x))) {
        const r = await send(base, m, route, { headers: json, body: '{}' });
        assert.equal(r.status, 405, `${m} ${route}`);
        assert.equal(r.headers.get('allow'), expectedAllow(methods), `${m} ${route}`);
        assert.equal(await r.text(), '{"error":"method_not_allowed"}');
      }
    }
    for (const p of ['/API/Evaluate', '/api/evaluate/']) {
      const r = await send(base, 'GET', p);
      assert.equal(r.status, 405, p); assert.equal(r.headers.get('allow'), 'POST', p);
    }
    for (const p of ['/api/evaluate//', '//api/evaluate', '/api/evaluat', '/api/evaluate/x']) assert.equal((await send(base, 'PUT', p, { headers: json, body: '{}' })).status, 404, `${p} is not in the table`);
  });
});

test('the page shell is for page addresses only: /assets and /assets/ are a JSON 404, a real asset is served, a client that wants JSON gets no page', async () => {
  await serve(async (base) => {
    const html = { accept: 'text/html' };
    for (const p of ['/assets', '/assets/', '/static', '/static/x', '/assets/missing.js', '/assets/sub/', '/api', '/api/']) {
      for (const m of ['GET', 'HEAD']) {
        const r = await send(base, m, p, { headers: html });
        assert.equal(r.status, 404, `${m} ${p}`);
        assert.match(r.headers.get('content-type'), /application\/json/);
        if (m === 'GET') assert.equal(await r.text(), '{"error":"not_found"}', p);
      }
    }
    for (const p of ['/', '/about', '/tab/three-signals', '/tab/three-signals/']) {
      const r = await send(base, 'GET', p, { headers: html });
      assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(await r.text(), /<title>shell<\/title>/);
    }
    for (const [accept, status] of [['application/json', 404], ['image/png', 404], ['text/html,application/xhtml+xml', 200], ['*/*', 200]]) assert.equal((await send(base, 'GET', '/about', { headers: { accept } })).status, status, accept);
    assert.equal((await send(base, 'GET', '/about')).status, 200, 'no Accept header at all still gets the page');
    assert.equal((await send(base, 'GET', '/assets/app.js')).status, 200);
    for (const p of ['/a.b/c', '/%2Eenv', '/x.']) assert.equal((await send(base, 'GET', p, { headers: html })).status, 404, p);
    assert.equal((await send(base, 'POST', '/about', { headers: { ...json, ...html }, body: '{}' })).status, 404, 'POST never gets the page');
  }, { webDist: makeDist() });
});

test('a malformed percent-escape is a 400 with a fixed body, under any path and method, with or without a built page', async () => {
  for (const webDist of [makeDist(), path.join(os.tmpdir(), 'ipb-edge-no-dist')]) {
    await serve(async (base) => {
      for (const p of ['/%', '/%zz', '/%E0%A4%A', '/api/%', '/api/story/%zz', '/assets/%', '/a/%2']) {
        for (const m of ['GET', 'POST']) {
          const r = await send(base, m, p, { headers: json, body: m === 'POST' ? '{}' : undefined });
          assert.equal(r.status, 400, `${m} ${p}`); assert.equal(await r.text(), '{"error":"bad_request"}');
        }
      }
      assert.equal((await send(base, 'GET', '/%41bout')).status, webDist.includes('no-dist') ? 404 : 200, 'a well-formed escape is not an error');
    }, { webDist });
  }
});

test('workspace ids: one that isCredentialId flags is a 400 bad_workspace on every route that uses one, before any slot exists; routes that use none are unaffected', async () => {
  const ids = ['w-password-abc123', ['x-sec', 'ret-abc123'].join(''), 'run-bearer-ab12cd', 'the-pass-is-hunter2', 'w-pw-hunter2', ['a1b2c3d4e5f6', 'a7b8c9d0e1f2'].join(''), 'sk-abcdefgh', 'pw-1'];
  await serve(async (base, workspaces) => {
    const routes = [['POST', '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }], ['GET', '/api/baseline?mode=mock'], ['POST', '/api/baseline', { mode: 'mock' }], ['POST', '/api/obo', { mode: 'mock', scenario: 'ok' }],
      ['POST', '/api/idjag', { mode: 'mock', scenario: 'ok' }], ['GET', '/api/runs'], ['POST', '/api/reset', {}]];
    for (const id of ids) {
      for (const [m, p, body] of routes) {
        const r = await send(base, m, p, { headers: { ...json, 'x-workspace': id }, body: body === undefined ? undefined : JSON.stringify(body) });
        assert.equal(r.status, 400, `${m} ${p} ${id}`);
        assert.equal(await r.text(), '{"error":"bad_workspace"}');
      }
    }
    assert.equal(workspaces.size(), 0, 'no slot was taken by a refused id');
    for (const p of ['/api/story', '/api/info', '/api/health', '/api/diagram', '/api/nope', '/nope']) {
      const r = await send(base, 'GET', p, { headers: { 'x-workspace': ids[0] } });
      assert.ok([200, 404].includes(r.status), p);
    }
    assert.equal(workspaces.size(), 0, 'info routes and 404s take no slot either');
    const ok = await send(base, 'POST', '/api/evaluate', { headers: { ...json, 'x-workspace': 'w-0123456789abcdef' }, body: JSON.stringify({ mode: 'mock', scenario: 'legit-lookup' }) });
    assert.equal(ok.status, 200);
    assert.equal(workspaces.size(), 1, 'a good id takes exactly one slot');
  });
});

test('the catch-all error handler: a fixed code from a short list, never the message, the stack, the path or the typed body', async () => {
  await serve(async (base) => {
    const cases = [
      [{ ...json }, `{"call":{"description":"password ${H}"`, 400, 'bad_request'],
      [{ ...json, 'content-encoding': 'br' }, '{}', 415, 'unsupported_charset'],
      [{ ...json }, JSON.stringify({ pad: `${'x'.repeat(9000)} ${H}` }), 413, 'too_large'],
      [{ ...json }, '[1,2', 400, 'bad_request'],
    ];
    for (const [headers, body, status, code] of cases) {
      const r = await send(base, 'POST', '/api/evaluate', { headers, body });
      assert.equal(r.status, status);
      assert.equal(await r.text(), JSON.stringify({ error: code }));
    }
  });
});

test('write-time masking: what the workspace store keeps is masked when it is written, so a Reset-surviving copy never holds a secret', () => {
  const ws = createWorkspaces();
  ws.record('w-a', { tab: 'signals', scenario: `password ${H}`, decision: 'allow', [`api_key=${H}`]: 1 });
  ws.logBaseline('w-a', { n: 1, kind: `token ${H}`, call: { note: `the key is ${H}` } });
  const text = JSON.stringify([ws.runs('w-a'), ws.baseline('w-a').log]);
  assert.ok(!text.includes(H), text);
  assert.equal(ws.runs('w-a').runs[0].scenario, '[masked]');
  assert.equal(ws.baseline('w-a').log[0].kind, '[masked]');
  assert.equal(ws.baseline('w-a').log[0].call.note, '[masked]');
});
