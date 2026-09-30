/**
 * Las instrucciones que un proyecto deja para los agentes: AGENTS.md (el
 * estándar que leen Codex, OpenCode y Copilot), CLAUDE.md (Claude Code) y
 * GEMINI.md (Gemini CLI).
 *
 * Aquí se leen y se escriben desde la app —con la opción de mantener dos
 * iguales— y se preparan para los agentes por API, que hasta ahora sólo veían
 * el README: trabajaban sin las reglas del proyecto que un agente de consola
 * sí respetaba.
 *
 * Escribir comprueba antes que nadie haya cambiado el fichero desde que se
 * abrió: un agente puede estar tocándolo a la vez, y pisar lo suyo sin avisar
 * es justo lo que no debe pasar con estos ficheros.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { guardPath } from './security'
import { writeFileAtomic } from './atomic'
import type { InstructionFile } from '@shared/types'

export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const

/** Lo que se lee de uno de estos ficheros: más no cabe en un prompt de sistema. */
const MAX_FILE = 200_000

function known(file: string): string {
  if (!(INSTRUCTION_FILES as readonly string[]).includes(file)) throw new Error(`${file} no es un fichero de instrucciones`)
  return file
}

function readOne(root: string, file: string): InstructionFile {
  const full = guardPath(root, known(file))
  if (!existsSync(full)) return { file, exists: false, content: '', mtimeMs: null, bytes: 0 }
  const st = statSync(full)
  if (!st.isFile()) throw new Error(`${file} no es un fichero`)
  if (st.size > MAX_FILE) throw new Error(`${file} ocupa ${Math.round(st.size / 1024)} KB: demasiado para editarlo aquí`)
  return { file, exists: true, content: readFileSync(full, 'utf8'), mtimeMs: st.mtimeMs, bytes: st.size }
}

export function readInstructionFiles(root: string): InstructionFile[] {
  return INSTRUCTION_FILES.map((f) => readOne(root, f))
}

/**
 * Escribe uno o varios (para mantenerlos iguales). Primero se comprueban
 * todos: si alguno cambió en disco desde que se leyó, no se escribe ninguno.
 */
export function writeInstructionFiles(
  root: string,
  writes: { file: string; content: string; expectedMtime: number | null }[]
): InstructionFile[] {
  if (!Array.isArray(writes) || !writes.length) throw new Error('Nada que guardar')
  for (const w of writes) {
    if (typeof w?.content !== 'string') throw new Error('Contenido no válido')
    const now = readOne(root, w.file)
    const moved = now.exists ? w.expectedMtime === null || Math.abs((now.mtimeMs ?? 0) - w.expectedMtime) > 1 : w.expectedMtime !== null
    if (moved) {
      throw new Error(`${w.file} ha cambiado en disco desde que lo abriste (quizá un agente). Vuelve a cargarlo antes de guardar.`)
    }
  }
  for (const w of writes) writeFileAtomic(guardPath(root, w.file), w.content)
  return readInstructionFiles(root)
}

/**
 * Sustituye las líneas que sólo son `@ruta` por el fichero que nombran, como
 * hace Claude Code. Es lo que permite un CLAUDE.md que se reduce a
 * `@AGENTS.md`: sin esto, el agente sólo vería la referencia.
 */
function expand(root: string, file: string, text: string, seen: Set<string>, depth: number): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const m = /^\s*@([^\s@][^\s]*)\s*$/.exec(line)
      if (!m || depth >= 3) return line
      let full: string
      try {
        full = guardPath(root, join(relative(root, dirname(guardPath(root, file))), m[1]))
      } catch {
        return line
      }
      const rel = relative(root, full).split(sep).join('/')
      if (seen.has(rel)) return ''
      if (!existsSync(full) || !statSync(full).isFile() || statSync(full).size > MAX_FILE) return line
      seen.add(rel)
      return expand(root, rel, readFileSync(full, 'utf8'), seen, depth + 1)
    })
    .join('\n')
}

/**
 * Las instrucciones del proyecto para el prompt de sistema de un agente por
 * API: AGENTS.md y CLAUDE.md, con sus `@imports` y sin repetir lo mismo dos
 * veces. Null si el proyecto no trae ninguna.
 */
export function projectInstructions(root: string, maxChars = 16_000): string | null {
  const seen = new Set<string>()
  const parts: string[] = []
  const bodies = new Set<string>()
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    let one: InstructionFile
    try {
      one = readOne(root, file)
    } catch {
      continue
    }
    if (!one.exists || seen.has(file)) continue
    seen.add(file)
    const body = expand(root, file, one.content, seen, 0).trim()
    if (!body || bodies.has(body)) continue
    bodies.add(body)
    parts.push(`### ${file}\n${body}`)
  }
  if (!parts.length) return null
  let out =
    '## Instrucciones del proyecto\n' +
    'El proyecto trae estas instrucciones para los agentes que trabajan en él. Síguelas mientras no contradigan lo que te pida el usuario.\n\n' +
    parts.join('\n\n')
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n… (instrucciones recortadas)'
  return out
}
