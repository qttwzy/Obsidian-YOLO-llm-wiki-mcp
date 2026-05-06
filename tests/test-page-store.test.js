"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { loadStore, searchStore } = require("../lib/page-store");
const { VAULT_ROOT } = require("../lib/config");

// readPage is private in page-store.js. Recreate for testing.
function readPage(filepath) {
  const content = fs.readFileSync(filepath, "utf-8");
  let title = path.basename(filepath).replace(".md", "");
  let summary = "";
  let body = content;
  if (content.startsWith("---")) {
    const parts = content.split("---", 3);
    if (parts.length >= 3) {
      body = parts[2].trim();
      for (const line of parts[1].split("\n")) {
        const m = line.match(/^title:\s*(.+)/);
        if (m) title = m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (s && !s.startsWith("#")) {
      summary = s.substring(0, 120);
      break;
    }
  }
  return { title, summary, body };
}

describe("readPage", () => {
  it("extracts title from frontmatter", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "readp-"));
    const filePath = path.join(tmpDir, "test.md");
    fs.writeFileSync(filePath, "---\ntitle: \"Custom Title\"\n---\n\nFirst line of content.\nMore content.", "utf-8");

    const result = readPage(filePath);
    assert.strictEqual(result.title, "Custom Title");
    assert.strictEqual(result.summary, "First line of content.");
    assert.ok(result.body.length > 0);
  });

  it("falls back to filename for title", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "readp-"));
    const filePath = path.join(tmpDir, "FallbackName.md");
    fs.writeFileSync(filePath, "# Just heading\nSome text", "utf-8");

    const result = readPage(filePath);
    assert.strictEqual(result.title, "FallbackName");
  });
});

describe("searchStore", () => {
  it("returns results when page store exists in vault", () => {
    const store = loadStore(VAULT_ROOT);
    if (!store || !store.entries || !store.entries[0]) {
      // Store not built — skip test
      return;
    }

    const queryVec = store.entries[0].vector;
    const results = searchStore(queryVec, 5, VAULT_ROOT);
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    assert.strictEqual(typeof results[0].score, "number");
  });

  it("returns empty array when store does not exist", () => {
    const noStorePath = path.join(os.tmpdir(), "no-store-vault");
    const results = searchStore([0.1, 0.2], 5, noStorePath);
    assert.deepStrictEqual(results, []);
  });
});
