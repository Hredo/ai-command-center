import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { registerIpc } from './ipc'
import { paths } from './paths'
import { getConfig } from './config'
import { refreshCatalog, getCatalog } from './providers/models'
import { watchLocalServers, stopWatchingLocalServers } from './detect'
import { closeAllTerms, ptyAvailable } from './terminal'
import { initNotify } from './notify'
import { initWatch, stopAllWatches } from './watch'
import { initUsage } from './usage'
import { watchClaude, stopWatchingClaude } from './claudeWatch'
import { applyCsp, hardenApp, lockDownNavigation, lockDownPermissions, RENDERER_PREFS } from './security'

// Lo primero de todo: quitar de la línea de órdenes cualquier conmutador que
// afloje el aislamiento. Tiene que pasar antes de que Electron los lea.
hardenApp()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0b0f',
    title: 'AI Command Center',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0b0f',
      symbolColor: '#8b93a7',
      height: 38
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      ...RENDERER_PREFS
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

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
function writeDiagnostics(): void {
  try {
    const pty = ptyAvailable()
    writeFileSync(
      join(paths.dir, 'diagnostics.json'),
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          version: app.getVersion(),
          electron: process.versions.electron,
          node: process.versions.node,
          abi: process.versions.modules,
          packaged: app.isPackaged,
          terminal: pty.available
            ? { backend: 'pty', detail: 'consola real (ConPTY)' }
            : { backend: 'pipe', detail: pty.reason ?? 'el módulo nativo no cargó' }
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

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  applyCsp(Boolean(process.env['ELECTRON_RENDERER_URL']))
  lockDownPermissions()
  initNotify(() => mainWindow)

  // Lo que cambia en disco y lo que dicen los proveedores sobre el consumo
  // van a la ventana en cuanto se sabe: la interfaz no pregunta, escucha.
  initWatch((e) => mainWindow?.webContents.send('git:changed', e))
  initUsage((all) => mainWindow?.webContents.send('usage:updated', all))

  writeDiagnostics()
  registerIpc(() => mainWindow)
  createWindow()

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
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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
    }
  })
}
