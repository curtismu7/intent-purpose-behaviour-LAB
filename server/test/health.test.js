import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { post } from './helpers.js';

async function health(runChecks) {
  const h = createHealth({ runChecks, intervalMs: 3_600_000 });
  await h.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health: h }) });
  const base = url.replace(/\/$/, '');
  try { return await (await fetch(`${base}/api/health`)).json(); } finally { h.stop(); await new Promise((r) => server.close(r)); }
}

test('health states: ready when every check passes, broken when one fails, unknown when the checks throw', async () => {
  assert.equal((await health(async () => [{ id: 'a', level: 'pass', detail: '' }, { id: 'b', level: 'info', detail: '' }])).state, 'ready');
  const broken = await health(async () => [{ id: 'a', level: 'pass', detail: '' }, { id: 'b', level: 'fail', detail: 'secret detail that must not leak' }]);
  assert.equal(broken.state, 'broken');
  assert.ok(!JSON.stringify(broken).includes('secret detail'), 'no check detail in the public answer');
  assert.equal(broken.schema, 'demo-health/1');
  assert.deepEqual(Object.keys(broken).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  const unknown = await health(async () => { throw new Error('boom /Users/x/secret.js'); });
  assert.equal(unknown.state, 'unknown');
  assert.ok(!JSON.stringify(unknown).includes('boom'));
});

test('an unexpected server error becomes a short JSON 500 with no message, stack or file path', async () => {
  const exploding = { runs() { return { runs: [] }; }, record() { throw new Error('boom at /Users/someone/secret/file.js:12:3'); }, baseline() { throw new Error('boom'); }, logBaseline() {}, reset() {} };
  const h = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health: h, workspaces: exploding }) });
  const base = url.replace(/\/$/, '');
  try {
    for (const [path, body] of [['/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }], ['/api/baseline', { mode: 'live', kind: 'normal' }]]) {
      const r = await post(base, path, body);
      const text = await r.text();
      assert.equal(r.status, 500, path);
      assert.equal(text, JSON.stringify({ error: 'internal_error' }), path);
      assert.ok(!/boom|\/Users\/|node_modules|at \w+ \(/.test(text));
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200, 'the server stays up');
  } finally { h.stop(); await new Promise((r) => server.close(r)); }
});
