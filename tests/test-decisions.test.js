"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { listDecisions, createDecision, resolveDecision, correctDecision, finalizeCorrection } = require("../tools/decisions");
const { VAULT_ROOT } = require("../lib/config");

/** Create a temp vault with a seeded decisions.md and return its root path. */
function makeTempVault(seed) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dec-test-"));
  const wikiDir = path.join(tmpDir, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(
    path.join(wikiDir, "decisions.md"),
    seed || "## 待决 (pending)\n\n_(当前无待决条目)_\n\n## 已决 (resolved)\n\n_(当前无已决条目)_\n",
    "utf-8"
  );
  return tmpDir;
}

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

  it("throws on corrupt header (non-empty file, no section match)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dec-corrupt-"));
    const wikiDir = path.join(tmpDir, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    // No valid section headers — both pendingMatch and resolvedMatch will be null.
    fs.writeFileSync(path.join(wikiDir, "decisions.md"), "garbage content with no headers\n", "utf-8");
    assert.throws(
      () => listDecisions({ vaultRoot: tmpDir }),
      /neither.*pending.*resolved.*header was found/
    );
  });

  it("does not throw on empty file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dec-empty-"));
    const wikiDir = path.join(tmpDir, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "decisions.md"), "", "utf-8");
    const result = listDecisions({ vaultRoot: tmpDir });
    assert.strictEqual(result.summary.pendingCount, 0);
    assert.strictEqual(result.summary.resolvedCount, 0);
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

describe("createDecision ID collision fix", () => {
  it("auto-generates a non-colliding ID after a resolve shrinks pending", () => {
    const tmpDir = makeTempVault();

    // Create DEC-001 and DEC-002 in pending.
    createDecision({
      id: "DEC-001",
      situation: "first",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });
    createDecision({
      id: "DEC-002",
      situation: "second",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });

    // Resolve DEC-001 — pending.length drops to 1, old logic would reuse DEC-002.
    resolveDecision({ id: "DEC-001", option: "A", vaultRoot: tmpDir });

    // Auto-generate a new ID — must NOT collide with DEC-002 (still pending) or DEC-001 (resolved).
    const created = createDecision({
      situation: "third",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });
    assert.strictEqual(created.status, "created");
    // Should be DEC-003 (max of 1,2 + 1), not DEC-002.
    assert.strictEqual(created.id, "DEC-003");

    // Verify no duplicate DEC-002 in pending.
    const after = listDecisions({ vaultRoot: tmpDir });
    const dec002s = after.pending.filter((d) => d.id === "DEC-002");
    assert.strictEqual(dec002s.length, 1);
  });

  it("rejects explicitly provided duplicate ID (across pending + resolved)", () => {
    const tmpDir = makeTempVault();
    createDecision({
      id: "DEC-001",
      situation: "first",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });
    resolveDecision({ id: "DEC-001", option: "A", vaultRoot: tmpDir });

    // Try to create DEC-001 again — should fail even though it's now resolved.
    const result = createDecision({
      id: "DEC-001",
      situation: "dup",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });
    assert.ok(result.error);
    assert.match(result.error, /already exists/);
  });
});

describe("correctDecision duplicate-block fix", () => {
  it("marks the old resolved block as superseded instead of duplicating", () => {
    const tmpDir = makeTempVault();
    createDecision({
      id: "DEC-001",
      situation: "first decision",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });
    resolveDecision({ id: "DEC-001", option: "A", vaultRoot: tmpDir });

    // Now correct it.
    const result = correctDecision({
      id: "DEC-001",
      originalDecision: "chose A",
      correctionReason: "A was wrong",
      options: [{ label: "B", action: "switch", consequence: "better" }],
      vaultRoot: tmpDir,
    });
    assert.strictEqual(result.status, "correcting");

    const after = listDecisions({ vaultRoot: tmpDir });
    // There should be exactly one DEC-001 block in the correcting state,
    // and the old block marked superseded.
    const dec001s = after.resolved.filter((d) => d.id === "DEC-001");
    assert.strictEqual(dec001s.length, 2);
    const correcting = dec001s.find((d) => d.isCorrecting);
    const superseded = dec001s.find((d) => d.isSuperseded);
    assert.ok(correcting, "expected a correcting block");
    assert.ok(superseded, "expected the old block to be marked superseded");

    // resolvedCount must not double-count the superseded block.
    assert.strictEqual(after.summary.resolvedCount, 1);
  });
});

describe("finalizeCorrection", () => {
  it("closes the correction loop: correcting → resolved", () => {
    const tmpDir = makeTempVault();
    createDecision({
      id: "DEC-001",
      situation: "first decision",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });
    resolveDecision({ id: "DEC-001", option: "A", vaultRoot: tmpDir });
    correctDecision({
      id: "DEC-001",
      originalDecision: "chose A",
      correctionReason: "A was wrong",
      options: [
        { label: "B", action: "switch", consequence: "better" },
        { label: "C", action: "revert", consequence: "safe" },
      ],
      vaultRoot: tmpDir,
    });

    // Finalize by choosing B.
    const result = finalizeCorrection({
      id: "DEC-001",
      option: "B",
      vaultRoot: tmpDir,
    });
    assert.strictEqual(result.status, "finalized");

    const after = listDecisions({ vaultRoot: tmpDir });
    const dec001s = after.resolved.filter((d) => d.id === "DEC-001");
    // The correcting block should now be resolved (not isCorrecting).
    const finalized = dec001s.find((d) => !d.isCorrecting && !d.isSuperseded);
    assert.ok(finalized, "expected a finalized (✅) block");
    assert.strictEqual(finalized.isCorrecting, false);
    // Option B should be checked.
    const optB = finalized.options.find((o) => o.label === "B");
    assert.ok(optB);
    assert.strictEqual(optB.checked, true);
  });

  it("returns error when id is not in correcting state", () => {
    const tmpDir = makeTempVault();
    createDecision({
      id: "DEC-001",
      situation: "first decision",
      options: [{ label: "A", action: "x", consequence: "y" }],
      vaultRoot: tmpDir,
    });
    resolveDecision({ id: "DEC-001", option: "A", vaultRoot: tmpDir });

    // No correction started — finalize should fail.
    const result = finalizeCorrection({
      id: "DEC-001",
      option: "A",
      vaultRoot: tmpDir,
    });
    assert.ok(result.error);
    assert.match(result.error, /not found/);
  });
});

describe("createDecision skeleton restore (missing/empty/header-less decisions.md)", () => {
  /** Temp vault whose wiki/decisions.md is only written when seed !== undefined. */
  function makeBareVault(seed) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dec-skel-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    if (seed !== undefined) {
      fs.writeFileSync(path.join(tmpDir, "wiki", "decisions.md"), seed, "utf-8");
    }
    return tmpDir;
  }

  const opts = [{ label: "A", action: "x", consequence: "y" }];

  it("creates decisions.md from the skeleton when the file is missing", () => {
    const tmpDir = makeBareVault(); // no decisions.md at all
    const created = createDecision({
      id: "DEC-001",
      situation: "s",
      options: opts,
      vaultRoot: tmpDir,
    });
    assert.strictEqual(created.status, "created");

    const raw = fs.readFileSync(path.join(tmpDir, "wiki", "decisions.md"), "utf-8");
    assert.ok(raw.includes("## 待决 (pending)"));
    assert.ok(raw.includes("## 已决 (resolved)"));

    // listDecisions must parse the new file without throwing.
    const after = listDecisions({ vaultRoot: tmpDir });
    assert.strictEqual(after.summary.pendingCount, 1);
    assert.strictEqual(after.pending[0].id, "DEC-001");
  });

  it("bootstraps an empty decisions.md", () => {
    const tmpDir = makeBareVault("");
    const created = createDecision({
      id: "DEC-001",
      situation: "s",
      options: opts,
      vaultRoot: tmpDir,
    });
    assert.strictEqual(created.status, "created");

    const after = listDecisions({ vaultRoot: tmpDir });
    assert.strictEqual(after.summary.pendingCount, 1);
    assert.strictEqual(after.pending[0].id, "DEC-001");
  });

  it("restores the pending section header when only the resolved header exists", () => {
    // Regression: pendingIdx === -1 spliced the entry in at a bogus offset,
    // producing a header-less file that made every later parse throw.
    const tmpDir = makeBareVault("## 已决 (resolved)\n\n_(当前无已决条目)_\n");
    const created = createDecision({
      id: "DEC-001",
      situation: "s",
      options: opts,
      vaultRoot: tmpDir,
    });
    assert.strictEqual(created.status, "created");

    const raw = fs.readFileSync(path.join(tmpDir, "wiki", "decisions.md"), "utf-8");
    const pendingIdx = raw.indexOf("## 待决 (pending)");
    const resolvedIdx = raw.indexOf("## 已决 (resolved)");
    assert.ok(pendingIdx >= 0, "pending header must be restored");
    assert.ok(pendingIdx < resolvedIdx, "pending section must precede resolved");

    const after = listDecisions({ vaultRoot: tmpDir });
    assert.strictEqual(after.summary.pendingCount, 1);
    assert.strictEqual(after.pending[0].id, "DEC-001");
  });
});

describe("resolveDecision option/customText miss (silent no-op fix)", () => {
  const opts = [
    { label: "A", action: "yes", consequence: "good" },
    { label: "B", action: "no", consequence: "bad" },
  ];

  it("returns error and leaves the file untouched when the option letter does not exist", () => {
    const tmpDir = makeTempVault();
    createDecision({ id: "DEC-001", situation: "s", options: opts, vaultRoot: tmpDir });
    const decPath = path.join(tmpDir, "wiki", "decisions.md");
    const before = fs.readFileSync(decPath, "utf-8");

    const result = resolveDecision({ id: "DEC-001", option: "Z", vaultRoot: tmpDir });
    assert.ok(result.error);
    assert.match(result.error, /Option Z not found/);

    // File unchanged; entry still pending (not silently moved to resolved).
    assert.strictEqual(fs.readFileSync(decPath, "utf-8"), before);
    const after = listDecisions({ vaultRoot: tmpDir });
    assert.ok(after.pending.find((d) => d.id === "DEC-001"), "entry must stay in pending");
    assert.strictEqual(
      after.resolved.find((d) => d.id === "DEC-001"),
      undefined,
      "entry must not be moved to resolved"
    );
  });

  it("rejects option values that are not a single A-Z letter", () => {
    const tmpDir = makeTempVault();
    createDecision({ id: "DEC-001", situation: "s", options: opts, vaultRoot: tmpDir });

    for (const bad of ["A]", "AB", "a"]) {
      const result = resolveDecision({ id: "DEC-001", option: bad, vaultRoot: tmpDir });
      assert.ok(result.error, `option '${bad}' must be rejected`);
      assert.match(result.error, /single letter A-Z/);
    }

    const after = listDecisions({ vaultRoot: tmpDir });
    assert.strictEqual(after.summary.pendingCount, 1);
  });

  it("returns error when the custom decision line does not match", () => {
    // Entry deliberately has no "_(自定义：写下你的决定)_" line.
    const tmpDir = makeTempVault(
      "## 待决 (pending)\n\n### DEC-001 | 2026-01-01\n**情境**: no custom line\n\n- [ ] **A. yes** — good\n\n## 已决 (resolved)\n\n_(当前无已决条目)_\n"
    );
    const decPath = path.join(tmpDir, "wiki", "decisions.md");
    const before = fs.readFileSync(decPath, "utf-8");

    const result = resolveDecision({
      id: "DEC-001",
      customText: "my own choice",
      vaultRoot: tmpDir,
    });
    assert.ok(result.error);
    assert.match(result.error, /Custom decision line not found/);
    assert.strictEqual(fs.readFileSync(decPath, "utf-8"), before);
  });

  it("finalizeCorrection errors and keeps the correcting block when the option does not exist", () => {
    const tmpDir = makeTempVault();
    createDecision({ id: "DEC-001", situation: "s", options: opts, vaultRoot: tmpDir });
    resolveDecision({ id: "DEC-001", option: "A", vaultRoot: tmpDir });
    correctDecision({
      id: "DEC-001",
      originalDecision: "chose A",
      correctionReason: "A was wrong",
      options: [{ label: "B", action: "switch", consequence: "better" }],
      vaultRoot: tmpDir,
    });
    const decPath = path.join(tmpDir, "wiki", "decisions.md");
    const before = fs.readFileSync(decPath, "utf-8");

    const result = finalizeCorrection({ id: "DEC-001", option: "Z", vaultRoot: tmpDir });
    assert.ok(result.error);
    assert.match(result.error, /Option Z not found/);
    assert.strictEqual(fs.readFileSync(decPath, "utf-8"), before);

    const after = listDecisions({ status: "resolved", vaultRoot: tmpDir });
    assert.ok(
      after.resolved.find((d) => d.id === "DEC-001" && d.isCorrecting),
      "block must remain in correcting state"
    );
  });
});
