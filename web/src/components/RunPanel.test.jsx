import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { workspaceFetch } from "../workspace";
import RunPanel from "./RunPanel";

vi.mock("../workspace", () => ({ workspaceFetch: vi.fn() }));

const record = (runId, source = "mock") => ({ runId, source, excerpt: true, truncated: false, rows: [], coverage: {}, reasons: {}, partial: {}, summary: { allowed: 0, refused: 0, blocked: 0, info: 0, unverified: 0 }, window: { from: "2026-11-24T00:00:00.000Z", to: "2026-11-24T00:00:01.000Z" } });
const answer = (ok, body) => ({ ok, json: async () => body });

beforeEach(() => { vi.mocked(workspaceFetch).mockReset(); });
afterEach(() => cleanup());

describe("RunPanel", () => {
  it("never shows the previous run's record while the new one loads", async () => {
    let releaseSecond;
    vi.mocked(workspaceFetch)
      .mockResolvedValueOnce(answer(true, record("r1")))
      .mockReturnValueOnce(new Promise((res) => { releaseSecond = () => res(answer(true, record("r2"))); }));
    const { rerender } = render(<RunPanel runId="r1" mode="mock" />);
    await screen.findByRole("heading", { name: "What each layer logged for this run" });
    rerender(<RunPanel runId="r2" mode="mock" />);
    expect(screen.queryByRole("heading", { name: "What each layer logged for this run" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Collecting/);
    releaseSecond();
    await waitFor(() => expect(screen.getByRole("heading", { name: "What each layer logged for this run" })).toBeTruthy());
  });

  it.each([
    ["an HTML page with status 200", answer(true, "<html>not json</html>")],
    ["an empty body", answer(true, null)],
    ["an array", answer(true, [])],
    ["a JSON string", answer(true, "hello")],
    ["an empty object", answer(true, {})],
    ["a 404 JSON answer", answer(false, { error: "run_not_found" })],
  ])("shows an alert, not the empty state, for %s", async (_name, reply) => {
    vi.mocked(workspaceFetch).mockResolvedValueOnce(reply);
    render(<RunPanel runId="r1" mode="mock" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Could not show this run's record/));
  });

  it("the panel renders for a Live run, asks for the live record, and says the lab's engine computed the rows", async () => {
    vi.mocked(workspaceFetch).mockResolvedValueOnce(answer(true, record("r1", "mock")));
    render(<RunPanel runId="r1" mode="live" />);
    await screen.findByRole("heading", { name: "What each layer logged for this run" });
    expect(vi.mocked(workspaceFetch).mock.calls[0][0]).toMatch(/mode=live/);
    expect(screen.getByTestId("run-live-note").textContent).toMatch(/in-process engine computed these rows.*simulated, not logged/);
  });

  it("refuses a record whose source is not the page's mode", async () => {
    vi.mocked(workspaceFetch).mockResolvedValueOnce(answer(true, record("r1", "real")));
    render(<RunPanel runId="r1" mode="mock" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
