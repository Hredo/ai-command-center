/**
 * Icono en la bandeja del sistema y qué pasa al cerrar la ventana.
 *
 * Lo que está en marcha (una conversación que genera, un agente trabajando,
 * una orden larga en la terminal) no vive sólo en este proceso: el motor que
 * guarda los turnos y el historial de la terminal está en la ventana. Por eso
 * «seguir en segundo plano» no puede ser destruir la ventana: se esconde, y
 * todo sigue igual que si estuviera minimizada. Desde el icono se vuelve a
 * abrir o se sale de verdad.
 *
 * Con «cerrar sale» (Ajustes) cerrar la ventana cierra la app, pero si hay
 * algo en marcha se pregunta antes: hasta ahora se cortaba sin avisar.
 */
import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { getConfig, updateSettings } from './config'
import { IS_LINUX, IS_MAC } from './platform'
import { quickStatus, showQuick } from './quick'
import { trayHostOverride } from './testSeams'

export interface Busy {
  chats: number
  arena: number
  terms: number
}

let tray: Tray | null = null
let quitting = false
let busy: Busy = { chats: 0, arena: 0, terms: 0 }
let getWin: () => BrowserWindow | null = () => null
let makeWin: () => void = () => {}

const TEXT = {
  es: {
    open: 'Abrir AI Command Center',
    quick: 'Prompt rápido',
    quit: 'Salir',
    idle: 'Nada en marcha',
    running: (n: number) => (n === 1 ? '1 cosa en marcha' : `${n} cosas en marcha`),
    detail: (b: Busy) =>
      [
        b.chats ? `${b.chats} en la Consola` : null,
        b.arena ? `${b.arena} en la Arena` : null,
        b.terms ? `${b.terms} en terminales` : null
      ].filter(Boolean).join(' · '),
    quitTitle: 'Hay trabajo en marcha',
    quitAsk: (n: number) => (n === 1 ? 'Hay 1 cosa en marcha y se cortará si sales.' : `Hay ${n} cosas en marcha y se cortarán si sales.`),
    quitAnyway: 'Salir igualmente',
    keepInTray: 'Seguir en la bandeja',
    cancel: 'Cancelar',
    hintTitle: 'AI Command Center sigue abierto',
    hintBody: 'Lo que estaba en marcha continúa. Vuelve desde el icono de la bandeja; para salir, «Salir» en su menú. Se cambia en Ajustes.'
  },
  en: {
    open: 'Open AI Command Center',
    quick: 'Quick prompt',
    quit: 'Quit',
    idle: 'Nothing running',
    running: (n: number) => (n === 1 ? '1 thing running' : `${n} things running`),
    detail: (b: Busy) =>
      [
        b.chats ? `${b.chats} in the Console` : null,
        b.arena ? `${b.arena} in the Arena` : null,
        b.terms ? `${b.terms} in terminals` : null
      ].filter(Boolean).join(' · '),
    quitTitle: 'Work in progress',
    quitAsk: (n: number) => (n === 1 ? '1 thing is running and will stop if you quit.' : `${n} things are running and will stop if you quit.`),
    quitAnyway: 'Quit anyway',
    keepInTray: 'Keep in the tray',
    cancel: 'Cancel',
    hintTitle: 'AI Command Center is still open',
    hintBody: 'Whatever was running keeps going. Come back from the tray icon; to quit, use “Quit” in its menu. You can change this in Settings.'
  }
}

function text(): (typeof TEXT)['es'] {
  return getConfig().settings.language === 'en' ? TEXT.en : TEXT.es
}

const total = (b: Busy): number => b.chats + b.arena + b.terms

/** Se está saliendo de verdad: la ventana ya no se esconde al cerrarla. */
export function markQuitting(): void {
  quitting = true
}

export function showWindow(): void {
  const win = getWin()
  if (!win || win.isDestroyed()) {
    if (app.isReady()) makeWin()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Pregunta si hay algo en marcha. Devuelve si hay que salir. */
function confirmQuit(win: BrowserWindow | null, offerTray: boolean): 'quit' | 'tray' | 'cancel' {
  const n = total(busy)
  if (n === 0) return 'quit'
  const tx = text()
  const buttons = offerTray ? [tx.quitAnyway, tx.keepInTray, tx.cancel] : [tx.quitAnyway, tx.cancel]
  const opts: Electron.MessageBoxSyncOptions = {
    type: 'warning',
    title: tx.quitTitle,
    message: tx.quitAsk(n),
    detail: tx.detail(busy),
    buttons,
    defaultId: 1,
    cancelId: buttons.length - 1,
    noLink: true
  }
  const r = win && !win.isDestroyed() ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts)
  if (r === 0) return 'quit'
  if (offerTray && r === 1) return 'tray'
  return 'cancel'
}

function quitFromTray(): void {
  if (confirmQuit(getWin(), false) !== 'quit') return
  quitting = true
  app.quit()
}

/**
 * Se va a salir sin haber pasado por la ventana ni por la bandeja (Cmd+Q en
 * macOS, «Salir» del Dock, el menú de la app): si hay trabajo en marcha se
 * pregunta antes, igual que al cerrar. Devuelve si se sale.
 */
export function confirmAppQuit(e: Electron.Event): boolean {
  if (quitting) return true
  const win = getWin()
  if (confirmQuit(win && !win.isDestroyed() && win.isVisible() ? win : null, false) !== 'quit') {
    e.preventDefault()
    return false
  }
  quitting = true
  return true
}

function hideToTray(win: BrowserWindow): void {
  win.hide()
  const s = getConfig().settings
  if (s.trayHintShown || !Notification.isSupported()) return
  updateSettings({ trayHintShown: true })
  const tx = text()
  const n = new Notification({ title: tx.hintTitle, body: tx.hintBody, silent: true })
  n.on('click', () => showWindow())
  n.show()
}

/**
 * Al pulsar cerrar. Se esconde si así está en Ajustes (lo normal) y, si no,
 * se pregunta antes de cortar lo que esté en marcha.
 */
export function onWindowClose(e: Electron.Event, win: BrowserWindow): void {
  if (quitting) return
  if (getConfig().settings.closeToTray !== false && (tray || IS_MAC)) {
    e.preventDefault()
    hideToTray(win)
    return
  }
  const r = confirmQuit(win, Boolean(tray))
  if (r === 'quit') {
    quitting = true
    // En macOS cerrar la ventana no cierra la app; aquí se ha pedido salir.
    if (IS_MAC) setImmediate(() => app.quit())
    return
  }
  e.preventDefault()
  if (r === 'tray') hideToTray(win)
}

function trayImage(iconPath: string): Electron.NativeImage {
  const src = nativeImage.createFromPath(iconPath)
  if (src.isEmpty()) return src
  // En macOS la barra de menús mide 22 px; en Windows y Linux, 16 (32 en pantallas densas).
  const base = IS_MAC ? 18 : 16
  const img = nativeImage.createEmpty()
  for (const scale of [1, 2]) {
    const size = base * scale
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: src.resize({ width: size, height: size, quality: 'best' }).toPNG() })
  }
  return img
}

function refresh(): void {
  if (!tray || tray.isDestroyed()) return
  const tx = text()
  const n = total(busy)
  tray.setToolTip(n ? `AI Command Center · ${tx.running(n)}` : 'AI Command Center')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tx.open, click: () => showWindow() },
      // El atajo se enseña al lado (en Linux el menú va por AppIndicator y GTK se queja).
      { label: tx.quick, accelerator: !IS_LINUX && quickStatus().registered ? quickStatus().accelerator : undefined, click: () => showQuick() },
      { type: 'separator' },
      { label: n ? tx.running(n) : tx.idle, enabled: false },
      ...(n ? [{ label: tx.detail(busy), enabled: false }] : []),
      { type: 'separator' },
      { label: tx.quit, click: () => quitFromTray() }
    ])
  )
}

/** Lo que la ventana dice que tiene en marcha: el tooltip y el menú lo enseñan. */
export function setBusy(next: Busy): void {
  const clean = (v: unknown): number => Math.max(0, Math.min(999, Math.floor(Number(v) || 0)))
  busy = { chats: clean(next?.chats), arena: clean(next?.arena), terms: clean(next?.terms) }
  refresh()
}

/** Hay icono en la bandeja (en un Linux sin iconos de estado puede no haberlo). */
export function hasTray(): boolean {
  return Boolean(tray && !tray.isDestroyed())
}

/** El idioma cambió: el menú se rehace. */
export function refreshTray(): void {
  refresh()
}

/**
 * En Linux crear el icono no falla aunque nadie lo pinte: GNOME sin la
 * extensión de AppIndicator (Fedora, Debian) y Wayland sin anfitrión de iconos
 * no tienen bandeja. Se pregunta por D-Bus si hay un StatusNotifierWatcher.
 * Devuelve null si no se puede saber.
 */
function linuxTrayHost(): Promise<boolean | null> {
  const forced = trayHostOverride()
  if (forced !== null) return Promise.resolve(forced)
  return new Promise((resolve) => {
    execFile(
      'gdbus',
      ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'],
      { timeout: 4000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const out = String(stdout)
        resolve(/true/.test(out) ? true : /false/.test(out) ? false : null)
      }
    )
  })
}

/** Sin anfitrión de iconos, sólo los escritorios X11 clásicos (que usan XEmbed) pintan el icono. */
function linuxNeedsHost(): boolean {
  const desktop = (process.env['XDG_CURRENT_DESKTOP'] ?? '').toLowerCase()
  return Boolean(process.env['WAYLAND_DISPLAY']) || process.env['XDG_SESSION_TYPE'] === 'wayland' || desktop.includes('gnome')
}

export function initTray(opts: { getWin: () => BrowserWindow | null; createWindow: () => void; icon: string }): void {
  getWin = opts.getWin
  makeWin = opts.createWindow
  try {
    tray = new Tray(trayImage(opts.icon))
  } catch (err) {
    // Sin bandeja (un escritorio de Linux sin iconos de estado): cerrar sale, como antes.
    console.error('[tray] no se pudo crear el icono:', err)
    tray = null
    return
  }
  // En Windows y Linux un clic abre la ventana; en macOS el clic abre el menú, como allí se espera.
  if (!IS_MAC) tray.on('click', () => showWindow())
  refresh()
  if (IS_LINUX) {
    void linuxTrayHost().then((host) => {
      if (host !== false || !linuxNeedsHost()) return
      // Nadie va a pintar el icono: sin bandeja, cerrar la ventana sale (preguntando
      // si hay algo en marcha) y una ventana que arrancó escondida se enseña.
      console.log('[tray] este escritorio no tiene bandeja de iconos: cerrar la ventana saldrá de la app')
      destroyTray()
      const win = getWin()
      if (win && !win.isDestroyed() && !win.isVisible()) win.show()
    })
  }
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
