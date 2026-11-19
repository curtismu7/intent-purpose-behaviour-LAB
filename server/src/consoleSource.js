// Real-mode source for the Intent Catalogue: the local Privilege console's own API (GET /v1/aiintents).
// Owner-run only: the console origin, tenant and the For Developers key/secret live in this lab's .env beside
// its compose file (PRIVILEGE_CONSOLE_URL, PRIVILEGE_TENANT, PRIVILEGE_API_KEY, PRIVILEGE_API_SECRET).
// Loopback-only: the console origin must be a loopback host or it is refused, whatever the settings say.
// Zero outbound otherwise; the netguard test asserts that a Mock session makes no sockets at all.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|local\.procyon\.ai|local\.ping-devops\.com)$/i;

export function consoleConfigured(env = process.env) {
  const url = env.PRIVILEGE_CONSOLE_URL || '';
  const tenant = env.PRIVILEGE_TENANT || '';
  const key = env.PRIVILEGE_API_KEY || '';
  const secret = env.PRIVILEGE_API_SECRET || '';
  let host = '';
  try { host = url ? new URL(url).hostname : ''; } catch { host = ''; }
  const configured = Boolean(url && tenant && key && secret);
  return { configured, host, loopback: LOOPBACK.test(host), url, tenant, hasKey: Boolean(key), hasSecret: Boolean(secret) };
}

// Fetch the live intents. Never throws a raw error: a structured refusal or the console's own error shape comes back.
export async function loadConsoleIntents(env = process.env, fetchImpl = globalThis.fetch) {
  const cfg = consoleConfigured(env);
  if (!cfg.configured) return { ok: false, error: 'not_configured', message: 'Real mode needs PRIVILEGE_CONSOLE_URL, PRIVILEGE_TENANT, PRIVILEGE_API_KEY and PRIVILEGE_API_SECRET in this lab\'s .env.' };
  if (!cfg.loopback) return { ok: false, error: 'not_loopback', message: `the console origin ${cfg.host} is not loopback; Real mode refuses it` };
  const base = cfg.url.replace(/\/$/, '');
  const path = `/api/${encodeURIComponent(cfg.tenant)}/v1/aiintents?ObjectMeta.Namespace=procyon`;
  try {
    const res = await fetchImpl(base + path, {
      headers: { 'x-api-key': env.PRIVILEGE_API_KEY, 'x-api-secret': env.PRIVILEGE_API_SECRET, 'x-procyon-session-id': crypto.randomUUID(), accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    if (res.status !== 200) return { ok: false, error: 'console_error', status: res.status, message: body.slice(0, 200) };
    const data = JSON.parse(body);
    const intents = (data.AIIntents ?? []).map((i) => ({
      name: i.ObjectMeta?.Name ?? '',
      description: i.Spec?.Description ?? '',
      exemplars: i.Spec?.Exemplars?.Elems ?? [],
      twins: i.Spec?.Twins?.Elems ?? [],
      patterns: i.Spec?.Patterns?.Elems ?? [],
      acts: i.Spec?.Acts === true,
      floor: i.Spec?.Floor ?? 0,
    })).filter((i) => i.name);
    return { ok: true, fetchedAt: new Date().toISOString(), intents };
  } catch (e) {
    const message = /timeout/i.test(String(e?.name ?? '')) ? 'the console did not answer in time' : 'the console could not be reached';
    return { ok: false, error: 'unreachable', message };
  }
}
