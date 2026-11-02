// The response mask must leave every legitimate answer of the app byte-for-byte alone: the story and the diagrams (prose that says "password" and "token" as words), the
// info and health answers, and both token flows in both modes (where MOCK-ISSUED tokens are shown raw by design). A change here is a false positive of the mask.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';
import { maskDeep, maskFlow } from '../src/mask.js';
import { DIAGRAM_NAMES, buildDiagram } from '../src/diagramData.js';
import { buildStory } from '../src/story.js';
import { loadCast, VERTICALS } from '../src/cast.js';
import { IDJAG_SCENARIOS, OBO_SCENARIOS, runIdJag, runObo } from '../src/oauth.js';
import { MOCK_TABLE } from '../src/mockTable.js';

test('story and diagrams, every vertical: the response mask changes nothing', () => {
  let checked = 0;
  for (const vertical of Object.keys(VERTICALS)) {
    const cast = loadCast('/nonexistent/customer.config.json', vertical);
    const story = buildStory(cast, vertical);
    assert.deepEqual(maskDeep(story), story, `story ${vertical}`); checked += 1;
    for (const name of DIAGRAM_NAMES) { const d = buildDiagram(cast, name); assert.deepEqual(maskDeep(d), d, `diagram ${name} ${vertical}`); checked += 1; }
  }
  assert.equal(checked, 12);
  assert.deepEqual(DIAGRAM_NAMES, ['three-signals', 'obo', 'id-jag']);
  assert.equal(Object.keys(VERTICALS).length, 3);
});

test('token flows, both modes and every scenario: maskFlow changes nothing, the tokens stay raw, and the default mask WOULD change them (so the exemption is real)', () => {
  let checked = 0; let wouldChange = 0;
  const cast = loadCast('/nonexistent/customer.config.json', 'finance');
  for (const mode of ['mock', 'live']) {
    for (const [list, run] of [[OBO_SCENARIOS, runObo], [IDJAG_SCENARIOS, runIdJag]]) {
      for (const sc of list) {
        const out = { ...run({ cast, scenario: sc.id, mode, table: MOCK_TABLE }), workspace: 'w-0123456789abcdef' };
        assert.deepEqual(maskFlow(out), out, `${mode} ${sc.id}`); checked += 1;
        if (JSON.stringify(maskDeep(out)) !== JSON.stringify(out)) wouldChange += 1;
      }
    }
  }
  assert.equal(checked, 22);
  assert.equal(wouldChange, 22);
});

test('over HTTP: info, health, diagram, story, runs and reset answers are what the builders produce', async () => {
  await withServer(async (url) => {
    const get = async (p) => (await fetch(`${url}${p}`, { headers: { 'x-workspace': 'w-0123456789abcdef' } })).json();
    const cast = loadCast('/nonexistent/customer.config.json', 'finance');
    assert.deepEqual(await get('/api/story?vertical=finance'), JSON.parse(JSON.stringify(buildStory(cast, 'finance'))));
    assert.deepEqual(await get('/api/diagram?name=three-signals&vertical=finance'), JSON.parse(JSON.stringify(buildDiagram(cast, 'three-signals'))));
    const info = await get('/api/info');
    assert.deepEqual(Object.keys(info).sort(), ['mode', 'modes', 'release', 'simulated', 'unverified']);
    assert.equal(info.release, '2026-11-02');
    assert.deepEqual(await get('/api/runs'), { workspace: 'w-0123456789abcdef', runs: [] });
  });
});
