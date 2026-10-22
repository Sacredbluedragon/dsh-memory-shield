# dsh-memory-core

遮蔽会话的隔离记忆包。与 [dsh-memory-shield (shield)](../dsh-memory-shield/) 配对使用：

- **shield 包**：挡住其他记忆插件（dsh-memory-evolve 等）的注入和工具，让指定 preset 的会话拥有干净的上下文。
- **`dsh-memory-core` 包**：给被遮蔽的会话加一套隔离的记忆存储——独立数据目录、独立工具、独立面板，与普通会话的 dsh-memory-evolve 完全隔离。

## 安装

```bash
dsh plugin --profile web add dsh-memory-core
```

装完默认是关闭的（包内 `cordis.patch.yml` 写了 `disabled: true`），插件列表里会显示「已关闭」——这是预期行为，不是装错了：装上只是把代码放好，不会给任何会话加记忆。

启用有两条路，推荐第一条：

1. **挂进目标 preset（推荐）**：在该 preset 的 `plugins:` 里加两项（见下面「preset 挂载」），重启后新建会话即生效。数据按 preset 名分目录，不影响其他会话。
2. 全局启用（不推荐）：把 `cordis.patch.yml` 里 `id: memory-core` 那段的 `disabled: true` 改成 `false`，重启。这样所有会话都会多一套记忆工具与注入，只在单会话环境里合适。

判断它是否真的在跑，看插件详情页有没有条数，或 `GET /api/memory-core/status` 的 `memoryTracks` 是不是五轨；不要看插件列表那颗开关，它管的是 profile 层。

> **别同时开两处**：如果你已经用 preset 挂载了本包，就不要再打开插件列表上的开关——两个实例会抢同一个 `/api/memory-core` 路由，后挂载的那个 preset 会报 `duplicate prefix route` 并整体加载失败。真遇到了：把列表开关关掉、重启，数据不会丢。

## preset 挂载

```yaml
      - id: memory-core
        name: dsh-memory-core
        config:
          presetName: <preset 名>
```

`presetName` 决定数据落点 `~/.dsh-plugin-data/<preset 名>/memory/`，建议与 preset 的 `id` 一致。

前提：已安装 `dsh-memory-shield`（shield 包）。两包配对时建议只把 `dsh-memory-core` 挂进需要独立记忆的那个 preset，不要放进全局 `dsh.profile.bundles`。

## 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `memoryTracks` | `"full"` | 记忆轨模式：`full` = 五轨 memory/user/project/key/daily（默认）；`lite` = 三轨 memory/user/key |
| `presetName` | `"default"` | preset 名称（影响数据目录落点） |
| `memoryDir` | `""` | 记忆数据目录（留空自动解析到 `~/.dsh-plugin-data/<presetName>/memory/`） |
| `writeGuard` | `true` | key 轨写入走待确认队列（防误写） |
| `writeGuardThreshold` | `2` | 连续 N 轮没写记忆就提醒 |
| `snapshotOrder` | `500` | memory-core:snapshot 注入顺序 |

上面几项都可以在插件详情页的「配置」页签里改，落点是一份覆盖层 `~/.dsh-plugin-data/<presetName>/memory-core.config.json`，每轮重读，改完立即生效（`snapshotOrder` 这种注册期属性除外，要重启）。

## 记忆轨

### full 模式（默认，五轨）

| 轨 | 文件 | 用途 |
|---|---|---|
| `memory` | `memory.md` | 长期记忆（跨会话复用） |
| `user` | `user.md` | 用户偏好与画像 |
| `key` | `projects/<hash>/key.md` | 关键事实（走待确认队列，按 cwd 隔离） |
| `project` | `projects/<hash>/memory.md` | 项目记忆（按 cwd 隔离） |
| `daily` | `daily/<date>.md` | 每日日志（编年史） |

### lite 模式（三轨）

只保留 `memory` / `user` / `key`（`key` 落在根目录 `key.md`，不按项目分）。切 lite：在设置页「配置」里把记忆模式改成 lite 即可。

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
- 「打开记忆管理面板」按钮——在独立窗口打开 `manage.html`，可查看/修改/归档各轨记忆

## 与 dsh-memory-evolve 的关系

- 本包的存储层（`lib/store.js`）**参考并借鉴了 [dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)**（作者 csyangwen）的实现，做了隔离适配：数据目录独立、工具名独立、注入 section 同名（`memory-core:snapshot`）但内容是自己的。
- 普通会话的 dsh-memory-evolve 面板看不到遮蔽会话的记忆，反之亦然。
- 如果用户想要完整的五轨记忆 + 待确认审查 + 合并梳理，可以在普通会话里装 dsh-memory-evolve，本包只负责给遮蔽会话提供最小可用的记忆能力。

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
    ├── store.js      # MemoryStore + SuggestionQueue + ArchiveStore（抄自 evolve）
    ├── render.js     # 注入渲染（预算分配 + 看门狗提醒）
    ├── watchdog.js   # 写入看门狗（连续 N 轮没写就提醒）
    ├── budgets.js    # 注入预算与检索参数
    └── entryid.js    # 条目身份证
```

## License

MIT
