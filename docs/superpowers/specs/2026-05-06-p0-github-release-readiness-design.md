# P0: GitHub 公开发布准备 — 设计文档

**日期**: 2026-05-06
**状态**: approved

## 背景

项目质量评估发现三项必须在 GitHub 公开发布前完成的改进：

1. 零测试覆盖率 → 添加核心纯函数单元测试
2. 无 CI/CD → 添加 GitHub Actions 配置
3. SQL 向量拼接存在理论安全风险 → 添加向量校验门

## 设计决策

遵循项目既有理念：**零新增外部依赖**、务实优先。

## 1. 测试 (`tests/test-core.js`)

**框架**: Node.js 内置 `node:test` + `node:assert`
**组织**: 单文件，按模块分 describe 块

### 覆盖范围

| 模块 | 函数 | 用例数 |
|------|------|--------|
| `lib/embed.js` | `cosineSimilarity` | 4 |
| `lib/relevance.js` | `hubPenalty`, `rarityBonus`, `reinforcementBonus` | 7 |
| `lib/config.js` | `assertInsideVault`, `resolveVaultRoot`, `resolveVaultInfo` | 7 |
| `lib/pglite.js` | `jsStr`, `vaultName` | 4 |
| `tools/yolo-crud.js` | `contentHash` | 2 |
| **总计** | | **24** |

### 不覆盖

- `embedTexts` / `validateConfig` — 需要网络/API key
- `tryObsidianEval` / `createEmbedding` 等 — 需要 Obsidian 运行中
- 文件 IO 函数 — 留给 P1 集成测试

### package.json 变更

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test tests/"
}
```

## 2. CI 配置 (`.github/workflows/ci.yml`)

**触发**: push + pull_request 到 master/main
**矩阵**: 3 OS × 3 Node = 9 组合
- OS: ubuntu-latest, windows-latest, macos-latest
- Node: 18, 20, 22

**步骤**: checkout → setup-node → npm ci → npm test

## 3. SQL 向量校验 (`lib/pglite.js`)

新增 `assertValidVector(vec)` 函数：
- 验证 `Array.isArray` 且非空
- 验证每个元素为 `typeof === "number"` 且 `isFinite`

在以下 4 处拼接前调用：
- `tryObsidianEval` (L279)
- `createEmbedding` (L107)
- `updateEmbedding` (L207)
- `tryCacheQuery` (L331)

不改变拼接方式，不引入参数化查询依赖。
