# `@agent-context/claude-code-sift`

Claude Code **插件**：用 [`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 自动压缩工具输出，并内置 `sift_retrieve` 工具（stdio MCP server）供模型取回原文。

本插件是社区项目，并非 Claude Code 或 Anthropic 官方项目，也未获得其官方背书。

这不是检索、记忆或 MCP 服务本身，也不会改写历史消息；它只处理新产生的工具输出。

要求：Claude Code ≥ 2.1，本机 `node` ≥ 18（hook 脚本与 MCP server 以 `node` 运行）。

## 安装

通过本仓库的 marketplace：

```
/plugin marketplace add agents-sdk/sift-plugins
/plugin install claude-code-sift@agent-context
```

也可以在任何 marketplace 里用 npm source 引用本包：

```json
{ "source": "npm", "package": "@agent-context/claude-code-sift" }
```

本地开发：`claude --plugin-dir ./claude-code-sift-plugin`（仓库内已提交 `dist/` 编译产物与 `npm-shrinkwrap.json`，Claude Code 安装时会执行 `npm ci --ignore-scripts` 拉取预编译的原生二进制，无需构建步骤）。

## 工作机制

| 组件 | 入口 | 职责 |
| --- | --- | --- |
| PostToolUse hook | `dist/hooks/post-tool-use.js` | 深遍历 `tool_response`，只替换字符串内容（Bash `stdout`、Read `file.content`、Grep `content`、文本块数组……），**对象形状保持不变**后经 `updatedToolOutput` 写回 |
| SessionStart hook | `dist/hooks/session-start.js` | 注入一段说明教模型使用 `<<stash:KEY>>` 与 `sift_retrieve`；顺带清理过期 stash |
| 内置 MCP server | `dist/mcp/server.js` | 提供 `sift_retrieve` 工具 |

`updatedToolOutput` 必须匹配工具的输出 schema，否则 Claude Code 会静默忽略改写——所以本插件采用「原位字符串替换、不增删不改类型任何字段」，也不往 `tool_response` 写压缩元数据。

MCP server 拿不到 session id，取回时按 mtime 新→旧扫描 stash 根下所有 session 目录；stash key 是内容寻址（BLAKE3 前 24 位十六进制），跨 session 命中即正确原文。

## 配置（环境变量）

写入 `settings.json` 的 `env` 块或 shell 环境：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SIFT_ENABLED` | `1` | `0` / `false` / `off` / `no` 停用 |
| `SIFT_MIN_LENGTH` | `200` | 最小 UTF-8 字节门槛；非法值回退 200 |
| `SIFT_EXCLUDED_TOOLS` | — | 逗号分隔的工具名；`sift_retrieve` 永远被排除 |
| `SIFT_DEBUG` | — | `1` 时向 stderr 输出压缩决策（配合 `claude --debug` 可见） |

## 压缩规则

以下情况跳过压缩，原文原样保留（与 Pi / OpenCode 适配器同一契约）：

- 工具在排除列表中（含任何名字里带 `sift_retrieve` 的工具，避免取回结果被再次压缩）
- 执行失败（失败走 `PostToolUseFailure`，不会进入本 hook）
- 宿主已截断：`truncated: true`、Grep `numLines === appliedLimit`、Read `file.numLines < file.totalLines`
- 文本短于 `minLength`，或已含合法 `<<stash:24-hex>>` 标记
- 压缩没有收益

用户主动的部分读取（`tool_input` 带 `offset` / `limit`）仍会压缩，只是不携带 `sourcePath`；宿主截断与用户部分读取靠 `tool_input` 区分。

## `sift_retrieve`

参数 `stashKey`（裸 key 或完整 `<<stash:KEY>>` 标记均可）。成功返回纯文本原文，失败返回 JSON `{ error, hint, stashKey }`——与 Pi / OpenCode 扩展同一契约。

非法 key（长度不对、非十六进制、路径穿越）会被直接拒绝。stash TTL（1800 秒）过期后重跑原工具，不要对 retrieve 死循环。

## Stash

| | |
| --- | --- |
| 位置 | `${CLAUDE_PLUGIN_DATA:-~/.claude}/stash/{sessionId}/` |
| 隔离 | 按 Claude Code `session_id` 建目录；取回时可跨 session 命中（内容寻址） |
| 权限 | `0700` |
| 清理 | TTL 1800 秒；SessionStart 时与 MCP server 每 5 分钟扫描 |

原文以**明文**落盘。把 stash 目录当作敏感数据。

宿主自身截断过的输出（如超长 Grep 命中）不会被恢复：这类结果直接跳过压缩，`sift_retrieve` 也无法还原被宿主丢掉的字节。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 插件未加载 | `/plugin` 查看安装状态；Claude Code ≥ 2.1；`node` ≥ 18 且在 PATH |
| 没有压缩 | `SIFT_ENABLED`；`minLength` 过大；内容本身不可压缩（核心库无收益即透传）；输出被宿主截断 |
| 改写疑似不生效 | Claude Code 版本更新可能改变 `tool_response` 形状——`SIFT_DEBUG=1` + `claude --debug` 收集实际形状并提 issue |
| `sift_retrieve` 不可见 | `/mcp` 查看 `sift` server 是否启动；`node dist/mcp/server.js` 手动跑一遍排查 |
| 取回失败 | 原文超过 30 分钟 TTL；重跑原工具 |
