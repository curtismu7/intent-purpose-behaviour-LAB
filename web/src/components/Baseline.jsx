import { useEffect, useState } from "react";
import { getJson, postJson } from "../api";
import { visible } from "../safeText";
import { ClaimTag, ConsoleConfig } from "./Bits";

const PHASES = ["learning", "scoring", "enforcing"];

function Rows({ rows, story }) {
  return (
    <div className="scroll">
      <table className="tbl" data-testid="baseline-table">
        <caption>Calls so far</caption>
        <thead><tr><th>#</th><th>Call</th><th>Tool</th><th>Phase</th><th>Anomaly</th><th>Decision</th><th>Reason code</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const b = r.signals.behaviour;
            return (
              <tr key={r.n} data-testid={`row-${r.n}`} className={`row--${r.decision}`}>
                <td>{r.n}</td><td>{visible(story.baseline.titles[r.kind])}</td><td><code>{visible(r.call.tool)}</code></td>
                <td><span className={`tag ${b.phase === "enforcing" ? "tag--ok" : "tag--warn"}`}>{b.phase}</span></td>
                <td>{b.score}{b.score !== b.raw ? <span className="muted"> (would be {b.raw})</span> : null}</td>
                <td><span className={`tag tag--${r.decision}`}>{r.decision}</span></td><td><code>{visible(r.reasonCode)}</code></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ calls, policy }) {
  const min = policy.behaviour.MinObservations; const enf = policy.behaviour.EnforceObservations;
  const phase = policy.behaviour.Disabled ? "disabled" : calls < min ? "learning" : calls < enf ? "scoring" : "enforcing";
  return (
    <div className="timeline" data-testid="timeline">
      <p className="phase-line">Enforcement is <b data-testid="enforcement">{phase === "enforcing" ? "ON" : "OFF"}</b>. Phase: <span className={`tag ${phase === "enforcing" ? "tag--ok" : "tag--warn"}`} data-testid="baseline-phase">{phase}</span> after {calls} call{calls === 1 ? "" : "s"}.</p>
      <div className="phases" role="img" aria-label={`phase ${phase}`}>
        {PHASES.map((p) => <span key={p} className={`phase ${p === phase ? "phase--now" : ""}`}>{p}{p === "learning" ? ` (under ${min})` : p === "scoring" ? ` (${min} to ${enf - 1})` : ` (${enf}+)`}</span>)}
      </div>
      {phase !== "enforcing" && <p className="never" data-testid="never-blocked">A new agent is never blocked for being new: until {enf} calls the behaviour signal cannot alert, ask or deny. (Ping release claim, UNVERIFIED on our tenant.)</p>}
    </div>
  );
}

export default function Baseline({ story, mode, policy, resetSignal }) {
  const [mock, setMock] = useState(null);
  const [shown, setShown] = useState(0);
  const [live, setLive] = useState({ log: [], state: null });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShown(0); setMock(null);
    postJson("/api/baseline", { mode: "mock", vertical: story.vertical, policy }).then(({ ok, body }) => { if (ok) setMock(body.rows); });
  }, [story.vertical, policy, resetSignal]);
  useEffect(() => {
    getJson(`/api/baseline?mode=live&vertical=${encodeURIComponent(story.vertical)}`).then((j) => setLive({ log: j.live.log, state: j.live.state }), () => setError("could not load"));
  }, [story.vertical, resetSignal]);

  const fire = async (kind) => {
    setBusy(true);
    const { ok, body } = await postJson("/api/baseline", { mode: "live", kind, vertical: story.vertical, policy });
    setBusy(false);
    if (ok) { setLive({ log: body.log, state: body.state }); setError(null); } else setError(body.detail || body.error || "request failed");
  };

  const rows = mode === "mock" ? (mock || []).slice(0, shown).map((r) => r) : live.log.map((e, i) => ({ ...e, n: i + 1 }));
  const calls = mode === "mock" ? (rows.length ? rows[rows.length - 1].signals.behaviour.callsSeen + (rows[rows.length - 1].decision === "allow" || rows[rows.length - 1].decision === "alert" ? 1 : 0) : 0) : (live.state ? live.state.calls : 0);

  return (
    <div className="baseline-tab">
      <div className="panel">
        <h2>Baseline: an agent builds its own normal <ClaimTag label={story.claimLabel} /></h2>
        <p className="intro">The gateway learns each agent&apos;s normal pattern of calls and scores how far a request departs from it. It scores only after MinObservations calls and enforces only after EnforceObservations. Calls that were refused or held are not learned. Edit those numbers in the policy on the Three signals tab (current: {policy.behaviour.MinObservations} and {policy.behaviour.EnforceObservations}).</p>
        <Timeline calls={calls} policy={policy} />
        {mode === "mock" ? (
          <div className="seg" role="group" aria-label="Scripted run">
            <button type="button" onClick={() => setShown((n) => Math.min(n + 1, (mock || []).length))} disabled={!mock || shown >= mock.length} data-testid="next-call">Next scripted call</button>
            <button type="button" onClick={() => setShown((mock || []).length)} disabled={!mock || shown >= mock.length} data-testid="play-all">Show all {mock ? mock.length : ""} calls</button>
            <button type="button" onClick={() => setShown(0)} data-testid="restart">Start again</button>
          </div>
        ) : (
          <div className="seg" role="group" aria-label="Fire a call">
            {story.baseline.kinds.map((k) => <button key={k} type="button" disabled={busy} onClick={() => fire(k)} data-testid={`fire-${k}`}>{story.baseline.titles[k]}</button>)}
          </div>
        )}
        {mode === "mock" && <p className="muted">Mock: a scripted run from a table. Decisions are recomputed from your policy; the learning path is the default one. Switch to Live to fire your own calls against a real learner.</p>}
        {mode === "live" && <p className="muted">Live: each button fires a call at the real engine. The learner is yours (this browser tab&apos;s workspace); Reset clears it.</p>}
        {error && <p className="field-error" role="alert">{visible(error)}</p>}
      </div>
      {rows.length > 0 ? <Rows rows={rows} story={story} /> : <p className="muted" data-testid="baseline-empty">No calls yet. {mode === "mock" ? "Press Next scripted call." : "Fire a normal call first, so the agent has something to be normal about."}</p>}
      <ConsoleConfig title="BehaviourConfig (per agent key)" value={{ Disabled: policy.behaviour.Disabled, MinObservations: policy.behaviour.MinObservations, EnforceObservations: policy.behaviour.EnforceObservations }} source={`${story.fieldSource}. Policy attribute context.behaviour reads 0 when Disabled.`} />
    </div>
  );
}
