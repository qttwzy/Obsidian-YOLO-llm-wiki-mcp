"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { discoverVaults, getVaultMap, getVaultName, getWikiDir, walkWikiPages } = require("../lib/config");

describe("getVaultName", () => {
  it("returns basename of an absolute path", () => {
    assert.strictEqual(getVaultName("/a/b/MyVault"), "MyVault");
    assert.strictEqual(getVaultName("C:\\Obsidian\\Vault"), "Vault");
  });
});

describe("getWikiDir", () => {
  it("appends wiki/ to the vault root", () => {
    const vaultRoot = path.join(os.tmpdir(), "TestVault");
    const wikiDir = getWikiDir(vaultRoot);
    assert.ok(wikiDir.endsWith("wiki"));
    assert.ok(wikiDir.startsWith(os.tmpdir()));
  });
});

describe("discoverVaults", () => {
  let parentDir;

  it("discovers vault directories containing .obsidian/", () => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaults-"));
    const vault1 = path.join(parentDir, "Vault1");
    const vault2 = path.join(parentDir, "Vault2");
    const notAVault = path.join(parentDir, "NotAVault");
    fs.mkdirSync(path.join(vault1, ".obsidian"), { recursive: true });
    fs.mkdirSync(path.join(vault2, ".obsidian"), { recursive: true });
    fs.mkdirSync(notAVault, { recursive: true });

    const discovered = discoverVaults(parentDir);
    assert.ok(discovered instanceof Map);
    assert.strictEqual(discovered.size, 2);
    assert.ok(discovered.has("Vault1"));
    assert.ok(discovered.has("Vault2"));
    assert.ok(!discovered.has("NotAVault"));
  });

  it("returns an empty Map for a directory with no vaults", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"));
    const discovered = discoverVaults(emptyDir);
    assert.strictEqual(discovered.size, 0);
  });
});

describe("getVaultMap", () => {
  it("returns a Map (cached after first call)", () => {
    const map = getVaultMap();
    assert.ok(map instanceof Map);
    // Second call returns same cached reference
    assert.strictEqual(getVaultMap(), map);
  });
});

describe("walkWikiPages", () => {
  let vaultRoot;

  it("walks wiki directory and returns parsed page entries", () => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-walk-"));
    const wikiDir = path.join(vaultRoot, "wiki", "entities");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "Test1.md"), "# Test 1\ncontent");
    fs.writeFileSync(path.join(wikiDir, "Test2.md"), "# Test 2\nmore content");

    const pages = walkWikiPages(vaultRoot);
    assert.ok(pages.length >= 2);
    const found = pages.find((p) => p.slug.includes("Test1"));
    assert.ok(found);
    assert.strictEqual(typeof found.absPath, "string");
    assert.strictEqual(typeof found.relPath, "string");
    assert.ok(found.relPath.startsWith("wiki/"));
  });

  it("excludes templates/ directory and log.md", () => {
    const wikiDir = path.join(vaultRoot, "wiki", "templates");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "Template.md"), "# Template");
    fs.writeFileSync(path.join(vaultRoot, "wiki", "log.md"), "# Log");

    const pages = walkWikiPages(vaultRoot);
    const templatePage = pages.find((p) => p.relPath.includes("templates"));
    const logPage = pages.find((p) => p.relPath.endsWith("log.md"));
    assert.strictEqual(templatePage, undefined);
    assert.strictEqual(logPage, undefined);
  });

  it("returns empty array for non-existent wiki directory", () => {
    const emptyVault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-empty-"));
    const pages = walkWikiPages(emptyVault);
    assert.strictEqual(pages.length, 0);
  });
});
