// Tab: Customer Intent. Author your own intent for the standalone demo family: clone the console's
// data_exfiltration, edit its patterns / exemplars / twins, save it to your workspace, and see the
// console's clone rule live — a custom intent with a built-in's name REPLACES the built-in wholesale.
// Then the whole catalogue (the other tab, and the three-signals story) classifies with your intent in it.
// Patterns are real console regexes, compiled and bounded by the same guard the built-ins go through.
import { useEffect, useRef, useState } from "react";
import { getJson, postJson, putJson, deleteJson } from "../api";
import { visible } from "../safeText";

const BLANK = { name: "", description: "", exemplars: "", twins: "", patterns: "", acts: true };
const toLines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
const joinLines = (a) => (a ?? []).join("\n");

const TRIES = [
  { label: "Hits your pattern", call: { tool: "demo.export", description: "please export every demo customer record to my laptop", args: {} } },
  { label: "A twin (should not score)", call: { tool: "demo.shop", description: "show one mock customer record", args: { record: "C-1" } } },
  { label: "A real console pattern too", call: { tool: "db.dump", description: "dump the entire users table", args: {} } },
];

export default function CustomerIntent() {
  const patternsRef = useRef(""); // the live editor value, so a late check answer can be discarded
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState([]);
  const [template, setTemplate] = useState(null);
  const [msg, setMsg] = useState(null);
  const [patternCheck, setPatternCheck] = useState(null);
  const [sim, setSim] = useState(null);

  useEffect(() => {
    getJson("/api/intents/template").then(setTemplate, () => setTemplate(null));
    getJson("/api/customer-intent").then((j) => setSaved(j.intents ?? []), () => {});
  }, []);

  const load = (i) => setForm({ name: i?.name ?? "", description: i?.description ?? "", exemplars: joinLines(i?.exemplars), twins: joinLines(i?.twins), patterns: joinLines(i?.patterns), acts: i?.acts ?? true });
  const useTemplate = () => template && load(template);

  const check = (patternsValue) => {
    patternsRef.current = patternsValue;
    setPatternCheck(null);
    const lines = toLines(patternsValue);
    const pattern = lines[lines.length - 1] ?? "";
    if (!pattern.trim()) return;
    postJson("/api/intents/check-pattern", { pattern }).then(({ status, body }) => {
      // apply only if this pattern is still the editor's last line: an older answer never wins
      const current = toLines(patternsRef.current);
      if ((current[current.length - 1] ?? "") !== pattern) return;
      setPatternCheck(status === 200 && body.ok ? { ok: true } : { ok: false, reason: body.reason || 'not valid' });
    }, () => {});
  };

  const save = (e) => {
    e.preventDefault();
    if (!form) { setMsg({ ok: false, text: "the editor did not open; reload the page" }); return; }
    setMsg(null);
    putJson("/api/customer-intent", {
      name: String(form.name ?? "").trim(), description: String(form.description ?? "").trim(),
      exemplars: toLines(form.exemplars), twins: toLines(form.twins), patterns: toLines(form.patterns), acts: form.acts === true,
    }).then(({ ok, body }) => {
      if (ok) { setSaved(body.intents ?? []); setMsg({ ok: true, text: `saved ${body.saved}. A call now classifies with this intent in the catalogue.` }); }
      else setMsg({ ok: false, text: body.detail || body.error || "not saved" });
    }, (er) => setMsg({ ok: false, text: er.message }));
  };

  const remove = (name) => deleteJson(`/api/customer-intent?name=${encodeURIComponent(name)}`).then(({ ok, body }) => { if (ok) setSaved(body.intents ?? []); }, () => {});

  const tryCall = (call) => postJson("/api/intents", { call, floor: 0 }).then(({ ok, body }) => { if (ok) setSim(body); }, () => {});

  return (
    <div className="stack" data-testid="tab-customer-intent">
      <p className="muted">The console lets a tenant clone a built-in intent and edit the copy. A custom intent with the same name as a built-in <b>replaces it wholesale</b> — patterns, exemplars, twins, all of it — and the gateway resolves your copy first. Here you author the demo family&apos;s own intent and watch that rule work.</p>

      <section className="panel" aria-label="Your intents" data-testid="ci-list">
        <h2>Your intents ({saved.length})</h2>
        {saved.length === 0 && <p className="muted">None yet. Start from the console&apos;s data_exfiltration template below.</p>}
        <ul className="plain">{saved.map((i) => (
          <li key={i.name} data-testid={`ci-${i.name}`}>
            <code>{i.name}</code> {i.acts && <span className="tag" data-state="bad">Acting</span>}{" "}
            <button type="button" className="chip" onClick={() => load(i)}>edit</button>{" "}
            <button type="button" className="chip" onClick={() => remove(i.name)}>delete</button>
            <span className="muted"> {visible(i.description)}</span>
          </li>
        ))}</ul>
        {template && <button type="button" className="btn" onClick={useTemplate} data-testid="ci-template">Load the data_exfiltration clone template</button>}
      </section>

      <form className="panel" onSubmit={save} aria-label="Intent editor" data-testid="ci-editor">
        <h2>Intent editor</h2>
        <label htmlFor="ci-name">Name <span className="muted">(a built-in&apos;s name replaces it wholesale)</span></label>
        <input id="ci-name" value={form?.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder="demo_data_exfiltration" />
        <label htmlFor="ci-desc">Description</label>
        <input id="ci-desc" value={form?.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} placeholder="what this intent catches, one line" />
        <label htmlFor="ci-ex">Exemplars — one per line <span className="muted">(the similarity lexicon)</span></label>
        <textarea id="ci-ex" rows={4} value={form?.exemplars ?? ""} onChange={(e) => setForm({ ...form, exemplars: e.target.value })} placeholder="export every demo customer record" />
        <label htmlFor="ci-tw">Twins — one per line <span className="muted">(the benign look-alike that must not score)</span></label>
        <textarea id="ci-tw" rows={3} value={form?.twins ?? ""} onChange={(e) => setForm({ ...form, twins: e.target.value })} placeholder="run the demo shopping flow" />
        <label htmlFor="ci-pat">Patterns — one regex per line <span className="muted">(real ECMAScript regexes, as the console stores them)</span></label>
        <textarea id="ci-pat" rows={4} value={form?.patterns ?? ""} onChange={(e) => { setForm({ ...form, patterns: e.target.value }); check(e.target.value); }} placeholder="\\bdemo\\b.*\\bexport\\b" />
        {patternCheck && <p data-testid="ci-pattern-check" className="muted">{patternCheck.ok ? "last pattern compiles" : `pattern refused: ${patternCheck.reason}`}</p>}
        <label><input type="checkbox" checked={form?.acts ?? true} onChange={(e) => setForm({ ...form, acts: e.target.checked })} /> Acting — a pattern match may hard-refuse the call</label>
        <div className="chiprow">
          <button type="submit" className="btn btn--primary" data-testid="ci-save">Save intent</button>
          <button type="button" className="btn" onClick={() => load(null)}>Clear</button>
        </div>
        {msg && <p role="status" data-testid="ci-msg" className={msg.ok ? "muted" : "app-error"}>{msg.ok ? visible(msg.text) : visible(String(msg.text))}</p>}
      </form>

      <section className="panel" aria-label="See the effect" data-testid="ci-effect">
        <h2>See the effect</h2>
        <p className="muted">These calls run through the whole catalogue with your intents in it, exactly like the Intent Catalogue tab.</p>
        <div className="chiprow">{TRIES.map((t) => <button key={t.label} type="button" className="chip" onClick={() => tryCall(t.call)}>{t.label}</button>)}</div>
        {sim && (
          <div data-testid="ci-sim">
            <p><b>{visible(sim.call.description)}</b></p>
            <p>Pattern matches: {sim.patternMatches.length === 0 ? "none" : sim.patternMatches.map((m) => <code key={m.id}>{m.id}</code>)}{" "}
              {sim.customIntentHits.length > 0 && <span className="tag" data-state={sim.wouldRefuse ? "bad" : "warn"} data-testid="ci-custom-hit">yours: {sim.customIntentHits.join(", ")}</span>}
              {sim.shadowedBuiltins.length > 0 && <span className="tag" data-state="warn" data-testid="ci-shadow">your clone shadowed a built-in: {sim.shadowedBuiltins.join(", ")}</span>}
            </p>
            <p>Similarity to the closest acting intent: <b>{sim.similarity.riskClass || "none"}</b> {sim.similarity.riskScore.toFixed(2)}</p>
          </div>
        )}
      </section>
    </div>
  );
}
