"use strict";

/**
 * Wikilink resolution utilities.
 * Extracted from lib/graph.js to break circular dependency with lib/relevance.js.
 */

/**
 * Resolve a wikilink target to a known slug.
 * Tries exact match first, then title-based match.
 * @param {string} link - Wikilink target
 * @param {Map<string, object>} nodes - Map of slug → node
 * @returns {string|null} Resolved slug or null
 */
function resolveLink(link, nodes) {
  // Exact slug match
  if (nodes.has(link)) return link;

  // Try matching by title (case-insensitive)
  for (const [slug, node] of nodes) {
    if (node.title.toLowerCase() === link.toLowerCase()) return slug;
    // Also try the last segment of the slug
    const lastSegment = slug.split("/").pop();
    if (lastSegment.toLowerCase() === link.toLowerCase()) return slug;
  }

  return null;
}

/**
 * Get resolved outLink slugs (only those that exist in the graph).
 * @param {string[]} outLinks - Array of wikilink targets
 * @param {Map<string, object>} nodes - Map of slug → node
 * @returns {string[]} Resolved slugs
 */
function getResolvedOutLinks(outLinks, nodes) {
  const resolved = [];
  for (const link of outLinks) {
    const slug = resolveLink(link, nodes);
    if (slug && nodes.has(slug)) resolved.push(slug);
  }
  return resolved;
}

module.exports = { resolveLink, getResolvedOutLinks };
