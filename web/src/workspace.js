// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
// The server refuses an id that looks like a credential (24+ hex digits, a prefix such as sk- or pw-, a long opaque run) with 400 bad_workspace.
// A stored id like that must not brick the tab: it is not reused, and a 400 bad_workspace makes the page throw the id away, make a new one and retry once.
export const KEY = "ipb.workspace";
const FORMAT = /^[a-z0-9-]{1,40}$/;
const CREDENTIAL_PREFIX = /^(?:sk|pk|rk|pw|pwd|pass|passwd|password|secret|token|key|apikey|bearer|ghp|gho|ghu|ghs|ghr|glpat|xox[abprs]|akia|asia|eyj)(?:-|$)/;
let memo = null;

// The same first checks the server makes (the server also runs the masker, so the 400 retry below stays the safety net).
export const credentialLookingId = (id) => /^[a-f0-9]{24,}$/.test(id.replace(/-/g, "")) || CREDENTIAL_PREFIX.test(id);
export const usableId = (id) => typeof id === "string" && FORMAT.test(id) && !credentialLookingId(id);

// w- plus 16 hex digits: the prefix guarantees a letter, so a generated id is never all digits and never 24 hex characters.
export function makeId() {
  const bytes = new Uint8Array(8);
  (window.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return `w-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (usableId(saved)) return (memo = saved); } catch { /* blocked */ }
  memo = makeId();
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

// Forget the current id (stored and remembered) so the next call makes a fresh one.
export function renewWorkspaceId() {
  memo = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* blocked */ }
  return workspaceId();
}

export async function workspaceFetch(url, opts = {}) {
  const send = () => fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
  const first = await send();
  if (first.status !== 400) return first;
  let code = null;
  try { code = (await first.clone().json()).error; } catch { /* not JSON */ }
  if (code !== "bad_workspace") return first;
  renewWorkspaceId();
  return send(); // once: a second refusal is returned as it is
}
