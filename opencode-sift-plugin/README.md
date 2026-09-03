# `@agent-context/opencode-sift`

OpenCode **插件**：用 [`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 自动压缩工具结果，并注册 `sift_retrieve` 供模型取回原文。

本插件是社区项目，并非 OpenCode 或 Anomaly 官方项目，也未获得其官方背书。

这不是检索、记忆或 MCP，也不会改写整包模型请求；它只处理工具输出。

要求 OpenCode `>=1.18.26 <2`。

## 安装

写入用户 / 全局 `~/.config/opencode/opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@agent-context/opencode-sift", { "minLength": 200 }]
  ]
}
```

项目级：在项目根 `opencode.json` 写同样的 `plugin` 数组。

CLI：`opencode plugin @agent-context/opencode-sift`（别名 `plug`）。

本地 `file://` 方式（开发用；**不会**自动安装依赖 — 先在本目录执行 `bun install`）：

```json
{
  "plugin": [
    ["file:///absolute/path/to/sift-plugins/opencode-sift-plugin/index.ts", { "enabled": true }]
  ]
}
```

## 配置（plugin 元组 options）

| 字段 | 类型 | 默认 |
| --- | --- | --- |
| `enabled` | boolean | `true` |
| `minLength` | number | `200`（UTF-8 字节；非法值回退 200） |
| `excludedTools` | string[] | 始终与 `sift_retrieve` 做并集 |

`enabled: false` 后既不压缩，也不注册 `sift_retrieve`。

## 压缩规则

以下情况跳过压缩，原文原样保留：

- 工具在排除列表中
- 执行失败，或宿主已截断输出（v1 不再压缩已被 OpenCode 截断的 bash/read 输出）
- 文本短于 `minLength`
- 文本已含合法 `<<stash:24-hex>>` 标记
- 压缩没有收益

已有 `metadata` 字段会保留，成功时追加 `siftCompressed`、`siftTokensSaved`、`siftLossy` 和可选的 `siftStashKey`。

## `sift_retrieve`

与 Pi 扩展同一契约：参数 `stashKey`，成功返回纯文本，失败返回 JSON `{ error, hint, stashKey }`。按 OpenCode sessionID 隔离，重启进程后仍可取回。

非法 key（长度不对、非十六进制、路径穿越）会被直接拒绝。

stash TTL（1800 秒）过期后，重跑原工具。不要对 retrieve 死循环。

## Stash

| | |
| --- | --- |
| 位置 | `{XDG_DATA_HOME or ~/.local/share}/opencode/sift/{sessionID}/` |
| 隔离 | 按 OpenCode `sessionID` |
| 权限 | `0700` |
| Git | 绝不会写到 `worktree/.opencode/.sift` |
| 清理 | TTL 1800 秒；过期内容在启动、会话删除和定期扫描时清理 |

原文以**明文**落盘。把 stash 目录当作敏感数据。

OpenCode 自身截断过的输出（如超长 bash 输出）不会被恢复：这类结果会直接跳过压缩，`sift_retrieve` 也无法还原被宿主丢掉的字节。

## Bun / 原生模块

`@agent-context/sift` 是 napi-rs 插件，通过 `optionalDependencies` 分发（`@agent-context/sift-darwin-arm64` 等）。

- npm 插件：OpenCode 装到 `~/.cache/opencode/node_modules/`
- 本地 `file://` 插件：必须在本包执行 `bun install`（或 `npm install`），才能拿到平台二进制

若 Bun 加载不了 `.node` 文件，显式安装对应平台 optional 包后再试。不要打包或改写原生模块。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 插件未加载 | 检查 `opencode.json` 语法与 OpenCode 版本（`>=1.18.26 <2`）；本地 `file://` 方式需先 `bun install` |
| 本地 file 插件找不到 sift | 在本目录 `bun install` |
| 没有压缩 | `minLength` 过大；执行失败或已被宿主截断；输出过短 |
| `git status` 出现 `.sift` | 不应发生；stash 在 XDG data 下，不在 worktree |
