"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// mergeResults is private to tools/search.js — inlined for testing.

const GREP_SCORE = 0.5;
const GREP_BOOST_THRESHOLD = 0.6;

function mergeResults(grepResults, pageResults, chunkResults, _storeEntries) {
  const seen = new Map();

  for (const r of [...pageResults, ...chunkResults]) {
    const key = r.path;
    if (!seen.has(key) || seen.get(key).score < r.score) {
      seen.set(key, r);
    }
  }

  for (const r of grepResults) {
    const key = r.path;
    if (!seen.has(key)) {
      seen.set(key, { ...r, score: GREP_SCORE });
    } else if (seen.get(key).score < GREP_BOOST_THRESHOLD) {
      const existing = seen.get(key);
      seen.set(key, { ...existing, score: Math.max(existing.score, GREP_BOOST_THRESHOLD) });
    }
  }

  const MAX_RESULTS = 8;
  return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

describe("mergeResults", () => {
  it("deduplicates by path, keeping higher score", () => {
    const grep = [{ path: "wiki/a.md", score: 1.0, source: "grep", preview: null }];
    const page = [{ path: "wiki/a.md", score: 0.9, source: "page_store", slug: "a", title: "A", summary: "..." }];

    const merged = mergeResults(grep, page, [], []);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].source, "page_store");
  });

  it("adds grep results not found in semantic channels", () => {
    const grep = [{ path: "wiki/b.md", score: 1.0, source: "grep", preview: null }];

    const merged = mergeResults(grep, [], [], []);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].score, GREP_SCORE);
  });

  it("boosts low-scoring semantic results confirmed by grep", () => {
    const grep = [{ path: "wiki/c.md", score: 1.0, source: "grep", preview: null }];
    const page = [{ path: "wiki/c.md", score: 0.3, source: "page_store", slug: "c", title: "C", summary: "..." }];

    const merged = mergeResults(grep, page, [], []);
    assert.strictEqual(merged.length, 1);
    assert.ok(merged[0].score >= GREP_BOOST_THRESHOLD);
  });

  it("sorts by descending score", () => {
    const grep = [
      { path: "wiki/a.md", score: 1.0, source: "grep", preview: null },
      { path: "wiki/b.md", score: 1.0, source: "grep", preview: null },
    ];
    const page = [{ path: "wiki/b.md", score: 0.8, source: "page_store", slug: "b", title: "B", summary: "..." }];

    const merged = mergeResults(grep, page, [], []);
    assert.ok(merged[0].score >= merged[1].score);
  });

  it("respects MAX_RESULTS of 8", () => {
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push({ path: `wiki/${i}.md`, score: 0.9 - i * 0.01, source: "page_store", slug: `${i}`, title: `${i}`, summary: "" });
    }
    const merged = mergeResults([], results, [], []);
    assert.ok(merged.length <= 8);
  });
});
