# YOLO PGlite CRUD Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete CRUD operations for YOLO's PGlite embeddings database via `obsidian eval` CLI, with vault routing and safety mechanisms.

**Architecture:** Enhance existing `lib/pglite.js` with CRUD functions that execute SQL through `obsidian eval vault=<name>`. Add three new MCP tools and vault parameter support to existing tools. Implement safety strategies (coordinated writes, source tagging, YOLO status checks) to prevent conflicts with YOLO's auto-indexing.

**Tech Stack:** Node.js (CommonJS), `child_process.execSync`, `obsidian eval` CLI, PostgreSQL SQL via PGlite

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `lib/pglite.js` | PGlite access layer (read + CRUD) | **Modify** — add CRUD functions, vault support, safety checks |
| `lib/config.js` | VAULT_ROOT resolution | **Read only** — reference for vault name inference |
| `tools/search.js` | Three-channel search | **Modify** — add vault parameter to `searchWiki()` |
| `tools/store.js` | Page embedding store handlers | **Modify** — add vault parameter to handlers |
| `tools/yolo-crud.js` | New CRUD tool handlers | **Create** — handlers for update/delete/status tools |
| `server.js` | MCP server entry point | **Modify** — register new tools, add vault params to existing tools |

---

## Task 1: Add `vaultName()` Helper and `obsidianEval()` Wrapper

**Files:**
- Modify: `lib/pglite.js:1-10`

- [ ] **Step 1: Add vault name inference function**

Add at the top of `lib/pglite.js`, after the existing requires:

```javascript
const path = require("path");

/**
 * Infer vault name from VAULT_ROOT (basename of the vault directory).
 * @returns {string} Vault name (e.g., "AI")
 */
function vaultName() {
  return path.basename(VAULT_ROOT);
}
```

- [ ] **Step 2: Add generic obsidian eval wrapper**

Add after `vaultName()`:

```javascript
/**
 * Execute JavaScript code inside Obsidian via `obsidian eval` CLI.
 * @param {string} code - JavaScript code to execute (must return a value)
 * @param {string} [vault] - Vault name (defaults to vaultName())
 * @param {number} [timeout=15000] - Timeout in ms
 * @returns {{ success: boolean, value?: any, error?: string }}
 */
function obsidianEval(code, vault, timeout = 15000) {
  const targetVault = vault || vaultName();
  const wrappedCode = `(async () => { ${code} })()`;

  try {
    const result = execSync(
      `obsidian eval vault=${jsStr(targetVault)} code=${jsStr(wrappedCode)}`,
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
```

- [ ] **Step 3: Verify the wrapper works**

Run: `node -e "const { obsidianEval } = require('./lib/pglite'); console.log(JSON.stringify(obsidianEval('app.vault.getName()')))"`

Expected: `{"success":true,"value":"AI"}`

- [ ] **Step 4: Export the new functions**

Update `module.exports` at the bottom of `lib/pglite.js`:

```javascript
module.exports = { queryWikiChunks, obsidianEval, vaultName };
```

- [ ] **Step 5: Commit**

```bash
git add lib/pglite.js
git commit -m "feat(pglite): add obsidianEval wrapper and vaultName helper"
```

---

## Task 2: Add YOLO Status Check Function

**Files:**
- Modify: `lib/pglite.js`

- [ ] **Step 1: Add YOLO status query function**

Add after `obsidianEval()`:

```javascript
/**
 * Check if YOLO plugin is available and not currently indexing.
 * @param {string} [vault] - Vault name
 * @returns {{ available: boolean, indexing: boolean, error?: string }}
 */
function checkYoloStatus(vault) {
  const code = `
    const yolo = app.plugins.plugins['yolo'];
    if (!yolo || !yolo.dbManager || !yolo.dbManager.pgClient) {
      return JSON.stringify({ available: false, indexing: false, error: 'YOLO plugin not loaded' });
    }
    const rag = yolo.ragIndexService;
    const isRunning = rag && typeof rag.isRunning === 'function' && rag.isRunning();
    return JSON.stringify({ available: true, indexing: !!isRunning });
  `;

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { available: false, indexing: false, error: result.error };
  }
  return result.value;
}
```

- [ ] **Step 2: Verify status check works**

Run: `node -e "const { checkYoloStatus } = require('./lib/pglite'); console.log(JSON.stringify(checkYoloStatus()))"`

Expected: `{"available":true,"indexing":false}`

- [ ] **Step 3: Export the new function**

Update `module.exports`:

```javascript
module.exports = { queryWikiChunks, obsidianEval, vaultName, checkYoloStatus };
```

- [ ] **Step 4: Commit**

```bash
git add lib/pglite.js
git commit -m "feat(pglite): add checkYoloStatus for safe write operations"
```

---

## Task 3: Add `createEmbedding()` Function

**Files:**
- Modify: `lib/pglite.js`

- [ ] **Step 1: Add createEmbedding function**

Add after `checkYoloStatus()`:

```javascript
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

  const code = `
    const pg = app.plugins.plugins['yolo'].dbManager.pgClient;
    const r = await pg.query(
      "INSERT INTO embeddings (path, mtime, content, model, dimension, embedding, metadata, content_hash) " +
      "VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8) RETURNING id",
      [${jsStr(entry.path)}, ${entry.mtime}, ${jsStr(entry.content)}, ${jsStr(entry.model)}, ${entry.dimension}, '${vecStr}', ${jsStr(metadata)}, ${jsStr(entry.content_hash)}]
    );
    return JSON.stringify({ success: true, id: r.rows[0].id });
  `;

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}
```

- [ ] **Step 2: Test createEmbedding**

Run: `node -e "
const { createEmbedding } = require('./lib/pglite');
const result = createEmbedding({
  path: 'test/crud_test.md',
  mtime: Date.now(),
  content: 'test content for CRUD',
  model: 'Qwen/Qwen3-Embedding-8B',
  dimension: 3,
  embedding: [0.1, 0.2, 0.3],
  content_hash: 'test_hash_123'
});
console.log(JSON.stringify(result));
"`

Expected: `{"success":true,"id":<number>}`

- [ ] **Step 3: Export the new function**

Update `module.exports`:

```javascript
module.exports = { queryWikiChunks, obsidianEval, vaultName, checkYoloStatus, createEmbedding };
```

- [ ] **Step 4: Commit**

```bash
git add lib/pglite.js
git commit -m "feat(pglite): add createEmbedding with safety checks"
```

---

## Task 4: Add `readEmbedding()` Function

**Files:**
- Modify: `lib/pglite.js`

- [ ] **Step 1: Add readEmbedding function**

Add after `createEmbedding()`:

```javascript
/**
 * Read embedding records by path.
 * @param {string} pagePath - Relative path
 * @param {string} [vault] - Vault name
 * @returns {{ success: boolean, rows?: object[], error?: string }}
 */
function readEmbedding(pagePath, vault) {
  const code = `
    const pg = app.plugins.plugins['yolo'].dbManager.pgClient;
    const r = await pg.query(
      "SELECT id, path, mtime, content, model, dimension, metadata, content_hash, " +
      "substring(embedding::text, 1, 50) as embedding_preview " +
      "FROM embeddings WHERE path = $1 ORDER BY id",
      [${jsStr(pagePath)}]
    );
    return JSON.stringify({ success: true, rows: r.rows });
  `;

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}
```

- [ ] **Step 2: Test readEmbedding**

Run: `node -e "
const { readEmbedding } = require('./lib/pglite');
const result = readEmbedding('test/crud_test.md');
console.log(JSON.stringify(result, null, 2));
"`

Expected: `{"success":true,"rows":[{"id":<number>,"path":"test/crud_test.md",...}]}`

- [ ] **Step 3: Export the new function**

Update `module.exports`:

```javascript
module.exports = { queryWikiChunks, obsidianEval, vaultName, checkYoloStatus, createEmbedding, readEmbedding };
```

- [ ] **Step 4: Commit**

```bash
git add lib/pglite.js
git commit -m "feat(pglite): add readEmbedding for path-based queries"
```

---

## Task 5: Add `deleteEmbedding()` Function

**Files:**
- Modify: `lib/pglite.js`

- [ ] **Step 1: Add deleteEmbedding function**

Add after `readEmbedding()`:

```javascript
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

  const code = `
    const pg = app.plugins.plugins['yolo'].dbManager.pgClient;
    const r = await pg.query(
      "DELETE FROM embeddings WHERE path = $1",
      [${jsStr(pagePath)}]
    );
    return JSON.stringify({ success: true, deleted: r.rowCount });
  `;

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}
```

- [ ] **Step 2: Test deleteEmbedding**

Run: `node -e "
const { deleteEmbedding } = require('./lib/pglite');
const result = deleteEmbedding('test/crud_test.md');
console.log(JSON.stringify(result));
"`

Expected: `{"success":true,"deleted":1}`

- [ ] **Step 3: Export the new function**

Update `module.exports`:

```javascript
module.exports = { queryWikiChunks, obsidianEval, vaultName, checkYoloStatus, createEmbedding, readEmbedding, deleteEmbedding };
```

- [ ] **Step 4: Commit**

```bash
git add lib/pglite.js
git commit -m "feat(pglite): add deleteEmbedding with safety checks"
```

---

## Task 6: Add `updateEmbedding()` Function (Delete + Insert)

**Files:**
- Modify: `lib/pglite.js`

- [ ] **Step 1: Add updateEmbedding function**

Add after `deleteEmbedding()`:

```javascript
/**
 * Update embedding for a page (delete old + insert new).
 * @param {string} pagePath - Relative path
 * @param {object} entry - New embedding data (same as createEmbedding)
 * @param {string} [vault] - Vault name
 * @returns {{ success: boolean, id?: number, deleted?: number, error?: string }}
 */
function updateEmbedding(pagePath, entry, vault) {
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

  const code = `
    const pg = app.plugins.plugins['yolo'].dbManager.pgClient;
    const del = await pg.query("DELETE FROM embeddings WHERE path = $1", [${jsStr(pagePath)}]);
    const ins = await pg.query(
      "INSERT INTO embeddings (path, mtime, content, model, dimension, embedding, metadata, content_hash) " +
      "VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8) RETURNING id",
      [${jsStr(entry.path)}, ${entry.mtime}, ${jsStr(entry.content)}, ${jsStr(entry.model)}, ${entry.dimension}, '${vecStr}', ${jsStr(metadata)}, ${jsStr(entry.content_hash)}]
    );
    return JSON.stringify({ success: true, id: ins.rows[0].id, deleted: del.rowCount });
  `;

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return result.value;
}
```

- [ ] **Step 2: Test updateEmbedding**

Run: `node -e "
const { createEmbedding, updateEmbedding, readEmbedding } = require('./lib/pglite');
// Create first
createEmbedding({
  path: 'test/update_test.md', mtime: Date.now(), content: 'original',
  model: 'Qwen/Qwen3-Embedding-8B', dimension: 3,
  embedding: [0.1, 0.2, 0.3], content_hash: 'hash1'
});
// Update
const result = updateEmbedding('test/update_test.md', {
  path: 'test/update_test.md', mtime: Date.now(), content: 'updated',
  model: 'Qwen/Qwen3-Embedding-8B', dimension: 3,
  embedding: [0.4, 0.5, 0.6], content_hash: 'hash2'
});
console.log(JSON.stringify(result));
// Verify
const read = readEmbedding('test/update_test.md');
console.log('Content:', read.rows[0].content);
console.log('Source:', read.rows[0].metadata.source);
"`

Expected: `{"success":true,"id":<number>,"deleted":1}` and `Content: updated`, `Source: mcp`

- [ ] **Step 3: Export the new function**

Update `module.exports`:

```javascript
module.exports = { queryWikiChunks, obsidianEval, vaultName, checkYoloStatus, createEmbedding, readEmbedding, deleteEmbedding, updateEmbedding };
```

- [ ] **Step 4: Commit**

```bash
git add lib/pglite.js
git commit -m "feat(pglite): add updateEmbedding (coordinated delete+insert)"
```

---

## Task 7: Add `queryPgliteStatus()` Function

**Files:**
- Modify: `lib/pglite.js`

- [ ] **Step 1: Add queryPgliteStatus function**

Add after `updateEmbedding()`:

```javascript
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

  const code = `
    const pg = app.plugins.plugins['yolo'].dbManager.pgClient;
    const r = await pg.query(
      "SELECT count(*) as total, model, dimension FROM embeddings GROUP BY model, dimension"
    );
    const row = r.rows[0] || {};
    return JSON.stringify({
      available: true,
      vault: ${jsStr(targetVault)},
      source: 'pglite_live',
      total_embeddings: parseInt(row.total || '0'),
      model: row.model || null,
      dimension: row.dimension || null,
      yolo_indexing: ${status.indexing}
    });
  `;

  const result = obsidianEval(code, vault);
  if (!result.success) {
    return { available: false, vault: targetVault, error: result.error };
  }
  return result.value;
}
```

- [ ] **Step 2: Test queryPgliteStatus**

Run: `node -e "const { queryPgliteStatus } = require('./lib/pglite'); console.log(JSON.stringify(queryPgliteStatus(), null, 2))"`

Expected:
```json
{
  "available": true,
  "vault": "AI",
  "source": "pglite_live",
  "total_embeddings": 1751,
  "model": "Qwen/Qwen3-Embedding-8B",
  "dimension": 4096,
  "yolo_indexing": false
}
```

- [ ] **Step 3: Export the new function**

Update `module.exports`:

```javascript
module.exports = { queryWikiChunks, obsidianEval, vaultName, checkYoloStatus, createEmbedding, readEmbedding, deleteEmbedding, updateEmbedding, queryPgliteStatus };
```

- [ ] **Step 4: Commit**

```bash
git add lib/pglite.js
git commit -m "feat(pglite): add queryPgliteStatus for diagnostics"
```

---

## Task 8: Create `tools/yolo-crud.js` Tool Handlers

**Files:**
- Create: `tools/yolo-crud.js`

- [ ] **Step 1: Create the tool handlers file**

```javascript
"use strict";

const crypto = require("crypto");
const path = require("path");
const { VAULT_ROOT } = require("../lib/config");
const { updateEmbedding, deleteEmbedding, queryPgliteStatus } = require("../lib/pglite");
const { embedTexts } = require("../lib/embed");

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

  // Compute embedding vector using configured API
  let embedding;
  try {
    const vectors = await embedTexts([content]);
    embedding = vectors[0];
  } catch (e) {
    return { error: "Failed to compute embedding: " + e.message };
  }

  const entry = {
    path: filePath,
    mtime: Date.now(),
    content: content,
    model: process.env.EMBED_MODEL || "Qwen/Qwen3-Embedding-8B",
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

module.exports = { handleUpdateEmbedding, handleDeleteEmbedding, handleQueryStatus };
```

- [ ] **Step 2: Test the handlers**

Run: `node -e "const { handleQueryStatus } = require('./tools/yolo-crud'); console.log(JSON.stringify(handleQueryStatus({}), null, 2))"`

Expected: Status object with `available: true`

Note: `handleUpdateEmbedding` requires `EMBED_API_URL` and `EMBED_API_KEY` environment variables to compute embeddings. Test with status handler first, then test update handler if API is configured.

- [ ] **Step 3: Commit**

```bash
git add tools/yolo-crud.js
git commit -m "feat(tools): add yolo-crud handlers for PGlite CRUD operations"
```

---

## Task 9: Register New Tools in `server.js`

**Files:**
- Modify: `server.js:1-15` (imports)
- Modify: `server.js:37-182` (ListToolsRequestSchema)
- Modify: `server.js:184-293` (CallToolRequestSchema switch)

- [ ] **Step 1: Add import for new tool handlers**

Add after existing requires (around line 14):

```javascript
const { handleUpdateEmbedding, handleDeleteEmbedding, handleQueryStatus } = require("./tools/yolo-crud");
```

- [ ] **Step 2: Add new tool definitions to ListToolsRequestSchema**

Add after the `update_page_store` tool definition (around line 180):

```javascript
{
  name: "update_pglite_embedding",
  description: "Create or update an embedding record in YOLO's PGlite database. Use after editing a wiki page.",
  inputSchema: {
    type: "object",
    properties: {
      vault: { type: "string", description: "Vault name (defaults to VAULT_ROOT basename)" },
      path: { type: "string", description: "Page relative path (e.g., 'wiki/entities/Foo.md')" },
      content: { type: "string", description: "Page content to embed" },
      metadata: { type: "object", description: "Additional metadata (optional)" },
    },
    required: ["path", "content"],
  },
},
{
  name: "delete_pglite_embedding",
  description: "Delete embedding records for a page from YOLO's PGlite database.",
  inputSchema: {
    type: "object",
    properties: {
      vault: { type: "string", description: "Vault name (defaults to VAULT_ROOT basename)" },
      path: { type: "string", description: "Page relative path" },
    },
    required: ["path"],
  },
},
{
  name: "query_pglite_status",
  description: "Query YOLO PGlite database status and statistics.",
  inputSchema: {
    type: "object",
    properties: {
      vault: { type: "string", description: "Vault name (defaults to VAULT_ROOT basename)" },
    },
  },
},
```

- [ ] **Step 3: Add switch cases for new tools**

Add after the `update_page_store` case (around line 243):

```javascript
case "update_pglite_embedding": {
  if (!args.path || !args.content) {
    return formatError("update_pglite_embedding requires path and content");
  }
  const result = await handleUpdateEmbedding(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

case "delete_pglite_embedding": {
  if (!args.path) {
    return formatError("delete_pglite_embedding requires path");
  }
  const result = await handleDeleteEmbedding(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

case "query_pglite_status": {
  const result = handleQueryStatus(args);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
```

- [ ] **Step 4: Test server starts without errors**

Run: `timeout 5 node server.js 2>&1 || true`

Expected: No syntax errors (server will timeout waiting for MCP connection, which is normal)

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(server): register update/delete/status PGlite tools"
```

---

## Task 10: Add Vault Parameter to `search_wiki` Tool

**Files:**
- Modify: `tools/search.js`
- Modify: `server.js` (search_wiki tool definition and handler)

- [ ] **Step 1: Update searchWiki to accept vault parameter**

Modify `tools/search.js` line 101:

```javascript
async function searchWiki(query, vault) {
```

Update the `chunkSearch` call (around line 111) to pass vault:

```javascript
const [grepResults, pageResults, chunkResults] = await Promise.all([
  Promise.resolve(grepWiki(query)),
  pageSearch(queryVec),
  chunkSearch(queryVec, vault),  // Pass vault to chunkSearch
]);
```

Update `chunkSearch` function (around line 48):

```javascript
async function chunkSearch(queryVec, vault) {
  const { source, rows } = await queryWikiChunks(queryVec, 20, vault);
  return rows.map((r) => ({ ...r, source }));
}
```

- [ ] **Step 2: Update queryWikiChunks to accept vault parameter**

Modify `lib/pglite.js` `queryWikiChunks` function signature:

```javascript
async function queryWikiChunks(queryVec, limit = 20, vault) {
  // Try live PGlite first
  const live = tryObsidianEval(queryVec, limit, vault);
```

Update `tryObsidianEval` to use vault parameter:

```javascript
function tryObsidianEval(queryVec, limit = 20, vault) {
  try {
    const targetVault = vault || vaultName();
    // ... existing code, but use targetVault in execSync:
    const result = execSync(`obsidian eval vault=${jsStr(targetVault)} code=${jsStr(code)}`, {
```

- [ ] **Step 3: Update server.js search_wiki handler**

Add vault parameter to search_wiki tool definition:

```javascript
{
  name: "search_wiki",
  description: "...",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query in natural language" },
      vault: { type: "string", description: "Vault name (defaults to VAULT_ROOT basename)" },
    },
    required: ["query"],
  },
},
```

Update the handler:

```javascript
case "search_wiki": {
  const query = args.query || "";
  if (!query.trim()) {
    return formatError("search_wiki requires a non-empty query string");
  }
  const result = await searchWiki(query, args.vault);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
```

- [ ] **Step 4: Test search with vault parameter**

Run: `node -e "const { searchWiki } = require('./tools/search'); searchWiki('test', 'AI').then(r => console.log(JSON.stringify(r, null, 2)))"`

Expected: Search results with `sources` array

- [ ] **Step 5: Commit**

```bash
git add tools/search.js lib/pglite.js server.js
git commit -m "feat(search): add vault parameter to search_wiki tool"
```

---

## Task 11: Clean Up Test Data and Verify

**Files:**
- None (cleanup only)

- [ ] **Step 1: Delete test records**

Run: `node -e "const { deleteEmbedding } = require('./lib/pglite'); console.log(JSON.stringify(deleteEmbedding('test/update_test.md')))"`

Expected: `{"success":true,"deleted":1}`

- [ ] **Step 2: Verify no test records remain**

Run: `node -e "const { readEmbedding } = require('./lib/pglite'); console.log(JSON.stringify(readEmbedding('test/update_test.md')))"`

Expected: `{"success":true,"rows":[]}`

- [ ] **Step 3: Run final status check**

Run: `node -e "const { queryPgliteStatus } = require('./lib/pglite'); console.log(JSON.stringify(queryPgliteStatus(), null, 2))"`

Expected: Status with `total_embeddings` matching original count (1751)

- [ ] **Step 4: Commit cleanup (if any changes)**

```bash
git status
# If there are uncommitted changes:
git add -A
git commit -m "chore: clean up test data from PGlite"
```

---

## Task 12: Update Documentation

**Files:**
- Modify: `CLAUDE.md` (project instructions)

- [ ] **Step 1: Add new tools to CLAUDE.md**

Add to the tool table in `CLAUDE.md`:

```markdown
| **update_pglite_embedding** | Create/update embedding in YOLO PGlite | `path`, `content`, `vault?` |
| **delete_pglite_embedding** | Delete embedding from YOLO PGlite | `path`, `vault?` |
| **query_pglite_status** | Query PGlite status and statistics | `vault?` |
```

- [ ] **Step 2: Document vault parameter**

Add a section about vault routing:

```markdown
## Multi-Vault Support

All tools that interact with YOLO PGlite accept an optional `vault` parameter:
- When omitted, uses `VAULT_ROOT` basename (e.g., "AI")
- Use `vault="OtherVault"` to target a specific vault
- Requires Obsidian to be running with the target vault open
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add new PGlite tools and vault parameter documentation"
```

---

## Self-Review Checklist

After implementing all tasks, verify:

- [ ] All CRUD operations work correctly (create, read, update, delete)
- [ ] Safety checks prevent writes during YOLO indexing
- [ ] Vault parameter routes to correct Obsidian vault
- [ ] Error handling returns `{ error: "message" }` format
- [ ] All new functions are exported from `lib/pglite.js`
- [ ] All new tools are registered in `server.js`
- [ ] Existing tools still work without vault parameter
- [ ] No hardcoded vault names (all derived from VAULT_ROOT or parameter)
- [ ] Test data is cleaned up
- [ ] Documentation is updated

---

## Execution Notes

**Manual Testing Strategy:**
This project has no test framework. All verification uses:
1. `node -e` commands for function-level testing
2. `obsidian eval` for verifying live database state
3. Manual integration testing through MCP client

**Key Verification Commands:**
```bash
# Check YOLO status
node -e "const { queryPgliteStatus } = require('./lib/pglite'); console.log(queryPgliteStatus())"

# Test CRUD cycle
node -e "
const { createEmbedding, readEmbedding, updateEmbedding, deleteEmbedding } = require('./lib/pglite');
// ... test each operation
"

# Verify server starts
timeout 5 node server.js 2>&1 || true
```

**Rollback Plan:**
If any task fails, revert to the previous commit:
```bash
git log --oneline -5
git revert HEAD
```
