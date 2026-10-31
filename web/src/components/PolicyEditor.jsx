import { SourceTag } from "./Bits";

// The editable policy. Field names tagged "console swagger name" come from the console swagger (schema only); the rest are the lab's own.
const FIELDS = [
  { sec: "intent", key: "patternRefuse", label: "A deterministic intent pattern match refuses", type: "bool" },
  { sec: "intent", key: "alertAbove", label: "Similarity: alert at or above", type: "num", step: 0.05, min: 0, max: 1 },
  { sec: "intent", key: "askAbove", label: "Similarity: ask a person at or above", type: "num", step: 0.05, min: 0, max: 1 },
  { sec: "intent", key: "Floor", label: "AIIntent.Floor (name only; the lab reads it as: similarity below this does not count)", type: "num", step: 0.05, min: 0, max: 1, nameOnly: true },
  { sec: "purpose", key: "refuseNone", label: "A key with no declared purpose is refused", type: "bool" },
  { sec: "purpose", key: "refuseOutside", label: "A call outside the declared Methods is refused", type: "bool" },
  { sec: "purpose", key: "refuseAxis", label: "A call that breaks another axis (Targets, ArgPrefixes) is refused", type: "bool" },
  { sec: "behaviour", key: "Disabled", label: "BehaviourConfig.Disabled: no learning, no scoring (reads 0)", type: "bool" },
  { sec: "behaviour", key: "MinObservations", label: "BehaviourConfig.MinObservations: scoring starts after this many calls (lab range 1 to 200)", type: "num", step: 1, min: 1, max: 200 },
  { sec: "behaviour", key: "EnforceObservations", label: "BehaviourConfig.EnforceObservations: enforcing starts after this many (lab range 1 to 200)", type: "num", step: 1, min: 1, max: 200 },
  { sec: "behaviour", key: "alertAbove", label: "Anomaly: alert at or above", type: "num", step: 5, min: 0, max: 100 },
  { sec: "behaviour", key: "askAbove", label: "Anomaly: ask a person at or above", type: "num", step: 5, min: 0, max: 100 },
];

export default function PolicyEditor({ policy, defaults, swaggerFields, source, labSource, onChange, error }) {
  const set = (sec, key, v) => onChange({ ...policy, [sec]: { ...policy[sec], [key]: v } });
  return (
    <section className="panel policy" aria-label="Policy" data-testid="policy">
      <h2>Policy <span className="muted">(editable)</span></h2>
      <p className="muted">Only the deterministic tier can refuse. A scored signal (similarity, anomaly) can alert or ask a person, and this lab rejects a policy that tries to make one deny.</p>
      {FIELDS.map((f) => {
        const id = `pol-${f.sec}-${f.key}`;
        const sw = swaggerFields.includes(`${f.sec}.${f.key}`);
        return (
          <div className="pol-row" key={id}>
            {f.type === "bool"
              ? <label className="check" htmlFor={id}><input id={id} type="checkbox" checked={!!policy[f.sec][f.key]} onChange={(e) => set(f.sec, f.key, e.target.checked)} /> {f.label}</label>
              : <label htmlFor={id}>{f.label}<input id={id} type="number" step={f.step} min={f.min} max={f.max} value={Number.isNaN(policy[f.sec][f.key]) ? "" : policy[f.sec][f.key]} onChange={(e) => set(f.sec, f.key, e.target.value === "" ? NaN : Number(e.target.value))} /></label>}
            <SourceTag swagger={sw} nameOnly={f.nameOnly} source={source} labSource={labSource} />
          </div>
        );
      })}
      <p className="muted" data-testid="policy-ranges">The lab ranges are its own (invented). In the schema a value of 0 for MinObservations or EnforceObservations means the built-in default; the lab does not support 0 and refuses it. Enforce must not be below Min (the schema notes that cross-field rule). The schema says nothing about the Floor beyond its type (a number), so the lab&apos;s reading of it is the lab&apos;s.</p>
      {error && <p className="field-error" role="alert" data-testid="policy-error">{error}</p>}
      <button type="button" onClick={() => onChange(structuredClone(defaults))} data-testid="policy-reset">Restore default policy</button>
    </section>
  );
}
