// The keys Live mode signs with, generated once per process and never written anywhere. RSA only (EC keygen is not used in this
// repo: it aborted in CI on an older Node). Three issuers' keys: the user's IdP, a third-party application's own issuer, and a
// rogue key nobody trusts (for the bad-signature and untrusted-issuer cases).
import { generateRsaKey } from './jwt.js';

let keys = null;
export function getKeys() {
  if (!keys) keys = { userIdp: generateRsaKey('mock-user-idp-1'), appIdp: generateRsaKey('mock-app-issuer-1'), rogue: generateRsaKey('mock-rogue-1') };
  return keys;
}
export const jwksOf = (...ks) => ({ keys: ks.map((k) => k.jwk) });
