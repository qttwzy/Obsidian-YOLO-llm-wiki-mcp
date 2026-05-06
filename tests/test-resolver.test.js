"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveLink, getResolvedOutLinks } = require("../lib/resolver");

function makeNodes(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.slug, e);
  return m;
}

describe("resolveLink", () => {
  const nodes = makeNodes([
    { slug: "entities/Claude Code", title: "Claude Code", type: "entity", sources: [], outLinks: [], inLinks: [], degree: 0 },
    { slug: "concepts/embedding", title: "Embedding", type: "concept", sources: [], outLinks: [], inLinks: [], degree: 0 },
    { slug: "synthesis/compare-ai", title: "AI Tools Compared", type: "synthesis", sources: [], outLinks: [], inLinks: [], degree: 0 },
  ]);

  it("resolves by exact slug match", () => {
    assert.strictEqual(resolveLink("entities/Claude Code", nodes), "entities/Claude Code");
  });

  it("resolves by title match (case-insensitive)", () => {
    assert.strictEqual(resolveLink("claude code", nodes), "entities/Claude Code");
    assert.strictEqual(resolveLink("EMBEDDING", nodes), "concepts/embedding");
  });

  it("resolves by last segment of slug", () => {
    assert.strictEqual(resolveLink("compare-ai", nodes), "synthesis/compare-ai");
  });

  it("returns null for unknown link", () => {
    assert.strictEqual(resolveLink("nonexistent", nodes), null);
  });
});

describe("getResolvedOutLinks", () => {
  const nodes = makeNodes([
    { slug: "entities/A", title: "A", type: "entity", sources: [], outLinks: [], inLinks: [], degree: 0 },
    { slug: "entities/B", title: "B", type: "entity", sources: [], outLinks: [], inLinks: [], degree: 0 },
  ]);

  it("returns slugs that exist in nodes", () => {
    const outLinks = ["entities/A", "entities/C"];
    const resolved = getResolvedOutLinks(outLinks, nodes);
    assert.deepStrictEqual(resolved, ["entities/A"]);
  });

  it("resolves by title as fallback", () => {
    const outLinks = ["B"];
    const resolved = getResolvedOutLinks(outLinks, nodes);
    assert.deepStrictEqual(resolved, ["entities/B"]);
  });

  it("returns empty array when no links resolve", () => {
    assert.deepStrictEqual(getResolvedOutLinks(["X", "Y"], nodes), []);
  });
});
