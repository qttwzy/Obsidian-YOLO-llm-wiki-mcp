"use strict";

const fs = require("fs");
const { VAULT_ROOT, assertInsideVault, getWikiDir } = require("../lib/config");
const { buildGraph, parseFrontmatter, extractWikilinks, resolveLink, getResolvedOutLinks, loadGraph, saveGraph, appendChangelog, clearChangelog } = require("../lib/graph");
const { calculateEdgeWeight } = require("../lib/relevance");

/**
 * Full graph build. MCP tool handler for build_wiki_graph.
 * @param {string} [vaultRoot]
 */
function handleBuildGraph(vaultRoot) {
  const graph = buildGraph(vaultRoot);
  saveGraph(graph, vaultRoot);
  clearChangelog(vaultRoot);

  const nodeCount = Object.keys(graph.nodes).length;
  const edgeCount = graph.edges.length;
  const size = (JSON.stringify(graph).length / 1024).toFixed(0) + "KB";

  return {
    pages: nodeCount,
    edges: edgeCount,
    updated: graph.updated,
    size,
  };
}

/**
 * Compute structural diff between old node state and new file state.
 * @param {object} oldNode - Node from wiki_graph.json
 * @param {string} absPath - Absolute path to the current .md file
 * @param {string} [wikiDir] - For type inference
 * @returns {object} Structural diff
 */
function computeStructuralDiff(oldNode, absPath, wikiDir) {
  const { type, title, sources, content } = parseFrontmatter(absPath, wikiDir);
  const newLinks = extractWikilinks(content);

  const oldOutLinks = new Set(oldNode.outLinks);
  const newOutLinks = new Set(newLinks);
  const oldSources = new Set(oldNode.sources);
  const newSources = new Set(sources);

  return {
    outLinks: {
      added: [...newOutLinks].filter((l) => !oldOutLinks.has(l)),
      removed: [...oldOutLinks].filter((l) => !newOutLinks.has(l)),
    },
    sources: {
      added: [...newSources].filter((s) => !oldSources.has(s)),
      removed: [...oldSources].filter((s) => !newSources.has(s)),
    },
    typeChanged: oldNode.type !== type,
    titleChanged: oldNode.title !== title,
    contentChanged: true, // always true if this function is called
    newType: type,
    newTitle: title,
    newSources: sources,
    newOutLinks: newLinks,
  };
}

/**
 * Incremental graph update. MCP tool handler for update_wiki_graph.
 * @param {object} args - { filePath: string, semanticChange?: boolean, vaultRoot?: string }
 */
function handleUpdateGraph({ filePath, semanticChange, vaultRoot }) {
  const root = vaultRoot || VAULT_ROOT;

  const graph = loadGraph(root);
  if (!graph) {
    return { error: "Graph not built. Run build_wiki_graph first." };
  }

  let absPath;
  try {
    absPath = assertInsideVault(filePath, root);
  } catch (e) {
    return { error: e.message };
  }
  if (!fs.existsSync(absPath)) {
    return { error: `File not found: ${filePath}` };
  }

  // Resolve slug from filePath
  const slug = filePath
    .replace(/^wiki\//, "")
    .replace(/\.md$/, "")
    .replace(/\\/g, "/");

  const oldNode = graph.nodes[slug];
  if (!oldNode) {
    return { error: `Node not found in graph: ${slug}. Run build_wiki_graph to add new pages.` };
  }

  // Compute structural diff
  const wikiDir = getWikiDir(root);
  const diff = computeStructuralDiff(oldNode, absPath, wikiDir);

  // If semanticChange not provided, return diff and wait
  if (semanticChange === undefined || semanticChange === null) {
    return {
      updated: slug,
      structuralDiff: {
        outLinks: diff.outLinks,
        sources: diff.sources,
        typeChanged: diff.typeChanged,
        titleChanged: diff.titleChanged,
        contentChanged: diff.contentChanged,
      },
      semanticChange: null,
      waitingForConfirmation: true,
      question: "这次编辑是否改变了页面的语义？请传入 semanticChange 参数。",
      _hint: "确认语义变化后，建议用 update_pglite_embedding 刷新该页面的 PGlite 向量嵌入。",
    };
  }

  // semanticChange = false -> no update
  if (!semanticChange) {
    const report = {
      updated: slug,
      structuralDiff: {
        outLinks: diff.outLinks,
        sources: diff.sources,
        typeChanged: diff.typeChanged,
        titleChanged: diff.titleChanged,
      },
      semanticChange: false,
      status: "no_update",
      reason: "semanticChange is false",
      _hint: "链接已更，建议 update_pglite_embedding 刷新该页的 PGlite 向量嵌入。",
    };
    appendChangelog({ file: slug, semanticChange: false, changes: diff.outLinks }, root);
    return report;
  }

  // semanticChange = true -> incremental rebuild
  const actions = [];
  const affectedNodes = new Set();

  // Update node metadata
  graph.nodes[slug].title = diff.newTitle;
  graph.nodes[slug].type = diff.newType;
  graph.nodes[slug].sources = diff.newSources;
  graph.nodes[slug].outLinks = diff.newOutLinks;

  // Remove old edges involving this node
  const oldEdgeCount = graph.edges.length;
  graph.edges = graph.edges.filter((e) => {
    if (e.source === slug || e.target === slug) {
      affectedNodes.add(e.source === slug ? e.target : e.source);
      return false;
    }
    return true;
  });
  const removedEdges = oldEdgeCount - graph.edges.length;
  if (removedEdges > 0) {
    actions.push(`删除 ${removedEdges} 条旧边`);
  }

  // Recalculate inLinks for all nodes (since outLinks changed)
  for (const [, node] of Object.entries(graph.nodes)) {
    node.inLinks = node.inLinks.filter((l) => l !== slug);
  }
  for (const link of diff.newOutLinks) {
    const targetSlug = resolveLink(link, new Map(Object.entries(graph.nodes)));
    if (targetSlug && graph.nodes[targetSlug] && targetSlug !== slug) {
      if (!graph.nodes[targetSlug].inLinks.includes(slug)) {
        graph.nodes[targetSlug].inLinks.push(slug);
      }
    }
  }

  // Recalculate edges for affected nodes
  const nodesMap = new Map(Object.entries(graph.nodes));
  const slugsToRecompute = [slug, ...affectedNodes];
  let addedEdges = 0;

  for (const s of slugsToRecompute) {
    for (const [t, tNode] of nodesMap) {
      if (s === t) continue;
      const key = [s, t].sort().join("|||");
      // Skip if edge already exists
      if (graph.edges.some((e) => [e.source, e.target].sort().join("|||") === key)) continue;

      const sNode = nodesMap.get(s);
      if (!sNode) continue;
      const result = calculateEdgeWeight(sNode, tNode, nodesMap);
      if (result && result.weight > 0) {
        graph.edges.push({
          source: s,
          target: t,
          weight: result.weight,
          signals: result.signals,
          factors: result.factors,
        });
        addedEdges++;
        affectedNodes.add(t);
      }
    }
  }
  if (addedEdges > 0) {
    actions.push(`添加 ${addedEdges} 条新边`);
  }

  // Recompute weights for existing edges involving affected nodes
  let recomputed = 0;
  for (const edge of graph.edges) {
    if (affectedNodes.has(edge.source) || affectedNodes.has(edge.target)) {
      const sNode = nodesMap.get(edge.source);
      const tNode = nodesMap.get(edge.target);
      if (sNode && tNode) {
        const result = calculateEdgeWeight(sNode, tNode, nodesMap);
        if (result) {
          edge.weight = result.weight;
          edge.signals = result.signals;
          edge.factors = result.factors;
          recomputed++;
        }
      }
    }
  }
  if (recomputed > 0) {
    actions.push(`重新计算 ${recomputed} 条边的权重`);
  }

  // Update degree for all affected nodes
  for (const s of affectedNodes) {
    const node = graph.nodes[s];
    if (node) {
      const connected = new Set([...node.inLinks, ...getResolvedOutLinks(node.outLinks, nodesMap)]);
      node.degree = connected.size;
    }
  }
  // Update degree for the edited node itself
  const editedNode = graph.nodes[slug];
  if (editedNode) {
    const connected = new Set([...editedNode.inLinks, ...getResolvedOutLinks(editedNode.outLinks, nodesMap)]);
    editedNode.degree = connected.size;
  }

  graph.updated = new Date().toISOString();
  saveGraph(graph, root);

  const report = {
    updated: slug,
    structuralDiff: {
      outLinks: diff.outLinks,
      sources: diff.sources,
      typeChanged: diff.typeChanged,
      titleChanged: diff.titleChanged,
    },
    semanticChange: true,
    actions,
    affectedNodes: [...affectedNodes],
    newGraphStats: {
      totalNodes: Object.keys(graph.nodes).length,
      totalEdges: graph.edges.length,
    },
    _hint: "语义已更新，建议 update_pglite_embedding 刷新该页及受影响页的 PGlite 向量嵌入。",
  };

  appendChangelog({
    file: slug,
    semanticChange: true,
    changes: { outLinks: diff.outLinks, sources: diff.sources },
    actions,
    affectedNodes: [...affectedNodes],
  }, root);

  return report;
}

module.exports = { handleBuildGraph, handleUpdateGraph, loadGraph, saveGraph, appendChangelog, clearChangelog };
