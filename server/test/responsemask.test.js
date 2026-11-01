// The response mask (maskDeep) is a second layer: it must leave the app's own, legitimate answers byte-for-byte alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { maskDeep } from '../src/mask.js';
import { BASELINE_KINDS, SCENARIOS } from '../src/data.js';

test('the response mask changes nothing in any scripted answer: every scenario, vertical and mode, baseline, hops and all', async () => {
  await withServer(async (url) => {
    const post = (path, b) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(b) }).then((r) => r.json());
    let checked = 0;
    for (const vertical of ['finance', 'health', 'retail']) {
      for (const mode of ['mock', 'live']) {
        for (const s of SCENARIOS) {
          const j = await post('/api/evaluate', { mode, vertical, scenario: s.id });
          assert.ok(j.hops, `${vertical} ${mode} ${s.id}`);
          assert.deepEqual(maskDeep(j), j, `${vertical} ${mode} ${s.id}`); checked += 1;
        }
      }
      assert.deepEqual(maskDeep(await post('/api/baseline', { mode: 'mock', vertical })), await post('/api/baseline', { mode: 'mock', vertical }));
      for (const kind of BASELINE_KINDS) { const j = await post('/api/baseline', { mode: 'live', vertical, kind }); assert.deepEqual(maskDeep(j), j, kind); checked += 1; }
      const g = await (await fetch(`${url}/api/baseline?mode=live&vertical=${vertical}`)).json();
      assert.deepEqual(maskDeep(g), g);
    }
    assert.ok(checked >= 6 * 8 + 3 * BASELINE_KINDS.length, `only ${checked} answers were compared`);
    const dump = JSON.stringify(await post('/api/evaluate', { mode: 'live', scenario: 'bulk-export' }));
    assert.ok(dump.includes('Authorization: Bearer <MOCK-ISSUED token>'));
  });
});
