/**
 * Un parche unificado de git, leído por ficheros, bloques y líneas con su
 * número a cada lado. Lo usa la revisión de un turno para poder comentar una
 * línea concreta.
 */

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
  /** Número de línea antes del cambio (no en las añadidas). */
  oldNo?: number
  /** Número de línea después del cambio (no en las borradas). */
  newNo?: number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  /** Si se renombró, de dónde viene. */
  oldPath?: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  binary: boolean
  hunks: DiffHunk[]
  added: number
  removed: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

/** La ruta de una línea `--- a/x` o `+++ b/x`; null si es /dev/null. */
function sidePath(line: string): string | null {
  const raw = line.slice(4).replace(/\t$/, '')
  if (raw === '/dev/null') return null
  return raw.replace(/^[ab]\//, '')
}

/** La ruta de la cabecera `diff --git a/x b/x` cuando no hay líneas ---/+++ (binarios, sólo modo). */
function headerPath(line: string): string {
  const rest = line.slice('diff --git '.length)
  // Sin renombrar, las dos mitades son iguales: «a/x b/x».
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3)) return rest.slice(2, half)
  const at = rest.lastIndexOf(' b/')
  return at > 0 ? rest.slice(at + 3) : rest
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: headerPath(line), status: 'modified', binary: false, hunks: [], added: 0, removed: 0 }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue
    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed'
        file.oldPath = line.slice('rename from '.length)
      } else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length)
      else if (line.startsWith('Binary files ')) file.binary = true
      else if (line.startsWith('--- ')) {
        const p = sidePath(line)
        if (p && file.status !== 'renamed') file.path = p
      } else if (line.startsWith('+++ ')) {
        const p = sidePath(line)
        if (p) file.path = p
      }
    }
    const m = HUNK.exec(line)
    if (m) {
      oldNo = Number(m[1])
      newNo = Number(m[2])
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    const sign = line[0]
    if (sign === '+') {
      hunk.lines.push({ kind: 'add', text: line.slice(1), newNo: newNo++ })
      file.added++
    } else if (sign === '-') {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ })
      file.removed++
    } else if (sign === ' ') {
      hunk.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
    // «\ No newline at end of file» y la línea vacía final no cuentan.
  }
  return files
}

/** Un comentario sobre una línea del diff. */
export interface ReviewComment {
  id: string
  file: string
  line: DiffLine
  text: string
}

/**
 * El mensaje que recibe el agente: cada comentario con su fichero, su línea y
 * el código al que se refiere, para que no tenga que adivinar de qué hablas.
 */
export function composeReview(
  comments: ReviewComment[],
  general: string,
  labels: {
    intro: string
    line: (n: number) => string
    deleted: (n: number) => string
    general: string
  }
): string {
  const parts: string[] = [labels.intro]
  comments.forEach((c, i) => {
    const where =
      c.line.kind === 'del' ? labels.deleted(c.line.oldNo ?? 0) : labels.line(c.line.newNo ?? c.line.oldNo ?? 0)
    const sign = c.line.kind === 'add' ? '+' : c.line.kind === 'del' ? '-' : ' '
    parts.push(`${i + 1}. ${c.file}, ${where}:\n   \`${sign}${c.line.text.trim()}\`\n   ${c.text.trim().replace(/\n/g, '\n   ')}`)
  })
  if (general.trim()) parts.push(`${labels.general}\n${general.trim()}`)
  return parts.join('\n\n')
}
