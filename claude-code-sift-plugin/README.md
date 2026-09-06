# `@agent-context/claude-code-sift`

Claude Code **插件**：用 [`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 自动压缩工具输出，并提供 `sift_retrieve` 供 Claude Code 按需取回原文。

本插件是社区项目，并非 Claude Code 或 Anthropic 官方项目，也未获得其官方背书。

这不是检索或记忆工具，也不会改写历史消息；它只处理新产生的工具输出。

要求：Claude Code ≥ 2.1，本机 `node` ≥ 18。

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

## 工作机制

插件会在工具输出进入上下文前自动压缩其中的文本内容，不改变 Bash、Read、Grep 等工具结果的原有结构。无需手动触发压缩。

发生有损压缩时，完整原文会暂存在本机，并在输出中留下 `<<stash:KEY>>` 标记。Claude Code 可按需调用内置的 `sift_retrieve` 取回原文；过期内容会自动清理。

## 配置（环境变量）

写入 `settings.json` 的 `env` 块或 shell 环境：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SIFT_ENABLED` | `1` | `0` / `false` / `off` / `no` 停用 |
| `SIFT_MIN_LENGTH` | `200` | 最小 UTF-8 字节门槛；非法值回退 200 |
| `SIFT_EXCLUDED_TOOLS` | — | 逗号分隔的工具名；`sift_retrieve` 永远被排除 |

## 压缩规则

以下情况跳过压缩，原文原样保留：

- 工具在排除列表中（含任何名字里带 `sift_retrieve` 的工具，避免取回结果被再次压缩）
- 工具执行失败
- 输出已被 Claude Code 截断
- 文本短于 `minLength`，或已含合法 `<<stash:24-hex>>` 标记
- 压缩没有收益

用户主动读取文件的一部分时，符合条件的输出仍会正常压缩。

## `sift_retrieve`

参数为输出中的 `stashKey`，可以传入裸 key 或完整的 `<<stash:KEY>>` 标记。成功时返回原文，失败时返回原因和建议操作。

非法 key（长度不对、非十六进制、路径穿越）会被直接拒绝。stash TTL（1800 秒）过期后重跑原工具，不要对 retrieve 死循环。

## Stash

| | |
| --- | --- |
| 位置 | `${CLAUDE_PLUGIN_DATA:-~/.claude}/stash/{sessionId}/` |
| 隔离 | 按 Claude Code session 保存；同一内容可跨 session 取回 |
| 权限 | `0700` |
| 清理 | TTL 1800 秒；启动 session 时以及运行期间定期清理 |

原文以**明文**落盘。把 stash 目录当作敏感数据。

Claude Code 自身截断过的输出（如超长 Grep 命中）不会被恢复：这类结果直接跳过压缩，`sift_retrieve` 也无法还原已被 Claude Code 丢掉的内容。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 插件未加载 | `/plugin` 查看安装状态；Claude Code ≥ 2.1；`node` ≥ 18 且在 PATH |
| 没有压缩 | 检查 `SIFT_ENABLED` 和 `minLength`；内容可能无法进一步压缩，或输出已被 Claude Code 截断 |
| `sift_retrieve` 不可见 | 用 `/mcp` 确认 `sift` server 已启动；仍不可见时重新安装插件 |
| 取回失败 | 原文超过 30 分钟 TTL；重跑原工具 |
