"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { extractWikilinks, extractSourcesFromFrontmatter, parseFrontmatter } = require("../lib/graph");

describe("extractWikilinks", () => {
  it("extracts simple [[link]] targets", () => {
    const links = extractWikilinks("See [[entities/Claude Code]] and [[concepts/embedding]]");
    assert.deepStrictEqual(links, ["entities/Claude Code", "concepts/embedding"]);
  });

  it("extracts [[target|alias]] and strips aliases", () => {
    const links = extractWikilinks("See [[Claude Code|the best AI tool]] for details");
    assert.deepStrictEqual(links, ["Claude Code"]);
  });

  it("returns empty array when no wikilinks present", () => {
    assert.deepStrictEqual(extractWikilinks("Plain text without links"), []);
  });

  it("trims whitespace from link targets", () => {
    const links = extractWikilinks("[[ entities/Test ]]");
    assert.deepStrictEqual(links, ["entities/Test"]);
  });
});

describe("extractSourcesFromFrontmatter", () => {
  it("extracts plain sources from frontmatter list", () => {
    const fm = "sources:\n- raw/file1.md\n- raw/file2.md\notherfield: value";
    const sources = extractSourcesFromFrontmatter(fm);
    assert.deepStrictEqual(sources, ["raw/file1.md", "raw/file2.md"]);
  });

  it("strips wikilink wrappers from sources", () => {
    const fm = "sources:\n- [[raw/file.md]]\n- [[raw/other|alias]]\n---";
    const sources = extractSourcesFromFrontmatter(fm);
    assert.deepStrictEqual(sources, ["raw/file.md", "raw/other"]);
  });

  it("stops parsing at non-list, non-comment line", () => {
    const fm = "sources:\n- src1.md\ntype: entity";
    const sources = extractSourcesFromFrontmatter(fm);
    assert.deepStrictEqual(sources, ["src1.md"]);
  });

  it("returns empty array when no sources field", () => {
    assert.deepStrictEqual(extractSourcesFromFrontmatter("title: Test"), []);
  });
});

describe("parseFrontmatter", () => {
  it("extracts type, title, and sources from frontmatter", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
    const filePath = path.join(tmpDir, "test.md");
    const content = "---\ntype: entity\ntitle: My Entity\nsources:\n- [[raw/test.md]]\n---\n\n# Body content";
    fs.writeFileSync(filePath, content, "utf-8");

    const result = parseFrontmatter(filePath);
    assert.strictEqual(result.type, "entity");
    assert.strictEqual(result.title, "My Entity");
    assert.deepStrictEqual(result.sources, ["raw/test.md"]);
    assert.ok(result.body.includes("# Body content"));
    assert.ok(result.content.includes("---"));
  });

  it("falls back to filename for title when frontmatter has no title", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
    const filePath = path.join(tmpDir, "NoTitle.md");
    fs.writeFileSync(filePath, "---\ntype: concept\n---\n\nBody", "utf-8");

    const result = parseFrontmatter(filePath);
    assert.strictEqual(result.title, "NoTitle");
  });

  it("handles files without frontmatter", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
    const filePath = path.join(tmpDir, "plain.md");
    fs.writeFileSync(filePath, "# Just a heading\n\nSome text", "utf-8");

    const result = parseFrontmatter(filePath);
    assert.ok(result.body.includes("# Just a heading"));
    assert.strictEqual(result.sources.length, 0);
  });

  it("infers type from directory path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
    const wikiDir = path.join(tmpDir, "wiki", "concepts");
    fs.mkdirSync(wikiDir, { recursive: true });
    const filePath = path.join(wikiDir, "test.md");
    fs.writeFileSync(filePath, "# Test", "utf-8");

    const result = parseFrontmatter(filePath, path.join(tmpDir, "wiki"));
    assert.strictEqual(result.type, "concept");
  });
});
