# Changelog

## Unreleased

### Fixes

- Make `create_decision` bootstrap the decisions.md skeleton (pending header or full init-wiki template) when the file is missing, empty, or headerless, instead of writing a malformed file that permanently breaks every decisions tool.
- Make `resolve_decision` and `finalize_correction` return an error and leave the file byte-identical when the option letter or custom-text replacement does not match, instead of silently moving an unresolved block into the resolved section; option values are now validated as a single letter A-Z, closing the RegExp-injection face.
- Fix `updateIndex` to append new rows after the last table row inside each section (the fallback path inserted rows above the table header once the placeholder was consumed) and to increment the "— N 页" page counts.

### Known issues

- `customText` is passed as the string replacement argument to `String.replace`, so `$&`-style replacement patterns in the text alter the written line; escape `$` as `$$` or switch to a function replacement before relying on literal `$` in custom decisions.
- `DECISIONS_SKELETON` is duplicated in `tools/decisions.js` and `tools/init-wiki.js` (currently byte-identical, kept in sync by comment only); export it from one module to prevent drift.

- Isolate the PGlite fallback cache by vault so a live-query failure for one vault cannot read another vault's cache.
- Support `OBSIDIAN_CLI_PATH` for GUI-hosted MCP clients whose PATH does not include the Obsidian CLI.
- Support both legacy `dbManager.pgClient` and YOLO 1.6.5's private `VectorManager`/vector-store runtime, and report plugin, database initialization, and unsupported-API failures accurately.
- Add read-only live regression coverage for YOLO status, statistics, record lookup, and vector-store similarity search. Modern PGlite writes remain gated to a disposable vault.
- Use a private temporary directory and JSON-safe path quoting for `obsidian eval`, avoiding a shared payload filename and Windows backslash/quoting failures.
- Use atomic replacement for whole-file JSON and Markdown state writes.
- Roll back `ingest_source` page, index, and log changes if a later local step fails.
- Restrict `ingest_source` to regular files inside the declared inbox, reject lexical and symlink path escapes, normalize Windows-style source and inbox separators, and remove partial cross-device archive copies after a failed move.
- Report unavailable Obsidian/YOLO runtime tests as skipped instead of silently passing them.
- Align README and troubleshooting guidance with the current tools, cache behavior, runtime prerequisites, and YOLO Modules capability boundary.

## 3.1.0 (2026-08-06)

### Bug Fixes (P0 — data integrity)

- **`create_decision` ID collision** — Auto-generated IDs now use `max(numeric id across pending+resolved) + 1` instead of `pending.length + 1`. The old logic collided after a resolve shrank the pending list (e.g. resolve DEC-001 → new decision reused DEC-002). Auto-generated IDs are also de-duplicated against both sections.
- **`correct_decision` duplicate blocks** — Inserting a "🔄 修正中" block previously left the old resolved block in place, creating two `### DEC-XXX` headers in the resolved section. The old block is now marked "⚠️ 已废止" (superseded) instead, preserving the audit trail. `list_decisions` excludes superseded blocks from `resolvedCount`.
- **`finalize_correction` (new tool)** — Closes the correction loop opened by `correct_decision`. Converts a "🔄 修正中" block back to resolved ("✅") with a chosen option or custom text. Previously there was no tool to complete a correction, breaking the "LLM fully maintains decisions" design.
- **`decisions.md` parsing** — A non-empty file with no matching section header now throws instead of silently returning empty arrays (silent data loss). Empty files still return zeros.
- **`resolve_decision` block removal** — Replaced `raw.replace(dec.raw, "")` with block-boundary removal to avoid CRLF/substring-collision misdeletes.
- **`ingest_source` EXDEV** — `archiveSource` now falls back to copy+unlink when `renameSync` throws `EXDEV` (cross-device), the most common real-world Step-4 failure in Docker/symlinked deployments.
- **`ingest_source` slug** — Pure-whitespace or all-separator titles now fall back to `untitled-{timestamp}` instead of producing meaningless filenames.
- **`ingest_source` atomicity claim** — Dropped the misleading "Atomic" label from docs and tool description; the operation is best-effort sequential with no rollback.

### Hardening (P1)

- **SQL parameterization** — `tryCacheQuery` now uses `$1::vector` + `$2` placeholders instead of interpolating the vector and limit into SQL text. No exploitable path existed (`assertValidVector` + non-user vectors), but this removes reliance on validation as the sole guard.
- **`tryObsidianEval` dedup** — Reuses `obsidianEval()` instead of duplicating `execFileSync` + output parsing, keeping temp-file cleanup and error handling consistent.
- **`vecStr` safety** — `createEmbedding`/`updateEmbedding` build the vector string with `JSON.stringify` instead of `join(",")`, eliminating a JS-literal escape risk.
- **`resolveVaultRoot`** — Throws on an unknown vault name instead of silently falling back to `VAULT_ROOT`. Prevents cross-vault writes from a typo in multi-vault setups. Caught by `safeHandler`.
- **Version alignment** — `package.json` and `server.js` bumped from 2.0.0 to 3.1.0 to match the CHANGELOG (was stuck at 2.0.0 while CHANGELOG showed 3.0.0).

### Performance (P2)

- **`update_wiki_graph` edge lookup** — Uses a `Set` index instead of `graph.edges.some()` (O(edges) → O(1)) per candidate.
- **`structuralInsights`** — Resolves outLinks via `getResolvedOutLinks` instead of a linear title scan over all nodes (O(n²) → O(n)).

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
