# dsh-preset-memory

**这是一个遮蔽器，不是记忆插件。**

在指定 preset 内遮蔽其他记忆插件的注入和工具，让这个通道拥有干净的上下文。

![version](https://img.shields.io/badge/version-0.1.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)

> **插件信息**
> - **名字**：dsh-preset-memory
> - **定位**：DSH preset 级记忆遮蔽器——挡住其他记忆插件往这个 preset 里注入
> - **默认状态**：纯遮蔽器（无记忆）。从 DSH market / npm 下载后默认只启用遮蔽功能，不注册任何记忆工具、不注入任何记忆上下文。
> - **遮蔽范围**：默认覆盖 DSH 生态下载量前 8 的记忆插件（prime-memory / memory-eternal / meow-memory / memento / auto-memory / memory-palace / memoir 等）
> - **已知限制**：挡不住 pre-step user message 注入（openviking-memory 等）和消息级注入（meow-memory）

## 目录

- [它解决什么](#它解决什么)
- [安装](#安装)
- [快速开始](#快速开始)
- [配置](#配置)
- [三层遮蔽](#三层遮蔽)
- [设置面板](#设置面板)
- [自测](#自测)
- [还没做的](#还没做的)

## 它解决什么

如果你装了记忆插件（memory-evolve / prime-memory / auto-memory 等），它们会把记忆注入到所有会话里。但某些 preset 不该吃到这些注入——它们该有自己的干净上下文。

这个插件就是干这个的：**在指定 preset 里遮蔽记忆插件的注入和工具，让这个通道独立出来**。

### 遮蔽原理

只用内核自带的**按作用域同名遮蔽**，不改其他插件本体：

| 面 | 手段 |
|---|---|
| 文字 | 在本作用域注册同名 context，遮蔽其他插件的注入文本 |
| 工具 | 在本作用域注册同名工具（空壳），接管其他插件的工具名 |

默认遮蔽覆盖 DSH 生态主流记忆插件的工具名与 context section：

`shadowTools` 默认 2 个（`de_prompts` / `dtodo`），
`autoShadow` 自动追加 19 个常见 `memory_*` / `memoir_*` 工具名，合计 21 个工具桩。
`shadowSections` 默认 2 个（`memory:snapshot` / `prompt:injections`，memory-evolve 的两个注入段），
`autoShadow` 自动追加 8 个其他记忆插件的常见 section。

**挡不住的**：
- **消息级注入**——部分插件（如 meow-memory）往消息流里插独立 snapshot 消息，这不是 context section，同名遮蔽管不到。
- **pre-step user message 注入**——openviking-memory 等插件通过 `agent/pre-step` waterfall 注入 user message，不走 systemPrompt.context。这种方式目前无法遮蔽。
- 建议在 preset 层不安装这类插件。

**改名单注意**：如果在 `cordis.patch.yml` 里显式写了 `shadowTools` 或 `shadowSections`，
YAML 会整块替换 schema 默认值，不会深合并。要在默认名单基础上加，先把默认名单复制出来再追加。
或者：不写这两个配置项，直接用默认值。

**工具名可配，白名单挡不住改名**——`de_prompts` / `dtodo` 来自 evolve 的
`config.promptToolName` / `config.todoToolName`。把默认名加进 `shadowTools` 是防御性的；
改了配置名照样绕过。彻底解法是 profile 层不下发这两个工具。

### 为什么不用 `includeRuntimeContext: false`

`@deepseek-ai/dsh-persona` 的 `includeRuntimeContext: false` 会调用
`systemPrompt.suppressRuntimeContext()`，它是**全有或全无**——会连这个 preset 自己的
surface prompt 一起灭掉。所以只能走同名遮蔽。

## 安装

```bash
dsh plugin --profile web add dsh-preset-memory
```

> 注：`npm install dsh-preset-memory` 只装文件，不注册到 DSH profile；用上面的命令才会真正加载。注册时看到 `declares no dsh.bundle — installed as a plain dependency` 属正常。

**只进 preset，不进全局：** 这个插件只挂在目标 preset 的 `plugins:` 里，不要进 `dsh.profile.bundles` 也不要进全局 `cordis.patch.yml`——否则 10 个空 context + 21 个死工具会对全部会话生效，与全局记忆插件撞名会抛 `prompt context "memory:snapshot" is already registered`。

**反向成本：** 21 个空壳工具常驻工具表，每回合多几百 token。如果你只遮蔽 1-2 个记忆插件，可以把 `autoShadow: false` 关掉，手动配 `shadowTools` / `shadowSections`。

**本包不申请 awesome-dsh-plugin 收录**（无 dsh.bundle、根无 cordis.patch.yml，硬闸过不去）。

## 快速开始

**只在目标 preset 的 `plugins:` 里挂，不进 `dsh.profile.bundles`。**

```yaml
# cordis.patch.yml
- insert:
    - id: my-shield
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: my-shield
        name: 我的遮蔽模式
        plugins:
          # ... 你需要的其他插件
          - id: preset-memory
            config:
              presetName: "my-shield"
```

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉即完全不注册遮蔽（diagnose 工具仍注册） |
| `presetName` | `"default"` | 通道名 |
| `shadowTools` | 2 个 | 要遮蔽的同名工具：`de_prompts` / `dtodo` |
| `shadowSections` | 2 个 | 要遮蔽的 context section 名：`memory:snapshot` / `prompt:injections`（memory-evolve 的两个注入段） |
| `autoShadow` | `true` | 自动注册常见 `memory_*` / `memoir_*` 工具名 |
| `shadowWhitelist` | `[]` | 不遮蔽的名字白名单（对显式和 AUTO 统一生效） |
| `autoPresetFromSession` | `false` | 自动按会话工作目录派生 presetName（暂未实装，名存实亡） |

## 三层遮蔽

默认 `autoShadow: true`，开箱即用，不需要理解下面三层。只有当你发现某个记忆插件没被挡住时，才需要看这里：

| 层 | 字段 | 干什么 | 什么时候需要调 |
|---|---|---|---|
| 精确工具名 | `shadowTools` | 直接遮蔽指定工具名 | 发现某个工具名漏了 |
| 精确 context | `shadowSections` | 直接遮蔽指定 context section | 发现某个注入文本漏了 |
| 自动展开 | `autoShadow` | 自动注册常见 `memory_*` / `memoir_*` 工具名 | 默认开，不用管 |

**白名单**：`shadowWhitelist` 里的名字不会被遮蔽。如果某个工具你想让它在这个 preset 里正常用，加进来。

## 查看遮蔽状态

本插件无设置面板。让 agent 调用 `shadow_diagnose` 工具，即可看到当前遮蔽了多少工具、多少 context、哪些在白名单。

## 自测

```bash
node _dryrun.mjs
```

hermetic（落盘只用 `os.tmpdir()`，跑完删除；不碰真 `DSH_HOME`）。

## 项目结构

```
index.js          入口 + apply() 装配
lib/
  constants.js    插件名
  defaults.js     默认配置
  schema.js       schemastery schema（Config 导出）
  shadow.js       context/tool 遮蔽
```

## 安全说明

本插件解决的是 **context injection & over-sharing** 问题（OWASP MCP10:2025）：记忆插件把注入共享到所有会话，导致一个 preset 的上下文污染另一个 preset。

遮蔽机制：在 preset scope 内注册同名 context 和工具，覆盖全局注册。这不是安全沙箱——如果用户在 preset 里同时装了两个记忆插件，它们仍然互相可见。

已知挡不住的：
- pre-step user message 注入（openviking-memory 等）
- 消息级注入（meow-memory）

## 设计说明

### 这个插件在 DSH 生态里的位置

DSH 是 agent 运行时，preset 是"工作模式"。记忆插件往 context 里注入内容，影响 agent 行为。

本插件是一个**遮蔽器**——在特定 preset 里挡住这些注入。它不是记忆插件（不存储记忆），不是工具插件（不提供新能力），是一个**过滤器**——挡住不该进来的东西。

### 设计取舍：修补 vs 扩展

本插件依赖 DSH 的作用域遮蔽机制（同名注册覆盖）。这意味着：
- 如果 DSH 的作用域规则变了（比如改成"先注册的赢"），本插件就废了
- 我们是在**修补** DSH 的行为，不是在**扩展**它

这是一个脆弱的位置。但没办法——DSH 没有提供"拦截其他插件注册"的机制，我们只能用同名遮蔽。

### 为什么需要遮蔽？

因为记忆插件往**所有**会话注入，污染了不该注入的会话。

但这是**记忆插件的设计问题**，不是 DSH 的问题。记忆插件应该自己控制"往哪些会话注入"，而不是所有会话都注入。

本插件是一个**绕过方案**——在记忆插件之上再加一层过滤。这是治标，不是治本。

### 失败模式：静默失败

最大的问题是**静默失败**——如果遮蔽失败了，用户不知道。

用户以为遮蔽了，其实没有。其他记忆插件的注入照常进来，用户还以为自己有干净上下文。

**解法**：本插件提供 `shadow_diagnose` 工具，agent 可以主动检查当前遮蔽状态。

### 设计原则：防御性 vs 攻击性

本插件是**防御性**的——挡住不该进来的东西。防御性的东西往往很复杂，因为要考虑所有可能的"攻击面"（所有记忆插件的所有注入方式）。

我们默认 `autoShadow: true`，就是为了减少用户的认知负担——用户不需要知道有哪些记忆插件，我们自动挡住。

## 还没做的

- 超预算时的自动压缩
- pre-step user message 注入的遮蔽（openviking-memory 等不走 systemPrompt.context 的插件）
