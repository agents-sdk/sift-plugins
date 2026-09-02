# sift-plugins

[`@agent-context/sift`](https://www.npmjs.com/package/@agent-context/sift) 的宿主适配器。压缩引擎在 `sift` 仓库；本仓库只负责接到各个 Agent。

Sift 会在大段工具结果进入模型之前压缩。有损压缩的原文写入本地按 session 隔离的 stash，可用 `sift_retrieve` 取回。它不是检索、记忆、知识图谱、MCP 或 HTTP 服务。

| 宿主 | 包名 | 安装 |
| --- | --- | --- |
| Pi | `@agent-context/sift-pi` | `pi install npm:@agent-context/sift-pi` |
| OpenCode | `@agent-context/sift-opencode` | `opencode.json` 的 `plugin` 数组 |

每个适配器独立发布。v1 **不抽** 共享 npm 包。

方案与契约：[`docs/pi-opencode-plugin-plan.md`](docs/pi-opencode-plugin-plan.md)、[`docs/contract-vectors.json`](docs/contract-vectors.json)。

## 许可证

Apache-2.0
