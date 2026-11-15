// Privilege AI Guard probe — the shared live-decision hop for this lab.
//
// Same wire as coding-agents-LAB's aiguard.js (the family's measured A2A
// JSON-RPC to the tenant's one configured AI Gateway, Privilege AI Guard in
// the decision path). The gateway's own policy decides; this module only
// maps the measured answer shapes to a decision and never invents one.
//
// Configuration comes from the shared settings file (rule 19/94), read via
// the keys this lab allows: CODING_AGENTS_LAB_AIGATEWAY_* are not this lab's —
// it uses the same CENTRAL_AGENT_A2A_* fallback keys the family shares.

export const URL_KEY = 'CENTRAL_AGENT_A2A_URL';
export const BEARER_KEY = 'CENTRAL_AGENT_A2A_BEARER';
export const MAX_TEXT = 4000;

export function jsonRpcUrl(value) {
  const v = String(value ?? '').replace(/\/$/, '');
  return /\/(jsonrpc|rpc)$/i.test(v) ? v : `${v}/jsonrpc`;
}

export function aiGuardConfig(env = process.env) {
  const url = env[URL_KEY] ? String(env[URL_KEY]) : '';
  const bearer = env[BEARER_KEY] ? String(env[BEARER_KEY]) : '';
  let host = '';
  try { host = url ? new URL(jsonRpcUrl(url)).hostname : ''; } catch { host = ''; }
  return { configured: Boolean(url && bearer), url, bearer, host, hasUrl: Boolean(url), hasBearer: Boolean(bearer) };
}

// ---- Mapping the gateway's answer to a decision ------------------------------------------------------------------
// MEASURED on the live gateway (2026-11-06, coding-agents-LAB):
//   clean    -> completed task result
//   blocked  -> {"error":{"code":-32600,"message":"request blocked by security policy"}}
//   redacted -> completed, echoed text carries "[REDACTED:<kind>]"
export function mapGatewayAnswer({ body, status, sentText }) {
  if (body && body.error) {
    const msg = String(body.error.message ?? '');
    if (/blocked by security policy/i.test(msg)) {
      return { decision: 'deny', reasonCode: 'DENY-AIGUARD-BLOCKED', decidedBy: 'the live AI Guard (real gateway)', measured: true };
    }
    return { decision: 'allow', reasonCode: 'ALLOW-AIGUARD-ERROR', decidedBy: 'the live gateway (non-blocking error)', measured: true };
  }
  const result = body?.result;
  const state = String(result?.status?.state ?? '');
  if (status >= 200 && status < 300 && (state === 'completed' || state === 'working' || state === 'submitted')) {
    const echoed = JSON.stringify(result ?? {});
    const red = /\[REDACTED:[a-z_]+\]/i.exec(echoed);
    if (red) return { decision: 'deny', reasonCode: 'DENY-AIGUARD-REDACTED', decidedBy: 'the live AI Guard (real gateway, data-loss policy)', measured: true };
    return { decision: 'allow', reasonCode: 'ALLOW-AIGUARD-CLEAN', decidedBy: 'the live AI Guard (real gateway)', measured: true };
  }
  return null;
}

// The few response headers worth showing (an allowlist: a gateway can set cookies or echo credentials in others).
const SHOWN_HEADERS = ['content-type', 'x-request-id', 'request-id', 'x-correlation-id'];
const pickHeaders = (h) => Object.fromEntries(SHOWN_HEADERS.map((k) => [k, h?.get?.(k)]).filter(([, v]) => v));

// ---- The outbound call --------------------------------------------------------------------------------------------
// fetchFn is injectable for tests. The URL is built ONLY from the configured endpoint, never from input.
export async function sendToAiGuard({ text, cfg, fetchFn = fetch, timeoutMs = 30000, source = 'lab' }) {
  const trimmed = String(text ?? '').slice(0, MAX_TEXT);
  const id = `ipb-${Date.now()}`;
  const body = {
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      metadata: { source },
      message: { messageId: `${id}-m`, role: 'user', parts: [{ kind: 'text', text: trimmed }] },
    },
  };
  const sent = { url: jsonRpcUrl(cfg.url), body }; // what the "What Privilege did" trace shows as the request (the bearer is never part of it)
  let response;
  try {
    response = await fetchFn(sent.url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', ...(cfg.bearer ? { authorization: `Bearer ${cfg.bearer}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e && typeof e === 'object') e.sent = sent;
    throw e;
  }
  const raw = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* non-JSON */ }
  return {
    status: response.status,
    headers: pickHeaders(response.headers),
    sent,
    body: parsed,
    raw: raw.slice(0, 2000),
    mapped: parsed ? mapGatewayAnswer({ body: parsed, status: response.status, sentText: trimmed }) : null,
  };
}

export const MEASURED_TAG = 'measured on the live gateway, 2026-11-06';
