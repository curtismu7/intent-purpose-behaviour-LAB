// The corpus over HTTP: probes from the shared leaks corpus are typed into every place of every endpoint (the places of sweep.js: free-text fields, argument and
// body keys, policy fields, path segments, queries, headers, malformed bodies, wrong methods). The secret of the row must be absent from every answer (body and
// headers, as written and as JSON-escaped), from the state read afterwards, and from stdout and stderr.
// Rows: every 12th plain probe, plus the first probe of every (family, encoding) group, with a secret of 6+ characters (shorter ones occur in ordinary text).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { withServer } from './helpers.js';
import { PLACES, capture } from './sweep.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus');
const leaks = JSON.parse(readFileSync(path.join(dir, 'leaks.json'), 'utf8')).filter((r) => r.api !== 'deep');
const join = (a) => a.join('');
const firsts = new Set();
const rows = leaks.filter((r, i) => {
  const key = `${r.family}/${r.enc}`;
  const first = !firsts.has(key); firsts.add(key);
  return (first || i % 12 === 0) && join(r.secret).length >= 6;
});
const expand = (row) => `${row.fillBefore ? `${'a'.repeat(row.fillBefore)} ` : ''}${join(row.input)}${row.fillAfter ? ` ${'a'.repeat(row.fillAfter)}` : ''}`;
const has = (text, secret) => text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1));

test('corpus probes typed into every place never come back', async () => {
  const cap = capture();
  let requests = 0; const names = new Set(); const secrets = [];
  try {
    await withServer(async (url) => {
      for (const row of rows) {
        const p = expand(row); const secret = join(row.secret); secrets.push(secret);
        for (const [name, spec] of Object.entries(PLACES(p, encodeURIComponent(p.toWellFormed())))) {
          names.add(name);
          const headers = { origin: url, ...(spec.body !== undefined || spec.raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(spec.headers || {}) };
          const r = await fetch(`${url}${spec.path}`, { method: spec.method, headers, body: spec.raw ?? (spec.body === undefined ? undefined : JSON.stringify(spec.body)) });
          requests += 1;
          const text = await r.text();
          const hdrs = [...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
          assert.ok(!has(text, secret), `${row.id} ${row.family}/${row.enc} | ${name} | body leaks: ${text.slice(0, 200)}`);
          assert.ok(!has(hdrs, secret), `${row.id} | ${name} | headers leak`);
          assert.ok(r.status < 500, `${row.id} | ${name} | status ${r.status}`);
        }
      }
      for (const headers of [{}, { 'x-workspace': 'w-0123456789abcdef' }]) {
        for (const p of ['/api/runs', '/api/baseline?mode=live', '/api/baseline?mode=mock']) {
          const text = await (await fetch(`${url}${p}`, { headers })).text();
          for (const s of secrets) assert.ok(!has(text, s), `state ${p} leaks a probe secret`);
        }
      }
    });
  } finally { cap.stop(); }
  const logged = cap.text();
  for (const s of secrets) assert.ok(!has(logged, s), 'stdout/stderr leaked a probe secret');
  assert.ok(rows.length >= 250, `only ${rows.length} corpus rows were typed`);
  assert.ok(names.size >= 50, `only ${names.size} places`);
  assert.ok(requests >= 250 * 50, `only ${requests} requests`);
});
