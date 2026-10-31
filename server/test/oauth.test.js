import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { MOCK_SIGNATURE, decodeJwt, signJwt, verifyJwt } from '../src/jwt.js';
import { getKeys, jwksOf } from '../src/keys.js';
import { IDJAG_SCENARIOS, OBO_SCENARIOS, ID_JAG_TYPE, TOKEN_EXCHANGE, oboConfig, runIdJag, runObo } from '../src/oauth.js';
import { DEFAULT_CAST, VERTICALS } from '../src/cast.js';
import { MOCK_TABLE } from '../src/mockTable.js';
import { parseTraceparent } from '../src/trace.js';

const K = getKeys();
const NOW = 1_800_000_000;
const rules = { jwks: jwksOf(K.userIdp), iss: 'https://idp.x.example', aud: 'https://mcp.x.example', now: NOW };
const claims = { iss: 'https://idp.x.example', sub: 'u', aud: 'https://mcp.x.example', exp: NOW + 60, iat: NOW, jti: 'j1' };
const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => c.id);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('RS256 signatures are real: a good token verifies, a tampered payload and a different key do not', () => {
  const t = signJwt(claims, { key: K.userIdp });
  assert.equal(t.split('.').length, 3);
  assert.deepEqual(decodeJwt(t).header, { alg: 'RS256', typ: 'JWT', kid: K.userIdp.kid });
  assert.deepEqual(failed(verifyJwt(t, rules)), []);
  const [h, , s] = t.split('.');
  assert.deepEqual(failed(verifyJwt(`${h}.${b64u({ ...claims, sub: 'admin' })}.${s}`, rules)), ['signature']);
  assert.deepEqual(failed(verifyJwt(signJwt(claims, { key: { ...K.rogue, kid: K.userIdp.kid } }), rules)), ['signature']);
});

test('verification refuses alg none, HS256 and malformed or oversized tokens', () => {
  const none = `${b64u({ alg: 'none', typ: 'JWT', kid: K.userIdp.kid })}.${b64u(claims)}.`;
  assert.equal(verifyJwt(none, rules).ok, false);
  const hs = `${b64u({ alg: 'HS256', typ: 'JWT', kid: K.userIdp.kid })}.${b64u(claims)}.${createHmac('sha256', 'x').update('y').digest('base64url')}`;
  const r = verifyJwt(hs, rules);
  assert.deepEqual([r.ok, failed(r).includes('alg'), failed(r).includes('signature')], [false, true, true]);
  for (const bad of ['', 'a.b', 'a.b.c.d', '....', 'x'.repeat(9000), null, 5, `${b64u([1])}.${b64u(claims)}.sig`]) assert.equal(verifyJwt(bad, rules).ok, false);
});

test('audience, issuer, expiry, act and replay each fail on their own', () => {
  const sign = (c) => signJwt(c, { key: K.userIdp });
  assert.deepEqual(failed(verifyJwt(sign({ ...claims, aud: 'https://mcp.other.example' }), rules)), ['audience']);
  assert.deepEqual(failed(verifyJwt(sign({ ...claims, iss: 'https://idp.rogue.example' }), rules)), ['issuer']);
  assert.deepEqual(failed(verifyJwt(sign({ ...claims, exp: NOW - 1 }), rules)), ['expiry']);
  assert.deepEqual(failed(verifyJwt(sign(claims), { ...rules, requireAct: true })), ['act']);
  assert.deepEqual(failed(verifyJwt(sign({ ...claims, act: 'text' }), { ...rules, requireAct: true })), ['act']);
  assert.deepEqual(failed(verifyJwt(sign({ ...claims, act: { sub: 'agent' } }), { ...rules, requireAct: true })), []);
  assert.deepEqual(failed(verifyJwt(sign(claims), { ...rules, seen: new Set(['j1']) })), ['replay']);
  assert.deepEqual(failed(verifyJwt(sign({ ...claims, aud: ['x', 'https://mcp.x.example'] }), rules)), []);
});

test('LIVE on-behalf-of: every scenario ends as the story says, for the check the story names', () => {
  const want = { ok: [], 'wrong-audience': ['audience'], expired: ['expiry'], 'no-act': ['act'], 'bad-signature': ['signature'], 'shared-service-account': [] };
  for (const s of OBO_SCENARIOS) {
    const r = runObo({ cast: DEFAULT_CAST, scenario: s.id, mode: 'live', now: NOW });
    assert.deepEqual(failed(r.backend), want[s.id], s.id);
    assert.equal(r.accepted, want[s.id].length === 0, s.id);
    assert.equal(r.signed, true);
    assert.deepEqual(failed(r.gatewayChecks), [], 'the caller token is always valid');
  }
});

test('LIVE on-behalf-of: the exchanged token is for the MCP server, carries act, and the request is RFC 8693 with an RFC 8707 resource', () => {
  const r = runObo({ cast: DEFAULT_CAST, scenario: 'ok', mode: 'live', now: NOW });
  const cfg = oboConfig(DEFAULT_CAST, 'obo');
  assert.equal(r.original.claims.aud, 'https://gateway.fabrikam.example');
  assert.equal(r.exchanged.claims.aud, cfg.Resource);
  assert.notEqual(r.exchanged.claims.aud, r.original.claims.aud);
  assert.deepEqual(r.exchanged.claims.act, { sub: DEFAULT_CAST.castAgentId });
  assert.equal(r.exchanged.claims.sub, r.original.claims.sub, 'the user is preserved');
  assert.equal(r.exchangeRequest.grant_type, TOKEN_EXCHANGE);
  assert.equal(r.exchangeRequest.subject_token, r.original.token);
  assert.equal(r.exchangeRequest.resource, cfg.Resource);
  assert.ok(r.exchanged.claims.exp - NOW <= 300, 'short-lived');
  assert.match(r.attribution.text, /original caller/);
  assert.equal(runObo({ cast: DEFAULT_CAST, scenario: 'shared-service-account', mode: 'live', now: NOW }).attribution.actor, null);
  assert.ok(r.jwks.keys[0].n && !r.jwks.keys[0].d, 'the key set is public: no private exponent');
  assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));
});

test('LIVE ID-JAG: every scenario ends as the story says, and replay is refused only the second time', () => {
  const want = { ok: [], 'wrong-audience': ['audience'], 'untrusted-issuer': ['signature', 'issuer'], expired: ['expiry'] };
  for (const s of IDJAG_SCENARIOS.filter((x) => x.id !== 'replay')) {
    const r = runIdJag({ cast: DEFAULT_CAST, scenario: s.id, mode: 'live', now: NOW });
    assert.deepEqual(failed(r.redeem), want[s.id], s.id);
    assert.equal(r.accepted, s.id === 'ok');
    assert.equal(r.access === null, s.id !== 'ok');
  }
  const rp = runIdJag({ cast: DEFAULT_CAST, scenario: 'replay', mode: 'live', now: NOW });
  assert.deepEqual([failed(rp.redeem), failed(rp.redeemAgain)], [[], ['replay']]);
});

test('LIVE ID-JAG: two issuers, the grant is for the partner issuer, the partner token is signed by the partner key, no shared secret', () => {
  const r = runIdJag({ cast: DEFAULT_CAST, scenario: 'ok', mode: 'live', now: NOW });
  const cfg = oboConfig(DEFAULT_CAST, 'idjag');
  assert.equal(r.grant.header.typ, 'oauth-id-jag+jwt');
  assert.equal(r.grant.claims.iss, 'https://idp.fabrikam.example');
  assert.equal(r.grant.claims.aud, cfg.Resource);
  assert.equal(r.access.claims.iss, cfg.Redeem.TokenURL.replace('/token', ''));
  assert.notEqual(r.access.claims.iss, r.grant.claims.iss);
  assert.equal(r.access.header.kid, K.appIdp.kid);
  assert.equal(r.exchangeRequest.requested_token_type, ID_JAG_TYPE);
  assert.match(r.redeemRequest.grant_type, /jwt-bearer/);
  assert.equal(r.redeemRequest.assertion, r.grant.token);
  assert.deepEqual([r.proof.consentPrompts, r.proof.sharedSecrets], [0, 0]);
  assert.ok(!/client_secret|password/i.test(JSON.stringify([r.exchangeRequest, r.redeemRequest])), 'no secret crosses the boundary');
  assert.ok(r.accepted && r.api.ok);
});

test('the console-swagger config: field names, Redeem is the ID-JAG second leg, no secret fields', () => {
  const obo = oboConfig(DEFAULT_CAST, 'obo'); const jag = oboConfig(DEFAULT_CAST, 'idjag');
  assert.deepEqual(Object.keys(obo).sort(), ['AuthMethod', 'ClientID', 'RequestedTokenType', 'Resource', 'Scope', 'SubjectTokenType', 'TokenURL']);
  assert.ok(!('Redeem' in obo));
  assert.deepEqual(Object.keys(jag.Redeem).sort(), ['AuthMethod', 'ClientID', 'Scope', 'TokenURL']);
  assert.ok(!/ClientSecret|PrivateKeyPEM/.test(JSON.stringify([obo, jag])));
});

test('MOCK mode: placeholder signatures, outcomes from the table, and the same verdicts as Live', () => {
  for (const [kind, list, run] of [['obo', OBO_SCENARIOS, runObo], ['idjag', IDJAG_SCENARIOS, runIdJag]]) {
    for (const s of list) for (const v of Object.keys(VERTICALS)) {
      const m = run({ cast: VERTICALS[v], scenario: s.id, mode: 'mock', now: NOW, table: MOCK_TABLE });
      const l = run({ cast: VERTICALS[v], scenario: s.id, mode: 'live', now: NOW });
      assert.equal(m.signed, false);
      assert.equal(m.accepted, l.accepted, `${kind}/${s.id}/${v}`);
      const tok = kind === 'obo' ? m.exchanged.token : m.grant.token;
      assert.ok(tok.endsWith(`.${MOCK_SIGNATURE}`));
      const sig = (kind === 'obo' ? m.backend : m.redeem).checks.find((c) => c.id === 'signature');
      assert.match(sig.detail, /MOCK mode/);
    }
  }
});

test('every hop carries a valid W3C traceparent, one trace id per run, and a valid incoming trace is continued', () => {
  const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  for (const r of [runObo({ cast: DEFAULT_CAST, scenario: 'ok', mode: 'live', traceparent: tp }), runIdJag({ cast: DEFAULT_CAST, scenario: 'replay', mode: 'live', traceparent: tp })]) {
    assert.ok(r.hops.length >= 3);
    assert.equal(new Set(r.hops.map((h) => h.traceparent)).size, r.hops.length);
    for (const h of r.hops) { assert.ok(parseTraceparent(h.traceparent)); assert.ok(h.request.includes(h.traceparent)); assert.ok(h.traceparent.includes('0af7651916cd43dd8448eb211c80319c')); }
  }
});

test('unknown scenarios give null, and tokens are .example hosts only', () => {
  assert.equal(runObo({ cast: DEFAULT_CAST, scenario: 'nope', mode: 'live' }), null);
  assert.equal(runIdJag({ cast: DEFAULT_CAST, scenario: 'nope', mode: 'mock', table: MOCK_TABLE }), null);
  const r = JSON.stringify([runObo({ cast: DEFAULT_CAST, scenario: 'ok', mode: 'live' }), runIdJag({ cast: DEFAULT_CAST, scenario: 'ok', mode: 'live' })]);
  for (const m of r.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.match(m[1], /\.example$/, m[1]);
});
