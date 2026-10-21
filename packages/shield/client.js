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

// 三段「引导型」提示词：只让 agent 读懂并汇报，明确禁止代改配置。
    const COPY_UNDERSTAND = '我刚安装了 dsh-memory-shield，帮我读一下 node_modules/dsh-memory-shield/README.md，理解后用通俗语言告诉我这个插件是干什么的、怎么用。不要帮我改配置。'
    const COPY_COMPANION = '我刚安装了 dsh-memory-shield，想知道 companion 包 dsh-memory-core 是什么。帮我读一下它的 README，用通俗语言告诉我它和 shield 的关系。不要帮我安装或改配置。'
    const COPY_DIAGNOSE = '帮我调用 shadow_diagnose 工具，看看当前遮蔽状态，然后告诉我这个状态意味着什么。不要帮我改任何配置。'
    const COPY_HINT = '复制后粘贴到对话框，发给 agent。'

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
[data-ms-overlay]{position:fixed;top:0;left:0;right:0;z-index:var(--ms-overlay-z,9999);display:flex;align-items:center;gap:12px;padding:8px 16px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#111);font-size:13px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);box-shadow:0 2px 8px rgba(0,0,0,.12);}
[data-ms-overlay-text]{flex:1;line-height:1.5;}
[data-ms-explain]{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-l2,rgba(128,128,128,.08));}
[data-ms-explain-line]{font-size:12px;line-height:1.65;}
[data-ms-copy]{display:flex;flex-direction:column;gap:4px;}
[data-ms-copy-ok]{font-size:11px;color:#3c9a5f;}
[data-ms-copy-fail]{font-size:11px;color:#c2413b;}
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
          status === 'fail' ? h('span', { 'data-ms-copy-fail': '' }, '复制失败') : null),
        h('div', { 'data-ms-note': '' }, COPY_HINT))
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

    // 状态面板（插件详情页 + 设置页共用）
    function Panel() {
      const { state: st, loading, error, reload } = useShieldState()
      const [msg, setMsg] = React.useState('')

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
        h('div', { 'data-ms-title': '' }, '记忆遮蔽插件'),
        h('div', { 'data-ms-sub': '' },
          st.enabled
            ? '当前状态：已启用（本会话的记忆类上下文与工具已被遮蔽）。'
            : '当前状态：未启用。在目标 preset 的 plugins 列表加入 dsh-memory-shield，并在 config 里设 enabled: true。'),
        // 说明段：放在面板最上方、状态之下，给不看文档的人看
        h('div', { 'data-ms-explain': '' },
          h('div', { 'data-ms-explain-line': '' },
            '这个插件会让当前会话不加载其他记忆插件注入的记忆内容。'),
          h('div', { 'data-ms-explain-line': '' },
            '它不会删除任何记忆数据，只是在这个会话里暂不注入。'),
          h('div', { 'data-ms-explain-line': '' },
            '想在这个会话里有自己的记忆，装 companion 包 dsh-memory-core。'),
          h('div', { 'data-ms-explain-line': '' },
            '启用方式：在目标 preset 的 plugins 里加 dsh-memory-shield，config 里设 enabled: true，然后新建会话。')),
        
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '状态'),
          h('div', { 'data-ms-row': '' },
            h('span', null, '启用状态：'),
            h('span', { 'data-ms-badge': st.enabled ? 'on' : 'off' }, st.enabled ? '已启用' : '未启用'))),
        errLine,
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '怎么启用'),
          h('div', { 'data-ms-note': '' },
            '1. 在你的 preset 配置里，plugins 列表加入 dsh-memory-shield',
          ),
          h('div', { 'data-ms-note': '' },
            '2. config 里设 enabled: true',
          ),
          h('div', { 'data-ms-note': '' },
            '3. 重启该 preset 的会话',
          )),
        // 三个引导型复制按钮：复制的是「让 agent 读懂并汇报」的提示词
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '看不懂？让 agent 讲给你听'),
          h(CopyButton, { label: '了解这个插件', text: COPY_UNDERSTAND }),
          h(CopyButton, { label: '了解 companion 包', text: COPY_COMPANION }),
          h(CopyButton, { label: '查看遮蔽状态', text: COPY_DIAGNOSE })),
        msg ? h('div', { 'data-ms-note': '', style: { color: '#3c9a5f' } }, msg) : null,
      )
    }

    // 缺启用横幅（shell.overlay）
    function OverlayBanner() {
      const { state: st, error } = useShieldState()
      const [dismissed, setDismissed] = React.useState(false)

      // 读不到状态就不打扰（fetchState 已 warn）；读到了才按 enabled/hintDismissed 判断
      if (error) return null
      if (!st || dismissed) return null
      if (st.enabled || st.hintDismissed) return null

      return h('div', { 'data-ms-overlay': '' },
        h('span', { 'data-ms-overlay-text': '' },
          '记忆遮蔽插件已安装，但默认不启用。启用后它会挡住其他记忆插件往当前会话注入的上下文与工具，让这个通道保持干净，所以默认关闭。启用方式：在目标 preset 的 plugins 列表加入 dsh-memory-shield，并在 config 里设 enabled: true。'),
        h('button', { 'data-ms-btn': '', onClick: () => setDismissed(true) }, '×'),
        h('button', { 'data-ms-btn': '', onClick: async () => {
          try {
            await jpost('/config', { hintDismissed: true })
          } catch (e) {
            // 落库失败也要让用户这次不再看到横幅，但必须留下痕迹
            console.warn(TAG, 'hintDismissed 保存失败（本次仅本地隐藏）：', e?.message || e)
          }
          setDismissed(true)
        } }, '不再提示'),
      )
    }

    // 详情页标签（plugins.detail.badge）
    function DetailBadge() {
      const { state, loading, error } = useShieldState()
      const on = !!(state && state.enabled === true)
      const unknown = !loading && (!!error || !state)
      const label = loading ? '读取中…' : unknown ? '状态未知' : on ? '全局已启用' : '全局未启用'
      return h('span', {
        'data-ms-badge': on ? 'on' : 'off',
        title: unknown ? '状态加载失败：' + (error || '无返回') : undefined,
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

        // ④ 设置页双面板（读 showInSettings 决定是否注册）
        // 与组件共用 fetchState()，同一时刻不会多发一次 /state
        fetchState(false).then((st) => {
          if (!st || st.showInSettings === false) return
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: PKG, label: '记忆遮蔽' },
            Panel,
          ))
        }).catch((e) => {
          console.warn(TAG, 'settings.section 未注册（/state 不可用）：', e?.message || e)
        })
      },
    }
  },
})
