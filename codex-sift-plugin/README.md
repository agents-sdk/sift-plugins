# Sift for Codex

面向 Codex CLI 与 Codex App 的 Sift 适配器。它使用正式的 Codex 插件包、`PostToolUse` / `SessionStart` hooks 和本地 MCP server，不修改 Codex 源码。

## 工作方式

1. `PostToolUse` 收到本地工具的结构化结果；失败、宿主已标记截断、过短和排除工具直接透传。
2. Sift 压缩其中的大字符串。若压缩有损，原文写入插件私有数据目录的 session stash，并在结果中保留 `<<stash:KEY>>`。
3. hook 返回 `continue: false` 和压缩后的 `stopReason`。这是 Codex 0.145.0 官方支持的“用 hook feedback 替换原工具结果”路径；副作用已经发生，不会被撤销。
4. 每次成功压缩向 `savings.ndjson` 追加一条事件，并按 `session_id + tool_use_id` 去重统计。
5. MCP server 暴露 `sift_retrieve` 和 `sift_stats`。

插件采用 portable Agent Plugins 1.0 的根 `plugin.json + mcp.json`，并为 Codex 0.145.x 保留 `.codex-plugin/plugin.json + .mcp.json` 兼容入口。0.145.x 不会为兼容 MCP 展开插件变量或注入 `PLUGIN_DATA`，所以两代入口都统一使用 `~/.codex/sift`（可通过 `CODEX_SIFT_DATA` 覆盖），确保 hook、stash、统计工具看到同一份数据。

仅本地 function tools、Bash / unified exec、`apply_patch` 和 MCP tools 经过 Codex hooks；托管的 WebSearch 等工具不经过该路径。代码模式下 `continue: false` 会把压缩 feedback 作为结果交给脚本且不会 reject；`decision: block` 没有被采用，因为它会让嵌套 tool promise reject。

## 安装

```bash
codex plugin marketplace add agents-sdk/sift-plugins
codex plugin add codex-sift-plugin@agent-context
```

marketplace 条目使用 Codex 原生 npm source，从 npm registry 获取 `@agent-context/codex-sift`。可用 `codex plugin list` 检查安装状态。

升级 marketplace 和插件时运行 `codex plugin marketplace upgrade agent-context`，再重新执行 `codex plugin add codex-sift-plugin@agent-context`。现有会话不会热加载新 manifest，建议新开会话验证。

## 配置

配置通过启动 Codex 的环境变量传给 hook 与 MCP server：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SIFT_ENABLED` | `1` | 设为 `0` / `false` / `off` 禁用 |
| `SIFT_MIN_LENGTH` | `200` | 候选字符串的最小 UTF-8 字节数；核心库仍可能透传短内容 |
| `SIFT_EXCLUDED_TOOLS` | 空 | 逗号分隔的 Codex canonical tool names，例如 `Bash,apply_patch` |
| `SIFT_SHOW_STATUS` | `1` | 成功压缩时通过 hook `systemMessage` 显示会话累计 saved tokens；设为 `0` 静默 |
| `CODEX_SIFT_DATA` | `~/.codex/sift` | hook、MCP 和非插件运行共享的数据目录 |

stash 为明文、目录权限尽量设为 `0700`，文件在 30 分钟后由后续 SessionStart / MCP 启动清理。为兼容 0.145.x，它不使用版本化的 `PLUGIN_DATA`；不要压缩不愿落盘的机密输出。

## UI 结论

Codex 0.145.0 的 stock TUI/App 没有类似 OpenCode `tui.tsx` 的第三方 slot/component API，也不能由插件注册新的 `tui.status_line` item。当前最接近的公开路径是：

- hook 的 `systemMessage`：压缩成功后显示 `Sift saved X tokens in this session`，但属于提示/警告，不是常驻 sidebar/footer；
- `sift_stats` MCP tool：按需显示准确累计值和压缩调用数；
- MCP App UI：只跟随 MCP tool result 展示交互组件，不是 stock Codex shell 的常驻状态栏；
- `codex app-server`：能让自建客户端消费 thread/item/token events并渲染常驻面板，但不能向官方 Codex App/TUI 注入组件。

因此本实现没有 fork Codex TUI。若一定需要与 OpenCode 完全相同的常驻栏，需维护 Codex Rust TUI fork，或基于 app-server 写自定义客户端。

## 测试

```bash
npm test
npm run build
npm run typecheck
```

插件 manifest 另用 Codex 自带 `plugin-creator` 校验器验证。
