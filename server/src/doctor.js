// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import fs from 'node:fs';
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { DEFAULT_CAST, VERTICALS, unfilled } from './cast.js';
import { buildStory, rawStory } from './story.js';
import { SCENARIOS } from './data.js';
import { evaluateScenario } from './evaluation.js';
import { clonePolicy, validatePolicy } from './policy.js';
import { modeFrom } from './config.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { MOCK_TABLE } from './mockTable.js';
import { runIdJag, runObo } from './oauth.js';
import { InputError } from './call.js';

export const settingsFile = (env = process.env) => env.STANDALONE_ENV || `${env.HOME || ''}/Development/.env`;

export async function runChecks({ env = process.env, cast = DEFAULT_CAST } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try { add('mode', 'pass', `IPB_LAB_MODE resolves to ${modeFrom(env)}, the opening mode (mock is the default; a bare MODE is ignored); the header toggle switches between mock and live, both loopback-only`); }
  catch (e) { add('mode', 'fail', e.message); }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.IPBLAB_BIND ? ' (IPBLAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  // The one shared settings file: optional, never printed. It should be mode 600.
  try { const m = fs.statSync(settingsFile(env)).mode & 0o777; add('settings-file', m & 0o077 ? 'info' : 'pass', m & 0o077 ? 'the shared settings file is readable by others: chmod 600 it' : 'the shared settings file exists and is mode 600 (values are never printed)'); }
  catch { add('settings-file', 'info', 'no shared settings file: mock mode needs none'); }

  // Each scripted call gives the decision the story says it does, in Mock (tables) and in Live (the real engine), in every vertical.
  const policy = clonePolicy();
  const wrong = [];
  for (const [vertical, c] of Object.entries(VERTICALS)) {
    for (const s of SCENARIOS) {
      for (const mode of ['mock', 'live']) {
        if (evaluateScenario({ cast: c, vertical, id: s.id, mode, policy, table: MOCK_TABLE }).decision !== s.expected) wrong.push(`${vertical}/${s.id}/${mode}`);
      }
    }
  }
  add('scenarios', !wrong.length ? 'pass' : 'fail', wrong.length ? `calls that do not give their expected decision: ${wrong.slice(0, 6).join(', ')}` : `${SCENARIOS.length} scripted calls give their expected decision in mock and live, in ${Object.keys(VERTICALS).length} verticals`);

  let scored = 'pass'; let scoredDetail = 'a policy that lets a score deny is refused';
  try { validatePolicy({ behaviour: { denyAbove: 90 } }); scored = 'fail'; scoredDetail = 'a policy let a scored signal deny'; } catch (e) { if (!(e instanceof InputError) || e.code !== 'scored_signal_cannot_deny') { scored = 'fail'; scoredDetail = e.message; } }
  add('scored-cannot-deny', scored, scoredDetail);

  // The live token flows: real RS256 signing and verification of a valid exchange, and a refusal of a wrong audience.
  try {
    const ok = runObo({ cast, scenario: 'ok', mode: 'live' }); const bad = runObo({ cast, scenario: 'wrong-audience', mode: 'live' });
    const jag = runIdJag({ cast, scenario: 'ok', mode: 'live' });
    const good = ok.accepted && !bad.accepted && bad.backend.checks.find((c) => c.id === 'audience')?.ok === false && jag.accepted;
    add('live-signing', good ? 'pass' : 'fail', good ? 'a real RS256 on-behalf-of exchange and ID-JAG redemption verify; a wrong audience is refused' : 'the live token flows did not behave');
  } catch (e) { add('live-signing', 'fail', `live token flow threw: ${String(e.message).slice(0, 80)}`); }

  const raw = rawStory();
  const text = JSON.stringify(raw);
  const holes = unfilled(text, DEFAULT_CAST);
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${[...new Set(holes)].join(', ')}` : 'every {{cast}} token is filled');
  const badVert = Object.entries(VERTICALS).filter(([, v]) => unfilled(text, v).length).map(([k]) => k);
  add('verticals', badVert.length ? 'fail' : 'pass', badVert.length ? `verticals missing a token: ${badVert.join(', ')}` : `${Object.keys(VERTICALS).length} vertical packs fill every token`);

  const filled = JSON.stringify(Object.keys(VERTICALS).map((v) => buildStory(VERTICALS[v], v)));
  const hosts = scanHosts(filled);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the story data is .invalid or .example');
  const keys = scanKeys(filled);
  add('story-keys', keys.length ? 'fail' : 'pass', keys.length ? 'key-looking values that are not sk-MOCK-' : 'no key-looking values in the story');
  add('diagrams', DIAGRAM_NAMES.every((n) => buildDiagram(cast, n).steps.length > 0) ? 'pass' : 'fail', `${DIAGRAM_NAMES.length} diagram-studio/1 diagrams load and validate`);

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  add('tenant', 'pass', 'simulated only: no tenant, no credentials, no outbound network; every product claim is UNVERIFIED on our tenant');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
