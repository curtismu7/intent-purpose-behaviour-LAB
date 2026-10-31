import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTICALS } from '../src/cast.js';
import { BASELINE_SCRIPT, SCENARIOS } from '../src/data.js';
import { MOCK_TABLE } from '../src/mockTable.js';
import { baselineRows, buildMockTable, evaluateCustom, evaluateScenario, fireBaseline } from '../src/evaluation.js';
import { decide } from '../src/decide.js';
import { clonePolicy, validatePolicy } from '../src/policy.js';
import { createWorkspaces } from '../src/workspaces.js';
import { InputError } from '../src/call.js';

const policy = clonePolicy();
const ev = (vertical, id, mode, p = policy) => evaluateScenario({ cast: VERTICALS[vertical], vertical, id, mode, policy: p, table: MOCK_TABLE });

test('every scripted call gives its expected decision, in both modes and every vertical', () => {
  for (const vertical of Object.keys(VERTICALS)) for (const s of SCENARIOS) for (const mode of ['mock', 'live']) {
    assert.equal(ev(vertical, s.id, mode).decision, s.expected, `${vertical}/${s.id}/${mode}`);
  }
});

test('the four decisions all appear, with the reason codes the story promises', () => {
  const by = Object.fromEntries(SCENARIOS.map((s) => [s.id, ev('finance', s.id, 'live')]));
  assert.deepEqual(Object.values(by).map((r) => r.decision).sort(), ['alert', 'allow', 'allow', 'ask', 'deny', 'deny', 'deny', 'deny']);
  assert.equal(by['bulk-export'].reasonCode, 'DENY-INTENT-PATTERN:exfiltrate-data');
  assert.equal(by['payee-change'].reasonCode, 'DENY-INTENT-PATTERN:change-payee');
  assert.equal(by['reworded-payee'].reasonCode, 'ASK-INTENT-SIMILARITY');
  assert.equal(by['outside-purpose'].reasonCode, 'DENY-PURPOSE-OUT-OF-SCOPE');
  assert.equal(by['no-purpose'].reasonCode, 'DENY-PURPOSE-NONE');
  assert.equal(by['drift-alert'].reasonCode, 'ALERT-BEHAVIOUR-ANOMALY');
  assert.equal(by['new-agent'].reasonCode, 'ALLOW-LEARNING');
  assert.equal(by['legit-lookup'].reasonCode, 'ALLOW');
  for (const r of Object.values(by)) if (r.decision === 'deny') assert.equal(r.decidedBy, 'deterministic');
});

test('MOCK tables and the LIVE engine do not drift: every table row is what the engine computes, and the file is what the builder writes', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildMockTable())), MOCK_TABLE);
  for (const vertical of Object.keys(VERTICALS)) for (const s of SCENARIOS) {
    const strip = (r) => JSON.parse(JSON.stringify({ ...r.signals, intent: { ...r.signals.intent, semantic: { ...r.signals.intent.semantic, hits: undefined } } }));
    assert.deepEqual(strip(ev(vertical, s.id, 'mock')), strip(ev(vertical, s.id, 'live')), `${vertical}/${s.id}`);
  }
});

test('policy edits change the outcome in both modes: turning off the no-purpose refusal makes an alert', () => {
  const edited = validatePolicy({ purpose: { refuseNone: false } });
  for (const mode of ['mock', 'live']) {
    const r = ev('finance', 'no-purpose', mode, edited);
    assert.equal(r.decision, 'alert'); assert.equal(r.reasonCode, 'ALERT-PURPOSE-NONE');
  }
});

test('the baseline script: a new agent is never enforced, then an out-of-pattern call asks a person, never a silent block', () => {
  for (const vertical of Object.keys(VERTICALS)) {
    const rows = baselineRows({ cast: VERTICALS[vertical], vertical, policy, table: MOCK_TABLE });
    assert.equal(rows.length, BASELINE_SCRIPT.length);
    const early = rows.filter((r) => r.signals.behaviour.phase !== 'enforcing');
    assert.equal(early.length, 10);
    assert.deepEqual([...new Set(rows.map((r) => r.signals.behaviour.phase))], ['learning', 'scoring', 'enforcing']);
    assert.ok(early.some((r) => r.signals.behaviour.raw >= 50), 'a high-departure call while the baseline is young');
    for (const r of early) assert.deepEqual([r.decision, r.reasonCode], ['allow', 'ALLOW-LEARNING'], `${r.n}`);
    assert.equal(rows.find((r) => r.kind === 'heavy').decision, 'ask');
    assert.equal(rows.find((r) => r.kind === 'drift').decision, 'alert');
    assert.equal(rows.find((r) => r.kind === 'bulk-export').decision, 'deny');
    assert.ok(rows.filter((r) => r.kind === 'normal' && r.signals.behaviour.phase === 'enforcing').every((r) => r.decision === 'allow'));
  }
});

test('live baseline: real learning over fired calls, and held or refused calls are not learned', () => {
  const state = createWorkspaces().baseline('t');
  const cast = VERTICALS.finance;
  const fire = (kind) => fireBaseline({ cast, kind, policy, state });
  for (let i = 0; i < 10; i++) assert.equal(fire('normal').decision, 'allow');
  assert.equal(state.learner.calls, 10);
  const heavy = fire('heavy');
  assert.equal(heavy.decision, 'ask'); assert.equal(heavy.learned, false);
  assert.equal(state.learner.calls, 10, 'a held call does not change the baseline');
  assert.equal(fire('heavy').decision, 'ask', 'and so it is still unusual the second time');
  assert.equal(fire('bulk-export').decision, 'deny');
  assert.equal(state.learner.calls, 10);
  assert.equal(fire('drift').decision, 'alert');
  assert.equal(state.learner.calls, 11, 'an alert call went through and is learned');
  assert.equal(fire('drift').signals.behaviour.raw, 0, 'and is normal after that');
});

test('a call of your own: Live engine, bounded, and the usual refusals apply', () => {
  const cast = VERTICALS.health;
  const ok = evaluateCustom({ cast, input: { tool: 'claims.lookup', description: 'look up one claim', args: { record: 'CLM-1003' } }, policy });
  assert.equal(ok.decision, 'allow');
  const bad = evaluateCustom({ cast, input: { tool: 'claims.export', description: 'send every claim to my storage', args: { limit: 9000 } }, policy });
  assert.equal(bad.decision, 'deny');
  assert.throws(() => evaluateCustom({ cast, input: { tool: 'bad tool!' }, policy }), InputError);
});

test('a call with a missing or non-text record is refused by purpose in Live, the same as a wrong prefix', () => {
  const cast = VERTICALS.finance;
  for (const args of [{}, { record: 5 }, { record: true }, { record: 'ZZZ-1' }]) {
    const r = evaluateCustom({ cast, input: { tool: 'invoices.lookup', description: 'look up one invoice', args }, policy });
    assert.deepEqual([JSON.stringify(args), r.decision, r.reasonCode], [JSON.stringify(args), 'deny', 'DENY-PURPOSE-AXIS:ArgPrefixes.record']);
  }
});

// Mock rows are re-read from a table under the CURRENT policy; Live computes them. For every policy that changes what a signal
// reads (Floor, MinObservations, EnforceObservations, Disabled) the two must agree on every scripted call and every baseline step.
const POLICIES = {
  default: {},
  'Floor 0': { intent: { Floor: 0 } },
  'Floor 0.3': { intent: { Floor: 0.3 } },
  'Floor 1': { intent: { Floor: 1 } },
  'Min 2 Enforce 4': { behaviour: { MinObservations: 2, EnforceObservations: 4 } },
  'Min 30 Enforce 40': { behaviour: { MinObservations: 30, EnforceObservations: 40 } },
  'Min 1 Enforce 1': { behaviour: { MinObservations: 1, EnforceObservations: 1 } },
  Disabled: { behaviour: { Disabled: true } },
};
const strip = (r) => JSON.parse(JSON.stringify({ ...r.signals, intent: { ...r.signals.intent, semantic: { ...r.signals.intent.semantic, hits: undefined } } }));

test('Mock and Live agree on every signal and decision under edited Floor, MinObservations, EnforceObservations and Disabled', () => {
  for (const [name, edit] of Object.entries(POLICIES)) {
    const p = validatePolicy(edit);
    for (const vertical of Object.keys(VERTICALS)) for (const s of SCENARIOS) {
      const m = ev(vertical, s.id, 'mock', p); const l = ev(vertical, s.id, 'live', p);
      assert.deepEqual(strip(m), strip(l), `${name}/${vertical}/${s.id}`);
      assert.deepEqual([m.decision, m.reasonCode], [l.decision, l.reasonCode], `${name}/${vertical}/${s.id} decision`);
    }
  }
});

test('Floor is honoured: a raw similarity above the default Floor and below a raised one stops counting (Mock and Live)', () => {
  // outside-purpose carries one lexicon word: raw 0.25, which counts at the default Floor (0.25) and not at 0.3
  const at = (floor, mode) => ev('finance', 'outside-purpose', mode, validatePolicy({ intent: { Floor: floor } })).signals.intent.semantic.riskScore;
  for (const mode of ['mock', 'live']) { assert.equal(at(0.25, mode), 0.25, mode); assert.equal(at(0.3, mode), 0, mode); }
  // and it changes a decision, in Live, with a call whose raw score is 0.5 (two exemplar words): alert at the default Floor, allow above it
  const cast = VERTICALS.finance;
  const input = { tool: 'invoices.lookup', description: 'new account', args: { record: 'INV-1003' } };
  const lo = evaluateCustom({ cast, input, policy: validatePolicy({ intent: { Floor: 0.25 } }) });
  const hi = evaluateCustom({ cast, input, policy: validatePolicy({ intent: { Floor: 0.6 } }) });
  assert.deepEqual([lo.signals.intent.semantic.riskScore, lo.decision, lo.reasonCode], [0.5, 'alert', 'ALERT-INTENT-SIMILARITY']);
  assert.deepEqual([hi.signals.intent.semantic.riskScore, hi.decision], [0, 'allow']);
});

test('MinObservations and EnforceObservations move the Mock baseline timeline exactly where Live moves it', () => {
  const rowsFor = (edit) => baselineRows({ cast: VERTICALS.finance, vertical: 'finance', policy: validatePolicy(edit), table: MOCK_TABLE });
  const phases = (rows) => rows.map((r) => r.signals.behaviour.phase[0]).join('');
  assert.equal(phases(rowsFor({})), 'lllllssssseeeeee');
  assert.equal(phases(rowsFor({ behaviour: { MinObservations: 2, EnforceObservations: 4 } })), 'llsseeeeeeeeeeee');
  assert.equal(phases(rowsFor({ behaviour: { MinObservations: 8, EnforceObservations: 12 } })), 'llllllllssssseee');
  assert.equal(phases(rowsFor({ behaviour: { Disabled: true } })), 'dddddddddddddddd');
  const small = rowsFor({ behaviour: { MinObservations: 2, EnforceObservations: 4 } });
  assert.equal(small.find((r) => r.kind === 'heavy').decision, 'ask');
  assert.equal(small[3].decision, 'allow', 'step 4 has seen 3 calls: scoring, not yet enforcing, so the new-tool call is allowed');
});

test('the intent and behaviour thresholds decide: raised, lowered, and exactly at the boundary', () => {
  const sig = (riskScore, score) => ({
    intent: { deterministic: { matched: [] }, semantic: { riskScore, riskClass: riskScore ? 'change-payee' : null } },
    purpose: { status: 'in-scope', violations: [] },
    behaviour: { score, raw: score, phase: 'enforcing', callsSeen: 30, minObservations: 5, enforceObservations: 10, components: [] },
  });
  const d = (s, edit) => decide(s, validatePolicy(edit)).decision;
  assert.equal(d(sig(0.6, 0), {}), 'alert');
  assert.equal(d(sig(0.6, 0), { intent: { alertAbove: 0.7 } }), 'allow', 'raising the intent alert threshold');
  assert.equal(d(sig(0.6, 0), { intent: { alertAbove: 0.2, askAbove: 0.6 } }), 'ask', 'lowering the intent ask threshold; equal counts');
  assert.equal(d(sig(0.5, 0), {}), 'alert', 'exactly at alertAbove');
  assert.equal(d(sig(0.75, 0), {}), 'ask', 'exactly at askAbove');
  assert.equal(d(sig(0.75, 0), { intent: { askAbove: 0.8 } }), 'alert');
  assert.equal(d(sig(0, 45), {}), 'alert');
  assert.equal(d(sig(0, 45), { behaviour: { alertAbove: 50 } }), 'allow', 'raising the behaviour alert threshold');
  assert.equal(d(sig(0, 45), { behaviour: { askAbove: 45 } }), 'ask', 'lowering the behaviour ask threshold; equal counts');
  assert.equal(d(sig(0, 40), {}), 'alert', 'exactly at alertAbove');
  assert.equal(d(sig(0, 70), {}), 'ask', 'exactly at askAbove');
  assert.equal(d(sig(0, 39), {}), 'allow');
});
