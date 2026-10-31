import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTICALS } from '../src/cast.js';
import { BASELINE_SCRIPT, SCENARIOS } from '../src/data.js';
import { MOCK_TABLE } from '../src/mockTable.js';
import { baselineRows, buildMockTable, evaluateCustom, evaluateScenario, fireBaseline } from '../src/evaluation.js';
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
