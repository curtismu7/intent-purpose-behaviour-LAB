import test from 'node:test';
import assert from 'node:assert/strict';
import { MARK, cleanInput, looksLikeCredential, maskDeep, maskResponseText } from '../src/mask.js';

import { ALL, HEX24, K, SK } from './payloads.js';

const SECRETS = ['hunter2xyz', K];
const leaks = (t) => SECRETS.some((s) => String(t).includes(s));

test('every payload of every class is masked (literal expectations, not imported constants)', () => {
  for (const p of ALL) { const out = cleanInput(p); assert.ok(!leaks(out), `${JSON.stringify(p)} -> ${JSON.stringify(out)}`); assert.ok(out.includes(MARK), `${JSON.stringify(p)} -> ${out}`); }
});

test('exact outputs for the reported repros', () => {
  assert.equal(cleanInput('pass\u0000word=hunter2xyz'), 'password=[masked]');
  assert.equal(cleanInput('password hunter2xyz'), 'password [masked]');
  assert.equal(cleanInput('the key is hunter2xyz'), 'the key is [masked]');
  assert.equal(cleanInput('bob:hunter2xyz@host.example'), '[masked]@host.example');
  assert.equal(cleanInput('//bob:hunter2xyz@host.example'), '//[masked]@host.example');
  assert.equal(cleanInput('{"password":"hunter2xyz"}'), '{"password":"[masked]"}');
  assert.equal(cleanInput(`s\u0001k-${K}`), '[masked]');
  assert.equal(cleanInput('Bea\u0001rer hunter2xyz'), 'Bearer [masked]');
});

test('class A: C0 and C1 controls are DELETED before matching, tab, newline and carriage return separate', () => {
  for (let c = 0; c < 0x20; c += 1) {
    if (c === 9 || c === 10 || c === 13) continue;
    assert.ok(!leaks(cleanInput(`pass${String.fromCharCode(c)}word=hunter2xyz`)), `C0 ${c}`);
  }
  for (let c = 0x7f; c <= 0x9f; c += 1) assert.ok(!leaks(cleanInput(`pass${String.fromCharCode(c)}word=hunter2xyz`)), `C1 ${c}`);
  assert.ok(!leaks(cleanInput('pass\tword=hunter2xyz')) && !leaks(cleanInput('pass\r\nword=hunter2xyz')), 'a separator in the keyword is caught by the second look');
  assert.equal(cleanInput('line one\nline two'), 'line one line two', 'a plain multi-line text stays readable');
});

test('class B: keyword + plain space + a 6+ character value with a digit; ordinary sentences stay readable (the false-positive tradeoff)', () => {
  for (const t of ['password reset', 'Please reset your password', 'the token bucket refills', 'secret garden', 'api key rotation guide', 'the password is required', 'Look up invoice INV-1042 for the vendor',
    'bulk export of 5000 customers', 'author: Bob', 'basic settings', 'key points', 'Contact: bob@host.example', 'mailto:bob@host.example', 'token exchange 300 seconds', 'pass the record to the next step',
    'set the remittance account for this supplier to the new account details', 'the key idea', 'password policy review']) assert.equal(cleanInput(t), t, t);
  // Documented misses and over-masking, pinned so the README stays honest:
  assert.equal(cleanInput('password hunter'), 'password hunter', 'no digit: not recognised (a bare word is a miss)');
  assert.equal(cleanInput('pw hunt2'), 'pw hunt2', 'under 6 characters: not recognised');
  assert.equal(cleanInput('pw hunt22'), 'pw [masked]', '6+ characters with a digit: masked');
  assert.equal(cleanInput('pw hunt2'.replace('hunt2', 'hunte2')), 'pw [masked]', 'exactly 6 characters with a digit: masked');
  assert.equal(cleanInput('pw hunt2').length, 'pw hunt2'.length, 'exactly 5 characters: kept');
});

test('class C and D forms', () => {
  assert.equal(cleanInput('mailto:bob@host.example'), 'mailto:bob@host.example');
  assert.ok(!leaks(cleanInput('{"a":1,"password":"hunter2xyz","b":2}')));
  assert.equal(cleanInput('{"password":"my secret phrase hunter2xyz"}'), '{"password":"[masked]"}', 'a quoted value is masked to its closing quote');
  assert.ok(!leaks(cleanInput('{"token":hunter2xyz}')));
});

test('percent-decoding: three rounds are looked through, a fourth is not', () => {
  assert.ok(!leaks(cleanInput('password%3Dhunter2xyz')));
  assert.ok(!leaks(cleanInput('password%253Dhunter2xyz')));
  assert.ok(!leaks(cleanInput('password%25253Dhunter2xyz')));
  assert.ok(leaks(cleanInput('password%2525253Dhunter2xyz')), 'four layers are beyond the bound: a documented miss');
});

test('a secret placed after filler is masked, never cut off or kept by being cut in half', () => {
  const filler = 'x '.repeat(90); // 180 characters
  assert.ok(!leaks(cleanInput(`${filler}password hunter2xyz`)));
  assert.ok(!leaks(cleanInput(`${'a'.repeat(19_990)} password=hunter2xyz`)), 'mask is applied to the whole text first; only then may a caller refuse it as too long');
  assert.ok(!leaks(cleanInput(`${'x '.repeat(5000)}${SK}`)));
});

test('looksLikeCredential: names and ids', () => {
  for (const t of [SK, 'password-hunter2xyz', K, 'pw-hunter2xyz', HEX24, 'token_hunter2xyz']) assert.equal(looksLikeCredential(t), true, t);
  for (const t of ['invoices.lookup', 'payees.update', 'refunds.update_destination', 'x.y', 'reconcile_batch_2024_q1', 'w-0123456789abcdef', 'default', 'my-workspace', 'records.export']) assert.equal(looksLikeCredential(t), false, t);
});

test('the response mask: no generic long-run detector, but every specific one; an unchanged text is returned as it came', () => {
  const tp = 'traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  assert.equal(maskResponseText(tp), tp);
  const line = 'POST https://mcp.fabrikam.example/mcp\nAuthorization: Bearer <MOCK-ISSUED token>\n' + tp;
  assert.equal(maskResponseText(line), line, 'the one fixed header line the app writes is kept');
  assert.equal(maskResponseText('Authorization: Bearer hunter2xyz'), 'Authorization: [masked]');
  assert.equal(maskResponseText('Authorization: Bearer <MOCK-ISSUED token> hunter2xyz'), 'Authorization: [masked]', 'only the exact fixed line is exempt');
  assert.ok(!leaks(maskResponseText('a\nb password=hunter2xyz\nc')));
  assert.equal(maskResponseText('keep\nthe lines'), 'keep\nthe lines');
});

test('maskDeep masks strings and object KEYS, keeps other values, never drops a colliding key, handles __proto__ and depth', () => {
  const evil = JSON.parse('{"__proto__":{"x":"password hunter2xyz"},"password=hunter2xyz":1,"password=hunter2xyz ":2,"n":3,"b":true,"z":null,"arr":["token hunter2xyz",{"k":"sk-abcdefghijklmnop1234"}]}');
  const out = maskDeep(evil);
  const text = JSON.stringify(out);
  assert.ok(!leaks(text), text);
  assert.equal(out.n, 3); assert.equal(out.b, true); assert.equal(out.z, null);
  assert.equal(Object.keys(out).filter((k) => k.startsWith('password=')).length, 2, 'the two keys that collide after masking both survive');
  assert.equal(Object.getPrototypeOf(out), Object.prototype, 'a __proto__ key stays a plain own key');
  let deep = { v: 'password hunter2xyz' };
  for (let i = 0; i < 20_000; i += 1) deep = { d: deep };
  assert.ok(maskDeep(deep), 'iterative: 20,000 levels do not overflow the stack');
});

test('hostile input is bounded in time (no catastrophic backtracking)', () => {
  const hostile = ['a'.repeat(8000), 'password ' + 'a'.repeat(8000), ':'.repeat(8000), 'pw '.repeat(2600), '%'.repeat(8000), 'a:'.repeat(4000) + '@', '"'.repeat(8000), 'password=' + '\\'.repeat(8000), '-----BEGIN X-----' + 'a'.repeat(8000), '//' + 'a'.repeat(8000), 'token ' + '1'.repeat(8000)];
  const t0 = Date.now();
  for (const h of hostile) cleanInput(h);
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
});

test('masking is idempotent: a masked text is not masked again into something else', () => {
  for (const p of ALL) { const once = cleanInput(p); assert.equal(cleanInput(once), once, p); }
});
