// The sweep, end to end: every class of credential-shaped payload is typed into EVERY free-text field, key name, path segment, query, header and
// error-path input of every endpoint. Nothing typed may come back in any answer (body or headers), in the state read afterwards, or on stdout/stderr.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { ALL, GHP, K, SK } from './payloads.js';

// (the mock-issued tokens of the OBO and ID-JAG answers legitimately start eyJ..., so the JWT marker is the payload's own second part)
const SECRETS = ['hunter2xyz', K, 'ghp_', 'eyJzdWIiOiJoMTIz'];
const printable = (p) => /^[\x20-\x7e]*$/.test(p); // header values cannot carry control characters or non-ASCII; the body and path carry the full set

function capture() {
  const chunks = []; const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = (c, ...a) => { chunks.push(String(c)); return true; };
  process.stderr.write = (c, ...a) => { chunks.push(String(c)); return true; };
  return { text: () => chunks.join(''), stop: () => { process.stdout.write = o; process.stderr.write = e; } };
}

// One request per place. `p` is the raw payload; `q` is the same percent-encoded for paths and queries.
const PLACES = (p, q) => {
  const ev = (call, extra = {}) => ({ method: 'POST', path: '/api/evaluate', body: { mode: 'live', call, ...extra } });
  return {
    'evaluate call.description': ev({ tool: 'x.y', description: p, args: {} }),
    'evaluate args.payee': ev({ tool: 'x.y', args: { payee: p } }),
    'evaluate args.record': ev({ tool: 'x.y', args: { record: p } }),
    'evaluate args.dataset': ev({ tool: 'x.y', args: { dataset: p } }),
    'evaluate args.account': ev({ tool: 'x.y', args: { account: p } }),
    'evaluate args.note': ev({ tool: 'x.y', args: { note: p } }),
    'evaluate args.memo': ev({ tool: 'x.y', args: { memo: p } }),
    'evaluate args.destination': ev({ tool: 'x.y', description: 'export', args: { destination: p, limit: 9000 } }),
    'evaluate arg key': ev({ tool: 'x.y', args: { [p]: 'v' } }),
    'evaluate tool': ev({ tool: p }),
    'evaluate tool segment': ev({ tool: `payees.${p}` }),
    'evaluate call as text': { method: 'POST', path: '/api/evaluate', body: { mode: 'live', call: p } },
    'evaluate unknown call key': ev({ tool: 'x.y', [p]: 1 }),
    'evaluate unknown body key': { method: 'POST', path: '/api/evaluate', body: { mode: 'live', call: { tool: 'x.y' }, [p]: 1 } },
    'evaluate policy section': ev({ tool: 'x.y' }, { policy: { [p]: {} } }),
    'evaluate policy field': ev({ tool: 'x.y' }, { policy: { intent: { [p]: 1 } } }),
    'evaluate policy field in purpose': ev({ tool: 'x.y' }, { policy: { purpose: { [p]: true } } }),
    'evaluate policy value': ev({ tool: 'x.y' }, { policy: { intent: { Floor: p } } }),
    'evaluate policy as text': ev({ tool: 'x.y' }, { policy: p }),
    'evaluate scenario': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: p } },
    'evaluate mode': { method: 'POST', path: '/api/evaluate', body: { mode: p, scenario: 'legit-lookup' } },
    'evaluate vertical': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup', vertical: p } },
    'baseline policy section': { method: 'POST', path: '/api/baseline', body: { mode: 'live', kind: 'normal', policy: { [p]: {} } } },
    'baseline kind': { method: 'POST', path: '/api/baseline', body: { mode: 'live', kind: p } },
    'baseline mode': { method: 'POST', path: '/api/baseline', body: { mode: p, kind: 'normal' } },
    'baseline vertical': { method: 'POST', path: '/api/baseline', body: { mode: 'live', kind: 'normal', vertical: p } },
    'obo scenario': { method: 'POST', path: '/api/obo', body: { mode: 'live', scenario: p } },
    'obo mode': { method: 'POST', path: '/api/obo', body: { mode: p, scenario: 'ok' } },
    'idjag scenario': { method: 'POST', path: '/api/idjag', body: { mode: 'live', scenario: p } },
    'idjag vertical': { method: 'POST', path: '/api/idjag', body: { mode: 'mock', scenario: 'ok', vertical: p } },
    'reset body': { method: 'POST', path: '/api/reset', body: { [p]: p } },
    'query story vertical': { method: 'GET', path: `/api/story?vertical=${q}` },
    'query diagram name': { method: 'GET', path: `/api/diagram?name=${q}&vertical=${q}` },
    'query baseline mode': { method: 'GET', path: `/api/baseline?mode=${q}&vertical=${q}` },
    'query info': { method: 'GET', path: `/api/info?${q}=${q}` },
    'query health': { method: 'GET', path: `/api/health?x=${q}` },
    'query runs': { method: 'GET', path: `/api/runs?x=${q}` },
    'path unknown api': { method: 'GET', path: `/api/${q}` },
    'path under known route': { method: 'GET', path: `/api/story/${q}` },
    'path under health': { method: 'GET', path: `/api/health/${q}` },
    'path post unknown api': { method: 'POST', path: `/api/${q}`, body: {} },
    'path unknown top level': { method: 'POST', path: `/${q}`, body: {} },
    'path unknown top level get': { method: 'GET', path: `/${q}` },
    'path asset': { method: 'GET', path: `/assets/${q}.js` },
    'path put': { method: 'PUT', path: `/${q}`, body: {} },
    'path delete api': { method: 'DELETE', path: `/api/evaluate/${q}` },
    'wrong method on a known route': { method: 'PUT', path: `/api/evaluate?x=${q}`, body: { p } },
    'malformed json': { method: 'POST', path: '/api/evaluate', raw: `{"mode":"live","call":{"description":"${p.replace(/["\\]/g, '')}"` },
    'array body': { method: 'POST', path: '/api/evaluate', raw: JSON.stringify([p]) },
    'text body': { method: 'POST', path: '/api/evaluate', raw: p, headers: { 'content-type': 'text/plain' } },
    'oversized body': { method: 'POST', path: '/api/evaluate', raw: JSON.stringify({ pad: `${'x'.repeat(9000)} ${p}` }) },
    'filler then secret': ev({ tool: 'x.y', description: `${'a'.repeat(19_990)} ${p}` }),
    ...(printable(p) ? {
      'header X-Workspace': { method: 'GET', path: '/api/runs', headers: { 'x-workspace': p } },
      'header X-Workspace on evaluate': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { 'x-workspace': p } },
      'header X-Workspace on reset': { method: 'POST', path: '/api/reset', body: {}, headers: { 'x-workspace': p } },
      'header traceparent': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { traceparent: p } },
      'header traceparent on obo': { method: 'POST', path: '/api/obo', body: { mode: 'mock', scenario: 'ok' }, headers: { traceparent: p } },
      'header Origin': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { origin: p } },
      'header Sec-Fetch-Site': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { 'sec-fetch-site': p } },
      'header Cookie': { method: 'GET', path: '/api/info', headers: { cookie: p } },
      'header Authorization': { method: 'GET', path: '/api/info', headers: { authorization: p } },
      'header User-Agent and Referer': { method: 'GET', path: '/api/story', headers: { 'user-agent': p, referer: `http://localhost/${q}` } },
    } : {}),
  };
};

test('credential-shaped text typed anywhere never comes back: answers, headers, follow-up state, stdout and stderr', async () => {
  const cap = capture();
  let places = 0; let requests = 0; const seen = new Set();
  try {
    await withServer(async (url) => {
      for (const p of ALL) {
        const q = encodeURIComponent(p);
        for (const [name, spec] of Object.entries(PLACES(p, q))) {
          places += 1; seen.add(name);
          const headers = { origin: url, ...(spec.body !== undefined || spec.raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(spec.headers || {}) };
          const r = await fetch(`${url}${spec.path}`, { method: spec.method, headers, body: spec.raw ?? (spec.body === undefined ? undefined : JSON.stringify(spec.body)) });
          requests += 1;
          const text = await r.text();
          const hdrs = [...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
          for (const s of SECRETS) {
            assert.ok(!text.includes(s), `${name} | ${JSON.stringify(p)} | body leaks ${s}: ${text.slice(0, 300)}`);
            assert.ok(!hdrs.includes(s), `${name} | ${JSON.stringify(p)} | headers leak ${s}: ${hdrs}`);
          }
          assert.ok(r.status < 500, `${name} | ${JSON.stringify(p)} | status ${r.status}`);
          if (r.status >= 400) assert.match(r.headers.get('content-type') || '', /json/, `${name} | an error answer is JSON, never HTML (${r.status})`);
        }
      }
      // The state read afterwards, in the default workspace and in the page's own workspace.
      for (const headers of [{}, { 'x-workspace': 'w-0123456789abcdef' }]) {
        for (const path of ['/api/runs', '/api/baseline?mode=live', '/api/baseline?mode=mock']) {
          const text = await (await fetch(`${url}${path}`, { headers })).text();
          for (const s of SECRETS) assert.ok(!text.includes(s), `state ${path} leaks ${s}`);
        }
      }
    });
  } finally { cap.stop(); }
  const logged = cap.text();
  for (const s of SECRETS) assert.ok(!logged.includes(s), `stdout/stderr leaked ${s}`);
  assert.ok(seen.size >= 50, `only ${seen.size} places were exercised`);
  assert.ok(requests >= 50 * ALL.length - 60 * 12, `only ${requests} requests were made`);
});

test('the typed text that is accepted comes back masked, in the call and in the request echoed in the hop pane', async () => {
  await withServer(async (url) => {
    const post = (b) => fetch(`${url}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(b) });
    const r = await post({ mode: 'live', call: { tool: 'x.y', description: 'please use password hunter2xyz', args: { note: 'the key is hunter2xyz', record: '//bob:hunter2xyz@host.example' } } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.call.description, 'please use password [masked]');
    assert.equal(j.call.args.note, 'the key is [masked]');
    assert.equal(j.call.args.record, '//[masked]@host.example');
    assert.ok(j.hops[0].request.includes('please use password [masked]'));
    assert.ok(j.hops[0].request.includes('Authorization: Bearer <MOCK-ISSUED token>'), 'the fixed header line of the pane is not masked away');
    assert.ok(!JSON.stringify(j).includes('hunter2xyz'));
  });
});

test('error texts are fixed: they never repeat what was typed, not even a slice of a key name', async () => {
  await withServer(async (url) => {
    const post = (b) => fetch(`${url}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const key = 'zzqqxxkeyname';
    const a = await post({ mode: 'live', call: { tool: 'x.y', args: { [key.toUpperCase()]: 1 } } });
    const b = await post({ mode: 'live', call: { tool: 'x.y', args: { [`${key}-2`]: 1 } } });
    const c = await post({ mode: 'live', call: { tool: 'x.y' }, policy: { [key]: {} } });
    const d = await post({ mode: 'live', call: { tool: 'x.y' }, policy: { intent: { [key]: 1 } } });
    const e = await post({ mode: 'live', call: { tool: 'x.y', args: { good: {} } } });
    for (const x of [a, b, c, d, e]) { assert.equal(x.status, 400); assert.ok(!JSON.stringify(x.body).toLowerCase().includes('zzqq'), JSON.stringify(x.body)); assert.ok(!JSON.stringify(x.body).includes('good')); }
    assert.equal(c.body.detail, 'unknown policy section');
    assert.equal(d.body.detail, 'unknown field in policy.intent');
  });
});

test('credential-shaped tool names and argument names are refused, not stored or echoed', async () => {
  await withServer(async (url) => {
    const post = (b) => fetch(`${url}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    for (const tool of [SK, 'password-hunter2xyz', K, GHP, 'token_hunter2xyz']) {
      const r = await post({ mode: 'live', call: { tool } });
      assert.deepEqual([r.status, r.body.error], [400, 'bad_tool'], tool);
      assert.ok(!JSON.stringify(r.body).includes(tool.slice(3)));
    }
    for (const k of ['password_hunter2xyz', K]) assert.deepEqual((await post({ mode: 'live', call: { tool: 'x.y', args: { [k]: 'v' } } })).body.error, 'bad_args', k);
    assert.equal((await post({ mode: 'live', call: { tool: 'payees.update_destination', args: { record: 'INV-1042' } } })).status, 200, 'an ordinary tool name still works');
  });
});
