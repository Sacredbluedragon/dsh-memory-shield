/**
 * dsh-memory-shield —— 浏览器半端：提示横幅 + 状态标签 + 设置页面板。
 *
 * profile 层提示：
 *   - shell.overlay：缺启用横幅（「已安装，默认不启用」）
 *   - plugins.detail.badge：详情页标签（未启用/已启用）
 *   - settings.section：设置页双面板
 *
 * 主题可覆盖点（无需改本文件）：
 *   --ms-overlay-z  顶部提示横幅的层级，默认 9999。
 *                   其它插件若需要盖住这条横幅，只需在 :root / body 上把
 *                   --ms-overlay-z 设成更大的值即可，不必与本文件的字面量抢层级。
 *
 * 状态来源：
 *   三个组件与 apply() 都读 /api/memory-shield/state，统一走 fetchState()，
 *   同一时刻只允许一个请求在飞（去重），成功后缓存给后挂载的组件。
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-shield',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const PKG = 'dsh-memory-shield'
    const API = '/api/memory-shield'
    const TAG = '[memory-shield]'

    // 提示词里给 agent 的接口地址取当前页面 origin，不写死端口（用户改过端口时也成立）。
    const ORIGIN = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://127.0.0.1:3080'

// 三段「引导型」提示词：只让 agent 读懂并汇报，明确禁止代改配置。
    const COPY_UNDERSTAND = '我刚装了 dsh-memory-shield，帮我读它的 README，说明它的用途和用法。README 在当前 DSH profile 的 node_modules/dsh-memory-shield/README.md（profile 名按实际，通常是 web；不确定就先看插件装在哪个 profile，再读那个目录），路径不对就用文件名搜一下，不要假设路径。用通俗语言讲三点：它遮蔽了什么、只影响哪些会话、为什么默认关闭。不要帮我改配置。'
    const COPY_MEMORY_CORE = 'dsh-memory-shield 有个配套包 dsh-memory-core（隔离记忆包），我想了解它的用途，以及在什么情况下需要安装它。帮我读它的 README：先找本机 DSH profile 的 node_modules/dsh-memory-core/README.md（profile 名按实际，通常是 web），找不到就看项目主页的 packages/dsh-memory-core 目录；仓库打不开就停下告诉我，别猜。用通俗语言讲清它和 shield 的关系、记忆存在哪、怎么启用。不要帮我安装或改配置。'
    const COPY_DIAGNOSE = '帮我看看记忆遮蔽现在是什么状态。先试调用 shadow_diagnose 工具；如果它不存在（报 unknown tool），说明当前会话没挂 dsh-memory-shield，就改用只读接口 ' + ORIGIN + '/api/memory-shield/state 和 /health 看（地址不对就用浏览器地址栏里的那个），再把两边对不上的地方说清楚。并说明这是哪一层看的、这个会话本身是不是被遮蔽的通道。两个来源的数字口径不同（工具报配置数组长度、/health 报去重后的实际生效数），不要当成不一致。然后用一句话告诉我这个状态意味着什么、我下一步要不要启用。不要帮我改任何配置。'
    const COPY_HELP = '我想使用 dsh-memory-shield 这个记忆遮蔽插件，但不了解它的配置。请分步说明，先做只读检查，确认后再动手：①用 GET 查 ' + ORIGIN + '/api/memory-shield/state 和 /health（地址不对就用浏览器地址栏里的那个），告诉我它现在装在哪一层、有没有启用、挂在哪个 preset（以 /state 的 layer 和 presetName 为准；layer 是 profile 且 enabled 为 false，就是装了但没挂到任何 preset，等于没启用）；②先确认我要用的那个 preset 存在（在 profile 的 cordis.patch.yml 里能找到），并说明启用需要修改哪个文件、改在何处：必须是在已有 preset 的 plugins 列表里插一项 - id: memory-shield / name: dsh-memory-shield / config: {enabled: true}，不要新写一个同名 preset 块（preset 的 config 是整体替换，会把其余插件清掉），也不要加到 dsh.profile.bundles 或 profile 层（会和全局记忆插件撞名）；并说明三点影响：① 只有该 preset 下的会话看不到记忆，其他会话不受影响；② 消息级注入拦不住；③ 需重启并新建该 preset 的会话才生效；③默认复用现成的 preset，遮蔽名单用默认的就行（已覆盖常见记忆插件），只有我装了名单外的插件时才问我；④我确认后再动手：改前把 cordis.patch.yml 备份到同目录（文件名加 .bak 和时间戳），只改这一处，改完把「改了哪个文件+备份在哪+重启方式（按这台机器的正常习惯，但不要由你执行重启，会导致当前会话中断）+新建哪个会话+进去后怎么验证」列给我。'
    const COPY_HINT = '复制后粘贴至对话框并发送。'

    const jget = async (p) => {
      const res = await fetch(API + p, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }
    const jpost = async (p, body) => {
      const res = await fetch(API + p, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    const CSS = `
[data-ms-page]{display:flex;flex-direction:column;gap:10px;padding:4px 2px 10px;max-width:640px;font-size:13px;}
[data-ms-title]{font-size:14px;font-weight:600;}
[data-ms-sub]{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9099);line-height:1.6;}
[data-ms-sec]{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));padding-top:10px;}
[data-ms-sec-title]{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);}
[data-ms-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:28px;}
[data-ms-btn]{font-size:12px;min-height:26px;padding:2px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:transparent;color:inherit;flex:none;}
[data-ms-btn="primary"]{background:var(--dsw-alias-accent,#2f6fed);border-color:var(--dsw-alias-accent,#2f6fed);color:#fff;}
[data-ms-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a9099);}
[data-ms-badge]{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;}
[data-ms-badge="off"]{background:#6b7280;color:#fff;}
[data-ms-badge="on"]{background:#3c9a5f;color:#fff;}
[data-ms-overlay]{position:fixed;top:0;left:0;right:0;z-index:var(--ms-overlay-z,9999);display:flex;flex-direction:column;gap:4px;padding:8px 16px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#111);font-size:13px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);box-shadow:0 2px 8px rgba(0,0,0,.12);}
[data-ms-overlay-top]{font-weight:600;line-height:1.45;}
[data-ms-overlay-sub]{opacity:.85;line-height:1.5;}
[data-ms-overlay-acts]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;}
[data-ms-overlay="danger"]{background:#fee2e2;color:#991b1b;border-bottom-color:#fca5a5;}
[data-ms-overlay="warn"]{background:#fef3c7;color:#7c4a03;border-bottom-color:#fcd34d;}
[data-ms-overlay="ok"]{background:#e8f5ee;color:#22543d;border-bottom-color:#9ed4b3;}
[data-ms-explain]{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-l2,rgba(128,128,128,.08));}
[data-ms-explain-line]{font-size:12px;line-height:1.65;}
[data-ms-copy]{display:flex;flex-direction:column;gap:4px;}
[data-ms-copy-ok]{font-size:11px;color:#3c9a5f;}
[data-ms-copy-fail]{font-size:11px;color:#c2413b;}
[data-ms-pending]{display:flex;flex-direction:column;gap:6px;}
[data-ms-pending-item]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));border-radius:6px;padding:6px 8px;}
[data-ms-pending-text]{flex:1 1 220px;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary,#111);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-ms-pending-acts]{display:flex;gap:6px;}
[data-ms-chip]{font-size:11px;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-fill-l2,rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary,#6b7280);}
`

function CopyButton(props) {
      const [status, setStatus] = React.useState('idle') // idle | ok | fail
      const timerRef = React.useRef(null)

      React.useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      }, [])

      const onClick = async () => {
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('当前环境不支持 navigator.clipboard.writeText')
          }
          await navigator.clipboard.writeText(props.text)
          setStatus('ok')
        } catch (e) {
          console.warn('[memory-shield] 复制失败：' + (e && e.message ? e.message : e))
          setStatus('fail')
        }
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setStatus('idle'), 2000)
      }

      return h('div', { 'data-ms-copy': '' },
        h('div', { 'data-ms-row': '' },
          h('button', { 'data-ms-btn': '', onClick }, props.label),
          status === 'ok' ? h('span', { 'data-ms-copy-ok': '' }, '已复制') : null,
          status === 'fail' ? h('span', { 'data-ms-copy-fail': '' }, '复制失败') : null))
    }

    // ── 共享状态源 ────────────────────────────────────────────────────────
    // 三个组件 + apply() 都读同一个 /state。为避免同一时刻并发多次请求：
    //   - 有请求在飞 → 直接复用同一个 Promise（去重）
    //   - 已成功 → 直接返回缓存（后挂载的组件无需再发）
    // 失败只在 fetchState 里 console.warn 一次，调用方只负责把原因落到 UI。
    let stateInflight = null
    let stateCache = null

    function fetchState(force) {
      if (stateInflight) return stateInflight
      if (stateCache && !force) return Promise.resolve(stateCache)
      stateInflight = jget('/state')
        .then((j) => {
          if (!j || j.ok !== true) throw new Error((j && j.error) || 'state 返回 ok=false')
          stateCache = j.data || {}
          return stateCache
        })
        .catch((e) => {
          console.warn(TAG, '/state 请求失败：', e?.message || e)
          throw e
        })
        .finally(() => {
          stateInflight = null
        })
      return stateInflight
    }

    // 共享状态 hook：{ state, loading, error, reload }
    function useShieldState() {
      const [state, setState] = React.useState(stateCache)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(!stateCache)
      const [nonce, setNonce] = React.useState(0)

      React.useEffect(() => {
        let cancelled = false
        if (nonce > 0) setLoading(true)
        fetchState(nonce > 0).then(
          (s) => {
            if (cancelled) return
            setState(s)
            setError(null)
            setLoading(false)
          },
          (e) => {
            if (cancelled) return
            // 请求失败已在 fetchState 里 warn，这里只把原因交给 UI，不假装正常
            setError(e?.message || String(e))
            setLoading(false)
          },
        )
        return () => {
          cancelled = true
        }
      }, [nonce])

      const reload = () => setNonce((n) => n + 1)
      return { state, loading, error, reload }
    }

    // 待确认队列：在设置页内联处理（确认 / 归档 / 删除），其余条目仍走管理面板。
    const PendingList = () => {
      const [items, setItems] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')

      const load = async () => {
        try {
          const res = await fetch('/api/memory-core/pending', { credentials: 'same-origin' })
          const d = await res.json().catch(() => null)
          if (!res.ok || d?.ok === false) throw new Error(d?.why || ('HTTP ' + res.status))
          setItems(Array.isArray(d?.data?.items) ? d.data.items : [])
          setErr('')
        } catch (e) {
          setItems([])
          setErr(String(e?.message || e))
        }
      }
      React.useEffect(() => { load() }, [])

      const act = async (item, action) => {
        setBusy(action + ':' + item.content)
        try {
          // 条目自带写入时的 cwd 时必须带上：否则服务端会退回设置页所在会话的目录，
          // 落点可能不是这条记忆原本要进的项目。
          const body = { action, target: item.target, entry: item.content }
          if (item.cwd) body.cwd = item.cwd
          const res = await fetch('/api/memory-core/entry', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const d = await res.json().catch(() => null)
          if (!res.ok || d?.ok === false) throw new Error(d?.why || ('HTTP ' + res.status))
          await load()
        } catch (e) {
          setErr(String(e?.message || e))
        } finally {
          setBusy('')
        }
      }

      if (items === null) return h('div', { 'data-ms-note': '' }, '待确认记忆：读取中…')
      if (items.length === 0) {
        return h('div', { 'data-ms-note': '' },
          err ? '待确认记忆：读取失败（' + err + '）' : '待确认记忆：0 条')
      }
      return h('div', { 'data-ms-pending': '' },
        h('div', { 'data-ms-note': '' }, '待确认记忆 ' + items.length + ' 条，可直接处理：'),
        items.map((it, i) => h('div', { key: i, 'data-ms-pending-item': '' },
          h('span', { 'data-ms-chip': '' }, it.target),
          h('span', { 'data-ms-pending-text': '', title: String(it.content || '') },
            String(it.content || '').replace(/\s+/g, ' ')),
          // 目标目录：让人在点「确认」前能看出这条会写进哪个项目。
          it.cwd ? h('span', { 'data-ms-note': '', style: { fontSize: '11px', opacity: '.75' } },
            '目标：' + String(it.cwd).split(/[\\/]/).slice(-1)[0]) : null,
          h('span', { 'data-ms-pending-acts': '' },
            h('button', { type: 'button', 'data-ms-btn': '', disabled: busy !== '',
              onClick: () => act(it, 'confirm') }, '确认'),
            h('button', { type: 'button', 'data-ms-btn': '', disabled: busy !== '',
              onClick: () => act(it, 'archivePending') }, '归档'),
            h('button', { type: 'button', 'data-ms-btn': '', disabled: busy !== '',
              onClick: () => act(it, 'reject') }, '删除')))))
    }

    // 状态面板（插件详情页 + 设置页共用）
    function Panel(props) {
      const { state: st, loading, error, reload } = useShieldState()
      const [msg, setMsg] = React.useState('')
      // 待确认记忆条数：从 core 的文件接口取，拿不到（没装 / 没 cwd）就整行不显示。
      const [pending, setPending] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        fetch('/api/memory-core/files', { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!alive) return
            const rows = Array.isArray(j?.data?.rows) ? j.data.rows : []
            setPending(rows.reduce((n, r) => n + (Number(r?.pending) || 0), 0))
          })
          .catch(() => { if (alive) setPending(null) })
        return () => { alive = false }
      }, [])

      // 只有「设置页那一份」受 showInSettings 控制；插件详情页（plugins.bundle.config）始终保留。
      // 只在拿到状态后判断，避免首帧闪一下再消失。
      if (props && props.inSettings === true && st && st.showInSettings === false) return null

      const errLine = error
        ? h('div', { 'data-ms-note': '', style: { color: '#c0392b' } },
            '状态加载失败：' + error,
            h('button', {
              'data-ms-btn': '',
              style: { marginLeft: '8px' },
              onClick: reload,
            }, '重试'))
        : null

      if (!st) {
        return h('div', { 'data-ms-page': '' },
          h('div', { 'data-ms-note': '' }, loading ? '读取中…' : '状态不可用'),
          errLine)
      }

      return h('div', { 'data-ms-page': '' },
        h('div', { 'data-ms-title': '' }, '记忆遮蔽'),
        h('div', { 'data-ms-sub': '' },
          st.enabled ? '当前状态：已启用' : '当前状态：未启用'),
        // 说明段：给不看文档的人看（口语，不写术语）
        h('div', { 'data-ms-explain': '' },
          h('div', { 'data-ms-explain-line': '' },
            '作用：挂载本插件的 preset 中的会话不再读取记忆库；数据不会被删除，只是停止读取。'),
          h('div', { 'data-ms-explain-line': '' },
            '影响范围：仅挂载本插件的 preset；其他会话不受影响。'),
          h('div', { 'data-ms-explain-line': '' },
            '适用场景：需要不带记忆的窗口或通道，例如对外演示，或需保持干净状态的服务会话。'),
          h('div', { 'data-ms-explain-line': '' },
            '如需在这些会话中保留独立记忆，请安装配套包 dsh-memory-core（可在 npm 上按包名安装）。')),

        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '状态'),
          h('div', { 'data-ms-row': '' },
            h('span', null, '启用状态：'),
            h('span', { 'data-ms-badge': st.enabled ? 'on' : 'off' }, st.enabled ? '已启用' : '未启用')),
          h('div', { 'data-ms-note': '' },
            '作用范围：' + (st.layer === 'preset'
              ? (st.enabled
                ? 'preset「' + (st.presetName || '(未命名)') + '」中的会话'
                : 'preset「' + (st.presetName || '(未命名)') + '」已挂载，尚未启用')
              : '当前没有检测到已挂载它的会话（可能是未挂载，也可能是已挂载但尚无该 preset 的会话）'))),
        errLine,
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '遮蔽会话的记忆'),
          h('div', { 'data-ms-note': '' },
            '被遮蔽的会话可使用独立的记忆存储（配套包 dsh-memory-core）；安装后提供以下入口：'),
          h('div', { 'data-ms-row': '' },
            h('a', {
              href: '/api/memory-core/manage',
              target: '_blank',
              rel: 'noopener',
              style: {
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '12px', minHeight: '26px', padding: '2px 12px',
                borderRadius: '6px', textDecoration: 'none', cursor: 'pointer',
                border: '1px solid var(--dsw-alias-brand-primary,#2f6fed)',
                color: 'var(--dsw-alias-brand-primary,#2f6fed)',
              },
            }, '打开记忆管理页'),
            h('span', { 'data-ms-note': '', style: { marginLeft: '8px' } },
              pending === null ? '未检测到配套记忆包（未安装，或它没有启动）' : '未安装配套包时点开会提示 404，属正常现象')),
          // 没装 core（/files 拿不到）时不渲染待确认列表：否则面板里会挂一条「读取失败 HTTP 404」。
          pending === null ? null : h(PendingList, null),
          h('div', { 'data-ms-note': '' },
            '记忆管理页可查看各轨条数，新增、修改、归档或删除条目，并处理待确认队列；数据与普通会话完全隔离。')),
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '手动启用步骤'),
          h('div', { 'data-ms-note': '' },
            '1. 打开「Agent 预设」，选择目标 preset，在其插件列表中加入 dsh-memory-shield'),
          h('div', { 'data-ms-note': '' },
            '2. 在该插件的配置中将 enabled 设为 true'),
          h('div', { 'data-ms-note': '' },
            '3. 保存后新建该 preset 的会话；已有会话不受影响'),
          h('div', { 'data-ms-note': '' },
            '如不便手动修改：复制下方「让 agent 带我启用」发送给 agent，由其代劳。')),
        // 引导型复制按钮：复制的是「让 agent 读懂并汇报 / 帮你操作」的提示词
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '需要帮助？复制以下内容发给 agent'),
          h('div', { 'data-ms-note': '' }, COPY_HINT),
          h(CopyButton, { label: '让 agent 讲这个插件', text: COPY_UNDERSTAND }),
          h(CopyButton, { label: '让 agent 带我启用', text: COPY_HELP }),
          h(CopyButton, { label: '查看遮蔽状态', text: COPY_DIAGNOSE }),
          h(CopyButton, { label: '了解配套记忆包', text: COPY_MEMORY_CORE })),
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '显示'),
          h('label', { 'data-ms-row': '', style: { cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: st.showInSettings !== false,
              onChange: async (e) => {
                const v = !!e.target.checked
                try {
                  await jpost('/config', { showInSettings: v })
                  try { window.__memoryShieldSyncSettings && window.__memoryShieldSyncSettings(v) } catch {}
                  setMsg(v ? '已在设置页显示' : '已从设置页隐藏（插件详情页这块始终保留）')
                  reload()
                } catch (err) {
                  setMsg('保存失败：' + (err?.message || err))
                }
              },
            }),
            h('span', { style: { marginLeft: '6px' } }, '在设置页也显示这个面板'))),
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '告警横幅'),
          h('label', { 'data-ms-row': '', style: { cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: st.bannerEnabled !== false,
              onChange: async (e) => {
                const v = !!e.target.checked
                try {
                  await jpost('/config', { bannerEnabled: v })
                  setMsg(v ? '已显示告警横幅' : '已隐藏告警横幅（红警仍会显示）')
                  reload()
                } catch (err) {
                  setMsg('保存失败：' + (err?.message || err))
                }
              },
            }),
            h('span', { style: { marginLeft: '6px' } }, '显示黄色告警横幅（全局遮蔽红警不受此开关影响）')),
          h('button', {
            'data-ms-btn': '',
            onClick: async () => {
              try {
                await jpost('/config', { hintDismissed: false })
                setMsg('已恢复「未启用」提示')
                reload()
              } catch (err) {
                setMsg('保存失败：' + (err?.message || err))
              }
            },
          }, '恢复「未启用」提示')),
        msg ? h('div', { 'data-ms-note': '', style: { color: '#3c9a5f' } }, msg) : null,
      )
    }

    // 修复提示词分两稿：红警（全局遮蔽）与黄警（未启用/未生效）说的是两件事，
    // 一稿两用会让未启用的用户复制到一段描述「并没有发生的危险」的指令（wb P1-1）。
    const COPY_FIX_DANGER = '请先说明：问题是什么、原因是什么、不修会有什么影响；确认后再动手。第一步只读：检查 dsh-memory-shield 的配置（层级错误，正在全局遮蔽所有会话）。读 ' + ORIGIN + '/api/memory-shield/state 与 /health，告诉我 layer、enabled、presetName、实际遮蔽了几个工具。确认它在 profile 层生效（layer 是 profile 且 enabled 为 true）意味着所有会话的记忆工具与上下文段都被挡掉。修法：先备份 profile 的 cordis.patch.yml（同目录加 .bak-时间戳），关掉插件列表里的那个开关，只在目标 preset 的 plugins 列表里加一项 - id: memory-shield / name: dsh-memory-shield / config: {enabled: true}；不要新建同名 preset 块（整块会替换掉其余插件），也不要加到 dsh.profile.bundles。改完把「改了哪个文件、备份在哪、怎么重启（不要由你执行重启，会导致当前会话中断）、重启后新建哪个 preset 的会话、进去后怎么验证（/health 的 layer 应是 preset 且 shadowTools > 0）」列给我。'
    const COPY_FIX_WARN = '请先说明：问题是什么、原因是什么、不修会有什么影响；确认后再动手。第一步只读：检查 dsh-memory-shield 为何未生效（已安装，但未在任何 preset 中启用）。读 ' + ORIGIN + '/api/memory-shield/state 与 /health，告诉我 layer、enabled、presetName；再告诉我当前有哪些 preset、我要用的那个叫什么（不确定就列出来让我选）。修法：先备份 profile 的 cordis.patch.yml（同目录加 .bak-时间戳），只在那个 preset 的 plugins 列表里加一项 - id: memory-shield / name: dsh-memory-shield / config: {enabled: true}，不要新建同名 preset 块、也不要加到 dsh.profile.bundles。改完列给我「改了哪个文件、备份在哪、怎么重启（不要由你执行重启）、重启后新建哪个 preset 的会话、进去后怎么验证（/health 的 layer 应是 preset 且 shadowTools > 0）」。不要帮我改任何其他配置。'

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

    // 缺启用横幅（shell.overlay）
    function OverlayBanner() {
      const { state: st, error, reload } = useShieldState()
      const [dismissed, setDismissed] = React.useState(false)

      // 「不再提示」统一落 bannerEnabled：与设置页「显示黄色告警横幅」是同一个开关，
      // 红警不受影响。原先「未启用」单独用 hintDismissed，等于同一功能两套字段；
      // 旧值 hintDismissed 仍兼容（见下方 return null 分支）。
      const dismissAll = async () => {
        try {
          await jpost('/config', { bannerEnabled: false })
        } catch (e) {
          // 落库失败也要让用户这次不再看到横幅，但必须留下痕迹
          console.warn(TAG, 'bannerEnabled 保存失败（本次仅本地隐藏）：', e?.message || e)
        }
        setDismissed(true)
      }

      // S1（wb 横幅测试）：状态读不到不等于没问题——可能正在被遮蔽而不自知。
      // 给一条黄警 + 重试，别静默 return null。
      if (error) {
        return h('div', { 'data-ms-overlay': 'warn' },
          h('div', { 'data-ms-overlay-top': '' }, '警告：无法读取 dsh-memory-shield 状态。'),
          h('div', { 'data-ms-overlay-sub': '' }, '可能原因：插件未加载、路由被占用或服务暂不可用。此状态下无法判断遮蔽是否生效。'),
          h('div', { 'data-ms-overlay-acts': '' },
            h(CopyButton, { text: COPY_FIX_WARN, label: '复制修复提示词' }),
            h(CopyButton, { label: '让 agent 讲这个插件', text: COPY_UNDERSTAND }),
            h('button', { 'data-ms-btn': '', onClick: reload }, '重试'),
            h('button', { 'data-ms-btn': '', onClick: dismissAll }, '不再提示'),
            h('button', { 'data-ms-btn': '', onClick: () => setDismissed(true) }, '关闭')),
        )
      }
      if (!st || dismissed) return null

      // 红警：遮蔽在 profile 层生效＝全局遮蔽。所有会话的记忆注入与工具都被挡掉，
      // 只剩遮蔽包自己的兜底，且改回来要重启，属于「必须立刻修好」的配置。
      // 红警不受「告警横幅」总开关影响：关掉开关不代表同意全局遮蔽。
      if (st.layer === 'profile' && st.enabled === true && (st.shadowTools || 0) > 0) {
        return h('div', { 'data-ms-overlay': 'danger', role: 'alert' },
          h('div', { 'data-ms-overlay-top': '' },
            '严重警告：遮蔽正在全局生效，已拦截 ' + st.shadowTools + ' 个记忆工具；记忆类工具只剩 memory_core。'),
          h('div', { 'data-ms-overlay-sub': '' },
            '未修复的影响：所有会话都读不到历史记忆；其他记忆插件仍会照常写入各自的存储，遮蔽不清空也不改写这些数据。'),
          h('div', { 'data-ms-overlay-acts': '' },
            h(CopyButton, { text: COPY_FIX_DANGER, label: '复制修复提示词' }),
            h(CopyButton, { label: '让 agent 讲这个插件', text: COPY_UNDERSTAND }),
            h('button', { 'data-ms-btn': '', onClick: () => setDismissed(true) }, '关闭')),
        )
      }

      if (st.bannerEnabled === false) return null

      // S7：配了 enabled 但实际遮蔽数 0——用户以为生效了，其实一个工具都没挡住。
      if (st.enabled === true && (st.shadowTools || 0) === 0 && (st.shadowSections || 0) === 0) {
        return h('div', { 'data-ms-overlay': 'warn' },
          h('div', { 'data-ms-overlay-top': '' }, '警告：遮蔽已启用，但未拦截任何工具或上下文段。'),
          h('div', { 'data-ms-overlay-sub': '' }, '可能原因：presetName 未指向目标 preset，或遮蔽名单被整块替换成了空值。未修复的影响：当前会话未隔离，仍与其他会话共用同一份记忆。'),
          h('div', { 'data-ms-overlay-acts': '' },
            h(CopyButton, { text: COPY_FIX_WARN, label: '复制修复提示词' }),
            h(CopyButton, { label: '让 agent 讲这个插件', text: COPY_UNDERSTAND }),
            h('button', { 'data-ms-btn': '', onClick: dismissAll }, '不再提示'),
            h('button', { 'data-ms-btn': '', onClick: () => setDismissed(true) }, '关闭')),
        )
      }

      // 用户点过「不再提示」：所有黄/绿条都不再打扰（红警仍在上方先返回）。
      if (st.hintDismissed) return null

      // 绿条：preset 层生效、遮蔽数正常、也没出过告警，说明配好了。
      // 只弹一次（successShown），否则每次打开都弹就是噪音。
      if (st.enabled === true && st.layer === 'preset' && (st.shadowTools || 0) > 0) {
        if (st.successShown === true) return null
        const ackSuccess = async () => {
          try { await jpost('/config', { successShown: true }) } catch (e) {
            console.warn(TAG, 'successShown 保存失败（本次仅本地隐藏）：', e?.message || e)
          }
          setDismissed(true)
        }
        return h('div', { 'data-ms-overlay': 'ok', role: 'status' },
          h('div', { 'data-ms-overlay-top': '' }, '遮蔽已就绪。已拦截 ' + st.shadowTools + ' 个工具；被遮蔽会话改用 memory_core。'),
          h('div', { 'data-ms-overlay-sub': '' }, '遮蔽数量、待确认记忆与管理页入口位于本设置页的「记忆遮蔽」段。该提示仅显示一次。'),
          h('div', { 'data-ms-overlay-acts': '' },
            h('button', { 'data-ms-btn': '', onClick: ackSuccess }, '知道了')))
      }

      if (st.enabled) return null

      // 黄警：装好了但没在 preset 里启用。默认关闭是设计（不加就是零影响），
      // 但要让人知道「现在等于没装」，并给一条能直接交给 agent 的修复路径。
      return h('div', { 'data-ms-overlay': 'warn' },
        h('div', { 'data-ms-overlay-top': '' },
          '遮蔽已安装但未启用：当前不遮蔽任何会话，效果与未安装相同。'),
        h('div', { 'data-ms-overlay-sub': '' },
          '启用方式：在目标 preset 的 plugins 中挂载本插件并设置 config.enabled: true；插件列表开关不触发遮蔽。'),
        h('div', { 'data-ms-overlay-acts': '' },
        h(CopyButton, { text: COPY_FIX_WARN, label: '复制修复提示词' }),
        h(CopyButton, { label: '让 agent 讲这个插件', text: COPY_UNDERSTAND }),
        h('button', { 'data-ms-btn': '', onClick: () => setDismissed(true) }, '关闭'),
        h('button', { 'data-ms-btn': '', onClick: dismissAll }, '不再提示')),
      )
    }

    // 详情页标签（plugins.detail.badge）
    function DetailBadge() {
      // profile 层实例的 enabled 恒为 false（遮蔽发生在 preset 层），所以状态必须问 /health：
      // 它由真正的生效实例注册，能给出 layer、enabled 与实际遮蔽数。
      const [probe, setProbe] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        fetch(ORIGIN + '/api/memory-shield/health', { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => { if (alive) { setProbe(j && typeof j === 'object' ? j : null); setFailed(!j) } })
          .catch(() => { if (alive) setFailed(true) })
        return () => { alive = false }
      }, [])

      const ready = !!probe && probe.enabled === true && (probe.shadowTools || 0) > 0
      const label = probe === null && !failed
        ? '读取中…'
        : failed
          ? '状态未知（请到设置页重试）'
          : ready
            ? '已启用 · 拦截 ' + probe.shadowTools + ' 个工具'
            : '已安装，未启用'
      return h('span', {
        'data-ms-badge': failed ? 'off' : ready ? 'on' : 'off',
        title: failed
          ? '状态加载失败：/health 无响应'
          : ready
            ? '遮蔽已在 preset 中生效；点开插件详情页可看明细'
            : '遮蔽未在 preset 中启用；插件列表开关不会启用遮蔽',
      }, label)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-memory-shield')
        style.textContent = CSS
        document.head.appendChild(style)
        if (typeof ctx.effect === 'function') ctx.effect(() => () => style.remove(), 'dsh-memory-shield: 面板样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        // ① 插件详情页配置区
        slots.inject('plugins.bundle.config', () => slots.register(
          { name: 'plugins.bundle.config', key: PKG },
          Panel,
        ))

        // ② 缺启用横幅
        slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: PKG },
          OverlayBanner,
        ))

        // ③ 详情页标签
        slots.inject('plugins.detail.badge', () => slots.register(
          { name: 'plugins.detail.badge', id: PKG },
          DetailBadge,
        ))

        // ④ 设置页双面板：注册/注销跟着 showInSettings 走。
        //    组件返回 null 删不掉左侧 tab，必须拿 register 返回的 dispose 手动注销。
        let settingsReg = null
        const syncSettings = (on) => {
          if (on) {
            if (settingsReg) return
            slots.inject('settings.section', () => {
              settingsReg = slots.register(
                { name: 'settings.section', id: PKG, order: 40, label: '记忆遮蔽' },
                (props) => h(Panel, Object.assign({}, props || {}, { inSettings: true })),
              )
              return settingsReg
            })
          } else if (settingsReg) {
            try { settingsReg() } catch {}
            settingsReg = null
          }
        }
        try { window.__memoryShieldSyncSettings = syncSettings } catch {}
        fetchState(false)
          .then((st) => syncSettings(!!(st && st.showInSettings !== false)))
          .catch(() => {})
      },
    }
  },
})
