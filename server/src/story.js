import { fillDeep, VERTICALS } from './cast.js';
import { BANNER, BASELINE_KINDS, BASELINE_KIND_TITLES, BASELINE_SCRIPT, CLAIMS, CLAIM_LABEL, FIELD_SOURCE, FIELD_SOURCE_LAB, INTENTS, INTENT_CONFIG, PURPOSE_PROFILE, INTRO, RELEASE, SCENARIOS, TALK_TRACK, TITLE } from './data.js';
import { IDJAG_SCENARIOS, OBO_SCENARIOS } from './oauth.js';
import { DEFAULT_POLICY, SWAGGER_FIELDS } from './policy.js';

export const rawStory = () => ({ title: TITLE, intro: INTRO, banner: BANNER, claims: CLAIMS, purposeProfile: PURPOSE_PROFILE, intents: INTENTS, intentConfig: INTENT_CONFIG, scenarios: SCENARIOS, talkTrack: TALK_TRACK, baselineTitles: BASELINE_KIND_TITLES });

// The story with the cast filled in. Tokens shown in the UI are mock-issued teaching values (rule 4).
export function buildStory(cast, vertical) {
  const s = fillDeep(rawStory(), cast);
  return {
    title: s.title, intro: s.intro, release: RELEASE, claimLabel: CLAIM_LABEL, banner: s.banner,
    claims: s.claims, purposeProfile: s.purposeProfile, intents: s.intents, intentConfig: s.intentConfig, fieldSource: FIELD_SOURCE, fieldSourceLab: FIELD_SOURCE_LAB, swaggerFields: SWAGGER_FIELDS, policyDefaults: structuredClone(DEFAULT_POLICY),
    scenarios: s.scenarios.map(({ id, title, lesson, agent, declares, call, expected }) => ({ id, title, lesson, agent, declares, call, expected })),
    baseline: { kinds: BASELINE_KINDS, titles: s.baselineTitles, script: BASELINE_SCRIPT },
    obo: OBO_SCENARIOS, idjag: IDJAG_SCENARIOS,
    talkTrack: s.talkTrack, cast, vertical, verticals: Object.keys(VERTICALS),
  };
}

// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
export function renderTalkTrackMarkdown(cast) {
  const s = buildStory(cast, 'finance');
  const parts = ['# Talk track', '', '<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->', '', `> ${s.claimLabel}: every product claim here comes from the Ping ID4AI Workforce H2 2026 deck (release ${s.release}).`, ''];
  for (const t of s.talkTrack) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## The eight calls on the Three signals tab', '');
  s.scenarios.forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}** (${sc.expected} with the default policy). ${sc.lesson}`));
  return `${parts.join('\n')}\n`;
}
