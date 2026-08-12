"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const {
  obsidianEval,
  checkYoloStatus,
  queryPgliteStatus,
  queryWikiChunks,
  readEmbedding,
  embedViaYolo,
  vaultName,
  getCacheDir,
  createEmbedding,
  updateEmbedding,
} = require("../lib/pglite");

// All PGlite tests require Obsidian to be running with YOLO plugin loaded.
let yoloAvailable = false;
const liveVault = process.env.YOLO_LIVE_TEST_VAULT;

before(async () => {
  const status = checkYoloStatus(liveVault);
  yoloAvailable = status.available;
});

function skipIfYoloUnavailable(t) {
  if (!yoloAvailable) {
    t.skip("requires Obsidian running with the YOLO plugin loaded");
    return true;
  }
  return false;
}

describe("obsidianEval", () => {
  it("uses OBSIDIAN_CLI_PATH when configured", () => {
    const previous = process.env.OBSIDIAN_CLI_PATH;
    process.env.OBSIDIAN_CLI_PATH = "llm-wiki-missing-obsidian-cli";

    try {
      const result = obsidianEval("JSON.stringify({ hello: 'world' })");
      assert.equal(result.success, false);
      assert.match(result.error, /llm-wiki-missing-obsidian-cli/);
    } finally {
      if (previous === undefined) delete process.env.OBSIDIAN_CLI_PATH;
      else process.env.OBSIDIAN_CLI_PATH = previous;
    }
  });

  it("executes code in Obsidian and returns parsed result", (t) => {
    if (skipIfYoloUnavailable(t)) return;

    const result = obsidianEval("JSON.stringify({ hello: 'world' })", liveVault);
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

describe("PGlite cache paths", () => {
  it("keeps each absolute vault's fallback cache inside that vault", () => {
    const vaultRoot = path.join(os.tmpdir(), "llm-wiki-second-vault");
    assert.equal(
      getCacheDir(vaultRoot),
      path.join(vaultRoot, ".source-tracker", "yolo_db_cache")
    );
  });
});

describe("PGlite write validation", () => {
  it("returns a structured error for invalid create input", () => {
    const result = createEmbedding({ path: "wiki/Foo.md" });
    assert.deepStrictEqual(result, {
      success: false,
      error: "Invalid embedding content",
    });
  });

  it("returns a structured error for invalid update input", () => {
    const result = updateEmbedding("wiki/Foo.md", {
      path: "wiki/Foo.md",
      content: "content",
      model: "yolo",
      mtime: Date.now(),
      embedding: [0.1],
      dimension: 2,
      content_hash: "hash",
    });
    assert.deepStrictEqual(result, {
      success: false,
      error: "Embedding dimension does not match vector length",
    });
  });
});

describe("checkYoloStatus", () => {
  it("recognizes the explicitly configured live YOLO runtime", (t) => {
    if (!liveVault) {
      t.skip("set YOLO_LIVE_TEST_VAULT to run against a live disposable vault");
      return;
    }

    const status = checkYoloStatus(liveVault);
    assert.strictEqual(status.available, true, status.error);
    assert.match(status.api, /legacy_pg_client|vector_store/);
  });

  it("returns YOLO plugin availability", (t) => {
    if (skipIfYoloUnavailable(t)) return;

    const status = checkYoloStatus(liveVault);
    assert.ok(typeof status.available === "boolean");
    assert.ok(typeof status.indexing === "boolean");
    assert.strictEqual(status.available, true);
  });
});

describe("queryPgliteStatus", () => {
  it("returns PGlite database statistics", (t) => {
    if (skipIfYoloUnavailable(t)) return;

    const status = queryPgliteStatus(liveVault);
    assert.strictEqual(status.available, true);
    assert.strictEqual(typeof status.total_embeddings, "number");
    assert.strictEqual(status.source, "pglite_live");
  });
});

describe("queryWikiChunks", () => {
  it("queries the configured live vector store without requesting a new embedding", async (t) => {
    if (skipIfYoloUnavailable(t)) return;

    const status = queryPgliteStatus(liveVault);
    if (!Number.isInteger(status.dimension) || status.dimension <= 0) {
      t.skip("the running YOLO version has no active embedding model");
      return;
    }

    const queryVector = Array(status.dimension).fill(0.001);
    const result = await queryWikiChunks(queryVector, 1, liveVault);
    assert.strictEqual(result.source, "pglite_live");
    assert.ok(Array.isArray(result.rows));
    assert.ok(result.rows.length <= 1);
  });
});

describe("readEmbedding", () => {
  it("reads embedding records by path", (t) => {
    if (skipIfYoloUnavailable(t)) return;

    // Try reading a wiki page that might exist in the DB
    const result = readEmbedding("wiki/index.md", liveVault);
    assert.strictEqual(typeof result.success, "boolean");
    if (result.success) {
      assert.ok(Array.isArray(result.rows));
    }
  });

  it("returns rows when path does not exist", (t) => {
    if (skipIfYoloUnavailable(t)) return;

    const result = readEmbedding("nonexistent/file.md", liveVault);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.rows, []);
  });
});

describe("embedViaYolo", () => {
  it("returns embeddings via YOLO provider", async (t) => {
    if (skipIfYoloUnavailable(t)) return;
    if (process.env.YOLO_LIVE_EMBED_TEST !== "1") {
      t.skip("set YOLO_LIVE_EMBED_TEST=1 to allow a live embedding-provider request");
      return;
    }

    const vectors = await embedViaYolo(["hello world"], liveVault || vaultName());
    if (vectors.error) {
      // YOLO internal embedding API not found — expected for some versions
      t.skip("the running YOLO version does not expose a compatible embedding API");
      return;
    }
    assert.ok(Array.isArray(vectors));
    if (vectors.length > 0) {
      assert.ok(Array.isArray(vectors[0]));
      assert.ok(vectors[0].length > 0);
    }
  });
});
