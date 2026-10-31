// Intent: what is the call trying to do, whatever it literally says. Two tiers, kept apart on purpose.
//  - Deterministic patterns over the tool name and argument shape (AIIntent.Patterns). These may hard-refuse.
//  - A similarity score (AIIntent.Exemplars, AIIntent.Floor). In the product this is semantic similarity via an encoder; here it is
//    a lab stand-in (word overlap with the intent's exemplar phrases) so the lab runs offline. It can alert or ask. It never denies.
// The AIIntent field NAMES are from the Privilege console swagger (2026-10-31, schema only). How the product uses them is UNVERIFIED:
// the pattern mini-syntax below, the saturation of the overlap score, and the reading of Floor are the lab's own.
import { recordsOf, segmentsOf } from './call.js';
import { INTENTS } from './data.js';

export const RISKY = new Set(['exfiltrate-data', 'change-payee']);
export const CLASSES = Object.keys(INTENTS);
const SAT = 4; // this many exemplar words in common = similarity 1.0 (lab choice)
const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'this', 'that', 'is', 'or', 'and', 'in', 'on', 'at', 'by', 'with', 'it', 'its', 'where']);

// Pattern mini-syntax (lab): a pattern is terms joined by "+" (all must hold); a term is "seg:a|b" (the tool name has one of these
// segments), "arg:name" (that argument is present as text) or "records>=N". A list of patterns is an OR. Parsed with split, never a regex.
function termHolds(term, call, segs) {
  if (term.startsWith('seg:')) return term.slice(4).split('|').some((w) => segs.includes(w));
  if (term.startsWith('arg:')) return typeof call.args[term.slice(4)] === 'string';
  if (term.startsWith('records>=')) return recordsOf(call) >= Number(term.slice(9));
  return false;
}
export const patternHolds = (pattern, call, segs) => pattern.split('+').every((t) => termHolds(t, call, segs));

const LEX = Object.fromEntries(CLASSES.map((c) => [c, new Set(INTENTS[c].Exemplars.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)))]));
const lexiconFor = (c) => LEX[c];

// Scores below AIIntent.Floor do not count (lab reading of Floor). Kept apart so a stored MOCK row can be re-read under an edited Floor.
export function applyFloor(rawScores, floor, riskHits = null) {
  const scores = Object.fromEntries(CLASSES.map((c) => [c, rawScores[c] >= floor ? rawScores[c] : 0]));
  const top = CLASSES.reduce((a, b) => (scores[b] > scores[a] ? b : a));
  const riskClass = [...RISKY].reduce((a, b) => (scores[b] > scores[a] ? b : a));
  return { class: scores[top] === 0 ? 'unclassified' : top, score: scores[top], riskClass: scores[riskClass] > 0 ? riskClass : null, riskScore: scores[riskClass], scores, rawScores, ...(riskHits ? { hits: riskHits } : {}) };
}

export function similarity(call, floor = 0) {
  const words = [...new Set(`${call.description} ${segmentsOf(call.tool).join(' ')}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).slice(0, 60))];
  const raws = {}; const hits = {};
  for (const c of CLASSES) { hits[c] = words.filter((w) => lexiconFor(c).has(w)); raws[c] = Math.min(1, hits[c].length / SAT); }
  const risky = [...RISKY];
  const riskHitClass = risky.reduce((a, b) => (raws[b] > raws[a] ? b : a));
  return applyFloor(raws, floor, hits[riskHitClass]);
}

export function classify(call, floor = 0) {
  const segs = segmentsOf(call.tool);
  const matched = CLASSES.filter((c) => INTENTS[c].Patterns.some((p) => patternHolds(p, call, segs))).map((c) => ({ id: c, class: c, label: INTENTS[c].Description }));
  const semantic = similarity(call, floor);
  return { deterministic: { matched }, semantic, class: matched.length ? matched[0].class : semantic.class };
}
