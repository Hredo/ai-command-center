/**
 * Cómo encaja lo que escribes en la paleta de comandos con cada opción.
 *
 * Cada palabra tiene que aparecer en la opción, en cualquier orden y sin
 * distinguir mayúsculas ni tildes («proy fact» encuentra «Facturas › Proyecto»).
 * Pesa más al principio del texto o de una palabra que en medio, y si no está
 * seguida vale también con sus letras en orden sobre inicios de palabra
 * («cn» → «Conversación nueva»). Lo que no está en el nombre puede estar en las
 * palabras clave (la ruta de un proyecto, el modelo de un agente): cuenta,
 * pero menos, y no se marca.
 */

export interface PaletteMatch {
  score: number
  /** Trozos del nombre que encajan, para marcarlos: [inicio, fin). */
  ranges: [number, number][]
}

/** Minúsculas y sin tildes, con la misma longitud: los rangos valen para el original. */
export function fold(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const b = c.normalize('NFD')[0].toLowerCase()
    out += b.length === 1 ? b : c
  }
  return out
}

const isWordChar = (c: string | undefined): boolean => Boolean(c && /[\p{L}\p{N}]/u.test(c))
const atBoundary = (t: string, i: number): boolean => i === 0 || !isWordChar(t[i - 1])

/** Una palabra contra el nombre: seguida, o sus letras sobre inicios de palabra. */
function matchWord(w: string, t: string): PaletteMatch | null {
  let best: PaletteMatch | null = null
  for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
    const score = i === 0 ? 100 : atBoundary(t, i) ? 80 : 45
    if (!best || score > best.score) best = { score: score + w.length, ranges: [[i, i + w.length]] }
    if (score === 100) break
  }
  if (best) return best
  if (w.length < 2) return null
  // Iniciales: cada letra al principio de una palabra, en orden.
  const ranges: [number, number][] = []
  let from = 0
  for (const c of w) {
    let found = -1
    for (let i = from; i < t.length; i++) {
      if (t[i] === c && atBoundary(t, i)) {
        found = i
        break
      }
    }
    if (found < 0) return null
    ranges.push([found, found + 1])
    from = found + 1
  }
  return { score: 30 + w.length, ranges }
}

function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/**
 * Encaja la búsqueda con una opción o devuelve null. Una búsqueda vacía encaja
 * con todo, sin puntos.
 */
export function matchPalette(query: string, label: string, keywords = ''): PaletteMatch | null {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return { score: 0, ranges: [] }
  const t = fold(label)
  const k = fold(keywords)
  let score = 0
  const ranges: [number, number][] = []
  for (const w of words) {
    const m = matchWord(w, t)
    if (m) {
      score += m.score
      ranges.push(...m.ranges)
    } else if (k.includes(w)) {
      score += 20
    } else {
      return null
    }
  }
  // Lo escrito, entero y tal cual, al principio del nombre: es lo que buscabas.
  const whole = fold(query.trim())
  if (t.startsWith(whole)) score += 40
  else if (t.includes(whole)) score += 15
  return { score, ranges: merge(ranges) }
}
