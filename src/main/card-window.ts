// ── Card windows: standalone draggable frosted cards — define → run → drag-to-dock archive ──
// Multi-card: every createCardWindow spawns its own window, each bound to one
// spec. Bound cards animate out of the dock (macOS-maximize style) and back in
// (minimize style) via animateBounds. Unbound draft cards get a placeholder
// window on archive so the deck always gains a card.
import { BrowserWindow } from 'electron'
import { translate, type Lang } from '../shared/locales'
import { loadSettings } from './settings-store'
const cw = (): Lang => loadSettings().language === 'en' ? 'en' : 'zh'
import { join } from 'path'
import { attachCrashRecovery } from './crash-recovery'
import { getDockWindow } from './dock-window'
import { dockTarget, animateBounds } from './workspace-window'
import { safeSend } from '../shared/ipc-main'
import { rectOverlapRatio } from '../shared/gen-ui-types'

const isMac = process.platform === 'darwin'
const CARD_W = 220, CARD_H = 264

// Open card windows: webContents.id → { win, specId (null = unbound draft) }
const _cards = new Map<number, { win: BrowserWindow; specId: string | null }>()
const _archiveTimers = new Map<number, ReturnType<typeof setTimeout>>()

/** Specs currently pulled out into card windows — deck hides these cards. */
function broadcastPulledOut(): void {
  const ids = [..._cards.values()].filter(c => c.specId).map(c => c.specId as string)
  for (const w of BrowserWindow.getAllWindows()) safeSend(w.webContents, 'genui:deck-hide', ids)
}

export function pulledOutSpecs(): string[] {
  return [..._cards.values()].filter(c => c.specId).map(c => c.specId as string)
}

/** Focus an already-open card bound to specId (any card when specId is null).
 *  Returns false when no such window is open. */
export function focusCard(specId: string | null): boolean {
  const card = [..._cards.values()].reverse().find(c => !c.win.isDestroyed() && (specId ? c.specId === specId : true))
  if (card) {
    card.win.show()
    card.win.focus()
    return true
  }
  return false
}

/** Tell the bubble which window is being edited — it injects the target into
 *  task text so the agent patches the right spec instead of creating a new one. */
function rebroadcastEdit(): void {
  const last = [..._cards.values()].reverse().find(c => c.specId && !c.win.isDestroyed())
  let info: { id: string; title: string } | null = null
  if (last?.specId) {
    try {
      const spec = require('./gen-ui').listSpecs().find((s: any) => s.id === last.specId)
      if (spec) info = { id: spec.id, title: spec.title }
    } catch { /* store unavailable */ }
  }
  for (const w of BrowserWindow.getAllWindows()) safeSend(w.webContents, 'genui:edit-spec', info)
}

function clearArchive(id: number): void {
  const t = _archiveTimers.get(id)
  if (t) { clearTimeout(t); _archiveTimers.delete(id) }
}

/** Shrink the card into the dock then close it (macOS-minimize style).
 *  An unbound draft card first materializes a placeholder window. */
function archiveCard(id: number, win: BrowserWindow): void {
  const card = _cards.get(id)
  if (card && card.specId === null) {
    try {
      require('./gen-ui').handleSave({ id: `win-${Date.now()}`, title: translate(cw(), 'wc.newWindowT'), kind: 'text', props: {} })
    } catch (e) { console.error('[card] placeholder failed:', e) }
  }
  animateBounds(win, dockTarget(), () => { if (!win.isDestroyed()) win.close() })
}

/** Dragged over the dock >50% and held 400ms → archive. */
function maybeArchive(id: number, win: BrowserWindow): void {
  const dock = getDockWindow()
  if (!dock || dock.isDestroyed() || !dock.isVisible()) { clearArchive(id); return }
  if (rectOverlapRatio(win.getBounds(), dock.getBounds()) <= 0.5) { clearArchive(id); return }
  if (_archiveTimers.has(id)) return
  _archiveTimers.set(id, setTimeout(() => {
    _archiveTimers.delete(id)
    if (!win.isDestroyed()) archiveCard(id, win)
  }, 400))
}

/** Bound cards animate out of the dock to a spot just left of it. */
function expandFromDock(win: BrowserWindow): void {
  const dock = getDockWindow()
  if (!dock || dock.isDestroyed()) { win.once('ready-to-show', () => win.show()); return }
  const db = dock.getBounds()
  win.setBounds(dockTarget())
  const to = {
    x: Math.round(db.x - CARD_W - 16),
    y: Math.round(db.y + (db.height - CARD_H) / 2),
    width: CARD_W, height: CARD_H,
  }
  win.once('ready-to-show', () => { win.show(); animateBounds(win, to, () => {}) })
}

export function createCardWindow(preloadPath: string, specId?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: CARD_W, height: CARD_H,
    show: false, frame: false,
    // macOS IME: the candidate window cannot render over a TRANSPARENT window
    // (Chinese/Japanese input breaks regardless of focus tricks) — same fix
    // as the bubble (task-bubble.ts). Opaque + a dark emerald base that
    // matches the FROST card gradient so corners blend.
    transparent: false,
    backgroundColor: '#0b2018',
    hasShadow: false, resizable: true, skipTaskbar: true,
    focusable: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  // 工作窗口语义: 普通层级不置顶 —— 打开浏览器/其他应用时被自然盖住（不遮挡），
  // 打开时聚焦即可交互。用户偏好: 办公类窗口不沿用宠物/气泡浮窗置顶行为。
  // opaque 窗口无需 re-assert focus（webContents.focus() 会打断 IME 组合会话）
  const id = win.webContents.id
  attachCrashRecovery(win, 'card')
  win.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'card', spec: specId || '' } })
  win.on('moved', () => maybeArchive(id, win))
  win.on('closed', () => { _cards.delete(id); clearArchive(id); broadcastPulledOut(); rebroadcastEdit() })
  if (specId) expandFromDock(win)
  else win.once('ready-to-show', () => win.show())
  _cards.set(id, { win, specId: specId || null })
  broadcastPulledOut()
  rebroadcastEdit()
  return win
}

/** Claim the oldest unbound (draft) card for a freshly created spec. */
export function bindNewestSpec(specId: string): void {
  for (const [id, c] of _cards) {
    if (c.specId === null && !c.win.isDestroyed()) {
      _cards.set(id, { win: c.win, specId })
      safeSend(c.win.webContents, 'genui:card-bind', specId)
      broadcastPulledOut()
      rebroadcastEdit()
      return
    }
  }
}

/** A removed spec frees its card back to draft (claimable by the next new spec). */
export function unbindSpec(specId: string): void {
  for (const [id, c] of _cards) {
    if (c.specId === specId && !c.win.isDestroyed()) {
      _cards.set(id, { win: c.win, specId: null })
      safeSend(c.win.webContents, 'genui:card-bind', '')
      broadcastPulledOut()
      rebroadcastEdit()
    }
  }
}

/** Yellow button: shrink the card window back into the dock. */
export function minimizeCard(win: BrowserWindow): void {
  const id = win.webContents.id
  clearArchive(id)
  archiveCard(id, win)
}

/** Name a draft card: materialize a titled placeholder spec and bind it to
 *  this exact card window (no claim race with other open drafts). */
export function nameDraftCard(win: BrowserWindow, title: string): void {
  const id = win.webContents.id
  const card = _cards.get(id)
  if (!card || card.specId) return
  const spec = { id: `win-${Date.now()}`, title: title.trim().slice(0, 40) || translate(cw(), 'wc.newWindowT'), kind: 'text', props: {} }
  require('./gen-ui').handleSave(spec)
  _cards.set(id, { win, specId: spec.id })
  safeSend(win.webContents, 'genui:card-bind', spec.id)
  broadcastPulledOut()
  rebroadcastEdit()
}

/** Red button on the card window: delete the window — stops its background
 *  function (removeSpec handles the cron job) and removes the card from the
 *  deck permanently. Keep it instead → yellow minimize docks it back. */
export function stopAndCloseCard(win: BrowserWindow): void {
  const id = win.webContents.id
  clearArchive(id)
  const card = _cards.get(id)
  if (card?.specId) {
    try { require('./gen-ui').removeSpec(card.specId) } catch { /* ignore */ }
  }
  if (!win.isDestroyed()) win.close()
}
