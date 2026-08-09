"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { VAULT_ROOT, resolveVaultRoot } = require("./config");

/**
 * Quote a string for safe embedding in obsidian eval code= argument.
 */
function jsStr(s) {
  return JSON.stringify(s);
}

/**
 * Validate an embedding vector is a non-empty array of finite numbers.
 * Throws on invalid input — guards against malformed data reaching SQL.
 * @param {number[]} vec
 */
function assertValidVector(vec) {
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("Invalid embedding vector: not a non-empty array");
  }
  for (const v of vec) {
    if (typeof v !== "number" || !isFinite(v)) {
      throw new Error("Invalid embedding vector value: " + v);
    }
  }
}

/**
 * Validate the non-vector fields shared by legacy SQL and modern vector-store
 * writes. Modern YOLO overrides model/dimension with its active RAG model, but
 * keeping the caller contract strict prevents malformed records in old YOLO.
 * @param {object} entry
 */
function assertValidEmbeddingEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Invalid embedding entry");
  }
  if (typeof entry.path !== "string" || entry.path.length === 0) {
    throw new Error("Invalid embedding path");
  }
  if (typeof entry.content !== "string") {
    throw new Error("Invalid embedding content");
  }
  if (typeof entry.model !== "string" || entry.model.length === 0) {
    throw new Error("Invalid embedding model");
  }
  if (!Number.isFinite(entry.mtime)) {
    throw new Error("Invalid embedding mtime");
  }
  assertValidVector(entry.embedding);
  if (!Number.isInteger(entry.dimension) || entry.dimension !== entry.embedding.length) {
    throw new Error("Embedding dimension does not match vector length");
  }
  if (typeof entry.content_hash !== "string") {
    throw new Error("Invalid embedding content hash");
  }
}

/**
 * Infer vault name from VAULT_ROOT (basename of the vault directory).
 * @returns {string} Vault name (e.g., "AI")
 */
function vaultName() {
  return path.basename(VAULT_ROOT);
}

/**
 * Return the fallback PGlite cache directory belonging to a vault.
 * @param {string} [vault] - Vault name or absolute path
 * @returns {string}
 */
function getCacheDir(vault) {
  const root = vault ? resolveVaultRoot(vault) : VAULT_ROOT;
  return path.join(root, ".source-tracker", "yolo_db_cache");
}

function getObsidianCliPath() {
  return process.env.OBSIDIAN_CLI_PATH || "obsidian";
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

  // Write code to temp file to bypass Windows ~8K CLI argument limit.
  // The bootstrap reads the file and evals it. Must NOT be quoted —
  // obsidian eval treats quoted code= values as string literals.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-obsidian-eval-"));
  const tmpFile = path.join(tmpDir, "payload.js");
  fs.writeFileSync(tmpFile, code, { encoding: "utf-8", mode: 0o600 });
  const bootstrap = `eval(require('fs').readFileSync(${jsStr(tmpFile)},'utf-8'))`;

  try {
    const result = execFileSync(
      getObsidianCliPath(), ["eval", `vault=${jsStr(targetVault)}`, `code=${bootstrap}`],
      { timeout, stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }
    ).trim();

    const match = result.match(/^=>\s*([\s\S]+)$/m);
    if (match) {
      return { success: true, value: JSON.parse(match[1]) };
    }
    return { success: false, error: "No output from obsidian eval" };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { void 0; }
    try { fs.rmdirSync(tmpDir); } catch { void 0; }
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
    "  if (!yolo) {",
    "    return JSON.stringify({ available: false, indexing: false, error: 'YOLO plugin not loaded' });",
    "  }",
    "  const indexService = yolo.ragIndexService;",
    "  const isRunning = indexService && typeof indexService.isRunning === 'function' && indexService.isRunning();",
    "  const db = yolo.dbManager;",
    "  if (!db) {",
    "    return JSON.stringify({ available: false, indexing: !!isRunning, error: 'YOLO database manager is not initialized' });",
    "  }",
    "  if (db.pgClient && typeof db.pgClient.query === 'function') {",
    "    return JSON.stringify({ available: true, indexing: !!isRunning, api: 'legacy_pg_client' });",
    "  }",
    "  try {",
    "    const vm = typeof db.getVectorManager === 'function' ? db.getVectorManager() : null;",
    "    const store = (db.session && db.session.vectorStore) || (vm && vm.repository);",
    "    if (vm && store && typeof vm.getEmbeddingStats === 'function' && typeof store.listChunksForPaths === 'function') {",
    "      return JSON.stringify({ available: true, indexing: !!isRunning, api: 'vector_store' });",
    "    }",
    "  } catch (e) {",
    "    return JSON.stringify({ available: false, indexing: !!isRunning, error: 'YOLO vector database is not initialized: ' + (e && e.message ? e.message : String(e)) });",
    "  }",
    "  return JSON.stringify({ available: false, indexing: !!isRunning, error: 'YOLO database API is unavailable or unsupported' });",
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
  try {
    assertValidEmbeddingEntry(entry);
  } catch (e) {
    return { success: false, error: e.message };
  }
  const status = checkYoloStatus(vault);
  if (!status.available) {
    return { success: false, error: status.error };
  }
  if (status.indexing) {
    return { success: false, error: "YOLO indexing in progress, retry later" };
  }

  const metadata = {
    ...entry.metadata,
    source: "mcp",
    updatedAt: new Date().toISOString(),
    startLine: Number.isInteger(entry.metadata && entry.metadata.startLine)
      ? entry.metadata.startLine
      : 1,
    endLine: Number.isInteger(entry.metadata && entry.metadata.endLine)
      ? entry.metadata.endLine
      : entry.content.split("\n").length,
  };
  const metadataJson = JSON.stringify(metadata);

  // Use JSON.stringify for a valid JS array literal — safer than join(",")
  // which could break the JS string literal if embedding ever held non-numbers.
  // assertValidVector above guarantees finite numbers, so both are equivalent
  // in practice; this is defense-in-depth against future regressions.
  const vecStr = JSON.stringify(entry.embedding);

  let code;
  if (status.api === "vector_store") {
    code = [
      "(async () => {",
      "  const yolo = app.plugins.plugins['yolo'];",
      "  const db = yolo.dbManager;",
      "  const vm = db.getVectorManager();",
      "  const store = (db.session && db.session.vectorStore) || vm.repository;",
      "  const rag = await yolo.ragCoordinator.getRagEngine();",
      "  const model = rag && rag.embeddingModel;",
      "  if (!model) throw new Error('YOLO embedding model is not configured');",
      "  if (yolo.ragIndexService && typeof yolo.ragIndexService.isRunning === 'function' && yolo.ragIndexService.isRunning()) throw new Error('YOLO indexing in progress, retry later');",
      "  const embedding = " + vecStr + ";",
      "  if (embedding.length !== model.dimension) throw new Error('Embedding dimension does not match YOLO active model');",
      "  const before = await store.listChunksForPaths(model.id, [" + jsStr(entry.path) + "]);",
      "  const oldIds = new Set(before.map(row => row.id));",
      "  await store.insertVectors([{",
      "    path: " + jsStr(entry.path) + ",",
      "    mtime: " + entry.mtime + ",",
      "    content: " + jsStr(entry.content) + ",",
      "    content_hash: " + jsStr(entry.content_hash) + ",",
      "    model: model.id,",
      "    dimension: model.dimension,",
      "    embedding,",
      "    metadata: " + metadataJson,
      "  }]);",
      "  const after = await store.listChunksForPaths(model.id, [" + jsStr(entry.path) + "]);",
      "  const inserted = after.filter(row => !oldIds.has(row.id)).sort((a, b) => b.id - a.id)[0];",
      "  if (!inserted) throw new Error('YOLO vector store did not return the inserted record');",
      "  await db.save();",
      "  return JSON.stringify({ success: true, id: inserted.id, api: 'vector_store' });",
      "})()",
    ].join("");
  } else {
    code = [
      "(async () => {",
      "  const pg = app.plugins.plugins['yolo'].dbManager.pgClient;",
      "  const r = await pg.query(",
      "    'INSERT INTO embeddings (path, mtime, content, model, dimension, embedding, metadata, content_hash) VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8) RETURNING id',",
      "    [" + jsStr(entry.path) + ", " + entry.mtime + ", " + jsStr(entry.content) + ", " + jsStr(entry.model) + ", " + entry.dimension + ", '" + vecStr + "', " + jsStr(metadataJson) + ", " + jsStr(entry.content_hash) + "]",
      "  );",
      "  return JSON.stringify({ success: true, id: r.rows[0].id, api: 'legacy_pg_client' });",
      "})()",
    ].join("");
  }

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
  const status = checkYoloStatus(vault);
  if (!status.available) {
    return { success: false, error: status.error };
  }

  let code;
  if (status.api === "vector_store") {
    code = [
      "(async () => {",
      "  const yolo = app.plugins.plugins['yolo'];",
      "  const db = yolo.dbManager;",
      "  const vm = db.getVectorManager();",
      "  const store = (db.session && db.session.vectorStore) || vm.repository;",
      "  const stats = await vm.getEmbeddingStats();",
      "  const rows = [];",
      "  for (const stat of stats) {",
      "    const chunks = await store.listChunksForPaths(stat.model, [" + jsStr(pagePath) + "]);",
      "    rows.push(...chunks.map(row => ({ ...row, model: stat.model, dimension: null, content: null, embedding_preview: null })));",
      "  }",
      "  rows.sort((a, b) => a.id - b.id);",
      "  return JSON.stringify({ success: true, rows, api: 'vector_store' });",
      "})()",
    ].join("");
  } else {
    code = [
      "(async () => {",
      "  const pg = app.plugins.plugins['yolo'].dbManager.pgClient;",
      "  const r = await pg.query(",
      "    'SELECT id, path, mtime, content, model, dimension, metadata, content_hash, substring(embedding::text, 1, 50) as embedding_preview FROM embeddings WHERE path = $1 ORDER BY id',",
      "    [" + jsStr(pagePath) + "]",
      "  );",
      "  return JSON.stringify({ success: true, rows: r.rows, api: 'legacy_pg_client' });",
      "})()",
    ].join("");
  }

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}

/**
 * Delete embedding records by path.
 * @param {string} pagePath - Relative path
 * @param {string} [vault] - Vault name
 * @returns {{ success: boolean, deleted?: number, error?: string }}
 */
function deleteEmbedding(pagePath, vault) {
  const status = checkYoloStatus(vault);
  if (!status.available) {
    return { success: false, error: status.error };
  }
  if (status.indexing) {
    return { success: false, error: "YOLO indexing in progress, retry later" };
  }

  let code;
  if (status.api === "vector_store") {
    code = [
      "(async () => {",
      "  const yolo = app.plugins.plugins['yolo'];",
      "  const db = yolo.dbManager;",
      "  const vm = db.getVectorManager();",
      "  const store = (db.session && db.session.vectorStore) || vm.repository;",
      "  if (yolo.ragIndexService && typeof yolo.ragIndexService.isRunning === 'function' && yolo.ragIndexService.isRunning()) throw new Error('YOLO indexing in progress, retry later');",
      "  const stats = await vm.getEmbeddingStats();",
      "  const rows = [];",
      "  for (const stat of stats) {",
      "    rows.push(...await store.listChunksForPaths(stat.model, [" + jsStr(pagePath) + "]));",
      "  }",
      "  const ids = [...new Set(rows.map(row => row.id))];",
      "  if (ids.length) await store.deleteVectorsByIds(ids);",
      "  await db.save();",
      "  return JSON.stringify({ success: true, deleted: ids.length, api: 'vector_store' });",
      "})()",
    ].join("");
  } else {
    code = [
      "(async () => {",
      "  const pg = app.plugins.plugins['yolo'].dbManager.pgClient;",
      "  const r = await pg.query(",
      "    'DELETE FROM embeddings WHERE path = $1',",
      "    [" + jsStr(pagePath) + "]",
      "  );",
      "  return JSON.stringify({ success: true, deleted: r.affectedRows || 0, api: 'legacy_pg_client' });",
      "})()",
    ].join("");
  }

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}

/**
 * Update embedding for a page (delete old + insert new).
 * @param {string} pagePath - Relative path
 * @param {object} entry - New embedding data (same as createEmbedding)
 * @param {string} [vault] - Vault name
 * @returns {{ success: boolean, id?: number, deleted?: number, error?: string }}
 */
function updateEmbedding(pagePath, entry, vault) {
  try {
    assertValidEmbeddingEntry(entry);
  } catch (e) {
    return { success: false, error: e.message };
  }
  const status = checkYoloStatus(vault);
  if (!status.available) {
    return { success: false, error: status.error };
  }
  if (status.indexing) {
    return { success: false, error: "YOLO indexing in progress, retry later" };
  }

  const metadata = {
    ...entry.metadata,
    source: "mcp",
    updatedAt: new Date().toISOString(),
    startLine: Number.isInteger(entry.metadata && entry.metadata.startLine)
      ? entry.metadata.startLine
      : 1,
    endLine: Number.isInteger(entry.metadata && entry.metadata.endLine)
      ? entry.metadata.endLine
      : entry.content.split("\n").length,
  };
  const metadataJson = JSON.stringify(metadata);

  const vecStr = JSON.stringify(entry.embedding);

  let code;
  if (status.api === "vector_store") {
    code = [
      "(async () => {",
      "  const yolo = app.plugins.plugins['yolo'];",
      "  const db = yolo.dbManager;",
      "  const vm = db.getVectorManager();",
      "  const store = (db.session && db.session.vectorStore) || vm.repository;",
      "  const rag = await yolo.ragCoordinator.getRagEngine();",
      "  const model = rag && rag.embeddingModel;",
      "  if (!model) throw new Error('YOLO embedding model is not configured');",
      "  if (yolo.ragIndexService && typeof yolo.ragIndexService.isRunning === 'function' && yolo.ragIndexService.isRunning()) throw new Error('YOLO indexing in progress, retry later');",
      "  const embedding = " + vecStr + ";",
      "  if (embedding.length !== model.dimension) throw new Error('Embedding dimension does not match YOLO active model');",
      "  const stats = await vm.getEmbeddingStats();",
      "  const oldRows = [];",
      "  for (const stat of stats) {",
      "    oldRows.push(...await store.listChunksForPaths(stat.model, [" + jsStr(pagePath) + "]));",
      "  }",
      "  const oldIds = [...new Set(oldRows.map(row => row.id))];",
      "  await store.insertVectors([{",
      "    path: " + jsStr(entry.path) + ",",
      "    mtime: " + entry.mtime + ",",
      "    content: " + jsStr(entry.content) + ",",
      "    content_hash: " + jsStr(entry.content_hash) + ",",
      "    model: model.id,",
      "    dimension: model.dimension,",
      "    embedding,",
      "    metadata: " + metadataJson,
      "  }]);",
      "  const after = await store.listChunksForPaths(model.id, [" + jsStr(entry.path) + "]);",
      "  const oldIdSet = new Set(oldIds);",
      "  const inserted = after.filter(row => !oldIdSet.has(row.id)).sort((a, b) => b.id - a.id)[0];",
      "  if (!inserted) throw new Error('YOLO vector store did not return the inserted record');",
      "  try {",
      "    if (oldIds.length) await store.deleteVectorsByIds(oldIds);",
      "    await db.save();",
      "  } catch (e) {",
      "    try { await store.deleteVectorsByIds([inserted.id]); await db.save(); } catch (_) { void 0; }",
      "    throw e;",
      "  }",
      "  return JSON.stringify({ success: true, id: inserted.id, deleted: oldIds.length, api: 'vector_store' });",
      "})()",
    ].join("");
  } else {
    code = [
      "(async () => {",
      "  const pg = app.plugins.plugins['yolo'].dbManager.pgClient;",
      "  const del = await pg.query('DELETE FROM embeddings WHERE path = $1', [" + jsStr(pagePath) + "]);",
      "  const ins = await pg.query(",
      "    'INSERT INTO embeddings (path, mtime, content, model, dimension, embedding, metadata, content_hash) VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8) RETURNING id',",
      "    [" + jsStr(entry.path) + ", " + entry.mtime + ", " + jsStr(entry.content) + ", " + jsStr(entry.model) + ", " + entry.dimension + ", '" + vecStr + "', " + jsStr(metadataJson) + ", " + jsStr(entry.content_hash) + "]",
      "  );",
      "  return JSON.stringify({ success: true, id: ins.rows[0].id, deleted: del.affectedRows || 0, api: 'legacy_pg_client' });",
      "})()",
    ].join("");
  }

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}

/**
 * Query PGlite status and statistics.
 * @param {string} [vault] - Vault name
 * @returns {{ available: boolean, vault?: string, source?: string, total_embeddings?: number, model?: string, dimension?: number, yolo_indexing?: boolean, error?: string }}
 */
function queryPgliteStatus(vault) {
  const targetVault = vault || vaultName();

  const status = checkYoloStatus(vault);
  if (!status.available) {
    return { available: false, vault: targetVault, error: status.error };
  }

  let code;
  if (status.api === "vector_store") {
    code = [
      "(async () => {",
      "  const yolo = app.plugins.plugins['yolo'];",
      "  const vm = yolo.dbManager.getVectorManager();",
      "  const stats = await vm.getEmbeddingStats();",
      "  let model = null;",
      "  try {",
      "    const rag = await yolo.ragCoordinator.getRagEngine();",
      "    model = rag && rag.embeddingModel ? rag.embeddingModel : null;",
      "  } catch (_) { void 0; }",
      "  return JSON.stringify({",
      "    available: true,",
      "    vault: " + jsStr(targetVault) + ",",
      "    source: 'pglite_live',",
      "    api: 'vector_store',",
      "    total_embeddings: stats.reduce((sum, row) => sum + Number(row.rowCount || 0), 0),",
      "    model: model ? model.id : null,",
      "    dimension: model ? model.dimension : null,",
      "    models: stats,",
      "    yolo_indexing: " + status.indexing,
      "  });",
      "})()",
    ].join("");
  } else {
    code = [
      "(async () => {",
      "  const pg = app.plugins.plugins['yolo'].dbManager.pgClient;",
      "  const r = await pg.query('SELECT count(*) as total, model, dimension FROM embeddings GROUP BY model, dimension');",
      "  const row = r.rows[0] || {};",
      "  return JSON.stringify({",
      "    available: true,",
      "    vault: " + jsStr(targetVault) + ",",
      "    source: 'pglite_live',",
      "    api: 'legacy_pg_client',",
      "    total_embeddings: r.rows.reduce((sum, item) => sum + parseInt(item.total || '0'), 0),",
      "    model: row.model || null,",
      "    dimension: row.dimension || null,",
      "    models: r.rows,",
      "    yolo_indexing: " + status.indexing,
      "  });",
      "})()",
    ].join("");
  }

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { available: false, vault: targetVault, error: result.error };
  }
  return result.value;
}

/**
 * Try obsidian eval to query the live YOLO PGlite database.
 * Returns null if Obsidian is not running / YOLO not loaded / query fails.
 *
 * Reuses obsidianEval() rather than duplicating execFileSync + output parsing.
 * Legacy SQL receives the vector and limit as query parameters. Modern YOLO
 * uses its VectorManager search API instead of exposing a raw pgClient.
 */
function tryObsidianEval(queryVec, limit = 20, vault) {
  assertValidVector(queryVec);
  try {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 20;
    const vecJson = JSON.stringify(queryVec);
    // Build JS code that runs inside Obsidian's context
    const code = [
      "(async () => {",
      "  const yolo = app.plugins.plugins['yolo'];",
      "  if (!yolo || !yolo.dbManager) return '[]';",
      "  const vec = " + vecJson + ";",
      "  try {",
      "    const db = yolo.dbManager;",
      "    if (db.pgClient && typeof db.pgClient.query === 'function') {",
      "      const vecStr = '[' + vec.join(',') + ']';",
      "      const r = await db.pgClient.query(",
      "        \"SELECT path, content, metadata, embedding <=> $1::vector AS distance FROM embeddings WHERE path LIKE 'wiki/%' ORDER BY distance LIMIT $2\",",
      "        [vecStr, " + safeLimit + "]",
      "      );",
      "      return JSON.stringify(r.rows.map(row => ({",
      "        path: row.path,",
      "        score: Math.round((1 - row.distance) * 10000) / 10000,",
      "        startLine: row.metadata ? row.metadata.startLine : null,",
      "        endLine: row.metadata ? row.metadata.endLine : null,",
      "        preview: (row.content || '').substring(0, 200)",
      "      })));",
      "    }",
      "    const vm = db.getVectorManager();",
      "    const rag = await yolo.ragCoordinator.getRagEngine();",
      "    if (!rag || !rag.embeddingModel || typeof vm.performSimilaritySearch !== 'function') return '[]';",
      "    const rows = await vm.performSimilaritySearch(vec, rag.embeddingModel, {",
      "      minSimilarity: -1,",
      "      limit: " + safeLimit + ",",
      "      scope: { files: [], folders: ['wiki'] }",
      "    });",
      "    return JSON.stringify(rows.map(row => ({",
      "      path: row.path,",
      "      score: Math.round(Number(row.similarity || 0) * 10000) / 10000,",
      "      startLine: row.metadata ? row.metadata.startLine : null,",
      "      endLine: row.metadata ? row.metadata.endLine : null,",
      "      preview: (row.content || '').substring(0, 200)",
      "    })));",
      "  } catch(e) { return '[]'; }",
      "})()",
    ].join("");

    const result = obsidianEval(code, vault);
    if (!result.success || !result.value) return null;

    // obsidianEval parses the JSON output; the remote code returns either
    // a JSON string of rows or '[]' on internal failure.
    const rows = typeof result.value === "string" ? JSON.parse(result.value) : result.value;
    if (Array.isArray(rows) && rows.length > 0) return { source: "pglite_live", rows };
    return null;
  } catch {
    return null;
  }
}

/**
 * Query PGlite from cached tar.gz extraction.
 */
async function tryCacheQuery(queryVec, limit = 20, vault) {
  assertValidVector(queryVec);
  const cacheDir = getCacheDir(vault);
  if (!fs.existsSync(path.join(cacheDir, "PG_VERSION"))) return null;

  let pg;
  try {
    const { PGlite } = require("@electric-sql/pglite");
    const { vector } = require("@electric-sql/pglite/vector");

    pg = new PGlite({ dataDir: cacheDir, extensions: { vector } });

    // Parameterized query — vecStr and limit go through pg.query params,
    // not string-interpolated into SQL text. assertValidVector above
    // guarantees finite numbers (no injection path), but parameterizing
    // removes the reliance on validation as the sole defense.
    const vecStr = "[" + queryVec.join(",") + "]";

    const sql = [
      "SELECT path, content, metadata,",
      "       embedding <=> $1::vector AS distance",
      "FROM embeddings",
      "WHERE path LIKE 'wiki/%'",
      "ORDER BY distance",
      "LIMIT $2",
    ].join("\n");

    const result = await pg.query(sql, [vecStr, limit]);

    const rows = result.rows.map((r) => ({
      path: r.path,
      score: Math.round((1 - r.distance) * 10000) / 10000,
      startLine: r.metadata ? r.metadata.startLine : null,
      endLine: r.metadata ? r.metadata.endLine : null,
      preview: (r.content || "").substring(0, 200),
    }));

    return rows.length > 0 ? { source: "pglite_cache", rows } : null;
  } catch {
    return null;
  } finally {
    if (pg) {
      try { await pg.close(); } catch { void 0; }
    }
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
  const cache = await tryCacheQuery(queryVec, limit, vault);
  if (cache) return cache;

  // Nothing available
  return { source: "unavailable", rows: [] };
}

/**
 * Embed texts via YOLO plugin's embedding provider (when Obsidian is running).
 * Falls back to returning an empty array if YOLO is unavailable.
 * @param {string[]} texts
 * @param {string} [vault] - Vault name
 * @returns {Promise<number[][]>}
 */
async function embedViaYolo(texts, vault) {
  const code = [
    "(async () => {",
    "  const yolo = app.plugins.plugins['yolo'];",
    "  if (!yolo) return JSON.stringify([]);",
    "  if (yolo.ragCoordinator && typeof yolo.ragCoordinator.getRagEngine === 'function') {",
    "    try {",
    "      const rag = await yolo.ragCoordinator.getRagEngine();",
    "      if (rag && typeof rag.getQueryEmbedding === 'function') {",
    "        const embeddings = await Promise.all(" + JSON.stringify(texts) + ".map(text => rag.getQueryEmbedding(text)));",
    "        return JSON.stringify(embeddings);",
    "      }",
    "    } catch (_) { void 0; }",
    "  }",
    "  let embedFn = null;",
    "  if (yolo.embeddingService && typeof yolo.embeddingService.embed === 'function') {",
    "    embedFn = (t) => yolo.embeddingService.embed(t);",
    "  } else if (yolo.embeddingProvider && typeof yolo.embeddingProvider.embed === 'function') {",
    "    embedFn = (t) => yolo.embeddingProvider.embed(t);",
    "  } else if (typeof yolo.getEmbeddings === 'function') {",
    "    embedFn = (t) => yolo.getEmbeddings(t);",
    "  }",
    "  if (!embedFn) return JSON.stringify({ error: 'no_embed_api', keys: Object.keys(yolo).filter(k => typeof yolo[k] === 'object' && yolo[k] !== null) });",
    "  const embeddings = await embedFn(" + JSON.stringify(texts) + ");",
    "  return JSON.stringify(embeddings);",
    "})()",
  ].join("");

  const result = obsidianEval(code, vault, 60000);
  if (!result.success || !result.value) return [];
  if (result.value.error) return [];
  return result.value;
}

module.exports = { assertValidVector, embedViaYolo, queryWikiChunks, obsidianEval, vaultName, getCacheDir, checkYoloStatus, createEmbedding, readEmbedding, deleteEmbedding, updateEmbedding, queryPgliteStatus };
