# Changelog

## 0.1.4

- 默认改为 **full 五轨**（memory / user / project / key / daily）。原先默认是 lite 三轨，装完只有三轨，得手改配置才能拿到完整记忆；老配置里显式写 `memoryTracks: lite` 的仍按三轨跑。
- 记忆管理页 `manage.html` 按 dsh-memory-evolve 的记忆页形制重做：顶部页签（五轨 + 三份归档，带条数）、文件条（名称 / 条数 / 完整路径 / 复制路径）、美观视图与纯文本视图切换、搜索框、条目卡片（编辑 / 归档 / 删除）、待确认队列（允许并写入 / 拒绝）、归档区（移回主轨 / 删除）、新增条目框。
- 新增 `GET /api/memory-core/files`：一次返回每轨路径、是否存在、条数、归档数、待确认数，以及当前模式、数据目录、preset 名。面板与页签都用它，不再按前端硬编码的三轨逐个查。
- `GET /api/memory-core/entries` 与 `POST /api/memory-core/entry` 支持 `?cwd=` / `body.cwd`：管理页在别的会话里打开时也能读写项目记忆与关键事实（这两轨按会话工作目录隔离）。
- 插件详情页面板改用 `/files`，模式、条数、归档数按实际值显示；「打开记忆管理页」改成按钮样式并提到顶部。
- 管理页细节：条目改成**最新在前**（记忆文件是追加写，原先按文件顺序渲染会把最旧的排最上面）；每页 20 条分页；没有 `?cwd=` 时顶部给输入框，填一次记在浏览器里；「项目日志」页签不再报 `无效的归档轨 "project"`。
- 工具面补齐：`list` 支持 `filter` / `since` / `until` / `limit`（默认 50）/ `recent`，返回总条数与文件路径；`add` 支持 `entries` 批量写（仅 daily/project）；`replace` 保留原时间戳，不再重盖；子代理只读，不能往常驻轨写。
- 误伤防护：`archive` / `promote` / `removeArchive` / `replace` / `remove` 都接受整条原文或唯一子串，子串命中多条时明确报「命中 N 条，无法确定」，不做模糊删除；`archive` 只支持 memory/user/key 三轨。
- 待确认队列带 `cwd` / `reason` / 命中次数并去重；`confirm` / `reject` 按「轨 + 内容」定位，未传轨时退回只按内容匹配。
- 看门狗在 full 模式下只认 `daily` / `project` 的写入（lite 模式退回任意轨），子代理不提醒；面板的写操作返回真实结果，`promote` 会剥掉归档时附加的理由行。
- 项目轨 / 关键事实在取不到会话工作目录时，`list` 直接报错说明原因，不再静默返回 0 条让人以为没有记忆。

## 0.1.3

- 修复：路由与注入段直接访问 `ctx.agent`。Cordis 的 `ctx.<服务>` 在插件未声明 `inject` 时会抛 `cannot get property "agent" without inject`，被 webserver 兜底成 **400 空体**：`/api/memory-core/status`、`/manage`、`/entries` 全部打不开，`memory-core:snapshot` 注入同时失效，日志里也没有堆栈。改为 `agentOf(ctx)`，只经 `ctx.get(name, false)` 探测（取不到返回 undefined；lite 三轨不依赖 agent）。
- `_dryrun.mjs`：stub ctx 补 `get(name)`（模拟真实服务读取），并加 8d2 回归断言——`index.js` 里出现 `ctx.agent` 即失败。

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