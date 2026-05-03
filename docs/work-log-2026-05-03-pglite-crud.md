# 工作记录：YOLO PGlite CRUD 操作实现

**日期**: 2026-05-03
**工作类型**: 功能实现
**状态**: 已完成

---

## 工作概述

为 MCP 服务器添加了完整的 YOLO PGlite 嵌入库 CRUD 操作，支持多 vault 路由和安全写入机制。

## 背景

### 问题
1. MCP 服务器只能读取 YOLO 的 PGlite 嵌入库，无法写入
2. 多个 Obsidian vault 同时打开时无法精确识别目标 vault
3. 需要与 YOLO 的自动索引机制协调，避免数据冲突

### 目标
1. 实现完整的嵌入生命周期管理（创建/读取/更新/删除）
2. 通过 `vault=<name>` 参数精确路由到目标 vault
3. 保持与 YOLO 自动索引机制的数据一致性

## 技术发现

### YOLO 插件结构
通过 `obsidian eval` 命令探索了 YOLO 插件的内部结构：

```javascript
// YOLO 插件对象结构
app.plugins.plugins['yolo'] = {
  dbManager: {
    pgClient: PGlite客户端,  // 可执行 SQL 查询
    db: DrizzleORM实例,
    dbPath: "YOLO/.yolo_vector_db.tar.gz",
    runtimeDir: ".obsidian/plugins/yolo/runtime/pglite/pglite-runtime-0.4.4-r1"
  },
  ragIndexService: {
    isRunning: Function  // 检查是否正在索引
  },
  ragAutoUpdateService: { ... }
}
```

### 数据库 Schema
```sql
CREATE TABLE embeddings (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL,           -- 相对路径
  mtime BIGINT NOT NULL,        -- 文件修改时间戳
  content TEXT NOT NULL,         -- 文件内容
  model TEXT NOT NULL,           -- 嵌入模型名称
  dimension SMALLINT NOT NULL,   -- 向量维度
  embedding vector(4096) NOT NULL, -- 嵌入向量
  metadata JSONB,                -- 元数据
  content_hash TEXT NOT NULL     -- 内容哈希
);
```

### 多 Vault 识别
- Obsidian 使用单进程多窗口模型
- `obsidian eval vault="AI"` 可精确指定目标 vault
- 每个 vault 有独立的 YOLO 插件实例和 PGlite 数据库

### 性能数据
- 内存向量查询延迟：~42ms
- 当前嵌入数量：2507 条
- 向量维度：4096（Qwen/Qwen3-Embedding-8B）

## 实现内容

### 新增文件
| 文件 | 说明 |
|------|------|
| `tools/yolo-crud.js` | MCP 工具处理器（update/delete/status） |
| `docs/superpowers/specs/2026-05-03-yolo-pglite-memory-access-design.md` | 设计文档 |
| `docs/superpowers/plans/2026-05-03-yolo-pglite-crud.md` | 实现计划 |
| `docs/work-log-2026-05-03-pglite-crud.md` | 本文档 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `lib/pglite.js` | 新增 7 个函数（vaultName, obsidianEval, checkYoloStatus, createEmbedding, readEmbedding, deleteEmbedding, updateEmbedding, queryPgliteStatus） |
| `server.js` | 注册 3 个新工具，search_wiki 添加 vault 参数 |
| `tools/search.js` | searchWiki 和 chunkSearch 添加 vault 参数 |
| `CLAUDE.md` | 添加多 vault 支持和 CRUD 工具文档 |

### 提交历史
```
bef680c docs: add new PGlite tools and vault parameter documentation
9f83f5d feat(search): add vault parameter to search_wiki tool
27b1840 feat(server): register update/delete/status PGlite tools
3adc080 feat(tools): add yolo-crud handlers for PGlite CRUD operations
a90cd47 feat(pglite): add queryPgliteStatus for diagnostics
dca778e feat(pglite): add updateEmbedding (coordinated delete+insert)
f055332 feat(pglite): add deleteEmbedding with safety checks
473d513 feat(pglite): add readEmbedding for path-based queries
054bc05 feat(pglite): add createEmbedding with safety checks
70b0248 feat(pglite): add checkYoloStatus for safe write operations
b933b52 feat(pglite): add obsidianEval wrapper and vaultName helper
```

## 设计决策

### 1. 使用 `obsidian eval` CLI 而非共享内存
**决策**：通过 `obsidian eval vault=<name>` 命令访问 YOLO 的 PGlite 数据库

**原因**：
- 共享内存方案复杂且脆弱，依赖 PGlite 内部实现
- CLI 方案简单可靠，已验证可行
- 每次调用约 100-200ms 开销，可接受

**权衡**：
- 优点：简单、无新依赖、跨平台兼容
- 缺点：CLI 调用开销、依赖 Obsidian 运行

### 2. 协调写入（Delete + Insert）
**决策**：更新嵌入时先删除旧记录，再插入新记录

**原因**：
- YOLO 的 embeddings 表没有 path 唯一约束
- 同一路径可能有多条记录（不同 chunks）
- 协调写入避免重复记录

**权衡**：
- 优点：数据一致性好、逻辑简单
- 缺点：非原子操作（DELETE 成功但 INSERT 失败会丢失数据）

### 3. 元数据标记
**决策**：所有 MCP 写入在 metadata 中标记 `source: "mcp"`

**原因**：
- 区分 MCP 写入和 YOLO 写入
- 便于调试和审计
- 未来可基于此实现冲突检测

### 4. YOLO 状态检查
**决策**：写入前检查 YOLO 是否正在索引

**原因**：
- 避免并发写入冲突
- YOLO 索引时可能锁定数据库
- 提供明确的错误信息

## 遇到的问题

### 1. multiline 代码在 obsidian eval 中失败
**问题**：包含换行符的 JavaScript 代码在 `obsidian eval` 中无法正确执行

**解决**：使用数组 join 方式构建单行代码
```javascript
const code = [
  "(async () => {",
  "  // ...",
  "})()",
].join("");
```

### 2. r.rowCount 不存在
**问题**：PGlite 的查询结果没有 `rowCount` 属性

**解决**：使用 `r.affectedRows` 替代
```javascript
return JSON.stringify({ success: true, deleted: r.affectedRows || 0 });
```

### 3. JSON.parse 失败
**问题**：`obsidian eval` 输出的值可能不是有效 JSON

**解决**：要求调用方返回 `JSON.stringify()` 包装的值

## 测试验证

### 功能测试
```bash
# 测试 CRUD 操作
node -e "
const pglite = require('./lib/pglite');
// Create
const createResult = pglite.createEmbedding({ path: 'test.md', ... });
// Read
const readResult = pglite.readEmbedding('test.md');
// Update
const updateResult = pglite.updateEmbedding('test.md', { ... });
// Delete
const deleteResult = pglite.deleteEmbedding('test.md');
// Status
const status = pglite.queryPgliteStatus();
"
```

### 验证结果
- 所有 CRUD 操作正常工作
- 安全检查正确阻止写入（YOLO 索引时）
- Vault 路由正确识别目标 vault
- 数据库状态正常（2507 条嵌入）

## 未来工作

### 短期
1. 添加单元测试框架
2. 优化 CLI 调用性能（批量操作）
3. 添加重试机制（指数退避）

### 中期
1. 移除 tar.gz 缓存（条件成熟后）
2. 实现嵌入批量更新
3. 添加操作日志

### 长期
1. 研究共享内存直连方案
2. 实现跨 vault 搜索
3. 添加嵌入版本管理

## 相关文档

- [设计文档](../superpowers/specs/2026-05-03-yolo-pglite-memory-access-design.md)
- [实现计划](../superpowers/plans/2026-05-03-yolo-pglite-crud.md)
- [MCP 服务器文档](../../CLAUDE.md)
- [Vault 总文档](../../../CLAUDE.md)

## Agent 接手指南

### 快速上手
1. 阅读 `mcp/CLAUDE.md` 了解项目结构
2. 阅读本文档了解实现背景
3. 运行 `node -e "const { queryPgliteStatus } = require('./lib/pglite'); console.log(queryPgliteStatus())"` 验证环境

### 关键文件
- `lib/pglite.js` - PGlite 访问层（核心）
- `tools/yolo-crud.js` - MCP 工具处理器
- `server.js` - MCP 服务器入口

### 常见任务

#### 添加新的 CRUD 操作
1. 在 `lib/pglite.js` 中添加函数
2. 使用 `obsidianEval()` 执行 SQL
3. 在 `tools/yolo-crud.js` 中添加处理器
4. 在 `server.js` 中注册工具

#### 修改安全策略
1. 编辑 `lib/pglite.js` 中的 `checkYoloStatus()`
2. 更新写入函数（createEmbedding, updateEmbedding, deleteEmbedding）

#### 调试问题
1. 使用 `obsidian eval vault="AI" code="..."` 直接测试 SQL
2. 检查 `queryPgliteStatus()` 返回的状态
3. 查看 YOLO 插件日志（Obsidian 开发者工具）

### 注意事项
- multiline 代码在 obsidian eval 中会失败，使用数组 join
- 使用 `r.affectedRows` 而非 `r.rowCount`
- 所有返回值必须用 `JSON.stringify()` 包装
