// The five leaks that an independent sweep found in this app, each pinned with its repro and a literal expectation:
//  1. "login: bob / x" and "password - x" (a SHORT password) in call.description and in every argument value;
//  2. layered percent-encoding four or more deep;
//  3. call.description echoed in the hop panes (the request pane shows the call as JSON, quotes escaped);
//  4. GET /% answered 404 instead of 400;
//  5. /assets and /assets/ answered 200 with the page instead of a JSON 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withServer, post } from './helpers.js';

const H = 'hunter2xyz';
const evaluate = async (url, call) => {
  const r = await post(url, '/api/evaluate', { mode: 'live', call });
  return { status: r.status, body: await r.json() };
};
const requestJson = (j) => JSON.parse(j.hops[0].request.split('\n\n')[1]);

test('leak 1: a short password after "login: user /" or "password -" is masked in call.description and in every argument, and in the hop pane', async () => {
  const cases = [['login: bob / x', 'login: bob / [masked]'], ['password - x', 'password - [masked]'], ['login: alice / q9', 'login: alice / [masked]'], ['password - ab', 'password - [masked]'],
    ['user: bob / Zz', 'user: bob / [masked]'], ['please use login: bob / x for the record', 'please use login: bob / [masked] for the record'], ['Password – x1', 'Password – [masked]']];
  await withServer(async (url) => {
    for (const [typed, expected] of cases) {
      const d = await evaluate(url, { tool: 'x.y', description: typed });
      assert.equal(d.status, 200, typed);
      assert.equal(d.body.call.description, expected, typed);
      assert.equal(requestJson(d.body).description, expected, `${typed} in the hop pane`);
      for (const field of ['note', 'record', 'payee', 'dataset', 'account', 'memo']) {
        const a = await evaluate(url, { tool: 'x.y', args: { [field]: typed } });
        assert.equal(a.status, 200, `${field} ${typed}`);
        assert.equal(a.body.call.args[field], expected, `${field} ${typed}`);
        assert.equal(requestJson(a.body).args[field], expected, `${field} ${typed} in the hop pane`);
      }
    }
    // what stays readable, and the over-masking that is accepted (pinned so the README stays honest)
    for (const same of ['password - reset', 'password - policy', 'login: bob', 'Login page: shown']) assert.equal((await evaluate(url, { tool: 'x.y', description: same })).body.call.description, same, same);
    assert.equal((await evaluate(url, { tool: 'x.y', description: 'login: yes / no' })).body.call.description, 'login: yes / [masked]', 'a user/value pair is masked even when the value is "no"');
    assert.equal((await evaluate(url, { tool: 'x.y', description: 'pw - ok' })).body.call.description, 'pw - [masked]', 'a 1-3 character value after a password word is masked even when it is an ordinary word');
  });
});

test('leak 2: layered percent-encoding is looked through, four and five layers deep, in every typed place', async () => {
  const typed = [`password%2525253D${H}`, `password%252525253D${H}`, `pass%2525252577ord=${H}`, `token%2525253A%252520${H}`];
  await withServer(async (url) => {
    for (const t of typed) {
      const d = await evaluate(url, { tool: 'x.y', description: t });
      assert.equal(d.status, 200, t);
      assert.ok(!JSON.stringify(d.body).includes(H), `${t}: ${d.body.call.description}`);
      assert.equal(d.body.call.description, '[masked]', t);
      const a = await evaluate(url, { tool: 'x.y', args: { note: t, record: t } });
      assert.ok(!JSON.stringify(a.body).includes(H), t);
      assert.equal(a.body.call.args.note, '[masked]', t);
    }
    const q = await fetch(`${url}/api/story?vertical=${encodeURIComponent(typed[0])}`);
    assert.ok(!(await q.text()).includes(H));
  });
});

test('leak 3: call.description echoed in the hop pane is the masked text, whatever quoting it was typed with', async () => {
  const typed = [`{"password":"${H}"}`, `{\\"password\\":\\"${H}\\"}`, `say "password=${H}" twice`, `password: ${H}`, `note\npassword=${H}`, `'secret': '${H}'`, `https://bob:${H}@host.example/x`];
  await withServer(async (url) => {
    for (const t of typed) {
      const d = await evaluate(url, { tool: 'x.y', description: t });
      assert.equal(d.status, 200, t);
      const text = JSON.stringify(d.body);
      assert.ok(!text.includes(H), `${JSON.stringify(t)} -> ${d.body.hops[0].request}`);
      assert.equal(requestJson(d.body).description, d.body.call.description, 'the hop pane shows exactly the call that was answered');
    }
    const plain = await evaluate(url, { tool: 'invoices.lookup', description: 'look up the status of one invoice', args: { record: 'INV-1000' } });
    assert.equal(requestJson(plain.body).description, 'look up the status of one invoice', 'an ordinary description is shown whole');
  });
});

test('leak 4: GET /% is a 400 with a fixed JSON body, not a 404', async () => {
  for (const withDist of [true, false]) {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-sweep-dist-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>');
    await withServer(async (url) => {
      for (const p of ['/%', '/%zz', '/api/%', '/%E0%A4%A']) {
        const r = await fetch(`${url}${p}`, { redirect: 'manual' });
        assert.equal(r.status, 400, p);
        assert.match(r.headers.get('content-type'), /application\/json/);
        assert.equal(await r.text(), '{"error":"bad_request"}', p);
      }
    }, withDist ? { webDist: dist } : {});
  }
});

test('leak 5: /assets and /assets/ are a JSON 404, never the page; /assets/app.js is still served', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-sweep-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  await withServer(async (url) => {
    for (const p of ['/assets', '/assets/']) {
      const r = await fetch(`${url}${p}`, { redirect: 'manual', headers: { accept: 'text/html' } });
      assert.equal(r.status, 404, p);
      assert.match(r.headers.get('content-type'), /application\/json/);
      assert.equal(await r.text(), '{"error":"not_found"}', p);
    }
    assert.equal((await fetch(`${url}/assets/app.js`)).status, 200);
    assert.equal((await fetch(`${url}/`, { headers: { accept: 'text/html' } })).status, 200);
  }, { webDist: dist });
});
