import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "ipb.workspace";
// Fake credentials assembled from parts: the source holds no literal a secret scanner would flag.
const HEX24 = ["a1b2c3d4e5f6", "a7b8c9d0e1f2"].join("");
const OWN = ["w", "0123456789abcdef"].join("-");
const SK = ["sk", "abcdefghijklmnop"].join("-");
const UUID = ["123e4567", "e89b", "12d3", "a456", "426614174000"].join("-");
const fresh = async () => { vi.resetModules(); return import("./workspace.js"); };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("workspace id", () => {
  it("is w- plus 16 hex digits, always contains a letter, and is never a credential-looking id", async () => {
    const { makeId, credentialLookingId } = await fresh();
    for (let i = 0; i < 300; i += 1) { const id = makeId(); expect(id).toMatch(/^w-[0-9a-f]{16}$/); expect(/[a-z]/.test(id)).toBe(true); expect(credentialLookingId(id)).toBe(false); }
    // the worst case: random bytes whose hex is all digits
    vi.spyOn(window.crypto, "getRandomValues").mockImplementation((a) => { a.fill(0x11); return a; });
    const id = makeId();
    expect(id).toBe("w-1111111111111111");
    expect(/[a-z]/.test(id)).toBe(true);
    expect(credentialLookingId(id)).toBe(false);
  });

  it("uses the stored id when it is usable and replaces a stored credential-looking one", async () => {
    window.sessionStorage.setItem(KEY, OWN);
    expect((await fresh()).workspaceId()).toBe(OWN);
    for (const bad of [SK, "pw-hunter2xyz", HEX24, "a".repeat(40), "BAD ID", "x".repeat(41), "password-1"]) {
      window.sessionStorage.setItem(KEY, bad);
      const id = (await fresh()).workspaceId();
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^w-[0-9a-f]{16}$/);
      expect(window.sessionStorage.getItem(KEY)).toBe(id);
    }
  });

  it("matches the server's refusal list for the same ids (hex of 24+, credential prefixes); 23 hex digits and 40 plain characters are usable", async () => {
    const { usableId } = await fresh();
    for (const id of [HEX24, "a".repeat(24), "sk-1", "pw-1", "token-abc", "key-9", UUID]) expect(usableId(id), id).toBe(false);
    for (const id of ["a".repeat(23), "default", "w-1", "ws-a", `${"xy-".repeat(13)}x`, "team-7"]) expect(usableId(id), id).toBe(true);
    expect(`${"xy-".repeat(13)}x`.length).toBe(40);
    expect(usableId(`${"xy-".repeat(13)}xy`)).toBe(false); // 41
  });

  it("works when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const m = await fresh();
    const a = m.workspaceId();
    expect(a).toMatch(/^w-/);
    expect(m.workspaceId()).toBe(a);
    expect(m.renewWorkspaceId()).not.toBe(a);
  });
});

describe("workspaceFetch", () => {
  it("sends X-Workspace", async () => {
    const f = vi.fn(async () => json(200, {})); vi.stubGlobal("fetch", f);
    const m = await fresh();
    await m.workspaceFetch("/api/runs");
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].headers["x-workspace"]).toBe(m.workspaceId());
  });

  it("on 400 bad_workspace throws the id away, makes a new one and retries exactly once", async () => {
    const m = await fresh();
    const first = m.workspaceId();
    const seen = [];
    const f = vi.fn(async (_u, o) => { seen.push(o.headers["x-workspace"]); return seen.length === 1 ? json(400, { error: "bad_workspace" }) : json(200, { ok: true }); });
    vi.stubGlobal("fetch", f);
    const r = await m.workspaceFetch("/api/runs");
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(seen[0]).toBe(first);
    expect(seen[1]).not.toBe(first);
    expect(window.sessionStorage.getItem(KEY)).toBe(seen[1]);
    expect(m.workspaceId()).toBe(seen[1]);
  });

  it("does not loop: a second refusal is returned as it is after one retry", async () => {
    const m = await fresh();
    const f = vi.fn(async () => json(400, { error: "bad_workspace" })); vi.stubGlobal("fetch", f);
    const r = await m.workspaceFetch("/api/runs");
    expect(r.status).toBe(400);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not retry other 400s, other errors or successes", async () => {
    const m = await fresh();
    for (const [status, body] of [[400, { error: "bad_policy" }], [400, { error: "bad_mode" }], [403, { error: "bad_workspace" }], [500, { error: "internal_error" }], [200, { error: "bad_workspace" }]]) {
      const f = vi.fn(async () => json(status, body)); vi.stubGlobal("fetch", f);
      const before = m.workspaceId();
      await m.workspaceFetch("/api/x", { method: "POST", body: "{}" });
      expect(f, `${status} ${body.error}`).toHaveBeenCalledTimes(1);
      expect(m.workspaceId()).toBe(before);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 400 })));
    await expect(m.workspaceFetch("/api/x")).resolves.toBeTruthy();
  });

  it("re-sends the same method and body on the retry", async () => {
    const m = await fresh();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (u, o) => { calls.push([u, o.method, o.body]); return calls.length === 1 ? json(400, { error: "bad_workspace" }) : json(200, {}); }));
    await m.workspaceFetch("/api/evaluate", { method: "POST", body: '{"a":1}' });
    expect(calls).toEqual([["/api/evaluate", "POST", '{"a":1}'], ["/api/evaluate", "POST", '{"a":1}']]);
  });
});
