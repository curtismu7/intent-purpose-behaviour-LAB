import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createApp, startHttpServer } from "../../server/src/app.js";
import { createHealth } from "../../server/src/health.js";
import App from "./App";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
let server; let base; const realFetch = globalThis.fetch;
beforeAll(async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  ({ server, url: base } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, configFile: "/nonexistent/customer.config.json" }) }));
  base = base.replace(/\/$/, "");
  globalThis.fetch = (u, init = {}) => realFetch(typeof u === "string" && u.startsWith("/") ? `${base}${u}` : u, { ...init, headers: { origin: base, ...(init.headers || {}) } });
});
afterAll(async () => { globalThis.fetch = realFetch; await new Promise((r) => server.close(r)); });
beforeEach(() => { cleanup(); window.location.hash = ""; });

const T = { timeout: 15000 };
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  const before = globalThis.fetch;
  globalThis.fetch = (u, init) => (u === "/api/shelf" ? Promise.resolve(new Response(JSON.stringify(payload))) : before(u, init));
  return () => { globalThis.fetch = before; };
}

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    const restore = withShelf({ shelfUrl: "http://shelf.example", demos: [
      { id: "other-lab", verification: mark("in-progress", "In progress") },
      { id: "intent-purpose-behaviour-lab", verification: mark("verified", "Verified", { note: "Every tab run on the mock" }) },
    ] });
    try {
      render(<App />);
      const bar = within(await screen.findByTestId("top-menu", {}, T));
      expect(await bar.findByText("Verified", {}, T)).toBeInTheDocument();
      expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
      expect(bar.queryByText("In progress")).toBeNull();
      expect(document.querySelectorAll(".verify")).toHaveLength(1);
      expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every tab run on the mock"));
    } finally { restore(); }
  }, 60000);

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "intent-purpose-behaviour-lab", verification: null }] }]) {
      const restore = withShelf(payload);
      try {
        const { unmount } = render(<App />);
        const bar = within(await screen.findByTestId("top-menu", {}, T));
        expect(await bar.findByRole("link", { name: "Shelf" }, T)).toBeInTheDocument(); // the shelf answered, and still no badge
        expect(document.querySelector(".verify")).toBeNull();
        unmount();
      } finally { restore(); }
    }
  }, 60000);
});
