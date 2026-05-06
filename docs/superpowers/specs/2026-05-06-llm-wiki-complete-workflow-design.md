# LLM-Wiki 完整工作流 — 设计文档

**日期**: 2026-05-06
**状态**: approved

## 背景

当前 MCP 提供 Query（search_wiki）和 Lint（lint_full），缺少 LLM-Wiki 四大操作中的 Discover 和 Ingest。新增 4 个工具补全闭环，同时实现开箱即用。

## 设计

### 1. `init_wiki`

创建 LLM-Wiki 骨架结构，幂等（已初始化则跳过）。

**行为**：
- 创建 `wiki/`、`wiki/entities/`、`wiki/concepts/`、`wiki/synthesis/`、`wiki/templates/`、`raw/`、`.source-tracker/`
- 写入 Karpathy LLM-Wiki 原文到 `wiki/concepts/LLM Wiki 设计模式.md`
- 写入 3 个页面模板到 `wiki/templates/`（entity/concept/synthesis）
- 写入 `index.md` 骨架（含三类表头 + LLM Wiki 设计模式条目）
- 写入 `wiki/log.md` 首条 init 记录
- 写入 `wiki/decisions.md` 骨架
- 返回 inbox 配置提示，引导用户调用 `set_inbox_folders`

**输入**: `{ vault?: string }`
**输出**: `{ status, details: { created: string[], skipped: string[] } }`

### 2. `set_inbox_folders`

管理收件箱目录列表。存储于 `.source-tracker/inbox-config.json`。

**action=set**: 覆盖设置
**action=add**: 追加一个目录
**action=remove**: 移除一个目录
**action=list**: 仅列出当前配置

**输入**: `{ action: "set"|"add"|"remove"|"list", paths?: string[], vault?: string }`
**输出**: `{ inboxFolders: string[] }`

### 3. `discover_sources`

扫描所有 inbox 目录，与 `raw/` 比对。

**行为**：
- 读取 inbox 配置（未配置时返回错误提示）
- 遍历每个 inbox 目录中的文件
- 检查 `raw/{inboxName}/{filename}` 是否存在（已归档则跳过）
- 返回未处理文件列表

**输入**: `{ vault?: string }`
**输出**: `{ newFiles: [{ path, inbox, size, mtime }], totalNew: number }`

### 4. `ingest_source`

原子执行四步文件操作。

**行为**：
1. 创建 wiki 页面（`wiki/{type}s/{slug}.md`），含完整 frontmatter
2. 更新 `index.md`，在对应分类表追加一行
3. 追加 `wiki/log.md` 记录
4. 移动源文件到 `raw/{inbox}/{filename}`

四步顺序执行，任一步失败时已执行步骤可回滚。

**输入**:
```
{
  sourceFile: string,    // 源文件路径
  inbox: string,         // 来源 inbox 名称
  type: "entity"|"concept"|"synthesis",
  title: string,
  content: string,       // 完整 Markdown（含 frontmatter）
  summary: string,       // 用于 index 的一行摘要
  related: string[],     // wikilink 列表
  vault?: string
}
```

**输出**: `{ status, page: string, indexUpdated: boolean, archived: string, logEntry: string }`

## 备选方案

仅用 `discover_sources` 提示 agent，agent 通过已有 `Bash` 工具手动执行文件操作。问题：每个 agent 每次都要重新实现，出错率高。统一封装为 MCP 工具保证一致性。

## Karpathy 原文

`init_wiki` 嵌入的 LLM Wiki 设计模式页面内容来源于 https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f，作为知识库的基础方法论文档。

## 测试

新增 ~15 测试覆盖：
- `discover_sources`：空 inbox、有文件、部分已归档、无配置
- `ingest_source`：成功路径、源文件不存在、重复 page id
- `set_inbox_folders`：set/add/remove/list
- `init_wiki`：幂等性
