# Obsidian-YOLO-llm-wiki-mcp

[中文](#中文) | [English](#english)

---

## 中文

用于管理 [LLM-Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 知识库的 MCP 服务器——提供搜索、语义关联检查和决策工作流管理。

### 项目亮点

#### 1. 三通道融合搜索

同时发起 Grep 关键词匹配、页面向量余弦相似度、YOLO PGlite 分块向量三路查询，结果自动合并去重并按相关性排序。语义通道提供精确的相关性分数，Grep 通道补充零成本的关键词覆盖，两者互补不冲突。

![三通道融合搜索](docs/images/search-flow.svg)

#### 2. 图拓扑分析

基于 4-Signal 相关性模型（直接链接、源文件重叠、共同邻居 Adamic-Adar、类型亲和度）构建知识图谱，使用动态权重因子（热门节点惩罚、稀缺链接奖励、多信号叠加奖励）自动发现真正有价值的连接。纯文件 IO，零 API 成本。

#### 3. 人机协作决策工作流

LLM 遇到矛盾或不确定的信息时，不会自行判断，而是创建结构化的决策条目（带可选项和后果说明）写入 `decisions.md`。用户在 Obsidian 中勾选或通过对话解决，支持事后修正，决策过程完全可追溯。

![人机协作决策工作流](docs/images/decision-workflow.svg)

#### 4. YOLO PGlite 双策略集成

优先通过 `obsidian eval` CLI 实时查询 Obsidian 中 YOLO 插件的 PGlite 向量库；Obsidian 未运行时自动回退到本地缓存的 PGlite 数据库，确保搜索始终可用。

![YOLO PGlite 双策略集成](docs/images/pglite-fallback.svg)

#### 5. 零外部依赖

仅依赖 `@modelcontextprotocol/sdk` 和 `@electric-sql/pglite`，Embedding API 客户端使用 Node.js 原生 `http`/`https` 模块实现，兼容任何 OpenAI 格式的 Embedding 端点。

```
┌─────────────────────────────────────────────────┐
│              Obsidian-YOLO-llm-wiki-mcp          │
├─────────────────────────────────────────────────┤
│  @modelcontextprotocol/sdk   (MCP 协议)         │
│  @electric-sql/pglite        (向量数据库)       │
│  Node.js http/https          (Embedding 客户端) │
│  child_process (grep/obsidian) (系统命令)       │
├─────────────────────────────────────────────────┤
│  外部依赖 = 2    |    原生模块 = 2              │
└─────────────────────────────────────────────────┘
```

#### 6. 增量更新

支持单页面向量增量更新（`update_page_store`），编辑一个页面后无需重建整个索引。

![增量更新](docs/images/incremental-update.svg)

### 功能特性

| 工具 | 说明 |
|------|------|
| `search_wiki` | 三通道并行搜索（grep、页面向量、PGlite 分块） |
| `lint_full` | 双引擎 Lint：向量语义 + 图拓扑分析，输出四类候选对和结构洞见 |
| `build_wiki_graph` | 构建/重建知识图谱（纯文件 IO，零 API 成本） |
| `update_wiki_graph` | 编辑页面后增量更新图数据（先 diff 分析，再确认语义变化） |
| `mark_skipped_connection` | 标记误报的检查结果以忽略 |
| `build_page_store` | 构建/重建页面向量索引 |
| `update_page_store` | 编辑后更新单个页面的向量 |
| `list_decisions` | 列出待处理和已解决的决策 |
| `create_decision` | 创建带可选项的决策条目 |
| `resolve_decision` | 选择选项以解决决策 |
| `correct_decision` | 对已解决的决策添加修正 |

### API 示例

JSON 请求/响应格式。完整 Schema 见各工具的 `inputSchema`。

#### 搜索

```json
// → search_wiki
{ "query": "如何配置 Embedding 模型" }

// ← { "results": [{ "path": "wiki/...", "score": 0.92, "slug": "...", "title": "..." }],
//      "sources": ["page_store", "grep"], "count": 5, "_vault": "AI" }
```

#### 图与检查

```json
// → build_wiki_graph
{}

// → lint_full
{ "top": 10, "minVectorScore": 0.6, "minGraphScore": 1.5 }

// ← { "cross_signal": [...], "semantic_only": [...], "structural_only": [...],
//      "structural_insights": [...], "summary": { "total_candidates": 15, ... } }
```

#### 页面向量

```json
// → build_page_store
{}

// → update_page_store
{ "filePath": "wiki/entities/Claude Code.md" }
```

#### 决策

```json
// → create_decision
{ "situation": "两个来源对 API 端点有不同描述",
  "options": [{ "label": "A", "action": "采用来源1", "consequence": "..." },
              { "label": "B", "action": "采用来源2", "consequence": "..." }] }

// → resolve_decision
{ "id": "DEC-001", "option": "A" }
```

#### YOLO PGlite CRUD

```json
// → query_pglite_status
{}

// → update_pglite_embedding
{ "path": "wiki/entities/Foo.md", "content": "页面完整 Markdown 内容" }
```

### 安装

```bash
npm install
```

> 遇到问题？查看 [快速排查清单](docs/quickstart-troubleshooting.md)。

### 配置

设置环境变量：

| 变量 | 必需 | 说明 |
|------|------|------|
| `VAULT_ROOT` | 否 | Obsidian 知识库的绝对路径，默认为包的 `../../` 相对路径 |
| `EMBED_API_URL` | 是 | Embedding API 端点（兼容 OpenAI 格式） |
| `EMBED_API_KEY` | 是 | Embedding API 密钥 |
| `EMBED_MODEL` | 否 | Embedding 模型名称，默认 `Qwen/Qwen3-Embedding-8B` |

#### Claude Code / Cursor / Windsurf

添加到 MCP 配置文件（如 `.claude/mcp.json`）：

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["/path/to/Obsidian-YOLO-llm-wiki-mcp/server.js"],
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

#### Claude Desktop

添加到 macOS 的 `~/Library/Application Support/Claude/claude_desktop_config.json` 或 Windows 的 `%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["/path/to/Obsidian-YOLO-llm-wiki-mcp/server.js"],
      "env": {
        "VAULT_ROOT": "/path/to/your/obsidian/vault",
        "EMBED_API_URL": "https://api.example.com/v1",
        "EMBED_API_KEY": "sk-xxx"
      }
    }
  }
}
```

### 知识库结构

服务器期望的知识库目录结构：

```
your-vault/
├── wiki/                    # Wiki 页面（实体、概念、综合）
│   ├── decisions.md         # 决策日志（由决策工具管理）
│   ├── log.md               # 操作日志
│   └── ...
├── index.md                 # 内容索引
└── .source-tracker/         # 自动生成的缓存
    ├── page_embeddings.json    # 页面向量索引
    ├── wiki_graph.json         # 知识图谱（节点 + 加权边）
    ├── graph_changelog.json    # 图增量更新日志
    ├── skipped_connections.json # 跳过的 Lint 候选对
    └── last_lint.json          # 最近一次 Lint 时间戳
```

页面 frontmatter 应包含 `type`、`status`、`claim_type`、`sources` 等字段。完整规范见 `schema/llm-wiki-schema.md`。

### 架构

```
server.js
├── tools/
│   ├── search.js      # 三通道搜索
│   ├── lint.js        # 双引擎 Lint（向量 + 图拓扑）
│   ├── graph.js       # 图拓扑工具（全量构建 + 增量更新）
│   ├── store.js       # 页面向量存储管理
│   └── decisions.js   # 决策日志增删改查
└── lib/
    ├── config.js      # VAULT_ROOT 解析
    ├── embed.js       # Embedding API 客户端 + 余弦相似度
    ├── page-store.js  # 页面向量存储读写搜索
    ├── graph.js       # 图构建（wikilinks、sources、4-signal 权重）
    ├── relevance.js   # 动态权重计算（hub 惩罚、稀缺奖励、叠加奖励）
    └── pglite.js      # YOLO PGlite 集成（实时 + 缓存回退）
```

#### 搜索通道

1. **Grep** — 对 `wiki/*.md` 执行 `grep -rlE` 关键词匹配（零成本）
2. **页面向量** — 对 `.source-tracker/page_embeddings.json` 执行余弦相似度计算
3. **PGlite 分块** — 查询 YOLO 的 PGlite 向量数据库（通过 `obsidian eval` 实时查询或使用缓存的 tar.gz）

结果会合并、去重并按分数排序。

#### 决策工作流

当 LLM 在录入或检查过程中遇到矛盾或不确定的信息时，会创建带可选项的决策条目，而不是自行判断：

1. `create_decision` — 向 `wiki/decisions.md` 写入复选框样式的条目
2. 用户在 Obsidian 中选择选项（`[ ]` → `[x]`）或通过对话选择
3. `resolve_decision` — 将条目从待处理移至已解决
4. `correct_decision` — 如果用户改变主意，添加修正块

### 致谢

- [Karpathy's llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — 本项目遵循的 LLM-Wiki 设计模式
- [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) — 同样基于 Karpathy 模式的桌面应用实现（Tauri + React），其 4-Signal 相关性模型和知识图谱设计对本项目有启发

### 许可证

MIT

---

## English

MCP server for managing an [LLM-Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) knowledge base — search, lint semantic connections, and manage decision workflows.

### Highlights

#### 1. Three-Channel Fusion Search

Fires Grep keyword matching, page-vector cosine similarity, and YOLO PGlite chunk-vector queries in parallel. Results are automatically merged, deduplicated, and ranked by relevance. Semantic channels provide precise relevance scores while Grep supplements with zero-cost keyword coverage — complementary, not conflicting.

![Three-Channel Fusion Search](docs/images/search-flow.svg)

#### 2. Graph Topology Analysis

Builds a knowledge graph using a 4-Signal relevance model (direct links, source overlap, common neighbors via Adamic-Adar, type affinity) with dynamic weighting factors (hub penalty, rarity bonus, reinforcement bonus) to automatically discover truly meaningful connections. Pure file IO, zero API cost.

#### 3. Human-in-the-Loop Decision Workflow

When the LLM encounters conflicting or uncertain information, it doesn't guess — it creates structured decision entries (with selectable options and consequence descriptions) in `decisions.md`. Users resolve them by checking boxes in Obsidian or via conversation. Supports post-hoc corrections, making the entire decision trail fully traceable.

![Human-in-the-Loop Decision Workflow](docs/images/decision-workflow.svg)

#### 4. YOLO PGlite Dual-Strategy Integration

Primarily queries YOLO's PGlite vector database in real-time via the `obsidian eval` CLI when Obsidian is running; automatically falls back to a local cached PGlite database when Obsidian is unavailable, ensuring search always works.

![YOLO PGlite Dual-Strategy Integration](docs/images/pglite-fallback.svg)

#### 5. Zero External Dependencies

Only depends on `@modelcontextprotocol/sdk` and `@electric-sql/pglite`. The Embedding API client is built with Node.js native `http`/`https` modules, compatible with any OpenAI-format embedding endpoint.

```
┌─────────────────────────────────────────────────┐
│              Obsidian-YOLO-llm-wiki-mcp          │
├─────────────────────────────────────────────────┤
│  @modelcontextprotocol/sdk   (MCP Protocol)     │
│  @electric-sql/pglite        (Vector Database)  │
│  Node.js http/https          (Embedding Client) │
│  child_process (grep/obsidian) (System CLI)     │
├─────────────────────────────────────────────────┤
│  External deps = 2   |   Native modules = 2     │
└─────────────────────────────────────────────────┘
```

#### 6. Incremental Updates

Supports single-page vector incremental updates (`update_page_store`), so editing one page doesn't require rebuilding the entire index.

![Incremental Updates](docs/images/incremental-update.svg)

### Features

| Tool | Description |
|------|-------------|
| `search_wiki` | Three-channel parallel search (grep, page embeddings, PGlite chunks) |
| `lint_full` | Dual-engine lint: vector cosine similarity + graph topology, 4 categories + structural insights |
| `build_wiki_graph` | Build/rebuild knowledge graph (pure file IO, zero API cost) |
| `update_wiki_graph` | Incremental graph update after editing (diff analysis + semantic change confirmation) |
| `mark_skipped_connection` | Mark false-positive lint results to ignore them |
| `build_page_store` | Build/rebuild the page embedding index |
| `update_page_store` | Update a single page's embedding after editing |
| `list_decisions` | List pending and resolved decisions |
| `create_decision` | Create a decision entry with selectable options |
| `resolve_decision` | Resolve a decision by selecting an option |
| `correct_decision` | Add a correction to a previously resolved decision |

### API Examples

JSON request/response format. See tool `inputSchema` for full specifications.

#### Search

```json
// → search_wiki
{ "query": "how to configure embedding model" }

// ← { "results": [{ "path": "wiki/...", "score": 0.92, "slug": "...", "title": "..." }],
//      "sources": ["page_store", "grep"], "count": 5, "_vault": "AI" }
```

#### Graph & Lint

```json
// → build_wiki_graph
{}

// → lint_full
{ "top": 10, "minVectorScore": 0.6, "minGraphScore": 1.5 }

// ← { "cross_signal": [...], "semantic_only": [...], "structural_only": [...],
//      "structural_insights": [...], "summary": { "total_candidates": 15, ... } }
```

#### Page Store

```json
// → build_page_store
{}

// → update_page_store
{ "filePath": "wiki/entities/Claude Code.md" }
```

#### Decisions

```json
// → create_decision
{ "situation": "Two sources describe the API endpoint differently",
  "options": [{ "label": "A", "action": "Use source 1", "consequence": "..." },
              { "label": "B", "action": "Use source 2", "consequence": "..." }] }

// → resolve_decision
{ "id": "DEC-001", "option": "A" }
```

#### YOLO PGlite CRUD

```json
// → query_pglite_status
{}

// → update_pglite_embedding
{ "path": "wiki/entities/Foo.md", "content": "Full page markdown content" }
```

### Install

```bash
npm install
```

> Having trouble? See the [Quick-Start Troubleshooting Guide](docs/quickstart-troubleshooting.md).

### Configure

Set environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_ROOT` | No | Absolute path to your Obsidian vault. Defaults to `../../` relative to the package. |
| `EMBED_API_URL` | Yes | Embedding API endpoint (OpenAI-compatible) |
| `EMBED_API_KEY` | Yes | Embedding API key |
| `EMBED_MODEL` | No | Embedding model name. Default: `Qwen/Qwen3-Embedding-8B` |

#### Claude Code / Cursor / Windsurf

Add to your MCP config (e.g. `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["/path/to/Obsidian-YOLO-llm-wiki-mcp/server.js"],
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

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["/path/to/Obsidian-YOLO-llm-wiki-mcp/server.js"],
      "env": {
        "VAULT_ROOT": "/path/to/your/obsidian/vault",
        "EMBED_API_URL": "https://api.example.com/v1",
        "EMBED_API_KEY": "sk-xxx"
      }
    }
  }
}
```

### Vault Structure

This server expects a vault organized as:

```
your-vault/
├── wiki/                    # Wiki pages (entities/, concepts/, synthesis/)
│   ├── decisions.md         # Decision log (managed by decisions tools)
│   ├── log.md               # Operation log
│   └── ...
├── index.md                 # Content index
└── .source-tracker/         # Auto-generated cache
    ├── page_embeddings.json    # Page vector index
    ├── wiki_graph.json         # Knowledge graph (nodes + weighted edges)
    ├── graph_changelog.json    # Graph incremental update log
    ├── skipped_connections.json # Skipped lint candidates
    └── last_lint.json          # Last lint timestamp
```

Page frontmatter should include `type`, `status`, `claim_type`, `sources`, etc. See `schema/llm-wiki-schema.md` for the full specification.

### Architecture

```
server.js
├── tools/
│   ├── search.js      # Three-channel search (grep + embeddings + PGlite)
│   ├── lint.js        # Dual-engine lint (vector + graph topology)
│   ├── graph.js       # Graph topology tools (full build + incremental update)
│   ├── store.js       # Page embedding store management
│   └── decisions.js   # Decision log CRUD
└── lib/
    ├── config.js      # VAULT_ROOT resolution
    ├── embed.js       # Embedding API client + cosine similarity
    ├── page-store.js  # Page embedding store read/write/search
    ├── graph.js       # Graph construction (wikilinks, sources, 4-signal weights)
    ├── relevance.js   # Dynamic weighting (hub penalty, rarity bonus, reinforcement)
    └── pglite.js      # YOLO PGlite integration (live + cache fallback)
```

#### Search Channels

1. **Grep** — `grep -rlE` on `wiki/*.md` for keyword matches (zero cost)
2. **Page embeddings** — cosine similarity on `.source-tracker/page_embeddings.json`
3. **PGlite chunks** — queries YOLO's PGlite vector database (live via `obsidian eval` or cached tar.gz)

Results are merged, deduplicated, and ranked by score.

#### Decision Workflow

When the LLM encounters conflicting or uncertain information during ingestion or linting, it creates a decision entry with selectable options instead of making the call itself:

1. `create_decision` — writes a checkbox-style entry to `wiki/decisions.md`
2. User picks an option in Obsidian (`[ ]` → `[x]`) or via conversation
3. `resolve_decision` — moves the entry from pending to resolved
4. `correct_decision` — adds a correction block if the user changes their mind

### Acknowledgments

- [Karpathy's llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the LLM-Wiki design pattern this project follows
- [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) — a desktop implementation (Tauri + React) of the same Karpathy pattern; its 4-Signal relevance model and knowledge graph design inspired parts of this project

### License

MIT
