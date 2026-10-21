# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式。

## [0.1.7] - 2026-10-21

### Changed
- 面板文案对齐 preset 口径：原来写「当前会话」，改为「挂载它的 preset 下所有会话 / 其他 preset 不受影响」；给 agent 的 `SHADOW_HINT` 改成「本会话」。
- 面板说明改成口语四问（它是干什么的 / 会影响谁 / 什么时候用 / 想有自己的记忆怎么办），不再出现「遮蔽」「注入」等术语。
- 「怎么启用」三步改成照着界面就能做的说法（打开 Agent 预设 → 插件列表加 dsh-memory-shield → 保存后新建会话），并提示可直接用复制提示词。
-「显示」开关移到面板最底部；四个复制按钮共用的说明只保留一次。

### Added
- 「作用范围」行：直接显示 `preset「X」下的会话` 或「还没挂到任何 preset」。
- 第四个复制按钮「帮我启用或排查」（`COPY_HELP`）：让 agent 查 state/health、解释影响范围、给出要改的文件行号但不擅自改。
- companion 包注明「（开发中，暂未发布）」。

## [0.1.6] - 2026-10-21

### Added
- 遮蔽段里挂一句给 agent 的说明（`SHADOW_HINT`，只挂 `memory:snapshot`）：当前会话的记忆已被拦截、数据未删除、需要隔离记忆可装 companion 包。
- `GET /api/memory-shield/health`：返回 version / layer / enabled / presetName / 实际生效的 tools 与 sections 数量。
- 面板顶部「说明段」与三个「引导型」复制按钮（了解插件 / 了解 companion / 查看遮蔽状态），复制出去的提示词都写明「不要帮我改配置」。

### Changed
- `POST /api/memory-shield/config` 加白名单：只接受 `hintDismissed` / `showInSettings` 两个布尔键，未知键 400、body 超 64 KiB 400。
- 客户端面板：状态读取收敛到 `useShieldState()`（同一时刻只发一次请求，挂载复用缓存）；横幅 z-index 改 `var(--ms-overlay-z,9999)`；静默 catch 全部改 `console.warn`。
- 面板错误态显示「状态加载失败：原因 + 重试」按钮，不再只显示「状态不可用」。

## [0.1.5] - 2026-10-21

### Fixed
- 分层判定写反：preset 的 generation scope 没有 parent（内核 `dsh-agent-preset-registry` 建 scope 时不传 `options.parent`），旧逻辑「有 parent 才算 preset」把 preset 层误判成 profile 层，导致 preset 里 `enabled: true` 也直接早退、完全不遮蔽。改为「拿到 scopeKey 就是 preset 层」。
- 分层判定抽成纯函数 `layerFromScope(scopeKey, hasScopeApi, forced)` 并导出，dryrun 补 5 条回归用例（含「真实 scope 无 parent」这条）。
- `@deepseek-ai/dsh-scope` 写进 optional peerDependencies，并记录导入失败原因（不再静默吞掉）。

## [0.1.4] - 2026-10-21

### Changed
- README 按代码实际行为重写：版本号、默认值、工具与 section 数量、安装与启用步骤全部对齐 0.1.3。
- 删掉已不存在的「patch 带 `disabled: true`」说明与「本插件无设置面板」旧描述。
- 快速开始示例补上子插件必需的 `name: 'dsh-memory-shield'`（照抄即可跑）。

## [0.1.3] - 2026-10-21

### Changed
- 分层加载：profile 层只注册状态查询与提示，不遮蔽、不写盘；preset 层才注册遮蔽。分层用 `@deepseek-ai/dsh-scope` 的 `scopeOf` / `scopeParentOf` 判定。
- `cordis.patch.yml` 去掉 `disabled: true`，装了就加载（profile 层零副作用）。
- `inject` 补 `webServer`，否则 profile 分支的状态路由注册不上。
- 面板配置补 `hintDismissed` / `showInSettings` 两键。
- 浏览器半端提示文案去掉「失忆」这类说法。

## [0.1.2] - 2026-10-21

### Changed
- 改名：`dsh-preset-memory` → `dsh-memory-shield`。旧名点不出它到底做什么，「记忆遮蔽」才是本体，也不该绑死在 preset 上。
- companion 包名改为 `dsh-memory-core`。
- 插件 id 改为 `memory-shield`，诊断工具与内部路由同步改名。
- 旧包 `dsh-preset-memory@0.1.1` 保留在 npm 上并标记 deprecated，指向本包。

## [0.1.1] - 2026-10-20

### Changed
- 改为 bundle 形态：`package.json` 声明 `dsh.bundle.patch`，包内附 `cordis.patch.yml`
- 默认 `enabled: false`：装进 profile 后不遮蔽任何会话，只在目标 preset 里显式开 `enabled: true` 才生效
- 修复误用风险：市场里把安装行切到启用时，插件自身默认仍是关闭，只注册只读诊断工具

## [0.1.0] - 2026-10-20

### Added
- 首版：纯遮蔽器，不自带记忆功能
- 默认遮蔽 memory-evolve 的两个注入段（`memory:snapshot` / `prompt:injections`）
- `shadowTools` 接管 2 个工具名（`de_prompts` / `dtodo`）
- `autoShadow` 自动追加 20 个常见 `memory_*` / `memoir_*` 工具名，合计 22 个工具桩、10 个 context section
- `shadowWhitelist` 白名单机制
- `shadow_diagnose` 诊断工具（始终注册，包括 enabled=false）

### Note
- 本包从一个未发布的 0.4.0 完整版拆出：记忆功能移至 companion 包（计划 v0.2，包名未定，当前不可安装）
- 仓库从 0.1.0 起，无 0.2.x / 0.3.x / 0.4.x 历史版本
- 前身历史（三轨/五轨记忆、待确认队列、归档管理）见早期 git log
