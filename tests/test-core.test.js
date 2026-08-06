"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { cosineSimilarity } = require("../lib/embed");
const { hubPenalty, rarityBonus, reinforcementBonus } = require("../lib/relevance");
const { assertInsideVault, resolveVaultRoot, resolveVaultInfo, VAULT_ROOT } = require("../lib/config");
const { vaultName } = require("../lib/pglite");
const { contentHash } = require("../tools/yolo-crud");
const { assertValidVector } = require("../lib/pglite");

// --- embed.js ---

describe("cosineSimilarity", () => {
  it("returns 0 for orthogonal vectors", () => {
    assert.strictEqual(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  });

  it("returns 1 for same-direction vectors", () => {
    assert.strictEqual(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.ok(Math.abs(cosineSimilarity([2, 3], [4, 6]) - 1) < 1e-10);
  });

  it("returns 0 when one vector is all zeros", () => {
    assert.strictEqual(cosineSimilarity([0, 0], [1, 2]), 0);
  });

  it("returns -1 for opposite vectors", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2], [-1, -2]) + 1) < 1e-10);
  });

  it("handles negative components correctly", () => {
    const result = cosineSimilarity([-1, 1], [1, -1]);
    assert.ok(result < 0);
  });
});

// --- relevance.js ---

describe("hubPenalty", () => {
  it("returns 1 for degree <= 0", () => {
    assert.strictEqual(hubPenalty(0), 1);
    assert.strictEqual(hubPenalty(-1), 1);
  });

  it("decreases as degree grows beyond 1", () => {
    const d2 = hubPenalty(2);
    const d7 = hubPenalty(7);
    assert.ok(d2 < 1, `expected d2(${d2}) < 1`);
    assert.ok(d7 < d2, `expected d7(${d7}) < d2(${d2})`);
  });

  it("returns a meaningful value for high degree", () => {
    const d20 = hubPenalty(20);
    assert.ok(d20 > 0 && d20 < 0.5);
  });
});

describe("rarityBonus", () => {
  it("returns 2 for zero outLinks", () => {
    assert.strictEqual(rarityBonus(0), 2);
  });

  it("returns 2 for one outLink", () => {
    assert.strictEqual(rarityBonus(1), 2);
  });

  it("decreases as outLinks grow", () => {
    assert.strictEqual(rarityBonus(2), 1.5);
    assert.strictEqual(rarityBonus(5), 1.2);
  });
});

describe("reinforcementBonus", () => {
  it("returns 1 for a single signal", () => {
    assert.strictEqual(reinforcementBonus(1), 1);
  });

  it("increases linearly with signal count", () => {
    assert.strictEqual(reinforcementBonus(2), 1.3);
    assert.strictEqual(reinforcementBonus(3), 1.6);
    assert.strictEqual(reinforcementBonus(4), 1.9);
  });
});

// --- config.js ---

describe("assertInsideVault", () => {
  let vaultRoot;

  it("returns resolved path for a valid relative path", () => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
    const result = assertInsideVault("wiki/test.md", vaultRoot);
    const expected = path.resolve(vaultRoot, "wiki/test.md");
    assert.strictEqual(result, expected);
  });

  it("throws for path traversal attempt", () => {
    assert.throws(() => {
      assertInsideVault("../../../etc/passwd", vaultRoot);
    });
  });

  it("throws for absolute path outside vault", () => {
    const outsidePath = path.join(os.tmpdir(), "outside.txt");
    assert.throws(() => {
      assertInsideVault(outsidePath, vaultRoot);
    });
  });
});

describe("resolveVaultRoot", () => {
  it("returns default VAULT_ROOT when called without arguments", () => {
    const result = resolveVaultRoot();
    assert.strictEqual(typeof result, "string");
    assert.ok(result.length > 0);
  });

  it("returns the absolute path unchanged when given one", () => {
    const absPath = path.resolve(os.tmpdir(), "some-vault");
    const result = resolveVaultRoot(absPath);
    assert.strictEqual(result, absPath);
  });

  it("throws on an unknown vault name (no silent fallback)", () => {
    assert.throws(
      () => resolveVaultRoot("nonexistent-vault-xyz-123"),
      /Unknown vault: nonexistent-vault-xyz-123/
    );
  });
});

describe("resolveVaultInfo", () => {
  it("returns vaultRoot and vaultName for default vault", () => {
    const info = resolveVaultInfo();
    assert.strictEqual(typeof info.vaultRoot, "string");
    assert.strictEqual(typeof info.vaultName, "string");
    assert.strictEqual(info.vaultName, path.basename(info.vaultRoot));
  });
});

// --- pglite.js ---

describe("vaultName", () => {
  it("returns the basename of VAULT_ROOT", () => {
    const name = vaultName();
    assert.strictEqual(name, path.basename(VAULT_ROOT));
    assert.ok(name.length > 0);
  });
});

describe("assertValidVector", () => {
  it("does not throw for a valid vector", () => {
    assert.doesNotThrow(() => assertValidVector([0.1, 0.2, 0.3]));
    assert.doesNotThrow(() => assertValidVector([0]));
    assert.doesNotThrow(() => assertValidVector([-1, 0, 1]));
  });

  it("throws for non-array input", () => {
    assert.throws(() => assertValidVector("not an array"));
    assert.throws(() => assertValidVector(null));
    assert.throws(() => assertValidVector(undefined));
    assert.throws(() => assertValidVector(123));
  });

  it("throws for empty array", () => {
    assert.throws(() => assertValidVector([]));
  });

  it("throws when any element is not a finite number", () => {
    assert.throws(() => assertValidVector([1, NaN]));
    assert.throws(() => assertValidVector([1, Infinity]));
    assert.throws(() => assertValidVector([1, "2"]));
    assert.throws(() => assertValidVector([1, null]));
  });
});

// --- yolo-crud.js ---

describe("contentHash", () => {
  it("returns a 16-character hex string", () => {
    const hash = contentHash("hello");
    assert.strictEqual(hash.length, 16);
    assert.ok(/^[0-9a-f]{16}$/.test(hash));
  });

  it("is deterministic", () => {
    assert.strictEqual(contentHash("hello"), contentHash("hello"));
  });

  it("produces different hashes for different inputs", () => {
    assert.notStrictEqual(contentHash("hello"), contentHash("world"));
  });
});
