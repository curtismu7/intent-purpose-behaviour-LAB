// "What Privilege did" for this lab: one trace per gateway call, built for the shared GatewayTrace panel (server/src/gatewayTrace.js, vendored, never edited).
//
// Two call sites, two honesty levels:
//  1. evaluateTrace: the lab's OWN simulated gateway (POST /api/evaluate, Mock and Live alike). Every decision is 'checked' because decide() really
//     evaluated it, in the order decide() evaluates it: intent patterns, purpose, intent similarity, behaviour. Mock reads the signal values from the
//     generated mock table and Live computes them now, but in both decide() judges them under the caller's policy; the record line says which. The
//     simulation has no JSON-RPC message, so the request body is the call the lab models (what the existing hop shows) and the response body is the
//     verdict it returns. The host is a non-real one (.invalid). Nothing is invented: a decision that did not fire is a 'pass' only where the code
//     really found nothing; a score that was not enforced (learning, scoring, disabled) is 'info', never a pass.
//  2. aiGuardTrace / aiGuardFailure: the REAL hop (POST /api/privilege-check, A2A message/send to the tenant's AI Guard). The gateway returns a status and
//     a body, not a per-check list, so every decision is 'inferred' or 'observed' (realDecisions), plus one 'observed' line for the verdict the lab reads
//     from the answer text. Neither the bearer nor the full URL query is ever shown.
import { bearerForDisplay, failureTrace, mockTrace, realTrace } from './gatewayTrace.js';

const GROUPS = [
  { id: 'pattern', label: 'Intent: deterministic patterns', match: /INTENT-PATTERN/, none: () => 'no deterministic pattern matched' },
  { id: 'purpose', label: 'Purpose: inside the declared profile', match: /PURPOSE/, none: (s) => `the call is inside the declared purpose${s.purpose.declared ? ` (${s.purpose.declared})` : ''}` },
  { id: 'similarity', label: 'Intent: similarity to a risky intent', match: /INTENT-SIMILARITY/, none: (s) => `similarity ${s.intent.semantic.riskScore.toFixed(2)} is below the alert threshold` },
  { id: 'behaviour', label: 'Behaviour: departure from this agent\'s normal', match: /BEHAVIOUR/, none: () => 'no behaviour finding' },
];
const NOT_ACTED_ON = new Set(['BEHAVIOUR-DISABLED', 'BEHAVIOUR-LEARNING', 'BEHAVIOUR-SCORING']); // an allow that scored nothing, or did not act on a score
const WHAT = { deny: 'refused', ask: 'held for a person to approve', alert: 'alert raised, the call goes through' };

// What decide() recorded for one signal, as a decision. deny -> fail; ask and alert -> info (the call is held or alerted, not passed); an allow that
// scored nothing (learning, scoring, disabled) -> info; an allow that really looked at the call -> pass.
function decisionFor(group, reasons, signals) {
  if (!reasons.length) return { id: group.id, label: group.label, outcome: 'pass', evidence: group.none(signals) };
  const worst = ['deny', 'ask', 'alert', 'allow'].find((e) => reasons.some((r) => r.effect === e));
  const outcome = worst === 'deny' ? 'fail' : worst === 'allow' && !reasons.some((r) => NOT_ACTED_ON.has(r.code)) ? 'pass' : 'info';
  const lead = WHAT[worst] ? `${WHAT[worst]}: ` : '';
  return { id: group.id, label: group.label, outcome, evidence: `${lead}${reasons.map((r) => r.detail).join('; ')}` };
}

// out: what evaluateScenario / evaluateCustom returned (signals, reasons, decision, reasonCode, decidedBy, call, mode).
export function evaluateTrace({ cast, out, traceparent }) {
  const status = out.blocked ? 403 : out.heldForPerson ? 202 : 200;
  const decisions = GROUPS.map((g) => decisionFor(g, out.reasons.filter((r) => g.match.test(r.code)), out.signals));
  const where = out.mode === 'live' ? 'Live: the local engine computed the signals now' : 'Mock: the signals were read from the generated mock table';
  const trace = mockTrace({
    url: `https://mcp.${cast.castHost}.invalid/mcp`,
    authorization: 'Bearer <MOCK-ISSUED token>',
    rpc: out.call,
    status,
    headers: { 'x-decision': out.decision, 'x-reason': out.reasonCode, traceparent },
    body: { decision: out.decision, reasonCode: out.reasonCode, decidedBy: out.decidedBy },
    decisions,
    record: `${where}, then decide() judged them under the policy sent with the request: decision=${out.decision} reason=${out.reasonCode}. This lab writes no log of its own.`,
  });
  trace.request.headers = { authorization: trace.request.headers.authorization, 'content-type': 'application/json', traceparent }; // what the lab models, not the shared default
  return trace;
}

// ---- The real hop: Privilege AI Guard -------------------------------------------------------------------
const clean = (value, secret) => {
  if (!secret) return value;
  const json = JSON.stringify(value);
  if (json === undefined) return value;
  const escaped = JSON.stringify(secret).slice(1, -1);
  return JSON.parse(json.split(escaped).join('[redacted]').split(secret).join('[redacted]'));
};
// The configured URL, without userinfo, query or fragment: only where the call went, never a credential carried in the address.
const shownUrl = (url) => { try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return ''; } };
const authorizationFor = (cfg) => bearerForDisplay('<the configured bearer>', () => cfg.bearer);

// answer: what sendToAiGuard returned ({ status, body, raw, mapped, headers, sent }).
export function aiGuardTrace({ cfg, answer }) {
  const m = answer.mapped;
  const trace = realTrace({
    url: shownUrl(answer.sent.url),
    authorization: authorizationFor(cfg),
    rpc: clean(answer.sent.body, cfg.bearer),
    status: answer.status,
    headers: clean(answer.headers, cfg.bearer),
    body: clean(answer.body ?? answer.raw, cfg.bearer),
    credential: 'workload-token', // the configured bearer is a token the gateway checks; the lab does not know which kind, so the wording stays generic
  });
  trace.request.headers = { authorization: trace.request.headers.authorization, 'content-type': 'application/json' }; // exactly what sendToAiGuard sends
  // The verdict is the lab's reading of the answer text (a block message, or a [REDACTED:...] marker): read from the response, never checked.
  trace.decisions.push(m
    ? { id: 'verdict', label: 'AI Guard verdict', outcome: m.decision === 'deny' ? 'fail' : 'pass', basis: 'observed', evidence: `${m.reasonCode}: ${m.decidedBy}. The lab reads this from the answer text, as measured on the live gateway; the gateway does not list which check fired.` }
    : { id: 'verdict', label: 'AI Guard verdict', outcome: 'info', basis: 'observed', evidence: 'the answer had a shape the lab could not map to allow or deny' });
  return trace;
}

// The gateway could not be reached in time: a request, no response, one failed decision.
export function aiGuardFailure({ cfg, sent, error }) {
  return failureTrace({ url: shownUrl(sent.url), authorization: authorizationFor(cfg), rpc: clean(sent.body, cfg.bearer), error });
}
