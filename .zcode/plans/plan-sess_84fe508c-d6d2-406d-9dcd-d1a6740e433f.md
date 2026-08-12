# 修复计划：审计报告 P0 + P1 + 低成本 P2

## 独立复核结论

我已逐条对照源码复核审计文档，确认 3 个 P0、相关 P1、2 个 P2 均属实。独立判断调整如下：

- **不盲从审计**：审计建议"删除旧已决块或标记 superseded"，我选**标记 `⚠️ 已废止`**（保留历史，不丢数据）。
- **跳过 P3 冗余清理**（`walkWiki` 包装、`store.js` 合并）——低价值、高 churn，本轮不做。
- **SQL 降级 P1 我认同**：独立确认无可利用注入路径（`assertValidVector` + 向量非用户输入 + limit 硬编码 20），但仍参数化以防御回归。
- **新增审计未提的防御**：`finalizeCorrection` 完成后 `parseDecisions` 需能识别 `已废止` 块并从 resolved 计数排除，否则标记了仍会被 `find` 命中。

## 分批提交（6 个 commit）

### Commit 1 — P0: decisions 数据完整性（ID 碰撞 + 重复块 + finalize_correction + 解析容错）

**`tools/decisions.js`**：
1. **`createDecision` ID 碰撞修复**（line 130）：把 `DEC-${pending.length+1}` 改为扫描 pending+resolved 全部已有 ID，取 `max(数字)+1`；对自动生成的 ID 也做去重检查。
2. **`correctDecision` 重复块修复**（line 214-240）：插入 `🔄 修正中` 块前，先把同 id 的旧已决块 header 从 `### DEC-XXX | ✅ date` 改为 `### DEC-XXX | ⚠️ 已废止 (date)`，保留历史不删除。
3. **新增 `finalizeCorrection({ id, option, customText, vaultRoot })`**：定位 resolved 区的 `🔄 修正中` 块，勾选 option/customText，把 header 改为 `✅ date`（完成修正闭环）。导出该函数。
4. **`parseDecisions` 容错**（line 28-50）：header 不匹配时不再静默返回空数组——若 raw 非空但两个 section 都没匹配到，抛 `Error`（被 safeHandler 捕获）。同时在 resolved 过滤时跳过 `已废止` 块（不纳入 resolvedCount，避免重复计数），但保留在数组中供历史查看（标记 `isSuperseded: true`）。`parseBlock` 增加 `isSuperseded` 字段。
5. **`resolveDecision` 按块边界定位**（line 185）：`raw.replace(dec.raw, "")` 改为按 `### DEC-` 块边界定位删除，避免 CRLF/子串误删。

**`server.js`**：
6. 注册 `finalize_correction` 工具：import `finalizeCorrection`、加 ListToolsRequestSchema 条目（schema: id 必填 + option/customText 二选一 + vault）、加 switch case。

**`tests/test-decisions.test.js`**：
7. 新增测试：ID 碰撞场景（resolve 一条后新建不碰撞）、correctDecision 不产生重复已决块（旧块标记已废止）、finalizeCorrection 闭环、parseDecisions 容错（坏 header 抛错）、已废止块不计入 resolvedCount。

### Commit 2 — P0: ingest_source 原子性 + EXDEV

**`tools/ingest.js`**：
8. `archiveSource`（line 94）：`renameSync` 加 `try/catch EXDEV` fallback——跨设备时 copy+unlink。
9. `ingestSource` 文档修正（line 99-101）：注释/描述去掉 "Atomic"，改为 "best-effort four-step；中间失败保留已完成步骤"。`server.js:296` 工具描述同步修改。
10. `ingestSource` slug 加固（line 124）：strip 后若为空或纯分隔符，fallback 到 `untitled-${Date.now()}`。

**`tests/test-ingest.test.js`**：
11. 新增测试：slug 纯空格/全分隔符 fallback；EXDEV fallback（mock 不便，改测 copy+unlink 逻辑函数化——把 rename 逻辑抽成可测的 helper，或测 slug fallback 为主）。

### Commit 3 — P1: SQL 参数化 + tryObsidianEval 复用

**`lib/pglite.js`**：
12. `tryCacheQuery`（line 357-368）：`vecStr` + `LIMIT` 改参数化查询（`$1::vector` + `$2`）。
13. `tryObsidianEval`（line 297-343）：复用 `obsidianEval(code, vault)` 替代手写 `execFileSync` + 输出解析；SQL 部分保持字符串拼接（Obsidian pg.query 参数化需改远端代码生成方式，保留 assertValidVector 兜底，加注释说明）。
14. `createEmbedding`/`updateEmbedding`（line 134/235）：`vecStr` 从 `join(",")` 改为 `JSON.stringify(entry.embedding)`，消除 JS 字面量风险。

### Commit 4 — P1: resolveVaultRoot 抛错 + 版本号统一

**`lib/config.js`**：
15. `resolveVaultRoot`（line 101-102）：最后 fallback 改为 `throw new Error(\`Unknown vault: ${vault}\`)`。确认 safeHandler 捕获；search.js:112 加 try/catch 防御（直接调用场景）。

**版本号**：
16. `package.json` version → `3.1.0`；`server.js:56` → `3.1.0`；`CHANGELOG.md` 新增 `3.1.0` 条目记录本轮所有修复。

### Commit 5 — P2: 性能修复（graph edge Set 索引 + structuralInsights O(n²)）

**`tools/graph.js`**（line 180-202）：
17. `handleUpdateGraph`：用 `Set` 存 edge key 替代 `graph.edges.some()` O(edges) 查找。

**`tools/lint.js`**（line 173-180）：
18. `structuralInsights`：outLink 解析改用 `getResolvedOutLinks`，不重新线性匹配 title。

### Commit 6 — 文档：更新审计报告修正记录

**`docs/audit-2026-07-25.md`**：
19. 追加"第四轮修正（修复落地，2026-08-06）"记录：逐条标注已修复项、修复方式、对应 commit。

## 验证

每个 commit 后跑 `npm test`（lint + 98→新增测试）。全部完成后确认 `npm test` 全绿、git 状态干净。