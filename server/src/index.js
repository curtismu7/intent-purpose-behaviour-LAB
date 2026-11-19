import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { modeFrom } from './config.js';
import { aiGuardConfig } from './aiguardProbe.js';
import { consoleConfigured } from './consoleSource.js';

// The one shared settings file (rulebook): ~/Development/.env, or the path in STANDALONE_ENV. Optional; values are never printed.
try { process.loadEnvFile(process.env.STANDALONE_ENV || path.join(os.homedir(), 'Development', '.env')); } catch { /* no settings file */ }
// This lab's own .env beside its compose file (owner rule 2026-11-09): the console credentials for the
// Intent Catalogue's Real mode live here. Optional; values are never printed.
try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env')); } catch { /* no lab .env */ }

// Real mode's allowed outbound: the AI Gateway hostname, plus — only when the owner configured the local
// Privilege console for the Intent Catalogue — the console origin and the host-loopback dial it needs from
// inside the container (host.orb.internal). Everything else is refused, exactly as before.
const consoleAllow = consoleConfigured().configured ? ['local.procyon.ai', 'host.orb.internal'] : [];
installNetguard([...(aiGuardConfig().host ? [aiGuardConfig().host] : []), ...consoleAllow]);

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[intent-purpose-behaviour-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = modeFrom(process.env); // refuses anything but mock or live
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
console.log(`[intent-purpose-behaviour-lab] simulated lab at ${url} (opens in ${mode} mode; loopback, no outbound network)`);
console.log(`[intent-purpose-behaviour-lab] health: ${url}api/health`);
