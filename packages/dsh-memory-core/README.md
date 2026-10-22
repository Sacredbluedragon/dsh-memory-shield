# dsh-memory-core

遮蔽会话的 companion 记忆包。与 [dsh-memory-shield (shield)](../dsh-memory-shield/) 配对使用：

- **shield 包**：挡住其他记忆插件（dsh-memory-evolve 等）的注入和工具，让指定 preset 的会话拥有干净的上下文。
- **companion 包**：给被遮蔽的会话加一套隔离的记忆存储——独立数据目录、独立工具、独立面板，与普通会话的 dsh-memory-evolve 完全隔离。

## 安装

```bash
dsh plugin --profile web add dsh-memory-core
```

装完还要**手动启用一次**：包默认是关闭的（`cordis.patch.yml` 里 `disabled: true`），不启用的话重启后没有工具、没有记忆注入、面板也是空的，而且不报错。

1. 打开 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`（macOS/Linux 下是 `~/.dsh/profiles/web/cordis.patch.yml`）。
2. 找到 `id: memory-core` 那一段，把 `disabled: true` 改成 `disabled: false`，或直接删掉这一行。
3. 完全退出并重启 DSH，再新建会话。

前提：已安装 `dsh-memory-shield`（shield 包）。两包配对时建议只把 companion 挂进需要独立记忆的那个 preset，不要放进全局 `dsh.profile.bundles`。

## 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `memoryTracks` | `"lite"` | 记忆轨模式：`lite` = 三轨 memory/user/key；`full` = 五轨 memory/user/project/key/daily |
| `presetName` | `"default"` | preset 名称（影响数据目录落点） |
| `memoryDir` | `""` | 记忆数据目录（留空自动解析到 `~/.dsh-plugin-data/<presetName>/memory/`） |
| `writeGuard` | `true` | key 轨写入走待确认队列（防误写） |
| `writeGuardThreshold` | `2` | 连续 N 轮没写记忆就提醒 |
| `snapshotOrder` | `500` | memory-core:snapshot 注入顺序 |

## 记忆轨

### lite 模式（默认，三轨）

| 轨 | 文件 | 用途 |
|---|---|---|
| `memory` | `memory.md` | 长期记忆（跨会话复用） |
| `user` | `user.md` | 用户偏好与画像 |
| `key` | `key.md` | 关键事实（走待确认队列） |

### full 模式（五轨）

在 lite 三轨基础上加：

| 轨 | 文件 | 用途 |
|---|---|---|
| `project` | `projects/<hash>/memory.md` | 项目记忆（按 cwd 隔离） |
| `daily` | `daily/<date>.md` | 每日日志（编年史） |

切 full 模式：把配置里 `memoryTracks` 改成 `"full"`，重启会话即可。

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
