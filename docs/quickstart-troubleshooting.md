# Quick-Start Troubleshooting Guide

从零到成功使用的完整排查清单。

---

## 阶段 0：安装前准备

### 0.1 Node.js 版本不足

| 现象                   | 原因           | 解决                                   |
| -------------------- | ------------ | ------------------------------------ |
| `npm install` 报版本不兼容 | Node.js < 18 | `node --version` 确认版本，安装 Node.js ≥18 |

```bash
# 检查版本
node --version   # 必须 >= 18.0.0
```

### 0.2 npm 镜像问题

| 现象                    | 原因                  | 解决            |
| --------------------- | ------------------- | ------------- |
| `npm install` 超时或 404 | 镜像源不可用（如 npmmirror） | 切回官方 registry |

```bash
npm config set registry https://registry.npmjs.org/
# 或临时使用
npm install --registry https://registry.npmjs.org/
```

### 0.3 权限问题

| 现象                 | 原因          | 解决                             |
| ------------------ | ----------- | ------------------------------ |
| `EACCES` / `EPERM` | 全局安装目录无写入权限 | 不要用 `-g`；如需全局安装加 `sudo` 或用 nvm |

### 0.4 Obsidian CLI 未安装

| 现象                                                            | 原因                       | 解决                      |
| ------------------------------------------------------------- | ------------------------ | ----------------------- |
| `build_page_store` 正常但 `query_pglite_status` 返回 `unavailable` | Obsidian CLI 未安装或不在 PATH | 在 Obsidian 设置中启用 CLI 支持 |

```bash
# 验证 CLI 可用
which obsidian        # macOS/Linux
where obsidian        # Windows
# 应返回 obsidian 可执行文件路径
```

> **注意**：PGlite 相关工具（`query_pglite_status`、`update_pglite_embedding`）需要 Obsidian 运行中 + YOLO 插件已加载。搜索和 Lint 不依赖 Obsidian。

### 0.5 YOLO 插件

| 现象                                   | 原因             | 解决                        |
| ------------------------------------ | -------------- | ------------------------- |
| PGlite 工具返回 "YOLO plugin not loaded" | YOLO 插件未安装或未启用 | 在 Obsidian 社区插件中安装 `YOLO` |

---

## 阶段 1：安装

### 1.1 标准安装

```bash
git clone <repo-url>
cd Obsidian-YOLO-llm-wiki-mcp
npm install
```

### 1.2 node_modules 损坏

| 现象                                               | 原因                       | 解决   |
| ------------------------------------------------ | ------------------------ | ---- |
| `Cannot find module '@modelcontextprotocol/sdk'` | 依赖未安装或 `node_modules` 损坏 | 删掉重装 |

```bash
rm -rf node_modules package-lock.json
npm install
```

### 1.3 网络代理问题

| 现象                                        | 原因        | 解决     |
| ----------------------------------------- | --------- | ------ |
| `npm install` 报 `ECONNREFUSED` 或 proxy 错误 | HTTP 代理干扰 | 清除代理设置 |

```bash
npm config delete proxy
npm config delete https-proxy
```

---

## 阶段 2：配置

### 2.1 MCP 客户端配置

项目需要在你的 MCP 客户端（Claude Code、Claude Desktop、Cursor 等）中注册。

#### Claude Code（`.claude/mcp.json`）

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["D:/Obsidian/AI/mcp/server.js"],
      "env": {
        "VAULT_ROOT": "D:/Obsidian/AI",
        "EMBED_API_URL": "https://api.siliconflow.cn/v1",
        "EMBED_API_KEY": "sk-xxxxxxxxxxxxxxxx",
        "EMBED_MODEL": "Qwen/Qwen3-Embedding-8B"
      }
    }
  }
}
```

#### Claude Desktop（Windows）

文件路径：`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["D:/Obsidian/AI/mcp/server.js"],
      "env": {
        "VAULT_ROOT": "D:/Obsidian/AI",
        "EMBED_API_URL": "https://api.siliconflow.cn/v1",
        "EMBED_API_KEY": "sk-xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### 2.2 常见配置错误

| 错误                        | 原因          | 排查                                                           |
| ------------------------- | ----------- | ------------------------------------------------------------ |
| server.js 路径错误            | `args` 路径写错 | 用绝对路径，不要用 `~` 或相对路径                                          |
| `JSON` 格式错误               | 多了一个逗号或注释   | JSON 不支持尾随逗号和 `//` 注释。用 `jq` 或在线工具验证                         |
| 配置不生效                     | 文件路径不对      | Claude Code: `.claude/mcp.json`（项目根目录）；Claude Desktop: 见上方路径 |
| MCP 工具列表看不到 `search_wiki` | 服务器未启动或崩溃   | 检查 MCP 日志（Claude Code: `.claude/logs/`）                      |

### 2.3 环境变量常见问题

| 错误信息                              | 原因                  | 解决                                           |
| --------------------------------- | ------------------- | -------------------------------------------- |
| `EMBED_API_URL is not configured` | 未设置 `EMBED_API_URL` | 在 MCP 配置的 `env` 块中添加                         |
| `EMBED_API_KEY is not configured` | 未设置 `EMBED_API_KEY` | 同上                                           |
| `Embedding API error 401`         | API Key 无效          | 检查 Key 是否正确、是否过期                             |
| `Embedding API error 404`         | URL 路径不对            | URL 应以 `/v1` 结尾（不含 `/embeddings`，代码会自动追加）    |
| `Embedding API network error`     | 网络不通                | 检查防火墙/代理；`curl $EMBED_API_URL/models` 测试连通性  |
| `Embedding API parse error`       | API 返回非预期格式         | 确认 Embedding 服务兼容 OpenAI `/v1/embeddings` 格式 |

### 2.4 VAULT_ROOT 相关

| 错误信息                       | 原因                                   | 解决                                                   |
| -------------------------- | ------------------------------------ | ---------------------------------------------------- |
| 所有工具返回空结果                  | `VAULT_ROOT` 指向不是 Obsidian vault 的目录 | 确认目标目录包含 `.obsidian/` 子目录                            |
| `File not found: wiki/xxx` | vault 中没有 `wiki/` 目录                 | 确认 vault 是按 LLM-Wiki 模式组织的（有 `wiki/` 和 `index.md`）   |
| Windows 路径问题               | 反斜杠转义                                | MCP JSON 中用 `D:/Obsidian/AI`（正斜杠）而非 `D:\Obsidian\AI` |

---

## 阶段 3：首次使用验证

### 3.1 核心工具验证

按顺序逐一测试，确认每个功能正常。

#### 步骤 1：搜索

```
→ search_wiki { "query": "你的测试问题" }
```

| 现象                                                | 排查                                             |
| ------------------------------------------------- | ---------------------------------------------- |
| 工具不在列表中                                           | 服务器未启动。检查 MCP 日志，确认 `server.js` 路径和 Node.js 可用 |
| 返回 `{ "results": [], "sources": [], "count": 0 }` | 正常（没有匹配页面时），尝试其他关键词                            |
| 返回 error 消息                                       | 根据具体 error 对照上方 2.3 节                          |
| 响应慢（>5秒）                                          | Embedding API 首次调用需加载模型，后续会快                   |

#### 步骤 2：构建图

```
→ build_wiki_graph {}
```

| 现象           | 排查                         |
| ------------ | -------------------------- |
| 返回 pages > 0 | 成功                         |
| 返回 pages = 0 | vault 的 `wiki/` 目录无 .md 文件 |
| 返回 error     | vault 目录结构不匹配              |

#### 步骤 3：运行 Lint

```
→ lint_full {}
```

| 现象                     | 排查                     |
| ---------------------- | ---------------------- |
| `Page store not built` | 先运行 `build_page_store` |
| `Graph not built`      | 先运行 `build_wiki_graph` |

#### 步骤 4：构建页面向量（需要 API）

```
→ build_page_store {}
```

| 现象            | 排查                        |
| ------------- | ------------------------- |
| 成功返回 pages 数量 | Embedding API 正常工作        |
| 慢（>30s）       | 正常——每个 wiki 页面需要一次 API 调用 |
| API error     | 检查 2.3 节环境变量配置            |

### 3.2 验证是否正常工作

运行测试确认一切就绪：

```bash
cd Obsidian-YOLO-llm-wiki-mcp
npm test
```

预期输出：`98 pass / 0 fail`（PGlite 测试在 Obsidian 未运行时会自动跳过）。

### 3.3 客户端无响应

| 现象                  | 排查                                                 |
| ------------------- | -------------------------------------------------- |
| 客户端没显示 MCP 工具       | 检查 MCP 客户端是否已重载配置（Claude Code 需 `/reload-mcp` 或重启） |
| 工具调用后无返回            | 服务器可能因未捕获异常退出。检查客户端 MCP 日志                         |
| `Unknown tool: xxx` | 服务器版本不支持该工具。升级到最新版                                 |

---

## 阶段 4：高级功能验证（可选）

### 4.1 PGlite 相关（需要 Obsidian 运行中 + YOLO 插件）

```
→ query_pglite_status {}
```

| 现象                                           | 排查                       |
| -------------------------------------------- | ------------------------ |
| `"available": false`                         | Obsidian 未运行或 YOLO 插件未加载 |
| `"available": true, "source": "pglite_live"` | 成功                       |

### 4.2 决策流程

```
→ create_decision { "situation": "测试", "options": [{"label":"A","action":"测试","consequence":"无"}] }
→ list_decisions {}
```

---

## 通用调试技巧

### 查看 MCP 日志

```bash
# Claude Code 日志位置
ls .claude/logs/
# 或直接在 Claude Code 中
/mcp-status
```

### 手动测试服务器

```bash
cd Obsidian-YOLO-llm-wiki-mcp
node -e "
  const { searchWiki } = require('./tools/search');
  searchWiki('测试', 'D:/Obsidian/AI').then(console.log);
"
```

### 验证环境变量

```bash
# 在运行 MCP 客户端的环境中
echo $EMBED_API_URL    # 应输出你的 API URL
echo $VAULT_ROOT        # 应输出你的 vault 路径
```

### 最简启动测试

```bash
# 仅测试模块能否加载（不连 MCP）
cd Obsidian-YOLO-llm-wiki-mcp
node -e "require('./lib/config'); require('./lib/embed'); console.log('OK: all modules loaded')"
```
