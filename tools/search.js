"use strict";

const fs = require("fs");
const { embedViaYolo } = require("../lib/pglite");
const { searchStore, loadStore } = require("../lib/page-store");
const { queryWikiChunks } = require("../lib/pglite");
const { resolveVaultRoot, walkWikiPages } = require("../lib/config");

const GREP_SCORE = 0.5;
const GREP_BOOST_THRESHOLD = 0.6;
const MAX_RESULTS = 8;

/**
 * Channel 1: Grep wiki/ for keyword matches.
 * @param {string} query
 * @param {string} [vaultRoot]
 */
function grepWiki(query, vaultRoot) {
  try {
    const keywords = query.split(/\s+/).filter((w) => w.length > 1);
    if (!keywords.length) return [];

    const files = walkWikiPages(vaultRoot);
    const results = [];
    for (const f of files) {
      const content = fs.readFileSync(f.absPath, "utf-8").toLowerCase();
      if (keywords.every((kw) => content.includes(kw.toLowerCase()))) {
        results.push({ path: f.relPath, score: 1.0, source: "grep", preview: null });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Channel 2: Page embedding store cosine search.
 * @param {number[]} queryVec
 * @param {string} [vaultRoot]
 */
async function pageSearch(queryVec, vaultRoot) {
  const results = searchStore(queryVec, 10, vaultRoot);
  return results.map((r) => ({ ...r, source: "page_store" }));
}

/**
 * Channel 3: YOLO PGlite pgvector chunk search.
 * @param {number[]} queryVec
 * @param {string} [vault]
 */
async function chunkSearch(queryVec, vault) {
  const { source, rows } = await queryWikiChunks(queryVec, 20, vault);
  return rows.map((r) => ({ ...r, source }));
}

/**
 * Cross-reference a path with page store to get slug/title metadata.
 */
function enrichWithPageStore(entry, storeEntries) {
  if (entry.slug && entry.title) return entry;
  const match = storeEntries.find((e) => e.path === entry.path || e.slug === entry.path);
  if (match) {
    return { ...entry, slug: match.slug, title: match.title, summary: match.summary };
  }
  return entry;
}

/**
 * Merge results from all three channels, deduplicate by path.
 * Semantic channels (page_store, pglite) get priority over grep.
 */
function mergeResults(grepResults, pageResults, chunkResults, storeEntries) {
  const seen = new Map();

  // Add semantic results first (they have real relevance scores)
  for (const r of [...pageResults, ...chunkResults]) {
    const key = r.path;
    if (!seen.has(key) || seen.get(key).score < r.score) {
      seen.set(key, enrichWithPageStore(r, storeEntries));
    }
  }

  // Add grep results with a small score penalty so semantic results rank higher
  for (const r of grepResults) {
    const key = r.path;
    const adjustedScore = GREP_SCORE;
    if (!seen.has(key)) {
      seen.set(key, enrichWithPageStore({ ...r, score: adjustedScore }, storeEntries));
    } else if (seen.get(key).score < GREP_BOOST_THRESHOLD) {
      // Boost: grep confirming a low-scoring semantic result
      const existing = seen.get(key);
      seen.set(key, { ...existing, score: Math.max(existing.score, GREP_BOOST_THRESHOLD) });
    }
  }

  const merged = Array.from(seen.values());
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, MAX_RESULTS);
}

/**
 * Main search entry point.
 * @param {string} query
 * @param {string} [vault] - Vault name or path
 */
async function searchWiki(query, vault) {
  if (!query || query.trim().length === 0) {
    return { results: [], sources: ["none"], count: 0 };
  }

  const vaultRoot = resolveVaultRoot(vault);
  const grepResults = grepWiki(query, vaultRoot);

  // Try YOLO embedding; fall back to grep-only if unavailable
  let queryVec = null;
  try {
    const queryVecs = await embedViaYolo([query.trim()], vault);
    if (queryVecs && queryVecs.length > 0 && Array.isArray(queryVecs[0]) && queryVecs[0].length > 0) {
      queryVec = queryVecs[0];
    }
  } catch {
    // YOLO unavailable — grep-only
  }

  if (!queryVec) {
    const store = loadStore(vaultRoot);
    const storeEntries = store ? store.entries : [];
    const enriched = grepResults.map((r) => enrichWithPageStore({ ...r, score: GREP_SCORE }, storeEntries));
    enriched.sort((a, b) => b.score - a.score);
    const output = enriched.slice(0, MAX_RESULTS).map((r) => ({
      path: r.path,
      slug: r.slug || "",
      title: r.title || "",
      score: r.score,
    }));
    return { results: output, sources: ["grep"], count: output.length };
  }

  // Three channels in parallel
  const [pageResults, chunkResults] = await Promise.all([
    pageSearch(queryVec, vaultRoot),
    chunkSearch(queryVec, vault),
  ]);

  const store = loadStore(vaultRoot);
  const storeEntries = store ? store.entries : [];
  const results = mergeResults(grepResults, pageResults, chunkResults, storeEntries);

  const sources = [...new Set(results.map((r) => r.source))];

  const output = results.map((r) => ({
    path: r.path,
    slug: r.slug || "",
    title: r.title || "",
    score: r.score,
    ...(r.preview ? { preview: r.preview } : {}),
  }));

  return { results: output, sources, count: output.length };
}

module.exports = { searchWiki };
