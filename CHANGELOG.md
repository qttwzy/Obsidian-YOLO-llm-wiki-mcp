# Changelog

## 3.0.0 (2026-05-06)

### New Features

- **LLM-Wiki workflow tools** — Complete lifecycle management
  - `init_wiki` — Initialize vault skeleton with Karpathy design pattern article
  - `set_inbox_folders` — Configure inbox directories (set/add/remove/list)
  - `discover_sources` — Scan inbox for unprocessed files (vs raw/ archive)
  - `ingest_source` — Atomically create page → update index → append log → archive

- `embedViaYolo` — New embedding path via YOLO plugin when Obsidian is running

### Enhancements

- `grepWiki` — Replaced system `grep` with pure Node.js implementation (cross-platform)
- `update_wiki_graph` — Added `_hint` prompting PGlite embedding refresh after edits
- `obsidianEval` — Fixed CLI argument handling for large payloads (base64 + temp file)
- `readPage` — Fixed frontmatter parsing bug (split limit)
- Removed `HUB_PENALTY_LOG_BASE` dead code from `lib/relevance.js`

### Developer Experience

- **ESLint** — Added flat config (eslint:recommended + custom rules)
- **CI** — GitHub Actions with 3 OS × 3 Node.js versions matrix
- **98 unit tests** across 10 test files covering core pure functions
- Walk dedup — Extracted `walkWikiPages` to `lib/config.js`
- `lib/resolver.js` — Extracted to break circular dependency

### Documentation

- Quick-start troubleshooting guide (4 phases, 35+ issues)
- API examples in README (Chinese + English, 5 groups)
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue/PR templates
- `.env.example` template
- `docs/testing-limitations.md` — Functions that can't be unit tested

### Security

- `assertValidVector()` validation for embedding vectors
- Clean `.gitignore`: excludes dev-only docs, local IDE settings, `.env`, logs

## 2.0.0 (2026-05-03)

### New Features

- **YOLO PGlite CRUD** — Full read/write access to YOLO's PGlite vector database
  - `update_pglite_embedding` / `delete_pglite_embedding` / `query_pglite_status`
- **Multi-vault support** — All tools accept optional `vault` parameter

### Enhancements

- `lib/config.js` — `resolveVaultRoot()`, `resolveVaultInfo()`, `discoverVaults()`, `assertInsideVault()`
- `lib/pglite.js` — `assertValidVector()` validation
- `lib/resolver.js` — Extracted `resolveLink`/`getResolvedOutLinks`

### Security

- Eliminated command injection vulnerabilities in `execFileSync` calls
- Hardened path traversal protection with `assertInsideVault()`

## 1.x (2026-04)

- Initial release with three-channel search (grep + page embeddings + PGlite)
- Dual-engine lint (vector cosine similarity + graph topology)
- Wiki graph with 4-signal relevance model
- Decision workflow CRUD
- Page embedding store with incremental updates
