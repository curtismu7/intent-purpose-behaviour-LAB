// The live engine: real classification, real purpose check, real behaviour learning, then the same decide() the mock tables use.
import { classify } from './intent.js';
import { evaluatePurpose } from './purpose.js';
import { createLearner, observe, scoreBehaviour } from './behaviour.js';
import { decide } from './decide.js';

export function liveSignals(call, { declaration, learner, policy }) {
  return { intent: classify(call, policy.intent.Floor), purpose: evaluatePurpose(call, declaration), behaviour: scoreBehaviour(learner, call, policy) };
}

export function evaluateLive(call, ctx) {
  const signals = liveSignals(call, ctx);
  return { signals, ...decide(signals, ctx.policy) };
}

// A learner that has already seen these calls (the agent's history). Seeding is not a decision, so nothing is refused here.
export function learnerFrom(calls) {
  const learner = createLearner();
  for (const c of calls) observe(learner, c, null);
  return learner;
}

// The baseline is not poisoned by what the engine refused or held: only allowed calls (and alerts, which went through) are learned.
export const shouldLearn = (decision) => decision === 'allow' || decision === 'alert';
