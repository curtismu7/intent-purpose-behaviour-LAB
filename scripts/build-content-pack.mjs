// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const UNV = 'Ping release claim, UNVERIFIED on our tenant.';

export function buildPack() {
  const story = buildStory(DEFAULT_CAST, 'finance');
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = {
    'legit-lookup': ['three-signals'], 'bulk-export': ['intent', 'deterministic-tier'], 'payee-change': ['intent', 'deterministic-tier'],
    'reworded-payee': ['intent', 'scored-tier', 'human-in-the-loop'], 'outside-purpose': ['purpose', 'deterministic-tier'], 'no-purpose': ['purpose', 'deterministic-tier'],
    'drift-alert': ['behaviour', 'scored-tier'], 'new-agent': ['behaviour', 'baseline'],
  };
  return {
    schema: 'demo-content-pack/1',
    id: 'intent-purpose-behaviour-lab',
    title: 'Intent, Purpose and Behaviour Lab',
    version,
    demo: { id: 'intent-purpose-behaviour-lab', name: 'Intent, Purpose and Behaviour Lab', catalog: 'D0', baseUrl: 'http://localhost:7100', doctor: '/api/health', tags: ['mcp', 'agent', 'policy', 'privilege', 'on-behalf-of', 'id-jag', 'simulated'] },
    glossary: [
      { id: 'three-signals', term: 'Three signals, not one score', definition: `Intent (what is being attempted), purpose (was it ever in scope) and behaviour (does this agent do this) are asked of every call and kept separate, so a policy can say which one fired. ${UNV}`, aliases: ['intent purpose behaviour'] },
      { id: 'intent', term: 'Intent', definition: `Classifies what a request is actually trying to do (exfiltrate data, change a payee, look up one record) rather than what it literally says, combining deterministic patterns with semantic similarity. In this lab the similarity is a word-overlap stand-in. ${UNV}`, aliases: ['AIIntent'] },
      { id: 'purpose', term: 'Purpose', definition: `Each agent key declares what it exists to do. Policy can refuse calls outside the declaration, calls that break one axis of it, or calls from a key that declares nothing. Field names (PurposeProfile: Statement, Methods, Targets, Apps, ArgPrefixes) are from the console swagger of 2026-10-31, schema only. ${UNV}`, aliases: ['PurposeProfile'] },
      { id: 'behaviour', term: 'Behaviour', definition: `The gateway learns each agent's normal pattern of calls and scores how far a request departs from it. Scoring starts after MinObservations and enforcing after EnforceObservations (console swagger names, schema only). ${UNV}`, aliases: ['BehaviourConfig', 'anomaly'] },
      { id: 'baseline', term: 'Baseline', definition: `What an agent normally does. Enforcement starts only once it is established, so a new agent is never blocked for being new. ${UNV}`, aliases: ['MinObservations', 'EnforceObservations'] },
      { id: 'deterministic-tier', term: 'Deterministic tier', definition: `Pattern matches and purpose findings. The only tier that can hard-refuse. ${UNV}`, aliases: ['hard refusal'] },
      { id: 'scored-tier', term: 'Scored tier', definition: `The similarity score and the behaviour anomaly. They drive alerts and human-in-the-loop approval and never silently become the enforcement decision. ${UNV}`, aliases: [] },
      { id: 'human-in-the-loop', term: 'Ask a person (human in the loop)', definition: 'The call is held for a person to approve. It is neither blocked nor silently allowed.', aliases: ['HITL', 'approval'] },
      { id: 'on-behalf-of', term: 'On-behalf-of', definition: `The gateway swaps the caller's verified token (RFC 8693) for one minted for the downstream MCP server, so the backend validates a token issued to it. The act claim preserves who the original caller was. In Live mode the lab signs and verifies real RS256 tokens locally. ${UNV}`, aliases: ['OBO', 'token exchange', 'RFC 8693'] },
      { id: 'id-jag', term: 'ID-JAG (identity assertion grant)', definition: `Where the target application trusts a different identity provider, the exchange returns an identity assertion grant that the gateway redeems at that application's own issuer. No shared credential and no re-consent. ${UNV}`, aliases: ['assertion grant', 'Redeem'] },
    ],
    sources: [
      { id: 'deck-slide-48', title: 'Ping ID4AI Workforce H2 2026 deck, slide 48: Intent, Purpose and Behaviour', url: 'https://example.invalid/ping-id4ai-workforce-h2-2026-deck', kind: 'deck', use: 'The three signals and the on-behalf-of and ID-JAG release claims.', status: 'read', checked: '2026-10-31' },
      { id: 'console-swagger', title: 'Privilege console swagger, 2026-10-31 (schema only)', url: 'https://example.invalid/privilege-console-swagger', kind: 'schema', use: 'Field names for AIIntent, PurposeProfile, BehaviourConfig and OBO. It proves names exist, not behaviour.', status: 'read', checked: '2026-10-31' },
      { id: 'rfc8693', title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693', kind: 'standard', use: 'The exchange request and the act claim.', status: 'not-read', checked: '2026-10-31' },
      { id: 'rfc8707', title: 'RFC 8707: Resource Indicators for OAuth 2.0', url: 'https://www.rfc-editor.org/rfc/rfc8707', kind: 'standard', use: 'The resource parameter that becomes the exchanged token audience.', status: 'not-read', checked: '2026-10-31' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Call ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'try-baseline', label: 'Baseline: an agent builds its normal', description: 'Enforcement is off until the baseline is established; then an out-of-pattern call asks a person.', group: 'try-it', action: { type: 'route', href: '/#baseline' }, terms: ['baseline', 'behaviour'] },
      { id: 'try-obo', label: 'On-behalf-of: a token for the MCP server', description: 'Real local RFC 8693 exchange in Live mode, with failure cases.', group: 'try-it', action: { type: 'route', href: '/#obo' }, terms: ['on-behalf-of'] },
      { id: 'try-idjag', label: 'ID-JAG: two issuers, no shared credential', description: 'The user IdP issues a grant, the partner issuer redeems it.', group: 'try-it', action: { type: 'route', href: '/#idjag' }, terms: ['id-jag'] },
      { id: 'concept-diagram', label: 'Diagrams', description: 'Three diagrams: the signals, on-behalf-of and ID-JAG.', group: 'concept', action: { type: 'route', href: '/#diagram' }, terms: ['three-signals'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
