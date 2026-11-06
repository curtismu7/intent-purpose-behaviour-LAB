import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// index.js starts the server at import time, so it cannot be imported in a test. Pin its order instead: the shared settings
// file is read first (it names Real mode's one allowed outbound host), then the network guard is installed with that host on
// its allowlist, before the doctor runs or any server starts.
test('the entry reads the settings, then installs the netguard (with the Real-mode allowlist), before any socket', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const settings = src.indexOf('loadEnvFile(');
  const m = /installNetguard\(/.exec(src);
  assert.ok(m, 'installNetguard() is called');
  const guard = m.index;
  assert.ok(settings !== -1 && settings < guard, 'the settings file is read before the guard (the allowlist needs its host)');
  for (const later of ['runChecks()', 'startHttpServer({']) assert.ok(src.indexOf(later) > guard, `${later} comes after the guard`);
  assert.ok(src.indexOf('import { installNetguard }') < guard);
});
