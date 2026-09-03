# sift-plugins

[Sift](https://github.com/agents-sdk/sift) 的 Agent 宿主适配器集合。它在大段工具结果进入模型上下文前调用 `@agent-context/sift` 压缩内容，减少 token 占用和 prompt cache 成本，并在需要时让 Agent 通过 `sift_retrieve` 取回有损压缩前的原文。

本仓库只负责宿主接入；压缩算法、语言支持和 Node.js API 位于 [agents-sdk/sift](https://github.com/agents-sdk/sift)。

## 为什么使用

代码读取、构建日志、搜索结果和 diff 往往会快速挤占 Agent 的上下文窗口。Sift 针对内容类型选择压缩方式，并遵循「无损优先、有损可恢复」：

- 优先进行 JSON minify、日志模板化等无损压缩；
- 对 JSON 数组、构建/测试日志、搜索结果、unified diff、重复文本和多种语言源码做结构化压缩；
- 有损压缩成功写入本地 stash 后，才在结果中留下 `<<stash:HASH>>`；
- Agent 可调用 `sift_retrieve` 按 key 恢复原始工具输出。

适配器仅压缩当前工具结果，不改写整包模型请求，也不跨消息删除历史内容。它不是检索、记忆、知识图谱、MCP 或 HTTP 服务。

```text
工具执行
   │
   ▼
宿主的 tool-result hook
   │  跳过错误、截断、过短、非纯文本等结果
   ▼
Sift siftText
   ├─ 无收益 ───────────────► 原样进入上下文
   ├─ 无损压缩 ─────────────► 压缩结果进入上下文
   └─ 有损压缩 ─► 本地 stash + <<stash:HASH>>
                                      │
                                      └─ sift_retrieve 按需恢复
```

## 支持的宿主

| 宿主 | npm 包（待发布） | 接入点 | 详细文档 |
| --- | --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | `@agent-context/pi-sift` | `tool_result` 扩展 | [安装、配置与排障](pi-sift-extension/README.md) |
| [OpenCode](https://github.com/anomalyco/opencode) | `@agent-context/opencode-sift` | `tool.execute.after` 插件 | [安装、配置与排障](opencode-sift-plugin/README.md) |

两个适配器设计为独立发布和安装，当前尚未发布到 npm。v1 没有抽取共享 npm 包。

`@agent-context/opencode-sift` 是社区插件，并非 OpenCode 或 Anomaly 官方项目，也未获得其官方背书。

## 快速开始

### Pi

当前请从本地目录安装。先克隆仓库并安装依赖：

```bash
git clone https://github.com/agents-sdk/sift-plugins.git
cd sift-plugins/pi-sift-extension
npm install
pi install /absolute/path/to/sift-plugins/pi-sift-extension
```

发布到 npm 后可使用 `pi install npm:@agent-context/pi-sift`。安装后默认启用，无需额外配置，也可以通过 CLI 调整：

```bash
pi --sift-min-length 400 --sift-exclude bash,grep
pi --no-sift
```

Pi 还支持项目级安装、环境变量和本地目录加载，参见 [`@agent-context/pi-sift` 文档](pi-sift-extension/README.md)。

### OpenCode

当前请先在 `opencode-sift-plugin` 目录执行 `npm install`，再把本地入口加入用户级 `~/.config/opencode/opencode.json` 或项目根目录的 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["file:///absolute/path/to/sift-plugins/opencode-sift-plugin/index.ts", { "minLength": 200 }]
  ]
}
```

发布到 npm 后可把入口改为 `@agent-context/opencode-sift`。要求 OpenCode `>=1.18.26 <2`；Bun 原生模块说明和故障排查见 [`@agent-context/opencode-sift` 文档](opencode-sift-plugin/README.md)。

## 配置概览

两个适配器使用相同的核心配置语义，但配置入口随宿主而异：

| 配置 | 默认值 | Pi | OpenCode |
| --- | --- | --- | --- |
| 启用压缩 | `true` | `--no-sift` 或 `SIFT_ENABLED=0` | `enabled: false` |
| 最小输入长度 | `200` 个 UTF-8 字节 | `--sift-min-length` 或 `SIFT_MIN_LENGTH` | `minLength` |
| 排除工具 | `sift_retrieve` | `--sift-exclude` 或 `SIFT_EXCLUDED_TOOLS` | `excludedTools` |

`minLength` 是适配器侧的廉价预过滤；Sift 核心对小于 512 字节的内容仍会直接透传。`sift_retrieve` 始终在排除列表中，防止恢复出的原文被再次压缩。

## 压缩与取回行为

适配器只处理工具输出中的纯文本，并在以下情况保持原样：

- 工具执行失败，或宿主已标记结果被截断；
- 内容短于配置的 `minLength`；
- 工具位于 `excludedTools`；
- 图文混合内容，或无法安全提取文本；
- 内容已经包含合法的 `<<stash:24-hex>>` 标记；
- Sift 未改变内容，或没有实际节省 token。

压缩成功后，适配器会保留宿主已有 metadata/details，并追加 `siftCompressed`、`siftTokensSaved`、`siftLossy` 和可选的 `siftStashKey`。

有损结果会包含类似标记：

```text
<<stash:0123456789abcdef01234567>>
```

Agent 在确实需要被省略的细节时，可调用 `sift_retrieve`，传入 24 位 key 或完整标记。取回失败不会抛出异常，而会返回带 `error`、`hint` 和 `stashKey` 的 JSON；内容过期或来自其他 session 时，应重新执行原工具。

## Stash 与数据安全

| 宿主 | 默认位置 | 隔离方式 |
| --- | --- | --- |
| Pi | `${PI_CODING_AGENT_DIR:-~/.pi/agent}/sift/{sessionId}/` | Pi session ID |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/sift/{sessionID}/` | OpenCode session ID |

- stash 目录使用 `0700` 权限，并明确放在项目工作树之外；
- 原文以明文保存，请把 stash 当作敏感数据，不要压缩不愿落盘的凭证；
- 内容 TTL 为 30 分钟，通过启动、session 结束和每 5 分钟定期扫描做惰性清理；
- session 之间相互隔离，但同一 session 在进程重启后仍可在 TTL 内取回；
- 适配器无法恢复进入 hook 之前已被宿主截掉的输出，因此这类结果会直接跳过。

## 项目结构

```text
sift-plugins/
├── pi-sift-extension/        # @agent-context/pi-sift
├── opencode-sift-plugin/     # @agent-context/opencode-sift
└── docs/
    ├── contract-vectors.json # 两个适配器共用的契约测试向量
    └── pi-opencode-plugin-plan.md
```

两个包目前各自包含少量宿主无关逻辑，并通过同一组 contract vectors 防止配置、key 校验和取回错误语义发生漂移。

## 本地开发

需要支持 `--experimental-strip-types` 的 Node.js（建议 22.6+）。克隆仓库后分别安装依赖并运行测试：

```bash
cd pi-sift-extension
npm install
npm test

cd ../opencode-sift-plugin
npm install
npm test
```

测试包括共享契约、适配器行为、session stash、包入口以及 `@agent-context/sift` 原生模块冒烟测试。提交前建议两个目录的测试都通过。

实现决策和跨宿主契约详见 [`docs/pi-opencode-plugin-plan.md`](docs/pi-opencode-plugin-plan.md) 与 [`docs/contract-vectors.json`](docs/contract-vectors.json)。

## 许可证

[Apache-2.0](LICENSE)
