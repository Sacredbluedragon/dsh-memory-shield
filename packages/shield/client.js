/**
 * dsh-memory-shield —— 浏览器半端：提示横幅 + 状态标签 + 设置页面板。
 *
 * profile 层提示：
 *   - shell.overlay：缺启用横幅（「已安装，默认不启用」）
 *   - plugins.detail.badge：详情页标签（未启用/已启用）
 *   - settings.section：设置页双面板
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-shield',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const PKG = 'dsh-memory-shield'
    const API = '/api/memory-shield'
    const jget = async (p) => (await fetch(API + p, { credentials: 'same-origin' })).json()
    const jpost = async (p, body) =>
      (await fetch(API + p, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })).json()

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
[data-ms-overlay]{position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;gap:12px;padding:8px 16px;background:var(--dsw-alias-bg-strong,#2d2d2d);color:var(--dsw-alias-label-primary,#e5e7eb);font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.3);}
[data-ms-overlay-text]{flex:1;line-height:1.5;}
`

    // 状态面板（插件详情页 + 设置页共用）
    function Panel() {
      const [st, setSt] = React.useState(null)
      const [msg, setMsg] = React.useState('')

      React.useEffect(() => {
        jget('/state').then((j) => {
          if (j.ok) setSt(j.data)
        }).catch(() => {})
      }, [])

      if (!st) return h('div', { 'data-ms-page': '' }, h('div', { 'data-ms-note': '' }, '读取中…'))

      return h('div', { 'data-ms-page': '' },
        h('div', { 'data-ms-title': '' }, '记忆遮蔽插件'),
        h('div', { 'data-ms-sub': '' },
          st.enabled
            ? '当前状态：已启用（本会话的记忆类上下文与工具已被遮蔽）。'
            : '当前状态：未启用。在目标 preset 的 plugins 列表加入 dsh-memory-shield，并在 config 里设 enabled: true。'),
        h('div', { 'data-ms-sec': '' },
          h('span', { 'data-ms-sec-title': '' }, '状态'),
          h('div', { 'data-ms-row': '' },
            h('span', null, '启用状态：'),
            h('span', { 'data-ms-badge': st.enabled ? 'on' : 'off' }, st.enabled ? '已启用' : '未启用'))),
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
        msg ? h('div', { 'data-ms-note': '', style: { color: '#3c9a5f' } }, msg) : null,
      )
    }

    // 缺启用横幅（shell.overlay）
    function OverlayBanner() {
      const [st, setSt] = React.useState(null)
      const [dismissed, setDismissed] = React.useState(false)

      React.useEffect(() => {
        jget('/state').then((j) => {
          if (j.ok) setSt(j.data)
        }).catch(() => {})
      }, [])

      if (!st || dismissed) return null
      if (st.enabled || st.hintDismissed) return null

      return h('div', { 'data-ms-overlay': '' },
        h('span', { 'data-ms-overlay-text': '' },
          '记忆遮蔽插件已安装，但默认不启用。启用后它会挡住其他记忆插件往当前会话注入的上下文与工具，让这个通道保持干净，所以默认关闭。启用方式：在目标 preset 的 plugins 列表加入 dsh-memory-shield，并在 config 里设 enabled: true。'),
        h('button', { 'data-ms-btn': '', onClick: () => setDismissed(true) }, '×'),
        h('button', { 'data-ms-btn': '', onClick: async () => {
          await jpost('/config', { hintDismissed: true })
          setDismissed(true)
        } }, '不再提示'),
      )
    }

    // 详情页标签（plugins.detail.badge）
    function DetailBadge() {
      const [enabled, setEnabled] = React.useState(false)
      React.useEffect(() => {
        jget('/state').then((j) => {
          if (j.ok) setEnabled(j.data.enabled === true)
        }).catch(() => {})
      }, [])
      return h('span', { 'data-ms-badge': enabled ? 'on' : 'off' }, enabled ? '全局已启用' : '全局未启用')
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
          { name: 'shell.overlay', key: PKG },
          OverlayBanner,
        ))

        // ③ 详情页标签
        slots.inject('plugins.detail.badge', () => slots.register(
          { name: 'plugins.detail.badge', key: PKG },
          DetailBadge,
        ))

        // ④ 设置页双面板（读 showInSettings 决定是否注册）
        jget('/state').then((j) => {
          if (j.ok && j.data.showInSettings !== false) {
            slots.inject('settings.section', () => slots.register(
              { name: 'settings.section', key: PKG, title: '记忆遮蔽' },
              Panel,
            ))
          }
        }).catch(() => {})
      },
    }
  },
})
