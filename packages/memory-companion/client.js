/**
 * dsh-memory-core —— 浏览器半端：插件详情页的状态面板。
 *
 * 显示当前模式、各轨记忆条数、待确认队列，以及打开独立管理页 manage.html 的按钮。
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

    const CSS = `
[data-pmc-page]{display:flex;flex-direction:column;gap:10px;padding:4px 2px 10px;max-width:640px;font-size:13px;}
[data-pmc-head]{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
[data-pmc-title]{font-size:14px;font-weight:600;}
[data-pmc-sub]{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9099);}
[data-pmc-sec]{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));padding-top:10px;}
[data-pmc-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:26px;}
[data-pmc-name]{min-width:100px;flex:none;}
[data-pmc-val]{flex:1;color:var(--dsw-alias-label-secondary,#6b7280);}
[data-pmc-btn]{font-size:12px;min-height:26px;padding:2px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:transparent;color:inherit;flex:none;}
[data-pmc-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a9099);}
[data-pmc-chip]{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-bg-weak,rgba(128,128,128,.1));}
[data-pmc-chip="ok"]{background:#e6f5ec;color:#1a7f4b;}
[data-pmc-chip="warn"]{background:#fdf3e3;color:#b26a00;}
`;

    const TRACKS_LITE = ["memory", "user", "key"];
    const TRACKS_FULL = ["memory", "user", "project", "key", "daily"];
    const TRACK_LABELS = { memory: "长期记忆", user: "用户档案", project: "项目记忆", key: "关键事实", daily: "每日日志" };

    function Panel() {
      const [st, setSt] = React.useState(null);
      const [err, setErr] = React.useState("");

      const load = React.useCallback(async () => {
        try {
          // 拉各轨条数
          const tracks = TRACKS_LITE; // 默认 lite，full 模式需要切配置
          const counts = {};
          for (const t of tracks) {
            try {
              const j = await jget(`/entries?track=${t}`);
              counts[t] = j.ok ? j.data.count : 0;
            } catch { counts[t] = 0; }
          }
          // 拉待确认
          let pendingCount = 0;
          try {
            const p = await jget("/pending");
            pendingCount = p.ok ? p.data.count : 0;
          } catch {}
          setSt({ counts, pendingCount, tracks });
          setErr("");
        } catch (e) {
          setErr(String(e?.message || e));
        }
      }, []);

      React.useEffect(() => {
        load();
        const t = setInterval(load, 10000);
        return () => clearInterval(t);
      }, [load]);

      if (err) return h("div", { "data-pmc-page": "" }, h("div", { "data-pmc-note": "" }, "状态读取失败：" + err));
      if (!st) return h("div", { "data-pmc-page": "" }, h("div", { "data-pmc-note": "" }, "读取中…"));

      return h("div", { "data-pmc-page": "" },
        h("div", { "data-pmc-head": "" },
          h("span", { "data-pmc-title": "" }, "遮蔽会话记忆"),
          h("span", { "data-pmc-sub": "" }, "companion 模式 · 数据与普通会话完全隔离")),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-name": "" }, "当前模式"),
            h("span", { "data-pmc-val": "" }, "lite（三轨 memory/user/key）"),
            h("span", { "data-pmc-chip": "ok" }, "默认")),
          h("div", { "data-pmc-row": "" },
            h("span", { "data-pmc-name": "" }, "待确认记忆"),
            h("span", { "data-pmc-val": "" }, st.pendingCount > 0 ? `${st.pendingCount} 条待确认` : "无"),
            st.pendingCount > 0 ? h("span", { "data-pmc-chip": "warn" }, "需处理") : null)),
        h("div", { "data-pmc-sec": "" },
          ...st.tracks.map((t) =>
            h("div", { "data-pmc-row": "", key: t },
              h("span", { "data-pmc-name": "" }, TRACK_LABELS[t] || t),
              h("span", { "data-pmc-val": "" }, `${st.counts[t] || 0} 条`),
            ),
          )),
        h("div", { "data-pmc-sec": "" },
          h("div", { "data-pmc-row": "" },
            h("a", { href: "/api/memory-core/manage", target: "_blank", rel: "noopener", "data-pmc-btn": "" }, "打开记忆管理面板"),
          ),
          h("div", { "data-pmc-note": "" },
            "管理面板在独立窗口打开，可查看/修改/归档各轨记忆。升级到 full 模式（五轨）需在配置里改 memoryTracks=full。")),
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
      },
    };
  },
});
