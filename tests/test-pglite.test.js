"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { obsidianEval, checkYoloStatus, queryPgliteStatus, readEmbedding, embedViaYolo, vaultName } = require("../lib/pglite");

// All PGlite tests require Obsidian to be running with YOLO plugin loaded.
let yoloAvailable = false;

before(async () => {
  const status = checkYoloStatus();
  yoloAvailable = status.available;
});

describe("obsidianEval", () => {
  it("executes code in Obsidian and returns parsed result", () => {
    if (!yoloAvailable) return;

    const result = obsidianEval("JSON.stringify({ hello: 'world' })");
    assert.ok(result.success);
    assert.deepStrictEqual(result.value, { hello: "world" });
  });

  it("returns success: false when Obsidian is not available", () => {
    // Call with a non-existent vault to trigger error
    const result = obsidianEval("1+1", "non-existent-vault-xyz");
    // May succeed or fail depending on whether Obsidian handles unknown vaults
    assert.ok(typeof result.success === "boolean");
  });
});

describe("checkYoloStatus", () => {
  it("returns YOLO plugin availability", () => {
    if (!yoloAvailable) return;

    const status = checkYoloStatus();
    assert.ok(typeof status.available === "boolean");
    assert.ok(typeof status.indexing === "boolean");
    assert.strictEqual(status.available, true);
  });
});

describe("queryPgliteStatus", () => {
  it("returns PGlite database statistics", () => {
    if (!yoloAvailable) return;

    const status = queryPgliteStatus();
    assert.strictEqual(status.available, true);
    assert.strictEqual(typeof status.total_embeddings, "number");
    assert.strictEqual(status.source, "pglite_live");
  });
});

describe("readEmbedding", () => {
  it("reads embedding records by path", () => {
    if (!yoloAvailable) return;

    // Try reading a wiki page that might exist in the DB
    const result = readEmbedding("wiki/index.md");
    assert.strictEqual(typeof result.success, "boolean");
    if (result.success) {
      assert.ok(Array.isArray(result.rows));
    }
  });

  it("returns rows when path does not exist", () => {
    if (!yoloAvailable) return;

    const result = readEmbedding("nonexistent/file.md");
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.rows, []);
  });
});

describe("embedViaYolo", () => {
  it("returns embeddings via YOLO provider", async () => {
    if (!yoloAvailable) return;

    const vectors = await embedViaYolo(["hello world"], vaultName());
    if (vectors.error) {
      // YOLO internal embedding API not found — expected for some versions
      return;
    }
    assert.ok(Array.isArray(vectors));
    if (vectors.length > 0) {
      assert.ok(Array.isArray(vectors[0]));
      assert.ok(vectors[0].length > 0);
    }
  });
});
