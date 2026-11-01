// Masking for what a visitor types (a description, an argument value) and, as a second layer, for what the app answers. Typed text is echoed in
// the answer, the hop panes and the Live state, so it is cleaned on the way in and the answer is masked again on the way out.
// HEURISTIC, not a guarantee: it recognises common shapes and plain-language passwords. Do not type a real credential.
// What it still misses: a bare word with no keyword before it and no credential shape ("swordfish"); a value after a keyword with a plain space
// when the value has no digit or is under 6 characters ("password hunter"); letters from another alphabet that look like Latin ones (a Cyrillic a
// or a Greek o inside "password": NFKC does not unify them); a keyword split by an ordinary space or a letter ("pass word=x"); encoding layered
// more than three deep; the weak keywords key and pass when no separator follows.
// It over-masks on purpose: "token: refresh" is masked because a colon after a keyword introduces a value; "bearer" and "basic" followed by a
// long word with a digit are masked.
// Steps: (1) delete invisible characters (default-ignorable, format, U+FFFD) and every C0/C1 control character except tab, newline and carriage
// return, then NFKC; (2) percent-decode up to three rounds and look at every round; (3) the detectors below. Tab, newline, CR, U+2028 and U+2029
// act as separators, so the detectors run a second time with those deleted ("pass<TAB>word=x"), and with "+" read as a space ("password+x"); a
// second look only ever adds masking. Every regex has bounded quantifiers or is linear: no nested unbounded quantifier.
// The false-positive tradeoff of "keyword + space + value": it fires only for 6+ characters containing a digit, so "password reset", "token
// bucket" and "secret garden" stay readable while "password hunter2xyz" is masked.
export const MARK = '[masked]';
export const PERCENT_ROUNDS = 3;

const STRIP = /[\p{Default_Ignorable_Code_Point}\p{Cf}\uFFFD]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g; // C0 and C1 except tab, newline, carriage return
const clean = (s) => s.replace(STRIP, '').replace(CONTROL, '');
export const flatten = (s) => clean(clean(String(s)).normalize('NFKC'));

const decodeRun = (run) => { try { return decodeURIComponent(run); } catch { return run.replace(/%([0-9a-f]{2})/gi, (m, h) => (parseInt(h, 16) < 128 ? String.fromCharCode(parseInt(h, 16)) : m)); } };
// The text itself, then up to three rounds of percent-decoding (each round normalised again).
export function percentRounds(text) {
  const rounds = [text];
  for (let i = 0; i < PERCENT_ROUNDS; i += 1) {
    const cur = rounds[rounds.length - 1];
    const next = flatten(cur.replace(/(?:%[0-9a-fA-F]{2})+/g, decodeRun));
    if (next === cur) break;
    rounds.push(next);
  }
  return rounds;
}

const hasDigit = (s) => /\d/.test(s);
const hasLetter = (s) => /[A-Za-z]/.test(s);
const longestSegment = (s) => s.split(/[-_]/).reduce((n, p) => Math.max(n, p.length), 0);
// Words that follow "password is" in ordinary prose and are not a value.
const PROSE = new Set(('a an the and or of to for in on at by as if is was are were be not no with from this that it its can will must should may has have had does do did but so than then when ' +
  'where which who how what used using too very correct wrong required invalid valid weak strong short long empty missing set changed reset expired stored hashed encrypted rotated here there now never always').split(' '));

const STRONG_PW = 'password|passwd|passcode|passkey|passphrase|pwd|pw';
const SECRETISH = 'secret|token|api[ _-]?key|apikey|credentials?|private[ _-]?key|access[ _-]?key|account[ _-]?key|client[ _-]?secret|session[ _-]?id|sessionid|bearer|auth[ _-]?token'; // (an Authorization header line is the header detector's)
// A keyword that may have a name glued before it (my_password, xtoken); the short ones need a non-letter before them.
const ASSIGN_KW = `(?:(?<![A-Za-z])(?:pw|pwd|pass|keys?)|${STRONG_PW}|${SECRETISH})`;
const SEP = '(?:=>|->|[:=])';
// A value with no space and no closing punctuation; never an existing [masked] (so a second pass over masked text changes nothing).
const bare = (min, max) => `(?!\\[masked\\])[^\\s,;&}\\])"'\\\\]{${min},${max}}`;
const D = (re, fn, generic = false) => ({ re, fn, generic });

const DETECTORS = [
  // key blocks
  D(/-----BEGIN [A-Z0-9 ]{1,40}-----[\s\S]{0,6000}?(?:-----END [A-Z0-9 ]{1,40}-----|$)/g, () => MARK),
  // URL userinfo with or without a scheme: https://u:pw@host, //u:pw@host, u:pw@host (a mailto: address is left alone)
  D(/(\/\/)[^\s/?#@]{1,200}@/g, (m, a) => `${a}${MARK}@`),
  D(/(?<![\w.%+-])(?!mailto:)[\w.%+-]{1,100}:[^\s/?#@:]{1,100}@(?=[A-Za-z0-9[])/gi, () => `${MARK}@`),
  // header-style: the rest of the line. The one fixed line the app itself writes in a hop pane is left as it is.
  D(/\b(authorization|proxy-authorization|set-cookie|cookie)(\s{0,20}[:=]\s{0,20})([^\r\n]{1,300})/gi, (m, k, sep, v) => (v === 'Bearer <MOCK-ISSUED token>' ? m : `${k}${sep}${MARK}`)),
  // keyword = "quoted value" (also JSON, also JSON inside a string with escaped quotes): the value runs to the closing quote
  D(new RegExp(`(${ASSIGN_KW})(s?[\\w-]{0,30}[\\\\"']{0,4}\\s{0,20}${SEP}\\s{0,20}\\\\{0,2}["'])([^"'\\\\]{1,300})`, 'gi'), (m, k, sep) => `${k}${sep}${MARK}`),
  // keyword = bare value (also JSON numbers); the bare keyword key needs a digit in the value
  D(new RegExp(`(${ASSIGN_KW})(s?[\\w-]{0,30}[\\\\"']{0,4}\\s{0,20}${SEP}\\s{0,20})(${bare(1, 300)})`, 'gi'), (m, k, sep, v) => (/^keys?$/i.test(k) && !hasDigit(v) ? m : `${k}${sep}${MARK}`)),
  // plain language: "my password is x". Password words: any value that is not an ordinary word. Other secret words: the value needs a digit.
  D(new RegExp(`(?<![A-Za-z])(${STRONG_PW})(s?\\s{1,20}(?:is|are|was)\\s{1,20}["']?)(${bare(3, 300)})`, 'gi'), (m, k, sep, v) => (hasDigit(v) || !PROSE.has(v.toLowerCase()) ? `${k}${sep}${MARK}` : m)),
  D(new RegExp(`(?<![A-Za-z])(${SECRETISH}|keys?)(s?\\s{1,20}(?:is|are|was)\\s{1,20}["']?)(${bare(4, 300)})`, 'gi'), (m, k, sep, v) => (hasDigit(v) ? `${k}${sep}${MARK}` : m)),
  // a keyword, whitespace, then a 6+ character value with a digit: "password hunter2xyz", "pw hunter2xyz", "api key hunter2xyz", "password - hunter2xyz"
  D(new RegExp(`(?<![A-Za-z])(${STRONG_PW}|pass|${SECRETISH}|keys?)(s?\\s{1,20}(?:[-\\u2013\\u2014]+\\s{1,20})?["']?)(${bare(6, 300)})`, 'gi'), (m, k, sep, v) => (hasDigit(v) ? `${k}${sep}${MARK}` : m)),
  // a keyword joined to a value by - _ or . (password-hunter2xyz, a tool or an id built from a secret)
  D(new RegExp(`(?<![A-Za-z])(${STRONG_PW}|pass|${SECRETISH}|keys?)([-_.])([A-Za-z0-9]{6,300})`, 'gi'), (m, k, j, v) => (hasDigit(v) ? `${k}${j}${MARK}` : m)),
  D(/\b(?:bearer|basic)\s{1,5}[A-Za-z0-9._~+/=-]{6,}/gi, (m) => (hasDigit(m) || m.replace(/^\S+\s+/, '').length >= 20 ? MARK : m)),
  D(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, () => MARK),
  D(/\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|glpat|xox[abprs]|github_pat)[-_][A-Za-z0-9_-]{6,}/g, () => MARK),
  D(/\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g, () => MARK),
  D(/\bya29\.[A-Za-z0-9_-]{8,}|\bAIza[0-9A-Za-z_-]{20,}/g, () => MARK),
  // generic long opaque runs: only on text coming IN (hashes, ids and trace ids in an answer are long and legitimate)
  D(/[A-Za-z0-9_-]{20,}/g, (m) => ((hasDigit(m) && hasLetter(m) && (longestSegment(m) >= 16 || m.replace(/-/g, '').length >= 24 && /^[a-f0-9-]+$/i.test(m))) || (m.length >= 32 && !/^[a-z]+(?:-[a-z]+)+$/.test(m)) ? MARK : m), true),
  D(/[A-Za-z0-9+/_=-]{32,}/g, (m) => (/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/.test(m) || /^[a-z]+(?:-[a-z]+)+$/.test(m) ? m : MARK), true),
];

const detect = (text, generic) => DETECTORS.reduce((acc, d) => (d.generic && !generic ? acc : acc.replace(d.re, d.fn)), text);
// A second look at the text with one kind of character changed; kept only when it finds something the first look did not.
const SECOND_LOOKS = [[/[\t\n\r\u2028\u2029]/g, ''], [/\+/g, ' ']];
function maskNormalised(s, generic) {
  let out = detect(s, generic);
  for (const [re, to] of SECOND_LOOKS) { const changed = out.replace(re, to); const again = detect(changed, generic); if (again !== changed) out = again; }
  return out;
}

// Pick the deepest percent-decoding round in which something was found, mask that round. Nothing found: null.
function maskRounds(text, generic) {
  const rounds = percentRounds(flatten(text));
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const masked = maskNormalised(rounds[i], generic);
    if (masked !== rounds[i]) return masked;
  }
  return null;
}

// What a visitor typed, cleaned for storing and showing: masked, then whitespace collapsed. NOT cut to length: the caller refuses an over-long
// value instead, so a secret that straddles a limit is masked whole and nothing is silently dropped.
export function cleanInput(value) {
  const text = String(value ?? '');
  const masked = maskRounds(text, true);
  return (masked ?? flatten(text)).replace(/\s+/g, ' ').trim();
}

// For a name or an id that is echoed as-is or refused: true when it is credential-shaped (the caller refuses without echoing it).
export const looksLikeCredential = (value) => maskRounds(String(value ?? ''), true) !== null;

// An answer's text: masked only when something was found (otherwise returned untouched, line breaks and all). No generic long-run detectors.
export function maskResponseText(text) {
  const masked = maskRounds(text, false);
  return masked ?? text;
}

const put = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });

// Defence in depth: mask every string and every object KEY of an answer, iteratively (a deep structure cannot overflow the stack). A key that
// collides after masking gets a numeric suffix; nothing is dropped.
export function maskDeep(value) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const root = { v: clone(value) };
  const work = [[value, root, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop();
    if (typeof src === 'string') { put(dst, key, maskResponseText(src)); continue; }
    if (src === null || typeof src !== 'object') { put(dst, key, src); continue; }
    const copy = clone(src); put(dst, key, copy);
    const used = new Set();
    for (const k of Object.keys(src).reverse()) {
      const base = Array.isArray(src) ? k : maskResponseText(k);
      let nk = base;
      for (let n = 2; used.has(nk); n += 1) nk = `${base}~${n}`;
      used.add(nk);
      work.push([src[k], copy, nk]);
    }
  }
  return root.v;
}
