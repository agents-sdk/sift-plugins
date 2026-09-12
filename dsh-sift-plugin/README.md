# @agent-context/dsh-sift

DeepSeek Harness（dsh）的 Sift 工具结果压缩插件。它通过原生 `tools/post-execute` waterfall 在工具结果写入会话并进入下一次模型请求前压缩纯文本内容；有损压缩会把原文暂存到本地，并注册 `sift_retrieve` 工具供 Agent 按 `<<stash:KEY>>` 取回。

要求 Node.js `^22.19 || >=24.2`，以及 DeepSeek Harness `0.1.5-rc.2` 或兼容的 `0.1.x` 版本。Node 24.0–24.1 尚无 dsh CLI 入口使用的 `import.meta.main`，会导致命令静默退出。先确认 `dsh --version` 可用；尚未安装时，先安装当前 developer preview CLI：

```bash
npm install -g @deepseek-ai/dsh@next
dsh --version
```

使用 Volta 且 Node 版本低于要求时，可先运行 `volta install node@24`；使用 nvm 时运行 `nvm install 24 && nvm use 24`，并确认得到的版本不低于 24.2。

## 安装

从 npm 安装到所需 profile：

```bash
dsh plugin --profile web add @agent-context/dsh-sift
dsh web
```

其他 profile 同理：

```bash
dsh plugin --profile tui add @agent-context/dsh-sift
dsh --profile tui
```

`dsh plugin` 会读取 `package.json` 的 `dsh.bundle.patch`，自动把本包加入 profile 的 bundle 列表。安装、删除或更新 bundle 后需要重启该 profile。可在启动前检查组合结果：

```bash
dsh --profile web --dump-config
```

## 配置

安装即启用。默认配置位于 `cordis.patch.yml`：

```yaml
- insert:
    - id: sift
      name: '@agent-context/dsh-sift'
      config:
        enabled: true
        minLength: 200
        excludedTools: []
        showSavings: command
```

在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中用同一个 `id: sift` 覆盖整行即可修改配置。dsh 的 patch 会替换整段 `config`，因此请重写所有需要保留的字段。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用压缩与取回工具 |
| `minLength` | `200` | 尝试压缩的最小 UTF-8 字节数；Sift 核心仍会透传不值得压缩的短内容 |
| `excludedTools` | `[]` | 跳过的工具名；`sift_retrieve` 始终自动排除 |
| `showSavings` | `command` | `command`、`log`、`both` 或 `off` |

`showSavings: command` 注册 `/sift`，返回当前会话以及当前 dsh 进程累计节省的 token。`log` 会在每次成功压缩时写一条日志；`both` 同时启用两者。

## 生命周期与兼容性

- **tool / middleware**：`tools/post-execute` 是压缩入口；监听器先调用 `next()`，因此会压缩下游插件最终接受的纯文本投影，并保留其附加上下文。
- **tool**：`ctx.tools.register()` 注册 `sift_retrieve`。
- **session / context**：会话由 `exec.agent.session.id` 隔离；原文位于 `${DSH_HOME:-~/.dsh}/sift/<sessionId>/`，目录权限为 `0700`，文件 TTL 为 30 分钟。
- **message**：插件不改写历史消息，也不注入额外模型消息；只替换新工具结果的 `content`。
- **PTC**：跳过 `run_code` 的内部子调用（`exec.parent`），因为其值只供程序使用；顶层模型可见结果仍可压缩。
- **混合内容与失败**：包含图片等非文本 block、失败结果、已含 stash marker、排除工具及无实际收益的内容均原样保留。

## TUI 展示限制

DeepSeek Harness 核心把 UI 作为插件，但目前没有像 OpenCode `tui.tsx` 的跨 TUI 状态栏或 slot API。官方仓库的 UI 扩展点是事件流，以及 Web Client 的 `ConversationNodeDefinition`；第三方 TUI 各自拥有渲染层，不能由普通 Host 插件可靠注入状态栏。

因此本插件采用宿主无关的最近替代方案：在 profile 提供 command registry 时注册标准 `/sift` 命令，Web/TUI 客户端可直接展示；没有 command registry 的 headless 组合仍可压缩，需要自动提示时使用 `showSavings: log` 或 `both`。统计保存在当前进程内，不写入会话日志，重启或恢复会话后从零开始；这样不会为了 UI 统计增加模型 token 或改变已发布的 session format。

## 开发验证

```bash
cd dsh-sift-plugin
npm install
npm test
npm pack --dry-run
```

插件使用 dsh 原生结果变换接口，不修改 DeepSeek Harness 源码。DeepSeek Harness 仍处于 developer preview，若 `tools/post-execute`、命令注册或 bundle manifest 在后续版本变化，需要同步适配。
