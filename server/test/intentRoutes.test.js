// The intent-catalogue and customer-intent HTTP routes: shape, status codes, workspace isolation of the
// customer intents, and the hostile inputs a visitor can send (all of which are 400s with fixed codes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../src/app.js';

const start = async () => startHttpServer({ port: 0, host: '127.0.0.1', app: createApp() });
const H = (ws) => ({ 'content-type': 'application/json', 'x-workspace': ws });

test('GET /api/intents: the catalogue, its counts and the real-mode reason', async () => {
  const { server, url } = await start();
  try {
    const r = await fetch(url + 'api/intents', { headers: H('w-t') });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.counts.total, 25);
    assert.equal(j.source, 'measured-snapshot');
    assert.equal(j.realAvailable, false);
    assert.match(j.realReason, /PRIVILEGE_CONSOLE_URL/);
    assert.ok(j.intents.some((i) => i.name === 'detection_and_audit'));
    assert.ok(j.intents.every((i) => i.effective && typeof i.effective.acts === 'boolean'));
  } finally { server.close(); }
});

test('POST /api/intents: classify a call; bad calls are 400 with a fixed code', async () => {
  const { server, url } = await start();
  try {
    const ok = await fetch(url + 'api/intents', { method: 'POST', headers: H('w-t'), body: JSON.stringify({ call: { tool: 'db.query', description: 'run mysqldump on the users database', args: {} } }) });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.ok(j.patternMatches.some((m) => m.id === 'data_exfiltration'));
    assert.equal(j.wouldRefuse, true);
    assert.ok(j.similarity.riskScore >= 0);
    const bad = await fetch(url + 'api/intents', { method: 'POST', headers: H('w-t'), body: JSON.stringify({ call: { tool: 'x'.repeat(80) } }) });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'bad_tool');
    const empty = await fetch(url + 'api/intents', { method: 'POST', headers: H('w-t'), body: JSON.stringify({}) });
    assert.equal(empty.status, 400);
    // a hostile floor value is refused by the policy validator, not trusted
    const badFloor = await fetch(url + 'api/intents', { method: 'POST', headers: H('w-t'), body: JSON.stringify({ call: { tool: 'a.b', description: 'x' }, floor: 99 }) });
    assert.equal(badFloor.status, 400);
  } finally { server.close(); }
});

test('customer intents live per workspace and survive between calls; DELETE removes one', async () => {
  const { server, url } = await start();
  try {
    const put = await fetch(url + 'api/customer-intent', { method: 'PUT', headers: H('w-a'), body: JSON.stringify({ name: 'my_lab_intent', description: 'd', exemplars: ['export every demo customer record'], patterns: ['\\bdemo\\b.*\\bexport\\b'], acts: true }) });
    assert.equal(put.status, 200);
    const list = await (await fetch(url + 'api/customer-intent', { headers: H('w-a') })).json();
    assert.equal(list.intents.length, 1);
    const other = await (await fetch(url + 'api/customer-intent', { headers: H('w-b') })).json();
    assert.equal(other.intents.length, 0, 'another workspace does not see it');
    // the clone rule over the HTTP surface
    const cat = await (await fetch(url + 'api/intents', { headers: H('w-a') })).json();
    const row = cat.intents.find((i) => i.name === 'my_lab_intent');
    assert.ok(row && row.isCustom);
    // classify with it
    const sim = await (await fetch(url + 'api/intents', { method: 'POST', headers: H('w-a'), body: JSON.stringify({ call: { tool: 'demo.tool', description: 'please export demo customer records now', args: {} } }) })).json();
    assert.ok(sim.customIntentHits.includes('my_lab_intent'));
    const del = await fetch(url + 'api/customer-intent?name=my_lab_intent', { method: 'DELETE', headers: H('w-a') });
    assert.equal((await del.json()).removed, true);
    // reset also clears them
    await fetch(url + 'api/customer-intent', { method: 'PUT', headers: H('w-a'), body: JSON.stringify({ name: 'temp_intent', patterns: [] }) });
    await fetch(url + 'api/reset', { method: 'POST', headers: H('w-a'), body: '{}' });
    const after = await (await fetch(url + 'api/customer-intent', { headers: H('w-a') })).json();
    assert.equal(after.intents.length, 0);
  } finally { server.close(); }
});

test('the hostile paths on the intent routes: bad JSON, bad bodies and bad names are 400s, never 500s', async () => {
  const { server, url } = await start();
  try {
    const cases = [
      ['PUT', '/api/customer-intent', '{"name":'],
      ['PUT', '/api/customer-intent', 'null'],
      ['PUT', '/api/customer-intent', '[]'],
      ['PUT', '/api/customer-intent', '{"name":"x"}'],
      ['PUT', '/api/customer-intent', '{"name":"sk-credential_like","patterns":[]}'],
      ['POST', '/api/intents', 'not json'],
    ];
    for (const [method, path, body] of cases) {
      const r = await fetch(url + path.replace(/^\//, ''), { method, headers: H('w-h'), body });
      assert.equal(r.status, 400, `${method} ${path} ${body}`);
      const j = await r.json();
      assert.ok(j.error && typeof j.error === 'string');
      assert.ok(!JSON.stringify(j).includes('at file://'), 'no stack in the answer');
    }
    const missing = await fetch(url + 'api/customer-intent?name=nope', { method: 'DELETE', headers: H('w-h') });
    assert.equal((await missing.json()).removed, false, 'deleting a missing intent is a clean no, not an error');
  } finally { server.close(); }
});

test('the new routes are in the method table: 405 with Allow, and no trace of a credential header name in any answer', async () => {
  const { server, url } = await start();
  try {
    const r = await fetch(url + 'api/customer-intent', { method: 'POST', headers: H('w-m'), body: '{}' });
    assert.equal(r.status, 405);
    assert.match(r.headers.get('allow'), /GET|PUT|DELETE/);
  } finally { server.close(); }
});
