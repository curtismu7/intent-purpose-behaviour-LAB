// The two new tabs, driven through the real App against the real Express app: the catalogue renders the 25
// measured intents, the simulator classifies, the customer intent editor saves and the clone rule shows.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApp, startHttpServer } from "../../server/src/app.js";
import { createHealth } from "../../server/src/health.js";
import App from "./App";

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
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ }
  window.location.hash = "";
});

const T = { timeout: 15000 };
const nav = () => within(screen.getByRole("navigation", { name: "Lab sections" }));

describe("intent catalogue tab", () => {
  it("renders the measured built-in intents and labels the source", async () => {
    window.location.hash = "#intents";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("intent-source")).toHaveTextContent(/measured snapshot/i), T);
    expect(screen.getByTestId("intent-cards")).toBeInTheDocument();
    expect(screen.getByTestId("intent-detection_and_audit")).toHaveTextContent("detection_and_audit");
    expect(screen.getByTestId("intent-data_exfiltration")).toHaveTextContent("Acting");
    expect(screen.getByTestId("intent-self_service")).toHaveTextContent("Sibling");
    expect(screen.getByTestId("intent-source")).toHaveTextContent(/measured snapshot/i);
    await waitFor(() => expect(screen.getByText(/25 intents/)).toBeInTheDocument(), T);
  });

  it("the simulator classifies a call and shows pattern matches and similarity", async () => {
    window.location.hash = "#intents";
    render(<App />);
    await screen.findByTestId("intent-simulator", {}, T);
    await userEvent.click(screen.getByRole("button", { name: "A bulk export" }));
    await waitFor(() => expect(screen.getByTestId("sim-risk")).toHaveTextContent("data_exfiltration"), T);
    expect(screen.getByTestId("sim-result")).toHaveTextContent(/pattern matches/i);
    // an audit question (a sibling intent) scores nothing risky
    await userEvent.click(screen.getByRole("button", { name: "An audit question" }));
    await waitFor(() => expect(screen.getByTestId("sim-none")).toBeInTheDocument(), T);
  });

  it("a card opens to show its real regex patterns", async () => {
    window.location.hash = "#intents";
    render(<App />);
    await screen.findByTestId("intent-cards", {}, T);
    await userEvent.click(within(screen.getByTestId("intent-security_control_bypass")).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("intent-security_control_bypass")).toHaveTextContent(/--no-verify/), T);
  });
});

describe("customer intent tab", () => {
  it("loads the template, saves the intent, and the clone rule shadows nothing until the name matches", async () => {
    window.location.hash = "#customer-intent";
    render(<App />);
    await screen.findByTestId("ci-template", {}, T);
    await userEvent.click(screen.getByTestId("ci-template"));
    const editor = screen.getByTestId("ci-editor");
    expect(within(editor).getByLabelText(/Name/)).toHaveValue("demo_data_exfiltration");
    await userEvent.click(screen.getByTestId("ci-save"));
    await waitFor(() => expect(screen.getByTestId("ci-demo_data_exfiltration")).toBeInTheDocument(), T);
    expect(screen.getByTestId("ci-msg")).toHaveTextContent(/saved/);
    // see the effect: the custom pattern hits
    await userEvent.click(screen.getByRole("button", { name: "Hits your pattern" }));
    await waitFor(() => expect(screen.getByTestId("ci-custom-hit")).toHaveTextContent("demo_data_exfiltration"), T);
    // a twin does not hit
    await userEvent.click(screen.getByRole("button", { name: "A twin (should not score)" }));
    await waitFor(() => expect(screen.getByTestId("ci-sim")).toHaveTextContent(/Pattern matches: none/i), T);
    // delete it again
    const row = screen.getByTestId("ci-demo_data_exfiltration");
    await userEvent.click(within(row).getByRole("button", { name: "delete" }));
    await waitFor(() => expect(screen.queryByTestId("ci-demo_data_exfiltration")).not.toBeInTheDocument(), T);
  });

  it("a hostile pattern is refused with a reason, not a crash", async () => {
    window.location.hash = "#customer-intent";
    render(<App />);
    await screen.findByTestId("ci-editor", {}, T);
    await userEvent.type(screen.getByLabelText(/Patterns/), "(a+)+$");
    await waitFor(() => expect(screen.getByTestId("ci-pattern-check")).toHaveTextContent(/refused/), T);
    await userEvent.type(screen.getByLabelText(/Name/), "evil_intent");
    await userEvent.click(screen.getByTestId("ci-save"));
    await waitFor(() => expect(screen.getByTestId("ci-msg")).toHaveTextContent(/backtrack/i), T);
    expect(screen.queryByTestId("ci-evil_intent")).not.toBeInTheDocument();
  });
});
