"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteFileSync } = require("./fs-utils");
const { VAULT_ROOT, getWikiDir, walkWikiPages } = require("./config");

function walkWiki(vaultRoot) {
  return walkWikiPages(vaultRoot);
}

/**
 * Extract all [[wikilinks]] from content.
 * Returns array of link targets (without aliases).
 * Matches: [[target]], [[target|alias]]
 */
function extractWikilinks(content) {
  const links = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

/**
 * Extract sources[] from frontmatter string (not full file).
 * Handles both plain strings and wikilink-wrapped strings.
 */
function extractSourcesFromFrontmatter(fm) {
  const sources = [];
  let inSources = false;
  for (const line of fm.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "sources:") {
      inSources = true;
      continue;
    }
    if (inSources) {
      if (trimmed.startsWith("- ")) {
        let src = trimmed.substring(2).trim().replace(/^["']|["']$/g, "");
        // Strip wikilink wrapper: [[raw/...]] -> raw/...
        const wm = src.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
        if (wm) src = wm[1].trim();
        sources.push(src);
      } else if (trimmed && !trimmed.startsWith("#")) {
        // End of sources block (non-empty, non-comment line that's not a list item)
        inSources = false;
      }
    }
  }
  return sources;
}

/**
 * Parse YAML frontmatter and extract key fields.
 * Returns { type, title, sources, body, content }
 * @param {string} absPath
 * @param {string} [wikiDir] - For fallback type inference
 */
function parseFrontmatter(absPath, wikiDir) {
  const raw = fs.readFileSync(absPath, "utf-8");
  let type = "";
  let title = path.basename(absPath).replace(".md", "");
  let sources = [];
  let body = raw;

  if (raw.startsWith("---")) {
    const endIdx = raw.indexOf("---", 3);
    if (endIdx !== -1) {
      const fm = raw.substring(3, endIdx);
      body = raw.substring(endIdx + 3).trim();

      // Extract type
      const typeMatch = fm.match(/^type:\s*(.+)$/m);
      if (typeMatch) type = typeMatch[1].trim();

      // Extract title (frontmatter title overrides filename)
      const titleMatch = fm.match(/^title:\s*(.+)$/m);
      if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, "");

      // Extract sources array
      sources = extractSourcesFromFrontmatter(fm);
    }
  }

  // Fallback type from path prefix
  if (!type) {
    const wiki = wikiDir || getWikiDir();
    const relFromWiki = path.relative(wiki, absPath).replace(/\\/g, "/");
    if (relFromWiki.startsWith("entities/")) type = "entity";
    else if (relFromWiki.startsWith("concepts/")) type = "concept";
    else if (relFromWiki.startsWith("synthesis/")) type = "synthesis";
  }

  return { type, title, sources, body, content: raw };
}

const { resolveLink, getResolvedOutLinks } = require("./resolver");

/**
 * Build the complete wiki graph.
 * @param {string} [vaultRoot]
 * @returns {{ version: number, updated: string, nodes: Object, edges: Array }}
 */
function buildGraph(vaultRoot) {
  const root = vaultRoot || VAULT_ROOT;
  const wikiDir = getWikiDir(root);

  const pages = walkWiki(root);
  const nodes = new Map();

  // Pass 1: Parse all pages
  for (const page of pages) {
    const { type, title, sources, body, content } = parseFrontmatter(page.absPath, wikiDir);
    const wikilinks = extractWikilinks(content);
    nodes.set(page.slug, {
      slug: page.slug,
      title,
      type,
      path: page.relPath,
      sources,
      outLinks: wikilinks,
      inLinks: [],
      degree: 0,
      _body: body, // temporary, removed before output
    });
  }

  // Pass 2: Resolve references -> populate inLinks
  for (const [slug, node] of nodes) {
    for (const link of node.outLinks) {
      // Try to resolve link to a known slug
      const targetSlug = resolveLink(link, nodes);
      if (targetSlug && nodes.has(targetSlug) && targetSlug !== slug) {
        const target = nodes.get(targetSlug);
        if (!target.inLinks.includes(slug)) {
          target.inLinks.push(slug);
        }
      }
    }
  }

  // Update degree (inLinks + outLinks count, deduplicated)
  for (const [, node] of nodes) {
    const connected = new Set([...node.inLinks, ...getResolvedOutLinks(node.outLinks, nodes)]);
    node.degree = connected.size;
  }

  // Pass 3: Calculate edges using relevance module
  const { calculateEdges } = require("./relevance");
  const edges = calculateEdges(nodes);

  // Clean up temporary fields
  for (const [, node] of nodes) {
    delete node._body;
  }

  // Convert Map to plain object
  const nodesObj = {};
  for (const [slug, node] of nodes) {
    nodesObj[slug] = node;
  }

  return {
    version: 1,
    updated: new Date().toISOString(),
    nodes: nodesObj,
    edges,
  };
}

// --- Graph persistence (load/save) ---

function getGraphPath(vaultRoot) {
  return path.join(vaultRoot || VAULT_ROOT, ".source-tracker", "wiki_graph.json");
}

function getChangelogPath(vaultRoot) {
  return path.join(vaultRoot || VAULT_ROOT, ".source-tracker", "graph_changelog.json");
}

/**
 * Load existing graph from disk.
 * @param {string} [vaultRoot]
 * @returns {object|null}
 */
function loadGraph(vaultRoot) {
  const graphPath = getGraphPath(vaultRoot);
  if (!fs.existsSync(graphPath)) return null;
  return JSON.parse(fs.readFileSync(graphPath, "utf-8"));
}

/**
 * Save graph to disk.
 * @param {object} graph
 * @param {string} [vaultRoot]
 */
function saveGraph(graph, vaultRoot) {
  const graphPath = getGraphPath(vaultRoot);
  const dir = path.dirname(graphPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(graphPath, JSON.stringify(graph, null, 2));
}

/**
 * Append an entry to the changelog.
 * @param {object} entry
 * @param {string} [vaultRoot]
 */
function appendChangelog(entry, vaultRoot) {
  const changelogPath = getChangelogPath(vaultRoot);
  const dir = path.dirname(changelogPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let data = { entries: [] };
  if (fs.existsSync(changelogPath)) {
    data = JSON.parse(fs.readFileSync(changelogPath, "utf-8"));
  }
  data.entries.push({ ...entry, timestamp: new Date().toISOString() });
  atomicWriteFileSync(changelogPath, JSON.stringify(data, null, 2));
}

/**
 * Clear the changelog file.
 * @param {string} [vaultRoot]
 */
function clearChangelog(vaultRoot) {
  const changelogPath = getChangelogPath(vaultRoot);
  const dir = path.dirname(changelogPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(changelogPath, JSON.stringify({ entries: [] }, null, 2));
}

module.exports = {
  walkWiki,
  extractWikilinks,
  parseFrontmatter,
  extractSourcesFromFrontmatter,
  buildGraph,
  resolveLink,
  getResolvedOutLinks,
  loadGraph,
  saveGraph,
  appendChangelog,
  clearChangelog,
};
