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
 * Try obsidian eval to query the live YOLO PGlite database.
 * Returns null if Obsidian is not running / YOLO not loaded / query fails.
 */
function tryObsidianEval(queryVec, limit = 20) {
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

    const result = execSync(`obsidian eval vault="AI" code=${jsStr(code)}`, {
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
 * @returns {Promise<{ source: string, rows: Array }>}
 */
async function queryWikiChunks(queryVec, limit = 20) {
  // Try live PGlite first
  const live = tryObsidianEval(queryVec, limit);
  if (live) return live;

  // Fallback to cache
  const cache = await tryCacheQuery(queryVec, limit);
  if (cache) return cache;

  // Nothing available
  return { source: "unavailable", rows: [] };
}

module.exports = { queryWikiChunks };
