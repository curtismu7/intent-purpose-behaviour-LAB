// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: "A simulation of the 'Intent, Purpose and Behaviour' release claims plus the two token flows marked new in the same release: three signals asked of every call, on-behalf-of, and ID-JAG. One thing here IS measured: the Intent catalogue tab is a snapshot of the local Privilege console's own GET /v1/aiintents (2026-11-18, sanitised) — those 25 built-in intents, their exemplars, twins, regex patterns, Acts and Floor are the console's, not the deck's. Everything else runs in this process. Nothing calls a real gateway, identity provider or tenant, and nothing leaves your machine."
  },
  {
    heading: "Measured vs UNVERIFIED",
    body: [
      "MEASURED: the intent catalogue (25 console intents, 2026-11-18) and the mock table, which is generated from the lab's own engine — a doctor check and a test fail if it drifts.",
      "SIMULATED: tokens carry a placeholder signature; every check result in Mock mode comes from a table; the similarity signal is a word-overlap stand-in where the product uses an encoder. Scoring points, reason codes, alert/ask thresholds and refusal switches are lab-invented and tagged as such in the policy editor.",
      "UNVERIFIED: every product claim is a Ping release claim, UNVERIFIED on our tenant (release 2026-11-02). The ID-JAG tab explicitly cannot demonstrate the deck's no-re-consent claim: the lab models neither a consent step nor client authentication on the redeem leg."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs: Three signals, Intent catalogue, Customer intent, Baseline, On-behalf-of, ID-JAG, Diagram, Talk track.",
      "Three signals: pick a scripted call from the 'Scripted calls' group or type your own under 'Your own call' and press 'Judge this call'. Results are shown as three separate panels — Intent, Purpose, Behaviour — under a 'Deterministic tier' (the only tier that can refuse) and a 'Scored tier' (alert or ask a person). The editable policy rejects any attempt to make a score deny.",
      "Intent catalogue: browse the console's 25 intents, filter them, and use 'Try a call against the whole catalogue' to classify any phrase by real pattern match and the similarity stand-in. Customer intent: clone the console's data_exfiltration intent, edit its real regexes, exemplars and twins, and watch the clone rule replace the built-in. Hostile regex patterns are refused at compile time with a reason.",
      "Baseline: fire scripted runs until the agent's normal is learned — enforcement stays OFF until then, because a new agent is never blocked for being new. Press P for presenter mode."
    ]
  },
  {
    heading: "Mock vs Live honesty",
    body: "Mock mode (default) runs offline from tables. Live mode is the lab's own local engine: real RS256 signing with a key generated in this process, real verification, real baseline learning, real classifier — but the 'issuer', 'MCP server' and 'partner app' are function calls, and Live never leaves loopback and never touches a tenant. The banner on every page names the mode you are in; until the story answers, it honestly says both. Under each result the trace panel shows what the lab really computed ('checked') versus what is only 'inferred' or 'observed'."
  }
];
