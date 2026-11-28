import { useCallback, useEffect, useState } from "react";
import fs from "node:fs";
import ThreeSignals from "./components/ThreeSignals";
import Baseline from "./components/Baseline";
import FlowTab from "./components/FlowTab";
import DiagramTab from "./components/DiagramTab";
import IntentCatalogue from "./components/IntentCatalogue";
import CustomerIntent from "./components/CustomerIntent";
import TalkTrack from "./components/TalkTrack";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import HelpDialog from "./help-dialog/HelpDialog.jsx";
import { HELP_SECTIONS } from "./helpContent";
import { getJson, postJson, resetWorkspace } from "./api";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";

const LAB_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version || null; } catch { return null; } })();

export const TABS = [
  { id: "signals", label: "Three signals" },
  { id: "intents", label: "Intent catalogue" },
  { id: "customer-intent", label: "Customer intent" },
  { id: "baseline", label: "Baseline" },
  { id: "obo", label: "On-behalf-of" },
  { id: "idjag", label: "ID-JAG" },
  { id: "diagram", label: "Diagram" },
  { id: "talk", label: "Talk track" },
];
// The banner is never blank and never claims one mode before it knows: until the story answers it says both, honestly.
const TAIL = "Every product claim is a Ping release claim, UNVERIFIED on our tenant (release 2026-11-02). Nothing here calls a real gateway, identity provider or tenant.";
export const BANNER_UNKNOWN = `SIMULATED, MOCK or LIVE mode (loopback only, no outbound network). ${TAIL}`;
const PRESENTER_TALK = { signals: ["say-first", "three-signals", "tiers", "intent", "purpose", "unverified"], intents: ["intent", "catalogue"], "customer-intent": ["catalogue", "unverified"], baseline: ["behaviour"], obo: ["obo"], idjag: ["id-jag"], diagram: ["three-signals"] };
const MODE_KEY = "ipb.mode";
const THEME_KEY = "ipb.theme";
function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}

const hashParts = () => {
  const h = window.location.hash.replace("#", "");
  const m = /^scenario-([a-z0-9-]{1,40})$/.exec(h);
  if (m) return { tab: "signals", scenario: m[1] };
  return { tab: TABS.some((t) => t.id === h) ? h : "signals", scenario: null };
};
const savedMode = () => { try { const m = window.localStorage.getItem(MODE_KEY); return m === "live" || m === "mock" ? m : null; } catch { return null; } };

export default function App() {
  const [vertical, setVertical] = useState("finance");
  const [story, setStory] = useState(null);
  const [mode, setModeState] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(hashParts().tab);
  const [requested, setRequested] = useState(hashParts().scenario);
  const [presenter, setPresenter] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [theme, setTheme] = useState(initialTheme);
  const [fontStep, setFontStep] = useState(() => { try { const f = localStorage.getItem("ipb.font"); return ["S", "M", "L"].includes(f) ? f : "M"; } catch { return "M"; } });

  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { applyFontSize(fontStep); try { localStorage.setItem("ipb.font", fontStep); } catch { /* storage blocked */ } }, [fontStep]);

  useEffect(() => { getJson("/api/info").then((i) => setModeState((m) => m || savedMode() || i.mode), () => setModeState((m) => m || savedMode() || "mock")); }, []);
  useEffect(() => {
    getJson(`/api/story?vertical=${encodeURIComponent(vertical)}`).then((j) => { setStory(j); setPolicy((p) => p || structuredClone(j.policyDefaults)); setError(null); }, (e) => setError(e.message));
  }, [vertical]);
  useEffect(() => {
    const on = () => { const p = hashParts(); setTab(p.tab); setRequested(p.scenario); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // Rule 19: the toggle asks the server to switch, then reloads the data this visit depends on.
  // Real (the live engine) is always available in this lab, so neither button is ever disabled.
  const setMode = (m) => {
    postJson("/api/mode", { source: m === "live" ? "real" : "mock" }).then(({ ok, body }) => {
      const next = ok && body?.mode ? body.mode : m;
      setModeState(next);
      try { window.localStorage.setItem(MODE_KEY, next); } catch { /* storage blocked */ }
      setResetSignal((n) => n + 1);
      getJson(`/api/story?vertical=${encodeURIComponent(vertical)}`).then((j) => { setStory(j); setPolicy((p) => p || structuredClone(j.policyDefaults)); setError(null); }, () => {});
    }, () => { setError("the mode switch did not reach the server"); });
  };
  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };
  const select = (id) => { setTab(id); setRequested(null); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };

  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    setPolicy(story ? structuredClone(story.policyDefaults) : null);
    setResetSignal((n) => n + 1);
    setResetMsg(ok ? "Reset: your workspace's runs and live baseline are cleared, the policy is back to default and the diagram is back in place." : "Reset failed on the server; the view was reset.");
  }, [story]);

  const banner = story && mode ? story.banner[mode] : BANNER_UNKNOWN;
  const ready = story && mode && policy;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">IPB</span>
          <h1>Intent Purpose Behaviour LAB</h1>
          <span className="shell-badge" data-state={mode === "live" ? "live" : undefined} data-testid="mode" title={mode === "live" ? "Live: the local engine, loopback only" : mode === "mock" ? "Mock: pure tables" : undefined}>{mode === "live" ? "Live" : mode === "mock" ? "Mock" : "..."}</span>
        </span>
        <nav className="shell-nav" aria-label="Lab sections">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); select(t.id); }}>{t.label}</a>
          ))}
        </nav>
        <TopMenu
          mode={{ value: mode === "live" ? "real" : "mock", onChange: (v) => setMode(v === "real" ? "live" : "mock"), realAvailable: true }}
          vertical={{ value: vertical, onChange: setVertical, options: story ? story.verticals : ["finance"] }}
          theme={{ value: theme, onChange: pickTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter (P)" }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          help={{ onClick: () => setHelpOpen(true), title: "What this lab is, and what is simulated" }}
          version={LAB_VERSION}
          onReset={reset}
        >
          <ShelfLink />
          <VerifyMark id="intent-purpose-behaviour-lab" />
        </TopMenu>
      </header>
      <main className="page">
        <p className="banner" data-state={mode === "live" ? "live" : undefined} role="status" data-testid="banner">{banner}</p>
        {error && <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p>}
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        {!presenter && story && <p className="intro">{story.intro}</p>}
        <div id={`panel-${tab}`} className="tab-panel">
          {error ? null : !ready ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {story.talkTrack.filter((t) => (PRESENTER_TALK[tab] || []).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "signals" && <ThreeSignals key={vertical} story={story} mode={mode} policy={policy} setPolicy={setPolicy} resetSignal={resetSignal} requestedId={requested} />}
              {tab === "intents" && <IntentCatalogue />}
              {tab === "customer-intent" && <CustomerIntent />}
              {tab === "baseline" && <Baseline key={vertical} story={story} mode={mode} policy={policy} resetSignal={resetSignal} />}
              {tab === "obo" && <FlowTab key={`obo-${vertical}`} kind="obo" story={story} mode={mode} resetSignal={resetSignal} />}
              {tab === "idjag" && <FlowTab key={`idjag-${vertical}`} kind="idjag" story={story} mode={mode} resetSignal={resetSignal} />}
              {tab === "diagram" && <DiagramTab vertical={vertical} resetSignal={resetSignal} />}
              {tab === "talk" && <TalkTrack talk={story.talkTrack} />}
            </>
          )}
        </div>
      </main>

      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={story?.talkTrack ?? []} />
      <HelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} sections={HELP_SECTIONS} docsUrl="https://github.com/curtismu7/intent-purpose-behaviour-LAB#readme" />
    </div>
  );
}
