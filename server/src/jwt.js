// Minimal RS256 JWT: sign, decode, verify. REAL cryptography with a key generated in this process (RSA, never EC keygen), but the
// tokens are MOCK-ISSUED by this lab and valid nowhere else. Bounded: a token longer than 8 KB is refused before it is parsed.
import { createPublicKey, createSign, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';

export const MAX_TOKEN = 8192;
export const MOCK_SIGNATURE = 'MOCK_SIGNATURE_NOT_VERIFIABLE';
const b64u = (b) => Buffer.from(b).toString('base64url');
const B64U = /^[A-Za-z0-9_-]+$/;

export function generateRsaKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, jwk };
}

export function signJwt(claims, { key, typ = 'JWT', alg = 'RS256' }) {
  const head = b64u(JSON.stringify({ alg, typ, kid: key.kid }));
  const body = b64u(JSON.stringify(claims));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}
// A token with a placeholder signature: used by MOCK mode, never verifiable.
export function mockJwt(claims, { kid, typ = 'JWT' }) {
  return `${b64u(JSON.stringify({ alg: 'RS256', typ, kid }))}.${b64u(JSON.stringify(claims))}.${MOCK_SIGNATURE}`;
}

export function decodeJwt(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => p && B64U.test(p))) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    return obj(header) && obj(claims) ? { header, claims, signed: `${parts[0]}.${parts[1]}`, signature: parts[2] } : null;
  } catch { return null; }
}

// Which checks apply, in order. Every applicable check is always reported, so the table shows what failed and what held.
export const CHECK_ORDER = ['format', 'alg', 'typ', 'signature', 'issuer', 'audience', 'expiry', 'act', 'replay'];

const text = (v) => String(v).slice(0, 80);
const DETAIL = {
  format: (ok) => (ok ? 'three base64url segments; header and payload are JSON objects' : 'not a well-formed JWT'),
  alg: (ok, c) => (ok ? 'alg is RS256' : `alg ${text(c.alg)} is refused: only RS256 is accepted (no "none", no HS256)`),
  typ: (ok, c) => (ok ? `typ is ${text(c.typ)}` : `typ ${text(c.typ)} is not the expected ${text(c.expectedTyp)}`),
  signature: (ok, c) => (c.mock ? 'MOCK mode: the signature is a placeholder and is not verified; the outcome comes from the table' : ok ? `RSA signature verifies with key ${text(c.kid)} from the issuer's key set` : `signature does not verify (key ${text(c.kid)} not found, or the key does not match)`),
  issuer: (ok, c) => (ok ? `iss ${text(c.iss)} is trusted` : `iss ${text(c.iss)} is not a trusted issuer (expected ${text(c.expectedIss)})`),
  audience: (ok, c) => (ok ? `aud ${text(c.aud)} is this server` : `aud is ${text(c.aud)}, this server is ${text(c.expectedAud)}`),
  expiry: (ok, c) => (ok ? `exp ${c.exp} is after now ${c.now}` : `exp ${c.exp} is not after now ${c.now}: the token has expired`),
  act: (ok) => (ok ? 'an act claim names the original caller' : 'no act claim: the backend cannot tell who the original caller was'),
  replay: (ok, c) => (ok ? `jti ${text(c.jti)} has not been redeemed before` : `jti ${text(c.jti)} was already redeemed: replay refused`),
};
export const checkDetail = (id, ok, ctx) => DETAIL[id](ok, ctx);

const audOf = (a) => (Array.isArray(a) ? a.join(' ') : a);
const audIncludes = (a, want) => (Array.isArray(a) ? a.includes(want) : a === want);

function ctxOf(dec, rules) {
  const ctx = { now: rules.now, expectedAud: rules.aud, expectedTyp: rules.typ, expectedIss: Array.isArray(rules.iss) ? rules.iss.join(' ') : rules.iss };
  if (dec) Object.assign(ctx, { alg: dec.header.alg, typ: dec.header.typ, kid: dec.header.kid, iss: dec.claims.iss, aud: audOf(dec.claims.aud), exp: dec.claims.exp, jti: dec.claims.jti });
  return ctx;
}

// MOCK mode: the outcome of each check comes from a table, not from cryptography. The sentences are built the same way.
export const tableVerify = (token, results, rules) => finishChecks(results, { ...ctxOf(decodeJwt(token), rules), mock: true });

// rules: { jwks, iss (string or array of trusted), aud, now, requireAct, typ, seen (Set of jti for replay) }
export function verifyJwt(token, rules) {
  const dec = decodeJwt(token);
  const results = {};
  const ctx = ctxOf(dec, rules);
  if (!dec) {
    results.format = false;
  } else {
    const { header, claims } = dec;
    results.format = true;
    results.alg = header.alg === 'RS256';
    if (rules.typ) results.typ = header.typ === rules.typ;
    let sigOk = false;
    const jwk = rules.jwks.keys.find((k) => k.kid === header.kid);
    if (results.alg && jwk) {
      try { sigOk = createVerify('RSA-SHA256').update(dec.signed).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(dec.signature, 'base64url')); } catch { sigOk = false; }
    }
    results.signature = sigOk;
    const trusted = Array.isArray(rules.iss) ? rules.iss : [rules.iss];
    results.issuer = typeof claims.iss === 'string' && trusted.includes(claims.iss);
    results.audience = audIncludes(claims.aud, rules.aud);
    results.expiry = typeof claims.exp === 'number' && claims.exp > rules.now;
    if (rules.requireAct) results.act = claims.act !== null && typeof claims.act === 'object' && !Array.isArray(claims.act) && typeof claims.act.sub === 'string';
    if (rules.seen) results.replay = typeof claims.jti === 'string' && !rules.seen.has(claims.jti);
  }
  return finishChecks(results, ctx);
}

// results: { checkId: bool } for the checks that apply. Returns { ok, checks, ctx } with a detail sentence per check.
export function finishChecks(results, ctx) {
  const checks = CHECK_ORDER.filter((id) => Object.hasOwn(results, id)).map((id) => ({ id, ok: results[id], detail: DETAIL[id](results[id], ctx) }));
  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
}

export const newJti = () => randomBytes(9).toString('hex');
