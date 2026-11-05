// One Express app. /api = health, info, story, evaluate, baseline, obo, idjag, diagram, runs and reset. Server state per workspace
// id (X-Workspace) is the recent runs and the Live baseline learner, so one visitor's Reset never touches another's. Both modes are
// loopback-only with zero outbound calls. Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
// The edge follows shared-masker's docs/EXPRESS-RECIPE.md: the response mask (every res.json is passed through maskDeep, values and object keys), a charset
// gate (415, fixed body), a malformed percent-escape (400), 405 with Allow from one route table, the workspace-id rule (400 bad_workspace before any slot exists),
// the single-page shell for page addresses only (isPageAddress), a final JSON 404 and a catch-all error handler. None of them echoes what was typed and
// nothing is logged per request. What a visitor types is also masked on the way in (call.js, mask.js).
// The token flows (obo, idjag) take no typed text and show MOCK-ISSUED tokens raw by design, so their token-bearing parts are exempt (maskFlow in mask.js).
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
import { maskDeep, maskFlow } from './mask.js';
import { buildMethodTable, charsetProblem, isPageAddress, methodNotAllowed } from './shared/hygiene.js';
import { shelfInfo } from './shelfLink.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

// The route table: one place for the 405 + Allow answer. HEAD is added wherever GET is.
export const ROUTES = {
  '/api/shelf': ['GET'],
  '/': ['GET'],
  '/api/health': ['GET'],
  '/api/story': ['GET'], '/api/diagram': ['GET'], '/api/info': ['GET'], '/api/runs': ['GET'],
  '/api/baseline': ['GET', 'POST'],
  '/api/evaluate': ['POST'], '/api/obo': ['POST'], '/api/idjag': ['POST'], '/api/reset': ['POST'],
};
const METHODS = buildMethodTable(ROUTES);
// A fixed-code answer: nothing the visitor sent is ever put in the code or the body.
const fail = (res, status, code, headers = {}) => res.set(headers).status(status).json({ error: code });
const decoded = (p) => { try { return decodeURIComponent(p); } catch { return null; } };

export function createApp({ health = createHealth(), configFile = CONFIG, workspaces = createWorkspaces(), table = MOCK_TABLE, webDist = WEB_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // 1. The response mask: everything that leaves through res.json (hops, echo, errors, state, story) is passed through maskDeep, strings and object keys, the
  //    input never mutated. res.locals.preMasked is set only by the two token-flow routes, which mask with maskFlow themselves.
  app.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => json(res.locals.preMasked ? body : maskDeep(body));
    next();
  });
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  // 2. Charset gate: any charset other than utf-8 is a 415 with a fixed body (the value is never read into the answer).
  app.use((req, res, next) => (charsetProblem(req.headers['content-type']) ? fail(res, 415, 'unsupported_charset') : next()));
  // 3. A path with a malformed percent-escape (/%, /%zz) is a 400, whatever it is under.
  app.use((req, res, next) => (decoded(req.path) === null ? fail(res, 400, 'bad_request') : next()));
  // 4. 405 with Allow, from the route table. A path that is not in the table falls through to the JSON 404.
  app.use((req, res, next) => {
    const miss = methodNotAllowed(METHODS, req.method, req.path);
    return miss ? fail(res, 405, 'method_not_allowed', { Allow: miss.allow.join(', ') }) : next();
  });

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

  // 5. The workspace id: refused BEFORE any slot exists (slots are created only by workspaces.record / baseline, inside a handler that runs after this).
  //    The refused id is not echoed anywhere.
  const workspace = (req, res, next) => {
    const ws = workspaceFrom(req);
    if (!ws) return fail(res, 400, 'bad_workspace');
    req.ws = ws;
    return next();
  };
  const withWorkspace = (handler) => (req, res, next) => {
    const ws = req.ws;
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
  const traceHeader = (res, hops) => { if (hops?.[0]) res.set('traceparent', hops[0].traceparent); };

  // Evaluate a scenario by id (both modes), or a call of the visitor's own (Live only). The policy comes with every request and is validated.
  api.post('/evaluate', workspace, withWorkspace(({ ws, mode, req, res }) => {
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
    return res.json({ ...out, workspace: ws, traceId: trace.traceId, hops });
  }));

  api.get('/baseline', workspace, withWorkspace(({ ws, mode, req, res }) => {
    const policy = validatePolicy(undefined);
    const cast = castFor(req); const vertical = verticalOf(req);
    const state = workspaces.baseline(ws);
    return res.json({ mode, kinds: BASELINE_KINDS, rows: mode === 'mock' ? baselineRows({ cast, vertical, policy, table }) : [], live: { state: describeLearner(state.learner), log: state.log, calls: state.log.length } });
  }));
  api.post('/baseline', workspace, withWorkspace(({ ws, mode, req, res }) => {
    const policy = validatePolicy(req.body.policy);
    if (mode === 'mock') return res.json({ rows: baselineRows({ cast: castFor(req), vertical: verticalOf(req), policy, table }) });
    const kind = req.body.kind;
    if (typeof kind !== 'string' || !BASELINE_KINDS.includes(kind)) return res.status(400).json({ error: 'unknown_kind' });
    const state = workspaces.baseline(ws);
    const entry = fireBaseline({ cast: castFor(req), kind, policy, state });
    workspaces.logBaseline(ws, entry);
    workspaces.record(ws, { tab: 'baseline', scenario: kind, decision: entry.decision, mode });
    return res.json({ entry, state: describeLearner(state.learner), log: workspaces.baseline(ws).log });
  }));

  const flow = (list, run) => withWorkspace(({ ws, mode, req, res }) => {
    const id = req.body.scenario;
    if (typeof id !== 'string' || !list.some((s) => s.id === id)) return res.status(400).json({ error: 'unknown_scenario' });
    const out = run({ cast: castFor(req), scenario: id, mode, table, traceparent: req.headers.traceparent });
    workspaces.record(ws, { tab: run === runObo ? 'obo' : 'id-jag', scenario: id, decision: out.accepted ? 'accepted' : 'rejected', mode });
    traceHeader(res, out.hops);
    res.locals.preMasked = true;
    return res.json(maskFlow({ ...out, workspace: ws }));
  });
  api.post('/obo', workspace, flow(OBO_SCENARIOS, runObo));
  api.post('/idjag', workspace, flow(IDJAG_SCENARIOS, runIdJag));

  api.get('/runs', workspace, (req, res) => { noStore(res); return res.json(workspaces.runs(req.ws)); });
  // Reset clears this workspace's runs and its Live baseline only.
  api.post('/reset', workspace, (req, res) => { noStore(res); workspaces.reset(req.ws); return res.json({ reset: 'ok', workspace: req.ws }); });
  api.use((_req, res) => fail(res, 404, 'not_found'));
  app.use('/api', api);

  // 7. Static files and the single-page-app shell. express.static answers real files only (no index, dotfiles ignored, no redirect that would repeat a path) and
  //    falls through otherwise. The shell is for PAGE ADDRESSES only: GET or HEAD, a path isPageAddress accepts (so /assets, /assets/x.js, /favicon.ico, /.env,
  //    /% are not), from a client that did not say it wants something other than HTML. This app's own pages have no dot in their path, so a dot anywhere
  //    (/a.b/c) is also a 404, narrower than isPageAddress.
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
    app.use(express.static(webDist, { index: false, dotfiles: 'ignore', fallthrough: true, redirect: false }));
    app.use((req, res, next) => {
      const accept = req.get('accept');
      const wantsHtml = accept === undefined || accept.includes('text/html') || accept.includes('*/*');
      if ((req.method === 'GET' || req.method === 'HEAD') && wantsHtml && isPageAddress(req.path) && !decoded(req.path).includes('.')) return res.sendFile(path.join(webDist, 'index.html'));
      return next();
    });
  }
  // 8. The last word: a JSON 404 (Express's own page would echo the path). 9. One error handler: the status comes from a short list, the code is fixed, the
  //    message and the stack are never sent (Express's default would send an HTML stack trace with file paths).
  app.use((_req, res) => fail(res, 404, 'not_found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = [400, 413, 415].includes(err?.status) ? err.status : 500;
    if (res.headersSent) return res.end();
    return fail(res, status, { 400: 'bad_request', 413: 'too_large', 415: 'unsupported_charset', 500: 'internal' }[status]);
  });
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
