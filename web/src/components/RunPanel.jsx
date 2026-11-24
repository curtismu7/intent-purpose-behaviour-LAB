import { useEffect, useState } from "react";
import { workspaceFetch } from "../workspace";
import RunObservability from "../run-observability/RunObservability";

// Where this lab's logs live: its own standard output, one line per policy decision. Nothing else is read back.
const STREAMS = [{
  product: "intent-purpose-behaviour-lab",
  lives: "The lab's own server standard output (docker compose logs).",
  streams: "One line per policy decision, written when the decision is made. The lab reads no product log, so nothing here is read back.",
}];

const isRecord = (b) => b !== null && typeof b === "object" && !Array.isArray(b) && Array.isArray(b.rows);

// The record of ONE run in the page's current mode. It shows only the record it was asked for (never the previous run's while this one loads),
// and an alert for any answer that is not a record.
export default function RunPanel({ runId, mode }) {
  const key = `${mode}:${runId}`;
  const [state, setState] = useState({ key: null, record: null, error: null });

  useEffect(() => {
    if (!runId) return undefined;
    const asked = `${mode}:${runId}`;
    let current = true;
    workspaceFetch(`/api/run-record?runId=${encodeURIComponent(runId)}&mode=${mode}`, { method: "GET" })
      .then(async (r) => {
        let body = null;
        try { body = await r.json(); } catch { /* not JSON */ }
        return { ok: r.ok, body };
      })
      .then(({ ok, body }) => {
        if (!current) return;
        if (ok && isRecord(body) && body.source === "mock") setState({ key: asked, record: body, error: null });
        else setState({ key: asked, record: null, error: (body && typeof body.message === "string" && body.message) || "the record for this run is not available" });
      }, () => { if (current) setState({ key: asked, record: null, error: "request failed" }); });
    return () => { current = false; };
  }, [runId, mode]);

  if (!runId) return null;
  const mine = state.key === key;
  return (
    <div className="run-panel" data-testid="run-panel">
      <p className="muted">The lab writes one line per policy decision to its own standard output. This is the record of this run, built from what the lab recorded for it.</p>
      {!mine && <p className="muted" role="status">Collecting this run's record...</p>}
      {mine && state.error && <div className="app-error" role="alert">Could not show this run's record ({state.error}).</div>}
      {mode === "live" && <p className="muted" data-testid="run-live-note">Live: the lab's own in-process engine computed these rows. They are simulated, not logged: no product log was read.</p>}
      {mine && state.record && <RunObservability record={state.record} source="mock" streams={STREAMS} />}
    </div>
  );
}
