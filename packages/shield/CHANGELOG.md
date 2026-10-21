# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式。

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
