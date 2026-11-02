import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/content-pack.schema.json', 'scripts/build-mock-table.mjs', 'docs/shelf-entry.json', 'customer.config.example.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the shelf entry is valid and portable: relative composeFile, loopback url, health path', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'intent-purpose-behaviour-lab');
  assert.equal(e.kind, 'Demo');
  assert.equal(e.healthPath, '/api/health');
  assert.match(e.url, /^http:\/\/localhost:71\d\d$/);
  assert.equal(e.catalogId, 'D101', 'catalog id assigned 2026-10-31 (owner delegated the choice)');
  assert.equal(e.composeFile, 'intent-purpose-behaviour-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(e.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\//.test(JSON.stringify(e)), 'no absolute home path');
});

test('customer.config.json is git-ignored, and its example only sets the three cast values', () => {
  assert.match(read('.gitignore'), /^customer\.config\.json$/m);
  assert.deepEqual(Object.keys(JSON.parse(read('customer.config.example.json')).cast).sort(), ['agentId', 'brand', 'host']);
});

test('no shipped text names a real customer, company or tenant', () => {
  // server/test/corpus holds the shared masker's probe strings (random-looking fragments; 'uhg' occurs inside one): it is test data, not shipped text.
  const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json', 'corpus']);
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (!['repo.test.mjs', 'story.test.js', 'content-pack.test.mjs'].some((n) => p.endsWith(n))) {
        const t = fs.readFileSync(p, 'utf8').toLowerCase();
        for (const w of ['united airlines', 'mileageplus', 'datapower', 'optum', 'unitedhealth', 'uhg', 'member benefit', 'personal-agent', 'personal agent']) if (t.includes(w)) hits.push(`${path.relative(root, p)}: ${w}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /forbidden-strings:/);
  assert.match(ci, /gitleaks/);
});

test('package.json requires Node 26 and the Dockerfile uses a Node 26 base', () => {
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26');
  assert.ok((read('Dockerfile').match(/^FROM node:26/gm) || []).length === 2);
});

test('README follows the README standard, and the docs never use the word "door"', () => {
  const readme = read('README.md');
  assert.match(readme.split('\n')[0], /^# .* LAB$/);
  assert.match(readme, /^Tier: Demo$/m);
  assert.match(readme, /^Repo: https:\/\/github\.com\/ping-sandbox\/intent-purpose-behaviour-LAB$/m);
  for (const h of ['## What is simulated', '## Run from a clone', '## Settings file', '## Ports, and what to do if the port is taken', '## Mock and live modes', '## Health, doctor and reset', '## Docker (optional)', '## Tests', '## Troubleshooting', '## Ownership']) assert.ok(readme.includes(h), h);
  for (const f of ['README.md', 'CLAUDE.md', 'docs/talk-track.md', 'docs/safety.md']) assert.ok(!/\bdoor\b/i.test(read(f)), f);
});
