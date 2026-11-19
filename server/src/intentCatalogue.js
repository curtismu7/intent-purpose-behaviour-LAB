// The Intent Catalogue and the Customer Intent, served for the two new tabs. Real-mode data comes from the
// local Privilege console (owner-configured, loopback only, see consoleSource.js); Mock mode uses the measured
// snapshot committed with the lab (builtinIntents.json). A customer intent with the same name as a built-in
// REPLACES it wholesale — the console's own clone rule, shown and enforced here.
import { BUILTIN_INTENTS } from './builtinIntentsLoader.js';
import { INTENT_SOURCE, classifyConsole, compilePatterns, compilePattern, MAX_PATTERN } from './consoleIntents.js';
import { InputError, normalizeCall } from './call.js';
import { loadConsoleIntents, consoleConfigured } from './consoleSource.js';

export const CUSTOM_INTENT_TEMPLATE = Object.freeze({
  name: 'demo_data_exfiltration',
  description: 'Bulk extraction of demo customer data across the standalone demo family (a clone of data_exfiltration, reworded for our labs).',
  exemplars: ['export every demo customer record from the banking lab', 'download all mock account rows from the mcp server', 'pull the whole demo dataset into my own files', 'send every mock customer to an external endpoint', 'dump the demo store to my laptop'],
  twins: ['run the demo shopping flow end to end', 'show one mock customer record', 'generate the demo quarterly summary'],
  patterns: ['\\b(demo|mock|standalone)\\b.*\\b(dump|export|download|pull|extract)\\b.*\\b(all|every|whole|entire|bulk)\\b', '\\b(all|every)\\b.*\\b(mock|demo)\\b.*\\b(records?|rows?|customers?|accounts?)\\b.*\\b(out|external|offsite|drive|laptop)\\b'],
  acts: true,
  floor: 0,
});

const NAME = /^[a-z][a-z0-9_]{2,39}$/;
const MAX_LIST = 20;
const MAX_STR = 300;

export function cleanIntentBody(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new InputError('bad_intent', 'an intent must be an object');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!NAME.test(name)) throw new InputError('bad_intent', `name must be 3-40 lowercase letters, digits or underscores, starting with a letter`);
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, MAX_STR) : '';
  const strList = (v, label) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > MAX_LIST) throw new InputError('bad_intent', `${label} must be a list of at most ${MAX_LIST} strings`);
    return v.map((s) => { if (typeof s !== 'string' || s.length > MAX_STR) throw new InputError('bad_intent', `${label} entries must be text of up to ${MAX_STR} characters`); return s; });
  };
  const compiled = compilePatterns(strList(input.patterns, 'patterns'));
  if (!compiled.ok) throw new InputError('bad_patterns', compiled.errors[0] || 'a pattern is not a valid regex');
  return {
    name, description,
    exemplars: strList(input.exemplars, 'exemplars'),
    twins: strList(input.twins, 'twins'),
    patterns: strList(input.patterns, 'patterns'),
    acts: input.acts === true,
    floor: 0,
  };
}

// The full catalogue view: built-ins (snapshot or live console) plus the workspace's customer intents.
// A customer intent whose name matches a built-in shadows it (shown as REPLACES, the console's clone rule).
export function catalogue(customIntents, liveIntents = null) {
  const source = liveIntents ?? BUILTIN_INTENTS;
  const custom = customIntents ?? [];
  const customNames = new Set(custom.map((c) => c.name));
  const rows = source.map((i) => {
    const shadow = custom.find((c) => c.name === i.name);
    return { ...i, replacedBy: shadow ? 'customer' : null, effective: shadow ?? i };
  });
  for (const c of custom) if (!customNames.has(c.name) || !source.some((i) => i.name === c.name)) {
    if (!rows.some((r) => r.name === c.name)) rows.push({ ...c, replacedBy: null, effective: c, isCustom: true });
  }
  return { source: liveIntents ? 'live-console' : 'measured-snapshot', sourceDetail: INTENT_SOURCE, intents: rows, counts: { total: rows.length, builtin: source.length, custom: custom.length, acting: rows.filter((r) => r.effective.acts).length } };
}

// Validate a pattern the visitor typed, without storing it: the editor calls this on every keystroke batch.
export function checkPattern(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' };
  if (text.length > MAX_PATTERN) return { ok: false, reason: `over ${MAX_PATTERN} characters` };
  const c = compilePattern(text);
  return c.ok ? { ok: true } : { ok: false, reason: c.reason };
}

// Simulate one call against the catalogue: which intents match, by pattern or similarity, and what the policy would do.
export function simulate({ call, customIntents, floor = 0, liveIntents = null }) {
  const norm = normalizeCall(call);
  const cat = catalogue(customIntents, liveIntents);
  const intents = cat.intents.map((r) => r.effective);
  const result = classifyConsole(norm, intents, floor);
  const customHits = result.deterministic.matched.filter((m) => customIntents.some((c) => c.name === m.id));
  const shadowHits = result.deterministic.matched.filter((m) => cat.intents.some((r) => r.name === m.id && r.replacedBy));
  return {
    call: norm,
    source: cat.source,
    patternMatches: result.deterministic.matched,
    wouldRefuse: result.deterministic.matched.some((m) => intents.find((i) => i.name === m.id)?.acts),
    similarity: { class: result.semantic.class, score: result.semantic.score, riskClass: result.semantic.riskClass, riskScore: result.semantic.riskScore, topHits: result.semantic.riskHits?.slice(0, 8) ?? [] },
    customIntentHits: customHits.map((m) => m.id),
    shadowedBuiltins: shadowHits.map((m) => m.id),
    losses: result.losses,
  };
}

export const intentRouteHandlers = {
  catalogue,
  simulate,
  cleanIntentBody,
  CUSTOM_INTENT_TEMPLATE,
  consoleConfigured,
};

