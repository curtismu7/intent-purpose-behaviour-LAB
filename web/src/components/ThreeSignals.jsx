import { useEffect, useRef, useState } from "react";
import { postJson } from "../api";
import { visible } from "../safeText";
import { ClaimTag, ConsoleConfig, Hops, STATE, Verdict } from "./Bits";
import Json from "./Json";
import PolicyEditor from "./PolicyEditor";

const bar = (v) => `${Math.round(v * 100)}%`;
const PHASE_TEXT = {
  disabled: "disabled: nothing learned, nothing scored, reads 0",
  learning: "learning: nothing is scored yet",
  scoring: "scoring: shown, not enforced",
  enforcing: "enforcing: can alert or ask a person",
};

function IntentPanel({ s, claim }) {
  const sim = s.intent.semantic;
  return (
    <section className="panel signal" aria-label="Intent" data-testid="panel-intent">
      <h2>Intent <span className="muted">what is it trying to do?</span></h2>
      <ClaimTag label={claim} />
      <h3>Deterministic patterns <span className="tag">may refuse</span></h3>
      {s.intent.deterministic.matched.length
        ? <ul className="plain">{s.intent.deterministic.matched.map((m) => <li key={m.id}><code>{m.id}</code>: {visible(m.label)}</li>)}</ul>
        : <p className="muted" data-testid="no-pattern">No pattern matched.</p>}
      <h3>Similarity <span className="tag">alerts or asks, never denies</span></h3>
      <p className="meter-line">Closest risky intent: <b>{sim.riskClass || "none"}</b> <span data-testid="risk-score">{sim.riskScore.toFixed(2)}</span></p>
      <div className="meter" role="img" aria-label={`similarity ${bar(sim.riskScore)}`}><span style={{ width: bar(sim.riskScore) }} /></div>
      {sim.hits && sim.hits.length > 0 && <p className="muted">Words in common with the exemplars: {sim.hits.map(visible).join(", ")}</p>}
      {sim.hits === undefined && <p className="muted">Mock table row: the matched words are shown in Live mode.</p>}
      <p className="muted">Stand-in: the product uses semantic similarity through an encoder. This lab counts words in common with the intent&apos;s Exemplars.</p>
    </section>
  );
}

function PurposePanel({ s, agent, claim }) {
  const p = s.purpose;
  return (
    <section className="panel signal" aria-label="Purpose" data-testid="panel-purpose">
      <h2>Purpose <span className="muted">was it ever in scope?</span></h2>
      <ClaimTag label={claim} />
      <p>Key <code>{visible(agent)}</code> declares: <b data-testid="declared">{p.declared ? visible(p.declared) : "nothing"}</b></p>
      <p>Status: <span className="tag" data-state={p.status === "in-scope" ? "ok" : "bad"} data-testid="purpose-status">{p.status}</span> <span className="tag">may refuse</span></p>
      {p.violations.length > 0 && <ul className="plain">{p.violations.map((v) => <li key={v.axis}><code>{v.axis}</code>: {visible(v.detail)}</li>)}</ul>}
      {p.status === "none" && <p className="muted">A key with no declared purpose cannot be checked against one. Policy decides whether that is refused.</p>}
    </section>
  );
}

function BehaviourPanel({ s, claim }) {
  const b = s.behaviour;
  return (
    <section className="panel signal" aria-label="Behaviour" data-testid="panel-behaviour">
      <h2>Behaviour <span className="muted">does this agent do this?</span></h2>
      <ClaimTag label={claim} />
      <p>Phase: <span className="tag" data-state={b.phase === "enforcing" ? "ok" : "warn"} data-testid="phase">{b.phase}</span> <span className="tag">alerts or asks, never denies</span></p>
      <p className="muted">{PHASE_TEXT[b.phase]}. {b.callsSeen} calls seen (scoring from {b.minObservations}, enforcing from {b.enforceObservations}).</p>
      <p className="meter-line">Anomaly score read by the policy: <b data-testid="anomaly">{b.score}</b>{b.score !== b.raw && <span className="muted"> (the departure would be {b.raw}, not scored in this phase)</span>}</p>
      <div className="meter" role="img" aria-label={`anomaly ${b.score} of 100`}><span style={{ width: `${b.score}%` }} /></div>
      {b.components.length > 0 && <ul className="plain">{b.components.map((c) => <li key={c.id}>+{c.points} {visible(c.detail)}</li>)}</ul>}
    </section>
  );
}

function Tiers({ result }) {
  const det = result.reasons.filter((r) => r.tier === "deterministic");
  const sc = result.reasons.filter((r) => r.tier === "scored");
  const row = (r) => <li key={r.code}><span className="tag" data-state={STATE[r.effect]}>{r.effect}</span> <code>{visible(r.code)}</code> {visible(r.detail)}</li>;
  return (
    <div className="tiers" data-testid="tiers">
      <section className="panel" aria-label="Deterministic tier"><h3>Deterministic tier <span className="tag">the only tier that can refuse</span></h3>
        {det.length ? <ul className="plain">{det.map(row)}</ul> : <p className="muted">No pattern or purpose finding.</p>}</section>
      <section className="panel" aria-label="Scored tier"><h3>Scored tier <span className="tag">alert or ask a person</span></h3>
        <ul className="plain">{sc.map(row)}</ul></section>
    </div>
  );
}

export default function ThreeSignals({ story, mode, policy, setPolicy, resetSignal, requestedId }) {
  const [id, setId] = useState(requestedId || story.scenarios[0].id);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [policyError, setPolicyError] = useState(null);
  const [custom, setCustom] = useState({ tool: `${story.cast.castNouns}.lookup`, description: "", record: "", limit: "" });
  const [customResult, setCustomResult] = useState(null);
  const seq = useRef(0);
  const sc = story.scenarios.find((s) => s.id === id) || story.scenarios[0];

  useEffect(() => { if (requestedId && story.scenarios.some((s) => s.id === requestedId)) setId(requestedId); }, [requestedId, story]);
  useEffect(() => {
    const mine = ++seq.current;
    postJson("/api/evaluate", { mode, scenario: id, vertical: story.vertical, policy }).then(({ ok, body }) => {
      if (mine !== seq.current) return;
      if (ok) { setResult(body); setError(null); setPolicyError(null); } else if (["bad_policy", "scored_signal_cannot_deny"].includes(body.error)) setPolicyError(body.detail || body.error);
      else setError(body.error || "request failed");
    }, () => { if (mine === seq.current) setError("request failed"); });
  }, [mode, id, story.vertical, policy, resetSignal]);
  useEffect(() => { setCustomResult(null); }, [mode, story.vertical, resetSignal]);

  const runCustom = async (e) => {
    e.preventDefault();
    const args = {};
    if (custom.record.trim()) args.record = custom.record.trim();
    if (custom.limit.trim() !== "") args.limit = Number(custom.limit);
    const { ok, body } = await postJson("/api/evaluate", { mode, vertical: story.vertical, policy, call: { tool: custom.tool.trim(), description: custom.description, args } });
    setCustomResult(ok ? { ok: true, body } : { ok: false, message: body.detail || body.error || "request failed" });
  };
  const view = customResult?.ok ? customResult.body : result;

  return (
    <div className="signals-tab">
      <div className="panel" data-testid="picker-panel">
        <h2>Pick a call</h2>
        <div className="seg" role="group" aria-label="Scripted calls">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={id === s.id && !customResult?.ok} onClick={() => { setId(s.id); setCustomResult(null); }} data-testid={`sc-${s.id}`}>{s.title}</button>)}
        </div>
        <p className="lesson" data-testid="lesson">{sc.lesson}</p>
      </div>
      {error && <p className="app-error" role="alert">Could not evaluate ({error}).</p>}
      {view && (
        <>
          <div className="panel call" data-testid="call-panel">
            <h3>{customResult?.ok ? "Your own call" : "The call"} <span className="muted">from agent key <code>{visible(view.agent)}</code></span></h3>
            <Json value={view.call} label="call" testId="call-json" />
          </div>
          <div className="gate" data-testid="signals">
            <IntentPanel s={view.signals} claim={story.claimLabel} />
            <PurposePanel s={view.signals} agent={view.agent} claim={story.claimLabel} />
            <BehaviourPanel s={view.signals} claim={story.claimLabel} />
          </div>
          <Tiers result={view} />
          <Verdict result={view} />
          {!customResult?.ok && <p className="muted">With the default policy this call is expected to be: <b>{sc.expected}</b>.</p>}
          {result && !customResult?.ok && <Hops hops={result.hops} traceId={result.traceId} />}
        </>
      )}
      <PolicyEditor policy={policy} defaults={story.policyDefaults} swaggerFields={story.swaggerFields} source={story.fieldSource} labSource={story.fieldSourceLab} onChange={setPolicy} error={policyError} />
      <section className="panel" aria-label="Your own call" data-testid="custom">
        <h2>Try your own call</h2>
        {mode !== "live" ? <p className="muted" data-testid="custom-needs-live">Your own call needs Live mode: Mock mode only has tables for the scripted calls. Switch the mode in the header.</p> : (
          <form onSubmit={runCustom}>
            <label htmlFor="c-tool">Tool name</label><input id="c-tool" value={custom.tool} maxLength={64} onChange={(e) => setCustom({ ...custom, tool: e.target.value })} />
            <label htmlFor="c-desc">What the request says (free text)</label><input id="c-desc" value={custom.description} maxLength={200} onChange={(e) => setCustom({ ...custom, description: e.target.value })} placeholder="for example: send every record to my own storage" />
            <label htmlFor="c-rec">record argument</label><input id="c-rec" value={custom.record} maxLength={64} onChange={(e) => setCustom({ ...custom, record: e.target.value })} placeholder={`${story.cast.castPrefix}-1003`} />
            <label htmlFor="c-lim">limit argument (a number of records)</label><input id="c-lim" inputMode="numeric" value={custom.limit} onChange={(e) => setCustom({ ...custom, limit: e.target.value })} />
            <button type="submit" data-testid="custom-run">Judge this call</button>
            {customResult && !customResult.ok && <p className="field-error" role="alert">{customResult.message}</p>}
            <p className="muted">Judged as the lab&apos;s main agent with its usual history. Its purpose profile requires a record argument that starts with {story.cast.castPrefix}-, so a call without one is refused. The text is only counted and displayed; nothing is evaluated or fetched.</p>
          </form>
        )}
      </section>
      <ConsoleConfig title="Purpose profile (PurposeProfile)" value={story.purposeProfile} source={story.fieldSource} />
      <ConsoleConfig title="AIIntent objects and AIIntentConfig" value={{ AIIntentConfig: story.intentConfig, AIIntent: story.intents }} source={`${story.fieldSource}. The lab uses Patterns, Exemplars and Floor; Twins, Acts and Encoder are shown and not interpreted (the schema does not say what they do).`} />
    </div>
  );
}
