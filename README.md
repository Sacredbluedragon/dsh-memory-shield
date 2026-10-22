# dsh-memory-shield

DSH preset 级**记忆遮蔽**工具集。一个 GitHub repo，两个独立 npm 包，按需组合。

## 两个包

| 包名 | 定位 | 状态 |
|---|---|---|
| [`dsh-memory-shield`](./packages/dsh-memory-shield/) | **纯遮蔽器** | ✅ 已发布 0.1.10（npm）。挡住其他记忆插件往这个 preset 注入，让会话上下文干净。不自带记忆存储/写入/管理。默认关闭，装进 profile 不影响任何会话，只在目标 preset 里显式开。 |
| [`dsh-memory-core`](./packages/dsh-memory-core/) | **遮蔽会话的隔离记忆包** | ✅ 已发布 0.1.1（npm）。给遮蔽会话加上三轨/五轨记忆（存储层参考 [dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)，作者 csyangwen）。宿主半与面板已就位。 |

## 用户怎么选

- **只想挡其他记忆插件** → 只装 `dsh-memory-shield`（当前可用）
- **想让遮蔽会话也有记忆** → 两个都装（先 `dsh-memory-shield`，再 `dsh-memory-core`）
- **后来才想要记忆** → 再装 `dsh-memory-core`，shield 不动、配置不动、会话不丢

## 设计原则

1. **默认关闭**：bundle 形态装进 profile 后不注册任何遮蔽（`enabled: false`），只在目标 preset 里显式开 `enabled: true` 才生效。
2. **平行世界隔离**：遮蔽会话的记忆和普通会话的记忆插件互不可见、互不可管。
3. **可逆**：把插件从 preset 的 `plugins:` 里删掉，全局记忆插件立刻恢复。

## 已知限制

- 挡不住 pre-step user message 注入（openviking-memory 等）
- 挡不住消息级注入（meow-memory 的部分路径）

## 致谢

- 记忆存储层（`dsh-memory-core` 的 `lib/store.js`）参考并抄录自 [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)，按 MIT 协议保留署名。
