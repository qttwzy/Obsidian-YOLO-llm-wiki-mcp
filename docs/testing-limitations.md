# Testing Limitations

This suite separates deterministic file-logic tests from integrations that require a running Obsidian process, the YOLO plugin, and its real PGlite schema.

## Runtime-gated tests

| Function | Location | Why it is gated |
|----------|----------|-----------------|
| `obsidianEval` | `lib/pglite.js` | Requires the Obsidian CLI to reach a running Obsidian instance. |
| `checkYoloStatus` | `lib/pglite.js` | Requires the YOLO plugin to be loaded in that instance. |
| `queryPgliteStatus` | `lib/pglite.js` | Reads YOLO's live PGlite state. |
| `readEmbedding` | `lib/pglite.js` | Reads records through either the legacy SQL adapter or modern vector-store adapter. The modern API does not expose content or an embedding preview, so those fields are `null`. |
| `queryWikiChunks` | `lib/pglite.js` | Runs a live similarity query against YOLO's active vector store. |
| `embedViaYolo` | `lib/pglite.js` | Requires a YOLO version with a compatible embedding provider. |

The corresponding Node tests call `t.skip()` when this runtime is unavailable, so a skipped test is visible in test output rather than counted as a passing integration check. A default `npm test` started from the repository usually does not name a live vault and may therefore skip these checks.

## Operations needing a disposable vault

| Function | Location | Why it is not part of the default test run |
|----------|----------|---------------------------------------------|
| `createEmbedding` | `lib/pglite.js` | Inserts records into YOLO's PGlite database. The YOLO 1.6.5 vector-store branch has not yet been exercised destructively. |
| `updateEmbedding` | `lib/pglite.js` | Replaces records in YOLO's PGlite database. The YOLO 1.6.5 vector-store branch has not yet been exercised destructively. |
| `deleteEmbedding` | `lib/pglite.js` | Deletes records from YOLO's PGlite database. The YOLO 1.6.5 vector-store branch has not yet been exercised destructively. |
| `buildStore` / `updateEntry` | `lib/page-store.js` | Require YOLO embeddings and mutate a vault's page-store cache. |

Run these against a disposable vault, never a user's production vault.

## Still missing fixture coverage

| Area | Missing coverage |
|------|------------------|
| Modern write adapter | `createEmbedding`, `updateEmbedding`, and `deleteEmbedding` against a disposable YOLO 1.6.5 vault. |
| Cache adapter | `tryCacheQuery` against a cache produced by the current YOLO version. |
| End-to-end workflow | Ingestion, embedding, graph update, and search in one disposable vault. |

## Persistence and concurrency

Whole-file state writes use atomic replacement to prevent readers from observing a partially truncated JSON or Markdown file. `ingest_source` also restores its page, index, and log if a later local step fails. Neither mechanism provides a durable crash-recovery journal, a cross-process read-modify-write transaction, or a writer lock: abrupt process termination and concurrent MCP processes can still leave conflicting logical updates.

## Recommended integration check

Start Obsidian with YOLO enabled and run the read-only regression against the intended vault:

```bash
VAULT_ROOT="/absolute/path/to/vault" \
OBSIDIAN_CLI_PATH="/usr/local/bin/obsidian" \
YOLO_LIVE_TEST_VAULT="VaultName" \
node --test tests/test-pglite.test.js
```

The suite does not set `YOLO_LIVE_EMBED_TEST=1` by default, so it does not make a potentially remote embedding-provider request. Enable that flag only when such a request is intended. Exercise PGlite write tools only in a disposable vault.
