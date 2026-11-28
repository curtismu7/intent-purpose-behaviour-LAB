// These tests drive the real UI against the real Express app (started on a loopback port inside the test), so a green run means the
// pieces actually work together: real story data, real engine, real RS256 signing in Live mode.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApp, startHttpServer } from "../../server/src/app.js";
import { createHealth } from "../../server/src/health.js";
import App, { TABS } from "./App";
import { labelOffsets } from "./components/PatternDiagram";
import { visible } from "./safeText";
import { setJsonView } from "./components/JsonPane";

let server; let base; const realFetch = globalThis.fetch;
beforeAll(async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  ({ server, url: base } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, configFile: "/nonexistent/customer.config.json" }) }));
  base = base.replace(/\/$/, "");
  globalThis.fetch = (u, init = {}) => realFetch(typeof u === "string" && u.startsWith("/") ? `${base}${u}` : u, { ...init, headers: { origin: base, ...(init.headers || {}) } });
});
afterAll(async () => { globalThis.fetch = realFetch; await new Promise((r) => server.close(r)); });
beforeEach(async () => {
  cleanup();
  setJsonView("raw"); // the Form | JSON choice is shared module state: these tests read the JSON text
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ }
  window.location.hash = "";
  // The mode is server-side now (rule 19) and the server outlives one test: put it back to mock, as a fresh visit would find it.
  if (base) await realFetch(`${base}/api/mode`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: '{"source":"mock"}' }).catch(() => {});
});

const T = { timeout: 15000 };
const mount = async () => { render(<App />); await screen.findByTestId("verdict", {}, T); };
const tab = (name) => userEvent.click(within(screen.getByRole("navigation", { name: "Lab sections" })).getByRole("link", { name }));

describe("shell", () => {
  it("opens on a MOCK modal that says it is simulated and UNVERIFIED, closes on Got it, and the old banner is gone on every tab, in presenter mode too", async () => {
    await mount();
    const modal = screen.getByTestId("mode-modal");
    expect(modal).toHaveAttribute("data-mode", "mock");
    expect(modal).toHaveTextContent(/MOCK/);
    expect(modal).toHaveTextContent(/Simulated: pure in-process tables/);
    expect(modal).toHaveTextContent(/UNVERIFIED on our tenant/);
    await userEvent.click(screen.getByTestId("mode-modal-ok"));
    expect(screen.queryByTestId("mode-modal")).toBeNull();
    expect(screen.queryByTestId("banner")).toBeNull();
    expect(screen.getByTestId("mode")).toHaveTextContent("Mock");
    // Standard shell: the dark shell bar first, then <main> with no simulation banner.
    const bar = document.querySelector("header.shell-bar");
    expect(bar).not.toBeNull();
    expect(bar.querySelector(".shell-brand h1")).toHaveTextContent("Intent Purpose Behaviour LAB");
    expect(within(bar).getByTestId("mode")).toBeInTheDocument();
    expect(within(bar).getByTestId("top-menu")).toHaveClass("shell-right");
    expect(document.querySelector("main > .banner")).toBeNull();
    expect(bar.compareDocumentPosition(document.querySelector("main")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const t of TABS) {
      await tab(t.label);
      expect(within(screen.getByRole("navigation", { name: "Lab sections" })).getByRole("link", { name: t.label })).toHaveAttribute("aria-current", "page");
      expect(document.querySelectorAll('.shell-nav [aria-current="page"]')).toHaveLength(1);
      expect(screen.queryByTestId("banner")).toBeNull();
      expect(screen.queryByTestId("mode-modal")).toBeNull();
    }
    await tab("Three signals");
    await userEvent.keyboard("p");
    expect(screen.getByTestId("presenter-say")).toBeInTheDocument();
    expect(screen.queryByTestId("banner")).toBeNull();
    expect(screen.getByTestId("presenter-say")).toBeVisible();
    expect(screen.getByTestId("presenter")).toHaveTextContent("Exit present");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("presenter-say")).toBeNull();
  }, 60000);

  it("the Mock/Real toggle switches both directions through the server, updates the chip, the modal and the data, and is remembered", async () => {
    await mount();
    expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "mock");
    await userEvent.click(screen.getByTestId("mode-modal-ok"));
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("Live"), T);
    // MOCK was dismissed; Live shows the REAL modal, whose line says the engine is still simulated and the claims UNVERIFIED.
    await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "real"), T);
    expect(screen.getByTestId("mode-modal")).toHaveTextContent(/REAL/);
    expect(screen.getByTestId("mode-modal")).toHaveTextContent(/Live: the lab's own local engine.*still simulated.*UNVERIFIED on our tenant/);
    expect(window.localStorage.getItem("ipb.mode")).toBe("live");
    expect(screen.getByTestId("mode-select")).toHaveValue("real");
    // Data is reloaded for the new mode: the Three signals panel answers in live mode.
    await waitFor(() => expect(screen.getByTestId("verdict")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("mode-modal-ok"));
    // Back to Mock: it was dismissed this session, so it stays closed.
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "mock");
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("Mock"), T);
    expect(screen.queryByTestId("mode-modal")).toBeNull();
    expect(screen.getByTestId("mode")).toHaveTextContent("Mock");
    expect(screen.getByTestId("mode-select")).toHaveValue("mock");
    expect(window.localStorage.getItem("ipb.mode")).toBe("mock");
  }, 60000);
});

describe("mode modal on load", () => {
  it("a lab already in Live shows MOCK until /api/info answers, then REAL, even after MOCK was dismissed", async () => {
    await realFetch(`${base}/api/mode`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: '{"source":"real"}' });
    let release; const held = new Promise((r) => { release = r; });
    const passthrough = globalThis.fetch;
    globalThis.fetch = (u, init) => (typeof u === "string" && u.startsWith("/api/info") ? held.then(() => passthrough(u, init)) : passthrough(u, init));
    try {
      render(<App />);
      expect((await screen.findByTestId("mode-modal")).dataset.mode).toBe("mock");
      await userEvent.click(screen.getByTestId("mode-modal-ok"));
      expect(screen.queryByTestId("mode-modal")).toBeNull();
      release();
      await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "real"), T);
      expect(screen.getByTestId("mode-modal")).toHaveTextContent(/UNVERIFIED on our tenant/);
    } finally { release(); globalThis.fetch = passthrough; }
  }, 60000);
});

describe("three signals", () => {
  it("shows Intent, Purpose and Behaviour separately, the two tiers, and a final decision with a reason code", async () => {
    await mount();
    await userEvent.click(screen.getByTestId("sc-bulk-export"));
    await waitFor(() => expect(screen.getByTestId("verdict-word")).toHaveTextContent("DENY"), T);
    for (const id of ["panel-intent", "panel-purpose", "panel-behaviour", "tiers"]) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("reason-code")).toHaveTextContent("DENY-INTENT-PATTERN:exfiltrate-data");
    expect(within(screen.getByTestId("tiers")).getByText(/the only tier that can refuse/)).toBeInTheDocument();
    expect(within(screen.getByTestId("panel-intent")).getAllByTestId("claim-tag")[0]).toHaveTextContent("UNVERIFIED on our tenant");
  }, 30000);

  it("all four decisions are reachable from the picker", async () => {
    await mount();
    const want = { "legit-lookup": "ALLOW", "reworded-payee": "ASK A PERSON", "drift-alert": "ALERT", "no-purpose": "DENY" };
    for (const [id, word] of Object.entries(want)) {
      await userEvent.click(screen.getByTestId(`sc-${id}`));
      await waitFor(() => expect(screen.getByTestId("verdict-word")).toHaveTextContent(word), T);
    }
  }, 60000);

  it("an edited policy changes the decision, and a policy that lets a score deny is refused with the reason", async () => {
    await mount();
    await userEvent.click(screen.getByTestId("sc-no-purpose"));
    await waitFor(() => expect(screen.getByTestId("verdict-word")).toHaveTextContent("DENY"), T);
    await userEvent.click(screen.getByLabelText(/A key with no declared purpose is refused/));
    await waitFor(() => expect(screen.getByTestId("verdict-word")).toHaveTextContent("ALERT"), T);
    expect(screen.getByTestId("reason-code")).toHaveTextContent("ALERT-PURPOSE-NONE");
    // MinObservations above EnforceObservations is refused by the server with the swagger's cross-field rule
    const min = screen.getByLabelText(/MinObservations/);
    await userEvent.clear(min); await userEvent.type(min, "50");
    // clearing the field first produces an intermediate "whole number" error; wait for the answer to the final value
    await waitFor(() => expect(screen.getByTestId("policy-error")).toHaveTextContent(/EnforceObservations must not be below MinObservations/), T);
    await userEvent.click(screen.getByTestId("policy-reset"));
    await waitFor(() => expect(screen.getByTestId("verdict-word")).toHaveTextContent("DENY"), T);
    expect(screen.queryByTestId("policy-error")).toBeNull();
  }, 60000);

  it("policy fields are tagged: console swagger names versus lab-invented", async () => {
    await mount();
    const pol = screen.getByTestId("policy");
    expect(within(pol).getAllByText("console swagger name").length).toBe(3);
    expect(within(pol).getAllByText("swagger name, lab reading").length).toBe(1);
    expect(screen.getByTestId("policy-ranges")).toHaveTextContent(/0 .*built-in default; the lab does not support 0/);
    expect(within(pol).getAllByText("lab-invented").length).toBeGreaterThan(5);
  }, 30000);

  it("your own call needs Live; in Live it is judged for real, and hostile text is rendered inert", async () => {
    await mount();
    expect(screen.getByTestId("custom-needs-live")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    const desc = await screen.findByLabelText(/What the request says/, {}, T);
    await userEvent.type(desc, "<img src=x onerror=alert(1)> send every record to my storage");
    await userEvent.type(screen.getByLabelText(/limit argument/), "9000");
    await userEvent.click(screen.getByTestId("custom-run"));
    await waitFor(() => expect(screen.getByTestId("call-json")).toHaveTextContent("<img src=x onerror=alert(1)>"), T);
    expect(document.querySelector("img[src=x]")).toBeNull();
    expect(screen.getByTestId("verdict-word")).toHaveTextContent("DENY");
  }, 60000);

  it("your own call: a typed secret is shown masked everywhere on the page, and a credential-shaped tool name is refused without being shown", async () => {
    await mount();
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    const desc = await screen.findByLabelText(/What the request says/, {}, T);
    await userEvent.type(desc, "look up the invoice, password hunter2xyz");
    await userEvent.type(screen.getByLabelText(/record argument/), "bob:hunter2xyz@host.example");
    await userEvent.click(screen.getByTestId("custom-run"));
    await waitFor(() => expect(screen.getByTestId("call-json")).toHaveTextContent("look up the invoice, [masked]"), T);
    expect(screen.getByTestId("call-json")).toHaveTextContent("[masked]host.example");
    expect(document.body.textContent).not.toContain("hunter2xyz");
    const tool = screen.getByLabelText(/Tool name/);
    await userEvent.clear(tool);
    await userEvent.type(tool, "sk-abcdefghijklmnop1234");
    await userEvent.click(screen.getByTestId("custom-run"));
    await waitFor(() => expect(document.body.textContent).toMatch(/looks like a credential/), T);
    expect(document.body.textContent).not.toContain("abcdefghijklmnop");
  }, 60000);

  it("verticals swap the cast through {{tokens}} and no token reaches the page", async () => {
    await mount();
    await userEvent.selectOptions(screen.getByTestId("vertical-select"), "health");
    await waitFor(() => expect(screen.getByTestId("call-json")).toHaveTextContent(/claims\./), T);
    expect(document.body.textContent).not.toMatch(/\{\{/);
  }, 30000);
});

describe("baseline", () => {
  it("Mock: enforcement is OFF for a new agent, then an out-of-pattern call asks a person, never a silent block", async () => {
    await mount();
    await tab("Baseline");
    expect(await screen.findByTestId("baseline-empty", {}, T)).toBeInTheDocument();
    // the scripted rows load from the server after the empty state shows; the button is disabled until they arrive
    await waitFor(() => expect(screen.getByTestId("next-call")).toBeEnabled(), T);
    expect(screen.getByTestId("enforcement")).toHaveTextContent("OFF");
    expect(screen.getByTestId("never-blocked")).toHaveTextContent(/never blocked for being new/);
    await userEvent.click(screen.getByTestId("next-call"));
    expect(screen.getByTestId("row-1")).toHaveTextContent("allow");
    await userEvent.click(screen.getByTestId("play-all"));
    expect(screen.getByTestId("enforcement")).toHaveTextContent("ON");
    expect(screen.getByTestId("row-12")).toHaveTextContent("ask");
    expect(screen.getByTestId("row-14")).toHaveTextContent("alert");
    expect(screen.getByTestId("row-16")).toHaveTextContent("deny");
    expect(screen.getByTestId("row-4")).toHaveTextContent("ALLOW-LEARNING");
  }, 60000);

  it("Mock: editing MinObservations and EnforceObservations in the policy moves the timeline and the scripted rows", async () => {
    await mount();
    const enf = screen.getByLabelText(/EnforceObservations/);
    await userEvent.clear(enf); await userEvent.type(enf, "4");
    const min = screen.getByLabelText(/MinObservations/);
    await userEvent.clear(min); await userEvent.type(min, "2");
    await waitFor(() => expect(screen.queryByTestId("policy-error")).toBeNull(), T);
    await tab("Baseline");
    await waitFor(() => expect(screen.getByTestId("next-call")).toBeEnabled(), T);
    expect(screen.getByText(/learning \(under 2\)/)).toBeInTheDocument();
    expect(screen.getByText(/scoring \(2 to 3\)/)).toBeInTheDocument();
    expect(screen.getByText(/enforcing \(4\+\)/)).toBeInTheDocument();
    for (let i = 1; i <= 5; i++) await userEvent.click(screen.getByTestId("next-call"));
    expect(screen.getByTestId("row-1")).toHaveTextContent("learning");
    expect(screen.getByTestId("row-3")).toHaveTextContent("scoring");
    expect(screen.getByTestId("row-5")).toHaveTextContent("enforcing");
    expect(screen.getByTestId("enforcement")).toHaveTextContent("ON");
  }, 60000);

  it("Live: fire real calls at a real learner; a held call is not learned", async () => {
    await mount();
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    await tab("Baseline");
    const fire = (k) => userEvent.click(screen.getByTestId(`fire-${k}`));
    for (let i = 1; i <= 10; i++) { await fire("normal"); await screen.findByTestId(`row-${i}`, {}, T); }
    expect(screen.getByTestId("enforcement")).toHaveTextContent("ON");
    await fire("heavy");
    expect(await screen.findByTestId("row-11", {}, T)).toHaveTextContent("ask");
    expect(screen.getByTestId("enforcement")).toHaveTextContent("ON");
  }, 90000);
});

describe("on-behalf-of and ID-JAG", () => {
  it("a decoded token pane offers Form | JSON and stands the lab's own keys out in both views", async () => {
    await mount();
    await tab("On-behalf-of");
    const decoded = within(await screen.findByTestId("tok-exchanged", {}, T)).getByRole("group", { name: /decoded view$/ });
    expect(within(decoded).getByRole("button", { name: "Form" })).toBeInTheDocument();
    expect(within(decoded).getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(decoded).getByRole("button", { name: "Form" }));
    const pane = decoded.parentElement.querySelector(".json--form");
    const hotKeys = [...pane.querySelectorAll('.jform__row[data-hot="true"] > .jform__k')].map((n) => n.textContent);
    expect(hotKeys).toEqual(expect.arrayContaining(["header.kid", "claims.aud", "claims.act.sub", "claims.jti"]));
  }, 60000);

  it("OBO in Mock: tokens are shown raw and labelled mock, with a placeholder signature", async () => {
    await mount();
    await tab("On-behalf-of");
    expect(await screen.findByTestId("obo-result", {}, T)).toBeInTheDocument();
    expect(screen.getByTestId("token-label")).toHaveTextContent(/placeholder signature/);
    expect(within(screen.getByTestId("tok-exchanged")).getAllByText(/MOCK_SIGNATURE_NOT_VERIFIABLE/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("flow-verdict")).toHaveTextContent("ACCEPTED");
  }, 60000);

  it("OBO in Live: real signature verifies, then each failure case fails the named check", async () => {
    await mount();
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    await tab("On-behalf-of");
    await waitFor(() => expect(screen.getByTestId("flow-verdict")).toHaveTextContent("ACCEPTED"), T);
    expect(screen.getByTestId("token-label")).toHaveTextContent(/really signed/);
    expect(screen.getByTestId("attribution")).toHaveTextContent(/original caller/);
    const expectFail = async (id, check) => {
      await userEvent.click(screen.getByTestId(`case-${id}`));
      await waitFor(() => expect(screen.getByTestId("flow-verdict")).toHaveTextContent("REJECTED"), T);
      const row = within(screen.getByTestId("checks-backend")).getByText(check).closest("tr");
      expect(row).toHaveTextContent("FAIL");
    };
    await expectFail("wrong-audience", "audience");
    await expectFail("expired", "expiry");
    await expectFail("no-act", "act");
    await expectFail("bad-signature", "signature");
    await userEvent.click(screen.getByTestId("case-shared-service-account"));
    await waitFor(() => expect(screen.getByTestId("attribution")).toHaveTextContent(/only see svc-gateway/), T);
  }, 120000);

  it("ID-JAG in Live: two issuers, no shared secret, no consent prompt, and a replay is refused", async () => {
    await mount();
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    await tab("ID-JAG");
    await waitFor(() => expect(screen.getByTestId("flow-verdict")).toHaveTextContent("ACCEPTED"), T);
    expect(screen.getByTestId("consent-count")).toHaveTextContent("0");
    expect(screen.getByTestId("secret-count")).toHaveTextContent("0");
    expect(screen.getByTestId("proof")).toHaveTextContent(/describe the mock, not the product, and are not proof/);
    expect(screen.getByTestId("proof")).toHaveTextContent(/omits client authentication on the redeem leg/);
    expect(screen.getByTestId("deck-claim")).toHaveTextContent(/no re-consent/);
    expect(screen.getByText(/NOT EXERCISED/, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/id-jag-standalone-LAB/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("case-replay"));
    const again = await screen.findByTestId("checks-redeem-again", {}, T);
    expect(within(again).getByText("replay").closest("tr")).toHaveTextContent("FAIL");
  }, 90000);
});

describe("diagram", () => {
  it("loads diagram-studio data by name, offers all three, Simulate walks a step, Reset clears it", async () => {
    await mount();
    await tab("Diagram");
    expect(await screen.findByTestId("pattern-canvas", {}, T)).toBeInTheDocument();
    for (const id of ["three-signals", "obo", "id-jag"]) expect(screen.getByTestId(`dg-${id}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Simulate/i }));
    expect(await screen.findByTestId("pattern-now", {}, T)).toHaveTextContent("Step 1:");
    await userEvent.click(screen.getByTestId("pattern-reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
    await userEvent.click(screen.getByTestId("dg-obo"));
    expect(await screen.findByText(/On-behalf-of: a token minted/, {}, T)).toBeInTheDocument();
  }, 60000);

  it("labelOffsets nudges a reply along the same pair of boxes", () => {
    expect(labelOffsets([{ from: "a", to: "b" }, { from: "b", to: "a" }])).toEqual([-16, 16]);
  });
});

describe("reset and talk track", () => {
  it("Reset restores the default policy and clears live state", async () => {
    await mount();
    await userEvent.click(screen.getByLabelText(/A key with no declared purpose is refused/));
    expect(screen.getByLabelText(/A key with no declared purpose is refused/)).not.toBeChecked();
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByLabelText(/A key with no declared purpose is refused/)).toBeChecked(), T);
  }, 60000);

  it("the talk track tab lists every section", async () => {
    await mount();
    await tab("Talk track");
    expect(await screen.findByTestId("talk-track", {}, T)).toHaveTextContent(/Hard refusals are deterministic/);
    expect(screen.getByTestId("talk-track").querySelectorAll("li").length).toBeGreaterThanOrEqual(9);
  }, 30000);
});

describe("What Privilege did (shared gateway-trace panel)", () => {
  it("Run shows the panel under the result: simulated, one exchange, the decisions in decide()'s order, and a refusal says where", async () => {
    await mount();
    const panel = await screen.findByTestId("gateway-trace", {}, T);
    expect(screen.getByTestId("verdict").compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // under the result
    expect(screen.getByTestId("gateway-trace-basis")).toHaveTextContent(/Simulated/);
    await userEvent.click(screen.getByTestId("sc-bulk-export"));
    await waitFor(() => expect(screen.getByTestId("trace-1")).toHaveTextContent(/refused at: Intent: deterministic patterns/), T);
    const list = within(screen.getByTestId("trace-1-decisions"));
    expect(list.getAllByRole("listitem").map((li) => li.querySelector("strong").textContent)).toEqual([
      "Intent: deterministic patterns", "Purpose: inside the declared profile", "Intent: similarity to a risky intent", "Behaviour: departure from this agent's normal"]);
    expect(screen.getByTestId("trace-1")).toHaveTextContent("HTTP 403");
  }, 60000);

  it("Live is the local engine, so the panel still says simulated (never 'Real gateway'), and the real AI Guard panel is absent until that call is run", async () => {
    await mount();
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("Live"), T);
    await waitFor(() => expect(screen.getByTestId("gateway-trace-basis")).toHaveTextContent(/Simulated/), T);
    expect(screen.getAllByTestId("gateway-trace")).toHaveLength(1);
    expect(screen.queryByText(/Real gateway/)).toBeNull();
  }, 60000);

  it("after the real AI Guard call a second panel shows that exchange as real, with no bearer anywhere on the page", async () => {
    const bearer = ["SECRET", "BEARER1234"].join("");
    const saved = [process.env.CENTRAL_AGENT_A2A_URL, process.env.CENTRAL_AGENT_A2A_BEARER];
    process.env.CENTRAL_AGENT_A2A_URL = "https://aigw.example.invalid/a2a";
    process.env.CENTRAL_AGENT_A2A_BEARER = bearer;
    const before = globalThis.fetch;
    globalThis.fetch = (u, init) => (String(u).includes("aigw.example.invalid")
      ? Promise.resolve(new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", error: { code: -32600, message: "request blocked by security policy" } }), { status: 200 }))
      : before(u, init));
    try {
      await mount();
      expect(screen.getAllByTestId("gateway-trace")).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: /Run the same call through live Privilege/ }));
      await screen.findByTestId("trace-2", {}, T);
      const panels = screen.getAllByTestId("gateway-trace");
      expect(panels).toHaveLength(2);
      expect(within(panels[1]).getByTestId("gateway-trace-basis")).toHaveTextContent(/Real gateway/);
      expect(screen.getByTestId("trace-2")).toHaveTextContent(/refused at/);
      expect(document.body.textContent).not.toContain(bearer);
    } finally {
      globalThis.fetch = before;
      ["CENTRAL_AGENT_A2A_URL", "CENTRAL_AGENT_A2A_BEARER"].forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    }
  }, 60000);
});

describe("safeText", () => {
  it("shows control and bidi characters as visible escapes", () => {
    expect(visible("a‮b\u0007c")).toBe("a\\u202eb\\u0007c");
    expect(visible("line\nbreak")).toBe("line\nbreak");
  });
});
