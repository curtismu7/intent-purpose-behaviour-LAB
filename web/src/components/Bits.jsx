import Json from "./Json";
import { visible } from "../safeText";

// Every product claim carries this tag. It is on every tab, and in presenter mode too.
export function ClaimTag({ label }) {
  return <span className="tag" data-state="warn" data-testid="claim-tag">{label || "Ping release claim, UNVERIFIED on our tenant"}</span>;
}
export function SourceTag({ swagger, source, labSource }) {
  return <span className="tag" data-state={swagger ? "ok" : undefined} title={swagger ? source : labSource}>{swagger ? "console swagger name" : "lab-invented"}</span>;
}

// Effect words (allow, alert, ask, deny) and check results map to a state for the tag colour.
export const STATE = { allow: "ok", ok: "ok", alert: "warn", ask: "warn", warn: "warn", deny: "bad", bad: "bad" };
const WORD = { allow: "ALLOW", alert: "ALERT", ask: "ASK A PERSON", deny: "DENY" };
export function Verdict({ result }) {
  const d = result.decision;
  return (
    <div className="verdict" data-decision={d} data-testid="verdict" role="status">
      <div className="verdict__word" data-testid="verdict-word">{WORD[d] || d}</div>
      <div>Reason code: <span className="reason" data-testid="reason-code">{visible(result.reasonCode)}</span></div>
      <div className="muted">{d === "deny" ? "A hard refusal, from the deterministic tier." : d === "ask" ? "Held for a person to approve. Not blocked, not silently allowed." : d === "alert" ? "The call goes through and an alert is raised." : result.decidedBy === "none" ? "Nothing refused, nothing to ask." : ""}</div>
    </div>
  );
}

// A table of checks: which held and which failed, each with its sentence.
export function Checks({ checks, caption, testId }) {
  return (
    <div className="scroll"><table className="tbl checks" data-testid={testId}>
      <caption>{caption}</caption>
      <thead><tr><th>Check</th><th>Result</th><th>Why</th></tr></thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.id}>
            <td><code>{c.id}</code></td>
            <td><span className="tag" data-state={c.ok ? "ok" : "bad"}>{c.ok ? "pass" : "FAIL"}</span></td>
            <td>{visible(c.detail)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

// A raw token with its decoded header and claims. Mock-issued and labelled, shown in full (education).
export function Token({ title, tok, label, testId }) {
  return (
    <details open className="tok" data-testid={testId}>
      <summary>{title}</summary>
      <p className="muted">{label}</p>
      <Json value={tok.token} label={`${title} raw`} />
      <Json value={{ header: tok.header, claims: tok.claims }} label={`${title} decoded`} />
    </details>
  );
}

export function Hops({ hops, traceId }) {
  return (
    <details className="hops" data-testid="hops">
      <summary>Raw hops with traceparent{traceId ? ` (trace ${traceId.slice(0, 8)}...)` : ""}</summary>
      {hops.map((h) => (
        <div key={h.n} className="hop">
          <h4>{h.n}. {h.label}</h4>
          <Json value={h.request} label={`hop ${h.n} request`} />
          <Json value={h.response} label={`hop ${h.n} response`} />
        </div>
      ))}
    </details>
  );
}

export function ConsoleConfig({ title, value, source }) {
  return (
    <details className="cfg" data-testid="console-config">
      <summary>{title} <span className="tag" data-state="ok">console swagger names</span></summary>
      <p className="muted">{source}</p>
      <Json value={value} label={title} />
    </details>
  );
}
