// The console intents engine, measured 2026-11-18 on the local Privilege console (GET /v1/aiintents?ObjectMeta.Namespace=procyon).
// This is the product's shape, not the lab's earlier invented mini-syntax:
//   - an intent's Patterns are real ECMAScript regexes over the call text (tool + description + string argument values);
//   - Exemplars drive semantic similarity (the lab's stand-in: word overlap; the product uses an encoder — AIIntentConfig.Encoder);
//   - Twins are the benign look-alikes that should NOT score as this intent;
//   - Acts = the intent can act / hard-refuse (the deterministic tier); the scored tier alerts or asks, never denies;
//   - Floor = the minimum similarity that counts (the console UI showed floor "auto"; the stored value is 0 — treated as "not set", so the
//     lab's own floor policy field applies, as before).
// Safety: every pattern is compiled once through compilePatterns, which bounds length, rejects nested quantifiers that can blow the stack
// (a fixed list of known-bad shapes), and wraps each match in a wall-clock guard (a regex that runs too long loses that intent for this call
// and the loss is recorded — it never hangs the lab and never crashes it). Patterns are never accepted from a visitor at runtime un-bounded:
// the Customer-Intent editor runs the same compiler and shows the same refusals.
import { BUILTIN_INTENTS } from './builtinIntentsLoader.js';

export const INTENT_SOURCE = 'measured on the local Privilege console, 2026-11-18 (GET /v1/aiintents, namespace procyon)';
export const MAX_PATTERN = 200; // characters of pattern text accepted
export const MAX_TEXT_LENGTH = 400; // the haystack given to each regex
export const MATCH_BUDGET_MS = 5; // per pattern per call (advisory: JS regexes are synchronous, so the real defence is compile-time rejection)

// Catastrophic-backtracking guard (compile time). A pattern is refused when it nests a quantifier inside a
// quantified group ((a+)+, (a|a)*, ...) or stacks many .* runs — the shapes that blow the stack. The check is
// syntactic and refuses on doubt: the console's own intents all pass it, and a customer pattern it wrongly
// refuses is shown back to the author with the reason. A wall-clock guard at match time remains as the second
// line (an over-budget match loses that pattern for this call), but it can only ever fire on the margin: JS
// regex matching is synchronous, so compile time is where a hostile pattern is actually stopped.
export function backtrackingRisk(pattern) {
  if (pattern.length > MAX_PATTERN) return 'over the 200-character limit';
  const nested = /\((?:[^()\\]|\\.)*[+*]\)(?:[+*{]|\{\d)/;
  const nestedAlt = /\((?:[^()\\]|\\.)*\|[^()]*\)(?:[+*]|\{\d)/;
  const stacked = /(\.\*[^)]{0,10}){4}/; // four or more .* runs: refused on doubt (catches (.*a){20}-shaped risks early)
  const boundedQuant = /\{(\d+),?(\d*)\}/; // an explicit large bounded quantifier over a dot-star: (.*){20} class
  const boundedDotStar = /\.\*[^)]*\{\d{2,}\}|\(\.\*[^)]*\)\{\d{2,}\}/; // an explicit large bounded quantifier over a dot-star: (.*){20}-class
  if (nested.test(pattern) || nestedAlt.test(pattern) || stacked.test(pattern) || boundedDotStar.test(pattern)) return 'nested quantifier: this shape can backtrack catastrophically';
  return null;
}

const cache = new Map();

export function compilePattern(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_PATTERN) return { ok: false, reason: `pattern must be 1-${MAX_PATTERN} characters` };
  const risk = backtrackingRisk(text);
  if (risk) return { ok: false, reason: risk };
  try {
    const re = new RegExp(text, 'i');
    return { ok: true, re };
  } catch {
    return { ok: false, reason: 'not a valid ECMAScript regex' };
  }
}

export function compilePatterns(patterns) {
  if (!Array.isArray(patterns)) return { ok: false, errors: ['patterns must be a list'], compiled: [] };
  const errors = [];
  const compiled = [];
  for (const p of patterns.slice(0, 20)) {
    const c = compilePattern(p);
    if (!c.ok) errors.push(c.reason);
    else compiled.push(c.re);
  }
  return { ok: errors.length === 0, errors, compiled };
}

const WORD = /[a-z0-9]+/g;
const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'this', 'that', 'is', 'or', 'and', 'in', 'on', 'at', 'by', 'with', 'it', 'its', 'my', 'me', 'i']);
export const SAT = 4; // this many exemplar words in common = similarity 1.0 (lab stand-in, as before)
const LEXICON = new Map();
function lexiconOf(intent) {
  let lex = LEXICON.get(intent.name);
  if (!lex) {
    lex = new Set(intent.exemplars.join(' ').toLowerCase().match(WORD)?.filter((w) => !STOP.has(w)) ?? []);
    LEXICON.set(intent.name, lex);
  }
  return lex;
}

// The haystack for regexes: the tool name, the description and every string argument value, bounded.
export function callText(call) {
  const argValues = Object.values(call.args ?? {}).filter((v) => typeof v === 'string').join(' ');
  const text = `${call.tool} ${call.description} ${argValues}`.slice(0, MAX_TEXT_LENGTH);
  return text;
}

// One regex match, with a wall-clock guard. Never throws; an over-budget or hostile pattern loses the match for this call.
export function guardedMatch(re, text, budgetMs = MATCH_BUDGET_MS) {
  const start = performance.now();
  try {
    const m = re.exec(text);
    return { matched: Boolean(m), overBudget: performance.now() - start > budgetMs };
  } catch {
    return { matched: false, overBudget: true };
  }
}

export function patternScan(call, intents, floor = 0) {
  const text = callText(call);
  const results = [];
  const losses = [];
  for (const intent of intents) {
    if (!intent.patterns?.length) continue;
    for (const pat of intent.patterns) {
      let entry = cache.get(pat);
      if (entry === undefined) { entry = compilePattern(pat); cache.set(pat, entry); }
      if (!entry.ok) { losses.push({ intent: intent.name, pattern: pat.length, reason: entry.reason }); continue; }
      const r = guardedMatch(entry.re, text);
      if (r.overBudget) losses.push({ intent: intent.name, pattern: pat.length, reason: 'over match budget' });
      if (r.matched) results.push({ intent: intent.name, pattern: pat, acts: intent.acts });
    }
  }
  return { text, matched: results, losses };
}

export function similarityScan(call, intents, floor = 0) {
  const words = [...new Set(`${call.tool} ${call.description}`.toLowerCase().match(WORD)?.filter((w) => !STOP.has(w)) ?? [].slice(0, 60))];
  const scores = {};
  const hitsByIntent = {};
  const RISKY = intents.filter((i) => i.acts).map((i) => i.name);
  let top = null; let topScore = 0;
  let riskTop = null; let riskScore = 0;
  for (const intent of intents) {
    const lex = lexiconOf(intent);
    const hits = words.filter((w) => lex.has(w));
    hitsByIntent[intent.name] = hits;
    const raw = Math.min(1, hits.length / SAT);
    const s = raw >= (floor > 0 ? floor : 0.25) ? raw : 0;
    scores[intent.name] = s;
    if (s > topScore) { topScore = s; top = intent.name; }
    if (RISKY.includes(intent.name) && s > riskScore) { riskScore = s; riskTop = intent.name; }
  }
  const riskHits = riskTop ? hitsByIntent[riskTop] : [];
  return { scores, class: topScore > 0 ? top : 'unclassified', score: topScore, riskClass: riskScore > 0 ? riskTop : null, riskScore, hits: hitsByIntent, riskHits };
}

// classify: the shape the rest of the lab already understands (deterministic.matched, semantic.riskScore / riskClass), now against the real intents.
export function classifyConsole(call, intents = BUILTIN_INTENTS, floor = 0) {
  const scan = patternScan(call, intents);
  const semantic = similarityScan(call, intents, floor);
  return { deterministic: { matched: scan.matched.map((m) => ({ id: m.intent, label: m.pattern, class: m.intent })) }, semantic, text: scan.text, losses: scan.losses };
}
