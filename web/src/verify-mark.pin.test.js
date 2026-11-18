// The vendored shared/verify-mark files (VerifyMark.jsx, VerifyMark.css) match their pin files byte for byte. They come from
// curtismu7/AI-DEMO-Standalone shared/verify-mark: change them there, re-pin, re-vendor; never edit them here.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "components");
const sha = (file) => createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex");
// The canonical hashes (AI-DEMO-Standalone #238): the pin files must not have been re-pinned to a hand-edited copy.
const CANONICAL = {
  "VerifyMark.jsx": "5c5025e7ed2e9df8d40d313d258fa2a93368f7286d33959d81c61cd469c3cc90",
  "VerifyMark.css": "4774585cd47c3affc739d3d99fa6843d62f607d8d3e69b4438de756ac3d49dc5",
};

describe("vendored verify-mark", () => {
  it("matches VerifyMark.sha256 and VerifyMark.css.sha256, and the canonical hashes", () => {
    for (const [file, pinFile] of [["VerifyMark.jsx", "VerifyMark.sha256"], ["VerifyMark.css", "VerifyMark.css.sha256"]]) {
      const [hash, name] = fs.readFileSync(path.join(dir, pinFile), "utf8").trim().split(/\s+/);
      expect(name, pinFile).toBe(file);
      expect(sha(file), file).toBe(hash);
      expect(hash, `${file} pin`).toBe(CANONICAL[file]);
    }
  });
});
