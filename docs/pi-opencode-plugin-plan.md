# Pi / OpenCode Sift 插件实施计划

状态：v1 已落地（未 npm publish）  
仓库：`/Users/mac/go/src/sift-plugins`（`github.com/agents-sdk/sift-plugins`）  
依赖库：`@agent-context/sift@0.0.1-alpha.7`（源码 `/Users/mac/go/src/sift`）  
宿主源码：Pi `/Users/mac/go/src/pi`，OpenCode `/Users/mac/go/src/opencode`

本期兼容基线：

- Pi CLI `0.84.4`（源码 `b8b873b98`）
- OpenCode 插件 API `@opencode-ai/plugin@1.18.26` / 源码 `82b665075b`
- 本机安装的 OpenCode CLI 仍是 `1.15.4`，**不代替** 1.18 loader 的宿主安装验证

---

## 0. 已锁定决策

| 决策 | 结论 |
| --- | --- |
| 插件放哪 | 全部放本仓 `sift-plugins`，不写进 `sift` / `pi` / `opencode` 上游 |
| 仓内布局 | 平铺独立可发布包，v1 **不抽** shared npm 包 |
| npm 包名 | `@agent-context/pi-sift`、`@agent-context/opencode-sift` |
| 压缩时机 | 工具结果进模型前做 `siftText`；**不用** `siftRequest` 改整包 LLM 请求 |
| 取回 | 只提供全文 `sift_retrieve`；v1 **不做** `retrieveLines` |
| Stash | 按 session 隔离；**不写进项目工作树** |
| 许可证 | Apache-2.0，与 Sift 核心一致 |
| 发布入口 | OpenCode 包同时提供 `exports["./server"]` 和 `main`；已用真实 npm tarball 验证 |
| 取回实例 | Pi / OpenCode 按当前 session **get-or-create**，不依赖本进程曾经压缩过 |
| key 校验 | 只接受 24 位十六进制 key 或完整合法 marker |

---

## 1. 产品是什么（边界）

Sift **不是** 检索、记忆、知识图谱、MCP 或 HTTP 服务。它是 LLM 上下文压缩库：

- npm：`@agent-context/sift`
- 核心 API：`createSift({ stashDir })` → `siftText` / `retrieve` / `retrieveLines`
- 有损压缩把原文写入本地 stash，压缩文本尾部带 `<<stash:KEY>>`（KEY = BLAKE3 hex 前 24 位）
- 压缩与取回必须使用**同一个** `createSift` 实例（同一 `stashDir`）；顶层 `retrieve()` 走全局目录，读不到实例目录
- stash TTL **1800 秒**（mtime 惰性过期）；过期返回 `null`，应提示模型重跑原命令
- `< 512` 字节核心库直接透传（`MIN_BLOCK_BYTES`）；插件侧再用 `minLength` 做廉价预过滤

Agent 插件的产品闭环：

1. 在 tool result 进入模型前压缩
2. 有损时留下 `<<stash:KEY>>`
3. 注册 `sift_retrieve`，让模型按 key 取回原文

**禁止**在 `before_provider_request` / `chat.params` 上对整包请求做 `siftRequest`。工具结果一旦写入会话历史，后续回合应看到稳定字节，才能保住 prompt cache，也符合 Sift「冻结前缀不动」的不变量。

本计划中的“原文”定义为 hook 收到的工具结果，而不是宿主在 hook 之前已经截断的完整 stdout。v1 对宿主已截断的结果直接 **skip**，不写入 `siftInputTruncated`。README 已说明 retrieve 无法恢复 hook 之前被宿主丢掉的内容。

---

## 2. 仓库现状

```
sift-plugins/
  .gitignore                           # node_modules / *.tgz / 内部适配器目录
  LICENSE                              # Apache-2.0
  README.md                            # 中文总览 + Pi / OpenCode 安装表
  docs/
    pi-opencode-plugin-plan.md         # 本文件（落地记录）
    contract-vectors.json              # 跨包契约测试向量
  pi-sift-extension/                   # @agent-context/pi-sift
  opencode-sift-plugin/                # @agent-context/opencode-sift
```

不放进：

| 仓库 | 原因 |
| --- | --- |
| `/Users/mac/go/src/sift` | 压缩引擎，不该依赖任何 Agent 宿主 |
| `/Users/mac/go/src/pi` | 上游；用 Extension / pi-package 机制外挂 |
| `/Users/mac/go/src/opencode` | 上游；用 V1 Plugin 机制外挂 |

v1 不建 `packages/shared`、不用 npm workspaces。两包各自复制一份纯逻辑（`lib/config.ts`、`keys.ts`、`hints.ts`、`compress.ts`、`retrieve.ts`、`session-store.ts`），用 `docs/contract-vectors.json` 约束漂移。第四个宿主出现再抽 `@agent-context/sift-adapter`。

内部适配器目录被 `.gitignore` 过滤，不进公开文档，也不进 git。

---

## 3. 功能范围

### 3.1 v1 已做

1. **压缩 hook**：工具执行完成后、结果交给模型之前，对文本调用 `siftText`
2. **`sift_retrieve` 工具**：解析 `stashKey`（纯 key 或完整 `<<stash:KEY>>`），调用实例 `retrieve`
3. **按 session 隔离 stash**，hook 与 tool 共用同一 `createSift` 实例
4. **配置**：`enabled`、`minLength`（默认 200）、`excludedTools`
5. **默认把 `sift_retrieve` 放进排除列表**
6. **跳过**：宿主判定的错误 / 过短 / 抽不出文本 / 已含合法 stash marker / `tokensSaved <= 0` / 宿主已截断
7. **`sourcePath`**：只有完整、未偏移、未截断的 `read` 结果才传给 `siftText` 第三参
8. **contextHint**：工具名 + 关键参数（命令、路径、pattern）
9. 每个子包一份中文 README
10. 根 `README.md`：Pi / OpenCode 一句话安装
11. **stash 清理**：启动 / session 结束 / 每 5 分钟 purge 过期文件（TTL 1800s）
12. **session id 安全编码**：非法字符 hex 编码；OpenCode 断言 stash 不在 worktree 下；目录权限 `0700`

### 3.2 v1 明确不做

- `retrieveLines` 工具
- MCP server
- `siftRequest` 拦截整包 provider 请求
- stash 写进项目目录
- 检索 / 记忆 / 知识图谱
- OpenCode TUI 插件、Pi 自定义 message renderer
- 与 session compact 的深度配合
- npm publish / 官网 / demo

### 3.3 后续

- `retrieveLines`
- Pi `/sift` 状态命令；OpenCode skill 说明
- 抽 shared 包，再接 Claude Code / Codex 等
- 用 OpenCode `>=1.18.26` 做一次真实 `opencode plugin` 安装
- 完整交互式 LLM 会话手工验收（压缩出现在会话历史、模型主动 retrieve）

---

## 4. 跨宿主统一契约

实现与测试以 `docs/contract-vectors.json` 为准。

### 4.1 配置

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | `false` 时不注册 hook 也不注册工具 |
| `minLength` | number | `200` | UTF-8 字节长度预过滤；核心库仍有 512 字节下限 |
| `excludedTools` | string[] | `["sift_retrieve"]` | 用户列表与默认做并集 |

解析规则（`lib/config.ts`）：

- `parseEnabled`：`false` / `0` / `"0|false|off|no"` → false；`true` / `1` / `"1|true|on|yes"` → true
- 非法 `minLength`（非有限正数）回退 200；数字字符串（如 `"350"`）按数字解析
- 比较时使用 `Buffer.byteLength(text, "utf8")`
- `excludedTools` 只保留非空 string，并强制加入 `sift_retrieve`

### 4.2 工具 `sift_retrieve`

- **name**：`sift_retrieve`
- **参数**：`stashKey: string`（必填）
- **容错**：trim 后若整串是 `<<stash:24-hex>>` 则取内部 key；否则必须是 24 位 hex
- **校验**：`^[0-9a-fA-F]{24}$`；路径穿越 / 非 hex / 错误长度 **不调用** native `retrieve`
- **成功**：返回原文纯文本
- **失败**：JSON `{ error, hint, stashKey }`，不 throw
  - 无法确定 session：`No active sift stash store found`
  - key 不存在或过期：`Content not found in stash store`
  - 空 key 或格式非法：`Invalid stashKey`

### 4.3 压缩行为

```
if !enabled: skip
if toolName in excludedTools: skip
if hostSaysErrorOrTruncated: skip
text = extractText(result)
if text is null: skip
if UTF8ByteLength(text) < minLength: skip
if text includes a valid `<<stash:24-hex>>` marker: skip
sift = getOrCreate(sessionKey)
result = sift.siftText(text, contextHint, sourcePath?)
if !result.changed or result.tokensSaved <= 0: skip
writeBack(result.text)
attach metadata: siftCompressed, siftTokensSaved, siftLossy, siftStashKey?
```

Pi 多 text block：**用 `\n` 拼接后一次压缩**，写回单个 text block。混有 image 则整段 skip。

### 4.4 contextHint

未知工具：`tool ${name} output`。

| 宿主 | 工具 | hint |
| --- | --- | --- |
| Pi / OpenCode | `bash` / `powershell` | `shell command output: ${command}` |
| Pi | `read` | `file content of ${path}`，完整未截断时传 `sourcePath` |
| OpenCode | `read` | `file content of ${filePath}`，完整未截断时传 `sourcePath` |
| Pi | `ls` | `directory listing of ${path}` |
| OpenCode | `glob` | `glob results for ${pattern}` |
| Pi / OpenCode | `grep` | `grep results for ${pattern}` |
| Pi | `find` | `find results for ${pattern}` |
| 两者 | `webfetch` / `websearch` | `web fetch/search output` |
| 两者 | 其他 | `tool ${name} output` |

### 4.5 Stash 路径

| 宿主 | 路径 | 实现 |
| --- | --- | --- |
| Pi | `${PI_CODING_AGENT_DIR or ~/.pi/agent}/sift/{encodedSessionId}/` | `piStashRoot()`；不使用 `getSessionDir()` |
| OpenCode | `{XDG_DATA_HOME or ~/.local/share}/opencode/sift/{encodedSessionID}/` | `openCodeStashRoot()`；构造时传入 `worktree` 并断言路径不在其下 |

session id 经 `encodeSessionId` 处理：拒绝空 / `.` / `..`，非 `[A-Za-z0-9._-]` 的字符编成 `_hex_`。目录 `mkdirSync(..., { mode: 0o700 })` 后再 `chmod 0700`。

缓存 Map 只做进程内加速；hook 和 retrieve 都按 session key get-or-create。Pi 在 `session_shutdown`、OpenCode 在 `session.deleted` / `dispose` 时 `drop` 缓存并 purge。

---

## 5. Pi 插件：`@agent-context/pi-sift`

### 5.1 机制

- Extension，入口 `export default function (pi: ExtensionAPI)`
- jiti 直接跑 `.ts`
- 压缩：`pi.on("tool_result", ...)`，return 局部 patch
- 工具：`pi.registerTool` + TypeBox；带 `promptSnippet` / `promptGuidelines`
- `execute` 用 `ctx.sessionManager.getSessionId()`

### 5.2 目录（落地）

```
pi-sift-extension/
  package.json
  README.md                 # 中文
  LICENSE
  tsconfig.json
  index.ts                  # flag / env / session_start 接线
  hooks/tool-result.ts
  tools/sift-retrieve.ts
  lib/{config,keys,hints,content,compress,retrieve,session-store}.ts
  test/{contract,factory,native-smoke,pi-adapter,session-store,helpers}.test.ts
```

### 5.3 `package.json`（落地）

```json
{
  "name": "@agent-context/pi-sift",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "type": "module",
  "keywords": ["pi-package", "sift", "context-compression"],
  "pi": { "extensions": ["./index.ts"] },
  "files": ["index.ts", "hooks", "lib", "tools", "README.md", "LICENSE"],
  "scripts": { "test": "node --test --experimental-strip-types test/*.test.ts" },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "typebox": "*"
  },
  "dependencies": { "@agent-context/sift": "0.0.1-alpha.7" }
}
```

`npm pack` 含 `index.ts`、`hooks/`、`lib/`、`tools/`、README、LICENSE。

### 5.4 配置与接线（落地）

CLI flag（工厂里 `registerFlag`）：

| Flag | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `--sift` | boolean | true | 占位启用 |
| `--no-sift` | boolean | false | 禁用 |
| `--sift-min-length` | string | `"200"` | 覆盖阈值 |
| `--sift-exclude` | string | `""` | 逗号分隔额外排除 |

环境变量：`SIFT_ENABLED`、`SIFT_MIN_LENGTH`、`SIFT_EXCLUDED_TOOLS`。

时序：Pi 在工厂返回后才写入 CLI flag。因此：

1. `SIFT_ENABLED=0` 在工厂内直接 return，不注册 hook/工具
2. `--no-sift` 等到 `session_start` 再 `readSiftConfig`；未禁用才 `wire()`
3. `--sift-min-length` 的默认值 `"200"` 不覆盖 `SIFT_MIN_LENGTH`；非默认 CLI 值优先于 env

`wire()` 会 purge、启动 5 分钟 interval（`unref`）、注册 hook / retrieve / `session_shutdown`。

### 5.5 压缩 hook 写回

```ts
return {
  content: [{ type: "text", text: result.text }],
  details: {
    ...(event.details && typeof event.details === "object" ? event.details : {}),
    siftCompressed: true,
    siftTokensSaved: result.tokensSaved,
    siftLossy: result.lossy,
    ...(result.stashKey ? { siftStashKey: result.stashKey } : {}),
  },
};
```

宿主截断判定：`details.truncation.truncated === true`。

### 5.6 安装

```bash
cd pi-sift-extension && npm install
pi -e ./index.ts
pi install /absolute/path/to/sift-plugins/pi-sift-extension
# 发布后：
pi install npm:@agent-context/pi-sift
pi install -l npm:@agent-context/pi-sift
```

---

## 6. OpenCode 插件：`@agent-context/opencode-sift`

### 6.1 机制

- V1 Hooks，不用 V2 Effect
- `export default { id: "sift", server }`，无 `./tui`，无额外函数 export（避免 legacy `Object.values` 误扫）
- `"tool.execute.after"` **mutate** `output.output`
- `tool()` + Zod；`execute` 用 `context.sessionID`
- 配置：`opencode.json` 元组 `["@agent-context/opencode-sift", { minLength: 200 }]`

### 6.2 目录（落地）

计划原文写「单文件即可」。落地后 `index.ts` 仍是工厂，逻辑拆到 `lib/`：

```
opencode-sift-plugin/
  package.json
  README.md                 # 中文
  LICENSE
  tsconfig.json
  index.ts                  # V1 { id, server }
  lib/after.ts
  lib/retrieve-tool.ts
  lib/{config,keys,hints,content,compress,retrieve,session-store}.ts
  test/{contract,factory,native-smoke,opencode-adapter,package-entry,helpers}.test.ts
```

### 6.3 `package.json`（落地）

```json
{
  "name": "@agent-context/opencode-sift",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./index.ts",
  "exports": { ".": "./index.ts", "./server": "./index.ts" },
  "files": ["index.ts", "lib", "README.md", "LICENSE"],
  "dependencies": {
    "@opencode-ai/plugin": "1.18.26",
    "@agent-context/sift": "0.0.1-alpha.7"
  },
  "engines": { "opencode": ">=1.18.26 <2" }
}
```

`npm pack` 含 `index.ts` 与 `lib/`。干净目录 Bun 可 `import` default `{ id, server }`。

### 6.4 after hook

跳过：`enabled === false`、`metadata.error === true`、`metadata.truncated === true`、过短、已有合法 marker、无节省。成功时 mutate `output.output` 并合并 metadata（保留原字段）。

`read` 路径字段是 `filePath`。`offset` / `limit` / truncated 不传 `sourcePath`。

`session.deleted` 时 `drop(sessionID)`；`dispose` 清 timer、purge、清空缓存。

### 6.5 安装

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["@agent-context/opencode-sift", { "minLength": 200 }]]
}
```

未发布：

```json
{
  "plugin": [["file:///absolute/path/to/sift-plugins/opencode-sift-plugin/index.ts", { "enabled": true }]]
}
```

本地 `file://` 不会自动装依赖，需先在包目录 `bun install`。CLI：`opencode plugin @agent-context/opencode-sift`（需宿主 `>=1.18.26`）。

---

## 7. 实现注意

| 点 | 落地 |
| --- | --- |
| session 绑定 | execute 用当前 session id get-or-create |
| 排除 retrieve | 默认并上 `sift_retrieve` |
| `sourcePath` | 仅完整、未偏移、未截断的 `read` |
| hook 返回 | Pi：return patch；OpenCode：mutate `output.output` |
| 错误输出 | Pi skip `isError`；OpenCode skip `metadata.error === true` |
| 宿主截断 | 直接 skip，不写 `siftInputTruncated` |
| 二次压缩 | 文本含合法 `<<stash:24-hex>>` 则 skip |
| stash 位置 | 宿主数据目录 + session id 编码；OpenCode 拒绝 worktree 内路径 |
| 多 text block | Pi 拼接后一次压缩，写回单 block |
| 图文混合 | 整段 skip |

---

## 8. 风险与处理

| 风险 | 落地处理 |
| --- | --- |
| napi-rs 原生模块 | Node / Bun 均已用 npm artifact 在干净目录加载 `createSift` |
| Pi jiti + CJS `.node` | 包目录 `npm install`；`pi -e ./index.ts --help` 已加载扩展 |
| OpenCode 本地插件缺依赖 | README 写明先 `bun install` |
| stash 污染 git | 路径在 agent / XDG data；测试断言不在 worktree |
| 模型不调用 retrieve | Pi `promptSnippet`；OpenCode tool description |
| TTL 30 分钟 | 失败 JSON hint 提示重跑原命令 |
| 多扩展链式 hook | 只合并自己的 details/metadata 字段 |
| 进程重启 | retrieve 按 session 目录 get-or-create；native 新实例测试已覆盖 |
| stash 堆积 | 启动 / session 结束 / 5 分钟 purge |
| 原文隐私 | `0700` + README 明文落盘警示 |
| Node strip-only | `SessionSiftStore` 不用 constructor parameter properties |

---

## 9. 实施结果

### 阶段 0 — 冒烟

已用 `@agent-context/sift@0.0.1-alpha.7` 的 npm tarball 在干净目录验证 Node 与 Bun 的 `createSift`。

### 阶段 1 — Pi

`pi-sift-extension/` 已实现。`pi -e ./index.ts --help` 列出 `--sift` / `--no-sift` / `--sift-min-length` / `--sift-exclude`。自动化测试覆盖契约、adapter、factory、native round-trip。

### 阶段 2 — OpenCode

`opencode-sift-plugin/` 已实现。tarball 入口与工厂/after-hook 测试通过。本机 OpenCode CLI `1.15.4`，**未**执行 `opencode plugin` 装到 1.18 宿主。

### 阶段 3 — 仓级收尾

根 README、两包中文 README、契约向量、本计划已按代码回写。npm **未 publish**。

### 测试

```bash
cd pi-sift-extension && npm test      # 39 pass
cd opencode-sift-plugin && npm test   # 15 pass
```

分层：

1. 纯逻辑：配置、key、marker、hint、skip、metadata 合并
2. Pi adapter：局部 patch、`isError`、图文混合、多 text block、offset/limit、`promptSnippet`、cache drop 后 retrieve
3. OpenCode adapter：原地 mutate、`metadata.error` / `truncated`、极大 `minLength`、session get-or-create
4. artifact：`npm pack`、Node/Bun 加载、`exports["./server"]` / `main`

---

## 10. 验收对照

| # | 标准 | 状态 |
| --- | --- | --- |
| 1 | 压缩发生 | 自动化：native `siftText` 对大 JSON 产生 `<<stash:KEY>>` 且文本变短 |
| 2 | 取回成功 | 自动化：bare key 与完整 marker 都能还原原文 |
| 3 | 标记容错 | 自动化 |
| 4 | session 隔离 / 重启 | 自动化：不同 stashDir miss；同目录新实例可 retrieve |
| 5 | 不进 git | stash 不在仓库树；OpenCode 拒绝 worktree 内路径 |
| 6 | retrieve 不被再压 | 默认 excluded + 已有 marker skip |
| 7 | 可关闭 | Pi `SIFT_ENABLED=0` / `--no-sift`；OpenCode `enabled: false` |
| 8 | 过短不压 | UTF-8 字节阈值测试 |
| 9 | 错误不压 | Pi `isError`；OpenCode `metadata.error` |
| 10 | key 安全 | 非法 key 不调用 native retrieve |
| 11 | read 偏移 | offset/limit / truncated 不传 `sourcePath` |
| 12 | 发布产物 | `npm pack` + 干净目录 Node/Bun 加载 |
| Pi 额外 | `promptSnippet` | 工厂测试断言已注册 |
| OpenCode 额外 | 极大 `minLength` 不压缩 | adapter 测试已覆盖 |
| 缺口 | 完整交互式 LLM 会话 | 未做 |
| 缺口 | `opencode plugin` 装进 1.18 宿主 | 未做（本机 CLI 1.15.4） |

---

## 11. 用户路径

| 宿主 | 包名 | 安装 |
| --- | --- | --- |
| Pi | `@agent-context/pi-sift` | `pi install npm:@agent-context/pi-sift`（未发布时用本地路径 / `pi -e`） |
| OpenCode | `@agent-context/opencode-sift` | `opencode.json` 的 `plugin` 数组 |

子包 README（中文）含：配置、stash 目录、TTL、清理、`<<stash:KEY>>`、重启 retrieve、截断语义、原文明文落盘、Bun/Node 原生模块。

---

## 12. 关键源码索引

### 本仓落地

- Pi 工厂：`pi-sift-extension/index.ts`
- Pi hook / 工具：`pi-sift-extension/hooks/tool-result.ts`、`tools/sift-retrieve.ts`
- OpenCode 工厂：`opencode-sift-plugin/index.ts`
- OpenCode after / retrieve：`opencode-sift-plugin/lib/after.ts`、`lib/retrieve-tool.ts`
- 契约向量：`docs/contract-vectors.json`

### Sift

- API：`/Users/mac/go/src/sift/npm/core/src/index.ts`

### Pi 宿主

- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/src/core/extensions/types.ts`
- `packages/coding-agent/src/core/session-manager.ts`

### OpenCode 宿主

- `packages/plugin/src/index.ts`、`tool.ts`
- `packages/opencode/src/plugin/shared.ts`（`exports["./server"]` 或 `main`）
- `packages/opencode/src/session/tools.ts`（`tool.execute.after`）

---

## 13. 检查清单

- [x] Node 能 `createSift`（npm artifact + 干净目录）
- [x] Bun 能 `createSift`（npm artifact + 干净目录）
- [x] `pi-sift-extension/` 可被 `pi -e` 加载
- [x] Pi §10 自动化覆盖；未做完整交互式 LLM 会话
- [x] OpenCode 工厂与 after-hook 测试通过
- [x] 真实 npm tarball 含 `./server` 与 `main`
- [x] 同 stash 目录新实例可 retrieve
- [x] Pi stash 不跟随 `sessionDir`
- [x] `read(offset/limit)`、宿主截断、混合 image + text 有回归
- [x] 非法 stash key 不触达 native retrieve
- [x] 两包 README + 根 README（中文）
- [x] stash 未写入仓库 git 树
- [x] 内部适配器目录已 gitignore，公开文档无其引用
- [ ] npm publish（需另行授权）
- [ ] OpenCode `>=1.18.26` 上执行 `opencode plugin` 安装
