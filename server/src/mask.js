// The app's masking adapter over the shared masker (server/src/shared/mask.js, shared-masker 9bc664a, v1.4.0). The old names stay, so no call site changes.
// Masking is a HEURISTIC: it catches the common shapes and plain-language passwords listed in the shared README ("Known limits"), not every secret. Do not type a real credential.
// Choices (docs/ADOPTION.md): marks are exactly [masked] (markStyle plain); traceparent and traceId are the only opaque keys, because the app generates them itself
// (random W3C trace context, shown raw by design). Everything the visitor types is masked under any other key.
// Typed text goes through cleanInput: delete invisible and control characters, NFKC, the shared masker, then the six TYPED_EXTRAS below. The extras are this app's own rules
// for gaps the shared masker states or has (see the README of this app, "Masking"): they run on typed text only, never on an answer, and each one has a test.
import { createMasker } from './shared/mask.js';

const m = createMasker({
  markStyle: 'plain',
  opaqueKeys: new Set(['traceparent', 'traceId']),
});

export const MARK = '[masked]';
export const isCredentialId = m.isCredentialId;
// An answer's text and an answer: the same masker, strings and object keys, the input never mutated.
export const maskResponseText = m.maskText;
export const maskDeep = m.maskDeep;

// Display safety, not secrecy: invisible, bidi-format and control characters are deleted (tab, newline and CR stay), then NFKC.
const STRIP = /[\p{Default_Ignorable_Code_Point}\p{Cf}�]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const flatten = (s) => s.replace(STRIP, '').replace(CONTROL, '').normalize('NFKC').replace(STRIP, '').replace(CONTROL, '');

const hasDigit = (s) => /\d/.test(s);
const hasLetter = (s) => /[A-Za-z]/.test(s);
const PW = 'password|passwd|passcode|passphrase|pwd|pw';
const KW = `${PW}|pass|secret|token|api[ _-]?key|apikey|keys?`;
// 1. a single opaque run of 20+ characters with a letter, a digit and a segment (split on - _) of 16+: a pasted key. The shared masker's opaque-run floor is 32.
// 2. scheme-relative userinfo with no colon (//hunter2xyz@host): the shared masker reads it as an e-mail address.
// 3. a keyword joined to a value by - _ or . with an underscore ahead (api_key_hunter2xyz): the shared masker reads the part after the name as a descriptive suffix.
// 4. "password - x": a password word, a dash, a SHORT value (the shared floor for this form is 6 characters with a digit). 1-3 characters, or 4-5 with a digit or symbol.
// 5. "login: bob / x": a user and a password written as a pair.
const TYPED_EXTRAS = [
  [/[A-Za-z0-9_-]{20,}/g, (s) => (hasDigit(s) && hasLetter(s) && s.split(/[-_]/).some((p) => p.length >= 16) ? MARK : s)],
  [/(\/\/)[^\s/?#@[\]]{1,200}@/g, (s, a) => `${a}${MARK}@`],
  [new RegExp(`(?<![A-Za-z])(${KW})(_)([A-Za-z0-9]{6,300})`, 'gi'), (s, k, j, v) => (hasDigit(v) ? `${k}${j}${MARK}` : s)],
  [new RegExp(`(?<![A-Za-z])(${PW})(\\s{1,5}[-\\u2013\\u2014]+\\s{1,5})([^\\s,;\\[\\]]{1,5})(?=$|[\\s,;.)])`, 'gi'), (s, k, sep, v) => (v.length <= 3 || /[^A-Za-z]/.test(v) ? `${k}${sep}${MARK}` : s)],
  [/\b((?:log[ -]?in|user(?:name)?|account|credentials?|creds)\s{0,3}[:=]\s{0,3}[^\s/[\]]{1,60}\s{0,3}[/|]\s{0,3})([^\s[\]]{1,100})/gi, (s, head) => `${head}${MARK}`],
];
const extras = (text) => TYPED_EXTRAS.reduce((acc, [re, fn]) => acc.replace(re, fn), text);

// What a visitor typed, cleaned for storing and showing: masked, then whitespace collapsed. NOT cut to length: the caller refuses an over-long value instead,
// so a secret that straddles a limit is masked whole and nothing is silently dropped.
export const cleanInput = (value) => extras(m.maskText(flatten(String(value ?? '')))).replace(/\s+/g, ' ').trim();
// For a name or an id that is echoed as-is or refused: true when it is credential-shaped (the caller refuses without echoing it).
export const looksLikeCredential = (value) => { const s = flatten(String(value ?? '')); return m.looksLikeCredential(s) || extras(s) !== s; };
