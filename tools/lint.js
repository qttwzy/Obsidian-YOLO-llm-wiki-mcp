"use strict";

const fs = require("fs");
const path = require("path");
const { loadStore } = require("../lib/page-store");
const { cosineSimilarity } = require("../lib/embed");
const { VAULT_ROOT } = require("../lib/config");
const { getResolvedOutLinks } = require("../lib/resolver");
const { atomicWriteFileSync } = require("../lib/fs-utils");

function getSkippedPath(vaultRoot) {
  return path.join(vaultRoot || VAULT_ROOT, ".source-tracker", "skipped_connections.json");
}

function getLastLintPath(vaultRoot) {
  return path.join(vaultRoot || VAULT_ROOT, ".source-tracker", "last_lint.json");
}

function loadSkipped(vaultRoot) {
  const skippedPath = getSkippedPath(vaultRoot);
  if (!fs.existsSync(skippedPath)) return new Set();
  const data = JSON.parse(fs.readFileSync(skippedPath, "utf-8"));
  return new Set(
    (data.skipped || []).map((s) => JSON.stringify([s.a, s.b].sort()))
  );
}

function hasExistingLink(entryA, entryB, vaultRoot) {
  const root = vaultRoot || VAULT_ROOT;
  const checkFile = (filePath, slug) => {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return content.includes(`[[${slug}]]`) || content.includes(`[[${slug}|`);
    } catch {
      return false;
    }
  };

  const pathA = path.join(root, entryA.path);
  const pathB = path.join(root, entryB.path);
  return checkFile(pathA, entryB.slug) || checkFile(pathB, entryA.slug);
}

/**
 * Find candidate page pairs with high cosine similarity but no existing links.
 */
function lintConnections({ top = 30, minScore = 0.5, vaultRoot } = {}) {
  const store = loadStore(vaultRoot);
  if (!store) return { error: "Page store not found. Run build_store first." };

  const entries = store.entries;
  const skipped = loadSkipped(vaultRoot);

  const pairs = [];
  const seen = new Set();

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const key = JSON.stringify([a.slug, b.slug].sort());
      if (seen.has(key)) continue;
      seen.add(key);
      if (skipped.has(key)) continue;

      const score = Math.round(cosineSimilarity(a.vector, b.vector) * 10000) / 10000;
      if (score < minScore) continue;
      if (hasExistingLink(a, b, vaultRoot)) continue;

      pairs.push({
        slug_a: a.slug, title_a: a.title, summary_a: a.summary,
        slug_b: b.slug, title_b: b.title, summary_b: b.summary,
        score,
      });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  return { candidates: pairs.slice(0, top), totalFiltered: pairs.length };
}

/**
 * Record a pair as skipped (false positive).
 */
function markSkipped(slugA, slugB, vaultRoot) {
  const skippedPath = getSkippedPath(vaultRoot);
  const dir = path.dirname(skippedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let data = { skipped: [] };
  if (fs.existsSync(skippedPath)) {
    data = JSON.parse(fs.readFileSync(skippedPath, "utf-8"));
  }

  data.skipped.push({
    a: slugA, b: slugB,
    skippedAt: new Date().toISOString(),
  });

  atomicWriteFileSync(skippedPath, JSON.stringify(data, null, 2));
  return { status: "skipped", a: slugA, b: slugB };
}

/**
 * Update the last lint timestamp.
 */
function updateLintTimestamp(vaultRoot) {
  const lastLintPath = getLastLintPath(vaultRoot);
  const dir = path.dirname(lastLintPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(lastLintPath, JSON.stringify({
    lastLint: new Date().toISOString(),
  }));
}

/**
 * Graph topology lint: find edges in wiki_graph.json that represent
 * meaningful connections but don't have existing wikilinks.
 */
function graphLint(graph, { minScore = 1.0, vaultRoot } = {}) {
  const skipped = loadSkipped(vaultRoot);
  const results = [];

  for (const edge of graph.edges) {
    if (edge.weight < minScore) continue;

    const key = JSON.stringify([edge.source, edge.target].sort());
    if (skipped.has(key)) continue;

    // Check if wikilink already exists
    const nodeA = graph.nodes[edge.source];
    const nodeB = graph.nodes[edge.target];
    if (!nodeA || !nodeB) continue;
    if (hasExistingLink({ slug: edge.source, path: nodeA.path }, { slug: edge.target, path: nodeB.path }, vaultRoot)) continue;

    results.push({
      slug_a: edge.source,
      slug_b: edge.target,
      graph_score: edge.weight,
      graph_signals: edge.signals,
    });
  }

  results.sort((a, b) => b.graph_score - a.graph_score);
  return results;
}

/**
 * Detect structural insights: isolated nodes and bridge nodes.
 */
function structuralInsights(graph) {
  const insights = [];
  const skipSlugs = new Set(["index", "log", "overview"]);
  // Build a nodes Map once for O(1) outLink resolution via getResolvedOutLinks,
  // instead of a linear title scan over all nodes per outLink (O(n²)).
  const nodesMap = new Map(Object.entries(graph.nodes));

  for (const [slug, node] of Object.entries(graph.nodes)) {
    const lastSegment = slug.split("/").pop().toLowerCase();
    if (skipSlugs.has(lastSegment)) continue;

    // Isolated node: degree <= 1
    if (node.degree <= 1) {
      insights.push({
        type: "isolated_node",
        node: slug,
        degree: node.degree,
        suggestion: "无入站链接，建议从相关页面添加 [[wikilink]]",
      });
    }

    // Bridge node: neighbors span >= 2 different types
    const neighborTypes = new Set();
    for (const inLink of (node.inLinks || [])) {
      const nNode = graph.nodes[inLink];
      if (nNode) neighborTypes.add(nNode.type);
    }
    // Resolve outLinks to actual node slugs, then collect their types.
    for (const resolvedSlug of getResolvedOutLinks(node.outLinks || [], nodesMap)) {
      const nNode = graph.nodes[resolvedSlug];
      if (nNode) neighborTypes.add(nNode.type);
    }
    if (neighborTypes.size >= 2) {
      insights.push({
        type: "bridge_node",
        node: slug,
        connectsTypes: [...neighborTypes],
        suggestion: `连接 ${neighborTypes.size} 种不同类型邻居的关键节点`,
      });
    }
  }

  return insights;
}

/**
 * Merge vector and graph results into four categories.
 */
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
        slug_a: v.slug_a,
        slug_b: v.slug_b,
        vector_score: v.score,
        graph_score: g.graph_score,
        graph_signals: g.graph_signals,
        confidence: "high",
      });
    } else if (v && !g) {
      semanticOnly.push({
        slug_a: v.slug_a,
        slug_b: v.slug_b,
        vector_score: v.score,
        graph_score: 0,
        graph_signals: [],
        confidence: "medium",
      });
    } else if (!v && g) {
      structuralOnly.push({
        slug_a: g.slug_a,
        slug_b: g.slug_b,
        vector_score: 0,
        graph_score: g.graph_score,
        graph_signals: g.graph_signals,
        confidence: "low",
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

/**
 * Full dual-engine lint. MCP tool handler for lint_full.
 */
function lintFull({ top = 15, minVectorScore = 0.5, minGraphScore = 1.0, vaultRoot } = {}) {
  // Load graph
  const { loadGraph } = require("../lib/graph");
  const graph = loadGraph(vaultRoot);
  if (!graph) return { error: "Graph not built. Run build_wiki_graph first." };

  // Load page store (for vector lint)
  const store = loadStore(vaultRoot);
  if (!store) return { error: "Page store not built. Run build_page_store first." };

  // Run vector lint (reuse existing logic)
  const vectorResults = lintConnections({ top: top * 3, minScore: minVectorScore, vaultRoot });
  const vectorPairs = vectorResults.candidates || [];

  // Run graph lint
  const graphPairs = graphLint(graph, { minScore: minGraphScore, vaultRoot });

  // Merge and categorize
  const categorized = mergeCategorize(vectorPairs, graphPairs, top);

  // Structural insights
  const insights = structuralInsights(graph);

  const totalCandidates =
    categorized.cross_signal.length +
    categorized.semantic_only.length +
    categorized.structural_only.length;

  return {
    ...categorized,
    structural_insights: insights.slice(0, top),
    summary: {
      total_candidates: totalCandidates,
      cross_signal: categorized.cross_signal.length,
      semantic_only: categorized.semantic_only.length,
      structural_only: categorized.structural_only.length,
      insights: Math.min(insights.length, top),
    },
  };
}

module.exports = { lintConnections, markSkipped, updateLintTimestamp, lintFull };
