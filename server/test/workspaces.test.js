import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RUNS, WORKSPACE_RE, createWorkspaces, credentialLookingId, workspaceFrom } from '../src/workspaces.js';
import { withServer } from './helpers.js';
import { HEX24, HEX40, K, SK, UUID } from './payloads.js';

test('workspaceFrom defaults, accepts a good id and refuses a bad one', () => {
  assert.equal(workspaceFrom({ headers: {} }), 'default');
  assert.equal(workspaceFrom({ headers: { 'x-workspace': 'abc-1' } }), 'abc-1');
  for (const bad of ['', 'A', 'a b', 'a/b', 'x'.repeat(41), ['a']]) assert.equal(workspaceFrom({ headers: { 'x-workspace': bad } }), null);
  assert.ok(WORKSPACE_RE.test('a'));
});

test('workspaces are isolated, runs are bounded, reset is per workspace', () => {
  const w = createWorkspaces();
  for (let i = 0; i < MAX_RUNS + 5; i++) w.record('a', { scenario: 's', decision: 'allow' });
  w.record('b', { scenario: 's', decision: 'deny' });
  assert.equal(w.runs('a').runs.length, MAX_RUNS);
  w.reset('a');
  assert.equal(w.runs('a').runs.length, 0);
  assert.equal(w.runs('b').runs.length, 1);
});

test('the store expires old workspaces and caps their count', () => {
  let t = 0;
  const w = createWorkspaces({ max: 3, ttlMs: 100, now: () => t });
  for (const id of ['a', 'b', 'c', 'd']) w.record(id, { scenario: 's', decision: 'allow' });
  assert.equal(w.size(), 3);
  t = 500;
  assert.equal(w.runs('d').runs.length, 0);
  assert.equal(w.size(), 0);
});

// A kebab id of exactly n characters ("xy-xy-..."; x and y are not hex digits).
const kebab = (n) => 'xy-'.repeat(Math.ceil(n / 3)).slice(0, n).replace(/-$/, 'y');

test('workspace ids: 40 characters accepted, 41 refused (literal boundary)', () => {
  assert.equal(kebab(40).length, 40);
  assert.equal(workspaceFrom({ headers: { 'x-workspace': kebab(40) } }), kebab(40));
  assert.equal(workspaceFrom({ headers: { 'x-workspace': kebab(41) } }), null);
  assert.equal(workspaceFrom({ headers: { 'x-workspace': 'a' } }), 'a');
  assert.equal(workspaceFrom({ headers: { 'x-workspace': '' } }), null);
});

test('workspace ids that look like a credential are refused: 24+ hex digits (23 are not), prefixes, opaque runs', () => {
  const refused = [HEX24, 'a'.repeat(24), '0'.repeat(24), HEX40, UUID, `${HEX24.slice(0, 8)}-${HEX24.slice(8, 16)}-${HEX24.slice(16)}`,
    SK.slice(0, 19), 'sk-1', 'pw-hunter2xyz', 'pw-1', 'password-1', 'token-abc', 'secret', 'key-9', 'bearer-x', 'ghp-abcdefghijkl', 'eyj-x', 'my-token-abc123xyz', K, 'api-key-hunter2xyz'];
  for (const id of refused) { assert.equal(credentialLookingId(id), true, id); assert.equal(workspaceFrom({ headers: { 'x-workspace': id } }), null, id); }
  const fine = ['default', 'w-0123456789abcdef', 'w-1', 'ws-a', 'abc-1', 'a'.repeat(23), 'my-demo-run', 'team-7', 'k', 'sky-1'];
  for (const id of fine) { assert.equal(credentialLookingId(id), false, id); assert.equal(workspaceFrom({ headers: { 'x-workspace': id } }), id, id); }
});

test('a refused workspace id is answered 400 bad_workspace on every route that uses one and is never echoed', async () => {
  await withServer(async (url) => {
    const id = SK.slice(0, 19);
    const h = { 'x-workspace': id, origin: url, 'content-type': 'application/json' };
    const calls = [['POST', '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }], ['POST', '/api/baseline', { mode: 'live', kind: 'normal' }], ['GET', '/api/baseline?mode=live'], ['POST', '/api/obo', { mode: 'mock', scenario: 'ok' }],
      ['POST', '/api/idjag', { mode: 'mock', scenario: 'ok' }], ['GET', '/api/runs'], ['POST', '/api/reset', {}]];
    for (const [m, p, b] of calls) {
      const r = await fetch(`${url}${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
      const text = await r.text();
      assert.deepEqual([r.status, JSON.parse(text)], [400, { error: 'bad_workspace' }], `${m} ${p}`);
      assert.ok(!text.includes('sk-') && !text.includes('abcdefgh'));
    }
    for (const good of ['w-0123456789abcdef', 'default']) {
      const j = await (await fetch(`${url}/api/evaluate`, { method: 'POST', headers: { ...h, 'x-workspace': good }, body: JSON.stringify({ mode: 'mock', scenario: 'legit-lookup' }) })).json();
      assert.equal(j.workspace, good);
    }
  });
});
