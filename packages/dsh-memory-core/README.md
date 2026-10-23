# dsh-memory-core

遮蔽会话的隔离记忆包。与 [dsh-memory-shield (shield)](../dsh-memory-shield/) 配对使用：

- **shield 包**：挡住其他记忆插件（dsh-memory-evolve 等）的注入和工具，让指定 preset 的会话拥有干净的上下文。
- **`dsh-memory-core` 包**：给被遮蔽的会话加一套隔离的记忆存储——独立数据目录、独立工具、独立面板，与普通会话的 dsh-memory-evolve 完全隔离。

## 安装

```bash
dsh plugin --profile web add dsh-memory-core
```

装完默认是关闭的（包内 `cordis.patch.yml` 写了 `disabled: true`），插件列表里会显示「已关闭」——这是预期行为。：装上只是把代码放好，不会给任何会话加记忆。

启用有两条路，推荐第一条：

1. **挂进目标 preset（推荐）**：在该 preset 的 `plugins:` 里加两项（见下面「preset 挂载」），重启后新建会话即生效。数据按 presetName 分目录，不影响其他会话。
2. 全局启用（不推荐）：把 profile 目录下 `cordis.patch.yml`（不是包内那份；包内文件升级时会被覆盖）里 `id: memory-core` 那段的 `disabled: true` 改成 `false`，重启。这样所有会话都会多一套记忆工具与注入，只在单会话环境里合适。

判断它是否真的在跑，看插件详情页有没有条数，或 `GET /api/memory-core/status` 的 `memoryTracks` 是不是五轨；不要以插件列表的开关为准，它管的是 profile 层。

> **别同时开两处**：如果你已经用 preset 挂载了本包，就不要再打开插件列表上的开关——两个实例会抢同一个 `/api/memory-core` 路由，后挂载的那个 preset 会报 `duplicate prefix route` 并整体加载失败。真遇到了：把列表开关关掉、重启，数据不会丢。

## preset 挂载

给自己已有的 preset 加两项（放在该 preset 的 `plugins:` 列表里，缩进对齐同列表其他项）：

```yaml
      - id: memory-shield
        name: dsh-memory-shield
        config:
          enabled: true
          presetName: <preset 名>

      - id: memory-core
        name: dsh-memory-core
        config:
          presetName: <preset 名>
```

如果还没建 preset，一份最小可用的 preset 是这样（`- insert:` 的四级骨架，写进 `cordis.patch.yml`）：

```yaml
- insert:
    - id: preset-memory
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: memory
        name: 记忆
        order: 9
        plugins:
          - id: memory-shield
            name: dsh-memory-shield
            config:
              enabled: true
              presetName: memory
          - id: memory-core
            name: dsh-memory-core
            config:
              presetName: memory
```

`presetName` 决定数据落点，默认值是字面量 `"default"`（不是当前 preset 的名）：`$DSH_HOME/../.dsh-plugin-data/default/memory/`（`DSH_HOME` 在 `~/.dsh` 时就是 `~/.dsh-plugin-data/default/memory/`；也可用环境变量 `DSH_MEMORY_CORE_DIR` 直接指定）。**多个 preset 不显式配置 `presetName` 会共用这一个目录，隔离不成立**，所以每个挂载点都应写自己的 `presetName`（建议与 preset 的 `id` 一致）。改它等于换一个空目录，旧记忆不会自动搬过去，也不报错。

前提：通常与 `dsh-memory-shield` 配对使用（shield 负责遮蔽，core 提供隔离记忆）；core 也可以独立挂进 preset，只是没有遮蔽时它只多出一套记忆，不会隔离任何东西。两包配对时建议只把 `dsh-memory-core` 挂进需要独立记忆的那个 preset，不要放进全局 `dsh.profile.bundles`。

## 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `memoryTracks` | `"full"` | 记忆轨模式：`full` = 五轨 memory/user/project/key/daily（默认）；`lite` = 三轨 memory/user/key |
| `presetName` | `"default"` | preset 名称（影响数据目录落点） |
| `memoryDir` | `""` | 记忆数据目录（留空按 `$DSH_HOME/../.dsh-plugin-data/<presetName>/memory/` 解析；`DSH_MEMORY_CORE_DIR` 优先） |
| `directMemory` / `directUser` / `directKey` | `true` | 三轨各自的「直接写入」开关；默认全开（写进去就生效，写错用 replace/remove 改），关掉的那一轨改为进待确认队列 |
| `perTurnWriteGuard` | `false` | 看门狗总闸：连续 N 轮没写 daily/project 就在快照末尾提醒（默认关，面板可开） |
| `writeGuardThreshold` | `2` | 看门狗阈值：连续 N 轮没写记忆就提醒 |
| `snapshotOrder` | `500` | memory-core:snapshot 注入顺序 |

上面几项都可以在插件详情页的「配置」页签里改，落点是一份覆盖层 `~/.dsh-plugin-data/<presetName>/memory-core.config.json`，每轮重读，改完立即生效（`snapshotOrder` 这种注册期属性除外，要重启）。

## 记忆轨

### full 模式（默认，五轨）

**注入只有三轨**：`memory`、`user`、`key` 进上下文；`project` 与 `daily` 只落盘、按需用 `memory_core list` 读，不会自动进上下文（注入总预算 2,000 字符）。

| 轨 | 文件 | 用途 |
|---|---|---|
| `memory` | `memory.md` | 长期记忆（跨会话复用） |
| `user` | `user.md` | 用户偏好与画像 |
| `key` | `projects/<hash>/key.md` | 关键事实（默认直写，按 cwd 隔离；关掉 directKey 后走待确认队列） |
| `project` | `projects/<hash>/memory.md` | 项目记忆（按 cwd 隔离） |
| `daily` | `daily/<date>.md` | 每日日志 |

### lite 模式（三轨）

只保留 `memory` / `user` / `key`（`key` 落在根目录 `key.md`，不按项目分）。切 lite：在插件详情页的「配置」页签里把记忆模式改成 lite。

## 工具

注册了一个 `memory_core` 工具，agent 可在遮蔽会话里调用：

```
memory_core action=add target=memory content="用户喜欢用中文回复"
memory_core action=list target=user
memory_core action=replace target=key match="旧内容" content="新内容"
memory_core action=remove target=memory match="要删的子串"
memory_core action=archive target=user match="要归档的子串"
```

## 面板

插件详情页里有一个小面板：

- 显示当前模式（lite/full）
- 各轨记忆条数
- 待确认队列条数
- 「打开记忆管理页」按钮——在新标签页打开 `manage.html`，可查看/修改/归档各轨记忆

## 与 dsh-memory-evolve 的关系

- 本包的存储层（`lib/store.js`）**参考并借鉴了 [dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)**（作者 csyangwen）的实现，做了隔离适配：数据目录独立、工具名独立、注入 section 同名（`memory-core:snapshot`）但内容是自己的。
- 普通会话的 dsh-memory-evolve 面板看不到遮蔽会话的记忆，反之亦然。
- 如果用户想要完整的五轨记忆 + 待确认审查 + 合并梳理，可以在普通会话里装 dsh-memory-evolve，本包只负责给被遮蔽的会话提供基础记忆读写能力。

## 目录结构

```
packages/dsh-memory-core/
├── index.js          # 插件入口（memory_core 工具 + snapshot 注入 + webServer API）
├── client.js         # 插件详情页小面板
├── manage.html       # 独立窗口记忆管理页
├── package.json
├── README.md
└── lib/
    ├── constants.js  # PLUGIN_NAME
    ├── defaults.js   # DEFAULTS + resolveMemoryDir
    ├── schema.js     # schemastery config schema
    ├── tracks.js     # 轨道定义（lite/full）
    ├── store.js      # （派生自 evolve，见上文说明）
    ├── render.js     # 注入渲染（预算分配 + 看门狗提醒）
    ├── watchdog.js   # 写入看门狗（连续 N 轮没写就提醒）
    ├── budgets.js    # 注入预算与检索参数
    └── entryid.js    # 条目身份证
```

## License

MIT
