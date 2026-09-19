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

/** Cambia «Ctrl» por «⌘» en los textos de ayuda de los atajos, en macOS. */
export function withMod(text: string): string {
  return IS_MAC ? text.replace(/Ctrl( ?\+ ?)/g, '⌘$1') : text
}

/** Una clave de traducción con su variante para este sistema. */
export function perOs(key: string): string {
  return `${key}.${IS_MAC ? 'mac' : IS_LINUX ? 'linux' : 'win'}`
}
