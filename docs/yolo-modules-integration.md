# YOLO Modules 接入评估

> 核对日期：2026-08-09。YOLO Modules 仍在快速演进；实现前应以用户实际安装版本中的 Host API 为准。

## 结论

可以接入，但不适合把现有 MCP 服务器原样迁入 Module。

推荐把两种运行形态并存：

- 现有 Node stdio MCP 继续负责外部客户端、YOLO PGlite/Embedding 和完整工具集。
- YOLO Module 作为 Obsidian 内的轻量 UI/命令层，复用抽取后的纯文件逻辑，通过 `host.vault` 操作 Markdown 状态。
- 两者通过 vault 中的 Wiki、index、decision、graph 等文件共享状态，而不是让 Module 启动或回调一个 stdio MCP 进程。

本机已经在 macOS arm64 + YOLO 1.6.5 上完成现有 MCP 的只读 runtime 验证，包括状态、统计、记录读取和相似度查询。它证明的是 MCP 可以经 `obsidian eval` 适配 YOLO 私有对象，不代表 Module Host SDK 已公开 PGlite 或 Embedding 能力。

## 为什么不能直接迁移

当前项目依赖 Node 运行时：

- `server.js` 使用 stdio 暴露 MCP tools。
- `lib/pglite.js` 通过 `obsidian eval` 进入正在运行的 Obsidian，并在回退路径中使用 Node 版 PGlite。
- 文件层直接使用 `fs`、`path`、`child_process` 等 Node 能力。

YOLO Module 则在 Obsidian/browser host runtime 中加载，后台任务使用浏览器 Web Worker。公开 Host SDK 没有 Node `fs`、`child_process`、stdio MCP server、YOLO PGlite 或 Embedding provider 接口。因此以下代码不能直接搬入 Module：

- `server.js`
- `obsidian eval` 回跳
- Node PGlite/cache adapter
- 依赖 Node 文件系统的工具实现
- 对 `dbManager.pgClient` 等 YOLO 私有对象的直接访问

## 能力矩阵

| 能力 | 现有 MCP | YOLO Module | 建议 |
| --- | --- | --- | --- |
| 外部 MCP 客户端调用 | 支持 | Host SDK 未公开 stdio MCP server | 保留现有 MCP |
| YOLO PGlite / Embedding | 通过当前私有集成路径支持 | Host SDK 未公开稳定接口 | 暂留 MCP |
| Vault 文件读写 | Node `fs` | `host.vault` | 抽象 adapter |
| 并发文件更新 | 原子替换；无跨进程锁 | snapshot/CAS、`runExclusive` | Module 优先使用 Host API |
| View / ribbon / command / settings | 不适合 | 原生支持 | 放入 Module |
| slug、frontmatter、index、decision 变换 | 可用 | 可移植 | 抽取 portable core |
| 图算法与 lint 规则 | 可用 | 纯算法部分可移植 | 分离 I/O 后复用 |
| Worker 后台计算 | Node 进程 | Browser Web Worker | 仅运行浏览器兼容代码 |

## 推荐架构

```text
packages/core/
  slug + frontmatter + index transforms
  decision Markdown rules
  graph/lint pure algorithms

adapters/node-mcp/
  Node fs
  stdio MCP
  obsidian eval
  PGlite/cache

modules/llm-wiki/
  host.vault adapter
  view / ribbon / commands / settings
  optional worker for browser-compatible analysis
```

第一版 Module 可以提供：

1. Wiki 状态面板：页面数量、待决事项、孤立页面、最近 ingest。
2. Ribbon 和命令：打开 index/decisions、运行纯文件 lint、创建或更新确定性的 Markdown 状态。
3. 设置页：Wiki 根目录、显示选项和只读/写入开关。
4. 对会修改文件的操作使用 Host SDK 的 snapshot/CAS 与 `runExclusive`。

第一版不要在 Module 内：

- 启动 MCP server。
- 使用 Node `fs`、`child_process` 或 Node PGlite。
- 通过 `obsidian eval` 回跳当前 Obsidian。
- 直接绑定 YOLO 私有 PGlite/Embedding 对象。
- 假设 Module 与 MCP 的文件写入已经具备跨进程事务或统一锁。

## 官方接口和分发限制

截至核对日期：

- [`modules/host-sdk.d.ts`](https://github.com/Lapis0x0/obsidian-yolo/blob/main/modules/host-sdk.d.ts) 声明的 Host API 版本为 `1.4.0`。
- [`src/core/modules/types.ts`](https://github.com/Lapis0x0/obsidian-yolo/blob/main/src/core/modules/types.ts) 中运行时 Host API 常量为 `1.5.0`。
- 官方 [`learning/module.config.json`](https://github.com/Lapis0x0/obsidian-yolo/blob/main/modules/learning/module.config.json) 要求 `^1.5.0`。
- 官方 [`catalog-v1.json`](https://github.com/Lapis0x0/obsidian-yolo/blob/main/modules/catalog-v1.json) 当前只列出 `learning` 模块。
- [`moduleReleaseUrl.ts`](https://github.com/Lapis0x0/obsidian-yolo/blob/main/src/core/modules/moduleReleaseUrl.ts) 当前只允许 `Lapis0x0/obsidian-yolo` 的 GitHub Release 下载源。

这意味着公开类型声明、运行时和 bundled module 之间已经存在版本漂移。开发时不能只依据仓库里的单个 `.d.ts` 文件；需要针对用户安装的 YOLO release 做一次实际加载验证。

第三方分发目前也不是普通 Obsidian 插件式流程。现实选择是：

1. 向 YOLO 上游提交 first-party/catalog module。
2. Fork YOLO 并自行维护 allowlist/catalog。
3. 等待上游开放第三方 Module 发布源。

## 分阶段路线

### Phase 1：先稳定现有 MCP

- macOS + YOLO 1.6.5 的 live PGlite 只读测试已完成。
- 在 disposable vault 中验证 vector-store 创建、更新和删除。
- 固定兼容的 YOLO release 和 Host API 版本。
- 保持现有 Markdown 文件格式为两种运行时的共享协议。

### Phase 2：抽取 portable core

- 把纯字符串、Markdown 和图算法从 Node I/O 中拆出。
- 为 Node adapter 和 `host.vault` adapter 运行同一组 contract tests。
- 明确并发策略；Module 的 CAS 不能自动保护另一个 MCP 进程的 read-modify-write。

### Phase 3：实现轻量 Module

- 先做只读状态面板和导航命令。
- 再接入具备 snapshot/CAS 保护的确定性文件写入。
- PGlite/Embedding 保持在 MCP，直到 Host SDK 提供公开、稳定且有版本承诺的接口。

### Phase 4：处理发布

- 优先与 YOLO 上游确认 catalog 接纳方式。
- 未确认前，把 Module 视为开发原型，不承诺用户可从任意第三方 GitHub Release 直接安装。

## 验收条件

- 用户实际安装的 YOLO release 能加载 module，且 Host API 版本满足配置要求。
- Module 不导入 Node built-ins。
- 所有写入仅通过 `host.vault`，并覆盖并发冲突测试。
- MCP 与 Module 对同一 Markdown 状态格式运行 contract tests。
- live PGlite/Embedding 仍由 disposable vault 验证，不以被跳过的单元测试替代。
