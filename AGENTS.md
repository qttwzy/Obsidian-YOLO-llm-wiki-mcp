# AGENTS.md

本仓库是管理 LLM-Wiki 知识库的 MCP 服务器。直接依赖只有 `@modelcontextprotocol/sdk` 与 `@electric-sql/pglite`。Embedding 由 YOLO 配置，本仓不保存 Embedding provider 的 API key。Node.js CommonJS，无构建步骤。

## 硬规则

- 入口只有 `server.js`。工具无会话内状态：每次从磁盘读、写回。
- `VAULT_ROOT` 解析顺序：环境变量（绝对路径）→ 从 cwd 向上找 `.obsidian/` → 相对 `lib/config.js` 上两级的旧回退。
- `ingest_source` 只接受声明收件箱内的普通源文件，兼容 `/` 与 `\`。后续本地步骤失败时补偿恢复新页面、索引和日志；这不是跨进程事务或崩溃恢复日志。
- 函数向调用方返回 `{ error: "message" }`，不抛出。
- 路径统一成 `/`；用 `execFileSync` 加参数数组，不用带 shell 字符串的 `execSync`。
- 用 `assertInsideVault` 防止目录穿越。
- 不新增除 MCP SDK 与 PGlite 以外的运行时依赖。
- PGlite 写入只在可丢弃 vault 上验证，不在用户生产 vault 上做破坏性操作。

## 检索

1. 读本文件。
2. 用户向说明读 `README.md` 中文半边。
3. 改代码先看对应 `lib/` 或 `tools/` 文件；`CLAUDE.md` 只指向本文件。
4. 测试边界读 `docs/testing-limitations.md`。贡献约定读 `CONTRIBUTING.md`。

## 验证

```bash
npm test
```

只读 YOLO 回归需要本机 Obsidian + YOLO，并设置 `VAULT_ROOT`、`OBSIDIAN_CLI_PATH`。默认 `npm test` 在无活 vault 时会 skip 运行时用例。

## Issue 驱动开发

- 本仓对应 Plane 项目 `YOLO`，仓内 `#N` 即 `YOLO-N`。开工前必须有工作项编号；没有就先要，或用 `idd new` 建。
- 分支 `<type>/N-<slug>`；提交首行 Conventional Commits，trailer `Refs: #N`。完整规则见 personal-ops `policies/issue-driven-development.md`。
- 提交和 PR 里禁止 `closes/fixes/resolves #N`；完成状态按统一政策核验合入证据后回写。
- 完成后回报改动文件路径和提交号；未经允许不用 `--no-verify`，不直接提交到主干。

## 交付表述

最终元数据、交接和面向用户的文档、标题、提交说明、PR，必须从已接受的最终状态和权威 diff 推导，而不是从会话历史推导。被否方案和用户纠正只作为控制上下文，除非它们对应真实基线变化，或对安全、兼容、迁移、审计或必要说明有实质需要。当某概念只存在于本次工作会话时，不要用「无 X」「已移除 X」「非 X 版」或同类框架描述已接受结果。提交、发布或开 PR 时按全局 skill `no-negative-echo` 做完整门禁。
