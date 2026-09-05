# Claude Code Sift 插件实现决策

`@agent-context/claude-code-sift`（目录 `claude-code-sift-plugin/`）的宿主接入决策记录，对应 [`pi-opencode-plugin-plan.md`](pi-opencode-plugin-plan.md)。共享契约（配置、key 校验、取回错误语义、跳过规则）不变，本文只记录 Claude Code 特有部分。

## 集成点选型

Claude Code 插件没有进程内 SDK：hooks 是被 spawn 的命令（stdin JSON / stdout JSON），工具通过内置 MCP server 注册。三个接入点：

| 职责 | 机制 | 理由 |
| --- | --- | --- |
| 压缩 | PostToolUse hook + `hookSpecificOutput.updatedToolOutput` | 唯一能改写工具输出的位置 |
| 教模型用 retrieve | SessionStart hook + `additionalContext` | 对应 Pi 的 `promptGuidelines`；startup/resume/clear/compact/fork 都会刷新 |
| `sift_retrieve` | 插件 `.mcp.json` 内置 stdio server（手写 JSON-RPC，零额外依赖） | Claude Code 插件注册工具的正规途径；不引入 `@modelcontextprotocol/sdk`，只依赖原生 sift |

PostToolUse 只在工具成功时触发（失败走 PostToolUseFailure），错误跳过免费获得。**不使用 SessionEnd**：插件 hook 在该事件共享 1.5 秒预算且不可调高，node 冷启动 + 扫描太紧；清理改在 SessionStart + MCP server 每 5 分钟做。

## `tool_response` 形状（实测 Claude Code 2.1.159）

官方文档只记载 Bash 的形状，其余未文档化。实测结果（探针 hook 落盘）：

| 工具 | 形状 | 压缩目标 |
| --- | --- | --- |
| Bash | `{stdout, stderr, interrupted, isImage, noOutputExpected}` | `stdout` |
| Read | `{type, file: {filePath, content, numLines, startLine, totalLines}}` | `file.content` |
| Grep | `{mode, numFiles, filenames[], content, numLines[, appliedLimit]}` | `content` |
| Glob | `{filenames[], durationMs, numFiles, truncated}` | 无（路径过短，天然不过门槛） |

`updatedToolOutput` 对内建工具做 schema 校验，不匹配则**静默忽略**并使用原输出。因此压缩策略是「深遍历 + 原位字符串替换」：只改字符串值，不增删字段、不改类型，任何工具通用；纯文本块数组按 Pi 的 join-压缩-写回单块处理，混合 image 跳过。**不写任何压缩元数据进 `tool_response`**（兄弟包的 `siftCompressed` 等字段会过不了校验）。

截断信号（宿主截断 → 跳过压缩，stash 无法还原被宿主丢掉的字节）：

- `truncated === true`（Glob 等）
- Grep 行数上限：`numLines === appliedLimit`
- Read 部分视图：`file.numLines < file.totalLines`，但 `tool_input` 带 `offset`/`limit`（用户主动部分读取）时忽略该信号——照常压缩、只是不带 `sourcePath`

## Stash 与取回

- 根目录：`${CLAUDE_PLUGIN_DATA}/stash`（该 env 确定性导出给 hook 与 MCP server 两类进程）；未设置时回退 `~/.claude/sift`。session-store.ts 因此成为三个宿主根函数的超集（保留 `piStashRoot` / `openCodeStashRoot`，后续可回填兄弟包恢复字节一致）。
- MCP server 拿不到 session id：取回时按目录 mtime 新→旧扫描全部 session 目录逐个尝试。key 是 BLAKE3 内容寻址，跨 session 命中即正确原文，语义上安全。
- hook 进程是一次性的：SessionSiftStore 的进程内缓存无意义，但 per-session 目录 + TTL 清理语义与兄弟包一致。

## 性能

每次工具调用 spawn 一个 node 进程是 Claude Code hook 架构的固有成本。缓解：`hasLargeString` 预扫描（纯 JS 深遍历）先跑，没有 ≥ minLength 的候选字符串就不加载原生 sift 模块——Edit/Write/TodoWrite 这类小输出只付 node 冷启动（约 50ms）。

## 形态与分发

- TS 源码（与兄弟包一致的 lib 副本策略）+ tsc 编译产物 `dist/` **提交进 git**。`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`（TS ≥5.7）让源码继续用 `.ts` 后缀导入，产物自动改写为 `.js`，测试继续走 `--experimental-strip-types`。
- 锁文件用 **npm-shrinkwrap.json**（npm 发布会排除 package-lock，而 git marketplace 渠道的 `npm ci` 与 npm source 渠道都认 shrinkwrap）——一份锁文件服务两个分发渠道。
- hooks.json / .mcp.json 一律 exec 形式（`"command": "node", "args": [...]`），Windows 上无需 .cmd shim。
- 命名：npm 包 `@agent-context/claude-code-sift`（仓库惯例 `<host>-sift`），plugin.json `name: "claude-code-sift"`（kebab-case 规范），仓库根 marketplace `agent-context`，MCP server `sift`，工具 `sift_retrieve`（跨宿主一致）。

## 踩坑记录

1. **未压缩字符串变 `null`**：深遍历的 `compressString` 以返回 `null` 表示「未应用」，对象分支直接透传导致 `"type": "text"` 等短字段全变 `null` → schema 校验不匹配 → Claude Code 静默忽略整个改写。端到端测试（真实会话确认模型看到 marker）才暴露；单测补了形状保持回归。
2. **入口守卫踩了两次坑**：测试 import hook 模块会触发模块级 `main()` 读 stdin 永久挂起，所以加 `isMainModule()` 守卫；但 (a) `import.meta.url` 永远是 realpath 形式而 `argv[1]` 保留符号链接路径（macOS `/tmp` → `/private/tmp`），需要 `realpathSync(argv[1])` 后再比较；(b) 守卫放共享模块里时 `import.meta` 指向共享模块自己——必须由调用方传 `import.meta.url` 入参。两个坑都导致入口静默不执行，端到端（模型是否真的看到 marker / MCP 工具是否真的可用）才暴露。
3. **核心库的有损阈值比直觉高**：pretty JSON 往往只触发无损 minify；紧凑/规整 JSON、真实日志才进有损路径。端到端素材用紧凑 JSON。

## 测试（与兄弟包同构的四层）

1. `contract.test.ts`：对齐 `docs/contract-vectors.json` + env 配置解析 + PascalCase hints
2. `claude-adapter.test.ts` / `response-shape.test.ts`：handler 纯函数 + fakeSift 注入，覆盖形状保持、截断跳过、自排除、offset 读取
3. `mcp-server.test.ts`：JSON-RPC core 协议行为
4. `manifest.test.ts`：plugin.json / hooks.json / .mcp.json / package.json 形状与 dist 产物存在性
5. `native-smoke.test.ts`：原生模块往返 + 跨 session 扫描取回

运行：`npm install && npm test`（Node ≥22.6）；`npm run typecheck`；`npm run build` 后 `claude plugin validate ./claude-code-sift-plugin`。
