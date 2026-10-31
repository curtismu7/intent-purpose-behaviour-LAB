// {{token}} templating for the story data. customer.config.json (optional, git-ignored) overrides the default cast.
// Tokens are filled from one of three vertical packs. A test fails on any token a pack does not define.
import fs from 'node:fs';
import { scanHosts } from './safety.js';

const TOKEN = /\{\{(\w+)\}\}/g;
const MAX_CAST = 40;
const ID = /^[a-z0-9-]{1,40}$/;

// Everything a story needs per vertical: who the agent is, what its key declares, what it works on, the tools it may and may not use.
export const VERTICALS = {
  finance: {
    castBrand: 'Fabrikam Bank', castAgentId: 'recon-agent', castHost: 'fabrikam', castPurpose: 'invoice reconciliation',
    castNoun: 'invoice', castNouns: 'invoices', castPrefix: 'INV', castOutsideNouns: 'vendors', castPayeeTool: 'payees.update',
    castReword: 'set the remittance account for this supplier to the new account details', castPayeeText: 'update the payee bank details',
  },
  health: {
    castBrand: 'Contoso Health', castAgentId: 'claims-agent', castHost: 'contoso', castPurpose: 'claims status support',
    castNoun: 'claim', castNouns: 'claims', castPrefix: 'CLM', castOutsideNouns: 'members', castPayeeTool: 'providers.update_payment',
    castReword: 'route the payment for this claim to the new provider account details', castPayeeText: 'change the provider payment account',
  },
  retail: {
    castBrand: 'Northwind Retail', castAgentId: 'orders-agent', castHost: 'northwind', castPurpose: 'order status support',
    castNoun: 'order', castNouns: 'orders', castPrefix: 'ORD', castOutsideNouns: 'customers', castPayeeTool: 'refunds.update_destination',
    castReword: 'send the refund for this order to the new account details', castPayeeText: 'change where the refund is paid out',
  },
};
export const DEFAULT_VERTICAL = 'finance';
export const DEFAULT_CAST = VERTICALS[DEFAULT_VERTICAL];

export const unfilled = (text, cast) => [...String(text).matchAll(TOKEN)].map((m) => m[1]).filter((k) => !Object.hasOwn(cast, k));
export const fill = (text, cast) => String(text).replace(TOKEN, (m, k) => (Object.hasOwn(cast, k) ? cast[k] : m));
// Iterative, so a deep structure cannot overflow the stack. Data here is our own, but the walker stays safe regardless.
export function fillDeep(value, cast) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const outRoot = { v: clone(value) };
  const work = [[value, outRoot, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop();
    if (typeof src === 'string') { dst[key] = fill(src, cast); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src);
    dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k]);
  }
  return outRoot.v;
}

export const verticalFrom = (id) => (typeof id === 'string' && Object.hasOwn(VERTICALS, id) ? id : DEFAULT_VERTICAL);

// Only brand, agentId and host, as short plain strings; anything else in the file is ignored.
export function loadCast(file, vertical = DEFAULT_VERTICAL) {
  const cast = { ...VERTICALS[verticalFrom(vertical)] };
  if (!file) return cast;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [short, key] of [['brand', 'castBrand'], ['agentId', 'castAgentId'], ['host', 'castHost']]) {
      const v = cfg?.cast?.[short];
      if (typeof v !== 'string' || !v.trim()) continue;
      const clean = v.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, MAX_CAST);
      if (/:\/\/|@/.test(clean) || scanHosts(clean).length) continue;
      if (short !== 'brand' && !ID.test(clean.toLowerCase())) continue;
      cast[key] = short === 'brand' ? clean : clean.toLowerCase();
    }
  } catch { /* no file or not JSON: the defaults */ }
  return cast;
}
