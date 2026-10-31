// A call, as the lab's invented shape: { tool, description, args }. Everything a visitor can type goes through normalizeCall,
// which bounds it (lengths, key count, value types) and strips control characters. Nothing here is ever evaluated or used as a pattern.
import { cleanText } from './safety.js';

export class InputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const TOOL = /^[A-Za-z0-9._-]{1,64}$/;
const ARG_KEY = /^[a-z][a-z0-9_]{0,23}$/;
export const MAX_ARGS = 8;
export const TARGET_KEYS = ['record', 'payee', 'dataset', 'account'];

export function normalizeCall(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new InputError('bad_call', 'call must be an object');
  const { tool, description = '', args = {} } = input;
  if (typeof tool !== 'string' || !TOOL.test(tool)) throw new InputError('bad_tool', 'tool must be 1-64 letters, digits, dot, dash or underscore');
  if (typeof description !== 'string') throw new InputError('bad_description', 'description must be text');
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new InputError('bad_args', 'args must be an object');
  const keys = Object.keys(args);
  if (keys.length > MAX_ARGS) throw new InputError('bad_args', `at most ${MAX_ARGS} args`);
  const clean = {};
  for (const k of keys) {
    if (!ARG_KEY.test(k)) throw new InputError('bad_args', `arg name "${k.slice(0, 24)}" is not allowed`);
    const v = args[k];
    if (typeof v === 'string') clean[k] = cleanText(v, 64);
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1_000_000) clean[k] = v;
    else if (typeof v === 'boolean') clean[k] = v;
    else throw new InputError('bad_args', `arg "${k}" must be short text, a number or true/false`);
  }
  return { tool, description: cleanText(description, 200), args: clean };
}

export const shapeOf = (call) => Object.keys(call.args).sort().join(',');
export const targetOf = (call) => { const k = TARGET_KEYS.find((t) => typeof call.args[t] === 'string' && call.args[t]); return k ? call.args[k] : null; };
export const recordsOf = (call) => { const n = call.args.limit ?? call.args.records; return typeof n === 'number' && n >= 1 ? Math.floor(n) : 1; };
export const dataClassOf = (call) => call.tool.toLowerCase().split('.')[0];
export const segmentsOf = (tool) => tool.toLowerCase().split(/[._-]+/).filter(Boolean);
