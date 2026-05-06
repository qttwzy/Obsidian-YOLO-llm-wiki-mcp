# Changelog

## 2.0.0 (2026-05-03)

### New Features

- **YOLO PGlite CRUD** — Full read/write access to YOLO's PGlite vector database
  - `update_pglite_embedding` — Create or update embedding records
  - `delete_pglite_embedding` — Delete embedding records by path
  - `query_pglite_status` — Query database statistics and health
  - Safety: checks YOLO indexing status before writes, tags metadata with `source: "mcp"`

- **Multi-vault support** — All tools accept optional `vault` parameter
  - Vault discovery scans parent directory for `.obsidian/` folders
  - Accepts vault name, absolute path, or defaults to `VAULT_ROOT`
  - Responses include `_vault` field for transparency

### Enhancements

- `search_wiki` — Added `vault` parameter for targeted vault searching
- `lib/config.js` — New `resolveVaultRoot()`, `resolveVaultInfo()`, `discoverVaults()`, `assertInsideVault()` helpers
- `lib/pglite.js` — `assertValidVector()` validation for embedding vectors before SQL injection
- `lib/resolver.js` — Extracted `resolveLink`/`getResolvedOutLinks` to break circular dependency

### Security

- Eliminated command injection vulnerabilities in `execFileSync` calls
- Hardened path traversal protection with `assertInsideVault()`
- Vector validation gate added to all PGlite SQL concatenation points

### Documentation

- New SVG architecture diagrams: search-flow, lint-flow, graph-update, pglite-fallback, decision-workflow
- Added API examples section in README (Chinese + English)
- Added PGlite CRUD work log for agent handoff

## 1.x (2026-04)

- Initial release with three-channel search (grep + page embeddings + PGlite)
- Dual-engine lint (vector cosine similarity + graph topology)
- Wiki graph with 4-signal relevance model
- Decision workflow CRUD
- Page embedding store with incremental updates
