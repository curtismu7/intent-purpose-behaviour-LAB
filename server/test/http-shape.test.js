// Static files, unknown paths and methods: JSON 404 for anything missing (never a 200 page, never Express's HTML that echoes the path),
// 405 with Allow for a wrong method on a known route, the app shell only for extension-less non-dotfile paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { withServer } from './helpers.js';

function makeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, '.secret'), 'dotfile');
  return dir;
}
const call = (url, method, p, opts = {}) => fetch(`${url}${p}`, { method, redirect: 'manual', headers: { origin: url, ...(opts.headers || {}) }, body: opts.body });
const isJson404 = async (r, p = '') => { assert.equal(r.status, 404, p); assert.match(r.headers.get('content-type'), /application\/json/); assert.deepEqual(await r.json(), { error: 'not_found' }); };

for (const withDist of [true, false]) {
  test(`missing files and unknown paths are a JSON 404, never a page ${withDist ? '(with a built web/dist)' : '(without web/dist)'}`, async () => {
    const dist = withDist ? makeDist() : path.join(os.tmpdir(), 'ipb-no-dist-here');
    await withServer(async (url) => {
      for (const p of ['/assets/missing.js', '/favicon.ico', '/robots.txt', '/foo.map', '/foo.svg', '/sitemap.xml', '/.env', '/.secret', '/assets/.secret', '/a/.git/config', '/%2Eenv', '/x.', '/a.b/c', '/index.html.bak', '/pw-hunter2xyz.js']) {
        await isJson404(await call(url, 'GET', p), p);
        const h = await call(url, 'HEAD', p);
        assert.equal(h.status, 404, `HEAD ${p}`); assert.match(h.headers.get('content-type'), /application\/json/);
      }
      for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const r = await call(url, m, '/pw-hunter2xyz', { body: '{}', headers: { 'content-type': 'application/json' } });
        assert.equal(r.status, 404, m);
        assert.match(r.headers.get('content-type'), /application\/json/);
        const text = await r.text();
        assert.ok(!/hunter2xyz|Cannot|<html|<pre/i.test(text), text);
      }
      // fetch rewrites %2e%2e to .., so send the raw request line
      const raw = await new Promise((resolve) => { const u = new URL(url); http.get({ host: u.hostname, port: u.port, path: '/%2e%2e/x', agent: false }, (r) => { let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => resolve({ status: r.statusCode, ct: r.headers['content-type'], t })); }); });
      assert.equal(raw.status, 404); assert.match(raw.ct, /json/);
      const bad = await call(url, 'GET', '/%');
      assert.ok([400, 404].includes(bad.status), 'a malformed escape is a short 400 or 404');
      assert.match(bad.headers.get('content-type'), /application\/json/);
    }, { webDist: dist });
  });
}

test('with a built web/dist: the shell answers extension-less paths only, real assets are served, a directory name is not redirected', async () => {
  await withServer(async (url) => {
    for (const p of ['/', '/about', '/tab/three-signals', '/assets']) {
      const r = await call(url, 'GET', p);
      assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(await r.text(), /<title>shell<\/title>/);
    }
    const a = await call(url, 'GET', '/assets/app.js');
    assert.equal(a.status, 200); assert.match(a.headers.get('content-type'), /javascript/);
    assert.equal(a.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await call(url, 'GET', '/assets')).headers.get('location'), null);
  }, { webDist: makeDist() });
});

test('a wrong method on a known route is 405 with Allow; an unknown API path is a JSON 404', async () => {
  await withServer(async (url) => {
    const cases = [
      ['GET', '/api/evaluate', 'POST'], ['PUT', '/api/evaluate', 'POST'], ['DELETE', '/api/evaluate', 'POST'], ['GET', '/api/obo', 'POST'], ['GET', '/api/idjag', 'POST'], ['GET', '/api/reset', 'POST'],
      ['POST', '/api/story', 'GET, HEAD'], ['POST', '/api/diagram', 'GET, HEAD'], ['POST', '/api/info', 'GET, HEAD'], ['DELETE', '/api/runs', 'GET, HEAD'], ['POST', '/api/runs', 'GET, HEAD'],
      ['PUT', '/api/baseline', 'GET, HEAD, POST'], ['DELETE', '/api/baseline', 'GET, HEAD, POST'], ['POST', '/api/health', 'GET'], ['POST', '/', 'GET, HEAD'], ['DELETE', '/', 'GET, HEAD'],
    ];
    for (const [m, p, allow] of cases) {
      const r = await call(url, m, p, { body: m === 'GET' ? undefined : '{}', headers: { 'content-type': 'application/json' } });
      assert.equal(r.status, 405, `${m} ${p}`); assert.equal(r.headers.get('allow'), allow, `${m} ${p}`);
      assert.deepEqual(await r.json(), { error: 'method_not_allowed' });
    }
    for (const p of ['/api/nope', '/api', '/api/', '/api/evaluate/x', '/api/health/x']) await isJson404(await call(url, 'GET', p), p);
    for (const [m, p] of [['GET', '/api/story'], ['HEAD', '/api/story'], ['GET', '/api/runs'], ['POST', '/api/reset']]) assert.equal((await call(url, m, p, { body: m === 'POST' ? '{}' : undefined, headers: { 'content-type': 'application/json' } })).status, 200, `${m} ${p} still works`);
  });
});

test('the catch-all error handler: a thrown error, a bad charset and a bad encoding are short JSON, no stack, no path', async () => {
  await withServer(async (url) => {
    for (const [headers, body] of [[{ 'content-type': 'application/json; charset=utf-7' }, '{}'], [{ 'content-type': 'application/json', 'content-encoding': 'br' }, '{}'], [{ 'content-type': 'application/json' }, '{"a":']]) {
      const r = await call(url, 'POST', '/api/evaluate', { body, headers });
      assert.ok(r.status >= 400 && r.status < 500, String(r.status));
      assert.match(r.headers.get('content-type'), /json/);
      assert.ok(!/node_modules|\/Users\/|at \w+ \(|Error:/.test(await r.text()));
    }
  });
});
