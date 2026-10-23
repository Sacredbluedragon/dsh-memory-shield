# dsh-memory-shield

DSH preset 级**记忆遮蔽**工具集。一个 GitHub repo，两个独立 npm 包，按需组合。

## 两个包

| 包名 | 定位 | 状态 |
|---|---|---|
| [`dsh-memory-shield`](./packages/dsh-memory-shield/) | **纯遮蔽器** | ✅ 已发布 0.1.13（npm）。挡住其他记忆插件往这个 preset 注入，让会话上下文干净。不自带记忆存储/写入/管理。默认不工作，装进 profile 不影响任何会话，在目标 preset 里显式开 `enabled: true` 才遮蔽。 |
| [`dsh-memory-core`](./packages/dsh-memory-core/) | **遮蔽会话的隔离记忆包** | ✅ 已发布 0.1.7（npm）。给遮蔽会话加上五轨记忆（默认 full，存储层参考 [dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)，作者 csyangwen）。装完即已生效，默认零注册；在 preset 里设 `config.memoryEnabled: true` 才工作。带独立管理页与插件面板入口。 |

## 用户怎么选

- **只想挡其他记忆插件** → 只装 `dsh-memory-shield`（当前可用）
- **想让遮蔽会话也有记忆** → 两个都装（先 `dsh-memory-shield`，再 `dsh-memory-core`）
- **后来才想要记忆** → 再装 `dsh-memory-core`，shield 不动、配置不动、会话不丢

## 设计原则

1. **默认不工作，但装完即已生效**：两个包装进 profile 都能正常装配、插件列表显示「已生效」，但默认不给任何会话加记忆。`dsh-memory-core` 在 `memoryEnabled` 未开启时 `apply()` 直接返回（工具、注入、路由全不注册）；`dsh-memory-shield` 的补丁无条件加载，`enabled: false` 时只留一个 `shadow_diagnose` 只读诊断工具和 `/api/memory-shield` 状态端点，不遮蔽任何东西。要在某个 preset 里启用：把包挂进该 preset 的 `plugins:`，core 另设 `config.memoryEnabled: true`。
2. **平行世界隔离**：遮蔽会话的记忆和普通会话的记忆插件互不可见、互不可管。
3. **可逆**：把插件从 preset 的 `plugins:` 里删掉，全局记忆插件立刻恢复。

## 记忆轨与注入

`dsh-memory-core` 有五轨：`memory`（长期记忆）、`user`（用户档案）、`project`（项目日志）、`key`（关键事实）、`daily`（今日日志）。**只有 `memory` / `user` / `key` 进每轮注入**；`project` / `daily` 是写下来供 `list` 按需读的日志，不会自动出现在上下文里。`lite` 模式只开三轨，`full`（默认）五轨全开。

## 已知限制

- 挡不住 pre-step user message 注入（openviking-memory 等）
- 挡不住消息级注入（meow-memory 的部分路径）

## 致谢

- 记忆存储层（`dsh-memory-core` 的 `lib/store.js`）参考并抄录自 [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)，按 MIT 协议保留署名。
