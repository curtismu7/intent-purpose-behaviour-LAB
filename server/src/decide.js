// The decision. Two tiers:
//  1. Deterministic: an intent pattern match, or a purpose finding. Only this tier can produce "deny".
//  2. Scored: intent similarity and behaviour anomaly. These produce "alert" (the call goes through, a person is told) or "ask"
//     (the call is held for a person to approve). They never block silently, and a new agent's behaviour is not scored at all.
// Reason codes are the lab's own labels, not product codes (INVENTED).
const RANK = { deny: 3, ask: 2, alert: 1, allow: 0 };

export function decide(signals, policy) {
  const reasons = [];
  const add = (code, tier, effect, detail) => reasons.push({ code, tier, effect, detail });
  const { intent, purpose, behaviour } = signals;

  for (const m of intent.deterministic.matched) {
    add(`${policy.intent.patternRefuse ? 'DENY' : 'ALERT'}-INTENT-PATTERN:${m.id}`, 'deterministic', policy.intent.patternRefuse ? 'deny' : 'alert', `${m.label} (${m.class})`);
  }
  if (purpose.status === 'none') add(`${policy.purpose.refuseNone ? 'DENY' : 'ALERT'}-PURPOSE-NONE`, 'deterministic', policy.purpose.refuseNone ? 'deny' : 'alert', 'this key declares no purpose');
  else if (purpose.status === 'outside') add(`${policy.purpose.refuseOutside ? 'DENY' : 'ALERT'}-PURPOSE-OUT-OF-SCOPE`, 'deterministic', policy.purpose.refuseOutside ? 'deny' : 'alert', purpose.violations[0]?.detail || 'outside the declared purpose');
  else if (purpose.status === 'axis') {
    for (const v of purpose.violations) add(`${policy.purpose.refuseAxis ? 'DENY' : 'ALERT'}-PURPOSE-AXIS:${v.axis}`, 'deterministic', policy.purpose.refuseAxis ? 'deny' : 'alert', v.detail);
  }

  const sim = intent.semantic;
  if (sim.riskScore >= policy.intent.askAbove && sim.riskScore > 0) add('ASK-INTENT-SIMILARITY', 'scored', 'ask', `similarity ${sim.riskScore.toFixed(2)} to "${sim.riskClass}"`);
  else if (sim.riskScore >= policy.intent.alertAbove && sim.riskScore > 0) add('ALERT-INTENT-SIMILARITY', 'scored', 'alert', `similarity ${sim.riskScore.toFixed(2)} to "${sim.riskClass}"`);

  if (behaviour.phase === 'disabled') add('BEHAVIOUR-DISABLED', 'scored', 'allow', 'behaviour is disabled for this key: context.behaviour reads 0, which a policy sees as not anomalous');
  else if (behaviour.phase === 'learning') add('BEHAVIOUR-LEARNING', 'scored', 'allow', `learning: ${behaviour.callsSeen} of ${behaviour.minObservations} calls, nothing is scored yet (it would have been ${behaviour.raw})`);
  else if (behaviour.phase === 'scoring') add('BEHAVIOUR-SCORING', 'scored', 'allow', `scoring, not yet enforcing: ${behaviour.callsSeen} of ${behaviour.enforceObservations} calls, score ${behaviour.score} is recorded and not acted on`);
  else if (behaviour.score >= policy.behaviour.askAbove) add('ASK-BEHAVIOUR-ANOMALY', 'scored', 'ask', `anomaly ${behaviour.score}`);
  else if (behaviour.score >= policy.behaviour.alertAbove) add('ALERT-BEHAVIOUR-ANOMALY', 'scored', 'alert', `anomaly ${behaviour.score}`);
  else add('BEHAVIOUR-NORMAL', 'scored', 'allow', `anomaly ${behaviour.score}, inside the baseline`);

  const decision = reasons.reduce((d, r) => (RANK[r.effect] > RANK[d] ? r.effect : d), 'allow');
  const deciding = reasons.find((r) => r.effect === decision && decision !== 'allow');
  const reasonCode = deciding ? deciding.code : (behaviour.phase === 'learning' || behaviour.phase === 'scoring' ? 'ALLOW-LEARNING' : 'ALLOW');
  // Invariant: a deny always rests on the deterministic tier. A bug that let a scored reason deny would fail here, loudly.
  if (decision === 'deny' && deciding.tier !== 'deterministic') throw new Error('invariant broken: a scored signal produced a deny');
  return { decision, reasonCode, decidedBy: deciding ? deciding.tier : 'none', reasons, blocked: decision === 'deny', heldForPerson: decision === 'ask' };
}
