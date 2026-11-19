// Real-mode source for the Intent Catalogue: the local Privilege console's own API (GET /v1/aiintents).
// Owner-run only: the console origin, tenant and the For Developers key/secret live in this lab's .env beside
// its compose file (PRIVILEGE_CONSOLE_URL, PRIVILEGE_TENANT, PRIVILEGE_API_KEY, PRIVILEGE_API_SECRET).
// Loopback-only: the console origin must be a loopback host or it is refused, whatever the settings say.
// Zero outbound otherwise; the netguard test asserts that a Mock session makes no sockets at all.
//
// TLS, honestly stated: the local desktop console presents a self-signed chain (its own FrontEndCA / TenantRoot),
// which the owner's Mac trusts but a container has no trust store for. The owner supplies the console's CA
// bundle at PRIVILEGE_CONSOLE_CA (a PEM path beside the compose file); without it Real mode refuses with a
// named reason rather than silently disabling certificate verification — a pin would be TOFU, and turning
// verification off everywhere would weaken every other hop. The connection is also pinned by hostname: the
// certificate must be valid FOR the console origin (local.procyon.ai), whatever host we dial through.
// Inside the container the dial goes through OrbStack's host loopback (host.orb.internal) with the console's
// own hostname as TLS SNI and Host header (the console resets a connection whose SNI does not match).
import https from 'node:https';
import fs from 'node:fs';

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|local\.procyon\.ai|local\.ping-devops\.com)$/i;
const DIAL_DEFAULT = 'host.orb.internal';

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

function consoleRequest({ host, port, servername, path, ca, headers, timeoutMs = 10_000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, port, servername, path, method: 'GET', timeout: timeoutMs,
      ...(ca ? { ca } : {}),
      headers: { ...headers, host: `${servername}${port ? `:${port}` : ''}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function parseIntents(body) {
  const data = JSON.parse(body);
  return (data.AIIntents ?? []).map((i) => ({
    name: i.ObjectMeta?.Name ?? '',
    description: i.Spec?.Description ?? '',
    exemplars: i.Spec?.Exemplars?.Elems ?? [],
    twins: i.Spec?.Twins?.Elems ?? [],
    patterns: i.Spec?.Patterns?.Elems ?? [],
    acts: i.Spec?.Acts === true,
    floor: i.Spec?.Floor ?? 0,
  })).filter((i) => i.name);
}

// Fetch the live intents. Never throws a raw error: a structured refusal or the console's own error shape comes back.
export async function loadConsoleIntents(env = process.env) {
  const cfg = consoleConfigured(env);
  if (!cfg.configured) return { ok: false, error: 'not_configured', message: 'Real mode needs PRIVILEGE_CONSOLE_URL, PRIVILEGE_TENANT, PRIVILEGE_API_KEY and PRIVILEGE_API_SECRET in this lab\'s .env.' };
  if (!cfg.loopback) return { ok: false, error: 'not_loopback', message: `the console origin ${cfg.host} is not loopback; Real mode refuses it` };
  let ca = null;
  const caPath = env.PRIVILEGE_CONSOLE_CA || '';
  if (caPath) {
    try { ca = fs.readFileSync(caPath, 'utf8'); } catch { return { ok: false, error: 'ca_unreadable', message: `the console CA bundle at ${caPath} could not be read` }; }
  } else {
    return { ok: false, error: 'ca_missing', message: 'Real mode needs PRIVILEGE_CONSOLE_CA: a PEM of the local console\'s FrontEndCA and TenantRoot certificates (exported from its served chain). Real mode never disables certificate verification.' };
  }
  const u = new URL(cfg.url);
  const port = u.port || 443;
  const path = `/api/${encodeURIComponent(cfg.tenant)}/v1/aiintents?ObjectMeta.Namespace=procyon`;
  const headers = { 'x-api-key': env.PRIVILEGE_API_KEY, 'x-api-secret': env.PRIVILEGE_API_SECRET, 'x-procyon-session-id': crypto.randomUUID(), accept: 'application/json' };
  // The dial order: PRIVILEGE_DIAL_HOST when the owner sets it (a CI or container name that reaches the same
  // TLS endpoint), then the console origin itself (works when this runs on the owner's Mac), then OrbStack's
  // host loopback (works inside the lab's container on the same Mac). All dial with the console's hostname as
  // SNI and Host, and all are checked against the console's own CA and hostname.
  const dialHosts = [...new Set([env.PRIVILEGE_DIAL_HOST || '', cfg.host, DIAL_DEFAULT].filter(Boolean))];
  const dials = dialHosts.map((host) => ({ host, port }));
  let lastError = null;
  for (const dial of dials) {
    try {
      const { status, body } = await consoleRequest({ host: dial.host, port: dial.port, servername: cfg.host, path, ca, headers });
      if (status !== 200) return { ok: false, error: 'console_error', status, message: body.slice(0, 200) };
      return { ok: true, fetchedAt: new Date().toISOString(), via: dial.host, intents: parseIntents(body) };
    } catch (e) {
      lastError = e;
      const code = String(e?.code ?? e?.message ?? '');
      if (/timeout/i.test(code)) return { ok: false, error: 'unreachable', message: 'the console did not answer in time' };
      // CERT_* errors are terminal: the console answered but is not the peer we pinned — never retry past them
      if (/CERT|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
        return { ok: false, error: 'cert_rejected', message: `the console's certificate was rejected against the supplied CA bundle (${code})` };
      }
    }
  }
  return { ok: false, error: 'unreachable', message: `the console could not be reached (${lastError?.code ?? 'unknown'})` };
}
