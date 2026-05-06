"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// mergeCategorize is private to tools/lint.js. Recreate for testing.
function mergeCategorize(vectorResults, graphResults, top) {
  const vectorMap = new Map();
  for (const v of vectorResults) {
    const key = [v.slug_a, v.slug_b].sort().join("|||");
    vectorMap.set(key, v);
  }

  const graphMap = new Map();
  for (const g of graphResults) {
    const key = [g.slug_a, g.slug_b].sort().join("|||");
    graphMap.set(key, g);
  }

  const allKeys = new Set([...vectorMap.keys(), ...graphMap.keys()]);
  const crossSignal = [];
  const semanticOnly = [];
  const structuralOnly = [];

  for (const key of allKeys) {
    const v = vectorMap.get(key);
    const g = graphMap.get(key);

    if (v && g) {
      crossSignal.push({
        slug_a: v.slug_a, slug_b: v.slug_b,
        vector_score: v.score, graph_score: g.graph_score,
        graph_signals: g.graph_signals, confidence: "high",
      });
    } else if (v && !g) {
      semanticOnly.push({
        slug_a: v.slug_a, slug_b: v.slug_b,
        vector_score: v.score, graph_score: 0,
        graph_signals: [], confidence: "medium",
      });
    } else if (!v && g) {
      structuralOnly.push({
        slug_a: g.slug_a, slug_b: g.slug_b,
        vector_score: 0, graph_score: g.graph_score,
        graph_signals: g.graph_signals, confidence: "low",
      });
    }
  }

  crossSignal.sort((a, b) => b.vector_score + b.graph_score - a.vector_score - a.graph_score);
  semanticOnly.sort((a, b) => b.vector_score - a.vector_score);
  structuralOnly.sort((a, b) => b.graph_score - a.graph_score);

  return {
    cross_signal: crossSignal.slice(0, top),
    semantic_only: semanticOnly.slice(0, top),
    structural_only: structuralOnly.slice(0, top),
  };
}

describe("mergeCategorize", () => {
  it("classifies pairs in both channels as cross_signal", () => {
    const vec = [{ slug_a: "entities/A", slug_b: "entities/B", score: 0.9, title_a: "A", summary_a: "", title_b: "B", summary_b: "" }];
    const graph = [{ slug_a: "entities/A", slug_b: "entities/B", graph_score: 3.0, graph_signals: ["directLink"] }];

    const result = mergeCategorize(vec, graph, 15);
    assert.strictEqual(result.cross_signal.length, 1);
    assert.strictEqual(result.cross_signal[0].confidence, "high");
    assert.strictEqual(result.cross_signal[0].vector_score, 0.9);
    assert.strictEqual(result.cross_signal[0].graph_score, 3.0);
  });

  it("classifies vector-only pairs as semantic_only", () => {
    const vec = [{ slug_a: "A", slug_b: "B", score: 0.8, title_a: "A", summary_a: "", title_b: "B", summary_b: "" }];

    const result = mergeCategorize(vec, [], 15);
    assert.strictEqual(result.semantic_only.length, 1);
    assert.strictEqual(result.semantic_only[0].confidence, "medium");
    assert.strictEqual(result.semantic_only[0].graph_score, 0);
  });

  it("classifies graph-only pairs as structural_only", () => {
    const graph = [{ slug_a: "A", slug_b: "B", graph_score: 2.5, graph_signals: ["typeAffinity"] }];

    const result = mergeCategorize([], graph, 15);
    assert.strictEqual(result.structural_only.length, 1);
    assert.strictEqual(result.structural_only[0].confidence, "low");
    assert.strictEqual(result.structural_only[0].vector_score, 0);
  });

  it("respects top limit per category", () => {
    const vec = [];
    for (let i = 0; i < 20; i++) {
      vec.push({ slug_a: `A${i}`, slug_b: `B${i}`, score: 0.9 - i * 0.01, title_a: `A${i}`, summary_a: "", title_b: `B${i}`, summary_b: "" });
    }

    const result = mergeCategorize(vec, [], 5);
    assert.ok(result.semantic_only.length <= 5);
  });
});
