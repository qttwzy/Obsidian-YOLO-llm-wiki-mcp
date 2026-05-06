"use strict";

const crypto = require("crypto");
const { updateEmbedding, deleteEmbedding, queryPgliteStatus } = require("../lib/pglite");
const { embedViaYolo } = require("../lib/pglite");

/**
 * Compute SHA256 hash of content (first 16 chars).
 */
function contentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);
}

/**
 * Handle update_pglite_embedding tool.
 * @param {object} args - Tool arguments
 * @returns {object} Result
 */
async function handleUpdateEmbedding(args) {
  const { vault, path: filePath, content, metadata } = args;

  if (!filePath) {
    return { error: "path is required" };
  }
  if (!content) {
    return { error: "content is required" };
  }

  // Compute embedding via YOLO plugin
  let embedding;
  try {
    const vectors = await embedViaYolo([content], vault);
    if (!vectors || vectors.length === 0 || !Array.isArray(vectors[0]) || vectors[0].length === 0) {
      return { error: "YOLO embedding returned empty result" };
    }
    embedding = vectors[0];
  } catch (e) {
    return { error: "Failed to compute embedding via YOLO: " + e.message };
  }

  const entry = {
    path: filePath,
    mtime: Date.now(),
    content: content,
    model: "yolo",
    dimension: embedding.length,
    embedding: embedding,
    metadata: metadata || {},
    content_hash: contentHash(content),
  };

  const result = updateEmbedding(filePath, entry, vault);
  return result;
}

/**
 * Handle delete_pglite_embedding tool.
 * @param {object} args - Tool arguments
 * @returns {object} Result
 */
async function handleDeleteEmbedding(args) {
  const { vault, path: filePath } = args;

  if (!filePath) {
    return { error: "path is required" };
  }

  return deleteEmbedding(filePath, vault);
}

/**
 * Handle query_pglite_status tool.
 * @param {object} args - Tool arguments
 * @returns {object} Result
 */
function handleQueryStatus(args) {
  const { vault } = args;
  return queryPgliteStatus(vault);
}

module.exports = { contentHash, handleUpdateEmbedding, handleDeleteEmbedding, handleQueryStatus };
