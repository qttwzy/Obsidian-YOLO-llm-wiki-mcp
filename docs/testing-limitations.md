# Testing Limitations

Functions that cannot be covered by unit tests and the reasons why.

## Network-dependent

| Function | Location | Reason |
|----------|----------|--------|
| `embedTexts` | `lib/embed.js` | Requires external Embedding API (HTTP). Unit tests should not depend on network. |

## Conditionally testable (Obsidian running)

| Function | Location | Reason |
|----------|----------|--------|
| `obsidianEval` | `lib/pglite.js` | Tested when Obsidian is running with YOLO plugin. Skipped otherwise. |
| `checkYoloStatus` | `lib/pglite.js` | Same — skipped when Obsidian unavailable. |
| `queryPgliteStatus` | `lib/pglite.js` | Same. |
| `readEmbedding` | `lib/pglite.js` | Same. |
| `embedViaYolo` | `lib/pglite.js` | Same. |

## Obsidian runtime-dependent (untestable)

| Function | Location | Reason |
|----------|----------|--------|
| `tryObsidianEval` | `lib/pglite.js` | Internal function, depends on Obsidian eval CLI output parsing. |
| `chunkSearch` | `tools/search.js` | Calls queryWikiChunks → tryObsidianEval. |

## PGlite write operations (side-effect concern)

| Function | Location | Reason |
|----------|----------|--------|
| `createEmbedding` | `lib/pglite.js` | INSERT into production PGlite database. Test data mixes with real data. |
| `updateEmbedding` | `lib/pglite.js` | DELETE + INSERT into production PGlite database. |
| `deleteEmbedding` | `lib/pglite.js` | DELETE from production PGlite database. |

## Cost-prohibitive

| Function | Location | Reason |
|----------|----------|--------|
| `buildStore` | `lib/page-store.js` | Embedding 100+ pages via external API — too slow and burns API quota. |
| `updateEntry` | `lib/page-store.js` | Same reason — requires embedding API call. |

## Destructive to production data

| Function | Location | Reason |
|----------|----------|--------|
| `handleUpdateGraph(semanticChange=true)` | `tools/graph.js` | Deletes edges, rewrites `wiki_graph.json`. Non-reversible. |

## Cache-dependent

| Function | Location | Reason |
|----------|----------|--------|
| `tryCacheQuery` | `lib/pglite.js` | Requires `.source-tracker/yolo_db_cache/` directory populated. May not exist. |

## Pipeline functions (require pre-built data)

| Function | Location | Reason |
|----------|----------|--------|
| `lintFull` | `tools/lint.js` | Requires both `wiki_graph.json` and `page_embeddings.json` pre-built. |
| `graphLint` | `tools/lint.js` | Requires loaded graph with edges. |
| `structuralInsights` | `tools/lint.js` | Requires graph with nodes and type information. |

## Notes

- Functions listed above are tested via **integration testing** — run the MCP server in a real Claude Code session with a connected vault.
- The ~75% unit test coverage is the practical ceiling for this project given its architecture.
- When a test-safe embedding API mock becomes feasible (e.g., local Ollama), `buildStore` and `updateEntry` tests can be added.
