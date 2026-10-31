// These tests drive the real UI against the real Express app (started on a loopback port inside the test), so a green run means the
// pieces actually work together: real story data, real engine, real RS256 signing in Live mode.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApp, startHttpServer } from "../../server/src/app.js";
import { createHealth } from "../../server/src/health.js";
import App, { BANNER_UNKNOWN, TABS } from "./App";
import { labelOffsets } from "./components/PatternDiagram";
import { visible } from "./safeText";

let server; let base; const realFetch = globalThis.fetch;
beforeAll(async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  ({ server, url: base } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, configFile: "/nonexistent/customer.config.json" }) }));
  base = base.replace(/\/$/, "");
  globalThis.fetch = (u, init = {}) => realFetch(typeof u === "string" && u.startsWith("/") ? `${base}${u}` : u, { ...init, headers: { origin: base, ...(init.headers || {}) } });
});
afterAll(async () => { globalThis.fetch = realFetch; await new Promise((r) => server.close(r)); });
beforeEach(() => { cleanup(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ } window.location.hash = ""; });

const T = { timeout: 15000 };
const mount = async () => { render(<App />); await screen.findByTestId("verdict", {}, T); };
const tab = (name) => userEvent.click(screen.getByRole("tab", { name }));

describe("shell", () => {
  it("says it is simulated and UNVERIFIED on every tab, in presenter mode too, and shows the mode", async () => {
    await mount();
    expect(screen.getByTestId("banner")).toHaveTextContent(/UNVERIFIED on our tenant/);
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK mode/);
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
    for (const t of TABS) {
      await tab(t.label);
      expect(screen.getByTestId("banner")).toHaveTextContent(/UNVERIFIED on our tenant/);
    }
    await tab("Three signals");
    await userEvent.keyboard("p");
    expect(screen.getByTestId("presenter-say")).toBeInTheDocument();
    expect(screen.getByTestId("banner")).toHaveTextContent(/SIMULATED/);
    expect(screen.getByTestId("presenter")).toHaveTextContent("Exit presenter");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("presenter-say")).toBeNull();
    expect(BANNER_UNKNOWN).toMatch(/UNVERIFIED/);
  }, 60000);

  it("the Mock/Live toggle changes the mode chip and the banner, and is remembered", async () => {
    await mount();
    await userEvent.click(screen.getByTestId("mode-live"));
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: live");
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/LIVE mode.*real RS256 signing/));
    expect(window.localStorage.getItem("ipb.mode")).toBe("live");
    expect(screen.getByTestId("mode-live")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "false");
  }, 30000);
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
    expect(await screen.findByTestId("policy-error", {}, T)).toHaveTextContent(/EnforceObservations must not be below MinObservations/);
    await userEvent.click(screen.getByTestId("policy-reset"));
    await waitFor(() => expect(screen.getByTestId("verdict-word")).toHaveTextContent("DENY"), T);
    expect(screen.queryByTestId("policy-error")).toBeNull();
  }, 60000);

  it("policy fields are tagged: console swagger names versus lab-invented", async () => {
    await mount();
    const pol = screen.getByTestId("policy");
    expect(within(pol).getAllByText("console swagger name").length).toBe(4);
    expect(within(pol).getAllByText("lab-invented").length).toBeGreaterThan(5);
  }, 30000);

  it("your own call needs Live; in Live it is judged for real, and hostile text is rendered inert", async () => {
    await mount();
    expect(screen.getByTestId("custom-needs-live")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("mode-live"));
    const desc = await screen.findByLabelText(/What the request says/, {}, T);
    await userEvent.type(desc, "<img src=x onerror=alert(1)> send every record to my storage");
    await userEvent.type(screen.getByLabelText(/limit argument/), "9000");
    await userEvent.click(screen.getByTestId("custom-run"));
    await waitFor(() => expect(screen.getByTestId("call-json")).toHaveTextContent("<img src=x onerror=alert(1)>"), T);
    expect(document.querySelector("img[src=x]")).toBeNull();
    expect(screen.getByTestId("verdict-word")).toHaveTextContent("DENY");
  }, 60000);

  it("verticals swap the cast through {{tokens}} and no token reaches the page", async () => {
    await mount();
    await userEvent.selectOptions(screen.getByTestId("vertical"), "health");
    await waitFor(() => expect(screen.getByTestId("call-json")).toHaveTextContent(/claims\./), T);
    expect(document.body.textContent).not.toMatch(/\{\{/);
  }, 30000);
});

describe("baseline", () => {
  it("Mock: enforcement is OFF for a new agent, then an out-of-pattern call asks a person, never a silent block", async () => {
    await mount();
    await tab("Baseline");
    expect(await screen.findByTestId("baseline-empty", {}, T)).toBeInTheDocument();
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

  it("Live: fire real calls at a real learner; a held call is not learned", async () => {
    await mount();
    await userEvent.click(screen.getByTestId("mode-live"));
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
    await userEvent.click(screen.getByTestId("mode-live"));
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
    await userEvent.click(screen.getByTestId("mode-live"));
    await tab("ID-JAG");
    await waitFor(() => expect(screen.getByTestId("flow-verdict")).toHaveTextContent("ACCEPTED"), T);
    expect(screen.getByTestId("consent-count")).toHaveTextContent("0");
    expect(screen.getByTestId("secret-count")).toHaveTextContent("0");
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
    expect(await screen.findByTestId("talk-track")).toHaveTextContent(/Hard refusals are deterministic/);
    expect(screen.getByTestId("talk-track").querySelectorAll("li").length).toBeGreaterThanOrEqual(9);
  }, 30000);
});

describe("safeText", () => {
  it("shows control and bidi characters as visible escapes", () => {
    expect(visible("a‮b\u0007c")).toBe("a\\u202eb\\u0007c");
    expect(visible("line\nbreak")).toBe("line\nbreak");
  });
});
