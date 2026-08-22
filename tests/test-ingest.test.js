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

  it("returns an error for an unknown vault name instead of using the default vault", () => {
    const result = handleSetInboxFolders({
      action: "list",
      vault: `missing-vault-${Date.now()}`,
    });
    assert.match(result.error, /^Unknown vault:/);
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

  it("returns an error for an unknown vault name", () => {
    const result = discoverSources(`missing-vault-${Date.now()}`);
    assert.match(result.error, /^Unknown vault:/);
    assert.deepStrictEqual(result.newFiles, []);
    assert.strictEqual(result.totalNew, 0);
  });
});

describe("ingest_source", () => {
  it("ingests a source file and archives it", () => {
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

  it("returns an error for an unknown vault name", () => {
    const result = ingestSource({
      sourceFile: "Sources/source.md",
      inbox: "Sources",
      type: "entity",
      title: "Unknown Vault",
      content: "# Unknown Vault",
      summary: "must not use the default vault",
      vault: `missing-vault-${Date.now()}`,
    });
    assert.match(result.error, /^Unknown vault:/);
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

  it("falls back to a timestamped slug for pure-whitespace titles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-slug-ws-"));
    initWiki(tmpDir);
    handleSetInboxFolders({ action: "set", paths: ["Sources"], vault: tmpDir });
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "ws.md"), "# WS\ncontent.", "utf-8");

    const result = ingestSource({
      sourceFile: "Sources/ws.md",
      inbox: "Sources",
      type: "entity",
      title: "   ",
      content: "# blank title\n",
      summary: "whitespace title",
      vault: tmpDir,
    });
    assert.strictEqual(result.status, "ingested");
    assert.ok(result.page.includes("untitled-"), `expected untitled- slug, got ${result.page}`);
  });

  it("falls back to a timestamped slug for all-separator titles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-slug-sep-"));
    initWiki(tmpDir);
    handleSetInboxFolders({ action: "set", paths: ["Sources"], vault: tmpDir });
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "sep.md"), "# SEP\ncontent.", "utf-8");

    const result = ingestSource({
      sourceFile: "Sources/sep.md",
      inbox: "Sources",
      type: "entity",
      title: " /?: ",
      content: "# sep title\n",
      summary: "separator title",
      vault: tmpDir,
    });
    assert.strictEqual(result.status, "ingested");
    assert.ok(result.page.includes("untitled-"), `expected untitled- slug, got ${result.page}`);
  });

  it("rolls back page, index, and log when the archive step fails", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-rollback-"));
    initWiki(tmpDir);
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    const sourcePath = path.join(srcDir, "rollback.md");
    fs.writeFileSync(sourcePath, "# Rollback\ncontent.", "utf-8");

    const indexPath = path.join(tmpDir, "index.md");
    const logPath = path.join(tmpDir, "wiki", "log.md");
    const indexBefore = fs.readFileSync(indexPath, "utf-8");
    const logBefore = fs.readFileSync(logPath, "utf-8");

    fs.rmSync(path.join(tmpDir, "raw"), { recursive: true, force: true });
    fs.writeFileSync(path.join(tmpDir, "raw"), "not a directory", "utf-8");

    const result = ingestSource({
      sourceFile: "Sources/rollback.md",
      inbox: "Sources",
      type: "entity",
      title: "Rollback Entity",
      content: "# Rollback Entity",
      summary: "must not persist after failure",
      vault: tmpDir,
    });

    assert.ok(result.error);
    assert.ok(fs.existsSync(sourcePath));
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Rollback Entity.md")));
    assert.strictEqual(fs.readFileSync(indexPath, "utf-8"), indexBefore);
    assert.strictEqual(fs.readFileSync(logPath, "utf-8"), logBefore);
  });

  it("rolls back the new page when the matching index section is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-index-rollback-"));
    initWiki(tmpDir);
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    const sourcePath = path.join(srcDir, "index-error.md");
    fs.writeFileSync(sourcePath, "# Index error\ncontent.", "utf-8");

    const indexPath = path.join(tmpDir, "index.md");
    const logPath = path.join(tmpDir, "wiki", "log.md");
    fs.writeFileSync(indexPath, "# Corrupt index\n", "utf-8");
    const indexBefore = fs.readFileSync(indexPath, "utf-8");
    const logBefore = fs.readFileSync(logPath, "utf-8");

    const result = ingestSource({
      sourceFile: "Sources/index-error.md",
      inbox: "Sources",
      type: "entity",
      title: "Index Failure Entity",
      content: "# Index Failure Entity",
      summary: "must not persist without an index section",
      vault: tmpDir,
    });

    assert.ok(result.error);
    assert.ok(fs.existsSync(sourcePath));
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Index Failure Entity.md")));
    assert.strictEqual(fs.readFileSync(indexPath, "utf-8"), indexBefore);
    assert.strictEqual(fs.readFileSync(logPath, "utf-8"), logBefore);
  });

  it("rejects source files outside the vault", () => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-traversal-"));
    const tmpDir = path.join(parentDir, "vault");
    fs.mkdirSync(tmpDir);
    initWiki(tmpDir);
    const outsidePath = path.join(parentDir, "outside.md");
    fs.writeFileSync(outsidePath, "# Outside\nmust stay outside.", "utf-8");

    const result = ingestSource({
      sourceFile: "../outside.md",
      inbox: "Sources",
      type: "entity",
      title: "Outside Entity",
      content: "# Outside Entity",
      summary: "must not be ingested",
      vault: tmpDir,
    });

    assert.match(result.error, /outside vault root/);
    assert.ok(fs.existsSync(outsidePath));
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Outside Entity.md")));
    assert.ok(!fs.existsSync(path.join(tmpDir, "raw", "Sources", "outside.md")));
  });

  it("rejects vault files outside the declared inbox", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-wrong-inbox-"));
    initWiki(tmpDir);
    const sourcePath = path.join(tmpDir, "index.md");
    const indexBefore = fs.readFileSync(sourcePath, "utf-8");
    const logPath = path.join(tmpDir, "wiki", "log.md");
    const logBefore = fs.readFileSync(logPath, "utf-8");

    const result = ingestSource({
      sourceFile: "index.md",
      inbox: "Sources",
      type: "entity",
      title: "Protected Index",
      content: "# Protected Index",
      summary: "must not archive project state",
      vault: tmpDir,
    });

    assert.match(result.error, /outside declared inbox/);
    assert.strictEqual(fs.readFileSync(sourcePath, "utf-8"), indexBefore);
    assert.strictEqual(fs.readFileSync(logPath, "utf-8"), logBefore);
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Protected Index.md")));
    assert.ok(!fs.existsSync(path.join(tmpDir, "raw", "Sources", "index.md")));
  });

  it("rejects source paths that leave the inbox through a symlink", (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-inbox-symlink-"));
    initWiki(tmpDir);
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    try {
      fs.symlinkSync(path.join(tmpDir, "wiki"), path.join(srcDir, "wiki-link"), "dir");
    } catch (e) {
      t.skip(`symlinks unavailable: ${e.message}`);
      return;
    }

    const logPath = path.join(tmpDir, "wiki", "log.md");
    const logBefore = fs.readFileSync(logPath, "utf-8");
    const result = ingestSource({
      sourceFile: "Sources/wiki-link/log.md",
      inbox: "Sources",
      type: "entity",
      title: "Symlink Escape",
      content: "# Symlink Escape",
      summary: "must not archive a file outside the resolved inbox",
      vault: tmpDir,
    });

    assert.match(result.error, /resolves outside declared inbox/);
    assert.strictEqual(fs.readFileSync(logPath, "utf-8"), logBefore);
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Symlink Escape.md")));
  });

  it("rejects an archive root symlink that resolves outside the vault", (t) => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-archive-symlink-"));
    const tmpDir = path.join(parentDir, "vault");
    const outsideRaw = path.join(parentDir, "outside-raw");
    fs.mkdirSync(tmpDir);
    fs.mkdirSync(outsideRaw);
    initWiki(tmpDir);
    fs.rmSync(path.join(tmpDir, "raw"), { recursive: true });
    try {
      fs.symlinkSync(outsideRaw, path.join(tmpDir, "raw"), "dir");
    } catch (e) {
      t.skip(`symlinks unavailable: ${e.message}`);
      return;
    }
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir);
    const sourcePath = path.join(srcDir, "archive-escape.md");
    fs.writeFileSync(sourcePath, "# Archive escape", "utf-8");

    const indexPath = path.join(tmpDir, "index.md");
    const logPath = path.join(tmpDir, "wiki", "log.md");
    const indexBefore = fs.readFileSync(indexPath, "utf-8");
    const logBefore = fs.readFileSync(logPath, "utf-8");
    const result = ingestSource({
      sourceFile: "Sources/archive-escape.md",
      inbox: "Sources",
      type: "entity",
      title: "Archive Escape",
      content: "# Archive Escape",
      summary: "must not write outside the vault",
      vault: tmpDir,
    });

    assert.match(result.error, /Archive root resolves outside vault root/);
    assert.ok(fs.existsSync(sourcePath));
    assert.ok(!fs.existsSync(path.join(outsideRaw, "Sources", "archive-escape.md")));
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Archive Escape.md")));
    assert.strictEqual(fs.readFileSync(indexPath, "utf-8"), indexBefore);
    assert.strictEqual(fs.readFileSync(logPath, "utf-8"), logBefore);
  });

  it("rejects directories as source files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-directory-"));
    initWiki(tmpDir);
    const sourceDir = path.join(tmpDir, "Sources", "directory");
    fs.mkdirSync(sourceDir, { recursive: true });

    const result = ingestSource({
      sourceFile: "Sources/directory",
      inbox: "Sources",
      type: "entity",
      title: "Directory Entity",
      content: "# Directory Entity",
      summary: "must remain a directory",
      vault: tmpDir,
    });

    assert.match(result.error, /regular file/);
    assert.ok(fs.existsSync(sourceDir));
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Directory Entity.md")));
    assert.ok(!fs.existsSync(path.join(tmpDir, "raw", "Sources", "directory")));
  });

  it("normalizes Windows-style source paths", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-win-path-"));
    initWiki(tmpDir);
    const srcDir = path.join(tmpDir, "Sources", "Nested");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "windows.md"), "# Windows path\ncontent.", "utf-8");

    const result = ingestSource({
      sourceFile: "Sources\\Nested\\windows.md",
      inbox: "Sources\\Nested",
      type: "entity",
      title: "Windows Path Entity",
      content: "# Windows Path Entity",
      summary: "portable source path",
      vault: tmpDir,
    });

    assert.strictEqual(result.status, "ingested");
    assert.strictEqual(result.archived, "raw/Nested/windows.md");
    assert.ok(fs.existsSync(path.join(tmpDir, "raw", "Nested", "windows.md")));
  });

  it("removes a partial cross-device archive when deleting the source fails", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-exdev-rollback-"));
    initWiki(tmpDir);
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    const sourcePath = path.join(srcDir, "cross-device.md");
    const archivePath = path.join(tmpDir, "raw", "Sources", "cross-device.md");
    fs.writeFileSync(sourcePath, "# Cross-device\ncontent.", "utf-8");

    const indexPath = path.join(tmpDir, "index.md");
    const logPath = path.join(tmpDir, "wiki", "log.md");
    const indexBefore = fs.readFileSync(indexPath, "utf-8");
    const logBefore = fs.readFileSync(logPath, "utf-8");
    const originalRenameSync = fs.renameSync;
    const originalUnlinkSync = fs.unlinkSync;

    fs.renameSync = (from, to) => {
      if (from === sourcePath && to === archivePath) {
        const error = new Error("cross-device move");
        error.code = "EXDEV";
        throw error;
      }
      return originalRenameSync(from, to);
    };
    fs.unlinkSync = (target) => {
      if (target === sourcePath) {
        throw new Error("cannot remove source");
      }
      return originalUnlinkSync(target);
    };

    let result;
    try {
      result = ingestSource({
        sourceFile: "Sources/cross-device.md",
        inbox: "Sources",
        type: "entity",
        title: "Cross-device Entity",
        content: "# Cross-device Entity",
        summary: "must roll back a partial copy",
        vault: tmpDir,
      });
    } finally {
      fs.renameSync = originalRenameSync;
      fs.unlinkSync = originalUnlinkSync;
    }

    assert.match(result.error, /cannot remove source/);
    assert.ok(fs.existsSync(sourcePath));
    assert.ok(!fs.existsSync(archivePath));
    assert.ok(!fs.existsSync(path.join(tmpDir, "wiki", "entities", "Cross-device Entity.md")));
    assert.strictEqual(fs.readFileSync(indexPath, "utf-8"), indexBefore);
    assert.strictEqual(fs.readFileSync(logPath, "utf-8"), logBefore);
  });
});

describe("index table structure across consecutive ingests", () => {
  it("keeps the table header above data rows and updates the page count", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-index-struct-"));
    initWiki(tmpDir);
    handleSetInboxFolders({ action: "set", paths: ["Sources"], vault: tmpDir });
    const srcDir = path.join(tmpDir, "Sources");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "one.md"), "# One", "utf-8");
    fs.writeFileSync(path.join(srcDir, "two.md"), "# Two", "utf-8");

    // Two consecutive ingests: the first consumes the | _(暂无)_ | placeholder,
    // the second must append after the last table row instead of landing
    // between the section header and the table header.
    for (const [file, title] of [["one.md", "Entity One"], ["two.md", "Entity Two"]]) {
      const result = ingestSource({
        sourceFile: `Sources/${file}`,
        inbox: "Sources",
        type: "entity",
        title,
        content: `# ${title}`,
        summary: `summary for ${title}`,
        vault: tmpDir,
      });
      assert.strictEqual(result.status, "ingested");
    }

    const index = fs.readFileSync(path.join(tmpDir, "index.md"), "utf-8");
    const sectionStart = index.indexOf("## 实体 (entities/)");
    assert.ok(sectionStart >= 0, "entities section must exist");
    const nextSection = index.indexOf("\n## ", sectionStart);
    const section = index.slice(sectionStart, nextSection >= 0 ? nextSection : index.length);

    // Page count in the section header must track the added rows: 0 页 → 2 页.
    assert.match(section, /^## 实体 \(entities\/\) — 2 页$/m);

    // Table header and separator must precede both data rows.
    const tableHeaderIdx = section.indexOf("| 页面 | 摘要 | 状态 |");
    const separatorIdx = section.indexOf("|------");
    const rowOneIdx = section.indexOf("[[entities/Entity One]]");
    const rowTwoIdx = section.indexOf("[[entities/Entity Two]]");
    assert.ok(tableHeaderIdx >= 0, "table header must exist");
    assert.ok(separatorIdx > tableHeaderIdx, "separator must follow the table header");
    assert.ok(rowOneIdx > separatorIdx, "Entity One row must be below the separator");
    assert.ok(rowTwoIdx > rowOneIdx, "Entity Two row must be appended after Entity One");
  });
});
