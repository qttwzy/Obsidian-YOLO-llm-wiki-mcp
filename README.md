# llm-wiki-mcp

MCP server for managing an [LLM-Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) knowledge base — search, lint semantic connections, and manage decision workflows.

## Features

| Tool | Description |
|------|-------------|
| `search_wiki` | Three-channel parallel search (grep, page embeddings, PGlite chunks) |
| `lint_connections` | Find semantically similar pages that aren't linked yet |
| `mark_skipped_connection` | Mark false-positive lint results to ignore them |
| `build_page_store` | Build/rebuild the page embedding index |
| `update_page_store` | Update a single page's embedding after editing |
| `list_decisions` | List pending and resolved decisions |
| `create_decision` | Create a decision entry with selectable options |
| `resolve_decision` | Resolve a decision by selecting an option |
| `correct_decision` | Add a correction to a previously resolved decision |

## Install

```bash
npm install
```

## Configure

Set environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_ROOT` | No | Absolute path to your Obsidian vault. Defaults to `../../` relative to the package. |
| `EMBED_API_URL` | Yes | Embedding API endpoint (OpenAI-compatible) |
| `EMBED_API_KEY` | Yes | Embedding API key |
| `EMBED_MODEL` | No | Embedding model name. Default: `Qwen/Qwen3-Embedding-8B` |

### Claude Code / Cursor / Windsurf

Add to your MCP config (e.g. `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["/path/to/llm-wiki-mcp/server.js"],
      "env": {
        "VAULT_ROOT": "/path/to/your/obsidian/vault",
        "EMBED_API_URL": "https://api.example.com/v1",
        "EMBED_API_KEY": "sk-xxx",
        "EMBED_MODEL": "Qwen/Qwen3-Embedding-8B"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["/path/to/llm-wiki-mcp/server.js"],
      "env": {
        "VAULT_ROOT": "/path/to/your/obsidian/vault",
        "EMBED_API_URL": "https://api.example.com/v1",
        "EMBED_API_KEY": "sk-xxx"
      }
    }
  }
}
```

## Vault Structure

This server expects a vault organized as:

```
your-vault/
├── wiki/                    # Wiki pages (entities/, concepts/, synthesis/)
│   ├── decisions.md         # Decision log (managed by decisions tools)
│   ├── log.md               # Operation log
│   └── ...
├── index.md                 # Content index
└── .source-tracker/         # Auto-generated cache (page embeddings, lint state)
```

Page frontmatter should include `type`, `status`, `claim_type`, `sources`, etc. See `schema/llm-wiki-schema.md` for the full specification.

## Architecture

```
server.js
├── tools/
│   ├── search.js      # Three-channel search (grep + embeddings + PGlite)
│   ├── lint.js        # Semantic connection linting
│   ├── store.js       # Page embedding store management
│   └── decisions.js   # Decision log CRUD
└── lib/
    ├── config.js      # VAULT_ROOT resolution
    ├── embed.js       # Embedding API client + cosine similarity
    ├── page-store.js  # Page embedding store read/write/search
    └── pglite.js      # YOLO PGlite integration (live + cache fallback)
```

### Search Channels

1. **Grep** — `grep -rlE` on `wiki/*.md` for keyword matches (zero cost)
2. **Page embeddings** — cosine similarity on `.source-tracker/page_embeddings.json`
3. **PGlite chunks** — queries YOLO's PGlite vector database (live via `obsidian eval` or cached tar.gz)

Results are merged, deduplicated, and ranked by score.

### Decision Workflow

When the LLM encounters conflicting or uncertain information during ingestion or linting, it creates a decision entry with selectable options instead of making the call itself:

1. `create_decision` — writes a checkbox-style entry to `wiki/decisions.md`
2. User picks an option in Obsidian (`[ ]` → `[x]`) or via conversation
3. `resolve_decision` — moves the entry from pending to resolved
4. `correct_decision` — adds a correction block if the user changes their mind

## License

MIT
