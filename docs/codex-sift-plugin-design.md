# Codex 扩展机制与 Sift 适配设计（2026-09-12）

## 结论摘要

截至 2026-09-12，Codex 已有正式插件机制。插件是可安装包，可组合 Skills、MCP server、可选 MCP UI 以及 lifecycle hooks；CLI 与 Codex App 在同一 host 上共享插件/MCP 配置。本实现使用 Agent Plugins 1.0 的根 `plugin.json + mcp.json`，并保留 Codex 0.145.x 的 `.codex-plugin/plugin.json + .mcp.json` 兼容入口。

仓库同时保留两份 marketplace catalog：`.agents/plugins/marketplace.json` 供 Codex/ChatGPT portable 插件加载，`.claude-plugin/marketplace.json` 供 Claude Code 和旧式兼容加载。

npm 包由仓库级 `.agents/plugins/marketplace.json` 以 Codex 原生 `source: "npm"` 引用，用户通过标准 marketplace 命令安装。

Sift 最合适的 stock-client 接入点是同步 `PostToolUse` hook：它能观察 Bash、unified exec、apply_patch、MCP 和多数本地 function tool，并通过 `continue: false + stopReason` 阻止原始结果进入下一次模型调用，改用压缩 feedback。托管工具不在 hook 覆盖范围内，PostToolUse 也不能撤销已经发生的副作用。

## 扩展点矩阵

| 扩展点 | 正式支持 | 对 Sift 的用途 | 边界 |
| --- | --- | --- | --- |
| Plugin package | 是 | 统一分发 skill、hook、MCP | 安装/启用后仍需单独信任非托管 hook |
| MCP | 是 | `sift_retrieve`、`sift_stats`，也可做显式压缩工具 | 普通 MCP 无法透明拦截其他工具；MCP UI 跟随 tool result |
| Skills | 是 | 告诉 Agent 何时取回和统计 | 只影响模型行为，不改写 tool output |
| Hooks | 是 | `PostToolUse` 自动压缩，`SessionStart` 注入取回约定 | 托管 tools 不覆盖；输出约 2500 tokens 后 Codex 会 spill |
| config.toml | 是 | 开关 hooks/MCP、TUI 内建选项、profiles | `tui.status_line` 只接受内建 identifier，无第三方注册协议 |
| exec wrapper | 可自行实现，非插件 API | 包装 `codex exec --json` 做外层日志/统计 | 无法透明改写 App 内部每个 tool result；hooks 已更直接 |
| app-server | 是，WebSocket transport 仍标 experimental | 自建完整 UI、消费 streamed events | 是“构建自己的客户端”，不是官方 App/TUI 的组件注入 API |
| stock TUI/App UI | 仅 MCP result UI 与 hook message | 显示瞬时 saved-tokens 提示 | 无 OpenCode TUI slot 等价物，无常驻自定义 sidebar/footer API |

## 数据流

```text
local tool result
  -> Codex PostToolUse
  -> skip? (error / truncated / short / excluded / self tool)
  -> Sift per-string compression
  -> optional plaintext stash under PLUGIN_DATA/stash/<session>
  -> append savings.ndjson event
  -> continue:false + compressed stopReason
  -> next model step sees compressed result

<<stash:KEY>> -> sift_retrieve MCP -> scan recent session stashes -> exact original
user asks savings -> sift_stats MCP -> deduplicated event total
```

## 与已有适配器的对应关系

- OpenCode `tool.execute.after` 能原地改写 output/metadata，并由 `tui.tsx` 注册 sidebar slot；Codex 没有这两个相同 API。
- Claude Code 适配器与 Codex 最接近：二者都有 PostToolUse 和 plugin root/data 环境变量。portable `mcp.json` 会展开 `PLUGIN_ROOT/DATA`；0.145.x 的兼容 MCP 不会，因此实现使用稳定的 `~/.codex/sift` 共享目录，而不是依赖版本化 `PLUGIN_DATA`。
- Pi 与 DSH 的 session stash、不压缩失败/截断结果、按需 retrieve 契约被保留。
- 统计改为 append-only NDJSON，并以 session/tool call 去重，适配 Codex 可并发运行多个匹配 hook 的行为。

## 安全与已知限制

- hook 异常时退出 0 且无 stdout，原结果透传（fail open）。
- 有损原文是本地明文，TTL 30 分钟；内容寻址 key 允许 MCP 在多个 session stash 中找到完全相同的原文。
- `systemMessage` 是 UI 提示，不是可占位的常驻组件，可用 `SIFT_SHOW_STATUS=0` 关闭。
- token savings 来自 Sift tokenizer 的 before/after 差值，是上下文节省估算，不等于 OpenAI 账单差额。
- 当前实现目标版本为本机验证过的 Codex CLI 0.145.0；hooks 的 output contract 在早期版本不可用。

## 验证记录

- 本机 Codex CLI 0.145.0：plugin 安装、hook manifest 解析、bundled MCP 路径解析通过。
- Node 测试 6/6：压缩替换、失败/排除透传、跨进程数据目录、manifest、MCP tools、统计去重。
- TypeScript build 与 typecheck 通过；portable `plugin.json` / `mcp.json` 通过 Agent Plugins 1.0 JSON Schema，兼容 manifest 通过 Codex plugin-creator validator。
- 真实 `codex exec`：Agent 成功调用 `sift_stats`；300 行重复日志被 PostToolUse 压缩并记录约 2.9k saved context tokens。测试统计随后已清除，不污染用户数据。

## 主要依据

- [OpenAI：Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [OpenAI：Codex hooks](https://developers.openai.com/codex/hooks)
- [OpenAI：Codex MCP](https://developers.openai.com/codex/extend/mcp)
- [OpenAI：Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI：Config reference](https://developers.openai.com/codex/config-file/config-reference)
- [OpenAI Codex 源码：portable MCP 的 PLUGIN_ROOT / PLUGIN_DATA 归一化](https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/agent_plugin_config.rs)
- [OpenAI Codex issue：旧式 `.mcp.json` 不展开插件根占位符](https://github.com/openai/codex/issues/19582)
