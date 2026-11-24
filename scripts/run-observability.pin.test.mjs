// Rule 27: the vendored shared/run-observability files match web/src/run-observability/run-observability.sha256 byte for byte.
// They come from curtismu7/AI-DEMO-Standalone shared/run-observability: change them there, re-pin, re-vendor; never edit them here.
// This lab reads no logs (Real is the lab's own engine, shown as response rows), so it vendors the core only: no runObservabilityReaders.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPin } from './run-observability-checkPin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('every vendored run-observability file matches its pin, and the core is present', () => {
  assert.deepEqual(checkPin(root), []);
});

test('an edited vendored byte and a file the pin does not name are each caught', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-pin-'));
  try {
    for (const p of ['web/src/run-observability', 'server/src/runObservability.js']) fs.cpSync(path.join(root, p), path.join(copy, p), { recursive: true });
    assert.deepEqual(checkPin(copy), [], 'an untouched copy is fine');
    const css = path.join(copy, 'web/src/run-observability/run-observability.css');
    fs.appendFileSync(css, ' ');
    assert.ok(checkPin(copy).length > 0, 'one added byte');
    fs.writeFileSync(css, read('web/src/run-observability/run-observability.css'));
    fs.writeFileSync(path.join(copy, 'web/src/run-observability/extra.js'), 'export {};\n');
    assert.ok(checkPin(copy).some((m) => /extra\.js/.test(m)), 'a file beside the vendored ones that the pin does not name');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('compose, the example settings and the Dockerfile never mount the Docker socket and carry no run-observability setting', () => {
  for (const f of ['docker-compose.yml', '.env.example', 'Dockerfile']) {
    assert.ok(!/docker\.sock/.test(read(f)), `${f}: no Docker socket`);
    assert.ok(!/RUN_OBS_/.test(read(f)), `${f}: no reader settings`);
  }
});

// The files of a lab (its web and server source) that carry a RUN_OBS_ name. The one exemption is the vendored core, by exact path.
function runObsNameHits(labRoot) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === 'node_modules' || d.name === 'run-observability' ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)]));
  const core = path.join(labRoot, 'server/src/runObservability.js');
  const files = [...walk(path.join(labRoot, 'web/src')), ...walk(path.join(labRoot, 'server/src'))];
  return files.filter((f) => f !== core && /RUN_OBS_/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(labRoot, f));
}

test('no lab file outside the vendored files carries the RUN_OBS_ prefix (the web code included)', () => {
  assert.deepEqual(runObsNameHits(root), []);
});

test('the core is exempt by exact path only: a file with the same name in another folder is still scanned', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ipb-name-'));
  try {
    fs.mkdirSync(path.join(copy, 'web/src'), { recursive: true });
    fs.mkdirSync(path.join(copy, 'server/src/nested'), { recursive: true });
    fs.writeFileSync(path.join(copy, 'server/src/runObservability.js'), 'export {};\n');
    fs.writeFileSync(path.join(copy, 'server/src/nested/runObservability.js'), 'const x = "RUN_OBS_LOG";\n');
    assert.deepEqual(runObsNameHits(copy), [path.join('server', 'src', 'nested', 'runObservability.js')]);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
