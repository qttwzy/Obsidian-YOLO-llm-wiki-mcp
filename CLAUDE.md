# CLAUDE.md

This file provides guidance to Claude Code when working in this project.

## What is this

An MCP (Model Context Protocol) server for managing an LLM-Wiki knowledge base. It provides search, semantic linting, and decision workflow tools for Obsidian vaults organized in the Karpathy LLM-Wiki pattern.

This is a Node.js project — no TypeScript, no build step. Tests use Node.js built-in `node:test`.

## Architecture

```
server.js              # MCP server entry point (stdio transport)
├── lib/
│   ├── config.js      # Vault discovery, resolution, and path validation
│   ├── embed.js       # OpenAI-compatible embedding API client + cosine similarity
│   ├── graph.js       # Wiki graph construction + persistence (load/save)
│   ├── page-store.js  # Page embedding store (read/write/search .source-tracker/page_embeddings.json)
│   ├── pglite.js      # YOLO PGlite integration (live via obsidian eval, fallback to cached tar.gz)
│   ├── relevance.js   # 4-signal edge weight calculation
│   └── resolver.js    # Wikilink resolution (resolveLink, getResolvedOutLinks)
└── tools/
    ├── search.js      # Three-channel search (grep + page embeddings + PGlite chunks)
    ├── lint.js        # Dual-engine lint (vector similarity + graph topology)
    ├── store.js       # Page embedding store build/update handlers
    ├── decisions.js   # Decision log CRUD (create/resolve/correct)
    ├── graph.js       # Wiki graph build/update handlers
    ├── yolo-crud.js   # YOLO PGlite CRUD operations (update/delete/status)
    ├── init-wiki.js   # LLM-Wiki skeleton initialization
    ├── discover.js    # Inbox configuration + source discovery
    └── ingest.js      # Source ingestion (page + index + log + archive)
```

## Key Design Decisions

- **`VAULT_ROOT` resolution** via `lib/config.js`:
  1. `VAULT_ROOT` env var (absolute path)
  2. `findNearestVault(process.cwd())` — walks up from cwd to find `.obsidian/`
  3. Fallback: two levels up from `lib/config.js` (legacy)
- **Multi-vault routing**: all tools accept optional `vault` parameter. Resolved via `resolveVaultRoot()` — supports vault name, absolute path, or default.
- **`server.js` is the only entry point.** It registers all tools and handles MCP stdio transport.
- **Tools are stateless.** Each tool call reads from disk (decisions.md, page_embeddings.json, wiki_graph.json) and writes back. No in-memory state between calls.
- **`lib/pglite.js`** has two strategies: live query via `obsidian eval` CLI (requires Obsidian running with YOLO plugin), or cached PGlite database. Both are best-effort and gracefully return empty on failure.
- **`lib/embed.js`** talks to any OpenAI-compatible `/v1/embeddings` endpoint. No dependency on OpenAI SDK — uses raw `http`/`https` modules.

## Conventions

- CommonJS (`require`/`module.exports`), not ESM
- `"use strict"` at top of every file
- No external dependencies beyond the MCP SDK and PGlite (ESLint is dev-only)
- Error handling: tools return `{ error: "message" }` objects, never throw to the caller
- Path separators: always normalize to `/` with `.replace(/\\/g, "/")` for cross-platform consistency
- Security: use `execFileSync` with argument arrays, never `execSync` with shell strings
- Path validation: use `assertInsideVault(filePath, vaultRoot)` to prevent directory traversal
- Shared helpers in `lib/config.js`: `getWikiDir()`, `resolveVaultRoot()`, `assertInsideVault()`

## Adding a New Tool

1. Create `tools/your-tool.js` with the implementation
2. In `server.js`: add `require`, add tool definition to `ListToolsRequestSchema`, add case to `CallToolRequestSchema` switch
3. Keep the tool function pure (read → transform → write) — no global mutation

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `VAULT_ROOT` | No | `findNearestVault(process.cwd())` |

> Embedding is handled by the YOLO plugin via `obsidian eval` — no external API keys needed.

## Multi-Vault Support

All tools accept an optional `vault` parameter:
- When omitted, uses default `VAULT_ROOT` (bound to agent's cwd)
- Use `vault="VaultName"` to target a specific vault (scanned from parent directory)
- Use `vault="/absolute/path"` to target by absolute path
- Vault discovery: scans parent of `VAULT_ROOT` for directories containing `.obsidian/`
- All responses include `_vault` field indicating which vault was operated on

Vault resolution functions in `lib/config.js`:
- `resolveVaultRoot(vault)` — returns absolute path
- `resolveVaultInfo(vault)` — returns `{ vaultRoot, vaultName }`
- `assertInsideVault(filePath, vaultRoot)` — validates path stays within vault

## YOLO PGlite CRUD Operations

The MCP server provides full CRUD operations for YOLO's PGlite embeddings database:

| Tool | Description | Parameters |
|------|-------------|------------|
| `update_pglite_embedding` | Create/update embedding | `path`, `content`, `vault?` |
| `delete_pglite_embedding` | Delete embedding | `path`, `vault?` |
| `query_pglite_status` | Query PGlite status | `vault?` |

Safety mechanisms:
- Checks YOLO indexing status before write operations
- Tags metadata with `source: "mcp"` for audit trail

## LLM-Wiki Workflow Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `init_wiki` | Initialize vault skeleton | `vault?` |
| `set_inbox_folders` | Configure inbox directories | `action`, `paths?`, `vault?` |
| `discover_sources` | Scan inbox for new files | `vault?` |
| `ingest_source` | Ingest source into wiki | `sourceFile`, `inbox`, `type`, `title`, `content`, `summary`, `vault?` |

Complete LLM-Wiki workflow: Init → Set Inbox → Discover → Ingest → Query → Lint
