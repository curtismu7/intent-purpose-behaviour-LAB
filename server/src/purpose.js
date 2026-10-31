// Purpose: what the agent key says it exists to do, and whether this call is inside that. The declaration is a PurposeProfile; its
// field names {Statement, Methods, Targets, Apps, ArgPrefixes} are from the Privilege console swagger (2026-10-31, schema only).
// How the product matches each field is UNVERIFIED: the lab reads Methods as tool names, Targets as the data class a tool works on,
// ArgPrefixes as "this argument must start with one of these", and does not evaluate Apps. A key may declare nothing, which is itself a finding.
import { dataClassOf } from './call.js';

export function evaluatePurpose(call, profile) {
  if (!profile) return { status: 'none', declared: null, violations: [] };
  const violations = [];
  if (!profile.Methods.includes(call.tool)) violations.push({ axis: 'Methods', detail: `${call.tool} is not one of the declared Methods` });
  if (!profile.Targets.includes(dataClassOf(call))) violations.push({ axis: 'Targets', detail: `target "${dataClassOf(call)}" is not a declared Target` });
  for (const [arg, prefixes] of Object.entries(profile.ArgPrefixes)) {
    const v = call.args[arg];
    if (typeof v === 'string' && !prefixes.some((p) => v.startsWith(p))) violations.push({ axis: `ArgPrefixes.${arg}`, detail: `${arg} "${v}" does not start with a declared prefix (${prefixes.join(', ')})` });
  }
  const status = !violations.length ? 'in-scope' : violations.some((v) => v.axis === 'Methods') ? 'outside' : 'axis';
  return { status, declared: profile.Statement, violations };
}
