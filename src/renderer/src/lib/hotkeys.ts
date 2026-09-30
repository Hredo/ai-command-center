/**
 * Atajos globales en el formato de Electron («Control+Alt+Space»): de una
 * pulsación a ese formato, y de ese formato a algo legible («Ctrl+Alt+Espacio»,
 * «⌥Espacio» en macOS).
 */

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'])

const NAMED: Record<string, string> = {
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

/** La tecla física (e.code) en el nombre que entiende Electron. */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)
  if (fn) return `F${fn[1]}`
  const pad = /^Numpad([0-9])$/.exec(code)
  if (pad) return `num${pad[1]}`
  return NAMED[code] ?? null
}

/**
 * Una pulsación como atajo global, o null si no vale: hace falta Ctrl, Alt o
 * Cmd (con sólo Mayús y una letra te quedarías sin poder escribirla), salvo
 * con las teclas F.
 */
export function toAccelerator(
  e: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  mac: boolean
): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const key = keyName(e.code)
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.metaKey) mods.push(mac ? 'Command' : 'Super')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const strong = e.ctrlKey || e.metaKey || e.altKey
  if (!strong && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

/** Legible: «Ctrl+Alt+Espacio»; en macOS con símbolos, «⌃⌥Espacio». */
export function formatAccelerator(acc: string, mac: boolean, t: (s: string) => string): string {
  if (!acc) return ''
  const parts = acc.split('+').map((p) => {
    switch (p) {
      case 'CommandOrControl':
      case 'CmdOrCtrl':
        return mac ? '⌘' : 'Ctrl'
      case 'Control':
      case 'Ctrl':
        return mac ? '⌃' : 'Ctrl'
      case 'Command':
      case 'Cmd':
        return '⌘'
      case 'Super':
      case 'Meta':
        return mac ? '⌘' : 'Win'
      case 'Alt':
      case 'Option':
        return mac ? '⌥' : 'Alt'
      case 'Shift':
        return mac ? '⇧' : t('Mayús')
      case 'Space':
        return t('Espacio')
      default:
        return p
    }
  })
  return mac ? parts.join('') : parts.join('+')
}
