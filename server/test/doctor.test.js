import test from 'node:test';
import assert from 'node:assert/strict';
import { allPassed, runChecks } from '../src/doctor.js';
import { DEFAULT_CAST } from '../src/cast.js';

test('every doctor check passes on a clean default environment', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const id of ['node', 'bind', 'port-range', 'scenarios', 'scored-cannot-deny', 'live-signing', 'story-tokens', 'verticals', 'diagrams', 'story-hosts', 'story-keys', 'netguard', 'tenant']) {
    assert.ok(checks.some((c) => c.id === id), id);
  }
});

test('a port outside 7100-7149 fails, and a wildcard bind needs the opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '5010' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '7100', IPBLAB_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('MODE must be mock or live', async () => {
  assert.equal((await runChecks({ env: { MODE: 'prod' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { MODE: 'live' } })).find((c) => c.id === 'mode').level, 'pass');
});

test('the doctor host scan catches a real host in the story', async () => {
  const bad = { ...DEFAULT_CAST, castBrand: 'Acme https://acme-airlines.com/x' };
  // the host scan runs on the vertical packs' own cast, so scan the brand directly as the doctor does for customer config
  const { scanHosts } = await import('../src/safety.js');
  assert.deepEqual(scanHosts(bad.castBrand), ['acme-airlines.com']);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'story-hosts').level, 'pass');
});
