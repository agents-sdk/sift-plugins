# `@agent-context/sift-opencode`

OpenCode **V1 server 插件**：在 `tool.execute.after` 用 [`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 压缩工具结果，并注册 `sift_retrieve`。

这不是检索、记忆、MCP、TUI，也不是对整包 provider 请求做 `siftRequest`。

要求 OpenCode `>=1.18.26 <2`。发布用的插件类型来自 `@opencode-ai/plugin@1.18.26`。

## 安装

用户 / 全局 `~/.config/opencode/opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@agent-context/sift-opencode", { "minLength": 200 }]
  ]
}
```

项目级：在项目根 `opencode.json` 写同样的 `plugin` 数组。

CLI：`opencode plugin @agent-context/sift-opencode`（别名 `plug`）。

未发布的本地文件（**不会**自动安装依赖 — 先在本目录执行 `bun install`）：

```json
{
  "plugin": [
    ["file:///absolute/path/to/sift-plugins/opencode-sift-plugin/index.ts", { "enabled": true }]
  ]
}
```

npm 包同时提供 `main` 和 `exports["./server"]`，OpenCode loader 才能从 tarball 解析入口。不要加 `exports["./tui"]`。

## 配置（plugin 元组 options）

| 字段 | 类型 | 默认 |
| --- | --- | --- |
| `enabled` | boolean | `true` |
| `minLength` | number | `200`（UTF-8 字节；非法值回退 200） |
| `excludedTools` | string[] | 始终与 `sift_retrieve` 做并集 |

`enabled: false` 既不注册 hook，也不注册工具。

## 行为

OpenCode 的工具输出已经是 `output.output` 上的字符串。after hook **原地修改**该字符串（返回值无效）。

跳过条件：

- 工具在排除列表中
- `metadata.error === true`
- `metadata.truncated === true`（v1 不对宿主已截断的 bash/read 输出再压）
- 文本短于 `minLength`
- 文本已含合法 `<<stash:24-hex>>` 标记
- `siftText` 报告 `changed === false` 或 `tokensSaved <= 0`

已有 `metadata` 字段会保留。成功时插件追加 `siftCompressed`、`siftTokensSaved`、`siftLossy`，以及可选的 `siftStashKey`。

`read` 的路径字段是 `filePath`（不是 Pi 的 `path`）。仅对完整、未偏移、未截断的 read 传入 `sourcePath`。

## `sift_retrieve`

与 Pi 扩展同一契约：参数 `stashKey`，成功返回纯文本，失败返回 JSON `{ error, hint, stashKey }`。使用 `context.sessionID` 做 get-or-create，重启 OpenCode 进程后仍可取回。

非法 key（长度不对、非十六进制、路径穿越）不会到达 native `retrieve`。

stash TTL（1800 秒）过期后，重跑原工具。不要对 retrieve 死循环。

## Stash

| | |
| --- | --- |
| 位置 | `{XDG_DATA_HOME or ~/.local/share}/opencode/sift/{sessionID}/` |
| 隔离 | 按 OpenCode `sessionID` |
| 权限 | `0700` |
| Git | 绝不会写到 `worktree/.opencode/.sift` |
| 清理 | 启动、`session.deleted`、插件 `dispose`、每 5 分钟 purge |

原文以**明文**落盘。把 stash 目录当作敏感数据。

OpenCode 的 bash 工具在 `tool.execute.after` 之前已经截断。v1 跳过 `metadata.truncated === true`，因此 retrieve 无法恢复宿主已经丢掉的字节。

## Bun / 原生模块

`@agent-context/sift` 是 napi-rs 插件，通过 `optionalDependencies` 分发（`@agent-context/sift-darwin-arm64` 等）。

- npm 插件：OpenCode 装到 `~/.cache/opencode/node_modules/`
- 本地 `file://` 插件：必须在本包执行 `bun install`（或 `npm install`），才能拿到平台二进制

若 Bun 加载不了 `.node` 文件，显式安装对应平台 optional 包后再试。不要打包或改写原生模块。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 插件未加载 | `exports["./server"]` / `main`；用 npm tarball，不要额外乱 export |
| 本地 file 插件找不到 sift | 在本目录 `bun install` |
| 没有压缩 | `minLength` 过大；truncated/error metadata；输出过短 |
| `git status` 出现 `.sift` | 不应发生；stash 在 XDG data 下，不在 worktree |
