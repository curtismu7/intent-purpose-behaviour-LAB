// Rule 27: this lab's half of the shared run-observability panel. A run (one evaluate or OBO request) computes its events ONCE, stamps
// each once, stores them in the workspace, and writes one stdout line per POLICY-POINT decision from the same events. The record the
// panel reads is built from the stored events by the shared core (runObservability.js). The lab reads no product log, and every stored
// row is a simulated event the Mock computed from its table. Live runs (the in-process engine) are not stored: a Real record would claim
// a basis the lab does not have, so a Live run gets no run id and its decision lines carry run=none.
import crypto from 'node:crypto';
import { LAYERS, createMasker, createRunObservability } from './runObservability.js';

export const LAB = 'intent-purpose-behaviour-lab';
const RESULT_OF = { allowed: 'passed', refused: 'stopped', info: 'unclear' };
const { mask } = createMasker();
const obs = createRunObservability({ readers: [] });
const nowIso = () => new Date().toISOString();
let seq = 0;

export const RUN_ID_RE = /^r[0-9a-z]{1,8}-[0-9a-f]{8}$/;
export const newRunId = () => `r${(seq += 1).toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

// A stdout value keeps only [A-Za-z0-9._:/@-] after masking, so a hostile value cannot add a second key=value or a second line.
export const clean = (v) => mask(String(v ?? '')).replace(/[^A-Za-z0-9._:/@-]/g, '').slice(0, 80) || 'none';

// One decision line: time = the event's own time, the same string the record carries.
export function decisionLine({ event, actor, runId }) {
  return `${event.at} ${LAB} decision step=${clean(event.step)} actor=${clean(actor)} result=${RESULT_OF[event.outcome]} run=${clean(runId)}`;
}

const failedIds = (r) => (r?.checks ?? []).filter((c) => !c.ok).map((c) => c.id);
const ev = (stamp, layer, outcome, message, extra = {}) => ({ at: stamp(), layer, outcome, message, ...extra });

// The evaluate run: the lab's three signals read the call, the gateway's policy gives the one decision (allow / alert / ask / deny).
export function evaluateEvents(out, stamp) {
  const why = out.reasonCode;
  const gate = out.decision === 'deny' ? ['refused', `The gateway refused the call (${why}).`]
    : out.decision === 'ask' ? ['info', `The gateway held the call for a person to approve (${why}). No answer is recorded yet.`]
      : ['allowed', `The gateway let the call through (${why})${out.decision === 'alert' ? ', and a person is told it was unusual' : ''}.`];
  return [
    ev(stamp, 'agent', 'info', `The agent ${out.agent} sent the call for "${out.title}" to the gateway.`),
    ev(stamp, 'privilege', 'info', 'The lab\'s three signals (intent, purpose, behaviour) read the call. This is the lab\'s own reading, not a product log.'),
    ev(stamp, 'gateway', gate[0], gate[1], { decision: true, step: 'gateway' }),
  ];
}

// The OBO run: the gateway checks the caller's token and exchanges it (issuing is not a decision); the MCP server's check is the one decision.
export function oboEvents(out, stamp) {
  const gw = failedIds(out.gatewayChecks);
  const be = failedIds(out.backend);
  const named = Boolean(out.attribution.actor);
  const served = out.backend.ok
    ? ['allowed', named ? 'The MCP server accepted the exchanged token and can see the original caller.' : 'The MCP server accepted the exchanged token, but it names no original caller (anonymous).']
    : ['refused', `The MCP server refused the exchanged token (${be.join(', ') || 'no check named'}).`];
  return [
    ev(stamp, 'agent', 'info', 'The agent presented its token to the gateway (a MOCK-ISSUED teaching token).'),
    ev(stamp, 'gateway', 'info', gw.length ? `The gateway's check of the caller's token did not pass: ${gw.join(', ')}.` : 'The gateway\'s check of the caller\'s token passed.'),
    ev(stamp, 'gateway', 'info', `The gateway exchanged the token at this lab's own token endpoint (RFC 8693) for one with audience ${out.exchanged.claims.aud}. Issuing a token is not a decision.`),
    ev(stamp, 'resource', served[0], served[1], { decision: true, step: 'resource' }),
  ];
}

const NOT_ASKED = {
  person: 'This lab has no sign-in step: the caller is a sample identity, so there is no person log to read.',
  authorize: 'This lab does not call PingOne Authorize, so no Authorize decision exists for the run.',
  privilege: 'This run has no Privilege policy step of its own. The three signals are the lab\'s reading, shown on the privilege row when the run has one.',
  resource: 'This run does not call the MCP server, so no resource decision exists for it.',
};

// The six layer specs for one run. A layer with no event is not-logged with its reason; every row is a simulated Mock event.
function specsFor(run) {
  return LAYERS.map((layer) => {
    const rows = run.events.filter((e) => e.layer === layer).map(({ at, outcome, message }) => ({ at, outcome, message }));
    const spec = { layer, products: [], simulated: rows };
    if (!rows.length) spec.reason = NOT_ASKED[layer] || 'This run does not reach this layer.';
    return spec;
  });
}

// Computes the run ONCE: id first, then the events (each stamped once), then the run is stored, then its stdout lines are written.
// `store` is the workspaces store (addRun); `emit(run)` writes the lines and must never throw into the answer. A Live run is not stored:
// its lines are written with no run id (run=none) and the answer carries runId null.
export function recordRun({ ws, store, emit, mode, kind, scenario, actor, build }) {
  if (mode !== 'mock' && mode !== 'live') throw new Error(`no run mode ${typeof mode}`);
  if (mode === 'live') {
    emit({ actor, events: build(nowIso) });
    return { runId: null };
  }
  const runId = newRunId();
  const startedAt = nowIso();
  const events = build(nowIso);
  const run = { runId, kind, scenario, mode, source: 'mock', startedAt, endedAt: nowIso(), actor, events };
  store.addRun(ws, run);
  emit(run);
  return run;
}

// The record for one stored run, built by the shared core from its stored events only (never a re-run).
export function recordOf(run) {
  return obs.collectRun({ runId: run.runId, startedAt: run.startedAt, endedAt: run.endedAt, correlation: {}, layers: specsFor(run), source: run.source });
}

// One stdout line per policy-point decision. A failed write drops that one line, prints its error code only (never the message), and the run is unaffected.
export function createDecisionLog(write) {
  return (run) => {
    for (const event of run.events) {
      if (!event.decision) continue;
      try { write(decisionLine({ event, actor: run.actor, runId: run.runId })); } catch (e) {
        process.stderr.write(`[${LAB}] a decision line was not written (${e?.code || e?.name || 'error'})\n`);
      }
    }
  };
}
