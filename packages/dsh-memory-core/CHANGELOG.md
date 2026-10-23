# Changelog

## 0.1.7

- 修 C6 误报：full 模式下把「HTTP 路由查不到 cwd」当成「会话没有工作目录」，横幅在每个会话都常驻。现在服务端给出 cwdSource 三态（query / session / unknown），只在明确「有会话但无 cwd」时告警。
- /config 返回 cwd 与 cwdSource，面板不再拿 undefined 当 false。

## 0.1.6

- 装配形态改为「装完即生效、零副作用」：去掉包内补丁的 disabled: true，改为 memoryEnabled 未开启时 apply 直接返回，工具、注入、路由、看门狗全不注册。装进 profile 后插件列表显示「已生效」，不会再被误读成「要重启」；普通会话完全不受影响。
- 「记忆已就绪」绿条只弹一次：服务端 loadedHintShown 写不进去时用浏览器 localStorage 兜底，同一浏览器不再每次刷新都弹。
- dryrun 新增「未启用时零注册」断言（0e），共 102 项。

## 0.1.5

这一版修的是「按默认配置走就会踩到」的几个洞，其中三条会静默失效、一条会让人以为记忆坏了。

- **写引导自相矛盾**：full 模式下引导让模型「一次调用写 daily 与 project」，但 `target` 只能取一个轨、`entries` 也只写同一轨，模型要么撞轨校验，要么把 project 的内容塞进 daily 静默写错轨。改成明确「收尾分两次：先 daily 再 project」，`entries` 的参数说明也补上「只写你指定的这一个 target」。
- **覆盖层改模式不生效**：`memoryTracks` 从 lite 切到 full 时只改了配置对象，`MemoryStore` 仍是 apply 时按旧值构造的，`tracksOf()` 说五轨、store 只认三轨，写 project/daily 静默失败。现在每轮重读覆盖层时，模式变了就重建 store。
- **`/status` 的 layer 判错**：原先用 `presetName === "default"` 推层级，但 preset 里不写 `presetName` 时它就是默认值，于是挂着 preset 的实例被报成 profile 层，前端弹「被插件列表开关拉起来了」的假警报。改成按装配层级判定：先看 `scope` 服务链上有没有 preset 节点，取不到才退回 `presetName` 启发式。
- **没有工作目录就用不了 project/key**：full 是默认档，而 `project` / `key` 靠会话 `cwd` 定位，没有 cwd 时写这两轨直接抛错，模型也没有别的办法补。新增两处兜底：`memory_core` 增加 `cwd` 参数（工具调用可以显式指定项目根目录），`/status` 回传 `cwd`，面板据此显示黄色提示「full 模式但当前会话没有工作目录」。
- **`writeGuard` 语义只对了一半**：面板上叫「记忆写入看门狗」，绑的却是 `writeGuard`（key 写入需确认），而看门狗真正的开关是 `perTurnWriteGuard` 且默认关——面板改了它也不生效。现在拆成两个开关：「key 写入前需人工确认」（`writeGuard`）、「记忆写入看门狗」（`perTurnWriteGuard`）；`POST /entry` 的 key 分支也认 `writeGuard: false`，直写不再入队。
- README 澄清：full 五轨只有 `memory` / `user` / `key` 进注入，`project` 与 `daily` 落盘按需读；配置表补 `perTurnWriteGuard`。
- 告警横幅补全并加总开关：新增「待确认堆积」（key 待确认 ≥ 3 条）与「两个状态接口都读不到」两条分支（后者带重试）；配置页签新增「告警横幅」开关，写入覆盖层（`bannerEnabled`），关掉后黄警不再渲染。
- 插件详情页注册 `plugins.detail.badge` 徽章，显示当前是「五轨 / 三轨」，不用点进面板才知道模式。
- 子代理会话只读：`memory_core` 除 `list` 外一律拒绝，避免子代理与主会话各写一份记忆。
- `/entry`、`/config`、`/reveal` 三处请求体加 64 KB 上限，超限回 413。
- 错误消息的包名前缀从 `dsh-memory-shield:` 改成 `dsh-memory-core:`——从本包抛出的错不该让人去 shield 包里排查。
- 面板在别的会话里打开时，写操作后清的看门狗计数改按面板传入的 `cwd` 记（原先按当前会话记，等于清了另一个项目）。
- 删掉 `TRACK_FILES` 常量：它的值与 `locate()` 实际落点不一致（`project.md` / `daily.md`），且无人使用，只会误导。
- 工具描述补三处模型最容易翻车的约束：`match` 是「唯一命中」语义（0 条或多条都失败、先 list 再传 ≥8 字）、`project`/`daily` 仅 full 模式、full 的 `key` 与 `project` 需要会话工作目录。
- README 补一份完整可抄的 preset 示例（shield + core 两项，以及 `- insert:` 四级骨架），并写明改 `presetName` 等于换空目录、不报错。
- 归档改成「失败即回滚」：写归档成功、删主轨失败时，把刚写进归档的那条撤掉再报错，不留「主轨与归档各一份」的中间态（wb P2-4）。
- 已知限制（不改，写进文档）：① 单例守卫先到先得，主实例释放后已降级的从属实例不会自动提升，要重启才换主（P2-3）；② 项目目录哈希取 sha1 前 12 位，改位数会让已有 `projects/<hash>/` 全部失联，故维持不动（P2-6）。

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