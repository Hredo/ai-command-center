import { app, BrowserWindow, Menu, nativeTheme, screen } from 'electron'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import icon from '../../build/icon.png?asset'
import { registerIpc } from './ipc'
import { paths } from './paths'
import { getConfig } from './config'
import { refreshCatalog, getCatalog } from './providers/models'
import { watchLocalServers, stopWatchingLocalServers } from './detect'
import { closeAllTerms, terminalStatus } from './terminal'
import { initNotify } from './notify'
import { initWatch, stopAllWatches } from './watch'
import { initUsage } from './usage'
import { initLive } from './live'
import { watchClaude, stopWatchingClaude } from './claudeWatch'
import { applyCsp, hardenApp, lockDownNavigation, lockDownPermissions, RENDERER_PREFS } from './security'
import { IS_LINUX, IS_MAC } from './platform'
import { ensureUtf8Locale, loadShellEnv } from './shellEnv'
import { runSelfTest } from './selftest'
import { TITLEBAR_HEIGHT, trafficLights } from '@shared/defaults'

// Lo primero de todo: quitar de la línea de órdenes cualquier conmutador que
// afloje el aislamiento. Tiene que pasar antes de que Electron los lea.
hardenApp()

/**
 * Autoprueba: con ACC_SELFTEST=<carpeta> la app arranca con datos de usar y
 * tirar, comprueba sus piezas de verdad (ventana, terminal, integración de
 * shell, comandos del agente, PATH) y sale con 0 o 1. Es lo que usa la CI en
 * cada sistema con la app ya empaquetada. Sin la variable no hace nada.
 */
const SELFTEST = process.env['ACC_SELFTEST']?.trim()
if (SELFTEST) app.setPath('userData', mkdtempSync(join(tmpdir(), 'acc-selftest-')))

// En macOS y Linux el PATH de la shell del usuario se lee ya, mientras
// Electron arranca: cuando la ventana pida detectar CLIs, estará listo.
const shellEnvReady = loadShellEnv()

let mainWindow: BrowserWindow | null = null

/**
 * La barra de título la pinta la app en los tres sistemas. En Windows y
 * Linux los botones de ventana van a la derecha, dibujados por el sistema
 * encima de la barra; en macOS son los tres semáforos de la izquierda.
 */
function chromeOptions(): Electron.BrowserWindowConstructorOptions {
  if (IS_MAC) {
    return { titleBarStyle: 'hidden', trafficLightPosition: trafficLights(1) }
  }
  return {
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0b0f',
      symbolColor: '#8b93a7',
      height: TITLEBAR_HEIGHT
    },
    // En Linux la ventana necesita su icono aparte: el del escritorio sólo
    // lo usa el lanzador.
    ...(IS_LINUX ? { icon } : {})
  }
}

/**
 * Tamaño inicial: el de siempre, salvo que la pantalla sea más pequeña. En un
 * portátil de 13" (o un Mac con la resolución «más espacio» desactivada) una
 * ventana de 1480×940 se salía por abajo y los botones quedaban fuera.
 */
function initialSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize
  return {
    width: Math.max(1080, Math.min(1480, Math.round(area.width * 0.94))),
    height: Math.max(680, Math.min(940, Math.round(area.height * 0.94)))
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...initialSize(),
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0b0f',
    title: 'AI Command Center',
    ...chromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...RENDERER_PREFS
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // En macOS cerrar la ventana no cierra la app: se queda en el Dock y el
  // icono la vuelve a abrir. Hasta entonces no hay ventana a la que avisar.
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']

  // La ventana no navega a ningún sitio y no abre ventanas nuevas: los enlaces
  // externos salen al navegador del sistema y sólo si son http, https o mailto.
  lockDownNavigation(mainWindow.webContents, devUrl)

  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Red de seguridad. El PTY es un módulo nativo y sus procesos auxiliares
 * pueden fallar en algunos equipos (por ejemplo el que enumera consolas de
 * Windows). Eso no debe tumbar la aplicación entera: se registra y se sigue.
 */
process.on('uncaughtException', (err) => {
  console.error('[main] excepción no capturada:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] promesa rechazada sin manejar:', reason)
})

/**
 * Diagnóstico de arranque.
 *
 * Se escribe en la carpeta de datos en cada inicio. Sirve para saber, sobre la
 * versión instalada, si la consola nativa cargó o si la terminal está en modo
 * de respaldo: dentro del paquete no hay consola donde leer los mensajes.
 */
async function writeDiagnostics(): Promise<void> {
  try {
    // Espera al sondeo del puente de PowerShell si el módulo nativo no carga:
    // así el diagnóstico dice qué motor tendrá de verdad la terminal.
    const pty = await terminalStatus()
    writeFileSync(
      join(paths.dir, 'diagnostics.json'),
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          version: app.getVersion(),
          electron: process.versions.electron,
          node: process.versions.node,
          abi: process.versions.modules,
          platform: `${process.platform}-${process.arch}`,
          packaged: app.isPackaged,
          terminal:
            pty.engine === 'native'
              ? {
                  backend: 'pty',
                  engine: 'native',
                  detail: `consola real (${process.platform === 'win32' ? 'ConPTY' : 'pseudoterminal del sistema'} con node-pty)`
                }
              : pty.engine === 'bridge'
                ? {
                    backend: 'pty',
                    engine: 'bridge',
                    detail: 'consola real (ConPTY a través de PowerShell)',
                    nativeModule: pty.reason
                  }
                : { backend: 'pipe', engine: 'pipe', detail: pty.reason ?? 'no hay consola real' }
        },
        null,
        2
      ),
      'utf8'
    )
  } catch (err) {
    console.error('[main] no se pudo escribir el diagnóstico:', err)
  }
}

/**
 * El menú de macOS. Allí la barra de menús es del sistema y sin ella no hay
 * Cmd+C, Cmd+V, Cmd+Q ni Cmd+H. Sólo lleva eso: nada de recargar la ventana
 * ni de abrir las herramientas de desarrollo.
 */
function macMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        role: 'windowMenu',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'front' }]
      }
    ])
  )
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  if (IS_MAC) macMenu()
  ensureUtf8Locale(app.getLocale())
  // Normalmente ya ha terminado. Si la configuración de la shell tarda, no se
  // espera más de unos segundos: el PATH se completa igual cuando acabe.
  await Promise.race([shellEnvReady, new Promise((r) => setTimeout(r, 4000))])
  applyCsp(Boolean(process.env['ELECTRON_RENDERER_URL']))
  lockDownPermissions()
  initNotify(() => mainWindow)

  // Lo que cambia en disco y lo que dicen los proveedores sobre el consumo
  // van a la ventana en cuanto se sabe: la interfaz no pregunta, escucha.
  initWatch((e) => mainWindow?.webContents.send('git:changed', e))
  initUsage((all) => mainWindow?.webContents.send('usage:updated', all))
  // El histórico y la configuración avisan al cambiar, venga el cambio de
  // donde venga: el Panel, el Histórico y la barra de título se releen solos.
  initLive((topics) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('live:changed', { topics })
  })

  // No frena el arranque: si hay que sondear el puente de la terminal, el
  // diagnóstico se escribe cuando termine. De paso, la primera terminal ya se
  // encuentra el sondeo hecho.
  void writeDiagnostics()
  registerIpc(() => mainWindow)
  createWindow()
  if (SELFTEST && mainWindow) void runSelfTest(mainWindow, SELFTEST)

  // Las sesiones de Claude Code que corren fuera de la app —en una terminal o
  // en la app de Claude— se leen de sus transcripciones y entran al histórico
  // como cualquier otra. También son las que dicen cuánto llevas gastado del
  // plan en las últimas horas.
  watchClaude((payload) => mainWindow?.webContents.send('claude:updated', payload))

  // Los motores locales se vigilan solos: arrancar Ollama con la app abierta
  // se refleja sin tener que pulsar nada.
  watchLocalServers((servers) => {
    mainWindow?.webContents.send('detect:localChanged', servers)
  })

  // El catálogo de modelos se refresca en segundo plano: la app abre igual
  // aunque no haya red.
  const cfg = getConfig()
  const stale = Date.now() - getCatalog().fetchedAt > 12 * 3600_000
  if (cfg.settings.autoRefreshCatalog && stale) {
    refreshCatalog()
      .then((r) => {
        mainWindow?.webContents.send('catalog:updated', r)
      })
      .catch((e) => console.error('No se pudo refrescar el catálogo:', e.message))
  }

  app.on('activate', () => {
    if (!mainWindow || BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!IS_MAC || SELFTEST) app.quit()
})

// Las shells de las terminales son procesos hijos: hay que cerrarlas o
// quedarían huérfanas al salir.
app.on('before-quit', () => {
  stopWatchingLocalServers()
  stopWatchingClaude()
  stopAllWatches()
  closeAllTerms()
})

// Una sola instancia: si se abre otra, se enfoca la que ya está.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else if (app.isReady()) {
      // macOS: la app seguía viva en el Dock, pero sin ventana.
      createWindow()
    }
  })
}
