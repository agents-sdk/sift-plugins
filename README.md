# sift-plugins

为 [Pi](https://github.com/earendil-works/pi)、[OpenCode](https://github.com/anomalyco/opencode) 和 [Claude Code](https://code.claude.com/) 提供的上下文压缩扩展：读文件、构建日志、搜索结果、diff 这类大段工具输出，在进入模型上下文之前先被自动压缩，降低 token 占用和 prompt cache 成本；被省略的细节由 Agent 按需取回。

压缩由 [Sift](https://github.com/agents-sdk/sift) 完成，按内容类型选择策略，遵循「无损优先、有损可恢复」：优先做 JSON minify、日志模板化等无损压缩；需要有损压缩时，原文先暂存到本地，上下文里只留摘要和 `<<stash:HASH>>` 标记，Agent 确实需要细节时再通过 `sift_retrieve` 取回。支持构建 / 测试日志、JSON、搜索结果、unified diff、重复文本和多种语言源码。

它只处理新产生的工具输出，不改写历史消息，也不是检索或记忆系统。

| 宿主 | npm 包 |
| --- | --- |
| [Pi](https://github.com/earendil-works/pi) | [`@agent-context/pi-sift`](https://www.npmjs.com/package/@agent-context/pi-sift) |
| [OpenCode](https://github.com/anomalyco/opencode) | [`@agent-context/opencode-sift`](https://www.npmjs.com/package/@agent-context/opencode-sift) |
| [Claude Code](https://code.claude.com/) | [`@agent-context/claude-code-sift`](https://www.npmjs.com/package/@agent-context/claude-code-sift) |

## 装上之后

- 安装即启用，无需配置，对 Agent 透明：它看到的是等价或摘要后的内容，行为不变；
- 不适合压缩的内容原样保留（条件见下）；
- 工具输出占用的 token 明显减少。

```text
工具输出（源码、日志、JSON、diff、搜索结果…）
   │
   ├─ 不适合 / 不值得压缩 ──► 原样保留
   ├─ 可以无损压缩 ────────► 更短的等价内容
   └─ 需要有损压缩 ──► 摘要 + <<stash:HASH>>，原文暂存本地
                              │
                              └─ Agent 需要时用 sift_retrieve 取回
```

以下情况不压缩，原文原样进入上下文：

- 工具执行失败，或宿主已截断输出；
- 内容过短（默认短于 200 字节；核心库对 512 字节以下的内容总是透传）；
- 图文混合内容，或无法安全提取文本；
- 工具在排除列表中；
- 压缩没有实际收益，或内容已含 `<<stash:HASH>>` 标记。

## 安装

### Pi

```bash
pi install npm:@agent-context/pi-sift
```

安装后默认启用。也可以按需调整：

```bash
pi --sift-min-length 400 --sift-exclude bash,grep
pi --no-sift
```

支持项目级安装（`pi install -l npm:@agent-context/pi-sift`）、环境变量和本地目录安装，详见 [`@agent-context/pi-sift` 文档](pi-sift-extension/README.md)。

### OpenCode

要求 OpenCode `>=1.18.26 <2`。在用户级 `~/.config/opencode/opencode.json` 或项目根目录的 `opencode.json` 中加入：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@agent-context/opencode-sift", { "minLength": 200 }]
  ]
}
```

也可以用 CLI 安装：`opencode plugin @agent-context/opencode-sift`。故障排查见 [`@agent-context/opencode-sift` 文档](opencode-sift-plugin/README.md)。

### Claude Code

要求 Claude Code ≥ 2.1 与本机 `node` ≥ 18。在本仓库的 marketplace 上安装：

```
/plugin marketplace add agents-sdk/sift-plugins
/plugin install claude-code-sift@agent-context
```

安装后默认启用。工作机制（PostToolUse hook 改写输出、内置 MCP server 提供 `sift_retrieve`）、npm source 引用方式与故障排查见 [`@agent-context/claude-code-sift` 文档](claude-code-sift-plugin/README.md)。

## 配置

全部可选，三个宿主语义一致：

| 想要 | Pi | OpenCode | Claude Code |
| --- | --- | --- | --- |
| 停用 | `--no-sift` 或 `SIFT_ENABLED=0` | `"enabled": false` | `SIFT_ENABLED=0` |
| 只压缩更长的输出 | `--sift-min-length 400` 或 `SIFT_MIN_LENGTH` | `"minLength": 400` | `SIFT_MIN_LENGTH=400` |
| 跳过指定工具 | `--sift-exclude bash,grep` 或 `SIFT_EXCLUDED_TOOLS` | `"excludedTools": ["bash", "grep"]` | `SIFT_EXCLUDED_TOOLS=Read,Grep` |

Claude Code 的变量写在 `settings.json` 的 `env` 块或 shell 环境里。

`minLength` 默认 200（UTF-8 字节）。`sift_retrieve` 永远不会被压缩，避免取回的原文被再次压缩。

## 数据安全

有损压缩的原文会暂存在本地私有目录：权限 `0700`，30 分钟后自动清理，session 之间相互隔离。

| 宿主 | 暂存位置 |
| --- | --- |
| Pi | `${PI_CODING_AGENT_DIR:-~/.pi/agent}/sift/{sessionId}/` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/sift/{sessionID}/` |
| Claude Code | `${CLAUDE_PLUGIN_DATA:-~/.claude}/stash/{session_id}/`（取回按内容寻址跨 session 命中） |

- 原文以**明文**保存：不要用它压缩你不愿落盘的凭证；
- 暂存目录始终位于项目工作树之外，不会出现在 `git status` 中；
- 同一 session 在进程重启后仍可取回；
- 宿主在压缩前已截断的输出无法恢复，这类结果会直接跳过压缩。

## 常见问题

| 现象 | 说明 |
| --- | --- |
| 某个输出没有被压缩 | 多数情况正常，见「装上之后」的跳过条件 |
| Agent 取回原文失败 | 原文超过 30 分钟 TTL 或来自其他 session；重新执行原工具即可 |
| 找不到原生模块 | 见对应包文档的故障排查一节 |

`@agent-context/opencode-sift` 是社区插件，并非 OpenCode 或 Anomaly 官方项目，也未获得其官方背书。

## 参与开发

压缩算法、语言支持和 Node.js API 位于 [agents-sdk/sift](https://github.com/agents-sdk/sift)，本仓库只负责宿主接入：

```text
sift-plugins/
├── .claude-plugin/
│   └── marketplace.json      # "agent-context" marketplace（Claude Code 安装入口）
├── pi-sift-extension/        # @agent-context/pi-sift
├── opencode-sift-plugin/     # @agent-context/opencode-sift
├── claude-code-sift-plugin/  # @agent-context/claude-code-sift
└── docs/
    ├── contract-vectors.json # 三个适配器共用的契约测试向量
    ├── pi-opencode-plugin-plan.md
    └── claude-code-plugin-plan.md
```

三个包各自独立发布（v1 未抽取共享包），通过同一组 contract vectors 保持配置、key 校验和取回错误语义一致。宿主接入点等实现决策详见 [`docs/pi-opencode-plugin-plan.md`](docs/pi-opencode-plugin-plan.md) 与 [`docs/claude-code-plugin-plan.md`](docs/claude-code-plugin-plan.md)。

本地开发需要支持 `--experimental-strip-types` 的 Node.js（建议 22.6+）：

```bash
cd pi-sift-extension && npm install && npm test
cd ../opencode-sift-plugin && npm install && npm test
cd ../claude-code-sift-plugin && npm install && npm test && npm run build
```

提交前建议三个目录的测试都通过；`claude-code-sift-plugin` 还需重新构建 `dist/`（产物随仓库提交）。

## 许可证

[Apache-2.0](LICENSE)
