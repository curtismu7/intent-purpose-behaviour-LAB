// Story data. Every string may carry {{cast}} tokens; cast.js fills them from a vertical pack. All claims about the product are
// "Ping release claim, UNVERIFIED on our tenant": the 2026-11-02 release is not on our tenant. Shapes marked INVENTED are the lab's own.
export const TITLE = 'Intent, Purpose and Behaviour Lab';
export const RELEASE = '2026-11-02';
export const CLAIM_LABEL = 'Ping release claim, UNVERIFIED on our tenant';
export const INTRO = 'Three signals are asked of every call, deliberately not one score: what a request is trying to do (intent), whether this agent was ever issued for it (purpose), and whether this agent normally does this (behaviour). Source: the Ping ID4AI Workforce H2 2026 deck, slide 48. Nothing here has been run against a real gateway.';

export const BANNER = {
  mock: `SIMULATED, MOCK mode: pure in-process tables. Every product claim is a ${CLAIM_LABEL} (release ${RELEASE}). Nothing here calls a real gateway, identity provider or tenant.`,
  live: `SIMULATED, LIVE mode: a local real engine (real RS256 signing with a key generated in this process, real verification, real baseline learning), loopback only, zero outbound network. Every product claim is a ${CLAIM_LABEL} (release ${RELEASE}). Nothing here calls a real gateway, identity provider or tenant.`,
};

export const CLAIMS = [
  { id: 'three-signals', claim: 'Three signals asked of every call, deliberately not one score: intent, purpose, behaviour.' },
  { id: 'intent', claim: 'Intent classifies what a request is actually trying to do rather than what it literally says, combining deterministic patterns with semantic similarity. A policy can refuse on a pattern match, or alert / ask a person above a similarity score.' },
  { id: 'purpose', claim: 'Each agent key declares what it exists to do. Policy can refuse calls outside that declaration, calls that violate a specific axis of it, or calls from a key that declares no purpose.' },
  { id: 'behaviour', claim: 'The gateway learns each agent\'s normal pattern of calls and scores how far a request departs from it. Enforcement starts only once a baseline is established, so a new agent is never blocked for being new.' },
  { id: 'tiers', claim: 'Hard refusals rest on the deterministic tier; the scored signals drive alerts and human-in-the-loop approval. A model\'s judgement never silently becomes the enforcement decision.' },
  { id: 'obo', claim: 'On-behalf-of (new): the gateway swaps the caller\'s verified token (RFC 8693) for one minted for the downstream MCP server, so the backend validates a token issued to it rather than trusting a shared service account. The act claim preserves who the original caller was.' },
  { id: 'id-jag', claim: 'ID-JAG (new): where the target application trusts a different identity provider, the exchange returns an identity assertion grant that the gateway redeems at that application\'s own issuer. The end user\'s identity reaches a third-party app whose IdP you do not control, with no shared credential and no re-consent.' },
];

export const FIELD_SOURCE = 'field names from the console swagger, 2026-10-31 (schema only; behaviour not tested on our tenant)';
export const FIELD_SOURCE_LAB = 'invented by the lab (the console schema has no such field)';

// AIIntent objects: the field names {Description, Exemplars, Twins, Patterns, Acts, Floor} are from the console swagger (schema only).
// What the product does with them is UNVERIFIED. The lab uses Patterns (in its own tiny syntax, see intent.js), Exemplars (the words
// of the exemplar phrases are the similarity lexicon) and Floor. Twins and Acts are shown but not interpreted: the schema does not
// say what they mean.
export const INTENTS = {
  'exfiltrate-data': {
    Description: 'Moves many records, or any data, out of the system',
    Exemplars: ['export all {{castNouns}} for offline analysis', 'send every record to an external location', 'download the whole dataset', 'dump all of the data and copy it out', 'extract bulk records'],
    Twins: ['export one {{castNoun}} as a PDF for the person who asked'],
    Patterns: ['seg:export|dump|download|extract', 'records>=500', 'arg:destination'],
    Acts: true, Floor: 0.25,
  },
  'change-payee': {
    Description: 'Changes where money is paid',
    Exemplars: ['change the bank account where a supplier is paid', 'redirect the payment to a new account', 'update the payee remittance details', 'send the refund or payment to a new provider account', 'set the beneficiary iban'],
    Twins: ['look up the payee name on one {{castNoun}}'],
    Patterns: ['seg:payee|payees|beneficiary|destination|payout|payment|payments|remittance+seg:update|change|set|replace|add'],
    Acts: true, Floor: 0.25,
  },
  'lookup-single-record': {
    Description: 'Reads one record',
    Exemplars: ['look up the status of one record', 'check a single record', 'show me one entry', 'get and read one record'],
    Twins: [],
    Patterns: [],
    Acts: false, Floor: 0.25,
  },
};
// AIIntentConfig, per application: the encoder is shown but not used (the lab's similarity is in-process word overlap).
export const INTENT_CONFIG = { Encoder: { URL: 'https://encoder.{{castHost}}.example/embed', TimeoutMS: 800, FailClosed: false }, Disabled: false, IntentIDs: ['exfiltrate-data', 'change-payee', 'lookup-single-record'] };

// The agent key's PurposeProfile: field names from the console swagger (schema only). Apps is declared but not evaluated by the lab.
export const PURPOSE_PROFILE = {
  Statement: '{{castPurpose}}',
  Methods: ['{{castNouns}}.lookup', '{{castNouns}}.match', '{{castNouns}}.annotate', '{{castNouns}}.escalate'],
  Targets: ['{{castNouns}}'],
  Apps: ['{{castNouns}}-mcp'],
  ArgPrefixes: { record: ['{{castPrefix}}-'] },
};

const EXPORT_ARGS = { limit: 5000, format: 'csv', destination: 'https://files.{{castHost}}.example/out' };
export const SCENARIOS = [
  { id: 'legit-lookup', title: 'A legitimate lookup', agent: '{{castAgentId}}', declares: true, seed: 24,
    call: { tool: '{{castNouns}}.lookup', description: 'look up the status of one {{castNoun}}', args: { record: '{{castPrefix}}-1003' } },
    expected: 'allow',
    lesson: 'In scope, an ordinary pattern for this agent, and nothing in the request looks like exfiltration or a payee change. All three signals are quiet and the call goes through.' },
  { id: 'bulk-export', title: 'A bulk export', agent: '{{castAgentId}}', declares: true, seed: 24,
    call: { tool: '{{castNouns}}.export', description: 'export all {{castNouns}} for offline analysis', args: EXPORT_ARGS },
    expected: 'deny',
    lesson: 'The deterministic intent pattern matches a bulk export, and the call is also outside the declared purpose. Both are hard-refusal tiers: the refusal does not depend on any score.' },
  { id: 'payee-change', title: 'A payee change (the literal tool)', agent: '{{castAgentId}}', declares: true, seed: 24,
    call: { tool: '{{castPayeeTool}}', description: '{{castPayeeText}}', args: { payee: 'PAY-0042', account: 'ACC-9001' } },
    expected: 'deny',
    lesson: 'The tool name itself says it changes where money goes. A deterministic pattern refuses it, and it is not part of the declared purpose either.' },
  { id: 'reworded-payee', title: 'A payee change that avoids the obvious tool', agent: '{{castAgentId}}', declares: true, seed: 24,
    call: { tool: '{{castNouns}}.annotate', description: '{{castReword}}', args: { record: '{{castPrefix}}-1002', note: 'new account' } },
    expected: 'ask',
    lesson: 'An in-scope tool, a usual argument shape, no pattern match. But what the text asks for is close to "change a payee". The similarity score is high, so the call is held for a person. It is not denied: a score never denies.' },
  { id: 'outside-purpose', title: 'A harmless call outside the declared purpose', agent: '{{castAgentId}}', declares: true, seed: 24,
    call: { tool: '{{castOutsideNouns}}.lookup', description: 'look up one {{castOutsideNouns}} record', args: { record: 'REC-0077' } },
    expected: 'deny',
    lesson: 'Intent is a single-record lookup, which is benign. But this key was issued for {{castPurpose}}, and this tool is outside that. Purpose turns the declaration into something enforceable.' },
  { id: 'no-purpose', title: 'A key that declares no purpose', agent: '{{castAgentId}}-legacy', declares: false, seed: 24,
    call: { tool: '{{castNouns}}.lookup', description: 'look up the status of one {{castNoun}}', args: { record: '{{castPrefix}}-1003' } },
    expected: 'deny',
    lesson: 'The same harmless call, from a key that was never given a purpose. Policy can refuse any call from such a key; here it does. Turn that switch off in the policy and it becomes an alert.' },
  { id: 'drift-alert', title: 'In scope, but unlike this agent', agent: '{{castAgentId}}', declares: true, seed: 24,
    call: { tool: '{{castNouns}}.lookup', description: 'look up the archived {{castNoun}} with its full history', args: { record: '{{castPrefix}}-0007', include_history: true } },
    expected: 'alert',
    lesson: 'Allowed by purpose and not a risky intent, but the target was never touched and the argument shape was never used. Behaviour scores the departure and raises an alert; the call goes through.' },
  { id: 'new-agent', title: 'A new agent is never blocked for being new', agent: '{{castAgentId}}-new', declares: true, seed: 3,
    call: { tool: '{{castNouns}}.annotate', description: 'add a note to one {{castNoun}}', args: { record: '{{castPrefix}}-0555', note: 'checked' } },
    expected: 'allow',
    lesson: 'This agent has made three calls, fewer than MinObservations, so nothing is scored yet. The departure would have been high, and the call is allowed anyway, with the reason code ALLOW-LEARNING.' },
];

// The agent's normal history: lookups and matches over eight records, an annotate now and then. Deterministic.
export function seedCalls(cast, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const record = `${cast.castPrefix}-100${i % 8}`;
    if (i % 7 === 6) out.push({ tool: `${cast.castNouns}.annotate`, description: '', args: { record, note: 'ok' } });
    else if (i % 5 === 4) out.push({ tool: `${cast.castNouns}.match`, description: '', args: { record, candidate: `PAY-10${i}` } });
    else out.push({ tool: `${cast.castNouns}.lookup`, description: '', args: { record } });
  }
  return out;
}

// The baseline timeline (tab 2). Each step is a kind of call; the Live tab fires the same kinds on demand.
export const BASELINE_KINDS = ['normal', 'new-tool', 'new-target', 'drift', 'heavy', 'bulk-export'];
export const BASELINE_SCRIPT = ['normal', 'normal', 'normal', 'new-tool', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'heavy', 'normal', 'drift', 'normal', 'bulk-export'];
export const BASELINE_KIND_TITLES = {
  normal: 'A normal call', 'new-tool': 'A tool this agent never used', 'new-target': 'A record never touched',
  drift: 'A new target and a new argument shape', heavy: 'A large read on a new target', 'bulk-export': 'A bulk export',
};

// The call for a baseline step. `i` is a counter so "normal" walks the agent's usual records.
export function baselineCall(cast, kind, i = 0) {
  const p = cast.castPrefix; const n = cast.castNouns;
  switch (kind) {
    case 'normal': return i % 5 === 4
      ? { tool: `${n}.match`, description: `match one ${cast.castNoun} to its payment`, args: { record: `${p}-100${i % 8}`, candidate: `PAY-10${i}` } }
      : { tool: `${n}.lookup`, description: `look up the status of one ${cast.castNoun}`, args: { record: `${p}-100${i % 8}` } };
    case 'new-tool': return { tool: `${n}.escalate`, description: `escalate one ${cast.castNoun} for review`, args: { record: `${p}-1001`, reason: 'review' } };
    case 'new-target': return { tool: `${n}.lookup`, description: `look up the status of one ${cast.castNoun}`, args: { record: `${p}-0${100 + i}` } };
    case 'drift': return { tool: `${n}.lookup`, description: `look up the archived ${cast.castNoun} with its full history`, args: { record: `${p}-0007`, include_history: true } };
    case 'heavy': return { tool: `${n}.lookup`, description: `read a page of ${n}`, args: { record: `${p}-0008`, limit: 80 } };
    case 'bulk-export': return { tool: `${n}.export`, description: `export all ${n} for offline analysis`, args: { limit: 5000, format: 'csv', destination: `https://files.${cast.castHost}.example/out` } };
    default: return null;
  }
}

export const TALK_TRACK = [
  { id: 'say-first', title: 'Say this first', say: 'Everything on this page is simulated, and every product claim is a Ping release claim, unverified on our tenant: the 2026-11-02 release is not there yet. The point is the shape of the idea: three questions asked of every call, kept separate on purpose, instead of one risk score.' },
  { id: 'three-signals', title: 'Three signals, not one score', say: 'Intent asks what the request is trying to do, whatever it literally says. Purpose asks whether this agent key was ever issued for it. Behaviour asks whether this agent normally does this. A single score would hide which of the three fired, and you could not write a policy that says "refuse this, but only ask a person about that".' },
  { id: 'tiers', title: 'Hard refusals are deterministic', say: 'Only the deterministic tier can say no: a pattern match, or a purpose finding. The scored signals, the similarity score and the behaviour anomaly, alert or ask a person. Try to edit the policy so a score denies: the lab refuses it. A model\'s judgement never silently becomes the enforcement decision.' },
  { id: 'intent', title: 'Intent', say: 'Patterns catch the obvious: a bulk export, a tool that changes a payee. Similarity catches the reworded version that avoids those tool names. In the lab the similarity is a word-overlap stand-in, labelled invented; the product uses semantic similarity, which we have not measured.' },
  { id: 'purpose', title: 'Purpose', say: 'The key says what it exists to do, for example {{castPurpose}}. Policy can refuse calls outside that, calls that break one axis of it, such as how many records, or any call from a key that declares nothing. That turns a sentence in documentation into something enforceable.' },
  { id: 'behaviour', title: 'Behaviour', say: 'The gateway learns what normal looks like for each agent. A new agent has no baseline, so nothing is enforced: it is never blocked for being new. After MinObservations calls the lab starts scoring, after EnforceObservations it enforces. Once the baseline is established, an out-of-pattern call scores high and raises an alert or asks a person. It is never a silent block.' },
  { id: 'obo', title: 'On-behalf-of', say: 'The gateway swaps the caller\'s verified token for one minted for the downstream MCP server, using RFC 8693. The backend checks a token issued to it, not a shared service account, and the act claim says who the original caller was. In Live mode this is real signing and real verification on your machine; the tokens are mock-issued and shown raw.' },
  { id: 'id-jag', title: 'ID-JAG', say: 'When the target app trusts a different identity provider, the exchange returns an identity assertion grant and the gateway redeems it at that app\'s own issuer. The user\'s identity arrives at an app whose IdP you do not control, with no shared credential and no consent prompt. For the standalone ID-JAG walkthrough, see the sibling id-jag-standalone-LAB; this lab does not import from it.' },
  { id: 'why-it-matters', title: 'Why it matters', say: 'The challenge: a tool name and its arguments say what was asked for, but not what it was really for, whether this agent was ever meant to do it, or whether it normally does. Technical value, per the Ping deck (slide 48): three separable signals. Deterministic intent patterns and purpose declarations refuse hard; learned behaviour baselines drive alerts and approval. Business value, per the same slide: the enforceable declaration "this agent exists to reconcile invoices" unblocks unattended agents in processes that could not otherwise approve them. These are Ping claims, not measured by us.' },
  { id: 'unverified', title: 'What is not proven', say: 'None of the product behaviour here has been run on our tenant. The signal names and their one-line descriptions come from the Ping deck. The field names for intents, purpose, behaviour and on-behalf-of come from the Privilege console swagger of 2026-10-31, which is schema only: it proves the names exist, not how they behave. Reason codes, scoring points, the pattern syntax, the similarity stand-in, the alert and ask thresholds and the refusal switches are invented by the lab. Say so if asked.' },
];
