/**
 * Endurecimiento del proceso principal.
 *
 * La ventana es el trozo de la aplicación que pinta HTML, y HTML es donde
 * acaban entrando cosas que no escribiste tú: la respuesta de un modelo, el
 * README de un repositorio clonado, el nombre de una rama. El renderer ya corre
 * aislado y sin Node, así que lo que queda por cerrar es todo lo demás:
 *
 *  - Que la ventana no pueda navegar a ningún sitio ni abrir ventanas nuevas.
 *  - Que no pueda pedir cámara, micrófono, ubicación ni nada por el estilo.
 *  - Que sólo cargue sus propios recursos (CSP), sin hueco para un script
 *    inyectado ni una petición a un servidor de fuera.
 *  - Que los mensajes que llegan por IPC vengan de *nuestra* ventana y con
 *    argumentos del tipo y del tamaño que se espera.
 *  - Que abrir un enlace externo signifique http(s) y no cualquier cosa que
 *    Windows sepa ejecutar.
 *
 * Nada de esto se apoya en que el código de la ventana se porte bien: son
 * puertas cerradas desde fuera.
 */
import { app, session, shell, BrowserWindow, type WebContents } from 'electron'
import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/* ------------------------------------------------------------------ *
 * Ajustes de la ventana                                              *
 * ------------------------------------------------------------------ */

/**
 * Con qué permisos nace el renderer. Está aquí y no junto a la ventana porque
 * la pantalla de Seguridad enseña estos mismos valores: si alguien afloja uno,
 * la aplicación lo dice en voz alta en vez de seguir prometiendo que está todo
 * cerrado.
 */
export const RENDERER_PREFS = {
  // El renderer corre dentro del sandbox de Chromium: aunque alguien
  // consiguiera ejecutar código ahí, no tiene sistema de ficheros ni procesos,
  // sólo los canales IPC que abre el preload.
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: false,
  // Chromium frena los temporizadores y deja de pintar fotogramas cuando la
  // ventana está minimizada o tapada por otra. Aquí eso no vale: si un agente
  // está escribiendo mientras miras otra cosa, el texto se quedaba parado y
  // parecía que se había colgado. Cuesta algo de batería y a cambio lo que
  // corre por detrás sigue corriendo de verdad.
  backgroundThrottling: false
} as const

/* ------------------------------------------------------------------ *
 * Política de contenido                                              *
 * ------------------------------------------------------------------ */

/**
 * En producción la ventana sólo puede cargar lo que viene dentro del paquete.
 * `connect-src 'none'` es la línea importante: el renderer no habla con la red
 * ni aunque alguien consiga colar un `fetch`. Todo lo que sale a internet sale
 * del proceso principal, por IPC, donde hay claves y control.
 *
 * `style-src` conserva `'unsafe-inline'` porque React escribe estilos en el
 * atributo `style` de los elementos; sin eso no habría ni una barra de progreso.
 * `script-src` no lo lleva, que es donde de verdad importa.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "worker-src 'self' blob:",
  'upgrade-insecure-requests'
].join('; ')

/**
 * En desarrollo hace falta aflojar: Vite sirve por http, recarga con WebSocket
 * e inyecta scripts en línea para el hot reload. Sigue estando prohibido salir
 * a internet — sólo se admite el propio servidor de desarrollo.
 */
const CSP_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

export function applyCsp(dev: boolean): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [dev ? CSP_DEV : CSP],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer']
      }
    })
  })
}

/* ------------------------------------------------------------------ *
 * Permisos del motor web                                             *
 * ------------------------------------------------------------------ */

/**
 * Todo denegado. La aplicación no usa cámara, ni micrófono, ni ubicación, ni
 * notificaciones del motor web (las suyas las manda el proceso principal, que
 * es quien sabe si la ventana está en primer plano). Si algún día hiciera falta
 * alguno, se añade aquí a mano y se sabe por qué.
 */
export function lockDownPermissions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  // Nadie puede enumerar dispositivos ni pedir puertos serie, USB o HID.
  ses.setDevicePermissionHandler(() => false)
  ses.setDisplayMediaRequestHandler(() => {
    /* sin capturar pantalla */
  })
}

/* ------------------------------------------------------------------ *
 * Navegación                                                         *
 * ------------------------------------------------------------------ */

/** Esquemas que vale la pena abrir en el navegador del sistema. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Un enlace externo tiene que ser una dirección web de verdad. `file:`,
 * `javascript:`, `vbscript:` o un protocolo registrado por otro programa
 * («abrir con…») son formas conocidas de convertir «pulsa aquí» en «ejecuta
 * esto», y esta aplicación muestra texto que escriben modelos.
 */
export function openExternal(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(String(url))
  } catch {
    throw new Error('no parece una dirección válida')
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) {
    throw new Error(`sólo se abren enlaces http, https y mailto (llegó «${parsed.protocol}»)`)
  }
  void shell.openExternal(parsed.toString())
}

/**
 * La ventana se queda donde está. Cualquier intento de navegar fuera de la
 * aplicación —un enlace, un formulario, un `location.href` inyectado— se
 * cancela, y si era una dirección web se abre en el navegador del sistema.
 */
export function lockDownNavigation(contents: WebContents, devUrl?: string): void {
  const allowed = (url: string): boolean => {
    if (url.startsWith('file://')) return true
    if (devUrl && url.startsWith(devUrl)) return true
    return false
  }

  contents.on('will-navigate', (e, url) => {
    if (allowed(url)) return
    e.preventDefault()
    try {
      openExternal(url)
    } catch {
      /* si no es una dirección web, simplemente no se va a ninguna parte */
    }
  })

  contents.setWindowOpenHandler(({ url }) => {
    try {
      openExternal(url)
    } catch {
      /* ídem */
    }
    return { action: 'deny' }
  })

  // No hay webviews en la aplicación; si algún día apareciera una, que nazca
  // sin Node y sin preload en vez de heredarlos.
  contents.on('will-attach-webview', (e, prefs) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    e.preventDefault()
  })
}

/* ------------------------------------------------------------------ *
 * Validación de lo que llega por IPC                                 *
 * ------------------------------------------------------------------ */

/**
 * Sólo se atiende a la ventana de la aplicación, y sólo si el marco que habla
 * es el suyo principal cargado desde el paquete. Un `iframe` metido de rondón
 * en una respuesta de un modelo no puede llamar a un canal aunque lo intente.
 */
export function isTrustedSender(e: { senderFrame?: Electron.WebFrameMain | null; sender: WebContents }, devUrl?: string): boolean {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || win.isDestroyed()) return false

  const frame = e.senderFrame
  // `senderFrame` puede ser nulo si el marco se destruyó entre el envío y
  // la recepción; en ese caso la respuesta ya no le llega a nadie.
  if (!frame) return false
  if (frame !== e.sender.mainFrame) return false

  const url = frame.url || ''
  if (devUrl && url.startsWith(devUrl)) return true
  return url.startsWith('file://')
}

/** Tope de una cadena que llega de la ventana. Evita empachos de memoria. */
const MAX_STRING = 8 * 1024 * 1024

export function checkArgs(channel: string, args: unknown[]): void {
  if (args.length > 12) throw new Error(`${channel}: demasiados argumentos`)
  for (const a of args) {
    if (typeof a === 'string' && a.length > MAX_STRING) {
      throw new Error(`${channel}: argumento demasiado grande`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Rutas                                                              *
 * ------------------------------------------------------------------ */

/**
 * Resuelve una ruta relativa dentro de una raíz y se niega si se sale.
 *
 * Además de comparar cadenas se resuelve la ruta real, porque en Windows un
 * enlace simbólico o una unión de directorios dentro del proyecto puede
 * apuntar a `C:\Windows` y la comparación de texto no se entera: el camino
 * «no se sale» hasta que el sistema lo sigue.
 *
 * Si la ruta todavía no existe —se está creando un fichero— se comprueba la
 * carpeta padre que sí exista, que es lo que va a decidir dónde acaba.
 */
export function guardPath(root: string, rel: string): string {
  const base = realOf(resolve(root))
  const full = resolve(resolve(root), rel || '.')
  const real = realOf(full)

  const inside = (p: string): boolean =>
    p === base || p.startsWith(base.endsWith(sep) ? base : base + sep)

  if (!inside(full) || !inside(real)) {
    throw new Error('ruta fuera del proyecto')
  }
  return full
}

/** La ruta real de lo que exista: si no existe, la del ancestro que sí. */
function realOf(p: string): string {
  let cur = p
  for (let i = 0; i < 40; i++) {
    try {
      return realpathSync.native(cur)
    } catch {
      const parent = resolve(cur, '..')
      if (parent === cur) return p
      cur = parent
    }
  }
  return p
}

/* ------------------------------------------------------------------ *
 * Arranque del proceso                                               *
 * ------------------------------------------------------------------ */

/**
 * Lo que hay que cerrar antes de que exista la primera ventana.
 *
 * Una segunda instancia no puede colarse por la línea de órdenes: se ignoran
 * los conmutadores que aflojan el aislamiento por si alguien lanza el
 * ejecutable con ellos desde un acceso directo manipulado.
 */
export function hardenApp(): void {
  const dangerous = [
    'no-sandbox',
    'disable-web-security',
    'remote-debugging-port',
    'remote-debugging-pipe',
    'inspect',
    'inspect-brk',
    'js-flags',
    'host-rules',
    'proxy-server',
    'disable-features'
  ]
  for (const flag of dangerous) {
    if (app.commandLine.hasSwitch(flag)) app.commandLine.removeSwitch(flag)
  }
}

/** Estado que la pantalla de Seguridad enseña al usuario. */
export interface SecurityReport {
  contextIsolation: boolean
  nodeIntegration: boolean
  sandboxedRenderer: boolean
  csp: boolean
  navigationLocked: boolean
  permissionsDenied: boolean
  encryptionAvailable: boolean
  packaged: boolean
  dataDir: string
}
