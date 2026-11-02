// A call, as the lab's invented shape: { tool, description, args }. Everything a visitor can type goes through normalizeCall, which bounds it
// (lengths, key count, value types), masks credential-shaped text and refuses credential-shaped names. A value that is too long is REFUSED whole,
// never cut. Every error text here is fixed: it never repeats what was typed, not even a slice of a key name. Nothing is evaluated or used as a pattern.
import { cleanInput, looksLikeCredentialName } from './mask.js';

export class InputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const TOOL = /^[A-Za-z0-9._-]{1,64}$/;
const ARG_KEY = /^[a-z][a-z0-9_]{0,23}$/;
export const MAX_ARGS = 8;
export const MAX_DESCRIPTION = 200; // characters (UTF-16 code units) as typed, before masking
export const MAX_ARG_VALUE = 64;
export const TARGET_KEYS = ['record', 'payee', 'dataset', 'account'];

export function normalizeCall(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new InputError('bad_call', 'call must be an object');
  const { tool, description = '', args = {} } = input;
  if (typeof tool !== 'string' || !TOOL.test(tool)) throw new InputError('bad_tool', 'tool must be 1-64 letters, digits, dot, dash or underscore');
  if (looksLikeCredentialName(tool)) throw new InputError('bad_tool', 'tool looks like a credential: use a plain tool name such as invoices.lookup');
  if (typeof description !== 'string') throw new InputError('bad_description', 'description must be text');
  if (description.length > MAX_DESCRIPTION) throw new InputError('bad_description', `description must be at most ${MAX_DESCRIPTION} characters`);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new InputError('bad_args', 'args must be an object');
  const keys = Object.keys(args);
  if (keys.length > MAX_ARGS) throw new InputError('bad_args', `at most ${MAX_ARGS} args`);
  const clean = {};
  for (const k of keys) {
    if (!ARG_KEY.test(k) || looksLikeCredentialName(k)) throw new InputError('bad_args', 'an argument name is not allowed: use a lowercase name of up to 24 letters, digits or underscores, and not a credential');
    const v = args[k];
    if (typeof v === 'string') {
      if (v.length > MAX_ARG_VALUE) throw new InputError('bad_args', `an argument value must be at most ${MAX_ARG_VALUE} characters`);
      clean[k] = cleanInput(v);
    }
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1_000_000) clean[k] = v;
    else if (typeof v === 'boolean') clean[k] = v;
    else throw new InputError('bad_args', 'an argument value must be short text, a number or true/false');
  }
  return { tool, description: cleanInput(description), args: clean };
}

export const shapeOf = (call) => Object.keys(call.args).sort().join(',');
export const targetOf = (call) => { const k = TARGET_KEYS.find((t) => typeof call.args[t] === 'string' && call.args[t]); return k ? call.args[k] : null; };
export const recordsOf = (call) => { const n = call.args.limit ?? call.args.records; return typeof n === 'number' && n >= 1 ? Math.floor(n) : 1; };
export const dataClassOf = (call) => call.tool.toLowerCase().split('.')[0];
export const segmentsOf = (tool) => tool.toLowerCase().split(/[._-]+/).filter(Boolean);
