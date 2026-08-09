# Contributing

Thanks for your interest in contributing.

## Getting started

```bash
git clone <repo-url>
cd Obsidian-YOLO-llm-wiki-mcp
npm install
```

## Running tests

```bash
npm test        # lint + unit tests
npm run lint    # ESLint only
node --test     # unit tests only
```

## Project structure

```
server.js           # MCP server entry point
lib/                # Core libraries (stateless)
  config.js         # Vault discovery & path validation
  embed.js          # Cosine similarity helpers
  fs-utils.js       # Atomic whole-file replacement helper
  graph.js          # Wiki graph construction
  page-store.js     # Page embedding store
  pglite.js         # YOLO PGlite integration
  relevance.js      # 4-signal edge weighting
  resolver.js       # Wikilink resolution
tools/              # MCP tool handlers (thin wrappers)
  search.js         # Three-channel search
  lint.js           # Dual-engine lint
  store.js          # Page embedding store management
  decisions.js      # Decision log CRUD
  graph.js          # Wiki graph build/update
  yolo-crud.js      # YOLO PGlite CRUD
  init-wiki.js      # LLM-Wiki skeleton init
  discover.js       # Inbox config + source discovery
  ingest.js         # Source ingestion
tests/              # Node test suite; runtime integrations skip when unavailable
```

## Coding conventions

- `"use strict"` at the top of every file
- CommonJS (`require`/`module.exports`)
- Functions return `{ error: "message" }` instead of throwing
- No external dependencies beyond the MCP SDK and PGlite
- Paths use `/` separator (normalized with `.replace(/\\/g, "/")`)
- Use `execFileSync` with argument arrays, never `execSync` with shell strings

## Pull request checklist

- [ ] Tests pass (`npm test`)
- [ ] No new external dependencies (without discussion)
- [ ] `package.json` version bumped if applicable
- [ ] README updated for user-facing changes
