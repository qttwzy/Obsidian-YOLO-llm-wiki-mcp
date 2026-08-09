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

优先通过 `obsidian eval` CLI 实时查询 Obsidian 中 YOLO 插件的 PGlite 向量库；当前兼容旧版 `dbManager.pgClient` 和 YOLO 1.6.5 的 `VectorManager`/vector-store 两条私有适配路径。Obsidian 未运行时，只有当前 vault 存在兼容的本地缓存才会回退；否则 PGlite 语义通道不可用，但 Grep 搜索仍可用。两条实时路径都依赖 YOLO 私有运行时对象，升级 YOLO 后应重新运行集成测试。
![YOLO PGlite 双策略集成](docs/images/pglite-fallback.svg)

#### 5. 精简依赖与 YOLO 托管 Embedding

项目仅直接安装 2 个 npm 依赖（`@modelcontextprotocol/sdk` + `@electric-sql/pglite`），也不直接保存 Embedding provider 的 API key。向量计算委托给 YOLO；YOLO 最终使用本地模型还是远程服务，取决于用户在插件中的 provider 配置。

```
┌─────────────────────────────────────────────────┐
│              Obsidian-YOLO-llm-wiki-mcp          │
├─────────────────────────────────────────────────┤
│  Obsidian + YOLO 插件       (Embedding + 向量库) │
│  @modelcontextprotocol/sdk  (MCP 协议)          │
│  @electric-sql/pglite       (缓存回退)           │
├─────────────────────────────────────────────────┤
│  npm 直接依赖 = 2          |  Embedding provider 由 YOLO 配置 │
└─────────────────────────────────────────────────┘
```

#### 6. 增量更新

支持单页面向量增量更新（`update_page_store`），编辑一个页面后无需重建整个索引。
![增量更新](docs/images/incremental-update.svg)

### 功能特性

| 工具                        | 说明                                 |
| ------------------------- | ---------------------------------- |
| `init_wiki`               | 初始化 LLM-Wiki 骨架（含 Karpathy 设计模式原文） |
| `set_inbox_folders`       | 配置收件箱目录（set/add/remove/list）       |
| `build_page_store`        | 构建/重建页面向量索引                        |
| `build_wiki_graph`        | 构建/重建知识图谱（纯文件 IO，零 API 成本）         |
| `discover_sources`        | 扫描收件箱中未处理的新文件                      |
| `ingest_source`           | 录入源文件：建页面 → 更新索引 → 写日志 → 归档        |
| `update_page_store`       | 编辑后更新单个页面的向量                       |
| `update_wiki_graph`       | 编辑页面后增量更新图数据（先 diff 分析，再确认语义变化）    |
| `update_pglite_embedding` | 创建/更新 YOLO PGlite 嵌入记录             |
| `search_wiki`             | 三通道并行搜索（grep、页面向量、PGlite 分块）       |
| `lint_full`               | 双引擎 Lint：向量语义 + 图拓扑分析，输出四类候选对和结构洞见 |
| `mark_skipped_connection` | 标记误报的检查结果以忽略                       |
| `list_decisions`          | 列出待处理和已解决的决策                       |
| `create_decision`         | 创建带可选项的决策条目                        |
| `resolve_decision`        | 选择选项以解决决策                          |
| `correct_decision`        | 对已解决的决策添加修正                        |
| `finalize_correction`     | 完成修正并恢复为已解决状态                      |
| `delete_pglite_embedding` | 从 YOLO PGlite 删除嵌入记录               |
| `query_pglite_status`     | 查询 YOLO PGlite 数据库状态与统计            |

`ingest_source` 只接受声明收件箱内的普通源文件，并兼容 `/` 与 Windows `\` 分隔符。若后续本地步骤失败，它会补偿恢复新页面、索引和日志；这不等同于跨进程事务或崩溃恢复日志。

### 安装

```bash
git clone https://github.com/qttwzy/Obsidian-YOLO-llm-wiki-mcp.git
cd Obsidian-YOLO-llm-wiki-mcp
npm install
```

> 遇到问题？查看 [快速排查清单](docs/quickstart-troubleshooting.md)。

### 配置

设置环境变量：

| 变量                | 必需  | 说明                                                                                     |
| ----------------- | --- | -------------------------------------------------------------------------------------- |
| `VAULT_ROOT`      | 否   | Obsidian 知识库的绝对路径，默认为包的 `../../` 相对路径                                              |
| `OBSIDIAN_CLI_PATH` | 否   | Obsidian CLI 路径，默认 `obsidian`。macOS 的 GUI/MCP 宿主 PATH 找不到 CLI 时，设置绝对路径，例如 `/usr/local/bin/obsidian`。 |

> 本项目不直接配置或保存 Embedding API 密钥。Embedding 由 YOLO 统一调用；YOLO provider 是否需要密钥取决于你的插件配置。

当前已在 macOS arm64、Obsidian CLI 和 YOLO 1.6.5 上验证只读状态、统计、记录读取与相似度查询。PGlite 创建、更新和删除仍应只在 disposable vault 中验证。

#### YOLO 插件

YOLO 内置 MCP 客户端，可在插件设置中直接添加此服务器，无需编辑 JSON 文件：

1. 打开 Obsidian 设置 → **YOLO** → **Custom tools (MCP)**
2. 点击 **Add custom tool server (MCP)**
3. 填写 **Name**（如 `llm-wiki`）
4. 在 **Parameters** 中输入以下 JSON：

```json
{
  "transport": "stdio",
  "command": "node",
  "args": ["/path/to/Obsidian-YOLO-llm-wiki-mcp/server.js"],
  "env": {
    "VAULT_ROOT": "/path/to/your/obsidian/vault",
    "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
  }
}
```

5. 点击 **Save**，服务器自动连接

> `args` 和 `env` 中的路径请替换为你实际的 vault 和 mcp 目录路径。Windows 上可省略 `OBSIDIAN_CLI_PATH`，或填入本机 Obsidian CLI 的绝对路径。

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
        "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
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
        "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
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

页面 frontmatter 应包含 `type`、`status`、`sources` 等字段。完整规范见 `schema/llm-wiki-schema.md`。

### 架构

```
server.js
├── tools/
│   ├── search.js      # 三通道搜索
│   ├── lint.js        # 双引擎 Lint（向量 + 图拓扑）
│   ├── graph.js       # 图拓扑工具（全量构建 + 增量更新）
│   ├── store.js       # 页面向量存储管理
│   ├── decisions.js   # 决策日志增删改查
│   ├── yolo-crud.js   # YOLO PGlite CRUD 操作
│   ├── init-wiki.js   # LLM-Wiki 骨架初始化
│   ├── discover.js    # 收件箱扫描与配置
│   └── ingest.js      # 源文件录入
└── lib/
    ├── config.js      # VAULT_ROOT 解析 + 文件遍历
    ├── embed.js       # 余弦相似度工具
    ├── fs-utils.js    # 整文件原子替换工具
    ├── page-store.js  # 页面向量存储读写搜索
    ├── graph.js       # 图构建（wikilinks、sources、4-signal 权重）
    ├── resolver.js    # Wikilink 解析
    ├── relevance.js   # 动态权重计算（hub 惩罚、稀缺奖励、叠加奖励）
    └── pglite.js      # YOLO 私有 legacy/vector-store 适配 + 缓存回退
```

#### 搜索通道

1. **Grep** — 对 `wiki/*.md` 执行关键词匹配（纯 Node.js，零外部依赖）
2. **页面向量** — 对 `.source-tracker/page_embeddings.json` 执行余弦相似度计算
3. **PGlite 分块** — 通过 `obsidian eval` 调用 YOLO 私有 legacy/vector-store 适配；实时运行时不可用时，仅使用当前 vault 的兼容缓存

结果会合并、去重并按分数排序。

#### 决策工作流

当 LLM 在录入或检查过程中遇到矛盾或不确定的信息时，会创建带可选项的决策条目，而不是自行判断：

1. `create_decision` — 向 `wiki/decisions.md` 写入复选框样式的条目
2. 用户在 Obsidian 中选择选项（`[ ]` → `[x]`）或通过对话选择
3. `resolve_decision` — 将条目从待处理移至已解决
4. `correct_decision` — 如果用户改变主意，添加修正块
5. `finalize_correction` — 选择最终方案或自定义结果，完成修正

### 开发

```bash
npm test              # ESLint + Node 测试套件（YOLO 运行时用例在不可用时显示为 skipped）
npm run lint          # 仅 ESLint
node --test           # 仅运行测试
```

### YOLO Modules 接入

当前项目不能原样迁入 YOLO Module 运行时，但可以抽取纯文件逻辑并构建一个轻量的 Module UI/命令层。能力边界、官方分发限制和推荐架构见 [YOLO Modules 接入评估](docs/yolo-modules-integration.md)。

### 致谢

- [Karpathy's llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — 本项目遵循的 LLM-Wiki 设计模式
- [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) — 同样基于 Karpathy 模式的桌面应用实现（Tauri + React），其 4-Signal 相关性模型和知识图谱设计对本项目有启发
- [YOLO](https://github.com/Lapis0x0/obsidian-yolo) — Agent 原生 AI 助手，为本项目提供 Embedding 计算和 PGlite 向量库

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

Primarily queries YOLO's PGlite vector database in real time via the `obsidian eval` CLI. It supports both the legacy `dbManager.pgClient` path and YOLO 1.6.5's private `VectorManager`/vector-store path. When Obsidian is unavailable, it uses a cache only when a compatible cache exists for the current vault. Otherwise the PGlite semantic channel is unavailable, while grep search remains available. Both live adapters depend on private YOLO runtime objects, so rerun integration tests after a YOLO upgrade.
![YOLO PGlite Dual-Strategy Integration](docs/images/pglite-fallback.svg)

#### 5. Lean Dependencies and YOLO-Managed Embedding

The project directly installs only two npm dependencies (`@modelcontextprotocol/sdk` and `@electric-sql/pglite`) and does not store embedding-provider API keys itself. Embedding is delegated to YOLO; whether YOLO uses a local model or a remote service depends on the provider configured by the user.

```
┌─────────────────────────────────────────────────┐
│              Obsidian-YOLO-llm-wiki-mcp          │
├─────────────────────────────────────────────────┤
│  Obsidian + YOLO plugin      (Embedding + VDB)   │
│  @modelcontextprotocol/sdk   (MCP protocol)     │
│  @electric-sql/pglite        (cache fallback)    │
├─────────────────────────────────────────────────┤
│  direct npm deps = 2        |  provider configured in YOLO │
└─────────────────────────────────────────────────┘
```

#### 6. Incremental Updates

Supports single-page vector incremental updates (`update_page_store`), so editing one page doesn't require rebuilding the entire index.
![Incremental Updates](docs/images/incremental-update.svg)

### Features

| Tool                      | Description                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `init_wiki`               | Initialize LLM-Wiki skeleton (includes Karpathy design pattern article)                         |
| `set_inbox_folders`       | Configure inbox directories (set/add/remove/list)                                               |
| `build_page_store`        | Build/rebuild the page embedding index                                                          |
| `build_wiki_graph`        | Build/rebuild knowledge graph (pure file IO, zero API cost)                                     |
| `discover_sources`        | Scan inbox folders for unprocessed files                                                        |
| `ingest_source`           | Ingest source: create page → update index → log → archive                                       |
| `update_page_store`       | Update a single page's embedding after editing                                                  |
| `update_wiki_graph`       | Incremental graph update after editing (diff analysis + semantic change confirmation)           |
| `update_pglite_embedding` | Create or update an embedding record in YOLO's PGlite database                                  |
| `search_wiki`             | Three-channel parallel search (grep, page embeddings, PGlite chunks)                            |
| `lint_full`               | Dual-engine lint: vector cosine similarity + graph topology, 4 categories + structural insights |
| `mark_skipped_connection` | Mark false-positive lint results to ignore them                                                 |
| `list_decisions`          | List pending and resolved decisions                                                             |
| `create_decision`         | Create a decision entry with selectable options                                                 |
| `resolve_decision`        | Resolve a decision by selecting an option                                                       |
| `correct_decision`        | Add a correction to a previously resolved decision                                              |
| `finalize_correction`     | Complete a correction and return it to resolved status                                          |
| `delete_pglite_embedding` | Delete embedding records from YOLO's PGlite database                                            |
| `query_pglite_status`     | Query YOLO PGlite database status and statistics                                                |

`ingest_source` accepts only regular source files inside the declared inbox and normalizes both `/` and Windows `\` separators. If a later local step fails, it restores the new page, index, and log; this is not a cross-process transaction or durable crash-recovery journal.

### Install

```bash
git clone https://github.com/qttwzy/Obsidian-YOLO-llm-wiki-mcp.git
cd Obsidian-YOLO-llm-wiki-mcp
npm install
```

> Having trouble? See the [Quick-Start Troubleshooting Guide](docs/quickstart-troubleshooting.md).

### Configure

Set environment variables:

| Variable            | Required | Description                                                                                                          |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `VAULT_ROOT`        | No       | Absolute path to your Obsidian vault. Defaults to `../../` relative to the package.                                 |
| `OBSIDIAN_CLI_PATH` | No       | Obsidian CLI path; defaults to `obsidian`. Set an absolute path such as `/usr/local/bin/obsidian` when a macOS GUI/MCP host does not inherit your shell PATH. |

> This project does not configure or store embedding API keys. YOLO owns the embedding call; whether its provider needs a key depends on your YOLO configuration.

Read-only status, statistics, record lookup, and similarity search have been verified on macOS arm64 with the Obsidian CLI and YOLO 1.6.5. PGlite create, update, and delete operations should still be validated only in a disposable vault.

#### YOLO Plugin

YOLO has a built-in MCP client. Add this server directly in the plugin settings — no JSON file editing needed:

1. Open Obsidian Settings → **YOLO** → **Custom tools (MCP)**
2. Click **Add custom tool server (MCP)**
3. Enter the **Name** (e.g. `llm-wiki`)
4. Paste the following JSON into **Parameters**:

```json
{
  "transport": "stdio",
  "command": "node",
  "args": ["/path/to/Obsidian-YOLO-llm-wiki-mcp/server.js"],
  "env": {
    "VAULT_ROOT": "/path/to/your/obsidian/vault",
    "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
  }
}
```

5. Click **Save** — the server connects automatically

> Adjust paths in `args` and `env` to match your actual vault and MCP directories. On Windows, omit `OBSIDIAN_CLI_PATH` or set it to the absolute path of your local Obsidian CLI.

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
        "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
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
        "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
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

Page frontmatter should include `type`, `status`, `sources`, etc. See `schema/llm-wiki-schema.md` for the full specification.

### Architecture

```
server.js
├── tools/
│   ├── search.js      # Three-channel search (grep + embeddings + PGlite)
│   ├── lint.js        # Dual-engine lint (vector + graph topology)
│   ├── graph.js       # Graph topology tools (full build + incremental update)
│   ├── store.js       # Page embedding store management
│   ├── decisions.js   # Decision log CRUD
│   ├── yolo-crud.js   # YOLO PGlite CRUD operations
│   ├── init-wiki.js   # LLM-Wiki skeleton initialization
│   ├── discover.js    # Inbox scanning and config
│   └── ingest.js      # Source file ingestion
└── lib/
    ├── config.js      # VAULT_ROOT resolution + file traversal
    ├── embed.js       # Cosine similarity helpers
    ├── fs-utils.js    # Atomic whole-file replacement helper
    ├── page-store.js  # Page embedding store read/write/search
    ├── graph.js       # Graph construction (wikilinks, sources, 4-signal weights)
    ├── resolver.js    # Wikilink resolution
    ├── relevance.js   # Dynamic weighting (hub penalty, rarity bonus, reinforcement)
    └── pglite.js      # Private YOLO legacy/vector-store adapters + cache fallback
```

#### Search Channels

1. **Grep** — pure Node.js keyword matching on `wiki/*.md` (zero external deps)
2. **Page embeddings** — cosine similarity on `.source-tracker/page_embeddings.json`
3. **PGlite chunks** — calls private YOLO legacy/vector-store adapters via `obsidian eval`, or uses a compatible cache belonging to the same vault

Results are merged, deduplicated, and ranked by score.

#### Decision Workflow

When the LLM encounters conflicting or uncertain information during ingestion or linting, it creates a decision entry with selectable options instead of making the call itself:

1. `create_decision` — writes a checkbox-style entry to `wiki/decisions.md`
2. User picks an option in Obsidian (`[ ]` → `[x]`) or via conversation
3. `resolve_decision` — moves the entry from pending to resolved
4. `correct_decision` — adds a correction block if the user changes their mind
5. `finalize_correction` — selects a final outcome and completes the correction

### Development

```bash
npm test              # ESLint + Node test suite (YOLO runtime tests skip when unavailable)
npm run lint          # ESLint only
node --test           # run tests only
```

### YOLO Modules integration

The project cannot be moved unchanged into the YOLO Module runtime, but its portable file logic can support a lightweight Module UI/command layer. See [YOLO Modules integration assessment](docs/yolo-modules-integration.md) for capability boundaries, distribution constraints, and the recommended architecture.

### Acknowledgments

- [Karpathy's llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the LLM-Wiki design pattern this project follows
- [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) — a desktop implementation (Tauri + React) of the same Karpathy pattern; its 4-Signal relevance model and knowledge graph design inspired parts of this project
- [YOLO](https://github.com/Lapis0x0/obsidian-yolo) — Agent-native AI assistant, provides embedding computation and PGlite vector database for this project

### License

MIT
