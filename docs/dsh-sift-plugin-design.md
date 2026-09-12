# DeepSeek Harness Sift 插件调研与实现决策

本文记录 `@agent-context/dsh-sift` 的宿主接入依据。调研基于 DeepSeek Harness 官方仓库 `deepseek-ai/deepseek-harness` 的 `0.1.5-rc.2` 源码（检查提交 `c291e7961a515f6d7af9304e7fd1d257929aef26`，2026-09-10）与官方开发文档。

## 扩展点结论

| 需求 | dsh 扩展点 | Sift 用法 |
| --- | --- | --- |
| 注册工具 | `ctx.tools.register()` | 注册 `sift_retrieve` |
| 工具执行前策略 | `tools/pre-execute` waterfall | 不需要；Sift 不决定工具能否运行 |
| 包裹工具执行 | `tools/execute` waterfall | 不需要；Sift 不改变执行、超时或重试 |
| 变换工具结果 | `tools/post-execute` waterfall | 核心接入点，在 durable materialization 前替换模型可见 `content` |
| 观察最终结果 | `tools/result` emit | 不适合；此时结果只读，不能压缩 |
| 请求上下文 | `agent/pre-step`、`agent/request`、`system-prompt/assemble` | 不需要；工具结果已经通过 session log 进入后续上下文 |
| 消息与会话 | `session/event`、`agent/assistant-stream` | 可供 UI 观察，但插件不改历史消息或 Assistant stream |
| 生命周期 | Cordis effect、注册 disposer、plugin fiber disposal | 定时清理 stash，卸载时停止 timer 并释放缓存 |
| 人类命令 | `ctx.commands.register()` | 注册 `/sift` 统计查询；没有 command service 时不影响压缩 |
| Web 自定义节点 | `ConversationNodeDefinition` + `conversation.chat.node` keyed renderer | 可做 Web 专属 UI，但需要 Host durable event、Remote 投影与 Client 包，未用于宿主无关插件 |

`tools/post-execute` 是明确的结果变换入口。实现以 `{ prepend: true }` 注册并先 `await next()`，随后压缩下游插件最终接受的纯文本内容。下游 `block`、canonical `value` replacement 和 `additionalContexts` 都按 dsh waterfall 语义保留。失败结果、PTC 内部子调用、混合 rich blocks 和已截断结果跳过。

## 包与配置机制

dsh 的外部插件是 npm bundle。包清单通过：

```json
{
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

声明配置层，`dsh plugin --profile <name> add @agent-context/dsh-sift` 从 npm 安装依赖并把 bundle 追加到 profile。`cordis.patch.yml` 插入普通 Cordis function plugin row；`apply(ctx, config)` 从 profile 获取配置。bundle 成员变化需要重启，profile patch 内容可由 dsh 自身的 reload 策略刷新。

本插件使用不含 TypeScript runtime loader 依赖的 ESM JavaScript 发布面，并只在运行时依赖 `@agent-context/sift`。`@deepseek-ai/dsh-tools` 作为 peer compatibility 声明，不从插件内复制或启动 Harness。

## 会话隔离、取回与统计

`ToolExecution.agent.session.id` 是工具调用的会话所有者。每个 session 对应 `${DSH_HOME:-~/.dsh}/sift/<encoded-session-id>/`，沿用 Pi/OpenCode 插件的 `0700` 目录、30 分钟 TTL、24 位 hex stash key 和 `<<stash:KEY>>` 标记语义。

统计复用 OpenCode `SessionSavingsCounter` 的去重原则：按 session + call id 只累计一次 `tokensSaved`，同时维护当前进程总量。dsh 的 `PostToolDecision` 能替换 `content`，但不能给最终 result 增添任意 metadata；把 Sift 统计写成新的 durable session event 又会改变已发布 session format。因此 v1 统计留在内存，通过 `/sift` 或可选日志显示，恢复/重启后重新计数。

## TUI 结论

dsh 核心没有 OpenCode `tui.tsx` 那样的通用 TUI slot、sidebar 或 status-line 注册 API。官方架构将 UI 本身定义为插件：UI 监听 durable `session/event` 与 transient `agent/assistant-stream`，再用 `followup()` / `steer()` 驱动 Agent。官方 Web Client 有业务节点注册机制，但社区 TUI（例如 `dsh-tui`）各自拥有渲染实现，普通 Host bundle 不能在不依赖某个具体 TUI 的情况下插入状态栏。

因此采用两层降级：默认 `/sift` 走 dsh 标准 command registry，支持该 registry 的 Web/TUI 都能直接呈现；`showSavings: log` 或 `both` 在每次成功压缩后输出会话累计值。没有 command service 的 headless 或最小组合仍保留全部压缩与取回能力。

若未来 dsh 发布稳定的跨 UI slot API，可以直接把当前 `SavingsStats` 作为读模型接到 status/sidebar renderer；压缩、stash 与统计累计逻辑无需改变。

## 验证范围

- 配置默认值与错误输入；
- 共享 stash key 与 context hint contract vectors；
- post-execute 的 downstream content、block/value/rich/nested/error 组合行为；
- dsh 截断 metadata、bash stream 截断与 partial read 检测；
- session/call 去重及 token 格式化；
- 当前平台真实 Sift native binding 压缩；
- npm tarball 文件清单；
- `@deepseek-ai/dsh@0.1.5-rc.2` profile 安装、bundle config 合并、Cordis ToolRuntime/CommandRuntime 挂载。

## 参考

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness developer preview](https://www.deepseek.com/harness/en/)
- 官方源码中的 `docs/architecture.md`、`docs/cookbook/extension-cookbook.md`、`packages/core/tools/README.md` 与 `docs/user/develop/basic/publish.md`
- 本仓库的 OpenCode `index.ts`、`lib/after.ts`、`lib/tui-stats.ts`、`tui.tsx`，Pi `hooks/tool-result.ts`，Claude Code `hooks/post-tool-use.ts`
