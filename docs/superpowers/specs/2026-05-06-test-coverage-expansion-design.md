# 测试覆盖率提升 — 设计文档

**日期**: 2026-05-06
**状态**: approved

## 目标

将测试覆盖率从当前 ~30% 提升到 ~75%，逼近实际天花板。

## 前置改动

### grepWiki 重构

将 `tools/search.js` 中的 `grepWiki()` 从系统 `grep -rlE` 改为纯 Node.js（`fs.readFileSync` + `String.match`），确保跨平台可测。

### embedViaYolo 新增

在 `lib/pglite.js` 中新增 `embedViaYolo(texts, vault)` 函数，通过 `obsidian eval` 调用 YOLO 插件的 Embedding provider。测试时 Obsidian 运行即可走通。

## 新增测试文件

| 文件 | 函数 | 用例数 | 数据源 |
|------|------|--------|--------|
| `tests/test-config.test.js` | `discoverVaults`, `getVaultMap`, `getVaultName`, `getWikiDir`, `walkWikiPages` | ~10 | os.tmpdir() + AI vault |
| `tests/test-resolver.test.js` | `resolveLink`, `getResolvedOutLinks` | ~6 | 内存 mock |
| `tests/test-relevance-advanced.test.js` | `getTypeAffinity`, `calculateBaseWeight`, `calculateEdgeWeight` | ~8 | 内存 mock nodes |
| `tests/test-graph-parse.test.js` | `extractWikilinks`, `extractSourcesFromFrontmatter`, `parseFrontmatter` | ~10 | AI/wiki/ 真实文件 |
| `tests/test-decisions.test.js` | `parseDecisions`, `parseBlock`, `createDecision`, `resolveDecision`, `correctDecision` | ~10 | 真实 AI/wiki/decisions.md + test 标记 |
| `tests/test-pglite.test.js` | `obsidianEval`, `checkYoloStatus`, `queryPgliteStatus`, `readEmbedding`, `embedViaYolo` | ~8 | Obsidian 运行中的 YOLO |
| `tests/test-search.test.js` | `grepWiki`（重构后）, `mergeResults` | ~8 | AI/wiki/ + 内存 |
| `tests/test-page-store.test.js` | `readPage`, `searchStore` | ~6 | AI/wiki/ + AI/.source-tracker/ |
| `tests/test-lint.test.js` | `mergeCategorize` | ~5 | 内存 |

**总计**: ~70 新用例，累计 ~97 测试。

## 不覆盖（记录到 docs/testing-limitations.md）

| 函数 | 原因 |
|------|------|
| `embedTexts` | 外部 API 网络依赖 |
| `buildStore` | 100+ 页面的 Embedding API 调用成本不可接受 |
| `updateEntry` | 同上 |
| `createEmbedding`, `updateEmbedding`, `deleteEmbedding` | PGlite 写入，测试数据会混入生产库 |
| `tryCacheQuery` | 缓存文件不一定存在 |
| `handleUpdateGraph(semanticChange=true)` | 破坏性修改 wiki_graph.json |
| `lintFull`, `graphLint`, `structuralInsights` | 依赖已构建的图和向量数据 |
| `tryObsidianEval`, `chunkSearch` | 依赖 PGlite 和 YOLO |
