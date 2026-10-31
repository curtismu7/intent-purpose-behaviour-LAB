// The two token flows, each in two modes.
//  MOCK: tokens carry a placeholder signature and the outcome of every check comes from a table (mockTable.json).
//  LIVE: tokens are signed with RSA keys generated in this process and verified for real, with an in-process "issuer" and
//        "downstream server". Nothing leaves the process: the "token endpoints" are plain function calls.
// Hosts are .example. Tokens are MOCK-ISSUED teaching tokens, shown raw. Request and response shapes follow RFC 8693 and the IETF
// ID-JAG draft as we understand them; which version the release implements is UNVERIFIED. Field names of any gateway policy are not shown.
import { decodeJwt, mockJwt, newJti, signJwt, tableVerify, verifyJwt } from './jwt.js';
import { getKeys, jwksOf } from './keys.js';
import { formatTraceparent, newTrace } from './trace.js';

const TTL = 300;
export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
export const ID_JAG_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
export const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const ID_JAG_TYP = 'oauth-id-jag+jwt';

export const OBO_SCENARIOS = [
  { id: 'ok', title: 'A valid exchange', expect: 'accepted', lesson: 'The gateway verifies the caller\'s token, swaps it for one minted for the MCP server, and the backend accepts it: right signature, right issuer, aud is itself, not expired, and an act claim names the original caller.' },
  { id: 'wrong-audience', title: 'Minted for a different server', expect: 'rejected', lesson: 'The exchanged token is valid, but its aud names another server. The backend validates a token issued to it, so it refuses one issued to someone else. This is what stops a token being replayed against a different backend.' },
  { id: 'expired', title: 'An expired token', expect: 'rejected', lesson: 'The exchanged token expired a minute ago. Short lifetimes are the point of minting per backend; the backend checks exp itself.' },
  { id: 'no-act', title: 'No act claim', expect: 'rejected', lesson: 'The token is for this server and in date, but nothing says who the original caller was. This backend requires the act claim (its own rule, invented for the lab) so it cannot be called anonymously through the gateway.' },
  { id: 'bad-signature', title: 'Signed by a key nobody trusts', expect: 'rejected', lesson: 'The header claims the right key id, but the signature was made with a different key. The backend verifies the signature against the issuer\'s published keys and refuses it.' },
  { id: 'shared-service-account', title: 'What the exchange replaces: a shared service account', expect: 'accepted-anonymous', lesson: 'Before: the gateway presents its own service-account token to every backend. The backend accepts it, but all it can see is the service account. Nobody can tell whose request this was, and the same token works against any backend that trusts the account.' },
];
export const IDJAG_SCENARIOS = [
  { id: 'ok', title: 'A valid redemption', expect: 'accepted', lesson: 'The user\'s IdP issues an identity assertion grant for the partner app\'s issuer. The gateway redeems it there, the partner issuer verifies it against the user IdP\'s published keys and mints its own access token. No shared secret, no consent prompt.' },
  { id: 'wrong-audience', title: 'A grant meant for a different issuer', expect: 'rejected', lesson: 'The grant\'s aud is not this issuer. A grant is only good at the one issuer it was minted for.' },
  { id: 'untrusted-issuer', title: 'A grant from an IdP the partner does not trust', expect: 'rejected', lesson: 'The partner issuer trusts specific IdPs, set up in advance by an administrator. A grant from any other issuer, or signed by an unknown key, is refused.' },
  { id: 'expired', title: 'An expired grant', expect: 'rejected', lesson: 'Grants are short-lived. An expired one is refused at redemption.' },
  { id: 'replay', title: 'The same grant redeemed twice', expect: 'second-rejected', lesson: 'The first redemption works. Redeeming the same grant again is refused because its jti was already used.' },
];

export const hostsFor = (cast) => ({
  idp: `https://idp.${cast.castHost}.example`,
  gateway: `https://gateway.${cast.castHost}.example`,
  mcp: `https://mcp.${cast.castHost}.example/${cast.castNouns}`,
  otherMcp: `https://mcp.other-${cast.castHost}.example/ledger`,
  partnerIssuer: `https://auth.partner-app.example`,
  partnerApi: `https://api.partner-app.example`,
  rogueIdp: 'https://idp.untrusted.example',
  user: `avery.lee@${cast.castHost}.example`,
});

// The OBO config: field names {TokenURL, ClientID, AuthMethod, Resource, Scope, SubjectTokenType, RequestedTokenType, Redeem} are from the
// Privilege console swagger (2026-10-31, schema only; behaviour not tested on our tenant). Resource (RFC 8707) is the exchanged token's aud.
// Redeem is the ID-JAG second leg. ClientSecret and PrivateKeyPEM exist in the schema and are write-only: the lab holds none.
export function oboConfig(cast, kind = 'obo') {
  const h = hostsFor(cast);
  const base = { TokenURL: `${h.idp}/as/token`, ClientID: 'gateway-exchange-client', AuthMethod: 'client_secret_basic', SubjectTokenType: ACCESS_TOKEN_TYPE };
  if (kind === 'obo') return { ...base, Resource: h.mcp, Scope: `${cast.castNouns}.read`, RequestedTokenType: '' };
  return { ...base, Resource: h.partnerIssuer, Scope: 'profile', RequestedTokenType: ID_JAG_TYPE, Redeem: { TokenURL: `${h.partnerIssuer}/token`, ClientID: 'gateway-client-at-partner', AuthMethod: 'client_secret_basic', Scope: 'profile' } };
}

const form = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('&\n');
const nowSec = () => Math.floor(Date.now() / 1000);

function setup(mode, now) {
  const live = mode === 'live';
  const keys = live ? getKeys() : null;
  const mint = (claims, { key, typ = 'JWT', kid }) => (live ? signJwt(claims, { key: key, typ }) : mockJwt(claims, { kid: kid || key?.kid || 'mock-key', typ }));
  return { live, keys, now: now ?? nowSec(), mint };
}
const view = (token) => { const d = decodeJwt(token); return { token, header: d.header, claims: d.claims }; };

// Each flow returns its hops: one traceparent per hop, with the raw request and response text.
function hopper(traceIn) {
  const trace = newTrace(traceIn);
  const hops = [];
  return {
    trace,
    hops,
    hop(label, from, to, request, response) {
      const tp = formatTraceparent(trace.traceId, trace.span());
      hops.push({ n: hops.length + 1, from, to, label, traceparent: tp, request: `${request}\ntraceparent: ${tp}`, response: `${response}\ntraceparent: ${tp}` });
    },
  };
}

export function runObo({ cast, scenario, mode, now, table, traceparent }) {
  const sc = OBO_SCENARIOS.find((s) => s.id === scenario);
  if (!sc) return null;
  const { live, keys, now: t, mint } = setup(mode, now);
  const h = hostsFor(cast);
  const tbl = table?.obo?.[scenario];
  const idpKey = live ? keys.userIdp : { kid: 'mock-user-idp-1' };
  const jwks = live ? jwksOf(keys.userIdp) : null;
  const H = hopper(traceparent);

  const original = mint({ iss: h.idp, sub: h.user, aud: h.gateway, client_id: cast.castAgentId, scope: `${cast.castNouns}.read`, iat: t, exp: t + 600, jti: newJti() }, { key: idpKey });
  const gwRules = { jwks, iss: h.idp, aud: h.gateway, now: t };
  const gatewayChecks = live ? verifyJwt(original, gwRules) : tableVerify(original, tbl?.gateway, gwRules);

  const shared = scenario === 'shared-service-account';
  const aud = scenario === 'wrong-audience' ? h.otherMcp : h.mcp;
  const exp = scenario === 'expired' ? t - 60 : t + TTL;
  const claims = shared
    ? { iss: h.idp, sub: 'svc-gateway', aud, scope: `${cast.castNouns}.read`, iat: t, exp, jti: newJti() }
    : { iss: h.idp, sub: h.user, aud, ...(scenario === 'no-act' ? {} : { act: { sub: cast.castAgentId } }), scope: `${cast.castNouns}.read`, iat: t, exp, jti: newJti() };
  const signKey = scenario === 'bad-signature' && live ? { ...keys.rogue, kid: keys.userIdp.kid } : idpKey;
  const exchanged = mint(claims, { key: signKey, kid: idpKey.kid });

  const cfg = oboConfig(cast, 'obo');
  // The request uses the config: resource = OBO.Resource (RFC 8707, becomes the exchanged aud). The wrong-audience case asks for the wrong one.
  const exchangeReq = { grant_type: TOKEN_EXCHANGE, subject_token: original, subject_token_type: cfg.SubjectTokenType, ...(cfg.RequestedTokenType ? { requested_token_type: cfg.RequestedTokenType } : {}), resource: aud, scope: cfg.Scope };
  H.hop('Agent calls the gateway with its token', 'agent', 'gateway', `POST ${h.gateway}/mcp/${cast.castNouns}\nAuthorization: Bearer <MOCK-ISSUED token, shown below>`, 'HTTP/1.1 (the gateway verifies the token, then exchanges it)');
  H.hop('Gateway exchanges the token (RFC 8693)', 'gateway', 'idp', `POST ${cfg.TokenURL} (in-process, no network)\ncontent-type: application/x-www-form-urlencoded\n\n${form(exchangeReq)}`, `HTTP/1.1 200 OK\n\n${JSON.stringify({ access_token: exchanged, issued_token_type: ACCESS_TOKEN_TYPE, token_type: 'Bearer', expires_in: TTL }, null, 2)}`);
  const rules = { jwks, iss: h.idp, aud: h.mcp, now: t, requireAct: !shared };
  const backend = live ? verifyJwt(exchanged, rules) : tableVerify(exchanged, tbl?.backend, rules);
  H.hop('Gateway calls the MCP server with the exchanged token', 'gateway', 'mcp', `POST ${h.mcp}/tools/call (in-process, no network)\nAuthorization: Bearer <exchanged token, shown below>`, backend.ok ? 'HTTP/1.1 200 OK' : `HTTP/1.1 401 Unauthorized\nfailed: ${backend.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`);
  const exClaims = decodeJwt(exchanged).claims;
  const attribution = {
    subject: exClaims.sub, actor: exClaims.act?.sub ?? null,
    text: exClaims.act?.sub ? `The backend can see the user (${exClaims.sub}) and the original caller (${exClaims.act.sub}).` : `The backend can only see ${exClaims.sub}. Nothing says who the original caller was.`,
  };
  return {
    mode, signed: live, scenario, title: sc.title, lesson: sc.lesson, expect: sc.expect,
    label: live ? 'MOCK-ISSUED teaching tokens, really signed with a key generated in this process; valid nowhere else' : 'MOCK-ISSUED teaching tokens with a placeholder signature; nothing is verified cryptographically',
    original: view(original), gatewayChecks, config: cfg, exchangeRequest: exchangeReq, exchanged: view(exchanged), backend, attribution,
    accepted: backend.ok, jwks: live ? jwks : null, traceId: H.trace.traceId, hops: H.hops,
  };
}

export function runIdJag({ cast, scenario, mode, now, table, traceparent }) {
  const sc = IDJAG_SCENARIOS.find((s) => s.id === scenario);
  if (!sc) return null;
  const { live, keys, now: t, mint } = setup(mode, now);
  const h = hostsFor(cast);
  const tbl = table?.idjag?.[scenario];
  const userKey = live ? keys.userIdp : { kid: 'mock-user-idp-1' };
  const appKey = live ? keys.appIdp : { kid: 'mock-app-issuer-1' };
  const userJwks = live ? jwksOf(keys.userIdp) : null;
  const appJwks = live ? jwksOf(keys.appIdp) : null;
  const H = hopper(traceparent);

  const original = mint({ iss: h.idp, sub: h.user, aud: h.gateway, client_id: cast.castAgentId, iat: t, exp: t + 600, jti: newJti() }, { key: userKey });
  const untrusted = scenario === 'untrusted-issuer';
  const grantClaims = {
    iss: untrusted ? h.rogueIdp : h.idp, sub: h.user, aud: scenario === 'wrong-audience' ? 'https://auth.other-partner.example' : h.partnerIssuer,
    client_id: 'gateway-client-at-partner', scope: 'profile', iat: t, exp: scenario === 'expired' ? t - 60 : t + TTL, jti: newJti(),
  };
  const grantKey = untrusted && live ? { ...keys.rogue, kid: 'mock-rogue-1' } : userKey;
  const grant = mint(grantClaims, { key: grantKey, typ: ID_JAG_TYP, kid: untrusted ? 'mock-rogue-1' : userKey.kid });

  const cfg = oboConfig(cast, 'idjag');
  const exchangeReq = { grant_type: TOKEN_EXCHANGE, subject_token: original, subject_token_type: cfg.SubjectTokenType, requested_token_type: cfg.RequestedTokenType, resource: cfg.Resource, scope: cfg.Scope };
  H.hop('Gateway asks the user\'s IdP for an identity assertion grant', 'gateway', 'idp', `POST ${cfg.TokenURL} (in-process, no network)\ncontent-type: application/x-www-form-urlencoded\n\n${form(exchangeReq)}`, `HTTP/1.1 200 OK\n\n${JSON.stringify({ access_token: grant, issued_token_type: ID_JAG_TYPE, token_type: 'N_A', expires_in: TTL }, null, 2)}`);

  const seen = new Set();
  const redeem = (token, tbls) => {
    const rules = { jwks: userJwks, iss: h.idp, aud: h.partnerIssuer, now: t, typ: ID_JAG_TYP, seen };
    const res = live ? verifyJwt(token, rules) : tableVerify(token, tbls, rules);
    if (res.ok) { const c = decodeJwt(token).claims; seen.add(c.jti); }
    return res;
  };
  const first = redeem(grant, tbl?.first);
  let access = null;
  if (first.ok) {
    access = mint({ iss: h.partnerIssuer, sub: h.user, aud: h.partnerApi, scope: 'profile', iat: t, exp: t + TTL, jti: newJti() }, { key: appKey });
  }
  const redeemReq = { grant_type: JWT_BEARER, assertion: grant, scope: cfg.Redeem.Scope, client_id: cfg.Redeem.ClientID };
  H.hop('Gateway redeems the grant at the app\'s own issuer', 'gateway', 'app-issuer', `POST ${cfg.Redeem.TokenURL} (in-process, no network)\ncontent-type: application/x-www-form-urlencoded\n\n${form(redeemReq)}`, first.ok ? `HTTP/1.1 200 OK\n\n${JSON.stringify({ access_token: access, token_type: 'Bearer', expires_in: TTL }, null, 2)}` : `HTTP/1.1 400 Bad Request\n\n{"error":"invalid_grant"}\nfailed: ${first.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`);
  let second = null;
  if (scenario === 'replay') {
    second = redeem(grant, tbl?.second);
    H.hop('Gateway (or an attacker) redeems the same grant again', 'gateway', 'app-issuer', `POST ${cfg.Redeem.TokenURL} (in-process, no network)\n\n${form(redeemReq)}`, `HTTP/1.1 400 Bad Request\n\n{"error":"invalid_grant"}\nfailed: ${second.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')}`);
  }
  let api = null;
  if (access) {
    const rules = { jwks: appJwks, iss: h.partnerIssuer, aud: h.partnerApi, now: t };
    api = live ? verifyJwt(access, rules) : tableVerify(access, tbl?.api, rules);
    H.hop('Gateway calls the partner app\'s API with its own token', 'gateway', 'app', `GET ${h.partnerApi}/me (in-process, no network)\nAuthorization: Bearer <partner-issued token, shown below>`, api.ok ? `HTTP/1.1 200 OK\n\n{"user":"${h.user}"}` : 'HTTP/1.1 401 Unauthorized');
  }
  return {
    mode, signed: live, scenario, title: sc.title, lesson: sc.lesson, expect: sc.expect,
    label: live ? 'MOCK-ISSUED teaching tokens, really signed with keys generated in this process; valid nowhere else' : 'MOCK-ISSUED teaching tokens with a placeholder signature; nothing is verified cryptographically',
    original: view(original), config: cfg, exchangeRequest: exchangeReq, grant: view(grant), redeemRequest: redeemReq, redeem: first, redeemAgain: second,
    access: access ? view(access) : null, api, accepted: !!(first.ok && api?.ok),
    proof: {
      consentPrompts: 0, sharedSecrets: 0,
      holds: [
        { party: 'User IdP', holds: 'its own signing key (private); no key or secret of the partner app' },
        { party: 'Partner app issuer', holds: 'the user IdP\'s public keys and a trust entry for that IdP; no secret of the user IdP, and no copy of the user\'s password' },
        { party: 'Gateway', holds: 'the caller\'s token and a short-lived grant; no credential that works at the partner app on its own' },
      ],
      notShown: 'Redeem.ClientID and Redeem.AuthMethod name how the gateway identifies itself to the partner issuer. The lab does not authenticate the client at all (ClientSecret and PrivateKeyPEM are write-only in the schema and the lab holds none), and how the release behaves is UNVERIFIED.',
    },
    jwks: live ? { userIdp: userJwks, appIssuer: appJwks } : null, traceId: H.trace.traceId, hops: H.hops,
  };
}
