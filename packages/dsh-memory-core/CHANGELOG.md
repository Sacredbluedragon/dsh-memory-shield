# Changelog

## 0.1.0

- 首版：按 preset 隔离的记忆包（与 dsh-memory-shield 配套）。
- 五轨记忆（memory / user / project / key / daily），lite 三轨 + full 五轨。
- `memory_core` 工具：add / list / replace / remove / archive。
- `memory-core:snapshot` 注入段（常驻记忆 + 引导 + 写看门狗提醒）。
- `/api/memory-core` 路由：status / entries / entry / manage。
- `manage.html` 管理页：浏览、编辑、删除、归档、待确认队列。
- 写看门狗：连续 N 个空回合提醒写记忆，写入后清零。