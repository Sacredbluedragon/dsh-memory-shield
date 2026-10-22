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
    const COPY_UNDERSTAND = '我刚装了 dsh-memory-shield，帮我读它的 README 再告诉我它是干什么的、怎么用。README 在当前 DSH profile 的 node_modules/dsh-memory-shield/README.md（profile 名按实际，通常是 web；不确定就先看插件装在哪个 profile，再读那个目录），路径不对就用文件名搜一下，别猜。用通俗语言讲三点：它遮蔽了什么、只影响哪些会话、默认为什么是关的。不要帮我改配置。'
    const COPY_COMPANION = 'dsh-memory-shield 有个配套包 dsh-memory-core，我想知道它是干什么的。它尚未发布、当前不可安装，不要安装、也不要 npm 搜包安装：如果本机没有它的源码目录，就直接按 dsh-memory-shield README 里提到它的地方，用一句话告诉我它和 shield 是什么关系、我什么时候才需要它。不要帮我装东西或改配置。'
    const COPY_DIAGNOSE = '帮我看看记忆遮蔽现在是什么状态。先试调用 shadow_diagnose 工具；如果它不存在（报 unknown tool），说明当前会话没挂 dsh-memory-shield，就改用只读接口 http://127.0.0.1:3080/api/memory-shield/state 和 /health 看（端口不对就用浏览器地址栏那个端口），再把两边对不上的地方说清楚。并说明这是哪一层看的、这个会话本身是不是被遮蔽的通道。两个来源的数字口径不同（工具报配置数组长度、/health 报去重后的实际生效数），不要当成不一致。然后用一句话告诉我这个状态意味着什么、我下一步要不要启用。不要帮我改任何配置。'
    const COPY_HELP = '我不太懂 dsh-memory-shield 这个记忆遮蔽插件，想用它。请分步带我，先只做只读检查，等我明确确认后再动手：①用 GET 查 http://127.0.0.1:3080/api/memory-shield/state 和 /health（端口不对就用浏览器地址栏那个），告诉我它现在装在哪一层、有没有启用、挂在哪个 preset（以 /state 的 layer 和 presetName 为准；layer 是 profile 且 enabled 为 false，就是装了但没挂到任何 preset，等于没启用）；②先确认我要用的那个 preset 存在（在 profile 的 cordis.patch.yml 里能找到），再告诉我启用要改哪个文件、改在哪儿：必须是在已有 preset 的 plugins 列表里插一项 - id: memory-shield / name: dsh-memory-shield / config: {enabled: true}，不要新写一个同名 preset 块（preset 的 config 是整体替换，会把其余插件清掉），也不要加到 dsh.profile.bundles 或 profile 层（会和全局记忆插件撞名）；顺便说清影响：只有那个 preset 下的会话看不到记忆、其他会话照旧、消息级注入挡不住、要重启并新建该 preset 的会话才生效；③默认复用现成的 preset，遮蔽名单用默认的就行（已覆盖常见记忆插件），只有我装了名单外的插件时才问我；④我确认后再动手：改前把 cordis.patch.yml 备份到同目录（文件名加 .bak 和时间戳），只改这一处，改完把「改了哪个文件+备份在哪+重启方式（按这台机器的正常习惯，但不要由你执行重启，会把当前会话掐掉）+新建哪个会话+进去后怎么验证」列给我。'
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

    // 状态面板（插件详情页 + 设置页共用）
    function Panel(props) {
      const { state: st, loading, error, reload } = useShieldState()
      const [msg, setMsg] = React.useState('')

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
        h('div', { 'data-ms-title': '' }, '记忆遮蔽插件'),
        h('div', { 'data-ms-sub': '' },
          st.enabled ? '当前状态：已启用' : '当前状态：未启用'),
        // 说明段：给不看文档的人看（口语，不写术语）
        h('div', { 'data-ms-explain': '' },
          h('div', { 'data-ms-explain-line': '' },
            '它是干什么的：让挂着它的那个 preset 下的会话看不到记忆库（记忆数据不会删，只是不读）。'),
          h('div', { 'data-ms-explain-line': '' },
            '会影响谁：只影响挂着它的 preset；其他会话照旧。'),
          h('div', { 'data-ms-explain-line': '' },
            '什么时候用：想让某个窗口或通道不带记忆时用，比如给别人演示、或者要保持干净的服务窗口。'),
          h('div', { 'data-ms-explain-line': '' },
            '想在这些会话里有自己的记忆：装配套包 dsh-memory-core（尚未发布，暂不可安装）。')),

        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '状态'),
          h('div', { 'data-ms-row': '' },
            h('span', null, '启用状态：'),
            h('span', { 'data-ms-badge': st.enabled ? 'on' : 'off' }, st.enabled ? '已启用' : '未启用')),
          h('div', { 'data-ms-note': '' },
            '作用范围：' + (st.layer === 'preset'
              ? 'preset「' + (st.presetName || '(未命名)') + '」下的会话'
              : '还没挂到任何 preset（当前只在插件目录里）'))),
        errLine,
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '怎么启用'),
          h('div', { 'data-ms-note': '' },
            '1. 打开「Agent 预设」，找到要用的 preset，在它的插件列表里加 dsh-memory-shield'),
          h('div', { 'data-ms-note': '' },
            '2. 在这个插件的配置里打开 enabled'),
          h('div', { 'data-ms-note': '' },
            '3. 保存后新建一个该 preset 的会话（老会话不受影响）'),
          h('div', { 'data-ms-note': '' },
            '不想手改：复制下面第二条「帮我启用」发给 agent，让它带你做。')),
        // 引导型复制按钮：复制的是「让 agent 读懂并汇报 / 帮你操作」的提示词
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '看不懂？复制一条发给 agent'),
          h('div', { 'data-ms-note': '' }, COPY_HINT),
          h(CopyButton, { label: '了解这个插件', text: COPY_UNDERSTAND }),
          h(CopyButton, { label: '帮我启用', text: COPY_HELP }),
          h(CopyButton, { label: '查看遮蔽状态', text: COPY_DIAGNOSE }),
          h(CopyButton, { label: '了解配套记忆包', text: COPY_COMPANION })),
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
          '记忆遮蔽插件已安装，但默认不启用。启用后它会挡住其他记忆插件往挂了它的 preset 下的会话注入的上下文与工具，让这些会话保持干净，所以默认关闭。启用方式：在目标 preset 的 plugins 列表加入 dsh-memory-shield，并在 config 里设 enabled: true。'),
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
      const unknown = !loading && (!!error || !state)
      // profile 层实例的 enabled 恒为 false（遮蔽发生在 preset 层），直接用它做标签会永远显示「未启用」。
      // 所以这里只报「已安装 / 状态未知」，具体启用状态在设置页面板里看。
      const label = loading ? '读取中…' : unknown ? '状态未知' : '已安装'
      return h('span', {
        'data-ms-badge': unknown ? 'off' : 'on',
        title: unknown ? '状态加载失败：' + (error || '无返回') : '遮蔽在目标 preset 中配置（设置页面板有说明）',
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
