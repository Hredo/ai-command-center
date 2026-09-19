/**
 * Herramientas de un agente por API.
 *
 * Un modelo por API sólo sabe devolver texto. Para que trabaje sobre un
 * proyecto como lo hace Claude Code hay que darle manos —listar, buscar, leer,
 * escribir, editar y ejecutar— y ejecutar aquí, en el proceso principal, lo
 * que vaya pidiendo.
 *
 * Las rutas se resuelven contra la raíz del proyecto con `guardPath`: un
 * `..\..\` no saca al agente de su carpeta. Un comando, en cambio, puede hacer
 * lo que quiera, y por eso pide permiso según el modo elegido.
 */
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { guardPath } from '../security'
import { IS_WIN, killTree, osName } from '../platform'
import type { FileTouch } from '@shared/types'

export type ToolKind = 'read' | 'search' | 'edit' | 'write' | 'run'

/**
 * Con qué se ejecutan los comandos del agente. En Windows, PowerShell; en
 * macOS y Linux, bash, que está en los dos de fábrica y es lo que cualquier
 * modelo sabe escribir sin pensar.
 */
const BASH = ['/bin/bash', '/usr/bin/bash'].find((p) => existsSync(p))
export const COMMAND_SHELL = IS_WIN ? 'PowerShell' : BASH ? 'bash' : 'sh'

interface ParamSpec {
  type: 'string' | 'integer' | 'boolean'
  description: string
}

export interface AgentTool {
  name: string
  kind: ToolKind
  description: string
  parameters: { type: 'object'; properties: Record<string, ParamSpec>; required: string[] }
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'list_dir',
    kind: 'search',
    description: 'Lista el contenido de una carpeta del proyecto. Las carpetas terminan en "/".',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Carpeta relativa a la raíz del proyecto. Vacío o "." para la raíz.' }
      },
      required: []
    }
  },
  {
    name: 'find_files',
    kind: 'search',
    description:
      'Busca archivos por nombre con un patrón glob, por ejemplo "**/*.ts" o "src/**/Chat*". Ignora node_modules, .git y las carpetas de compilación.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'Patrón glob o parte del nombre del archivo.' } },
      required: ['pattern']
    }
  },
  {
    name: 'search_text',
    kind: 'search',
    description:
      'Busca un texto o una expresión regular dentro de los archivos del proyecto. Devuelve líneas "ruta:línea: contenido".',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Texto o expresión regular a buscar.' },
        path: { type: 'string', description: 'Carpeta donde buscar, relativa a la raíz. Por omisión, todo el proyecto.' },
        glob: { type: 'string', description: 'Filtra por nombre de archivo, por ejemplo "*.tsx".' },
        ignore_case: { type: 'boolean', description: 'true para no distinguir mayúsculas.' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'read_file',
    kind: 'read',
    description:
      'Lee un archivo de texto y devuelve sus líneas numeradas. Para archivos largos usa offset y limit. Los números de línea no forman parte del archivo.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del archivo relativa a la raíz del proyecto.' },
        offset: { type: 'integer', description: 'Primera línea que leer, empezando en 1.' },
        limit: { type: 'integer', description: 'Cuántas líneas leer como máximo. Por omisión 400.' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    kind: 'write',
    description:
      'Crea un archivo o lo reemplaza entero con el contenido indicado. Para cambiar una parte de un archivo que ya existe usa edit_file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del archivo relativa a la raíz del proyecto.' },
        content: { type: 'string', description: 'Contenido completo del archivo.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    kind: 'edit',
    description:
      'Sustituye un fragmento exacto de un archivo por otro. old_string tiene que aparecer tal cual en el archivo actual, con sus espacios y su sangría, y ser único salvo que pidas replace_all. Lee el archivo antes de editarlo.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del archivo relativa a la raíz del proyecto.' },
        old_string: { type: 'string', description: 'Fragmento exacto que hay ahora en el archivo.' },
        new_string: { type: 'string', description: 'Texto que lo sustituye.' },
        replace_all: {
          type: 'boolean',
          description: 'true sólo si hay que cambiar todas las apariciones. Para cambiar una, amplía old_string hasta que sea único.'
        }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'run_command',
    kind: 'run',
    description:
      `Ejecuta un comando de ${COMMAND_SHELL} en la raíz del proyecto (${osName()}) y devuelve su salida y su código de salida. Sirve para compilar, pasar pruebas o consultar git. No lances programas interactivos ni servidores que no terminan.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: `Comando de ${COMMAND_SHELL}.` },
        timeout_seconds: { type: 'integer', description: 'Tiempo máximo en segundos. Por omisión 120, máximo 600.' }
      },
      required: ['command']
    }
  }
]

/* ------------------------------------------------------------------ *
 * Permisos                                                           *
 * ------------------------------------------------------------------ */

/**
 * Qué herramientas se le ofrecen al modelo. En modo plan ni siquiera ve las
 * que modifican algo: es más fiable que dárselas y rechazarlas después.
 */
export function toolsFor(mode?: string): AgentTool[] {
  if (mode === 'plan') return AGENT_TOOLS.filter((t) => t.kind === 'read' || t.kind === 'search')
  return AGENT_TOOLS
}

/**
 * Si una herramienta tiene que esperar a que la apruebes. Leer y buscar nunca
 * lo necesitan; editar sólo en «Pregunta»; ejecutar siempre, salvo «Sin
 * límites».
 */
export function needsApproval(tool: AgentTool, mode?: string): boolean {
  if (tool.kind === 'read' || tool.kind === 'search') return false
  if (mode === 'bypassPermissions') return false
  if (mode === 'manual') return true
  return tool.kind === 'run'
}

/* ------------------------------------------------------------------ *
 * Utilidades                                                         *
 * ------------------------------------------------------------------ */

/** Carpetas que no se recorren al buscar: dependencias, compilados y git. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'out', 'release', '.turbo', '.cache',
  '__pycache__', '.venv', 'venv', 'target', '.gradle', '.idea', 'coverage', '.pnpm-store',
  '.svelte-kit', 'bin', 'obj', '.astro', 'vendor'
])

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.icns', '.pdf', '.zip', '.gz', '.7z',
  '.rar', '.tar', '.exe', '.dll', '.so', '.dylib', '.node', '.mp3', '.mp4', '.mov', '.avi', '.mkv',
  '.wav', '.ogg', '.flac', '.ttf', '.otf', '.woff', '.woff2', '.eot', '.class', '.jar', '.pyc',
  '.wasm', '.db', '.sqlite', '.sqlite3', '.psd', '.bin', '.pack', '.idx', '.asar'
])

/** Tope de archivos que se miran en una búsqueda: un repositorio enorme no cuelga al agente. */
const MAX_WALK = 25_000
const MAX_SEARCH_BYTES = 1_000_000

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

function toRel(root: string, full: string): string {
  return relative(resolve(root), full).split(sep).join('/') || '.'
}

function lineCount(text: string): number {
  if (!text) return 0
  const n = text.split('\n').length
  return text.endsWith('\n') ? n - 1 : n
}

/**
 * Líneas añadidas y quitadas entre dos textos, contando líneas como bolsas.
 * No es un diff de verdad, pero para reescribir un archivo entero da cifras
 * razonables en vez de «+300 -298» por cambiar una línea.
 */
function lineDelta(before: string, after: string): { added: number; removed: number } {
  const bag = new Map<string, number>()
  const split = (s: string): string[] => (s ? s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [])
  for (const l of split(before)) bag.set(l, (bag.get(l) ?? 0) + 1)
  let added = 0
  for (const l of split(after)) {
    const n = bag.get(l) ?? 0
    if (n > 0) bag.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of bag.values()) removed += n
  return { added, removed }
}

function isBinary(full: string, buf?: Buffer): boolean {
  if (BINARY_EXT.has(extname(full).toLowerCase())) return true
  if (!buf) return false
  return buf.subarray(0, 8000).includes(0)
}

/** Escritura a un temporal y renombrado: un fallo a medias no deja el archivo roto. */
function atomicWrite(full: string, text: string): void {
  const tmp = `${full}.acc-tmp-${process.pid}`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, full)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* si tampoco se puede borrar, no hay más que hacer */
    }
    throw err
  }
}

/** Recorre los archivos de una carpeta sin entrar en las que no interesan. */
function walkFiles(start: string): { files: string[]; truncated: boolean } {
  const files: string[] = []
  const stack = [start]
  while (stack.length) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      // Los enlaces no se siguen: una unión que apunte hacia arriba sería un
      // bucle infinito.
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) stack.push(full)
      } else if (e.isFile()) {
        files.push(full)
        if (files.length >= MAX_WALK) return { files, truncated: true }
      }
    }
  }
  return { files, truncated: false }
}

/** Convierte un glob sencillo (*, **, ?, {a,b}) en expresión regular. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  // Sin comodines se busca como parte del nombre: «Chat» encuentra Chat.tsx.
  if (!/[*?{]/.test(g)) g = `*${g}*`
  const anyDir = !g.includes('/')
  const esc = (s: string): string => s.replace(/[.+^$()|[\]\\]/g, '\\$&')
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      const end = g.indexOf('}', i)
      if (end > i) {
        re += '(?:' + g.slice(i + 1, end).split(',').map(esc).join('|') + ')'
        i = end
      } else {
        re += '\\{'
      }
    } else {
      re += esc(c)
    }
  }
  return new RegExp((anyDir ? '(?:^|/)' : '^') + re + '$', 'i')
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function int(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(str(v), 10)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1
}

/* ------------------------------------------------------------------ *
 * Las herramientas                                                   *
 * ------------------------------------------------------------------ */

export interface ToolResult {
  /** Lo que vuelve al modelo. */
  output: string
  isError: boolean
  /** Resumen de una línea para la línea de tiempo. */
  summary?: string
  added?: number
  removed?: number
  /** Archivo tocado y con qué intención, para el panel de archivos. */
  touched?: { path: string; kind: FileTouch['kind'] }
}

function listDirTool(root: string, args: any): ToolResult {
  const rel = str(args.path).trim() || '.'
  const full = guardPath(root, rel)
  if (!statSync(full).isDirectory()) return { output: `${rel} no es una carpeta`, isError: true }
  const entries = readdirSync(full, { withFileTypes: true })
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  const shown = entries.slice(0, 500).map((e) => {
    if (e.dir) return e.name + '/' + (SKIP_DIRS.has(e.name.toLowerCase()) ? '  (no se recorre al buscar)' : '')
    try {
      return `${e.name}  (${statSync(join(full, e.name)).size} bytes)`
    } catch {
      return e.name
    }
  })
  const more = entries.length > shown.length ? `\n… y ${entries.length - shown.length} más` : ''
  return {
    output: shown.length ? shown.join('\n') + more : '(carpeta vacía)',
    isError: false,
    summary: `${entries.length} entradas`,
    touched: { path: toRel(root, full), kind: 'search' }
  }
}

function findFilesTool(root: string, args: any): ToolResult {
  const pattern = str(args.pattern).trim()
  if (!pattern) return { output: 'falta pattern', isError: true }
  const rx = globToRegExp(pattern)
  const { files, truncated } = walkFiles(resolve(root))
  const hits = files.map((f) => toRel(root, f)).filter((r) => rx.test(r))
  const shown = hits.slice(0, 300)
  let output = shown.length ? shown.join('\n') : 'Ningún archivo coincide.'
  if (hits.length > shown.length) output += `\n… y ${hits.length - shown.length} más: afina el patrón`
  if (truncated) output += '\n(el proyecto es muy grande: sólo se han mirado los primeros archivos)'
  return { output, isError: false, summary: `${hits.length} archivo${hits.length === 1 ? '' : 's'}` }
}

function searchTextTool(root: string, args: any): ToolResult {
  const pattern = str(args.pattern)
  if (!pattern) return { output: 'falta pattern', isError: true }
  const flags = bool(args.ignore_case) ? 'i' : ''
  let rx: RegExp
  try {
    rx = new RegExp(pattern, flags)
  } catch {
    // Un patrón que no es una expresión válida se busca como texto literal.
    rx = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  }
  const start = guardPath(root, str(args.path).trim() || '.')
  const filter = str(args.glob).trim() ? globToRegExp(str(args.glob)) : null
  const walked = statSync(start).isDirectory() ? walkFiles(start) : { files: [start], truncated: false }

  const matches: string[] = []
  let total = 0
  const withHits = new Set<string>()
  for (const file of walked.files) {
    const rel = toRel(root, file)
    if (filter && !filter.test(rel)) continue
    if (isBinary(file)) continue
    let buf: Buffer
    try {
      if (statSync(file).size > MAX_SEARCH_BYTES) continue
      buf = readFileSync(file)
    } catch {
      continue
    }
    if (isBinary(file, buf)) continue
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue
      total++
      withHits.add(rel)
      if (matches.length < 200) {
        const text = lines[i].replace(/\r$/, '')
        matches.push(`${rel}:${i + 1}: ${text.length > 300 ? text.slice(0, 300) + '…' : text}`)
      }
    }
  }
  let output = matches.length ? matches.join('\n') : 'Sin coincidencias.'
  if (total > matches.length) output += `\n… ${total - matches.length} coincidencias más: afina la búsqueda`
  if (walked.truncated) output += '\n(el proyecto es muy grande: sólo se han mirado los primeros archivos)'
  return {
    output,
    isError: false,
    summary: `${total} coincidencia${total === 1 ? '' : 's'} en ${withHits.size} archivo${withHits.size === 1 ? '' : 's'}`
  }
}

function readFileTool(root: string, args: any): ToolResult {
  const rel = str(args.path).trim()
  if (!rel) return { output: 'falta path', isError: true }
  const full = guardPath(root, rel)
  if (!existsSync(full)) return { output: `No existe ${rel}. Búscalo con find_files.`, isError: true }
  const st = statSync(full)
  if (st.isDirectory()) return { output: `${rel} es una carpeta: usa list_dir`, isError: true }
  if (isBinary(full)) return { output: `${rel} es un archivo binario (${st.size} bytes)`, isError: true }
  const buf = readFileSync(full)
  if (isBinary(full, buf)) return { output: `${rel} es un archivo binario (${st.size} bytes)`, isError: true }

  const lines = buf.toString('utf8').replace(/\r\n/g, '\n').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const offset = Math.max(1, int(args.offset, 1))
  const limit = Math.min(2000, Math.max(1, int(args.limit, 400)))
  const slice = lines.slice(offset - 1, offset - 1 + limit)
  const width = String(offset + slice.length).length
  const body = slice
    .map((l, i) => `${String(offset + i).padStart(width)}\t${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`)
    .join('\n')
  const end = offset + slice.length - 1
  let footer = ''
  if (!lines.length) footer = '(archivo vacío)'
  else if (offset > lines.length) footer = `(el archivo sólo tiene ${lines.length} líneas)`
  else if (end < lines.length) footer = `\n(líneas ${offset}-${end} de ${lines.length}; pide offset=${end + 1} para seguir)`
  return {
    output: body + footer,
    isError: false,
    summary: `${lines.length} línea${lines.length === 1 ? '' : 's'}`,
    touched: { path: toRel(root, full), kind: 'read' }
  }
}

/** null si el texto es válido; si no, el error. Sin node en el PATH no se puede saber y cuenta como válido. */
function checkSyntax(ext: string, text: string): string | null {
  if (ext === '.json') {
    try {
      JSON.parse(text.replace(/^﻿/, ''))
      return null
    } catch (err) {
      return (err as Error).message
    }
  }
  // Se mira una copia fuera del proyecto: así antes y después se comprueban
  // igual, y no queda nada a medias si node tarda.
  const tmp = join(tmpdir(), `acc-check-${process.pid}-${Date.now()}${ext}`)
  try {
    writeFileSync(tmp, text, 'utf8')
    const r = spawnSync('node', ['--check', tmp], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    if (r.error || r.status !== 1) return null
    const lines = String(r.stderr ?? '').split(/\r?\n/)
    const line = lines[0]?.match(/:(\d+)\s*$/)?.[1]
    const message = lines.map((l) => l.trim()).find((l) => /^\w*Error\b/.test(l)) ?? 'error de sintaxis'
    return `${message}${line ? `, línea ${line}` : ''}`
  } catch {
    return null
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* ya no estaba */
    }
  }
}

/**
 * Si un .json o un .js estaba bien antes de tocarlo y ya no, se le dice al
 * modelo en qué línea. Uno pequeño puede comerse la cabecera de una función,
 * ver el fragmento y darlo por bueno; «error de sintaxis en la línea 6» no lo
 * pasa por alto. Lo que ya estaba roto —o no es JSON estricto, como un
 * tsconfig con comentarios— no da avisos.
 */
function syntaxWarning(full: string, before: string | null): string {
  const ext = extname(full).toLowerCase()
  if (!['.json', '.js', '.cjs', '.mjs'].includes(ext)) return ''
  const after = checkSyntax(ext, readFileSync(full, 'utf8'))
  if (!after) return ''
  if (before !== null && checkSyntax(ext, before)) return ''
  return `\n\nAtención: tras este cambio el archivo tiene un error de sintaxis (${after}) y antes no lo tenía. Léelo y corrígelo antes de seguir.`
}

function writeFileTool(root: string, args: any): ToolResult {
  const rel = str(args.path).trim()
  if (!rel) return { output: 'falta path', isError: true }
  if (typeof args.content !== 'string') return { output: 'falta content', isError: true }
  const full = guardPath(root, rel)
  if (existsSync(full) && statSync(full).isDirectory()) return { output: `${rel} es una carpeta`, isError: true }

  const existed = existsSync(full)
  const before = existed ? readFileSync(full, 'utf8') : ''
  let content: string = args.content
  // Se respetan los finales de línea que ya tenía: si no, git vería el
  // archivo entero cambiado por un salto de línea.
  if (existed && before.includes('\r\n') && !content.includes('\r\n')) content = content.replace(/\n/g, '\r\n')

  mkdirSync(dirname(full), { recursive: true })
  atomicWrite(full, content)
  const delta = existed ? lineDelta(before, content) : { added: lineCount(content), removed: 0 }
  const warning = syntaxWarning(full, existed ? before : null)
  return {
    output: `${existed ? 'Reemplazado' : 'Creado'} ${toRel(root, full)} (${lineCount(content)} líneas).${warning}`,
    isError: false,
    summary: warning ? 'queda con un error de sintaxis' : undefined,
    ...delta,
    touched: { path: toRel(root, full), kind: 'write' }
  }
}

/** Los modelos pequeños copian a veces los números de línea de read_file dentro del fragmento. */
function stripLineNumbers(s: string): string | null {
  const lines = s.split('\n')
  if (!lines.every((l) => /^\s*\d+\t/.test(l) || l === '')) return null
  return lines.map((l) => l.replace(/^\s*\d+\t/, '')).join('\n')
}

function countOf(haystack: string, needle: string): number {
  let n = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    n++
    at = haystack.indexOf(needle, at + needle.length)
  }
  return n
}

/**
 * Cómo ha quedado la zona editada, numerada como read_file. Sin esto el modelo
 * no ve lo que ha escrito: uno pequeño se comía la cabecera de la función, daba
 * el arreglo por bueno y el archivo quedaba roto.
 */
function editedRegion(text: string, at: number, inserted: string): string {
  const lines = text.split(/\r?\n/)
  const first = text.slice(0, at).split('\n').length
  const last = first + inserted.split('\n').length - 1
  const from = Math.max(1, first - 3)
  const to = Math.min(lines.length, last + 3, from + 60)
  const width = String(to).length
  const body: string[] = []
  for (let n = from; n <= to; n++) body.push(`${String(n).padStart(width)}\t${lines[n - 1]}`)
  return `Así ha quedado (líneas ${from}-${to}). Comprueba que está bien antes de seguir:\n${body.join('\n')}`
}

/** Dónde está cada aparición, con las líneas de encima, para poder elegir una. */
function ambiguousMatch(text: string, needle: string, found: number): string {
  const lines = text.split(/\r?\n/)
  const blocks: string[] = []
  const starts: number[] = []
  let at = text.indexOf(needle)
  while (at !== -1 && starts.length < 5) {
    const line = text.slice(0, at).split('\n').length
    starts.push(line)
    const from = Math.max(1, line - 2)
    const to = Math.min(lines.length, line + needle.split('\n').length - 1)
    const body: string[] = []
    for (let n = from; n <= to; n++) body.push(`${String(n).padStart(6)}\t${lines[n - 1]}`)
    blocks.push(body.join('\n'))
    at = text.indexOf(needle, at + needle.length)
  }
  const more = found > starts.length ? ` (se muestran ${starts.length})` : ''
  return [
    `old_string aparece ${found} veces${more}, en las líneas ${starts.join(', ')}, y no sé cuál quieres cambiar. No se ha tocado nada.`,
    'Repite edit_file con un old_string más largo que incluya líneas de alrededor que sólo estén junto a la aparición que quieres cambiar (por ejemplo la cabecera de la función). Usa replace_all sólo si de verdad hay que cambiarlas todas.',
    '',
    ...blocks.flatMap((b, i) => [`Aparición ${i + 1}:`, b, ''])
  ].join('\n').trimEnd()
}

function editFileTool(root: string, args: any): ToolResult {
  const rel = str(args.path).trim()
  if (!rel) return { output: 'falta path', isError: true }
  if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') {
    return { output: 'faltan old_string o new_string', isError: true }
  }
  const full = guardPath(root, rel)
  if (!existsSync(full)) return { output: `No existe ${rel}. Para crearlo usa write_file.`, isError: true }
  const text = readFileSync(full, 'utf8')
  const crlf = text.includes('\r\n')
  const norm = (s: string): string => (crlf ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n'))

  let oldS = norm(args.old_string)
  let newS = norm(args.new_string)
  if (!oldS) return { output: 'old_string está vacío: para crear un archivo usa write_file', isError: true }

  let found = countOf(text, oldS)
  if (found === 0) {
    const stripped = stripLineNumbers(args.old_string.replace(/\r\n/g, '\n'))
    if (stripped) {
      oldS = norm(stripped)
      newS = norm(stripLineNumbers(args.new_string.replace(/\r\n/g, '\n')) ?? args.new_string)
      found = countOf(text, oldS)
    }
  }
  if (found === 0) {
    return {
      output:
        'No encuentro old_string en el archivo. Vuelve a leerlo con read_file y copia el fragmento exacto, sin los números de línea.',
      isError: true
    }
  }
  if (found > 1 && !bool(args.replace_all)) {
    // Antes el aviso ofrecía replace_all como salida, y un modelo pequeño lo
    // tomaba aunque le hubieras pedido cambiar sólo una: arreglaba suma y de
    // paso rompía resta, que tenía el mismo cuerpo. Ahora se le enseña dónde
    // está cada una para que amplíe el fragmento.
    return { output: ambiguousMatch(text, oldS, found), isError: true }
  }

  const at = text.indexOf(oldS)
  const next = bool(args.replace_all) ? text.split(oldS).join(newS) : text.replace(oldS, () => newS)
  atomicWrite(full, next)
  const delta = lineDelta(oldS, newS)
  const warning = syntaxWarning(full, text)
  return {
    output:
      `Editado ${toRel(root, full)}${found > 1 ? ` (${found} apariciones)` : ''}.` +
      (found === 1 ? '\n\n' + editedRegion(next, at, newS) : '') +
      warning,
    isError: false,
    summary: warning ? 'queda con un error de sintaxis' : undefined,
    ...delta,
    touched: { path: toRel(root, full), kind: 'edit' }
  }
}

/** Salida de un comando recortada por el medio: lo último suele ser lo que importa. */
function clip(text: string, max = 30_000): string {
  if (text.length <= max) return text
  const head = text.slice(0, 8_000)
  const tail = text.slice(-(max - 8_000))
  return `${head}\n… (${text.length - max} caracteres omitidos) …\n${tail}`
}

/**
 * Cómo se lanza un comando del agente en este sistema.
 *
 * En Windows el comando viaja en base64 (UTF-16): sin comillas que escapar y
 * con los acentos intactos. La salida se pide en UTF-8 y el código de salida
 * del último programa se propaga, que PowerShell por sí solo no lo hace.
 *
 * En macOS y Linux va tal cual a `bash -c`: bash ya habla UTF-8 y devuelve el
 * código del último programa. No es una shell de inicio de sesión: el PATH ya
 * es el del usuario (ver shellEnv.ts) y así no se cargan sus alias ni su
 * prompt, que no pintan nada en un comando suelto.
 */
function commandLaunch(command: string): { file: string; args: string[] } {
  if (IS_WIN) {
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$OutputEncoding = [System.Text.Encoding]::UTF8',
      command,
      '$__accOk = $?',
      'if ($LASTEXITCODE) { exit $LASTEXITCODE }',
      'if (-not $__accOk) { exit 1 }'
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
    }
  }
  return { file: BASH ?? '/bin/sh', args: ['-c', command] }
}

function runCommandTool(root: string, args: any, signal: AbortSignal): Promise<ToolResult> {
  const command = str(args.command).trim()
  if (!command) return Promise.resolve({ output: 'falta command', isError: true })
  const seconds = Math.min(600, Math.max(1, int(args.timeout_seconds, 120)))

  const root_ = resolve(root)
  const launch = commandLaunch(command)

  return new Promise((done) => {
    const started = Date.now()
    let out = ''
    let finished = false
    const child = spawn(launch.file, launch.args, {
      cwd: root_,
      windowsHide: true,
      // Fuera de Windows, en su propio grupo de procesos: al cortar por
      // tiempo se mata el grupo entero y no sólo la shell.
      detached: !IS_WIN,
      // Sin entrada: un programa que pregunte recibe fin de fichero en vez de
      // quedarse esperando para siempre.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        TERM: 'dumb',
        CI: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        PAGER: 'cat'
      }
    })

    const kill = (): void => killTree(child, 'SIGKILL')
    const timer = setTimeout(() => {
      out += `\n[cortado: superó ${seconds} s]`
      kill()
    }, seconds * 1000)
    const onAbort = (): void => kill()
    signal.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')))

    const finish = (code: number | null, error?: string): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      const clean = clip(out.replace(ANSI, '').replace(/\r\n/g, '\n').trim())
      const exit = error ? `[no se pudo ejecutar: ${error}]` : `[código de salida: ${code ?? '?'}]`
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      done({
        output: (clean ? clean + '\n' : '') + exit,
        isError: Boolean(error) || code !== 0,
        summary: error
          ? error
          : `código ${code ?? '?'} en ${secs} s` + (clean ? ' · ' + clean.split('\n').pop()!.slice(0, 120) : ''),
        touched: { path: command.length > 80 ? command.slice(0, 79) + '…' : command, kind: 'run' }
      })
    }
    child.on('error', (err) => finish(null, err.message))
    child.on('close', (code) => finish(code))
  })
}

/** Ejecuta la herramienta pedida. Nunca lanza: un fallo vuelve al modelo como texto. */
export async function executeTool(name: string, args: any, root: string, signal: AbortSignal): Promise<ToolResult> {
  const input = args && typeof args === 'object' ? args : {}
  try {
    switch (name) {
      case 'list_dir':
        return listDirTool(root, input)
      case 'find_files':
        return findFilesTool(root, input)
      case 'search_text':
        return searchTextTool(root, input)
      case 'read_file':
        return readFileTool(root, input)
      case 'write_file':
        return writeFileTool(root, input)
      case 'edit_file':
        return editFileTool(root, input)
      case 'run_command':
        return await runCommandTool(root, input, signal)
      default:
        return {
          output: `No existe la herramienta «${name}». Las disponibles son: ${AGENT_TOOLS.map((t) => t.name).join(', ')}.`,
          isError: true
        }
    }
  } catch (err: any) {
    return { output: `Error: ${err?.message ?? String(err)}`, isError: true }
  }
}

/** Sobre qué actúa una llamada, en una línea: la ruta, el patrón o el comando. */
export function describeCall(name: string, args: any): string {
  const a = args && typeof args === 'object' ? args : {}
  const one = (s: string, max = 120): string => {
    const t = s.replace(/\s+/g, ' ').trim()
    return t.length > max ? t.slice(0, max - 1) + '…' : t
  }
  if (name === 'run_command') return one(str(a.command))
  if (name === 'find_files') return one(str(a.pattern))
  if (name === 'search_text') return one(str(a.pattern) + (a.path ? ' en ' + str(a.path) : '') + (a.glob ? ` (${str(a.glob)})` : ''))
  if (name === 'list_dir') return one(str(a.path) || '.')
  return one(str(a.path))
}
