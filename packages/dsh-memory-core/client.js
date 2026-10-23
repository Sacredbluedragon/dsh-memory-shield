/**
 * dsh-memory-core —— 浏览器半端：插件详情页的设置面板。
 *
 * 形制对齐 dsh-memory-evolve 的设置页：三个页签（指南 / 配置 / 版本），
 * 配置项改完立即 POST 到覆盖层并生效（不需要重启），同时展示记忆状态与
 * 独立管理页入口。
 * 挂载点：plugins.bundle.config（key = 包名）。
 */
window.__ModuleLoader__.load({
  id: "dsh-memory-core",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const PKG = "dsh-memory-core";
    const API = "/api/memory-core";
    const jget = async (p) => (await fetch(API + p, { credentials: "same-origin" })).json();
    const jpost = async (p, body) =>
      (await fetch(API + p, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })).json();

    const CSS = `
[data-pmc-page]{display:flex;flex-direction:column;gap:10px;padding:4px 2px 10px;max-width:680px;font-size:13px;}
[data-pmc-head]{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
[data-pmc-title]{font-size:14px;font-weight:600;}
[data-pmc-sub]{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9099);}
[data-pmc-tabs]{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));}
[data-pmc-tab]{appearance:none;border:0;background:transparent;font:inherit;font-size:13px;padding:7px 12px;cursor:pointer;color:var(--dsw-alias-label-secondary,#6b7280);border-bottom:2px solid transparent;margin-bottom:-1px;}
[data-pmc-tab][data-on]{color:var(--dsw-alias-brand-primary,#2f6fed);border-bottom-color:var(--dsw-alias-brand-primary,#2f6fed);font-weight:600;}
[data-pmc-card]{display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));border-radius:10px;padding:14px 16px;background:var(--dsw-alias-bg-elevated,#fff);}
[data-pmc-lead]{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9099);line-height:18px;}
[data-pmc-sec]{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));padding-top:10px;}
[data-pmc-sec]:first-child{border-top:0;padding-top:0;}
[data-pmc-h]{font-size:13px;font-weight:600;}
[data-pmc-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:26px;}
[data-pmc-name]{min-width:110px;flex:none;}
[data-pmc-val]{flex:1;color:var(--dsw-alias-label-secondary,#6b7280);}
[data-pmc-desc]{flex-basis:100%;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a9099);}
[data-pmc-btn]{appearance:none;font:inherit;font-size:12px;min-height:28px;padding:2px 12px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:inherit;}
[data-pmc-btn][data-on]{border-color:var(--dsw-alias-brand-primary,#2f6fed);color:var(--dsw-alias-brand-primary,#2f6fed);background:rgba(47,111,237,.08);}
[data-pmc-num]{width:88px;min-height:28px;padding:2px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:inherit;font:inherit;}
[data-pmc-open]{display:inline-flex;align-items:center;gap:6px;font-size:12px;min-height:28px;padding:2px 12px;border-radius:6px;cursor:pointer;text-decoration:none;border:1px solid var(--dsw-alias-brand-primary,#2f6fed);color:var(--dsw-alias-brand-primary,#2f6fed);background:transparent;flex:none;}
[data-pmc-open]:hover{background:rgba(47,111,237,.08);}
[data-pmc-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a9099);}
[data-pmc-ok]{margin:8px 0;padding:6px 10px;border-radius:6px;background:#e8f6ee;color:#1f7a4d;font-size:12px;}
[data-pmc-chip]{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-bg-weak,rgba(128,128,128,.1));}
[data-pmc-chip="ok"]{background:#e6f5ec;color:#1a7f4b;}
[data-pmc-chip="warn"]{background:#fdf3e3;color:#b26a00;}
[data-pmc-chip="muted"]{background:rgba(128,128,128,.14);color:inherit;opacity:.75;}
[data-pmc-mono]{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all;}
[data-pmc-list]{margin:0;padding-left:18px;line-height:20px;}
[data-pmc-banner]{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;flex-direction:column;gap:4px;padding:9px 14px;font-size:12px;line-height:18px;box-shadow:0 1px 0 rgba(0,0,0,.08);}
[data-pmc-b-top]{font-weight:600;}
[data-pmc-b-sub]{opacity:.85;}
[data-pmc-b-acts]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;}
[data-pmc-banner="warn"]{background:#fef3c7;color:#7c4a03;}
[data-pmc-banner="danger"]{background:#fee2e2;color:#991b1b;}
[data-pmc-banner="ok"]{background:#e8f5ee;color:#22543d;}
[data-pmc-badge]{display:inline-flex;align-items:center;padding:1px 7px;border-radius:9px;font-size:11px;line-height:16px;border:1px solid #d6d3d1;color:#57534e;background:#fafaf9;}
[data-pmc-badge="on"]{border-color:#86efac;color:#166534;background:#f0fdf4;}
[data-pmc-badge="off"]{opacity:.6;}
[data-pmc-bx]{flex:none;appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;opacity:.65;}
[data-pmc-bx]:hover{opacity:1;}
`;

    const TRACK_LABELS = { memory: "长期记忆", user: "用户档案", project: "项目记忆", key: "关键事实", daily: "每日日志" };
    const TABS = [["guide", "指南"], ["config", "配置"], ["version", "版本"]];

    function TabBar({ tab, setTab }) {
      return h("div", { "data-pmc-tabs": "" },
        TABS.map(([id, label]) =>
          h("button", {
            key: id,
            type: "button",
            "data-pmc-tab": "",
            ...(tab === id ? { "data-on": "" } : {}),
            onClick: () => setTab(id),
          }, label),
        ));
    }

    /** 复制一条提示词给 agent：出问题时用户不用自己翻 README 找命令。 */
    function CopyButton({ text, label }) {
      const [status, setStatus] = React.useState("idle");
      const timerRef = React.useRef(null);
      React.useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      }, []);
      const onClick = async () => {
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
            throw new Error("当前环境不支持 navigator.clipboard.writeText");
          }
          await navigator.clipboard.writeText(text);
          setStatus("ok");
        } catch (e) {
          console.warn("[memory-core] 复制失败：" + (e?.message ?? e));
          setStatus("fail");
        }
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setStatus("idle"), 2000);
      };
      return h("button", { type: "button", "data-pmc-btn": "", onClick }, status === "ok" ? "已复制" : status === "fail" ? "复制失败" : label);
    }

    const COPY_FIX =
      "请检查 dsh-memory-core 的配置问题。先说明：问题是什么、原因是什么、不修会有什么影响；" +
      "确认后再动手。第一步仅做只读检查，不改任何文件，也不操作插件列表开关：\n" +
      "1. 请求 GET /api/memory-core/status 和 GET /api/memory-core/files，把 layer、memoryTracks、cwd、各轨路径贴出来。\n" +
      "2. 判断属于哪种情况：\n" +
      "   - layer 是 profile：说明它被插件列表开关拉起来了，跟记忆插件双写，建议关掉列表开关、只在目标 preset 里挂载；\n" +
      "   - full 模式但 cwd 为空：project / key 两轨定位不到文件，先确认会话的工作目录，或在调用 memory_core 时传 cwd；\n" +
      "   - 都不是：把报错原文和上面两个接口的返回给我。\n" +
      "3. 用一句话说明改哪一项、需要重启还是刷新即可，然后等我确认再动手。\n" +
      "不要自己重启 DSH（会导致当前会话中断）。";

    // 使用期提示词（对齐 dsh-memory-shield 的五条口径：分阶段、禁做清单带理由、固定交付格式、禁止 agent 自己重启）
    const COPY_UNDERSTAND =
      "我刚装了 dsh-memory-core（dsh-memory-shield 的配套包，为被遮蔽的会话提供独立记忆），想先搞清楚它是什么再决定用不用。\n" +
      "请读它的 README：先找本机 DSH profile 的 node_modules/dsh-memory-core/README.md（profile 名按实际；不确定就先看插件装在哪个 profile，再读那个目录），找不到就用文件名搜索确认，不要假设路径。用通俗语言讲四件事：\n" +
      "① 它和 dsh-memory-shield 是什么关系，两个都要装还是只装一个；\n" +
      "② 五条记忆轨分别存什么、哪些会进上下文、哪些不会；\n" +
      "③ 数据存在哪个目录，删掉 preset 会不会丢；\n" +
      "④ 默认就是 full 五轨，我需要改什么吗。\n" +
      "不要帮我改配置。";

    const COPY_HELP =
      "我想给被 dsh-memory-shield 遮蔽的会话加一套独立记忆（dsh-memory-core）。请分步带我，先只做只读检查，等我明确确认后再动手：\n" +
      "① 用 GET 查 <origin>/api/memory-core/status 和 <origin>/api/memory-shield/state（地址不对就用浏览器地址栏里的那个），告诉我 core 现在装在哪一层、有没有在 preset 里挂载、shield 有没有先在同一个 preset 里启用；\n" +
      "② 先确认我要用的那个 preset 存在（在 profile 的 cordis.patch.yml 里能找到），再告诉我要改哪个文件、改在哪儿：在已有 preset 的 plugins 列表里插两项——先 memory-shield（config.enabled: true），再挂 memory-core（config.presetName 填该 preset 的名称）。不要新写一个同名 preset 块（preset 的 config 是整体替换，会把其余插件清掉），也不要加到 dsh.profile.bundles 或 profile 层；\n" +
      "③ 提醒我两件事：core 默认 full 五轨，project 和 key 两条轨需要会话带工作目录，没有工作目录的会话这两轨会一直报「无法定位记忆轨」；装完后不要再打开插件列表里的开关，两个实例会抢同一个路由并整体加载失败；\n" +
      "④ 我确认后再动手：改前把 cordis.patch.yml 备份到同目录（加 .bak 和时间戳），只改这一处，改完把「改了哪个文件、备份在哪、怎么重启（按这台机器的正常习惯，但不要由你执行重启，会导致当前会话中断）、新建哪个会话、进去后怎么验证」列给我。";

    const COPY_TRACK =
      "我在用 dsh-memory-core 写记忆时报错：「无法定位记忆轨 \"project\"（项目记忆需要有效的会话工作目录）」。请帮我定位原因并给出我能做的动作，先只读、不要改任何文件：\n" +
      "① 看当前会话有没有工作目录（cwd）——full 模式下 project 和 key 两条轨必须靠它定位文件，没有 cwd 时这两轨既写不进也读不出，而且 project 本来就不进上下文，所以「空了」也看不出来（key 会注入摘要，能看出变化）；\n" +
      "② 告诉我这条会话的 cwd 是什么；如果没有，是为什么；\n" +
      "③ 三条可绕开的路，逐条说清代价：方案一：换一个带工作目录的会话；方案二：把 memoryTracks 切成 lite（只留 memory/user/key，key 落根目录、不依赖 cwd）；方案三：给这个会话指定工作目录（在会话或工作区设置里选目录）后重试——管理页顶部的 cwd 输入框只影响页面浏览，不改变会话的 cwd，照它重试无效；\n" +
      "④ 不要靠手改记忆文件绕过，也不要建议我删 projects 目录。\n" +
      "最后用一句话总结：我现在实际能用的有哪几轨。";

    const COPY_FORGET =
      "我发现切到 full 记忆模式后，之前在 lite 模式写进 key 轨的关键事实不见了。请先只读排查，别改任何记忆文件：\n" +
      "① 读记忆目录下的 key.md（根目录那份）和 projects/<哈希>/key.md，确认旧条目还在不在磁盘上；\n" +
      "② 如果旧条目在根目录、而 full 模式只读 projects/<哈希>/，就确认这是「切换模式后旧数据不可见」而不是数据丢失，并明确告诉我「数据还在，切回 lite 就能看到」；\n" +
      "③ 把根目录 key.md 的条目逐条列出来，问我要不要迁到项目目录（迁移必须带上原来的时间戳和 [id:xxxxxxxx] 身份证，不要改内容）；\n" +
      "④ 我确认后再动手，迁之前先把两个文件都备份。";

    const COPY_PENDING =
      "dsh-memory-core 的待确认队列里有几条我不确定要不要允许。请先只读：\n" +
      "① 列出队列里每条的 target、内容、以及写入时带的 reason（key 轨写入时会带理由，如果这里有理由而管理页没显示，请把理由一并念出来）；\n" +
      "② 告诉我这几条分别是什么时候、在哪个工作目录下产生的；\n" +
      "③ 对每一条用一句话说清「允许后会写进哪个文件、拒绝后这条就消失了」；\n" +
      "④ 不要代替我点允许或拒绝，我自己在管理页上操作。";

    const COPY_REVIEW =
      "帮我把 dsh-memory-core 里的记忆整体过一遍，先只读、不要改：\n" +
      "① 分别读 memory.md、user.md、projects/<当前项目哈希>/key.md、daily 最近 3 天；\n" +
      "② 指出三类问题：和其他条目重复或矛盾的、描述太模糊下次会误导的、应该从 key 降级到 daily 的；\n" +
      "③ 按「建议改动与理由」列成表，不要直接改；\n" +
      "④ 我看完挑几条让你改，你再动，并且改之前把对应文件备份。";

    const COPY_PAGE_ERROR =
      "我在 dsh-memory-core 的管理页操作时看到这个报错：「<把报错原文粘到这里>」。请先只读排查：\n" +
      "① 如果是「无法定位记忆轨」，说明管理页顶部的「当前会话工作目录」没填或填错，告诉我该填什么（填项目的绝对路径，填一次会记住）；\n" +
      "② 如果是「文件格式已损坏（无法往返解析），已备份到 …」，先读那个 .bak 文件确认内容完好，再告诉我怎么恢复，不要直接覆盖原文件；\n" +
      "③ 如果是「命中 N 条，无法确定是哪一条」，把候选条目的前 30 字列出来让我选；\n" +
      "④ 不要直接改记忆文件，除非我明确说改。";

    /** 开关：用原生 checkbox 承载语义，视觉上是一枚滑块。 */
    function Toggle({ on, disabled, onChange }) {
      return h("button", {
        type: "button",
        role: "switch",
        "aria-checked": on ? "true" : "false",
        "data-pmc-btn": "",
        ...(on ? { "data-on": "" } : {}),
        style: { minWidth: "56px", opacity: disabled ? 0.5 : 1 },
        disabled: !!disabled,
        onClick: () => onChange(!on),
      }, on ? "开" : "关");
    }

    function Guide() {
      return h("div", { "data-pmc-card": "" },
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "这是什么"),
          h("div", { "data-pmc-lead": "" },
            "给被 dsh-memory-shield 遮蔽的会话提供一套隔离记忆：独立数据目录，与普通会话的 dsh-memory-evolve 互不影响。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "五条记忆轨"),
          h("ul", { "data-pmc-list": "" },
            h("li", {}, "memory 长期记忆：跨项目通用事实，每轮注入。"),
            h("li", {}, "user 用户档案：关于用户的稳定偏好，每轮注入。"),
            h("li", {}, "project 项目日志：按工作目录哈希记录每回合进展，不注入、按需读取。"),
            h("li", {}, "key 项目关键记忆：下次会话不知道就会做错的事实，注入摘要，默认直接写入。"),
            h("li", {}, "daily 今日日志：按天记录，不注入。"))),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "怎么用"),
          h("div", { "data-pmc-lead": "" },
            "会话里用 memory_core 工具写入；管理页可新增、编辑、归档、删除，并处理待确认队列。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "插件列表显示已生效，这里为什么还是没有记忆"),
          h("div", { "data-pmc-lead": "" },
            "包装进 profile 就会加载，但配置里 memoryEnabled 默认是 false，所以它只挂管理页路由，不注册工具、也不注入上下文。" +
              "本页显示的状态来自当前 preset 的配置——只要这里的条数与路径是活的，就说明这个 preset 已经设了 memoryEnabled: true。" +
              "列表上的开关作用于 profile 层：打开后所有会话都会使用这套记忆，通常不需要。"),
          h("div", { "data-pmc-desc": "" },
            "警告：已通过 preset 挂载本包时，请勿再打开插件列表开关——两个实例会争用同一 /api/memory-core 路由，" +
              "后挂载的 preset 会报 duplicate prefix route 并整体加载失败。若误开启，关闭开关并重启，记忆数据不会丢失。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "看不懂？复制一条发给 agent"),
          h("div", { "data-pmc-desc": "" },
            "复制后粘贴到对话框，发给 agent。每条都会先做只读检查；需要改配置时，它会先问你再动手。"),
          h("div", { "data-pmc-row": "" },
            h(CopyButton, { text: COPY_UNDERSTAND, label: "让 agent 讲这个包" }),
            h(CopyButton, { text: COPY_HELP, label: "让 agent 带我启用" }),
            h(CopyButton, { text: COPY_TRACK, label: "无法定位记忆轨" }),
            h(CopyButton, { text: COPY_FORGET, label: "检查记忆是否生效" })),
          h("div", { "data-pmc-row": "" },
            h(CopyButton, { text: COPY_PENDING, label: "待确认队列讲解" }),
            h(CopyButton, { text: COPY_REVIEW, label: "帮我检查记忆" }),
            h(CopyButton, { text: COPY_PAGE_ERROR, label: "排查管理页错误" }))),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "致谢"),
          h("div", { "data-pmc-lead": "" },
            "存储层与注入预算参考 dsh-memory-evolve（作者 csyangwen，MIT）的实现，按隔离场景做了适配。")),
      );
    }

    function ConfigView({ cfg, save, saving }) {
      if (!cfg) return h("div", { "data-pmc-note": "" }, "配置读取中…");
      const full = cfg.memoryTracks === "full";
      const set = (patch) => save(patch);
      return h("div", { "data-pmc-card": "" },
        h("div", { "data-pmc-lead": "" }, "修改立即生效并持久化（写入本 preset 的覆盖层，不改 preset 本身）。"),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "记忆模式"),
          h("div", { "data-pmc-row": "" },
            h("button", { type: "button", "data-pmc-btn": "", ...(full ? {} : { "data-on": "" }), disabled: saving, onClick: () => set({ memoryTracks: "lite" }) }, "lite · 三轨"),
            h("button", { type: "button", "data-pmc-btn": "", ...(full ? { "data-on": "" } : {}), disabled: saving, onClick: () => set({ memoryTracks: "full" }) }, "full · 五轨"),
            h("span", { "data-pmc-chip": "ok" }, full ? "五轨" : "三轨")),
          h("div", { "data-pmc-desc": "" }, "lite 只开 memory / user / key；full 再加 project（按工作目录隔离）与 daily（按天记录）。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "三轨写入确认"),
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-val": "" }, "记忆 memory"),
            h(Toggle, { on: cfg.directMemory !== false, disabled: saving, onChange: (v) => set({ directMemory: v }) })),
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-val": "" }, "用户档案 user"),
            h(Toggle, { on: cfg.directUser !== false, disabled: saving, onChange: (v) => set({ directUser: v }) })),
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-val": "" }, "关键事实 key"),
            h(Toggle, { on: cfg.directKey !== false, disabled: saving, onChange: (v) => set({ directKey: v }) })),
          h("div", { "data-pmc-desc": "" }, "开＝写入直接落盘；关＝该轨改为进待确认队列。默认三轨全开。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "未写入提醒"),
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-val": "" }, "开启后：连续多轮没写记忆时在快照末尾提醒"),
            h(Toggle, { on: cfg.perTurnWriteGuard === true, disabled: saving, onChange: (v) => set({ perTurnWriteGuard: v }) }))),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "提醒阈值（轮）"),
          h("div", { "data-pmc-row": "" },
            h("input", {
              type: "number",
              min: 1,
              step: 1,
              "data-pmc-num": "",
              defaultValue: cfg.writeGuardThreshold,
              disabled: saving,
              onBlur: (e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isInteger(n) && n >= 1 && n !== cfg.writeGuardThreshold) set({ writeGuardThreshold: n });
              },
            }),
            h("span", { "data-pmc-val": "" }, "连续 N 轮没写记忆就提醒一次（填 2 表示容忍漏 1 轮）")),
          h("div", { "data-pmc-desc": "" }, "失焦即保存。小于 1 的值会被忽略。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "快照顺序"),
          h("div", { "data-pmc-row": "" },
            h("input", {
              type: "number",
              step: 10,
              "data-pmc-num": "",
              defaultValue: cfg.snapshotOrder,
              disabled: saving,
              onBlur: (e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isInteger(n) && n !== cfg.snapshotOrder) set({ snapshotOrder: n });
              },
            }),
            h("span", { "data-pmc-val": "" }, "注入段在同名段里的排序")),
          h("div", { "data-pmc-desc": "" }, "顺序改动要重启 DSH 才对已存在的会话生效（挂载时注册）。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "告警横幅"),
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-val": "" }, "在页面顶部提示配置问题（如 full 模式没有工作目录）"),
            h(Toggle, { on: cfg.bannerEnabled !== false, disabled: saving, onChange: (v) => set({ bannerEnabled: v }) })),
          h("div", { "data-pmc-desc": "" }, "只影响显示，不影响记忆读写。关掉后要恢复，回到这里再打开。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-name": "" }, "覆盖层文件"),
            h("span", { "data-pmc-val": "", "data-pmc-mono": "" }, cfg.livePath || "—"))),
        saving ? h("div", { "data-pmc-note": "" }, "保存中…") : null,
      );
    }

    function Version({ cfg }) {
      return h("div", { "data-pmc-card": "" },
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "版本"),
          h("div", { "data-pmc-row": "" }, h("span", { "data-pmc-val": "" }, "dsh-memory-core 0.1.5"))),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "本版要点"),
          h("ul", { "data-pmc-list": "" },
            h("li", {}, "子代理会话只读：除 list 外的写操作一律拒绝，避免两条上下文各写一份。"),
            h("li", {}, "告警横幅补「full 模式无工作目录」与「待确认堆积」，并加总开关（配置页签）。"),
            h("li", {}, "请求体上限 64 KB，超限回 413，不再先读进内存。"),
            h("li", {}, "管理页、注入、五轨与 evolve 对齐；配置可在此页修改，立即生效。"))),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-row": "" },
            h("a", { href: "/api/memory-core/manage", target: "_blank", rel: "noopener", "data-pmc-open": "" }, "打开记忆管理页"),
            h("span", { "data-pmc-note": "" }, cfg?.presetName ? "preset " + cfg.presetName : ""))),
      );
    }

    function Panel() {
      const [st, setSt] = React.useState(null);
      const [cfg, setCfg] = React.useState(null);
      const [tab, setTab] = React.useState("guide");
      const [saving, setSaving] = React.useState(false);
      const [err, setErr] = React.useState("");
      const [saveErr, setSaveErr] = React.useState("");
      const [saved, setSaved] = React.useState("");
      const savedTimer = React.useRef(null);
      React.useEffect(() => () => {
        if (savedTimer.current) clearTimeout(savedTimer.current);
      }, []);

      const load = React.useCallback(async () => {
        try {
          const [j, c] = await Promise.all([jget("/files"), jget("/config")]);
          if (!j.ok) throw new Error(j.why || "状态读取失败");
          const d = j.data;
          const rows = Array.isArray(d.rows) ? d.rows : [];
          setSt({
            rows,
            mode: d.memoryTracks,
            preset: d.presetName,
            dir: d.memoryDir,
            pending: rows.reduce((a, r) => a + (r.pending || 0), 0),
            archived: rows.reduce((a, r) => a + (r.archived || 0), 0),
            needCwd: rows.some((r) => r.track === "project" || r.track === "key") && !d.cwd,
          });
          if (c && c.ok) setCfg(c.data);
          setErr("");
        } catch (e) {
          setErr(String(e?.message || e));
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      const save = React.useCallback(async (patch) => {
        setSaving(true);
        setSaveErr("");
        try {
          const j = await jpost("/config", { patch });
          if (!j.ok) throw new Error(j.why || "保存失败");
          setCfg(j.data);
          setSaved("已保存并生效");
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaved(""), 2500);
          await load();
        } catch (e) {
          // 保存失败与读取失败分开：共用 setErr 会把「保存失败」渲染成「状态读取失败」，
          // 让用户以为插件坏了（wb P1-N1）。
          setSaveErr(String(e?.message || e));
        } finally {
          setSaving(false);
        }
      }, [load]);

      if (err) {
        return h("div", { "data-pmc-page": "" },
          h("div", { "data-pmc-note": "" }, "状态读取失败：" + err),
          h("div", { "data-pmc-row": "" },
            h("button", { type: "button", "data-pmc-btn": "", onClick: () => { setErr(""); load(); } }, "重试"),
            h(CopyButton, { text: COPY_FIX, label: "复制修复提示词" })));
      }
      if (!st) return h("div", { "data-pmc-page": "" }, h("div", { "data-pmc-note": "" }, "读取中…"));

      const full = st.mode === "full";

      return h("div", { "data-pmc-page": "" },
        h("div", { "data-pmc-head": "" },
          h("span", { "data-pmc-title": "" }, "遮蔽会话记忆"),
          h("span", { "data-pmc-sub": "" }, "preset " + (st.preset || "—") + " · 与普通会话完全隔离"),
          h("span", { "data-pmc-chip": "ok" }, full ? "五轨" : "三轨"),
          h("span", { "data-pmc-chip": st.pending > 0 ? "warn" : "" },
            st.pending > 0 ? st.pending + " 条待确认" : "待确认：无")),
        h(TabBar, { tab, setTab }),
        saved ? h("div", { "data-pmc-ok": "" }, "✓ " + saved) : null,
        saveErr ? h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-note": "" }, "保存失败：" + saveErr),
          h("div", { "data-pmc-row": "" }, h(CopyButton, { text: COPY_FIX, label: "复制修复提示词" }))) : null,
        tab === "guide" ? h(Guide) : null,
        tab === "config" ? h(ConfigView, { cfg, save, saving }) : null,
        tab === "version" ? h(Version, { cfg }) : null,
        h("div", { "data-pmc-sec": "" },
          ...st.rows.map((r) =>
            h("div", { "data-pmc-row": "", key: r.track },
              h("span", { "data-pmc-name": "" }, TRACK_LABELS[r.track] || r.track),
              h("span", { "data-pmc-val": "" }, r.available ? `${r.count || 0} 条 · ${r.path || ""}` : "需会话工作目录"),
              r.pending > 0 ? h("span", { "data-pmc-chip": "warn" }, `${r.pending} 待确认`) : null,
              r.archived > 0 ? h("span", { "data-pmc-chip": "muted" }, `归档 ${r.archived}`) : null,
            ),
          )),
        h("div", { "data-pmc-note": "" },
          "数据目录：" + (st.dir || "—") + (st.needCwd
            ? "。项目记忆与关键事实按会话工作目录隔离，管理页会读取地址栏或它自己记住的工作目录。"
            : "。")),
      );
    }

    /**
     * 顶部横幅：把「配置方式不对」的隐形代价变成看得见的告警。
     *
     * 两种危险状况各一档：
     * - 红：遮蔽在 profile 层生效（插件列表开关），所有会话的记忆工具与注入都被挡掉——这是全局破坏；
     * - 黄：记忆核在 profile 层生效（没在 preset 里挂），所有会话多一份隔离记忆并与 evolve 双写。
     * 判定只读两个插件的公开状态接口，不改任何配置；用户关掉横幅只在当前页面生效（不持久化）。
     */
    // 多个插件的顶部横幅都固定在 top:0，会互相盖住；按 DOM 顺序统一往下排。
    function relayoutBanners() {
      const els = document.querySelectorAll('[data-pmc-banner],[data-ms-overlay],[data-bl-overlay]');
      let top = 0;
      for (const el of els) {
        const height = el.offsetHeight;
        if (!height) continue;
        el.style.top = top + 'px';
        top += height;
      }
    }
    if (typeof window !== 'undefined' && !window.__dshBannerRelayout) {
      window.__dshBannerRelayout = setInterval(relayoutBanners, 2000);
      setTimeout(relayoutBanners, 300);
    }

    function Banner() {
      const [state, setState] = React.useState(null);
      const [hidden, setHidden] = React.useState(false);
      const [probeFailed, setProbeFailed] = React.useState(false);
      // 绿条只弹一次的浏览器兜底：服务端覆盖层写不进去时（路由 404 / 旧实例），
      // 至少同一个浏览器不再每次刷新都被同一条「就绪」提示打断。
      const hintSeenInBrowser = () => {
        try { return localStorage.getItem("pmc-loaded-hint") === "1"; } catch { return false; }
      };
      const rememberHintInBrowser = () => {
        try { localStorage.setItem("pmc-loaded-hint", "1"); } catch {}
      };
      const tick = React.useCallback(async () => {
        const [core, shield] = await Promise.all([
          jget("/status").catch(() => null),
          fetch("/api/memory-shield/health", { credentials: "same-origin" })
            .then((r) => r.json())
            .catch(() => null),
        ]);
        // C4（wb 横幅测试）：两个状态接口全失败＝插件可能整个没起来，界面却看不出异常。
        // 这时连 bannerEnabled 都读不到，先按「可能坏了」提醒；用户点关闭即本次隐藏。
        if (!core && !shield) {
          setProbeFailed(true);
          return;
        }
        setProbeFailed(false);
        const c = core?.data ?? {};
        const sh = shield?.data ?? shield ?? {};
        // 总开关（core 配置页「告警横幅」）：关掉后 core 侧任何黄警都不渲染。
        if (c.bannerEnabled === false) {
          setState(null);
          return;
        }
        if (sh.layer === "profile" && sh.enabled === true && (sh.shadowTools || 0) > 0) {
          setState({
            kind: "danger",
            top: "记忆遮蔽正在全局生效：已拦截 " + (sh.shadowTools || 0) + " 个记忆工具；记忆类工具只剩 memory_core。",
            sub: "影响：所有会话的记忆注入与记忆工具都被拦截；数据未删除，其他记忆插件也仍按各自路径写入。",
            acts: ["fix", "learn"],
          });
        } else if (c.layer === "profile") {
          setState({
            kind: "warn",
            top: "dsh-memory-core 由插件列表开关启用，未挂载到 preset：所有会话都会多出一套隔离记忆工具与注入。",
            sub: "未修复的影响：与记忆插件重复写入，同一事实被重复记录，读取时需分别查询；数据目录：" + (c.memoryDir || "（未知目录）") + "。",
            acts: ["fix", "learn"],
          });
        } else if (c.layer === "preset" && c.presetName === "default") {
          // 没配置 presetName：多个 preset 会落到同一个 default 目录，隔离承诺静默失效。
          setState({
            kind: "warn",
            top: "未配置 presetName：记忆落在默认的 default 目录，多个 preset 会共用同一份记忆。",
            sub: "未修复的影响：你以为两个会话互相隔离，实际共享同一套记忆。请在 preset 里给 memory-core 设 config.presetName，或在配置页填写数据目录。",
            acts: ["fix", "manage", "learn"],
          });
        } else if (c.memoryTracks === "full" && c.cwdSource === "missing") {
          // full（默认档）下 project 与 key 要靠会话 cwd 定位。
          // 只在服务端明确「查到会话、但它没有 cwd」时报警；HTTP 路由查不到 cwd 属于未知，不能当成没有。
          setState({
            kind: "warn",
            top: "full 模式（默认）下当前会话没有工作目录：project 与 key 两轨无法定位文件。",
            sub: "未修复的影响：项目进展写入会失败，后续会话无法读取。请为会话设置工作目录，或调用 memory_core 时传 cwd=项目根目录。",
            acts: ["fix", "learn"],
          });
        } else if ((c.secondaryInstances || 0) > 0) {
          // C10：同进程里第二个实例只登记、不注册，不报错，表现为「装了两份只有一份在干活」。
          setState({
            kind: "warn",
            top: "检测到 " + c.secondaryInstances + " 个重复实例：dsh-memory-core 在同一进程中被加载了多份。",
            sub: "仅第一份注册工具与路由，其余只登记；未修复的影响：修改可能落在非生效实例上。请关闭插件列表开关，或删除多余的 preset 挂载后重启。",
            acts: ["fix", "learn"],
          });
        } else if (c.orphanKey === true) {
          // C7：lite 时代写在根目录的 key.md，切到 full 后按 projects/<hash>/key.md 解析，读不到也不报错。
          setState({
            kind: "warn",
            top: "full 模式下根目录仍保留一份旧 key.md（lite 时期写入），当前仅读取 projects/<hash>/key.md。",
            sub: "未修复的影响：这批关键事实不会进入上下文，后续会话读不到。处理方式：把根目录那份并进当前项目目录，或在配置页切回 lite 读取。",
            acts: ["fix", "manage", "learn"],
          });
        } else if ((c.driftBackups || 0) > 0) {
          // C9：replace/remove 撞上被外部改动的文件会拒绝重写并备份，用户以为改成功了。
          setState({
            kind: "warn",
            top: "检测到 " + c.driftBackups + " 份因外部改动而保留的备份（*.bak.*）：有内容没有合并回记忆文件。",
            sub: "原因：文件曾被插件之外的操作改动，工具拒绝覆盖并保留备份。请逐份比对后重新写入所需内容，确认无误再删除备份。",
            acts: ["fix", "manage", "learn"],
          });
        } else if ((c.pendingTotal ?? c.pendingKey ?? 0) >= 3) {
          // C8：任何一轨的待确认都会一直堆着，不处理就不进上下文，用户以为记了其实没生效。
          // 原来只看 key，关掉 memory/user 直写后那两轨堆了也不会提示。
          const ptotal = c.pendingTotal ?? c.pendingKey ?? 0;
          setState({
            kind: "warn",
            top: "有 " + ptotal + " 条记忆待确认：未确认条目不进入上下文，视为未记录。",
            sub: "请到记忆管理页的「待确认」页签允许或拒绝；允许后于下一轮生效。",
            acts: ["fix", "manage", "learn"],
          });
        } else if (c.loadedHintShown !== true && !hintSeenInBrowser()) {
          // 绿条：用户把 core 挂进 preset、一路没出黄警，说明记忆真的在跑。
          // 只在「第一次成功」时弹一次（服务端 loadedHintShown；服务端写不进去时用浏览器兜底）。
          rememberHintInBrowser();
          setState({
            kind: "ok",
            top: (c.memoryTracks === "lite"
              ? "记忆已就绪。三轨已启用：memory、user、key（lite 模式）。"
              : "记忆已就绪。五轨已启用：memory、user、project、key、daily。")
              + "写入目录：" + (c.memoryDir || "（未知目录）") + "。",
            sub: "记忆模式、各轨条数与记忆管理页入口位于「设置 → 插件 → dsh-memory-core」详情页。该提示仅显示一次。",
            acts: ["manage", "ok"],
          });
        } else {
          setState(null);
        }
      }, []);
      React.useEffect(() => {
        let alive = true;
        const run = () => {
          if (alive) tick();
        };
        run();
        const id = setInterval(run, 30000);
        return () => {
          alive = false;
          clearInterval(id);
        };
      }, [tick]);
      if (probeFailed) {
        return h("div", { "data-pmc-banner": "warn", role: "alert" },
          h("div", { "data-pmc-b-top": "" }, "警告：无法读取 dsh-memory-core / dsh-memory-shield 状态接口。"),
          h("div", { "data-pmc-b-sub": "" }, "可能是插件没加载，或 /api/memory-core 路由被别的实例占了；此时记忆读写通常也不可用。"),
          h("div", { "data-pmc-b-acts": "" },
            h(CopyButton, { text: COPY_FIX, label: "复制修复提示词" }),
            h("button", { "data-pmc-bx": "", onClick: () => { setProbeFailed(false); tick(); } }, "重试"),
            h("button", { "data-pmc-bx": "", onClick: () => setHidden(true) }, "关闭")));
      }
      if (!state || hidden) return null;
      const acts = state.acts || ["fix"];
      const ackLoaded = () => {
        setState(null);
        jpost("/config", { patch: { loadedHintShown: true } }).catch(() => {});
      };
      return h("div", { "data-pmc-banner": state.kind, role: "alert" },
        h("div", { "data-pmc-b-top": "" }, (state.kind === "danger" ? "严重警告：" : state.kind === "ok" ? "" : "警告：") + state.top),
        state.sub ? h("div", { "data-pmc-b-sub": "" }, state.sub) : null,
        h("div", { "data-pmc-b-acts": "" },
          acts.includes("fix") ? h(CopyButton, { text: COPY_FIX, label: "复制修复提示词" }) : null,
          acts.includes("learn") ? h(CopyButton, { text: COPY_UNDERSTAND, label: "让 agent 讲这个插件" }) : null,
          acts.includes("manage") ? h("a", { href: "/api/memory-core/manage", target: "_blank", rel: "noopener" }, "打开管理页") : null,
          acts.includes("ok") ? h("button", { "data-pmc-bx": "", onClick: ackLoaded }, "知道了") : null,
          // 绿条只有「知道了」（一次性确认），黄/红才有「关闭」（本次隐藏）。
          state.kind === "ok" ? null : h("button", { "data-pmc-bx": "", onClick: () => setHidden(true) }, "关闭")));
    }

    // 详情页徽章（plugins.detail.badge，keyed 用 key）：显示当前模式，不读健康状态。
    function DetailBadge() {
      const [cfg, setCfg] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        jget("/config").then((j) => {
          if (alive && j.ok) setCfg(j.data);
        }).catch(() => {});
        return () => {
          alive = false;
        };
      }, []);
      const full = cfg ? cfg.memoryTracks === "full" : null;
      return h("span", { "data-pmc-badge": full === null ? "off" : "on" },
        full === null ? "读取中…" : full ? "五轨" : "三轨");
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        const style = document.createElement("style");
        style.setAttribute("data-plugin-css", PKG);
        style.textContent = CSS;
        document.head.appendChild(style);
        if (typeof ctx.effect === "function") ctx.effect(() => () => style.remove(), `${PKG}: 面板样式`);

        const slots = (typeof ctx.get === "function" ? ctx.get("slots") : undefined) || ctx.slots;
        if (!slots) return;
        slots.inject("plugins.bundle.config", () => slots.register(
          { name: "plugins.bundle.config", key: PKG },
          Panel,
        ));
        // 顶部横幅走 shell.overlay（list 型槽位，用 id）
        slots.inject("shell.overlay", () => slots.register(
          { name: "shell.overlay", id: "memory-core-banner" },
          Banner,
        ));
        // 插件详情页徽章（keyed 型槽位，用 key）：与 shield 的 DetailBadge 同位置
        slots.inject("plugins.detail.badge", () => slots.register(
          { name: "plugins.detail.badge", key: PKG },
          DetailBadge,
        ));
      },
    };
  },
});
