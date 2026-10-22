# Changelog

## 0.1.2

- 修复：`lib/schema.js` 用 `z.enum(...)`（zod 的写法，`@deepseek-ai/schemastery` 没有这个方法），包一 import 就抛 `TypeError: z.enum is not a function`。内核 Loader 的 `_init()` 捕获 import 错误后不建 fiber，于是 preset 里这一行只显示「never started」，日志里不落错。改为 `z.union([z.const("lite"), z.const("full")])`。
- `_dryrun.mjs` 的依赖 stub 从「万能 Proxy」改为严格白名单：只认 schemastery 真实存在的构造器与实例方法，出现 `z.enum` 这类不存在的名字立即抛错。原先的万能 Proxy 把这类错误吞掉了，dryrun 63 项全过、真机却起不来。

## 0.1.1

- 文案修正：旧名「companion」统一改为 `dsh-memory-core`（README、package.json 的 description 与 keywords、源码注释、日志前缀）。
- README 补齐与 dsh-memory-shield 的配套关系、安装方式、数据目录与 `DSH_MEMORY_CORE_DIR` 说明。
- 未改任何运行时行为。

## 0.1.0

- 首版：按 preset 隔离的记忆包（与 dsh-memory-shield 配套）。
- 五轨记忆（memory / user / project / key / daily），lite 三轨 + full 五轨。
- `memory_core` 工具：add / list / replace / remove / archive。
- `memory-core:snapshot` 注入段（常驻记忆 + 引导 + 写看门狗提醒）。
- `/api/memory-core` 路由：status / entries / entry / manage。
- `manage.html` 管理页：浏览、编辑、删除、归档、待确认队列。
- 写看门狗：连续 N 个空回合提醒写记忆，写入后清零。