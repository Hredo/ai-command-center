/**
 * Intérprete mínimo de secuencias ANSI.
 *
 * Las shells y las herramientas de desarrollo cuelan códigos de escape incluso
 * con NO_COLOR puesto. Aquí se traducen los de color y estilo a tramos con
 * estilo, y el resto —mover el cursor, limpiar la pantalla, títulos de
 * ventana— se descarta: sin un PTY detrás no hay una rejilla que mover.
 */

export interface AnsiSpan {
  text: string
  /** Color de primer plano ya resuelto a CSS, si lo había. */
  color?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

/** Paleta de 16 colores, en tonos que casan con el tema oscuro de la app. */
const BASE = [
  '#3b4252', '#fb7185', '#34d399', '#fbbf24',
  '#60a5fa', '#a78bfa', '#22d3ee', '#c3cad9'
]
const BRIGHT = [
  '#5c6478', '#fda4af', '#6ee7b7', '#fcd34d',
  '#93c5fd', '#c4b5fd', '#67e8f9', '#e7eaf2'
]

/** Color de la tabla de 256: 16 básicos, cubo 6x6x6 y 24 grises. */
function xterm256(n: number): string {
  if (n < 8) return BASE[n]
  if (n < 16) return BRIGHT[n - 8]
  if (n < 232) {
    const i = n - 16
    const steps = [0, 95, 135, 175, 215, 255]
    return `rgb(${steps[Math.floor(i / 36) % 6]},${steps[Math.floor(i / 6) % 6]},${steps[i % 6]})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)

/**
 * Se construye a partir de constantes en lugar de escribir los bytes de
 * control en el literal: un ESC dentro del fuente es invisible y cualquier
 * edición posterior lo destroza sin que se note.
 *
 * Por orden: CSI (ESC [ parámetros letra), OSC (ESC ] … BEL o ESC \),
 * selección de juego de caracteres y modos de teclado.
 */
const ANSI_RX = new RegExp(
  [
    `${ESC}\\[([0-9;?]*)([A-Za-z])`,
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}[()][A-Za-z0-9]`,
    `${ESC}[=><]`
  ].join('|'),
  'g'
)

interface Style {
  color?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

function applySgr(style: Style, params: string): Style {
  const codes = params.split(';').filter((s) => s !== '').map(Number)
  if (!codes.length) return {}
  const next: Style = { ...style }

  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 0) {
      for (const k of Object.keys(next)) delete (next as Record<string, unknown>)[k]
    } else if (c === 1) next.bold = true
    else if (c === 2) next.dim = true
    else if (c === 3) next.italic = true
    else if (c === 4) next.underline = true
    else if (c === 22) {
      next.bold = undefined
      next.dim = undefined
    } else if (c === 23) next.italic = undefined
    else if (c === 24) next.underline = undefined
    else if (c >= 30 && c <= 37) next.color = BASE[c - 30]
    else if (c >= 90 && c <= 97) next.color = BRIGHT[c - 90]
    else if (c === 39) next.color = undefined
    else if (c === 38 || c === 48) {
      // 38;5;n = tabla de 256; 38;2;r;g;b = color directo. 48 es el fondo, que
      // aquí no se pinta, pero hay que consumir sus parámetros igual.
      const mode = codes[i + 1]
      if (mode === 5) {
        const v = codes[i + 2]
        if (c === 38 && Number.isFinite(v)) next.color = xterm256(v)
        i += 2
      } else if (mode === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]]
        if (c === 38 && Number.isFinite(r)) next.color = `rgb(${r},${g},${b})`
        i += 4
      }
    }
  }
  return next
}

/**
 * Una barra de progreso reescribe la línea con retorno de carro. Se conserva
 * sólo el último fragmento de cada línea, que es el estado final visible.
 */
function collapseCarriageReturns(raw: string): string {
  if (!raw.includes('\r')) return raw
  return raw
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i] !== '') return parts[i]
      return ''
    })
    .join('\n')
}

/** Convierte texto con escapes en tramos con estilo. */
export function parseAnsi(raw: string): AnsiSpan[] {
  const text = collapseCarriageReturns(raw)
  const spans: AnsiSpan[] = []
  let style: Style = {}
  let last = 0
  let m: RegExpExecArray | null

  ANSI_RX.lastIndex = 0
  while ((m = ANSI_RX.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), ...style })
    last = m.index + m[0].length
    // Sólo interesa la 'm', que es la de estilo. El resto se descarta.
    if (m[2] === 'm') style = applySgr(style, m[1] ?? '')
  }
  if (last < text.length) spans.push({ text: text.slice(last), ...style })

  return spans.filter((s) => s.text.length > 0)
}

/** Texto limpio, para copiar al portapapeles o para buscar. */
export function stripAnsi(raw: string): string {
  ANSI_RX.lastIndex = 0
  return collapseCarriageReturns(raw).replace(ANSI_RX, '')
}
