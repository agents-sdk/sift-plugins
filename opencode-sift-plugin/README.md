# `@agent-context/opencode-sift`

OpenCode **插件**：用 [`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 自动压缩工具结果，并注册 `sift_retrieve` 供模型取回原文。TUI 会在右侧栏的 Context 下方显示累计节省的 token 数。

本插件是社区项目，并非 OpenCode 或 Anomaly 官方项目，也未获得其官方背书。

这不是检索、记忆或 MCP，也不会改写整包模型请求；它只处理工具输出。

要求 OpenCode `>=1.18.26 <2`。

## 安装

推荐使用 CLI 安装，它会自动注册包里的 server 和 TUI 两个入口：

```bash
opencode plugin @agent-context/opencode-sift
```

安装后重启 OpenCode TUI。使用 CLI 时无需手动创建或修改 `opencode.json` 和 `tui.json`。

### 手动安装（仅用于特殊场景）

无法使用 CLI 时，把 server 入口写入用户 / 全局 `~/.config/opencode/opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@agent-context/opencode-sift", { "minLength": 200 }]
  ]
}
```

并把 TUI 入口写入 `~/.config/opencode/tui.json`，这样右侧栏才会显示 token 统计：

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@agent-context/opencode-sift"]
}
```

项目级 server 配置放在项目根 `opencode.json`，TUI 配置放在 `.opencode/tui.json`。CLI 命令的别名是 `opencode plug`。

## 配置（plugin 元组 options）

| 字段 | 类型 | 默认 |
| --- | --- | --- |
| `enabled` | boolean | `true` |
| `minLength` | number | `200`（UTF-8 字节；非法值回退 200） |
| `excludedTools` | string[] | 始终与 `sift_retrieve` 做并集 |

`enabled: false` 后既不压缩，也不注册 `sift_retrieve`。

## TUI token 统计

包的 `./tui` entrypoint 会注册到可叠加的 `sidebar_content` slot，并排在内置 Context 与 MCP 区块之间。显示格式为 `Sift` / `1.2k tokens saved`。

统计值来自当前会话及其 subagent 子会话已完成工具结果里的 `siftTokensSaved` metadata，因此会随工具结果实时更新，也能在重新打开会话时从历史消息恢复；未被 Sift 压缩的工具结果不会计入。

## 压缩规则

以下情况跳过压缩，原文原样保留：

- 工具在排除列表中
- 执行失败，或输出已被 OpenCode 截断
- 文本短于 `minLength`
- 文本已含合法 `<<stash:24-hex>>` 标记
- 压缩没有收益

## `sift_retrieve`

参数为输出中的 `stashKey`，可以传入裸 key 或完整的 `<<stash:KEY>>` 标记。成功时返回原文，失败时返回原因和建议操作。内容按 OpenCode session 隔离，重启进程后仍可取回。

非法 key（长度不对、非十六进制、路径穿越）会被直接拒绝。

stash TTL（1800 秒）过期后，重跑原工具。不要对 retrieve 死循环。

## Stash

| | |
| --- | --- |
| 位置 | `{XDG_DATA_HOME or ~/.local/share}/opencode/sift/{sessionID}/` |
| 隔离 | 按 OpenCode `sessionID` |
| 权限 | `0700` |
| 项目文件 | stash 不会写入当前项目目录 |
| 清理 | TTL 1800 秒；过期内容在启动、会话删除和定期扫描时清理 |

原文以**明文**落盘。把 stash 目录当作敏感数据。

OpenCode 自身截断过的输出（如超长 bash 输出）不会被恢复：这类结果会直接跳过压缩，`sift_retrieve` 也无法还原已被 OpenCode 丢掉的内容。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 插件未加载 | 检查 `opencode.json` 语法与 OpenCode 版本（`>=1.18.26 <2`），然后重新安装插件 |
| 右侧栏没有 Sift | 使用 `opencode plugin @agent-context/opencode-sift` 安装并重启 TUI；CLI 会同时注册 server 和 TUI 入口 |
| Sift 始终显示 0 | 升级到 `>=0.0.7` 并重启 TUI；旧版的响应式文本在 OpenCode 插件运行环境中不会刷新 |
| 找不到 sift 原生模块 | 重新安装插件，并确认包管理器允许安装适用于当前平台的 optional dependencies |
| 没有压缩 | `minLength` 过大；执行失败或已被 OpenCode 截断；输出过短 |
| 项目目录出现 `.sift` | stash 应位于 XDG data 目录；请检查 `XDG_DATA_HOME` 配置 |
