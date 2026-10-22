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
[data-pmc-chip]{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-bg-weak,rgba(128,128,128,.1));}
[data-pmc-chip="ok"]{background:#e6f5ec;color:#1a7f4b;}
[data-pmc-chip="warn"]{background:#fdf3e3;color:#b26a00;}
[data-pmc-chip="muted"]{background:rgba(128,128,128,.14);color:inherit;opacity:.75;}
[data-pmc-mono]{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all;}
[data-pmc-list]{margin:0;padding-left:18px;line-height:20px;}
[data-pmc-banner]{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;align-items:flex-start;gap:10px;padding:9px 14px;font-size:12px;line-height:18px;box-shadow:0 1px 0 rgba(0,0,0,.08);}
[data-pmc-banner="warn"]{background:#fef3c7;color:#7c4a03;}
[data-pmc-banner="danger"]{background:#fee2e2;color:#991b1b;}
[data-pmc-bx]{margin-left:auto;flex:none;appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;opacity:.65;}
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
            h("li", {}, "key 项目关键记忆：下次会话不知道就会做错的事实，注入摘要，写入需确认。"),
            h("li", {}, "daily 今日日志：按天记录，不注入。"))),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "怎么用"),
          h("div", { "data-pmc-lead": "" },
            "会话里用 memory_core 工具写入；管理页可新增、编辑、归档、删除，并处理待确认队列。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "插件列表里为什么显示「已关闭」"),
          h("div", { "data-pmc-lead": "" },
            "包自带硬开关（patch 里 disabled: true）：装进 profile 只是加载，默认不跑，避免给所有会话都塞一套记忆。" +
              "本页显示的状态来自 preset 里的显式挂载——只要这里的条数与路径是活的，就说明它在工作。" +
              "列表上的开关管的是 profile 层，打开等于让所有会话都用这套记忆，一般不需要。"),
          h("div", { "data-pmc-desc": "" },
            "注意：如果已经用 preset 挂载了本包，不要再打开列表开关——两个实例会抢同一个 /api/memory-core 路由，" +
              "后挂载的 preset 会报 duplicate prefix route 并整体加载失败。误开了就关掉开关、重启，数据不会丢。")),
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
          h("div", { "data-pmc-desc": "" }, "lite 只开 memory / user / key；full 再加 project 与 daily（按会话工作目录隔离）。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "记忆写入看门狗"),
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-val": "" }, "连续多轮没写记忆时在快照里提醒"),
            h(Toggle, { on: cfg.writeGuard === true, disabled: saving, onChange: (v) => set({ writeGuard: v }) })),
          h("div", { "data-pmc-desc": "" }, "关掉后 key 轨写入也不再进待确认队列，直接落盘。")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "看门狗阈值（轮）"),
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
            h("span", { "data-pmc-val": "" }, "连续 N 轮未写入即提醒（2 = 容忍漏 1 轮）")),
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
          h("div", { "data-pmc-row": "" }, h("span", { "data-pmc-val": "" }, "dsh-memory-core 0.1.4"))),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-h": "" }, "本版要点"),
          h("ul", { "data-pmc-list": "" },
            h("li", {}, "默认 full 五轨；数据落点仍是本 preset 的独立目录。"),
            h("li", {}, "管理页按 memory-evolve 的形制重做：页签、条数、路径、美观/纯文本切换、搜索。"),
            h("li", {}, "注入前净化 {{}}，避免记忆正文被宿主当模板解析。"),
            h("li", {}, "配置可在此页修改，立即生效。"))),
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
        try {
          const j = await jpost("/config", { patch });
          if (!j.ok) throw new Error(j.why || "保存失败");
          setCfg(j.data);
          await load();
        } catch (e) {
          setErr(String(e?.message || e));
        } finally {
          setSaving(false);
        }
      }, [load]);

      if (err) return h("div", { "data-pmc-page": "" }, h("div", { "data-pmc-note": "" }, "状态读取失败：" + err));
      if (!st) return h("div", { "data-pmc-page": "" }, h("div", { "data-pmc-note": "" }, "读取中…"));

      const full = st.mode === "full";

      return h("div", { "data-pmc-page": "" },
        h("div", { "data-pmc-head": "" },
          h("span", { "data-pmc-title": "" }, "遮蔽会话记忆"),
          h("span", { "data-pmc-sub": "" }, "preset " + (st.preset || "—") + " · 与普通会话完全隔离"),
          h("span", { "data-pmc-chip": "ok" }, full ? "五轨" : "三轨"),
          st.pending > 0 ? h("span", { "data-pmc-chip": "warn" }, st.pending + " 条待确认") : null),
        h(TabBar, { tab, setTab }),
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
            ? "。项目记忆与关键事实按会话工作目录隔离，管理页会自动带上当前 cwd。"
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
    function Banner() {
      const [state, setState] = React.useState(null);
      const [hidden, setHidden] = React.useState(false);
      React.useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const [core, shield] = await Promise.all([
              jget("/status").catch(() => null),
              fetch("/api/memory-shield/health", { credentials: "same-origin" })
                .then((r) => r.json())
                .catch(() => null),
            ]);
            if (!alive) return;
            const c = core?.data ?? {};
            const sh = shield?.data ?? shield ?? {};
            if (sh.layer === "profile" && sh.enabled === true && (sh.shadowTools || 0) > 0) {
              setState({
                kind: "danger",
                text:
                  "记忆遮蔽正在全局生效：所有会话的记忆工具与上下文段都被挡掉，只剩 memory_core。" +
                  "这是全局破坏性配置，请立刻关掉插件列表里的 dsh-memory-shield 开关，改成只在目标 preset 里挂载并开 enabled。",
              });
            } else if (c.layer === "profile") {
              setState({
                kind: "warn",
                text:
                  "dsh-memory-core 是被插件列表开关拉起来的（没在 preset 里挂）：所有会话都会多一份隔离记忆，" +
                  "并与记忆插件双写；数据落在 " + (c.memoryDir || "（未知目录）") + "。建议关掉列表开关，只在目标 preset 里挂载它。",
              });
            } else {
              setState(null);
            }
          } catch {
            if (alive) setState(null);
          }
        };
        tick();
        const id = setInterval(tick, 30000);
        return () => {
          alive = false;
          clearInterval(id);
        };
      }, []);
      if (!state || hidden) return null;
      return h("div", { "data-pmc-banner": state.kind, role: "alert" },
        h("span", null, (state.kind === "danger" ? "⛔ " : "⚠️ ") + state.text),
        h("button", { "data-pmc-bx": "", onClick: () => setHidden(true) }, "关闭"),
      );
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
      },
    };
  },
});
