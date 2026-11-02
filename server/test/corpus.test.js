// The shared-masker corpora (copied from shared-masker 9bc664a, test/corpus/): every leak probe must lose its secret in the adapter, every ordinary string must come
// out unchanged. Probes are stored as arrays of short fragments (gitleaks safety) and joined here at run time. The adapter has three ways out and all three are checked:
// cleanInput (typed text), maskResponseText (an answer's text), maskDeep (an answer, value and key position).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cleanInput, looksLikeCredential, maskDeep, maskResponseText } from '../src/mask.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus');
const leaks = JSON.parse(readFileSync(path.join(dir, 'leaks.json'), 'utf8'));
const ordinary = JSON.parse(readFileSync(path.join(dir, 'ordinary.json'), 'utf8'));
const join = (a) => a.join('');
const expand = (row) => `${row.fillBefore ? `${'a'.repeat(row.fillBefore)} ` : ''}${join(row.input)}${row.fillAfter ? ` ${'a'.repeat(row.fillAfter)}` : ''}`;
const plain = leaks.filter((r) => r.api !== 'deep');
const deep = leaks.filter((r) => r.api === 'deep');
// cleanInput also collapses whitespace and deletes control characters and bidi controls; that is the only change an ordinary string may show.
const display = (s) => s.replace(/[‎‏؜‪-‮⁦-⁩\u{E0000}-\u{E007F}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '').replace(/\s+/g, ' ').trim();

test('the corpora are the shared ones: 3754 leak probes (338 structured) and 1926 ordinary strings', () => {
  assert.equal(leaks.length, 3754);
  assert.equal(deep.length, 338);
  assert.equal(plain.length, 3416);
  assert.equal(ordinary.length, 1926);
  for (const row of [...leaks, ...ordinary]) for (const f of [...row.input, ...(row.secret || [])]) assert.ok(Array.from(f).length <= 4, row.id); // gitleaks-safe fragments
});

test('leaks.json through cleanInput and maskResponseText: the secret never survives', () => {
  const failures = [];
  for (const row of plain) {
    const input = expand(row);
    const secret = join(row.secret);
    if (cleanInput(input).includes(secret)) failures.push(`${row.id} ${row.family}/${row.enc} cleanInput`);
    if (maskResponseText(input).includes(secret)) failures.push(`${row.id} ${row.family}/${row.enc} maskResponseText`);
    if (!looksLikeCredential(input)) failures.push(`${row.id} ${row.family}/${row.enc} looksLikeCredential false`);
  }
  assert.deepEqual(failures, [], `${failures.length} of ${plain.length} failed:\n${failures.slice(0, 30).join('\n')}`);
});

test('leaks.json through maskDeep: the secret is lost in a value, in a key and in a structured probe, and the input is never mutated', () => {
  const failures = [];
  for (const row of plain) {
    const input = expand(row);
    if (input.length > 5000) continue;
    const secret = join(row.secret);
    if (JSON.stringify(maskDeep({ note: input, list: [input] })).includes(secret) || JSON.stringify(maskDeep({ [input]: 1 })).includes(secret)) failures.push(`${row.id} ${row.family}/${row.enc}`);
  }
  for (const row of deep) {
    const value = JSON.parse(join(row.input));
    const snapshot = JSON.stringify(value);
    if (JSON.stringify(maskDeep(value)).includes(join(row.secret))) failures.push(`${row.id} ${row.family}/${row.enc} deep`);
    if (JSON.stringify(value) !== snapshot) failures.push(`${row.id} mutated`);
  }
  assert.deepEqual(failures, [], failures.slice(0, 30).join('\n'));
});

test('ordinary.json: every string comes out unchanged (cleanInput: apart from whitespace collapsing), none looks like a credential', () => {
  const changed = [];
  for (const row of ordinary) {
    const input = join(row.input);
    if (row.api === 'deep') {
      const value = JSON.parse(input);
      if (JSON.stringify(maskDeep(value)) !== JSON.stringify(value)) changed.push(`${row.id} deep ${input.slice(0, 80)}`);
      continue;
    }
    if (cleanInput(input) !== display(input)) changed.push(`${row.id} cleanInput ${JSON.stringify(input)} -> ${JSON.stringify(cleanInput(input))}`);
    if (maskResponseText(input) !== input) changed.push(`${row.id} maskResponseText ${JSON.stringify(input)}`);
    if (looksLikeCredential(input)) changed.push(`${row.id} looksLikeCredential true for ${JSON.stringify(input)}`);
  }
  assert.deepEqual(changed, [], `${changed.length} of ${ordinary.length} changed:\n${changed.slice(0, 30).join('\n')}`);
});
