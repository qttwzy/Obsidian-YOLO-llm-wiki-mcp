"use strict";

const fs = require("fs");
const path = require("path");
const { VAULT_ROOT } = require("../lib/config");

const KARPATHY_PAGE = `---
type: concept
domain: llm-wiki
status: mature
sources:
  - "https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f"
---

# LLM Wiki 设计模式

由 Andrej Karpathy 提出的个人知识库构建方法：**LLM 不只是在检索时从文档中"重新发现"知识，而是增量地构建和维护一个持久化的 Wiki**。

## 三层架构

| 层 | 说明 |
|------|------|
| **raw/** | 原始资料——精选的、只读的源文档。LLM 从中读取但不修改 |
| **wiki/** | LLM 生成的 Markdown 页面：摘要、实体页、概念页、对比、综合。LLM 全权维护 |
| **schema/** | 配置文件（如 CLAUDE.md），定义结构、约定和工作流 |

## 四个核心操作

### Discover
扫描收件箱，发现新的待处理资料。

### Ingest
将新资料录入 Wiki：读取源 → 讨论要点 → 写摘要 → 创建 wiki 页面 → 更新 index → 追加 log → 归档到 raw/。一篇资料可能触及 10-15 个 wiki 页面。

### Query
针对 Wiki 提问。LLM 搜索相关页面，阅读后综合回答并附引用。有价值的回答可归档回 Wiki 作为新页面。

### Lint
定期健康检查：查找页面矛盾、过时信息、孤立页面、缺失交叉引用、数据空白。

## 关键原则

- **Wiki 是持久化、复合增长的产物**：交叉引用已存在、矛盾已标注、综合已反映所有已读内容
- **LLM 处理所有书写、交叉引用、归档**，人类只负责策展来源、指导分析、提问
- **index.md** 是内容目录，LLM 查询时先读它再深入页面。在中等规模（~100 源，~数百页）下运作良好
- **log.md** 是追加式操作日志，统一前缀可被简单工具解析
- **整个 Wiki 就是一个 Markdown 文件的 Git 仓库**——版本历史、分支、协作
- **维护成本接近零**——人类因维护负担放弃知识库，LLM 不会

## 信息来源

- Karpathy, Andrej. "llm-wiki.md." GitHub Gist. https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
`;

const ENTITY_TEMPLATE = `---
type: entity
category: # tool | person | organization | project | other
status: stub
sources: []
related: []
concepts: []
---

# {{TITLE}}

## 概述

## 核心内容

## 信息来源
`;

const CONCEPT_TEMPLATE = `---
type: concept
domain: # research-method | ai-concept | tool-usage | other
status: stub
sources: []
related_concepts: []
related_entities: []
---

# {{TITLE}}

## 定义

## 核心内容

## 信息来源
`;

const SYNTHESIS_TEMPLATE = `---
type: synthesis
subtype: # comparison | review | argument
status: draft
covers: []
sources: []
---

# {{TITLE}}

## 概述

## 分析

## 结论
`;

const DECISIONS_SKELETON = `---
type: log
---

# 决策日志

## 待决 (pending)

_(当前无待决条目)_

## 已决 (resolved)

_(当前无已决条目)_
`;

/**
 * Initialize the LLM-Wiki structure in a vault.
 * Idempotent: skips files/dirs that already exist.
 * @param {string} vaultRoot
 * @returns {{ status: string, created: string[], skipped: string[] }}
 */
function initWiki(vaultRoot) {
  const root = vaultRoot || VAULT_ROOT;
  const created = [];
  const skipped = [];
  const trackerDir = path.join(root, ".source-tracker");

  function mkdir(p) {
    if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); created.push(p); }
    else { skipped.push(p); }
  }

  function writeFile(p, content) {
    if (!fs.existsSync(p)) { fs.writeFileSync(p, content, "utf-8"); created.push(p); }
    else { skipped.push(p); }
  }

  // Directories
  mkdir(path.join(root, "wiki"));
  mkdir(path.join(root, "wiki", "entities"));
  mkdir(path.join(root, "wiki", "concepts"));
  mkdir(path.join(root, "wiki", "synthesis"));
  mkdir(path.join(root, "wiki", "templates"));
  mkdir(path.join(root, "raw"));
  mkdir(trackerDir);

  // Karpathy article
  writeFile(path.join(root, "wiki", "concepts", "LLM Wiki 设计模式.md"), KARPATHY_PAGE);

  // Templates
  writeFile(path.join(root, "wiki", "templates", "entity-template.md"), ENTITY_TEMPLATE);
  writeFile(path.join(root, "wiki", "templates", "concept-template.md"), CONCEPT_TEMPLATE);
  writeFile(path.join(root, "wiki", "templates", "synthesis-template.md"), SYNTHESIS_TEMPLATE);

  // index.md
  writeFile(path.join(root, "index.md"), `---
type: index
updated: ${new Date().toISOString().slice(0, 10)}
---

# Wiki 索引

## 概念 (concepts/) — 1 页

| 页面 | 摘要 | 状态 |
|------|------|------|
| [[concepts/LLM Wiki 设计模式]] | Karpathy 提出的 LLM 驱动的三层知识管理架构 | mature |

## 实体 (entities/) — 0 页

| 页面 | 摘要 | 状态 |
|------|------|------|
| _(暂无)_ |

## 综合 (synthesis/) — 0 页

| 页面 | 摘要 | 状态 |
|------|------|------|
| _(暂无)_ |
`);

  // log.md
  const today = new Date().toISOString().slice(0, 10);
  writeFile(path.join(root, "wiki", "log.md"), `---
type: log
created: ${today}
---

# 操作日志

按时间顺序记录所有 ingest、query 归档和 lint 操作。

## [${today}] init | LLM-Wiki 项目初始化

创建三层架构，含 Karpathy LLM Wiki 设计模式页面。
`);

  // decisions.md
  writeFile(path.join(root, "wiki", "decisions.md"), DECISIONS_SKELETON);

  return {
    status: "ok",
    totalCreated: created.length,
    totalSkipped: skipped.length,
    created,
    skipped,
    hint: "Wiki 骨架已就绪。使用 set_inbox_folders 配置收件箱目录，然后用 discover_sources 扫描待处理文件。",
  };
}

module.exports = { initWiki };
