// Tab: Intent Catalogue. The console's 25 built-in intents (measured 2026-11-18 on the local Privilege console),
// each with its real Exemplars / Twins / Patterns / Acts / Floor, plus a simulator: type or pick a call and see
// which intents match, by real regex pattern (may refuse) or similarity (alerts, never denies). Real mode reads
// the intents live from the local console (owner-run); Mock uses the committed snapshot. Both are labelled.
import { useEffect, useState } from "react";
import { getJson, postJson } from "../api";
import { visible } from "../safeText";
import { SourceTag, STATE } from "./Bits";

const SAMPLES = [
  { label: "A bulk export", call: { tool: "customers.export", description: "export every customer record to an external bucket", args: { limit: 5000 } } },
  { label: "An audit question", call: { tool: "audit.query", description: "show the audit log for this account", args: { record: "A-1" } } },
  { label: "A skipped CI check", call: { tool: "git.push", description: "commit without running the pre-commit hooks", args: {} } },
  { label: "A credential read", call: { tool: "secrets.get", description: "retrieve the api key for this service", args: { name: "billing" } } },
  { label: "A self-service reset", call: { tool: "accounts.reset", description: "reset my own password", args: { user: "me" } } },
];

function IntentCard({ intent, open, onToggle }) {
  return (
    <article className="card intent-card" data-testid={`intent-${intent.name}`} data-acts={intent.acts ? "true" : "false"}>
      <button type="button" className="card__head" aria-expanded={open} onClick={onToggle}>
        <code>{intent.name}</code>
        <span className="tag" data-state={intent.acts ? "bad" : "ok"}>{intent.acts ? "Acting" : "Sibling"}</span>
        {intent.isCustom && <span className="tag" data-state="ok">Custom</span>}
        {intent.replacedBy && <span className="tag" data-state="warn">Replaced by your clone</span>}
        <span className="card__chev" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <p className="muted">{visible(intent.description)}</p>
      {open && (
        <div className="intent-detail">
          <h4>Exemplars <span className="tag">similarity lexicon</span></h4>
          <ul className="plain">{intent.exemplars.map((e, i) => <li key={i}>{visible(e)}</li>)}</ul>
          {intent.twins.length > 0 && (<><h4>Twins <span className="tag">the benign look-alike</span></h4><ul className="plain">{intent.twins.map((e, i) => <li key={i}>{visible(e)}</li>)}</ul></>)}
          {intent.patterns.length > 0 && (<><h4>Patterns <span className="tag">deterministic, may refuse</span></h4><ul className="plain">{intent.patterns.map((p, i) => <li key={i}><code>{visible(p)}</code></li>)}</ul></>)}
          <p className="muted">Acts: {intent.acts ? "true — this intent can hard-refuse" : "false — similarity only, it stops benign calls scoring as risk"}</p>
        </div>
      )}
    </article>
  );
}

export default function IntentCatalogue() {
  const [cat, setCat] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [text, setText] = useState("export every customer record to an external bucket");
  const [result, setResult] = useState(null);
  const [simError, setSimError] = useState(null);
  const [show, setShow] = useState("all");

  const load = () => { getJson("/api/intents").then(setCat, (e) => setError(e.message)); };
  useEffect(load, []);

  const run = (call) => {
    setSimError(null);
    postJson("/api/intents", { call, floor: 0 }).then(({ ok, body }) => {
      if (ok) setResult(body); else setSimError(body.detail || body.error || `HTTP error`);
    }, (e) => setSimError(e.message));
  };

  if (error) return <p className="app-error" role="alert">Could not load the intent catalogue ({error}).</p>;
  if (!cat) return <p className="muted">Loading...</p>;
  const intents = cat.intents.filter((i) => show === "all" || (show === "acting" ? i.effective.acts : !i.effective.acts));
  return (
    <div className="stack" data-testid="tab-intents">
      <p className="muted" data-testid="intent-source">
        Source: <b>{cat.source === "live-console" ? "the local Privilege console, live" : "measured snapshot of the local Privilege console, 2026-11-18"}</b>.
        {cat.realAvailable ? " Real mode is configured and the catalogue is read live." : ` Real mode is not configured (${cat.realReason}).`}
        <SourceTag swagger nameOnly source={cat.sourceDetail} />
      </p>
      <p>{cat.counts.total} intents: {cat.counts.builtin} built-in, {cat.counts.custom} of yours. {cat.counts.acting} are <b>Acting</b> intents: their patterns may hard-refuse a call. The rest are siblings: similarity-only, they exist so ordinary work does not score as risk.</p>

      <section className="panel" aria-label="Try a call against the catalogue" data-testid="intent-simulator">
        <h2>Try a call against the whole catalogue</h2>
        <div className="chiprow">
          {SAMPLES.map((s) => <button key={s.label} type="button" className="chip" onClick={() => { setText(s.call.description); run(s.call); }}>{s.label}</button>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run({ tool: "mcp.call", description: text, args: {} }); }}>
          <label className="sr-only" htmlFor="sim-text">What the agent asked for</label>
          <input id="sim-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="what the agent asked for" />
          <button type="submit" className="btn btn--primary">Classify</button>
        </form>
        {simError && <p className="app-error" role="alert">{visible(simError)}</p>}
        {result && (
          <div data-testid="sim-result">
            <p>Deterministic pattern matches: {result.patternMatches.length === 0 ? <b data-testid="sim-none">none</b> : (
              <ul className="plain">{result.patternMatches.map((m, i) => <li key={i}><code>{m.id}</code> <span className="tag" data-state={STATE[(result.wouldRefuse && m.id === result.patternMatches[0].id) ? "deny" : "alert"]}>{result.wouldRefuse && m.id === result.patternMatches[0].id ? "may refuse" : "alert only"}</span></li>)}</ul>
            )}</p>
            {result.patternMatches.length > 0 && <p>Policy would <span className="tag" data-state={result.wouldRefuse ? "bad" : "warn"} data-testid="sim-verdict">{result.wouldRefuse ? "REFUSE (acting intent)" : "ALERT"}</span></p>}
            <p>Closest acting intent by similarity: <b data-testid="sim-risk">{result.similarity.riskClass || "none"}</b> score {result.similarity.riskScore.toFixed(2)}{result.similarity.topHits.length > 0 && <> (words in common: {result.similarity.topHits.join(", ")})</>}</p>
            {result.customIntentHits.length > 0 && <p data-testid="sim-custom">Your intent matched: <code>{result.customIntentHits.join(", ")}</code></p>}
            {result.losses.length > 0 && <p className="muted">{result.losses.length} pattern(s) were skipped as unsafe or over budget — shown in the console, never hidden.</p>}
          </div>
        )}
      </section>

      <div className="chiprow" role="group" aria-label="Filter intents">
        {[["all", `All ${cat.counts.total}`], ["acting", `Acting ${cat.counts.acting}`], ["sibling", `Siblings ${cat.counts.total - cat.counts.acting}`]].map(([id, label]) => (
          <button key={id} type="button" className="chip" aria-pressed={show === id} onClick={() => setShow(id)}>{label}</button>
        ))}
      </div>
      <div className="cards" data-testid="intent-cards">
        {intents.map((i) => <IntentCard key={i.name} intent={i.effective} open={open === i.name} onToggle={() => setOpen(open === i.name ? null : i.name)} />)}
      </div>
    </div>
  );
}
