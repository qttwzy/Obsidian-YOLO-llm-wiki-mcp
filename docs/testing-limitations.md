# 测试边界

本套件把确定性的文件逻辑测试，与需要正在运行的 Obsidian、YOLO 插件及其真实 PGlite schema 的集成测试分开。

## 受运行时门控的测试

| 函数 | 位置 | 门控原因 |
|----------|----------|-----------------|
| `obsidianEval` | `lib/pglite.js` | 需要 Obsidian CLI 连到正在运行的 Obsidian 实例。 |
| `checkYoloStatus` | `lib/pglite.js` | 需要该实例已加载 YOLO 插件。 |
| `queryPgliteStatus` | `lib/pglite.js` | 读取 YOLO 的实时 PGlite 状态。 |
| `readEmbedding` | `lib/pglite.js` | 经旧 SQL 适配器或现代 vector-store 适配器读记录。现代 API 不暴露 content 或 embedding preview，这些字段为 `null`。 |
| `queryWikiChunks` | `lib/pglite.js` | 对 YOLO 当前向量库做实时相似度查询。 |
| `embedViaYolo` | `lib/pglite.js` | 需要带兼容 embedding provider 的 YOLO 版本。 |

对应 Node 测试在运行时不可用时调用 `t.skip()`，因此 skip 会显示在测试输出中，而不会被算作通过的集成检查。从仓库启动的默认 `npm test` 通常不指定活 vault，因此这些检查可能被 skip。

## 需要可丢弃 vault 的操作

| 函数 | 位置 | 不进入默认测试运行的原因 |
|----------|----------|---------------------------------------------|
| `createEmbedding` | `lib/pglite.js` | 向 YOLO 的 PGlite 数据库插入记录。YOLO 1.6.5 的 vector-store 分支尚未做过破坏性演练。 |
| `updateEmbedding` | `lib/pglite.js` | 替换 YOLO PGlite 数据库中的记录。YOLO 1.6.5 的 vector-store 分支尚未做过破坏性演练。 |
| `deleteEmbedding` | `lib/pglite.js` | 从 YOLO PGlite 数据库删除记录。YOLO 1.6.5 的 vector-store 分支尚未做过破坏性演练。 |
| `buildStore` / `updateEntry` | `lib/page-store.js` | 需要 YOLO embeddings，并改写 vault 的 page-store 缓存。 |

只在可丢弃 vault 上运行这些操作，不要对用户的生产 vault 运行。

## 仍缺的 fixture 覆盖

| 区域 | 缺失覆盖 |
|------|------------------|
| 现代写入适配器 | 在可丢弃的 YOLO 1.6.5 vault 上对 `createEmbedding`、`updateEmbedding`、`deleteEmbedding` 的覆盖。 |
| 缓存适配器 | 对当前 YOLO 版本产出的缓存跑 `tryCacheQuery`。 |
| 端到端工作流 | 在同一可丢弃 vault 中完成录入、embedding、图更新和搜索。 |

## 持久化与并发

整文件状态写入使用原子替换，避免读者看到被截断的 JSON 或 Markdown。`ingest_source` 在后续本地步骤失败时也会恢复其页面、索引和日志。这两种机制都不提供持久崩溃恢复日志、跨进程读改写事务或写锁：进程突然终止和并发 MCP 进程仍可能导致逻辑更新冲突。

## 推荐的集成检查

启动已启用 YOLO 的 Obsidian，对目标 vault 跑只读回归：

```bash
VAULT_ROOT="/absolute/path/to/vault" \
OBSIDIAN_CLI_PATH="/usr/local/bin/obsidian" \
YOLO_LIVE_TEST_VAULT="VaultName" \
node --test tests/test-pglite.test.js
```

套件默认不设置 `YOLO_LIVE_EMBED_TEST=1`，因此不会发出可能走远程 embedding-provider 的请求。只有在确实需要这类请求时才打开该标志。PGlite 写入工具只在可丢弃 vault 中演练。
