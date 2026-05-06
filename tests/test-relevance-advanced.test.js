"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { getTypeAffinity, calculateBaseWeight, calculateEdgeWeight } = require("../lib/relevance");

function makeNode(overrides = {}) {
  return {
    slug: "test/page",
    title: "Test Page",
    type: "entity",
    sources: [],
    outLinks: [],
    inLinks: [],
    degree: 0,
    ...overrides,
  };
}

describe("getTypeAffinity", () => {
  it("returns strongest score for concept-entity", () => {
    const score = getTypeAffinity("concept", "entity");
    assert.strictEqual(score, 1.0);
  });

  it("returns 0.5 for same-type entity-entity", () => {
    assert.strictEqual(getTypeAffinity("entity", "entity"), 0.5);
  });

  it("returns 0.5 for unknown type combination", () => {
    const score = getTypeAffinity("unknown", "other");
    assert.strictEqual(score, 0.5);
  });

  it("is commutative", () => {
    assert.strictEqual(getTypeAffinity("concept", "entity"), getTypeAffinity("entity", "concept"));
  });
});

describe("calculateBaseWeight", () => {
  const allNodes = new Map();
  const nodeA = makeNode({ slug: "A", title: "A", outLinks: ["B"], sources: ["src/1.md"] });
  const nodeB = makeNode({ slug: "B", title: "B", outLinks: ["A"], sources: ["src/1.md"] });
  allNodes.set("A", nodeA);
  allNodes.set("B", nodeB);

  it("detects directLink signal when A links to B", () => {
    const result = calculateBaseWeight(nodeA, nodeB, allNodes);
    assert.ok(result.signals.includes("directLink"));
    assert.ok(result.base > 0);
  });

  it("detects sourceOverlap signal", () => {
    const result = calculateBaseWeight(nodeA, nodeB, allNodes);
    assert.ok(result.signals.includes("sourceOverlap"));
  });

  it("always includes typeAffinity signal when both nodes have types", () => {
    const result = calculateBaseWeight(nodeA, nodeB, allNodes);
    assert.ok(result.signals.includes("typeAffinity"));
  });
});

describe("calculateEdgeWeight", () => {
  const allNodes = new Map();
  const nodeA = makeNode({ slug: "A", title: "A", outLinks: ["B"] });
  const nodeB = makeNode({ slug: "B", title: "B", outLinks: [] });

  it("returns null when base weight is zero", () => {
    const isolatedA = makeNode({ slug: "X", outLinks: [], sources: [], type: "" });
    const isolatedB = makeNode({ slug: "Y", outLinks: [], sources: [], type: "" });
    // No directLink, no sourceOverlap, no typeAffinity (empty type is falsy)
    assert.strictEqual(calculateEdgeWeight(isolatedA, isolatedB, allNodes), null);
  });

  it("returns weight, signals, and factors for connected nodes", () => {
    const result = calculateEdgeWeight(nodeA, nodeB, allNodes);
    assert.ok(result);
    assert.ok(result.weight > 0);
    assert.ok(result.signals.length >= 1);
    assert.ok(typeof result.factors.base === "number");
    assert.ok(typeof result.factors.hubPenalty === "number");
    assert.ok(typeof result.factors.rarityBonus === "number");
    assert.ok(typeof result.factors.reinforcementBonus === "number");
  });

  it("applies hub penalty to high-degree nodes", () => {
    const hubNode = makeNode({ slug: "Hub", outLinks: [], degree: 50 });
    const normalNode = makeNode({ slug: "Normal", outLinks: [] });
    const result = calculateEdgeWeight(hubNode, normalNode, allNodes);
    assert.ok(result.factors.hubPenalty < 0.5);
  });
});
