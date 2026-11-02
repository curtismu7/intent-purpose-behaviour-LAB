// The app's masking adapter over the shared masker (server/src/shared/mask.js, shared-masker 9bc664a, v1.4.0). The old names stay, so no call site changes.
// Masking is a HEURISTIC: it catches the common shapes and plain-language passwords listed in the shared README ("Known limits"), not every secret. Do not type a real credential.
// Choices (docs/ADOPTION.md): marks are exactly [masked] (markStyle plain); traceparent and traceId are the only opaque keys, because the app generates them itself
// (random W3C trace context, shown raw by design). Everything the visitor types is masked under any other key.
// Typed text goes through cleanInput: the shared masker, then delete invisible and control characters, then the five TYPED_EXTRAS below. The extras are this app's own rules
// for gaps the shared masker states or has (see the README of this app, "Masking"): they run on typed text only, never on an answer, and each one has a test.
import { createMasker } from './shared/mask.js';

const m = createMasker({
  markStyle: 'plain',
  opaqueKeys: new Set(['traceparent', 'traceId']),
});

// The answers of the two token flows (obo, idjag) take no typed text: the scenario is a listed id and the traceparent a strict hex form. Their exhibits are
// MOCK-ISSUED tokens shown raw by design (labelled as such), as keys (token, subject_token ...) and inside the hop panes, so those subtrees are opaque and the rest
// of the answer (titles, lessons, config, checks) is masked like any other, as prose (keyMode none).
const flow = createMasker({
  markStyle: 'plain',
  keyMode: 'none',
  opaqueKeys: new Set(['traceparent', 'traceId']),
  pathRules: [{ match: /^(?:original|exchanged|grant|access|exchangeRequest|redeemRequest|jwks|hops)(?:\.|$)/, opaque: true }],
});
export const maskFlow = flow.maskDeep;

export const MARK = '[masked]';
export const isCredentialId = m.isCredentialId;
// An answer's text and an answer: the same masker, strings and object keys, the input never mutated.
export const maskResponseText = m.maskText;
export const maskDeep = m.maskDeep;

// Display safety, not secrecy: C0/C1 control characters (tab, newline and CR stay), bidi controls (a reversed or hidden run of text) and tag characters (invisible
// text) are deleted from what is stored and shown. This runs AFTER the shared masker, which reads all of them itself (a tag-character "password" is understood and
// masked, not just deleted). Zero-width spaces and joiners stay: they change nothing on screen. No NFKC: the shared masker normalises for matching, and the stored
// text keeps what the visitor typed.
const HIDE = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const strip = (s) => s.replace(HIDE, '').replace(CONTROL, '');

const hasDigit = (s) => /\d/.test(s);
const hasLetter = (s) => /[A-Za-z]/.test(s);
const PW = 'password|passwd|passcode|passphrase|pwd|pw';
const KW = `${PW}|pass|secret|token|api[ _-]?key|apikey|keys?`;
// 1. a single opaque run of 20+ characters with a letter, a digit and a segment (split on - _) of 16+, that is not pure hex (hashes, digests and trace ids are
//    ordinary text): a pasted key. The shared masker's opaque-run floor is 32.
// 2. scheme-relative userinfo with no colon (//hunter2xyz@host), not after a scheme (ssh://git@host stays): the shared masker reads it as an e-mail address.
// 3. a keyword joined to a value by an underscore (api_key_hunter2xyz): the shared masker reads the part after the name as a descriptive suffix.
// 4. "password - x": a password word, a dash, a SHORT value (the shared floor for this form is 6 characters with a digit). 1-3 characters, or 4-5 with a digit or symbol.
// 5. "login: bob / x": a user and a password written as a pair.
const TYPED_EXTRAS = [
  [/[A-Za-z0-9_-]{20,}/g, (s) => (hasDigit(s) && hasLetter(s) && !/^[a-f0-9-]+$/i.test(s) && s.split(/[-_]/).some((p) => p.length >= 16) ? MARK : s)],
  [/(?<!:)(\/\/)[^\s/?#@[\]]{1,200}@/g, (s, a) => `${a}${MARK}@`],
  [new RegExp(`(?<![A-Za-z])(${KW})(_)([A-Za-z0-9]{6,300})`, 'gi'), (s, k, j, v) => (hasDigit(v) ? `${k}${j}${MARK}` : s)],
  [new RegExp(`(?<![A-Za-z])(${PW})(\\s{1,5}[-\\u2013\\u2014]+\\s{1,5})([^\\s,;\\[\\]]{1,5})(?=$|[\\s,;.)])`, 'gi'), (s, k, sep, v) => (v.length <= 3 || /[^A-Za-z]/.test(v) ? `${k}${sep}${MARK}` : s)],
  [/\b((?:log[ -]?in|user(?:name)?|account|credentials?|creds)\s{0,3}[:=]\s{0,3}[^\s/[\]]{1,60}\s{0,3}[/|]\s{0,3})([^\s[\]]{1,100})/gi, (s, head) => `${head}${MARK}`],
];
const extras = (text) => TYPED_EXTRAS.reduce((acc, [re, fn]) => acc.replace(re, fn), text);
// True when one of this app's own rules (not the shared masker) recognises the text.
export const matchesAppRules = (value) => { const s = strip(String(value ?? '')); return extras(s) !== s; };

// What a visitor typed, cleaned for storing and showing: masked, then whitespace collapsed. NOT cut to length: the caller refuses an over-long value instead,
// so a secret that straddles a limit is masked whole and nothing is silently dropped.
export const cleanInput = (value) => extras(strip(m.maskText(String(value ?? '')))).replace(/\s+/g, ' ').trim();
// For a name or an id that is echoed as-is or refused: true when it is credential-shaped (the caller refuses without echoing it).
export const looksLikeCredential = (value) => m.looksLikeCredential(String(value ?? '')) || matchesAppRules(value);
// A NAME (a tool, an argument) is never a digest or a UUID, so 24+ hex digits (hyphens ignored) are refused here, unlike in free text.
export const looksLikeCredentialName = (value) => looksLikeCredential(value) || /^[a-f0-9]{24,}$/i.test(String(value ?? '').replace(/-/g, ''));
