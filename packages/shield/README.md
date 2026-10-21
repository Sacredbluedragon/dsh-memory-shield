# dsh-memory-shield

在指定 DSH preset 里挡掉其他记忆插件的上下文段与工具，让那个会话拿到干净上下文。

它不存记忆、不写文件、不提供新能力，只做遮蔽。

![version](https://img.shields.io/badge/version-0.1.3-blue)
![license](https://img.shields.io/badge/license-MIT-green)

> [!IMPORTANT]
> - 装进 profile 后**默认不遮蔽任何会话**（`enabled: false`）；要遮蔽，得在目标 preset 里挂载并显式启用。
> - 只挡 `systemPrompt` 的 context 与工具的同名注册；消息级注入、pre-step user message 注入挡不住。
> - 遮蔽失败不会报错，状态要用 `shadow_diagnose` 工具或面板查。

## 它解决什么

装了记忆插件（memory-evolve、prime-memory、auto-memory 等）之后，它们会把记忆注入到所有会话。某些 preset 不该吃这些注入，应该有自己独立的上下文。

这个插件在指定 preset 里用同名覆盖挡住这些注入和工具，其他插件本体不动。

## 安装

```bash
dsh plugin --profile web add dsh-memory-shield
```

装完重启 DSH，插件详情页会出现一块面板：显示当前状态，以及启用方式。这一步不会改变任何会话的行为。

## 在 preset 里启用

它只在 preset 里生效。在目标 preset 的 `plugins:` 里加一项：

```yaml
- id: memory-shield
  name: 'dsh-memory-shield'
  config:
    enabled: true
```

完整示例（一个自定义 preset）：

```yaml
- insert:
    - id: preset-quiet
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: quiet
        name: 干净通道
        plugins:
          - id: memory-shield
            name: 'dsh-memory-shield'
            config:
              enabled: true
```

改完重启，或新建一个选择该 preset 的会话。

**为什么不在 profile 层启用**：同名遮蔽会在本作用域注册 22 个空工具和 10 个空 context。全局启用会让每个会话都吃到这些空桩，还会和全局记忆插件撞名（报 `prompt context "memory:snapshot" is already registered`）。放在 preset 里，影响面只有那一个通道。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 关掉即不注册任何遮蔽（诊断工具仍注册） |
| `presetName` | `"default"` | 只用于日志标注，不影响行为 |
| `shadowTools` | `de_prompts` / `dtodo` | 按工具名精确遮蔽 |
| `shadowSections` | `memory:snapshot` / `prompt:injections` | 按 context 段名精确遮蔽 |
| `autoShadow` | `true` | 追加常见 `memory_*` / `memoir_*` 工具名与常见记忆 section |
| `shadowWhitelist` | `[]` | 不遮蔽的名字（对精确与自动名单统一生效） |
| `autoPresetFromSession` | `false` | 预留；当前内核没有 `ctx.session`，这条不生效 |
| `hintDismissed` | `false` | 提示横幅是否已被关掉 |
| `showInSettings` | `true` | 设置页是否也显示这块面板 |

## 遮蔽了什么

开启后，在该 preset 的作用域内注册同名 context 与同名工具，覆盖别处的注册：

- **工具**：2 个精确名 + 20 个自动名，共 22 个空桩；
- **context**：`memory:snapshot` 空遮蔽 + `prompt:injections` + 8 个自动 section，共 10 个。

自动名单覆盖 memory-evolve、memory-eternal、meow-memory、memory-palace、memento、auto-memory、prime-memory、memoir 这些插件常见的工具名与段名。

**改名单注意**：在 `cordis.patch.yml` 里写 `shadowTools` / `shadowSections` 会整块替换默认值，不深合并。要加名字，先把默认名单抄出来再追加。

## 挡不住的

- **消息级注入**：部分插件（如 meow-memory）往消息流里插独立快照消息，不是 context section，同名遮蔽管不到。
- **pre-step user message 注入**：openviking-memory 这类插件在 `agent/pre-step` 里注入 user message，不经过 `systemPrompt.context`。

这类插件不要装进需要遮蔽的 preset。

## 为什么不用 `includeRuntimeContext: false`

`@deepseek-ai/dsh-persona` 的这个开关调用 `systemPrompt.suppressRuntimeContext()`，是整块关闭，会把 preset 自己的 surface prompt 一起关掉。所以只能走同名遮蔽。

## 查看状态

两条路：

- 插件详情页面板：显示当前是否启用、怎么启用；
- 让 agent 调 `shadow_diagnose`：返回遮蔽了多少工具、多少 context、白名单里有什么。

## 自测

源码仓库里有 `_dryrun.mjs`（不随 npm 包发布）：

```bash
node _dryrun.mjs
```

它用 `os.tmpdir()` 落盘、跑完删除，不碰真实的 `DSH_HOME`。

## 项目结构

```
index.js          入口与 apply()
client.js         浏览器半端：状态面板、提示横幅、详情页标签
lib/
  constants.js    插件名
  defaults.js     默认配置
  schema.js       schemastery schema
  shadow.js       context / tool 遮蔽
```

## 限制

- 遮蔽依赖内核的「同作用域同名覆盖」规则；内核若改成先注册者赢，这个机制就失效。
- 遮蔽失败是静默的：状态要靠 `shadow_diagnose` 或面板确认，别只凭配置推断。
- 工具名可配的记忆插件（如 evolve 的 `promptToolName` / `todoToolName`）改名后自动名单对不上，需要手动补进 `shadowTools`。

## 许可

MIT。
