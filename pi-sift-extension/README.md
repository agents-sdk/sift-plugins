# `@agent-context/sift-pi`

Pi coding-agent **扩展**：在工具结果进入模型前用 [`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 压缩，并注册 `sift_retrieve` 供模型取回原文。

这不是检索、记忆、MCP，也不是整包请求改写。它只对工具输出调用 `siftText`。

## 安装

```bash
# 已发布
pi install npm:@agent-context/sift-pi

# 项目级
pi install -l npm:@agent-context/sift-pi

# 未发布的本地目录
cd pi-sift-extension && npm install
pi install /absolute/path/to/sift-plugins/pi-sift-extension
# 或一次性加载：
pi -e ./index.ts
```

`pi install` 会把包装到 `~/.pi/agent/npm/`（用户级）或 `.pi/npm/`（项目级），并写入 `settings.json`。

## 配置

优先级：CLI flag > 环境变量 > 默认值。

| 项 | Flag | 环境变量 | 默认 |
| --- | --- | --- | --- |
| 启用 | `--sift` / `--no-sift` | `SIFT_ENABLED=0` | 启用 |
| 最小 UTF-8 字节数 | `--sift-min-length 400` | `SIFT_MIN_LENGTH` | `200` |
| 额外跳过列表 | `--sift-exclude bash,grep` | `SIFT_EXCLUDED_TOOLS` | 始终排除 `sift_retrieve` |

`SIFT_ENABLED=0` 在加载时禁用扩展。`--no-sift` 在 `session_start` 生效（Pi 在工厂函数返回后才应用 CLI flag）。

核心库仍有 512 字节下限。低于该值的请求是廉价透传。

## 行为

1. 在 `tool_result` 上提取纯文本（图文混合整段跳过）。
2. 跳过错误、宿主已截断、过短、排除列表中的工具，以及已含合法 `<<stash:24-hex>>` 的文本。
3. 调用 `siftText`。若没有节省 token，保持原文不动。
4. 返回**局部 patch**：新的文本 content，以及 `details.siftCompressed` / `siftTokensSaved` / `siftLossy` / `siftStashKey`。其他扩展的 details 会保留。
5. 仅对完整、未偏移、未截断的 `read` 结果传入 `sourcePath`。`read(offset/limit)` 永不传入。

## `sift_retrieve`

当压缩输出含 `<<stash:KEY>>` 且需要原文时调用。

- 参数：`stashKey` — 24 位十六进制，或完整 `<<stash:KEY>>` 标记。
- 成功：原文纯文本。
- 失败：JSON `{ error, hint, stashKey }`（不会 throw）。
  - 非法 key / 路径穿越 → `Invalid stashKey`（不会调用 native retrieve）
  - 没有 session → `No active sift stash store found`
  - 过期 / 其他 session → `Content not found in stash store` — 重跑原工具，不要死循环

工具带 `promptSnippet` / `promptGuidelines`，会出现在 Pi 默认 system prompt 的工具段。

## Stash

| | |
| --- | --- |
| 位置 | `${PI_CODING_AGENT_DIR or ~/.pi/agent}/sift/{sessionId}/` |
| 隔离 | 按 Pi `sessionId`；hook 与 retrieve 共用 `getOrCreate` |
| TTL | 1800 秒（按 mtime 惰性过期），另有启动 / session shutdown / 每 5 分钟 purge |
| 重启 | 新进程仍可从同一 session 目录取回 |
| Git | 即使 `sessionDir` 配在项目树，stash 也不进 worktree |

原文以**明文**写入用户私有目录（`0700`）。不要压缩你不愿落盘的密钥。

若 Pi 在本 hook 之前已经截断工具结果，retrieve 只能恢复截断后的字节，无法还原被宿主丢掉的 stdout。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 完全不压缩 | 输出短于 `minLength` / 512 字节；错误结果；图文混合 |
| 找不到原生模块 | 在本包目录执行 `npm install`，确保 `@agent-context/sift` 及其平台 optional 依赖已装上 |
| 30 分钟后 retrieve 失败 | stash TTL；重跑原工具 |
| 新 session retrieve 失败 | key 按 session 隔离 |
| 项目 `git status` 出现 stash 文件 | 不应发生；stash 根目录是 agent 数据目录，不是 `sessionDir` |
