/**
 * Prompt rápido: un atajo del sistema abre una ventanita encima de cualquier
 * app para preguntar a un modelo sin buscar la ventana principal.
 *
 * La ventanita no ejecuta nada por su cuenta. Manda la pregunta a la ventana
 * principal (escondida en la bandeja o no), cuyo motor la lanza como una
 * conversación más de la Consola: se guarda, cuenta en el histórico y se
 * puede seguir allí. Lo que el modelo va escribiendo se le reenvía desde
 * aquí, al vuelo, porque la ventana principal escondida tiene los
 * temporizadores frenados y el texto le llegaría a trompicones.
 */
import { BrowserWindow, globalShortcut, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getConfig } from './config'
import { emit } from './emit'
import { IS_LINUX, IS_MAC } from './platform'
import { lockDownNavigation, RENDERER_PREFS } from './security'
import type { QuickEvent, QuickHotkeyStatus, QuickRun, RunRecord, StreamDelta } from '@shared/types'

/** Option+Espacio en macOS (Cmd+Option+Espacio abre Finder); Ctrl+Alt+Espacio en el resto. */
export const DEFAULT_QUICK_HOTKEY = IS_MAC ? 'Alt+Space' : 'Control+Alt+Space'

const WIDTH = 680
const HEIGHT = 480

let quickWin: BrowserWindow | null = null
let registered = ''
let status: QuickHotkeyStatus = { accelerator: '', defaultAccelerator: DEFAULT_QUICK_HOTKEY, registered: false }
let getMain: () => BrowserWindow | null = () => null
let showMain: () => void = () => {}
/** Conversación de la Consola → la petición de la ventanita que la lanzó. */
const bindings = new Map<string, string>()

export function initQuick(opts: { getMain: () => BrowserWindow | null; showMain: () => void }): void {
  getMain = opts.getMain
  showMain = opts.showMain
  registerQuickHotkey()
}

/** (Re)registra el atajo según Ajustes. Devuelve cómo ha quedado. */
export function registerQuickHotkey(): QuickHotkeyStatus {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = ''
  }
  const wanted = getConfig().settings.quickHotkey
  const acc = wanted == null ? DEFAULT_QUICK_HOTKEY : String(wanted).trim()
  if (!acc) {
    status = { accelerator: '', defaultAccelerator: DEFAULT_QUICK_HOTKEY, registered: false }
    return status
  }
  try {
    const ok = globalShortcut.register(acc, () => toggleQuick())
    if (ok) registered = acc
    status = { accelerator: acc, defaultAccelerator: DEFAULT_QUICK_HOTKEY, registered: ok, error: ok ? undefined : 'taken' }
  } catch {
    status = { accelerator: acc, defaultAccelerator: DEFAULT_QUICK_HOTKEY, registered: false, error: 'invalid' }
  }
  return status
}

/** Lo que hay que poner en un atajo del escritorio para abrir la ventanita. */
function quickCommand(): string | undefined {
  if (!IS_LINUX) return undefined
  // Una AppImage se lanza por ella misma, no por lo que desempaqueta.
  const exe = process.env['APPIMAGE'] || process.execPath
  return `${/\s/.test(exe) ? `"${exe}"` : exe} --quick`
}

export function quickStatus(): QuickHotkeyStatus {
  return { ...status, command: quickCommand() }
}

export function unregisterQuickHotkey(): void {
  globalShortcut.unregisterAll()
  registered = ''
}

function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 480,
    minHeight: 300,
    show: false,
    frame: false,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#0a0b0f',
    title: 'Prompt rápido',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...RENDERER_PREFS
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Como Spotlight: al irte a otra cosa se esconde. Lo que estaba contestando
  // sigue y queda en la Consola.
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) win.hide()
  })
  win.on('closed', () => {
    quickWin = null
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  lockDownNavigation(win.webContents, devUrl)
  if (devUrl) void win.loadURL(`${devUrl}#quick`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'quick' })
  return win
}

/** En la pantalla donde está el ratón, centrada y hacia arriba. */
function place(win: BrowserWindow): void {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const [w, h] = win.getSize()
  win.setBounds({
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + Math.max(24, area.height * 0.16)),
    width: w,
    height: Math.min(h, area.height - 48)
  })
}

export function showQuick(): void {
  if (!quickWin || quickWin.isDestroyed()) quickWin = createQuickWindow()
  const win = quickWin
  place(win)
  const reveal = (): void => {
    win.show()
    win.setAlwaysOnTop(true, 'floating')
    // En X11 el gestor de ventanas lo quita al mostrarla, aunque se haya puesto
    // antes o justo después: hay que volver a ponerlo cuando ya la ha enseñado.
    if (IS_LINUX) {
      for (const ms of [60, 180, 450]) setTimeout(() => !win.isDestroyed() && win.isVisible() && win.setAlwaysOnTop(true, 'floating'), ms)
    }
    win.focus()
    emit(win, 'quick:shown', {})
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
  else reveal()
}

export function hideQuick(): void {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) quickWin.hide()
}

export function toggleQuick(): void {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible() && quickWin.isFocused()) hideQuick()
  else showQuick()
}

function toQuick(e: QuickEvent): void {
  emit(quickWin, 'quick:event', e)
}

/** La ventanita pide lanzar un prompt: se le pasa a la principal. */
export function submitQuick(req: Omit<QuickRun, 'requestId'>): string {
  const main = getMain()
  if (!main || main.isDestroyed()) throw new Error('La ventana principal no está abierta')
  const requestId = randomUUID()
  emit(main, 'quick:run', { ...req, requestId })
  return requestId
}

/** La principal dice en qué conversación va: desde ahí se le reenvía lo que llegue. */
export function bindQuick(requestId: string, sessionId: string): void {
  bindings.set(sessionId, requestId)
  toQuick({ requestId, sessionId })
}

/** La principal no pudo lanzarlo (sin modelo, conversación ocupada…). */
export function failQuick(requestId: string, error: string): void {
  for (const [sid, rid] of bindings) if (rid === requestId) bindings.delete(sid)
  toQuick({ requestId, done: true, error })
}

/**
 * Si esta conversación la lanzó la ventanita, lo que va llegando se le manda
 * también a ella. Devuelve null si no.
 */
export function quickTap(conversationId: string | undefined): ((d: StreamDelta) => void) | null {
  const requestId = conversationId ? bindings.get(conversationId) : undefined
  if (!conversationId || !requestId) return null
  return (delta) => toQuick({ requestId, sessionId: conversationId, delta })
}

/**
 * Terminó una ejecución que venía de la ventanita. Devuelve si la ventanita
 * está a la vista (entonces sobra la notificación del sistema).
 */
export function quickFinished(conversationId: string | undefined, run: RunRecord): boolean {
  const requestId = conversationId ? bindings.get(conversationId) : undefined
  if (!conversationId || !requestId) return false
  bindings.delete(conversationId)
  toQuick({
    requestId,
    sessionId: conversationId,
    done: true,
    response: run.response,
    error: run.status === 'error' ? (run.error ?? 'Error desconocido') : undefined,
    model: run.model,
    costTotal: run.costTotal,
    totalMs: run.totalMs
  })
  return Boolean(quickWin && !quickWin.isDestroyed() && quickWin.isVisible())
}

/** «Seguir en la Consola»: se esconde la ventanita y se abre esa conversación. */
export function openQuickInConsole(sessionId: string): void {
  hideQuick()
  showMain()
  emit(getMain(), 'quick:focus', { sessionId })
}
