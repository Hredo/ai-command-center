/**
 * El sistema en el que corre la app, para lo poco que cambia en la interfaz:
 * los semáforos de macOS en la barra de título, Cmd en vez de Ctrl en los
 * atajos, y cómo se llama el explorador de archivos o el llavero.
 *
 * Lo da el preload de forma síncrona. Fuera de Electron (el arnés de pruebas
 * con la API simulada) se cae a Windows, que es como se comportaba siempre.
 */
const raw = typeof window !== 'undefined' ? window.api?.platform : undefined

export const PLATFORM: 'win32' | 'darwin' | 'linux' = raw === 'darwin' || raw === 'linux' ? raw : 'win32'
export const IS_MAC = PLATFORM === 'darwin'
export const IS_LINUX = PLATFORM === 'linux'
export const IS_WIN = PLATFORM === 'win32'

/** La tecla de los atajos: Cmd en macOS, Ctrl en el resto. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'

/** ¿Está pulsada la tecla de los atajos? */
export function modKey(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey
}

/**
 * El signo que lleva en este teclado la tecla física de «\». Los atajos de
 * dividir la mesa van por esa tecla, que en un teclado español es la «ç» y en
 * uno alemán la «#»: se enseña el signo que tienes delante, no el del inglés.
 */
let backslashKey = '\\'
if (typeof navigator !== 'undefined') {
  const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard
  void kb
    ?.getLayoutMap?.()
    .then((map) => {
      const k = map.get('Backslash')
      if (k) backslashKey = k.length === 1 ? k.toUpperCase() : k
    })
    .catch(() => undefined)
}

/**
 * Deja un atajo como se pulsa aquí: «⌘» en vez de «Ctrl» en macOS, y la tecla
 * de «\» con el signo de este teclado.
 */
export function withMod(text: string): string {
  const out = IS_MAC ? text.replace(/Ctrl( ?\+ ?)/g, '⌘$1') : text
  return backslashKey !== '\\' && out.includes('\\') ? out.replace(/\\/g, backslashKey) : out
}

/** Una clave de traducción con su variante para este sistema. */
export function perOs(key: string): string {
  return `${key}.${IS_MAC ? 'mac' : IS_LINUX ? 'linux' : 'win'}`
}
