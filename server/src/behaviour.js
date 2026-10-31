// Behaviour: how far does this call depart from what this agent normally does. The learner keeps counts and sets, bounded.
// The config field names {Disabled, MinObservations, EnforceObservations} are from the Privilege console swagger (2026-10-31, schema
// only): scoring starts after MinObservations, enforcing after EnforceObservations, and a disabled key reads 0 (context.behaviour).
// The scoring points, and what "scoring" without "enforcing" does, are the lab's own (UNVERIFIED). Phases:
//   disabled  -> nothing is learned or scored, score 0
//   learning  -> fewer than MinObservations calls seen: nothing is scored (the lab still shows what the departure WOULD be)
//   scoring   -> Min..Enforce: scored and shown, never enforced
//   enforcing -> Enforce or more: the score can alert or ask a person
// So a new agent is never blocked for being new.
import { recordsOf, shapeOf, targetOf } from './call.js';

export const CAPS = { tools: 50, targets: 200, shapes: 50 };
export const POINTS = { newTool: 35, newTarget: 30, newShape: 20, volume: 25 };

export const createLearner = () => ({ calls: 0, tools: new Map(), targets: new Set(), shapes: new Set(), maxRecords: 1 });

// One definition of the phases (withPhase, below) serves the learner, the scorer and the stored Mock rows.
export const phaseOf = (learner, policy) => withPhase({ callsSeen: learner.calls, raw: 0, components: [] }, policy).phase;
export const isEstablished = (learner, policy) => phaseOf(learner, policy) === 'enforcing';

export function observe(learner, call, policy) {
  if (policy?.behaviour.Disabled) return; // a disabled key stops learning too
  learner.calls += 1;
  if (learner.tools.has(call.tool) || learner.tools.size < CAPS.tools) learner.tools.set(call.tool, (learner.tools.get(call.tool) || 0) + 1);
  const t = targetOf(call);
  if (t && learner.targets.size < CAPS.targets) learner.targets.add(t);
  if (learner.shapes.size < CAPS.shapes) learner.shapes.add(shapeOf(call));
  learner.maxRecords = Math.max(learner.maxRecords, recordsOf(call));
}

// raw = the departure, always computed so the lab can teach with it; score = what a policy would read (0 while learning or disabled).
export function scoreBehaviour(learner, call, policy) {
  const components = [];
  if (!learner.tools.has(call.tool)) components.push({ id: 'new-tool', points: POINTS.newTool, detail: `${call.tool} was never used before` });
  const t = targetOf(call);
  if (t && !learner.targets.has(t)) components.push({ id: 'new-target', points: POINTS.newTarget, detail: `target ${t} was never touched before` });
  if (!learner.shapes.has(shapeOf(call))) components.push({ id: 'new-arg-shape', points: POINTS.newShape, detail: `argument shape (${shapeOf(call) || 'none'}) was never used before` });
  if (recordsOf(call) > Math.max(5, learner.maxRecords * 2)) components.push({ id: 'volume', points: POINTS.volume, detail: `${recordsOf(call)} records, the usual maximum is ${learner.maxRecords}` });
  const raw = Math.min(100, components.reduce((s, c) => s + c.points, 0));
  return withPhase({ raw, callsSeen: learner.calls, components: phaseOf(learner, policy) === 'disabled' ? [] : components }, policy);
}

// The parts that depend on the policy, so a stored table row can be re-read under an edited policy.
export function withPhase(row, policy) {
  const b = policy.behaviour;
  const phase = b.Disabled ? 'disabled' : row.callsSeen < b.MinObservations ? 'learning' : row.callsSeen < b.EnforceObservations ? 'scoring' : 'enforcing';
  const scored = phase === 'scoring' || phase === 'enforcing';
  // A disabled key reports no components, in Mock (re-read from a table row) exactly as in Live.
  return { ...row, components: phase === 'disabled' ? [] : row.components, phase, score: scored ? row.raw : 0, established: phase === 'enforcing', enforced: phase === 'enforcing', minObservations: b.MinObservations, enforceObservations: b.EnforceObservations };
}

export function describeLearner(learner) {
  return { calls: learner.calls, tools: Object.fromEntries(learner.tools), targets: learner.targets.size, shapes: [...learner.shapes], maxRecords: learner.maxRecords };
}
