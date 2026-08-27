# 贡献指南

感谢你愿意参与贡献。

## 开始

```bash
git clone <repo-url>
cd Obsidian-YOLO-llm-wiki-mcp
npm install
```

## 运行测试

```bash
npm test        # lint + 单元测试
npm run lint    # 仅 ESLint
node --test     # 仅单元测试
```

## 项目结构

```
server.js           # MCP 服务器入口
lib/                # 核心库（无会话状态）
  config.js         # Vault 发现与路径校验
  embed.js          # 余弦相似度辅助
  fs-utils.js       # 整文件原子替换辅助
  graph.js          # Wiki 图构建
  page-store.js     # 页面向量存储
  pglite.js         # YOLO PGlite 集成
  relevance.js      # 4-signal 边权重
  resolver.js       # Wikilink 解析
tools/              # MCP 工具处理（薄封装）
  search.js         # 三通道搜索
  lint.js           # 双引擎 Lint
  store.js          # 页面向量存储管理
  decisions.js      # 决策日志增删改查
  graph.js          # Wiki 图构建/更新
  yolo-crud.js      # YOLO PGlite CRUD
  init-wiki.js      # LLM-Wiki 骨架初始化
  discover.js       # 收件箱配置与源发现
  ingest.js         # 源文件录入
tests/              # Node 测试套件；运行时集成在不可用时 skip
```

## 编码约定

- 每个文件顶部 `"use strict"`
- CommonJS（`require` / `module.exports`）
- 函数返回 `{ error: "message" }`，不抛出
- 运行时依赖仅限 MCP SDK 与 PGlite
- 路径使用 `/` 分隔符（用 `.replace(/\\/g, "/")` 规范化）
- 使用带参数数组的 `execFileSync`，不用带 shell 字符串的 `execSync`

## Pull request 清单

- [ ] 测试通过（`npm test`）
- [ ] 未新增外部依赖（除非经过讨论）
- [ ] 如适用，已提升 `package.json` 版本
- [ ] 面向用户的变更已更新 README
