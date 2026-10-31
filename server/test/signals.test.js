import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, normalizeCall } from '../src/call.js';
import { classify, similarity } from '../src/intent.js';
import { evaluatePurpose } from '../src/purpose.js';
import { createLearner, isEstablished, observe, phaseOf, scoreBehaviour, CAPS } from '../src/behaviour.js';
import { DEFAULT_POLICY, clonePolicy, validatePolicy } from '../src/policy.js';
import { decide } from '../src/decide.js';
import { evaluateLive, learnerFrom } from '../src/engine.js';
import { PURPOSE_PROFILE, seedCalls } from '../src/data.js';
import { DEFAULT_CAST, fillDeep } from '../src/cast.js';

const C = DEFAULT_CAST;
const decl = fillDeep(PURPOSE_PROFILE, C);
const call = (tool, args = {}, description = '') => normalizeCall({ tool, description, args });
const policy = clonePolicy();

test('normalizeCall bounds its input and strips control characters', () => {
  assert.deepEqual(normalizeCall({ tool: 'a.b', description: 'x‮y', args: { record: 'R\u0000-1' } }), { tool: 'a.b', description: 'x y', args: { record: 'R -1' } });
  for (const bad of [null, [], { tool: 'a b' }, { tool: '' }, { tool: 'x'.repeat(65) }, { tool: 'a', description: 5 }, { tool: 'a', args: [] }, { tool: 'a', args: { 'A-b': 1 } }, { tool: 'a', args: { __proto__x: 1 } }, { tool: 'a', args: { k: {} } }, { tool: 'a', args: { k: Infinity } }, { tool: 'a', args: { k: 1e9 } }]) {
    assert.throws(() => normalizeCall(bad), InputError, JSON.stringify(bad));
  }
  assert.throws(() => normalizeCall({ tool: 'a', args: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 1])) }), /at most 8/);
  assert.equal(normalizeCall({ tool: 'a', description: 'y'.repeat(900) }).description.length, 200);
});

test('hostile text is classified in bounded time (no regex is built from user input)', () => {
  const nasty = `${'a'.repeat(60)}!`.repeat(3000);
  const t = Date.now();
  for (let i = 0; i < 50; i++) classify(normalizeCall({ tool: 'x.y', description: nasty, args: { record: nasty } }));
  assert.ok(Date.now() - t < 2000, 'bounded');
});

test('intent: deterministic patterns catch a bulk export and a payee change by what they are', () => {
  assert.deepEqual(classify(call('invoices.export', { limit: 10 })).deterministic.matched.map((m) => m.id), ['exfiltrate-data']);
  assert.deepEqual(classify(call('invoices.lookup', { limit: 5000 })).deterministic.matched.map((m) => m.id), ['exfiltrate-data'], 'a huge read is a bulk export whatever it is called');
  assert.deepEqual(classify(call('invoices.lookup', { record: 'a', destination: 'https://x.example/' })).deterministic.matched.map((m) => m.id), ['exfiltrate-data']);
  assert.deepEqual(classify(call('payees.update', { payee: 'P-1' })).deterministic.matched.map((m) => m.id), ['change-payee']);
  assert.deepEqual(classify(call('refunds.update_destination')).deterministic.matched.map((m) => m.id), ['change-payee']);
  assert.deepEqual(classify(call('payees.lookup', { payee: 'P-1' })).deterministic.matched, [], 'reading a payee is not changing one');
  assert.deepEqual(classify(call('invoices.lookup', { record: 'INV-1' }, 'look up one invoice')).deterministic.matched, []);
});

test('intent: similarity sees a reworded payee change that no pattern matches', () => {
  const r = classify(call('invoices.annotate', { record: 'INV-1' }, 'set the remittance account for this supplier to the new account details'));
  assert.deepEqual(r.deterministic.matched, []);
  assert.equal(r.semantic.riskClass, 'change-payee');
  assert.equal(r.semantic.riskScore, 1);
  assert.ok(r.semantic.hits.includes('remittance'));
  assert.equal(similarity(call('invoices.lookup', { record: 'INV-1' }, 'look up the status of one invoice')).riskScore, 0);
});

test('purpose: none, outside, axis and in-scope', () => {
  assert.equal(evaluatePurpose(call('invoices.lookup'), null).status, 'none');
  assert.equal(evaluatePurpose(call('invoices.lookup', { record: 'INV-1' }), decl).status, 'in-scope');
  assert.equal(evaluatePurpose(call('vendors.lookup'), decl).status, 'outside');
  const axis = evaluatePurpose(call('invoices.lookup', { record: 'XYZ-1' }), decl);
  assert.equal(axis.status, 'axis');
  assert.equal(axis.violations[0].axis, 'ArgPrefixes.record');
  assert.equal(evaluatePurpose(call('invoices.lookup', { record: 'INV-9' }), decl).status, 'in-scope');
  assert.equal(evaluatePurpose(call('invoices.lookup', { record: 'INV-1', limit: 5000 }), decl).status, 'in-scope', 'record counts are not a purpose axis; the intent pattern handles those');
  // a constrained argument that is missing or not text is a violation, not a free pass
  for (const [label, args] of [['number', { record: 5 }], ['boolean', { record: true }], ['missing', {}], ['missing, others present', { limit: 3 }], ['empty text', { record: '' }]]) {
    const r = evaluatePurpose(call('invoices.lookup', args), decl);
    assert.deepEqual([label, r.status, r.violations[0]?.axis], [label, 'axis', 'ArgPrefixes.record']);
  }
  assert.match(evaluatePurpose(call('invoices.lookup', { record: 5 }), decl).violations[0].detail, /number, not text/);
  assert.match(evaluatePurpose(call('invoices.lookup'), decl).violations[0].detail, /missing/);
  assert.equal(evaluatePurpose(call('invoices.lookup'), { ...decl, Targets: ['ledgers'] }).violations[0].axis, 'Targets');
});

test('behaviour: scores a new tool, target, shape and volume, and learns', () => {
  const l = learnerFrom(seedCalls(C, 24));
  assert.equal(scoreBehaviour(l, call('invoices.lookup', { record: 'INV-1003' }), policy).score, 0);
  const s = scoreBehaviour(l, call('invoices.lookup', { record: 'INV-0007', include_history: true }), policy);
  assert.deepEqual(s.components.map((c) => c.id), ['new-target', 'new-arg-shape']);
  assert.equal(s.score, 50);
  assert.equal(scoreBehaviour(l, call('invoices.escalate', { record: 'INV-0999', limit: 80 }), policy).score, 100, 'capped at 100');
  observe(l, call('invoices.lookup', { record: 'INV-0007', include_history: true }));
  assert.equal(scoreBehaviour(l, call('invoices.lookup', { record: 'INV-0007', include_history: true }), policy).score, 0, 'once learned it is normal');
});

test('behaviour phases: learning, scoring, enforcing, and disabled reads 0 and learns nothing; the learner is bounded', () => {
  const l = createLearner();
  const phases = [];
  for (let i = 0; i < policy.behaviour.EnforceObservations + 1; i++) { phases.push(phaseOf(l, policy)); observe(l, call('a.b', { record: `R-${i}` }), policy); }
  assert.deepEqual([...new Set(phases)], ['learning', 'scoring', 'enforcing']);
  assert.equal(phases.indexOf('scoring'), policy.behaviour.MinObservations);
  assert.equal(phases.indexOf('enforcing'), policy.behaviour.EnforceObservations);
  assert.equal(isEstablished(l, policy), true);
  const tuned = validatePolicy({ behaviour: { MinObservations: 2, EnforceObservations: 4 } });
  const fresh = createLearner(); const seen = [];
  for (let i = 0; i < 6; i++) { seen.push(phaseOf(fresh, tuned)[0]); observe(fresh, call('a.b', { record: `R-${i}` }), tuned); }
  assert.equal(seen.join(''), 'llssee', 'phaseOf follows the edited Min and Enforce');
  const off = validatePolicy({ behaviour: { Disabled: true } });
  const odd = scoreBehaviour(l, call('zz.zz', { record: 'Q' }), off);
  assert.deepEqual([odd.phase, odd.score, odd.components.length], ['disabled', 0, 0]);
  const calls = l.calls; observe(l, call('a.b'), off); assert.equal(l.calls, calls, 'a disabled key stops learning');
  const early = createLearner(); const e = scoreBehaviour(early, call('zz.zz', { record: 'Q' }), policy);
  assert.deepEqual([e.phase, e.score, e.raw], ['learning', 0, 85], 'nothing is scored while learning, though the departure is shown');
  for (let i = 0; i < 1000; i++) observe(l, call(`t${i % 3}.x`, { record: `R-${i}`, [`k${i % 5}`]: 1 }), policy);
  assert.ok(l.targets.size <= CAPS.targets && l.shapes.size <= CAPS.shapes && l.tools.size <= CAPS.tools);
});

test('policy: defaults validate, unknown fields and bad numbers are refused', () => {
  assert.deepEqual(validatePolicy(undefined), DEFAULT_POLICY);
  assert.deepEqual(validatePolicy({}), DEFAULT_POLICY);
  assert.equal(validatePolicy({ behaviour: { askAbove: 90 } }).behaviour.askAbove, 90);
  for (const bad of [[], 'x', { nope: 1 }, { intent: { nope: 1 } }, { intent: { alertAbove: 2 } }, { intent: { alertAbove: 0.9, askAbove: 0.2 } }, { behaviour: { MinObservations: 0 } }, { behaviour: { EnforceObservations: 0 } }, { behaviour: { MinObservations: 1.5 } }, { behaviour: { MinObservations: 20, EnforceObservations: 10 } }, { behaviour: { Disabled: 'no' } }, { intent: { Floor: 2 } }, { purpose: { refuseNone: 'yes' } }, { behaviour: { alertAbove: 80, askAbove: 10 } }, { intent: null }, { behaviour: { alertAbove: NaN } }]) {
    assert.throws(() => validatePolicy(bad), InputError, JSON.stringify(bad));
  }
});

test('policy: a scored signal can never be given the power to deny', () => {
  for (const [sec, key] of [['intent', 'semanticRefuse'], ['intent', 'refuseAbove'], ['behaviour', 'denyAbove'], ['behaviour', 'refuse'], ['behaviour', 'hardRefuse'], ['intent', 'similarityRefuse']]) {
    assert.throws(() => validatePolicy({ [sec]: { [key]: 0.1 } }), (e) => e.code === 'scored_signal_cannot_deny', `${sec}.${key}`);
  }
});

test('decide: only the deterministic tier denies; scored signals alert or ask; a new agent is learning, not scored', () => {
  const sig = (over = {}) => ({
    intent: { deterministic: { matched: [] }, semantic: { riskScore: 0, riskClass: null } },
    purpose: { status: 'in-scope', violations: [] },
    behaviour: { score: 0, raw: 0, phase: 'enforcing', callsSeen: 30, minObservations: 5, enforceObservations: 10 },
    ...over,
  });
  assert.equal(decide(sig(), policy).decision, 'allow');
  assert.equal(decide(sig({ intent: { deterministic: { matched: [] }, semantic: { riskScore: 1, riskClass: 'change-payee' } } }), policy).decision, 'ask');
  assert.equal(decide(sig({ intent: { deterministic: { matched: [] }, semantic: { riskScore: 0.6, riskClass: 'change-payee' } } }), policy).decision, 'alert');
  assert.equal(decide(sig({ behaviour: { score: 100, raw: 100, phase: 'enforcing', callsSeen: 30, minObservations: 5, enforceObservations: 10 } }), policy).decision, 'ask');
  assert.equal(decide(sig({ behaviour: { score: 45, raw: 45, phase: 'enforcing', callsSeen: 30, minObservations: 5, enforceObservations: 10 } }), policy).decision, 'alert');
  const learning = decide(sig({ behaviour: { score: 0, raw: 100, phase: 'learning', callsSeen: 3, minObservations: 5, enforceObservations: 10 } }), policy);
  assert.equal(learning.decision, 'allow');
  assert.equal(learning.reasonCode, 'ALLOW-LEARNING');
  // the extreme case: every scored signal at maximum, thresholds at zero, still never a deny
  const loud = validatePolicy({ intent: { alertAbove: 0, askAbove: 0 }, behaviour: { alertAbove: 0, askAbove: 0, MinObservations: 1, EnforceObservations: 1 } });
  const r = decide(sig({ intent: { deterministic: { matched: [] }, semantic: { riskScore: 1, riskClass: 'exfiltrate-data' } }, behaviour: { score: 100, raw: 100, phase: 'enforcing', callsSeen: 30, minObservations: 1, enforceObservations: 1 } }), loud);
  assert.equal(r.decision, 'ask');
  assert.notEqual(r.decision, 'deny');
  const scoring = decide(sig({ behaviour: { score: 90, raw: 90, phase: 'scoring', callsSeen: 7, minObservations: 5, enforceObservations: 10 } }), policy);
  assert.deepEqual([scoring.decision, scoring.reasonCode], ['allow', 'ALLOW-LEARNING'], 'scoring is not enforcing');
  const hard = decide(sig({ purpose: { status: 'none', violations: [] } }), policy);
  assert.deepEqual([hard.decision, hard.decidedBy, hard.reasonCode, hard.blocked], ['deny', 'deterministic', 'DENY-PURPOSE-NONE', true]);
});

test('decide: each hard-refusal switch turns a refusal into an alert, and the switches are independent', () => {
  const none = { intent: { deterministic: { matched: [] }, semantic: { riskScore: 0, riskClass: null } }, purpose: { status: 'none', violations: [] }, behaviour: { score: 0, established: true, callsSeen: 30, baselineCalls: 10 } };
  assert.equal(decide(none, validatePolicy({ purpose: { refuseNone: false } })).decision, 'alert');
  const pat = { ...none, purpose: { status: 'in-scope', violations: [] }, intent: { deterministic: { matched: [{ id: 'exfiltrate-data', class: 'exfiltrate-data', label: 'x' }] }, semantic: { riskScore: 0, riskClass: null } } };
  assert.equal(decide(pat, policy).decision, 'deny');
  assert.equal(decide(pat, validatePolicy({ intent: { patternRefuse: false } })).decision, 'alert');
  assert.equal(decide(pat, validatePolicy({ purpose: { refuseNone: false, refuseOutside: false, refuseAxis: false } })).decision, 'deny', 'purpose switches do not touch intent patterns');
});

test('engine: the live engine refuses a bulk export even from a long-established agent, and allows an ordinary call', () => {
  const ctx = { declaration: decl, learner: learnerFrom(seedCalls(C, 200)), policy };
  assert.equal(evaluateLive(call('invoices.lookup', { record: 'INV-1003' }, 'look up one invoice'), ctx).decision, 'allow');
  const r = evaluateLive(call('invoices.export', { limit: 5000, format: 'csv' }, 'export all invoices'), ctx);
  assert.equal(r.decision, 'deny');
  assert.match(r.reasonCode, /^DENY-INTENT-PATTERN/);
});

test('policy: 0 for MinObservations or EnforceObservations (the schema\'s built-in default) is refused with a clear reason, not silently accepted', () => {
  for (const f of ['MinObservations', 'EnforceObservations']) assert.throws(() => validatePolicy({ behaviour: { [f]: 0 } }), (e) => e.code === 'bad_policy' && /built-in default.*not supported/.test(e.message), f);
});
