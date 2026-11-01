// One Express app. /api = health, info, story, evaluate, baseline, obo, idjag, diagram, runs and reset. Server state per workspace
// id (X-Workspace) is the recent runs and the Live baseline learner, so one visitor's Reset never touches another's. Both modes are
// loopback-only with zero outbound calls. Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
// What a visitor types is masked on the way in (call.js, mask.js) and the evaluate and baseline answers are masked again on the way out (maskDeep).
// Errors never repeat what was typed. Unknown paths answer JSON 404, a wrong method on a known route 405 with Allow, and the SPA shell is served
// only for extension-less paths that are not dotfiles, so a broken asset link is a 404 and never a 200 page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom } from './cast.js';
import { defaultMode, modeOf } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { InputError } from './call.js';
import { validatePolicy } from './policy.js';
import { baselineRows, evaluateCustom, evaluateScenario, fireBaseline } from './evaluation.js';
import { describeLearner } from './behaviour.js';
import { BASELINE_KINDS } from './data.js';
import { IDJAG_SCENARIOS, OBO_SCENARIOS, runIdJag, runObo } from './oauth.js';
import { MOCK_TABLE } from './mockTable.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';
import { formatTraceparent, newTrace } from './trace.js';
import { maskDeep } from './mask.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({ health = createHealth(), configFile = CONFIG, workspaces = createWorkspaces(), table = MOCK_TABLE, webDist = WEB_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const verticalOf = (req) => verticalFrom(req.body?.vertical ?? req.query.vertical);
  const castFor = (req) => loadCast(configFile, verticalOf(req));
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/story', (req, res) => { noStore(res); res.json(buildStory(castFor(req), verticalOf(req))); });
  api.get('/diagram', (req, res) => { noStore(res); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : 'three-signals')); });
  api.get('/info', (_req, res) => { noStore(res); res.json({ mode: defaultMode(), modes: ['mock', 'live'], simulated: true, release: '2026-11-02', unverified: true }); });

  const withWorkspace = (handler) => (req, res, next) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    noStore(res);
    const body = req.body;
    if (req.method === 'POST' && (body === null || typeof body !== 'object' || Array.isArray(body))) return res.status(400).json({ error: 'bad_request' });
    try {
      const mode = req.method === 'POST' ? modeOf(body.mode) : modeOf(req.query.mode);
      if (!mode) return res.status(400).json({ error: 'bad_mode', detail: 'mode must be mock or live' });
      return handler({ ws, mode, req, res });
    } catch (e) {
      if (e instanceof InputError) return res.status(400).json({ error: e.code, detail: e.message });
      return next(e);
    }
  };
  // Every answer that can carry visitor text goes through the response mask (strings and object keys), even if a code path forgot to clean its input.
  const sendMasked = (res, body) => res.json(maskDeep(body));
  const traceHeader = (res, hops) => { if (hops?.[0]) res.set('traceparent', hops[0].traceparent); };

  // Evaluate a scenario by id (both modes), or a call of the visitor's own (Live only). The policy comes with every request and is validated.
  api.post('/evaluate', withWorkspace(({ ws, mode, req, res }) => {
    const { scenario, call } = req.body;
    const policy = validatePolicy(req.body.policy);
    const cast = castFor(req); const vertical = verticalOf(req);
    let out;
    if (scenario !== undefined) {
      out = typeof scenario === 'string' ? evaluateScenario({ cast, vertical, id: scenario, mode, policy, table }) : null;
      if (!out) return res.status(400).json({ error: 'unknown_scenario' });
    } else if (call !== undefined) {
      if (mode !== 'live') return res.status(400).json({ error: 'live_required', detail: 'your own call needs Live mode: Mock mode only has tables for the scripted calls' });
      out = evaluateCustom({ cast, input: call, policy });
    } else return res.status(400).json({ error: 'bad_request' });
    workspaces.record(ws, { tab: 'signals', scenario: out.scenario, decision: out.decision, mode });
    const trace = newTrace(req.headers.traceparent);
    const tp = [trace.span(), trace.span()].map((id) => formatTraceparent(trace.traceId, id));
    const host = `mcp.${cast.castHost}.example`;
    const hops = [
      { n: 1, from: 'agent', to: 'gateway', label: 'Agent calls the P1 Privilege Agent App', traceparent: tp[0], request: `POST https://${host}/mcp\nAuthorization: Bearer <MOCK-ISSUED token>\ntraceparent: ${tp[0]}\n\n${JSON.stringify(out.call)}`, response: `${out.blocked ? '403 Forbidden' : out.heldForPerson ? '202 Accepted (held for a person)' : '200 OK'}\nx-decision: ${out.decision}\nx-reason: ${out.reasonCode}\ntraceparent: ${tp[0]}` },
      { n: 2, from: 'gateway', to: 'signals', label: 'Gateway asks the three signals and the policy', traceparent: tp[1], request: `SIGNALS (${mode}, in process)\ntraceparent: ${tp[1]}`, response: `decision: ${out.decision}\nreason: ${out.reasonCode}\ndecided by: ${out.decidedBy}` },
    ];
    traceHeader(res, hops);
    return sendMasked(res, { ...out, workspace: ws, traceId: trace.traceId, hops });
  }));

  api.get('/baseline', withWorkspace(({ ws, mode, req, res }) => {
    const policy = validatePolicy(undefined);
    const cast = castFor(req); const vertical = verticalOf(req);
    const state = workspaces.baseline(ws);
    return sendMasked(res, { mode, kinds: BASELINE_KINDS, rows: mode === 'mock' ? baselineRows({ cast, vertical, policy, table }) : [], live: { state: describeLearner(state.learner), log: state.log, calls: state.log.length } });
  }));
  api.post('/baseline', withWorkspace(({ ws, mode, req, res }) => {
    const policy = validatePolicy(req.body.policy);
    if (mode === 'mock') return sendMasked(res, { rows: baselineRows({ cast: castFor(req), vertical: verticalOf(req), policy, table }) });
    const kind = req.body.kind;
    if (typeof kind !== 'string' || !BASELINE_KINDS.includes(kind)) return res.status(400).json({ error: 'unknown_kind' });
    const state = workspaces.baseline(ws);
    const entry = fireBaseline({ cast: castFor(req), kind, policy, state });
    workspaces.logBaseline(ws, entry);
    workspaces.record(ws, { tab: 'baseline', scenario: kind, decision: entry.decision, mode });
    return sendMasked(res, { entry, state: describeLearner(state.learner), log: workspaces.baseline(ws).log });
  }));

  const flow = (list, run) => withWorkspace(({ ws, mode, req, res }) => {
    const id = req.body.scenario;
    if (typeof id !== 'string' || !list.some((s) => s.id === id)) return res.status(400).json({ error: 'unknown_scenario' });
    const out = run({ cast: castFor(req), scenario: id, mode, table, traceparent: req.headers.traceparent });
    workspaces.record(ws, { tab: run === runObo ? 'obo' : 'id-jag', scenario: id, decision: out.accepted ? 'accepted' : 'rejected', mode });
    traceHeader(res, out.hops);
    return res.json({ ...out, workspace: ws });
  });
  api.post('/obo', flow(OBO_SCENARIOS, runObo));
  api.post('/idjag', flow(IDJAG_SCENARIOS, runIdJag));

  api.get('/runs', (req, res) => { const ws = workspaceFrom(req); if (!ws) return res.status(400).json({ error: 'bad_workspace' }); noStore(res); return res.json(workspaces.runs(ws)); });
  // Reset clears this workspace's runs and its Live baseline only.
  api.post('/reset', (req, res) => { const ws = workspaceFrom(req); if (!ws) return res.status(400).json({ error: 'bad_workspace' }); noStore(res); workspaces.reset(ws); return res.json({ reset: 'ok', workspace: ws }); });
  // A known route with another method: 405 and Allow (never the generic 404, never the path echoed).
  const onlyMethods = (route, allow) => api.all(route, (_req, res) => res.set('Allow', allow).status(405).json({ error: 'method_not_allowed' }));
  for (const route of ['/story', '/diagram', '/info', '/runs']) onlyMethods(route, 'GET, HEAD');
  onlyMethods('/baseline', 'GET, HEAD, POST');
  for (const route of ['/evaluate', '/obo', '/idjag', '/reset']) onlyMethods(route, 'POST');
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);

  const READ = new Set(['GET', 'HEAD']);
  app.all('/', (req, res, next) => (READ.has(req.method) ? next() : res.set('Allow', 'GET, HEAD').status(405).json({ error: 'method_not_allowed' })));
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    // redirect:false: a directory name is never answered with a redirect that repeats the path.
    app.use(express.static(webDist, { redirect: false }));
    // The app shell answers only paths with no dot in them at all (no extension, no dotfile). /favicon.ico, /robots.txt, /x.map, /.env fall through to the JSON 404.
    app.get('*', (req, res, next) => {
      let decoded;
      try { decoded = decodeURIComponent(req.path); } catch { return next(); }
      if (decoded.includes('.') || /[\\\u0000]/.test(decoded)) return next();
      return res.sendFile(path.join(webDist, 'index.html'));
    });
  }
  // The last word: a JSON 404 (Express's own page would echo the path) and one error handler (its default would send an HTML stack trace with file paths).
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
