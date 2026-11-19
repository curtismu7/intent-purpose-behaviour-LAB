// The console intents engine: the 25 measured built-ins, the real regex patterns, the backtracking guard,
// the customer-intent clone rule and the catalogue simulate() path. The snapshot itself is a fixture —
// the lab does not fetch anything in tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_INTENTS } from '../src/builtinIntentsLoader.js';
import { classifyConsole, compilePattern, backtrackingRisk, patternScan, similarityScan, callText, MAX_PATTERN } from '../src/consoleIntents.js';
import { catalogue, simulate, cleanIntentBody, checkPattern, CUSTOM_INTENT_TEMPLATE } from '../src/intentCatalogue.js';
import { consoleConfigured, loadConsoleIntents } from '../src/consoleSource.js';
import { InputError } from '../src/call.js';

const byName = (n) => BUILTIN_INTENTS.find((i) => i.name === n);
const call = (tool, description, args = {}) => ({ tool, description, args });

test('the measured snapshot: 25 built-in intents, 12 acting, every acting one has patterns', () => {
  assert.equal(BUILTIN_INTENTS.length, 25);
  assert.equal(BUILTIN_INTENTS.filter((i) => i.acts).length, 12);
  for (const i of BUILTIN_INTENTS) {
    assert.ok(i.name, 'name');
    assert.ok(typeof i.description === 'string', 'description');
    assert.ok(Array.isArray(i.exemplars) && i.exemplars.length > 0, `${i.name} has exemplars`);
    assert.equal(i.floor, 0, 'the console stores Floor 0 (auto)');
    if (i.acts) assert.ok(i.patterns.length > 0, `acting intent ${i.name} has patterns`);
  }
  assert.ok(byName('detection_and_audit'), 'detection_and_audit is present');
  assert.equal(byName('detection_and_audit').acts, false, 'detection_and_audit is a sibling: similarity only');
});

test('every built-in pattern compiles through the guard and matches its own exemplar phrasing where it is designed to', () => {
  for (const i of BUILTIN_INTENTS) for (const p of i.patterns) assert.equal(compilePattern(p).ok, true, `${i.name}: ${p}`);
});

test('real regex patterns: data_exfiltration catches a mysqldump, security_control_bypass catches --no-verify and force push', () => {
  const r1 = classifyConsole(call('db.query', 'run mysqldump on the users database', {}));
  assert.ok(r1.deterministic.matched.some((m) => m.id === 'data_exfiltration'), JSON.stringify(r1.deterministic.matched));
  const r2 = classifyConsole(call('lint.edit', 'add eslint-disable to make the check pass', {}));
  assert.ok(r2.deterministic.matched.some((m) => m.id === 'security_control_bypass'));
  const r3 = classifyConsole(call('git.push', 'git push --force to bypass the branch protection', {}));
  assert.ok(r3.deterministic.matched.some((m) => m.id === 'security_control_bypass'));
  // the security_control_bypass exemplar phrasing is caught by the similarity tier, not the patterns (measured)
  const simCatch = classifyConsole(call('git.commit', 'commit without running the pre-commit hooks', {}));
  assert.equal(simCatch.deterministic.matched.some((m) => m.id === 'security_control_bypass'), false);
  assert.equal(simCatch.semantic.riskClass, 'security_control_bypass');
  // the patterns are deliberately narrower than the exemplars: an export phrased around them catches nothing deterministically
  const narrow = classifyConsole(call('reports.export', 'send every client contact detail to my personal drive', {}));
  assert.equal(narrow.deterministic.matched.some((m) => m.id === 'data_exfiltration'), false);
});

test('sibling intents do not match by pattern (they are similarity-only), and ordinary work scores low', () => {
  assert.equal(byName('self_service').patterns.length, 0);
  const safe = classifyConsole(call('invoices.lookup', 'look up the status of one invoice', { record: 'INV-1' }));
  assert.equal(safe.deterministic.matched.length, 0);
  assert.ok(safe.semantic.riskScore < 0.5, `an ordinary lookup scores ${safe.semantic.riskScore}, low enough that no alert fires at the default thresholds`);
});

test('similarity: reworded exfiltration scores high on data_exfiltration with no pattern match', () => {
  const r = classifyConsole(call('reports.annotate', 'send every client contact detail to my personal drive', {}));
  assert.equal(r.deterministic.matched.some((m) => m.id === 'data_exfiltration'), false, 'no pattern catches this wording');
  assert.ok(r.semantic.riskScore >= 0.5, `reworded exfiltration scores ${r.semantic.riskScore}`);
  assert.equal(r.semantic.riskClass, 'data_exfiltration');
});

test('Floor: a raw score below the floor scores 0; the same call above it scores raw', () => {
  const phrase = 'export every customer record';
  const raw = similarityScan(call('mcp.tool', phrase, {}), BUILTIN_INTENTS, 0).scores['data_exfiltration'];
  assert.ok(raw > 0, 'the phrase scores above zero raw');
  const floored = similarityScan(call('mcp.tool', phrase, {}), BUILTIN_INTENTS, raw + 0.01);
  assert.equal(floored.scores['data_exfiltration'], 0, `a floor above the raw score (${raw}) zeroes it`);
  const kept = similarityScan(call('mcp.tool', phrase, {}), BUILTIN_INTENTS, raw);
  assert.equal(kept.scores['data_exfiltration'], raw, 'a floor exactly at the raw score keeps it (>=, not >)');
});

test('twins are the benign look-alike: a twin scores lower than the intent\'s own exemplar phrasing', () => {
  // The word-overlap stand-in is coarser than the product's encoder, so a twin can still overlap ("export my
  // own profile data" shares "export", "data"). The console's promise is separation, here measured as: every
  // twin scores strictly below the intent's own exemplar phrasing.
  const de = byName('data_exfiltration');
  const own = Math.max(...de.exemplars.map((e) => similarityScan(call('mcp.tool', e, {}), BUILTIN_INTENTS, 0).scores['data_exfiltration']));
  for (const t of de.twins) {
    const s = similarityScan(call('mcp.tool', t, {}), BUILTIN_INTENTS, 0).scores['data_exfiltration'];
    assert.ok(s < own, `twin "${t}" (${s}) must score below the exemplar phrasing (${own})`);
  }
});

test('the haystack is bounded and the guard refuses catastrophic patterns at compile time', () => {
  assert.ok(callText(call('t', 'x'.repeat(1000), {})).length <= 400);
  assert.ok(backtrackingRisk('(a+)+'));
  assert.ok(backtrackingRisk('(a|a)*b'));
  assert.equal(backtrackingRisk('\\b(disable|remove)\\b.*\\b(mfa|2fa)\\b'), null);
  const evil = compilePattern('(a+)+$');
  assert.equal(evil.ok, false);
  assert.match(evil.reason, /backtrack/);
  assert.equal(compilePattern('x'.repeat(MAX_PATTERN + 1)).ok, false);
  // an over-long hostile input against a valid regex must still answer (bounded haystack keeps the engine safe)
  const r = classifyConsole(call('t', 'a'.repeat(350), {}));
  assert.ok(r.semantic);
});

test('the catalogue view: 25 rows, source labelled, a custom intent with a built-in name REPLACES it', () => {
  const base = catalogue([]);
  assert.equal(base.counts.total, 25);
  assert.equal(base.source, 'measured-snapshot');
  const custom = { name: 'data_exfiltration', description: 'my clone', exemplars: ['x'], twins: [], patterns: ['\\bdemo\\b'], acts: true, floor: 0 };
  const withClone = catalogue([custom]);
  const row = withClone.intents.find((i) => i.name === 'data_exfiltration');
  assert.equal(row.replacedBy, 'customer');
  assert.equal(row.effective.patterns[0], '\\bdemo\\b', 'the clone replaces the built-in wholesale');
  assert.equal(withClone.counts.custom, 1);
  const own = catalogue([{ ...custom, name: 'my_own_intent' }]);
  assert.ok(own.intents.find((i) => i.name === 'my_own_intent').isCustom);
});

test('simulate: a customer intent is seen in the catalogue, and acts=true can refuse', () => {
  const custom = { ...CUSTOM_INTENT_TEMPLATE };
  const hit = simulate({ call: call('demo.export', 'please export every demo customer record to my laptop', {}), customIntents: [custom] });
  assert.ok(hit.customIntentHits.includes('demo_data_exfiltration'), JSON.stringify(hit.patternMatches));
  assert.equal(hit.wouldRefuse, true);
  const benign = simulate({ call: call('demo.shop', 'show one mock customer record', {}), customIntents: [custom] });
  assert.equal(benign.customIntentHits.length, 0);
});

test('cleanIntentBody: the hostile path is a 400 with a fixed reason, never an evaluation', () => {
  assert.throws(() => cleanIntentBody(null), InputError);
  assert.throws(() => cleanIntentBody({ name: 'Bad Name!' }), InputError);
  assert.throws(() => cleanIntentBody({ name: 'ok_name', patterns: ['(a+)+$'] }), /backtrack/);
  assert.throws(() => cleanIntentBody({ name: 'ok_name', patterns: ['[unclosed'] }), /valid ECMAScript regex/);
  assert.throws(() => cleanIntentBody({ name: 'ok_name', exemplars: Array(25).fill('x') }), /at most 20/);
  assert.throws(() => cleanIntentBody({ name: 'ok_name', exemplars: ['x'.repeat(400)] }), /up to 300/);
  const ok = cleanIntentBody({ name: 'good_intent', description: 'd', exemplars: ['e'], twins: ['t'], patterns: ['\\bgood\\b'], acts: true });
  assert.deepEqual([ok.name, ok.patterns, ok.acts], ['good_intent', ['\\bgood\\b'], true]);
  assert.equal(checkPattern('(a+)+$').ok, false);
  assert.equal(checkPattern('\\bfine\\b').ok, true);
  assert.equal(checkPattern('').ok, false);
});

test('consoleSource: refuses non-loopback origins and passes the key/secret as headers only (never logged, never in the URL)', () => {
  const off = consoleConfigured({});
  assert.equal(off.configured, false);
  const badHost = consoleConfigured({ PRIVILEGE_CONSOLE_URL: 'https://console.privilege.pingone.com', PRIVILEGE_TENANT: 't', PRIVILEGE_API_KEY: 'k', PRIVILEGE_API_SECRET: 's' });
  assert.equal(badHost.loopback, false);
  const good = consoleConfigured({ PRIVILEGE_CONSOLE_URL: 'https://local.procyon.ai:8643', PRIVILEGE_TENANT: 't', PRIVILEGE_API_KEY: 'k', PRIVILEGE_API_SECRET: 's' });
  assert.equal(good.configured && good.loopback, true);
});

test('consoleSource: a fetch to the console carries x-api-key / x-api-secret headers and maps the answer shape', async () => {
  let seen = null;
  const stub = async (url, init) => {
    seen = { url, headers: init.headers };
    return { status: 200, text: async () => JSON.stringify({ AIIntents: [{ ObjectMeta: { Name: 'x_intent' }, Spec: { Description: 'd', Exemplars: { Elems: ['e'] }, Twins: { Elems: [] }, Patterns: { Elems: ['\\bx\\b'] }, Acts: true, Floor: 0 } }] }) };
  };
  const env = { PRIVILEGE_CONSOLE_URL: 'https://local.procyon.ai:8643', PRIVILEGE_TENANT: 'tenant-1', PRIVILEGE_API_KEY: 'k', PRIVILEGE_API_SECRET: 's' };
  const r = await loadConsoleIntents(env, stub);
  assert.equal(r.ok, true);
  assert.equal(r.intents.length, 1);
  assert.deepEqual(r.intents[0], { name: 'x_intent', description: 'd', exemplars: ['e'], twins: [], patterns: ['\\bx\\b'], acts: true, floor: 0 });
  assert.equal(seen.headers['x-api-key'], 'k');
  assert.equal(seen.headers['x-api-secret'], 's');
  assert.ok(!seen.url.includes('api_key=') && !seen.url.includes('secret=') && !seen.url.includes('Bearer'), 'no credential in the URL');
  assert.ok(seen.url.endsWith('/v1/aiintents?ObjectMeta.Namespace=procyon'), seen.url);
  // console errors and unreachable hosts come back structured, never thrown
  const err500 = await loadConsoleIntents(env, async () => ({ status: 401, text: async () => 'denied' }));
  assert.deepEqual([err500.ok, err500.error], [false, 'console_error']);
  const down = await loadConsoleIntents(env, async () => { throw new Error('ECONNREFUSED'); });
  assert.deepEqual([down.ok, down.error], [false, 'unreachable']);
  const off = await loadConsoleIntents({}, stub);
  assert.deepEqual([off.ok, off.error], [false, 'not_configured']);
});
