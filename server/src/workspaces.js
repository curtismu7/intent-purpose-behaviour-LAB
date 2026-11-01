// Rule 13: a workspace id keeps one visitor's state apart from another's. Server state per workspace is small: the recent runs
// and the Live baseline learner. The browser sends its id in X-Workspace (default "default"); state is bounded in count, size and age.
import { createLearner } from './behaviour.js';
import { looksLikeCredential } from './mask.js';

export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
// An id is echoed in answers and kept as a map key, so one that looks like a credential is refused (400 bad_workspace) and never echoed:
// 24 or more hex digits (a hash, a UUID, a key), a prefix such as sk-, pw- or token-, or anything the masker recognises. The page's own ids are w-<16 hex>.
const CREDENTIAL_PREFIX = /^(?:sk|pk|rk|pw|pwd|pass|passwd|password|secret|token|key|apikey|bearer|ghp|gho|ghu|ghs|ghr|glpat|xox[abprs]|akia|asia|eyj)(?:-|$)/;
export const credentialLookingId = (id) => /^[a-f0-9]{24,}$/.test(id.replace(/-/g, '')) || CREDENTIAL_PREFIX.test(id) || looksLikeCredential(id);
export const DEFAULT_WORKSPACE = 'default';
export const MAX_RUNS = 20;
export const MAX_LOG = 60;

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) && !credentialLookingId(raw) ? raw : null;
}

export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const map = new Map(); // id -> { runs, baseline: { learner, log, counter }, at }; insertion order = oldest first
  const fresh = () => ({ runs: [], baseline: { learner: createLearner(), log: [], counter: 0 }, at: now() });
  const sweep = () => {
    const t = now();
    for (const [id, v] of map) { if (t - v.at > ttlMs) map.delete(id); else break; }
    while (map.size > max) map.delete(map.keys().next().value);
  };
  const touch = (id) => { const v = map.get(id) || fresh(); v.at = now(); map.delete(id); map.set(id, v); sweep(); return v; };
  return {
    runs(id) { sweep(); const v = map.get(id); return { workspace: id, runs: v ? v.runs : [] }; },
    record(id, run) { const v = touch(id); v.runs = [...v.runs, { ...run, at: now() }].slice(-MAX_RUNS); return this.runs(id); },
    baseline(id) { return touch(id).baseline; },
    logBaseline(id, entry) { const b = touch(id).baseline; b.log = [...b.log, entry].slice(-MAX_LOG); },
    reset(id) { map.delete(id); },
    size() { return map.size; },
  };
}
