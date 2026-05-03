# YOLO PGlite 内存直连访问设计

**日期**: 2026-05-03
**状态**: 已审核
**作者**: Claude Code + 用户协作

## 背景与目标

### 当前架构
MCP 服务器通过两种方式访问 YOLO 的 PGlite 嵌入数据库：
1. **主路径**：`obsidian eval` CLI → YOLO 插件的 `pgClient.query()` → 内存中的 PGlite
2. **回退路径**：解压 `.yolo_vector_db.tar.gz`（~30MB）到 `.source-tracker/yolo_db_cache/` → 本地 PGlite 实例

### 问题
- 用户需要**实时写入能力**（完整的 CRUD 操作）
- 需要正确识别目标 vault（当多个 Obsidian vault 同时打开时）
- 希望未来移除 tar.gz 缓存以节省存储空间

### 目标
1. 实现完整的嵌入生命周期管理（创建/读取/更新/删除）
2. 通过 `vault=<name>` 参数精确路由到目标 vault
3. 保持与 YOLO 自动索引机制的数据一致性
4. 保留缓存作为回退，双轨并行运行

## 架构设计

### 核心变更
- **增强** `lib/pglite.js`，添加 CRUD 操作函数和 vault 参数支持
- **保留** tar.gz 缓存机制作为回退（未来条件成熟后移除）
- **新增** CRUD 操作函数（`createEmbedding`、`readEmbedding`、`updateEmbedding`、`deleteEmbedding`）
- **增强** 现有工具的 vault 参数支持

### 数据流
```
MCP Server
    ↓
obsidian eval vault="AI" code="..."
    ↓
YOLO Plugin (app.plugins.plugins['yolo'])
    ↓
dbManager.pgClient.query(SQL)
    ↓
PGlite (in-memory)
```

### 依赖关系
- `lib/pglite.js` 依赖 `child_process.execSync`
- `tools/search.js` 和 `tools/store.js` 调用 `lib/pglite.js`
- `@electric-sql/pglite` 包保留用于缓存回退路径

## CRUD 操作设计

### 操作函数

| 操作 | 函数名 | 说明 |
|------|--------|------|
| 创建 | `createEmbedding(vault, entry)` | INSERT 新嵌入记录 |
| 读取 | `readEmbedding(vault, path)` | 按 path 查询单条记录 |
| 更新 | `updateEmbedding(vault, path, entry)` | UPDATE 现有记录 |
| 删除 | `deleteEmbedding(vault, path)` | DELETE 按 path 删除 |
| 批量查询 | `queryEmbeddings(vault, queryVec, limit)` | 向量相似度搜索（已有） |

### 数据结构
```javascript
{
  path: "wiki/entities/Claude Code.md",  // 相对路径
  mtime: 1700000000,                     // 文件修改时间戳
  content: "页面内容...",                 // 文件内容
  model: "Qwen/Qwen3-Embedding-8B",     // 嵌入模型
  dimension: 4096,                       // 向量维度
  embedding: [0.1, 0.2, ...],           // 4096 维向量
  metadata: {                            // 元数据
    startLine: 1,
    endLine: 50,
    source: "mcp",                       // 来源标记
    updatedAt: "2026-05-03T12:00:00Z"    // MCP 修改时间
  },
  content_hash: "sha256..."              // 内容哈希
}
```

### Vault 参数
- 所有函数接受 `vault` 参数（vault 名称字符串）
- 默认使用 `VAULT_ROOT` 对应的 vault 名称：`path.basename(VAULT_ROOT)`
- 通过 `obsidian eval vault=<name>` 精确路由
- 验证 vault 存在性，不存在时返回错误

## 安全策略

### 1. 协调写入
```javascript
// 写入前：清理同路径旧记录
DELETE FROM embeddings WHERE path = $1

// 写入：插入新记录
INSERT INTO embeddings (path, mtime, content, model, dimension, embedding, metadata, content_hash)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
```

**目的**：避免 YOLO 重新索引时产生重复记录

### 2. 标记外部修改
```javascript
metadata: {
  startLine: 1,
  endLine: 50,
  source: "mcp",                       // 新增：标记来源
  updatedAt: "2026-05-03T12:00:00Z"    // 新增：修改时间
}
```

**目的**：区分 MCP 写入和 YOLO 写入，便于调试和审计

### 3. 写入时检查 YOLO 状态
```javascript
// 检查 YOLO 是否正在索引
const isRunning = ragIndexService.isRunning()
if (isRunning) {
  return { error: "YOLO indexing in progress, retry later" }
}
```

**目的**：避免并发写入冲突

### 4. 数据一致性保证
- 写入操作由两条顺序 SQL 语句组成（DELETE + INSERT）
- 使用 `content_hash` 检测内容变更
- MCP 写入后，YOLO 下次索引会创建新版本（如有文件变更）
- 如果 DELETE 成功但 INSERT 失败，记录将被删除（需重试或回滚）

## 错误处理

### 错误分类

| 错误类型 | 处理策略 | 示例 |
|----------|----------|------|
| Obsidian 未运行 | 回退到缓存 + 返回明确错误信息 | `obsidian eval` 超时 |
| Vault 不存在 | 返回错误，列出可用 vault | `vault="WrongName"` |
| YOLO 插件未加载 | 返回错误，提示启用插件 | `app.plugins.plugins['yolo']` 为 null |
| SQL 执行失败 | 返回 PostgreSQL 错误信息 | 约束违反、语法错误 |
| 向量维度不匹配 | 验证维度后执行，失败返回错误 | 4096 维 vs 1536 维 |
| YOLO 正在索引 | 返回错误，提示稍后重试 | `ragIndexService.isRunning()` 为 true |

### 重试机制
- `obsidian eval` 超时：最多重试 2 次，间隔 500ms
- 每次重试前检查 Obsidian 进程是否存活
- 超过重试次数后回退到缓存（如果可用）

## MCP 工具接口

### 新增工具

#### `update_pglite_embedding`
创建或更新单个页面的嵌入。

**参数**：
- `vault` (可选): Vault 名称，默认使用 VAULT_ROOT 对应的 vault
- `path` (必需): 页面相对路径（如 `wiki/entities/Claude Code.md`）
- `content` (必需): 页面内容
- `metadata` (可选): 元数据对象

**返回**：
```json
{
  "success": true,
  "path": "wiki/entities/Claude Code.md",
  "action": "created",  // 或 "updated"
  "id": 1234
}
```

#### `delete_pglite_embedding`
删除指定路径的嵌入。

**参数**：
- `vault` (可选): Vault 名称
- `path` (必需): 页面相对路径

**返回**：
```json
{
  "success": true,
  "deleted": 3  // 删除的记录数（可能有多条 chunks）
}
```

#### `query_pglite_status`
查询 PGlite 状态和统计信息。

**参数**：
- `vault` (可选): Vault 名称

**返回**：
```json
{
  "available": true,
  "vault": "AI",
  "source": "pglite_live",
  "total_embeddings": 1751,
  "model": "Qwen/Qwen3-Embedding-8B",
  "dimension": 4096,
  "yolo_indexing": false
}
```

### 现有工具增强
- `search_wiki`: 添加 `vault` 参数，支持多 vault 搜索
- `build_page_store`: 添加 `vault` 参数
- `update_page_store`: 添加 `vault` 参数

## 实现计划

### 阶段 1：核心 CRUD（优先级：高）
1. 增强 `lib/pglite.js`，添加 CRUD 操作函数
2. 实现 `createEmbedding`、`readEmbedding`、`updateEmbedding`、`deleteEmbedding`
3. 添加 vault 参数支持
4. 实现安全策略（协调写入、标记、状态检查）

### 阶段 2：MCP 工具集成（优先级：高）
1. 新增 `update_pglite_embedding`、`delete_pglite_embedding`、`query_pglite_status` 工具
2. 增强现有工具的 vault 参数
3. 在 `server.js` 中注册新工具

### 阶段 3：测试与验证（优先级：中）
1. 单元测试：CRUD 操作的正确性
2. 集成测试：与 YOLO 自动索引的协调
3. 多 vault 测试：验证 vault 路由正确性
4. 性能测试：查询延迟和吞吐量

### 阶段 4：文档与清理（优先级：低）
1. 更新 CLAUDE.md 和 README
2. 添加使用示例
3. 标注未来移除缓存的条件

## 未来优化路径

### 条件成熟后移除缓存
当以下条件全部满足时，可以移除 tar.gz 缓存：
1. `obsidian eval` 访问稳定可靠（连续 30 天无超时）
2. 多 vault 识别功能经过充分测试
3. CRUD 操作经过生产环境验证
4. 用户确认不再需要离线访问

### 方案 B：共享内存直连（长期研究）
- 调查 PGlite 是否使用 SharedArrayBuffer
- 尝试从 MCP 服务器直接访问同一内存空间
- 预期收益：零拷贝、最快访问速度
- 风险：复杂、脆弱、可能不可行

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Obsidian 未运行 | 无法访问内存数据库 | 回退到缓存 |
| YOLO 正在索引 | 写入冲突 | 检查状态，延迟重试 |
| 多 vault 混淆 | 写入错误 vault | 强制 vault 参数验证 |
| YOLO 版本升级 | Schema 变更 | 定期检查 Schema 兼容性 |
| 性能下降 | CLI 调用开销 | 批量操作优化 |

## 附录

### 数据库 Schema
```sql
CREATE TABLE embeddings (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  mtime BIGINT NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension SMALLINT NOT NULL,
  embedding vector(4096) NOT NULL,
  metadata JSONB,
  content_hash TEXT NOT NULL
);

-- 索引
CREATE INDEX embeddings_path_index ON embeddings USING btree (path);
CREATE INDEX embeddings_model_index ON embeddings USING btree (model);
CREATE INDEX embeddings_dimension_index ON embeddings USING btree (dimension);
-- HNSW 向量索引（按维度分区）
CREATE INDEX embeddings_embedding_4096_index ON embeddings
  USING hnsw ((embedding::vector(4096)) vector_cosine_ops)
  WITH (m='24', ef_construction='100')
  WHERE (dimension = 4096);
```

### 当前数据统计
- 总嵌入数：1751
- 模型：Qwen/Qwen3-Embedding-8B
- 维度：4096
- 查询延迟：~42ms（内存查询）

### 相关文件
- `lib/pglite.js` - 当前 PGlite 访问层
- `lib/page-store.js` - 页面级嵌入存储
- `tools/search.js` - 三通道搜索
- `server.js` - MCP 服务器入口
