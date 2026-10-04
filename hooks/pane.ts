import type { EngineInterface, McpToolResult, Register } from 'claude-code'

// In the Claude desktop app, open the surf page in Claude's own browser pane
// instead of an external browser. Elsewhere (no browser pane), ask the local
// server to open the system browser as usual.

const SERVER = 'http://127.0.0.1:7357/'
const GAME = 'https://surfd.net/'
const BROWSER = 'Claude_Browser'
const OPEN_AFTER_MS = 2500

type Tab = { tabId: string; origin: string }

function textOf(result: McpToolResult): string {
  return (result.content ?? []).map(b => b.text ?? '').join('\n')
}

async function openInPane($: EngineInterface, url: string) {
  const context = await $.mcp.call(BROWSER, 'tabs_context', {})
  if (context.isError) return false
  const text = textOf(context)
  let tabs: Tab[] = []
  try {
    tabs = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).tabs ?? []
  } catch {}

  // Reuse a surf tab that is already open rather than stacking new ones.
  const existing = tabs.find(t => t.origin === new URL(url).origin)
  const opened = existing
    ? await $.mcp.call(BROWSER, 'tabs_select', { tabId: existing.tabId })
    : await $.mcp.call(BROWSER, 'preview_start', { url })
  return !opened.isError
}

async function openSurf($: EngineInterface) {
  const health = await $.http
    .fetch(`${SERVER}health`)
    .then(r => (r.ok ? JSON.parse(r.text) : null))
    .catch(() => null)
  const isServerUp = health?.app === 'claude-surf'
  // Respect the page's "open this tab automatically" switch.
  if (isServerUp && health.autoOpen === false) return
  const url = isServerUp ? SERVER : GAME

  const isInPane = await openInPane($, url).catch(() => false)
  if (!isInPane && isServerUp) {
    await $.http.fetch(`${SERVER}open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  }
}

export const register: Register = on => {
  let isBusy = false
  let turn = 0

  on('prompt.submit', ($, e, next) => {
    isBusy = true
    const mine = ++turn
    $.ui.status('🏄 Claude is working, go surf')
    $.clock.after(OPEN_AFTER_MS, () => {
      if (!isBusy || mine !== turn) return
      openSurf($).catch(() => {})
    })
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    isBusy = false
    $.ui.status(undefined)
    if (e.reason === 'answer') $.ui.toast('🏄 Claude is done, paddle back in', { timeoutMs: 6000 })
    return next(e)
  })
}
