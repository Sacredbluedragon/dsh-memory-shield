# dsh-preset-memory

DSH preset 级**记忆遮蔽**工具集。一个 GitHub repo，两个独立 npm 包，按需组合。

## 两个包

| 包名 | 定位 | 状态 |
|---|---|---|
| [`dsh-preset-memory`](./packages/shield/) | **纯遮蔽器** | ✅ 已发布 0.1.0（GitHub + npm）。挡住其他记忆插件往这个 preset 注入，让会话上下文干净。不自带记忆存储/写入/管理。 |
| [`dsh-preset-memory-memory`](./packages/memory-companion/) | **遮蔽会话记忆 companion** | 🚧 开发中，v0.2 计划。给遮蔽会话加上三轨/五轨记忆（存储层参考 [dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)，作者 csyangwen）。当前只有 lib/ 与 manage.html，无入口文件，不能安装。 |

## 用户怎么选

- **只想挡其他记忆插件** → 只装 `dsh-preset-memory`（当前可用）
- **想让遮蔽会话也有记忆** → 等 companion 发布后两个都装
- **后来才想要记忆** → 再装 companion，shield 不动、配置不动、会话不丢

## 设计原则

1. **默认纯遮蔽**：从 market / npm 下载后不注册任何记忆工具、不注入任何记忆上下文。
2. **平行世界隔离**：遮蔽会话的记忆和普通会话的记忆插件互不可见、互不可管。
3. **可逆**：把插件从 preset 的 `plugins:` 里删掉，全局记忆插件立刻恢复。

## 已知限制

- 挡不住 pre-step user message 注入（openviking-memory 等）
- 挡不住消息级注入（meow-memory 的部分路径）

## 致谢

- 记忆存储层（companion 包内，开发中）参考并抄录自 [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)，按 MIT 协议保留署名。
