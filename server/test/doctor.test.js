import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allPassed, runChecks } from '../src/doctor.js';
import { modeFrom } from '../src/config.js';
import { DEFAULT_CAST } from '../src/cast.js';

test('every doctor check passes on a clean default environment', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const id of ['node', 'bind', 'port-range', 'scenarios', 'scored-cannot-deny', 'live-signing', 'story-tokens', 'verticals', 'diagrams', 'story-hosts', 'story-keys', 'netguard', 'tenant', 'settings-file']) {
    assert.ok(checks.some((c) => c.id === id), id);
  }
});

test('a port outside 7100-7149 fails, and a wildcard bind needs the opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '5010' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '7100', IPBLAB_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('IPB_LAB_MODE must be mock or live; mock is the default; a bare MODE (another app\'s) is ignored', async () => {
  assert.equal((await runChecks({ env: { IPB_LAB_MODE: 'prod' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { IPB_LAB_MODE: 'live' } })).find((c) => c.id === 'mode').level, 'pass');
  assert.equal((await runChecks({ env: { MODE: 'prod' } })).find((c) => c.id === 'mode').level, 'pass', 'a bare MODE is not read');
  assert.equal(modeFrom({ MODE: 'live' }), 'mock');
  assert.equal(modeFrom({ IPB_LAB_MODE: 'live', MODE: 'mock' }), 'live');
});

test('the shared settings file is reported by presence and mode, never by value', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-'));
  const f = path.join(dir, 'shared.env');
  fs.writeFileSync(f, 'IPB_LAB_MODE=live\nSOME_SECRET=hunter2-do-not-print\n', { mode: 0o600 });
  const ok = (await runChecks({ env: { STANDALONE_ENV: f } })).find((c) => c.id === 'settings-file');
  assert.deepEqual([ok.level, /mode 600/.test(ok.detail), ok.detail.includes('hunter2'), ok.detail.includes('live')], ['pass', true, false, false]);
  fs.chmodSync(f, 0o644);
  assert.match((await runChecks({ env: { STANDALONE_ENV: f } })).find((c) => c.id === 'settings-file').detail, /chmod 600/);
  const none = (await runChecks({ env: { STANDALONE_ENV: path.join(dir, 'absent.env') } })).find((c) => c.id === 'settings-file');
  assert.equal(none.level, 'info');
});

test('the doctor host scan catches a real host in the story', async () => {
  const bad = { ...DEFAULT_CAST, castBrand: 'Acme https://acme-airlines.com/x' };
  // the host scan runs on the vertical packs' own cast, so scan the brand directly as the doctor does for customer config
  const { scanHosts } = await import('../src/safety.js');
  assert.deepEqual(scanHosts(bad.castBrand), ['acme-airlines.com']);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'story-hosts').level, 'pass');
});
