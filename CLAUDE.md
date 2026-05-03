# CLAUDE.md

This file provides guidance to Claude Code when working in this project.

## What is this

An MCP (Model Context Protocol) server for managing an LLM-Wiki knowledge base. It provides search, semantic linting, and decision workflow tools for Obsidian vaults organized in the Karpathy LLM-Wiki pattern.

This is a Node.js project — no TypeScript, no build step, no test framework yet.

## Architecture

```
server.js              # MCP server entry point (stdio transport)
├── lib/
│   ├── config.js      # VAULT_ROOT resolution (env var or ../../)
│   ├── embed.js       # OpenAI-compatible embedding API client + cosine similarity
│   ├── page-store.js  # Page embedding store (read/write/search .source-tracker/page_embeddings.json)
│   └── pglite.js      # YOLO PGlite integration (live via obsidian eval, fallback to cached tar.gz)
└── tools/
    ├── search.js      # Three-channel search (grep + page embeddings + PGlite chunks)
    ├── lint.js        # Find semantically similar pages without wikilinks
    ├── store.js       # Page embedding store build/update handlers
    ├── decisions.js   # Decision log CRUD (create/resolve/correct)
    ├── graph.js       # Wiki graph topology tools
    └── yolo-crud.js   # YOLO PGlite CRUD operations (update/delete/status)
```

## Key Design Decisions

- **`VAULT_ROOT` is configurable** via `VAULT_ROOT` env var. Defaults to `../../` (for when mcp/ is inside the vault). All files import from `lib/config.js`.
- **`server.js` is the only entry point.** It registers all tools and handles MCP stdio transport.
- **Tools are stateless.** Each tool call reads from disk (decisions.md, page_embeddings.json) and writes back. No in-memory state between calls.
- **`lib/pglite.js`** has two strategies: live query via `obsidian eval` CLI (requires Obsidian running with YOLO plugin), or cached PGlite database. Both are best-effort and gracefully return empty on failure.
- **`lib/embed.js`** talks to any OpenAI-compatible `/v1/embeddings` endpoint. No dependency on OpenAI SDK — uses raw `http`/`https` modules.

## Conventions

- CommonJS (`require`/`module.exports`), not ESM
- `"use strict"` at top of every file
- No external dependencies beyond `@modelcontextprotocol/sdk` and `@electric-sql/pglite`
- Error handling: tools return `{ error: "message" }` objects, never throw to the caller
- Path separators: always normalize to `/` with `.replace(/\\/g, "/")` for cross-platform consistency

## Adding a New Tool

1. Create `tools/your-tool.js` with the implementation
2. In `server.js`: add `require`, add tool definition to `ListToolsRequestSchema`, add case to `CallToolRequestSchema` switch
3. Keep the tool function pure (read → transform → write) — no global mutation

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `VAULT_ROOT` | No | `path.resolve(__dirname, "..", "..")` |
| `EMBED_API_URL` | Yes | — |
| `EMBED_API_KEY` | Yes | — |
| `EMBED_MODEL` | No | `Qwen/Qwen3-Embedding-8B` |

## Multi-Vault Support

All tools that interact with YOLO PGlite accept an optional `vault` parameter:
- When omitted, uses `VAULT_ROOT` basename (e.g., "AI")
- Use `vault="OtherVault"` to target a specific vault
- Requires Obsidian to be running with the target vault open

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
- Coordinates delete+insert to prevent duplicate records
