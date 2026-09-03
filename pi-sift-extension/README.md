# `@agent-context/pi-sift`

Pi coding-agent **扩展**：在工具结果进入模型前用 [`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 压缩，并注册 `sift_retrieve` 供模型取回原文。

这不是检索、记忆或 MCP，也不会改写整包模型请求；它只处理工具输出。

## 安装

```bash
# 用户级
pi install npm:@agent-context/pi-sift

# 项目级
pi install -l npm:@agent-context/pi-sift

# 本地目录（开发用）
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

`SIFT_ENABLED=0` 在扩展加载时生效；`--no-sift` 在会话启动时生效。

核心库仍有 512 字节下限。低于该值的请求是廉价透传。

## 压缩规则

1. 只处理纯文本；图文混合的结果整段跳过。
2. 错误、已被宿主截断、过短、排除列表中的工具，以及已含合法 `<<stash:24-hex>>` 标记的文本保持原样。
3. 压缩后若没有节省 token，原文不动。

压缩成功时会写入 `details.siftCompressed` / `siftTokensSaved` / `siftLossy` / `siftStashKey`，其他扩展写入的 details 会保留。

## `sift_retrieve`

当压缩输出含 `<<stash:KEY>>` 且需要原文时调用。

- 参数：`stashKey` — 24 位十六进制，或完整 `<<stash:KEY>>` 标记。
- 成功：原文纯文本。
- 失败：JSON `{ error, hint, stashKey }`（不会 throw）。
  - 非法 key / 路径穿越 → `Invalid stashKey`（不会调用 native retrieve）
  - 没有 session → `No active sift stash store found`
  - 过期 / 其他 session → `Content not found in stash store` — 重跑原工具，不要死循环

`sift_retrieve` 自带使用说明，Agent 无需额外提示就知道如何调用。

## Stash

| | |
| --- | --- |
| 位置 | `${PI_CODING_AGENT_DIR or ~/.pi/agent}/sift/{sessionId}/` |
| 隔离 | 按 Pi `sessionId` |
| TTL | 1800 秒；过期内容在启动、会话结束和定期扫描时清理 |
| 重启 | 新进程仍可从同一 session 目录取回 |
| Git | 即使 `sessionDir` 配在项目树，stash 也不进 worktree |

原文以**明文**写入用户私有目录（`0700`）。不要压缩你不愿落盘的密钥。

若 Pi 已经先行截断工具结果，retrieve 只能恢复截断后的部分，无法还原被宿主丢掉的内容。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 完全不压缩 | 输出短于 `minLength` / 512 字节；错误结果；图文混合 |
| 找不到原生模块 | npm 安装时确认 `@agent-context/sift` 及其平台 optional 依赖装上；本地目录安装时先在包目录执行 `npm install` |
| 30 分钟后 retrieve 失败 | stash TTL；重跑原工具 |
| 新 session retrieve 失败 | key 按 session 隔离 |
| 项目 `git status` 出现 stash 文件 | 不应发生；stash 根目录是 agent 数据目录，不是 `sessionDir` |
