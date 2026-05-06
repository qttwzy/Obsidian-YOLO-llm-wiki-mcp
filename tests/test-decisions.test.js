"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { listDecisions, createDecision, resolveDecision } = require("../tools/decisions");
const { VAULT_ROOT } = require("../lib/config");

describe("parseDecisions", () => {
  // Internal parseDecisions is tested indirectly through listDecisions

  it("parses pending and resolved decisions from decisions.md", () => {
    const result = listDecisions({ vaultRoot: VAULT_ROOT });
    assert.ok(result.summary);
    assert.strictEqual(typeof result.summary.pendingCount, "number");
    assert.strictEqual(typeof result.summary.resolvedCount, "number");
    assert.ok(Array.isArray(result.pending));
    assert.ok(Array.isArray(result.resolved));
  });

  it("filters by status: pending", () => {
    const result = listDecisions({ status: "pending", vaultRoot: VAULT_ROOT });
    assert.ok(Array.isArray(result.pending));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "resolved"), false);
  });

  it("filters by status: resolved", () => {
    const result = listDecisions({ status: "resolved", vaultRoot: VAULT_ROOT });
    assert.ok(Array.isArray(result.resolved));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "pending"), false);
  });
});

describe("createDecision and resolveDecision", () => {
  const testId = "DEC-999";
  let tmpDir;

  it("creates a decision entry with test ID and cleans up", () => {
    // Create a temp vault with a wiki/decisions.md for isolated testing
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dec-test-"));
    const wikiDir = path.join(tmpDir, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "decisions.md"),
      "## 待决 (pending)\n\n_(当前无待决条目)_\n\n## 已决 (resolved)\n\n_(当前无已决条目)_\n",
      "utf-8"
    );

    // Create
    const created = createDecision({
      id: testId,
      situation: "Test: should we run this test?",
      options: [
        { label: "A", action: "Yes", consequence: "Tests pass" },
        { label: "B", action: "No", consequence: "No tests" },
      ],
      vaultRoot: tmpDir,
    });
    assert.strictEqual(created.status, "created");
    assert.strictEqual(created.id, testId);

    // Verify it appears in pending
    const pending = listDecisions({ status: "pending", vaultRoot: tmpDir });
    const found = pending.pending.find((d) => d.id === testId);
    assert.ok(found);
    assert.ok(found.situation.includes("should we run this test"));
    assert.strictEqual(found.options.length, 2);

    // Resolve
    const resolved = resolveDecision({
      id: testId,
      option: "A",
      vaultRoot: tmpDir,
    });
    assert.strictEqual(resolved.status, "resolved");

    // Verify moved to resolved
    const after = listDecisions({ vaultRoot: tmpDir });
    assert.strictEqual(after.pending.find((d) => d.id === testId), undefined);
    const foundResolved = after.resolved.find((d) => d.id === testId);
    assert.ok(foundResolved);
  });
});
