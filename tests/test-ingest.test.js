"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { initWiki } = require("../tools/init-wiki");
const { handleSetInboxFolders, discoverSources } = require("../tools/discover");
const { ingestSource } = require("../tools/ingest");

describe("init_wiki", () => {
  it("creates the LLM-Wiki skeleton", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "init-test-"));
    const result = initWiki(tmpDir);
    assert.strictEqual(result.status, "ok");
    assert.ok(result.created.length > 0);
    assert.ok(fs.existsSync(path.join(tmpDir, "wiki", "entities")));
    assert.ok(fs.existsSync(path.join(tmpDir, "wiki", "concepts", "LLM Wiki 设计模式.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, "wiki", "templates", "entity-template.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, "index.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, "wiki", "log.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, "wiki", "decisions.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, ".source-tracker")));
    assert.ok(fs.existsSync(path.join(tmpDir, "raw")));
  });

  it("is idempotent — returns skipped for existing files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "init-test2-"));
    initWiki(tmpDir);
    const result = initWiki(tmpDir);
    assert.strictEqual(result.status, "ok");
    assert.ok(result.skipped.length > result.created.length);
  });
});

describe("set_inbox_folders", () => {
  it("sets, lists, adds, and removes inbox folders", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-test-"));
    fs.mkdirSync(path.join(tmpDir, ".source-tracker"), { recursive: true });

    // Set
    const r1 = handleSetInboxFolders({ action: "set", paths: ["Clippings"], vault: tmpDir });
    assert.deepStrictEqual(r1.inboxFolders, ["Clippings"]);

    // List
    const r2 = handleSetInboxFolders({ action: "list", vault: tmpDir });
    assert.deepStrictEqual(r2.inboxFolders, ["Clippings"]);

    // Add
    const r3 = handleSetInboxFolders({ action: "add", paths: ["技巧"], vault: tmpDir });
    assert.deepStrictEqual(r3.inboxFolders, ["Clippings", "技巧"]);

    // Remove
    const r4 = handleSetInboxFolders({ action: "remove", paths: ["Clippings"], vault: tmpDir });
    assert.deepStrictEqual(r4.inboxFolders, ["技巧"]);
  });

  it("returns error for unknown action", () => {
    const r = handleSetInboxFolders({ action: "invalid" });
    assert.ok(r.error);
  });
});

describe("discover_sources", () => {
  it("returns new files not yet archived", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"));
    initWiki(tmpDir);

    // Create inbox folder with files
    const inboxDir = path.join(tmpDir, "Clippings");
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, "article1.md"), "# Article 1");
    fs.writeFileSync(path.join(inboxDir, "article2.md"), "# Article 2");

    // Set inbox config
    handleSetInboxFolders({ action: "set", paths: ["Clippings"], vault: tmpDir });

    // Discover
    const result = discoverSources(tmpDir);
    assert.strictEqual(result.totalNew, 2);
    assert(result.newFiles.some((f) => f.name === "article1.md"));
    assert(result.newFiles.some((f) => f.name === "article2.md"));
  });

  it("skips already-archived files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-skip-"));
    initWiki(tmpDir);

    handleSetInboxFolders({ action: "set", paths: ["Inbox"], vault: tmpDir });
    const inboxDir = path.join(tmpDir, "Inbox");
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, "done.md"), "# Done");

    // Pre-archive
    const rawDir = path.join(tmpDir, "raw", "Inbox");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, "done.md"), "# Archived");

    const result = discoverSources(tmpDir);
    assert.strictEqual(result.totalNew, 0);
  });

  it("returns error when no inbox folders configured", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-no-"));
    initWiki(tmpDir);
    const result = discoverSources(tmpDir);
    assert.ok(result.error);
  });
});

describe("ingest_source", () => {
  it("atomically ingests a source file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
    initWiki(tmpDir);

    // Create source
    handleSetInboxFolders({ action: "set", paths: ["Sources"], vault: tmpDir });
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "test-source.md"), "# Test Source\nSome content.", "utf-8");

    const result = ingestSource({
      sourceFile: "Sources/test-source.md",
      inbox: "Sources",
      type: "entity",
      title: "Test Entity",
      content: "# Test Entity\n\n## Overview\n\nA test.",
      summary: "A test entity",
      vault: tmpDir,
    });

    assert.strictEqual(result.status, "ingested");
    assert.ok(result.page.includes("Test Entity.md"));
    assert.ok(result.indexUpdated);
    assert.ok(result.archived.includes("raw/Sources/"));

    // Verify source moved
    assert.ok(!fs.existsSync(path.join(srcDir, "test-source.md")));
    assert.ok(fs.existsSync(path.join(tmpDir, "raw", "Sources", "test-source.md")));

    // Verify page created
    assert.ok(fs.existsSync(path.join(tmpDir, "wiki", "entities", "Test Entity.md")));
  });

  it("returns error for missing source file", () => {
    const result = ingestSource({
      sourceFile: "does-not-exist.md",
      inbox: "X",
      type: "entity",
      title: "Test",
      content: "# Test",
      summary: "Test",
    });
    assert.ok(result.error);
  });

  it("returns error for invalid type", () => {
    const result = ingestSource({
      sourceFile: "x.md",
      inbox: "X",
      type: "invalid",
      title: "Test",
      content: "# Test",
      summary: "Test",
    });
    assert.ok(result.error);
  });
});
