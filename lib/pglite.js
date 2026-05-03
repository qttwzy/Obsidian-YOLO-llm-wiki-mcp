"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { VAULT_ROOT } = require("./config");

const CACHE_DIR = path.join(VAULT_ROOT, ".source-tracker", "yolo_db_cache");

/**
 * Quote a string for safe embedding in obsidian eval code= argument.
 */
function jsStr(s) {
  return JSON.stringify(s);
}

/**
 * Infer vault name from VAULT_ROOT (basename of the vault directory).
 * @returns {string} Vault name (e.g., "AI")
 */
function vaultName() {
  return path.basename(VAULT_ROOT);
}

/**
 * Execute JavaScript code inside Obsidian via `obsidian eval` CLI.
 * The code must return a JSON-stringified value (use JSON.stringify()).
 * @param {string} code - JavaScript code to execute
 * @param {string} [vault] - Vault name (defaults to vaultName())
 * @param {number} [timeout=15000] - Timeout in ms
 * @returns {{ success: boolean, value?: any, error?: string }}
 */
function obsidianEval(code, vault, timeout = 15000) {
  const targetVault = vault || vaultName();

  try {
    const result = execSync(
      `obsidian eval vault=${jsStr(targetVault)} code=${jsStr(code)}`,
      { timeout, stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }
    ).trim();

    const match = result.match(/^=>\s*(.+)$/m);
    if (match) {
      return { success: true, value: JSON.parse(match[1]) };
    }
    return { success: false, error: "No output from obsidian eval" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Check if YOLO plugin is available and not currently indexing.
 * @param {string} [vault] - Vault name
 * @returns {{ available: boolean, indexing: boolean, error?: string }}
 */
function checkYoloStatus(vault) {
  const code = [
    "(async () => {",
    "  const yolo = app.plugins.plugins['yolo'];",
    "  if (!yolo || !yolo.dbManager || !yolo.dbManager.pgClient) {",
    "    return JSON.stringify({ available: false, indexing: false, error: 'YOLO plugin not loaded' });",
    "  }",
    "  const rag = yolo.ragIndexService;",
    "  const isRunning = rag && typeof rag.isRunning === 'function' && rag.isRunning();",
    "  return JSON.stringify({ available: true, indexing: !!isRunning });",
    "})()",
  ].join("");

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { available: false, indexing: false, error: result.error };
  }
  return result.value;
}

/**
 * Create a new embedding record in PGlite.
 * Expects entry.embedding to be a pre-computed vector (from embed.js).
 * @param {object} entry - Embedding data
 * @param {string} entry.path - Relative path (e.g., "wiki/entities/Foo.md")
 * @param {number} entry.mtime - File modification timestamp
 * @param {string} entry.content - File content
 * @param {string} entry.model - Embedding model name
 * @param {number} entry.dimension - Vector dimension
 * @param {number[]} entry.embedding - Pre-computed embedding vector
 * @param {object} [entry.metadata] - Additional metadata
 * @param {string} entry.content_hash - SHA256 hash of content
 * @param {string} [vault] - Vault name
 * @returns {{ success: boolean, id?: number, error?: string }}
 */
function createEmbedding(entry, vault) {
  const status = checkYoloStatus(vault);
  if (!status.available) {
    return { success: false, error: status.error };
  }
  if (status.indexing) {
    return { success: false, error: "YOLO indexing in progress, retry later" };
  }

  const metadata = JSON.stringify({
    ...entry.metadata,
    source: "mcp",
    updatedAt: new Date().toISOString(),
  });

  const vecStr = "[" + entry.embedding.join(",") + "]";

  const code = [
    "(async () => {",
    "  const pg = app.plugins.plugins['yolo'].dbManager.pgClient;",
    "  const r = await pg.query(",
    "    'INSERT INTO embeddings (path, mtime, content, model, dimension, embedding, metadata, content_hash) VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8) RETURNING id',",
    "    [" + jsStr(entry.path) + ", " + entry.mtime + ", " + jsStr(entry.content) + ", " + jsStr(entry.model) + ", " + entry.dimension + ", '" + vecStr + "', " + jsStr(metadata) + ", " + jsStr(entry.content_hash) + "]",
    "  );",
    "  return JSON.stringify({ success: true, id: r.rows[0].id });",
    "})()",
  ].join("");

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}

/**
 * Read embedding records by path.
 * @param {string} pagePath - Relative path
 * @param {string} [vault] - Vault name
 * @returns {{ success: boolean, rows?: object[], error?: string }}
 */
function readEmbedding(pagePath, vault) {
  const code = [
    "(async () => {",
    "  const pg = app.plugins.plugins['yolo'].dbManager.pgClient;",
    "  const r = await pg.query(",
    "    'SELECT id, path, mtime, content, model, dimension, metadata, content_hash, substring(embedding::text, 1, 50) as embedding_preview FROM embeddings WHERE path = $1 ORDER BY id',",
    "    [" + jsStr(pagePath) + "]",
    "  );",
    "  return JSON.stringify({ success: true, rows: r.rows });",
    "})()",
  ].join("");

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}

/**
 * Try obsidian eval to query the live YOLO PGlite database.
 * Returns null if Obsidian is not running / YOLO not loaded / query fails.
 */
function tryObsidianEval(queryVec, limit = 20, vault) {
  try {
    const vecJson = JSON.stringify(queryVec);
    // Build JS code that runs inside Obsidian's context
    const code = [
      "(async () => {",
      "  const yolo = app.plugins.plugins['yolo'];",
      "  if (!yolo || !yolo.dbManager || !yolo.dbManager.pgClient) return '[]';",
      "  const pg = yolo.dbManager.pgClient;",
      "  const vec = " + vecJson + ";",
      "  const vecStr = '[' + vec.join(',') + ']';",
      "  try {",
      "    const r = await pg.query(",
      "      \"SELECT path, content, metadata, embedding <=> '\" + vecStr + \"'::vector AS distance",
      "       FROM embeddings WHERE path LIKE 'wiki/%'",
      "       ORDER BY distance LIMIT " + limit + "\"",
      "    );",
      "    return JSON.stringify(r.rows.map(row => ({",
      "      path: row.path,",
      "      score: Math.round((1 - row.distance) * 10000) / 10000,",
      "      startLine: row.metadata ? row.metadata.startLine : null,",
      "      endLine: row.metadata ? row.metadata.endLine : null,",
      "      preview: (row.content || '').substring(0, 200)",
      "    })));",
      "  } catch(e) { return '[]'; }",
      "})()",
    ].join("");

    const targetVault = vault || vaultName();
    const result = execSync(`obsidian eval vault=${jsStr(targetVault)} code=${jsStr(code)}`, {
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();

    // Parse obsidian CLI output (format: "=> value")
    const match = result.match(/^=>\s*(.+)$/m);
    if (match) {
      const rows = JSON.parse(match[1]);
      if (rows.length > 0) return { source: "pglite_live", rows };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Query PGlite from cached tar.gz extraction.
 */
async function tryCacheQuery(queryVec, limit = 20) {
  if (!fs.existsSync(path.join(CACHE_DIR, "PG_VERSION"))) return null;

  try {
    const { PGlite } = require("@electric-sql/pglite");
    const { vector } = require("@electric-sql/pglite/vector");

    const pg = new PGlite({ dataDir: CACHE_DIR, extensions: { vector } });
    const vecStr = "[" + queryVec.join(",") + "]";

    const sql = [
      "SELECT path, content, metadata,",
      "       embedding <=> '" + vecStr + "'::vector AS distance",
      "FROM embeddings",
      "WHERE path LIKE 'wiki/%'",
      "ORDER BY distance",
      "LIMIT " + limit,
    ].join("\n");

    const result = await pg.query(sql);

    const rows = result.rows.map((r) => ({
      path: r.path,
      score: Math.round((1 - r.distance) * 10000) / 10000,
      startLine: r.metadata ? r.metadata.startLine : null,
      endLine: r.metadata ? r.metadata.endLine : null,
      preview: (r.content || "").substring(0, 200),
    }));

    await pg.close();
    return rows.length > 0 ? { source: "pglite_cache", rows } : null;
  } catch {
    return null;
  }
}

/**
 * Query YOLO PGlite for wiki chunks matching the query vector.
 * Primary: obsidian eval (live database)
 * Fallback: tar.gz cache
 *
 * @param {number[]} queryVec - Question embedding vector
 * @param {number} limit
 * @param {string} [vault] - Vault name
 * @returns {Promise<{ source: string, rows: Array }>}
 */
async function queryWikiChunks(queryVec, limit = 20, vault) {
  // Try live PGlite first
  const live = tryObsidianEval(queryVec, limit, vault);
  if (live) return live;

  // Fallback to cache
  const cache = await tryCacheQuery(queryVec, limit);
  if (cache) return cache;

  // Nothing available
  return { source: "unavailable", rows: [] };
}

module.exports = { queryWikiChunks, obsidianEval, vaultName, checkYoloStatus, createEmbedding, readEmbedding };
