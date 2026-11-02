// The editable policy. Fields marked "swagger" use names from the Privilege console swagger (2026-10-31, schema only: intent.Floor is
// AIIntent.Floor, behaviour.Disabled / MinObservations / EnforceObservations are BehaviourConfig). Everything else (the alert and ask
// thresholds, the refusal switches) is a lab invention: the console schema has no such object. The one rule it enforces about itself: only the deterministic tier
// may refuse. The similarity score and the behaviour score can alert or ask a person, never deny, and a policy that tries to say
// otherwise is rejected. "A model's judgement never silently becomes the enforcement decision."
import { InputError } from './call.js';

export const DEFAULT_POLICY = Object.freeze({
  intent: { patternRefuse: true, alertAbove: 0.5, askAbove: 0.75, Floor: 0.25 },
  purpose: { refuseNone: true, refuseOutside: true, refuseAxis: true },
  behaviour: { Disabled: false, MinObservations: 5, EnforceObservations: 10, alertAbove: 40, askAbove: 70 },
});
// Which fields carry a real console-swagger name (the UI tags them).
export const SWAGGER_FIELDS = ['intent.Floor', 'behaviour.Disabled', 'behaviour.MinObservations', 'behaviour.EnforceObservations'];
export const clonePolicy = () => structuredClone(DEFAULT_POLICY);

const SPEC = {
  intent: { patternRefuse: 'bool', alertAbove: [0, 1], askAbove: [0, 1], Floor: [0, 1] },
  purpose: { refuseNone: 'bool', refuseOutside: 'bool', refuseAxis: 'bool' },
  behaviour: { Disabled: 'bool', MinObservations: [1, 200, 'int'], EnforceObservations: [1, 200, 'int'], alertAbove: [0, 100], askAbove: [0, 100] },
};
const FORBIDDEN = new Set(['semanticRefuse', 'similarityRefuse', 'refuse', 'refuseAbove', 'denyAbove', 'hardRefuse', 'anomalyRefuse', 'behaviourRefuse', 'modelRefuse']);

export function validatePolicy(input) {
  if (input === undefined) return clonePolicy();
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(input)) throw new InputError('bad_policy', 'policy must be an object');
  const out = {};
  for (const sec of Object.keys(input)) if (!Object.hasOwn(SPEC, sec)) throw new InputError('bad_policy', 'unknown policy section');
  for (const [sec, fields] of Object.entries(SPEC)) {
    const given = input[sec] === undefined ? DEFAULT_POLICY[sec] : input[sec];
    if (!isObj(given)) throw new InputError('bad_policy', `${sec} must be an object`);
    for (const k of Object.keys(given)) {
      if ((sec === 'intent' || sec === 'behaviour') && FORBIDDEN.has(k)) {
        throw new InputError('scored_signal_cannot_deny', `${sec}.${k}: only the deterministic tier may refuse; a scored signal can alert or ask a person, never deny`);
      }
      if (!Object.hasOwn(fields, k)) throw new InputError('bad_policy', `unknown field in policy.${sec}`);
    }
    out[sec] = {};
    for (const [k, spec] of Object.entries(fields)) {
      const v = given[k] === undefined ? DEFAULT_POLICY[sec][k] : given[k];
      if (spec === 'bool') { if (typeof v !== 'boolean') throw new InputError('bad_policy', `${sec}.${k} must be true or false`); }
      else {
        const [lo, hi, kind] = spec;
        if (kind === 'int' && v === 0) throw new InputError('bad_policy', `${sec}.${k} must be a whole number from ${lo} to ${hi}: the schema's 0 (built-in default) is not supported by the lab`);
        if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (kind === 'int' && !Number.isInteger(v))) throw new InputError('bad_policy', `${sec}.${k} must be ${kind === 'int' ? 'a whole number' : 'a number'} from ${lo} to ${hi}`);
      }
      out[sec][k] = v;
    }
  }
  if (out.intent.alertAbove > out.intent.askAbove) throw new InputError('bad_policy', 'intent.alertAbove must not be above intent.askAbove');
  if (out.behaviour.MinObservations > out.behaviour.EnforceObservations) throw new InputError('bad_policy', 'behaviour.EnforceObservations must not be below MinObservations (the swagger notes this cross-field rule)');
  if (out.behaviour.alertAbove > out.behaviour.askAbove) throw new InputError('bad_policy', 'behaviour.alertAbove must not be above behaviour.askAbove');
  return out;
}
