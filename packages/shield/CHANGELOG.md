# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式。

## [0.1.0] - 2026-10-20

### Added
- 首版：纯遮蔽器，不自带记忆功能
- 默认遮蔽 memory-evolve 的两个注入段（`memory:snapshot` / `prompt:injections`）
- `shadowTools` 接管 2 个工具名（`de_prompts` / `dtodo`）
- `autoShadow` 自动追加 19 个常见 `memory_*` / `memoir_*` 工具名，合计 21 个工具桩
- `shadowWhitelist` 白名单机制
- `shadow_diagnose` 诊断工具（始终注册，包括 enabled=false）

### Note
- 本包从一个未发布的 0.4.0 完整版拆出：记忆功能移至 companion 包（计划 v0.2，包名未定，当前不可安装）
- 仓库从 0.1.0 起，无 0.2.x / 0.3.x / 0.4.x 历史版本
- 前身历史（三轨/五轨记忆、待确认队列、归档管理）见早期 git log
