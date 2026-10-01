/**
 * Ficheros de un proyecto: mirar, abrir y editar sin salir de la aplicación.
 *
 * Todo lo que entra por aquí lleva una ruta relativa y se resuelve contra la
 * raíz del proyecto. Si al resolverla se sale de esa raíz, se rechaza: un
 * `..\..\Windows` en la ruta no puede acabar leyendo o escribiendo fuera.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, resolve, sep, dirname, extname, relative } from 'node:path'
import { shell } from 'electron'
import { guardPath } from './security'
import type { DirEntry, FileContent } from '@shared/types'

/** Tope de lectura: por encima se envía recortado y se dice. */
const MAX_READ_BYTES = 1_500_000

/** Carpetas que no se listan al pedir el árbol completo. */
const HEAVY = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'out', 'release', '.turbo',
  '.cache', '__pycache__', '.venv', 'venv', 'target', '.gradle', '.idea', '.astro',
  'vendor', 'coverage', '.pnpm-store', '.svelte-kit', 'bin', 'obj'
])

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.icns', '.pdf', '.zip', '.gz',
  '.7z', '.rar', '.tar', '.exe', '.dll', '.so', '.dylib', '.node', '.mp3', '.mp4', '.mov',
  '.avi', '.mkv', '.wav', '.ogg', '.flac', '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.class', '.jar', '.pyc', '.pyo', '.wasm', '.db', '.sqlite', '.sqlite3', '.psd', '.ai',
  '.blend', '.fbx', '.glb', '.gltf', '.obj', '.stl', '.bin', '.pack', '.idx', '.lock'
])

/**
 * Resuelve una ruta relativa dentro de la raíz y se niega si se sale.
 *
 * La comprobación vive en `security.ts` porque además de comparar cadenas
 * resuelve la ruta real: en Windows, una unión de directorios dentro del
 * proyecto puede apuntar a `C:\Windows` y la comparación de texto no se entera.
 */
const guard = guardPath

function isBinaryPath(path: string): boolean {
  return BINARY_EXT.has(extname(path).toLowerCase())
}

function entryOf(root: string, full: string, name: string): DirEntry | null {
  try {
    const st = statSync(full)
    const rel = relative(resolve(root), full).split(sep).join('/')
    return {
      name,
      rel,
      dir: st.isDirectory(),
      bytes: st.isDirectory() ? undefined : st.size,
      modified: st.mtimeMs,
      heavy: st.isDirectory() && HEAVY.has(name.toLowerCase())
    }
  } catch {
    // Un enlace roto o un permiso denegado no debe tumbar el listado entero.
    return null
  }
}

/** Contenido de una carpeta: carpetas primero y por nombre. */
export function listDir(root: string, rel = ''): DirEntry[] {
  const full = guard(root, rel)
  const names = readdirSync(full)
  const out: DirEntry[] = []
  for (const name of names) {
    const e = entryOf(root, join(full, name), name)
    if (e) out.push(e)
  }
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

export function readProjectFile(root: string, rel: string): FileContent {
  const full = guard(root, rel)
  const st = statSync(full)
  if (st.isDirectory()) throw new Error('es una carpeta, no un fichero')

  const base: FileContent = {
    rel: rel.split(sep).join('/'),
    bytes: st.size,
    modified: st.mtimeMs,
    binary: false,
    truncated: false
  }

  if (isBinaryPath(full)) return { ...base, binary: true }

  const buf = readFileSync(full)
  if (buf.includes(0)) return { ...base, binary: true }

  const slice = buf.length > MAX_READ_BYTES ? buf.subarray(0, MAX_READ_BYTES) : buf
  const text = slice.toString('utf8')
  return {
    ...base,
    text,
    truncated: buf.length > MAX_READ_BYTES,
    lines: text.length ? text.split('\n').length : 0,
    eol: text.includes('\r\n') ? 'crlf' : 'lf'
  }
}

/**
 * Guarda un fichero. Se escribe a un temporal y se renombra: si algo falla a
 * mitad, el fichero de antes sigue entero.
 */
export function writeProjectFile(root: string, rel: string, text: string): FileContent {
  const full = guard(root, rel)
  const tmp = `${full}.acc-tmp-${process.pid}`
  try {
    writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, full)
  } catch (err) {
    // Si el renombrado falla —disco lleno, permisos, antivirus— el temporal se
    // queda por ahí y la próxima vez estorba. Se limpia y se cuenta lo que pasó.
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* si tampoco se puede borrar, poco más se puede hacer desde aquí */
    }
    throw err
  }
  return readProjectFile(root, rel)
}

export function createEntry(root: string, rel: string, dir: boolean): DirEntry | null {
  const full = guard(root, rel)
  if (existsSync(full)) throw new Error('ya existe')
  if (dir) {
    mkdirSync(full, { recursive: true })
  } else {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, '', 'utf8')
  }
  return entryOf(root, full, rel.split(/[\\/]/).pop() ?? rel)
}

/** Borrado con red: va a la papelera del sistema, no al vacío. */
export async function trashEntry(root: string, rel: string): Promise<boolean> {
  const full = guard(root, rel)
  try {
    await shell.trashItem(full)
    return true
  } catch {
    // Si el sistema no puede mandarlo a la papelera se avisa en vez de
    // borrarlo de forma definitiva por nuestra cuenta.
    throw new Error('no se pudo mandar a la papelera; bórralo desde el explorador')
  }
}

export function revealEntry(root: string, rel: string): void {
  shell.showItemInFolder(guard(root, rel))
}

/* ------------------------------------------------------------------ *
 * Buscar por nombre                                                  *
 * ------------------------------------------------------------------ */

/** Tope de entradas por recorrido: un proyecto enorme no bloquea la app. */
const MAX_WALK = 60_000
/** Lo recorrido se reutiliza mientras escribes; al rato se vuelve a mirar el disco. */
const WALK_TTL = 5_000

interface WalkEntry {
  rel: string
  name: string
  dir: boolean
}

const walks = new Map<string, { at: number; entries: WalkEntry[]; capped: boolean }>()

/** Olvida lo recorrido de un proyecto: al crear o borrar algo se nota ya. */
export function forgetWalk(root: string): void {
  walks.delete(resolve(root))
}

function walk(root: string): { entries: WalkEntry[]; capped: boolean } {
  const key = resolve(root)
  const hit = walks.get(key)
  if (hit && Date.now() - hit.at < WALK_TTL) return hit
  const entries: WalkEntry[] = []
  const queue: string[] = ['']
  let capped = false
  // Por niveles: lo de arriba sale antes, que es lo que más se busca.
  for (let q = 0; q < queue.length && !capped; q++) {
    const rel = queue[q]
    let items: import('node:fs').Dirent[]
    try {
      items = readdirSync(join(key, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const it of items) {
      const childRel = rel ? `${rel}/${it.name}` : it.name
      // Los enlaces no se siguen: pueden dar vueltas o salir del proyecto.
      if (it.isSymbolicLink()) continue
      const dir = it.isDirectory()
      entries.push({ rel: childRel, name: it.name, dir })
      if (dir && !HEAVY.has(it.name.toLowerCase())) queue.push(childRel)
      if (entries.length >= MAX_WALK) {
        capped = true
        break
      }
    }
  }
  const done = { at: Date.now(), entries, capped }
  walks.set(key, done)
  return done
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Si las letras de `q` aparecen en orden en `s` («fpan» en «FilesPanel»), dónde. */
function subsequence(s: string, q: string): number[] | null {
  const at: number[] = []
  let i = 0
  for (const ch of q) {
    i = s.indexOf(ch, i)
    if (i === -1) return null
    at.push(i++)
  }
  return at
}

export interface FileHit {
  rel: string
  name: string
  dir: boolean
  /** Letras del nombre que coinciden, para marcarlas. */
  marks: number[]
}

/**
 * Ficheros y carpetas del proyecto cuyo nombre o ruta encaja con lo escrito,
 * sin entrar en `node_modules`, `.git` ni las carpetas de compilación.
 *
 * Varias palabras tienen que estar todas en la ruta. Primero los que empiezan
 * así, luego los que lo contienen en el nombre, luego en la ruta y, al final,
 * los que tienen esas letras en orden («fpan» encuentra FilesPanel).
 */
export function searchFiles(root: string, query: string, limit = 200): { hits: FileHit[]; total: number; capped: boolean } {
  guard(root, '')
  const terms = fold(query.trim()).split(/[\s/\\]+/).filter(Boolean)
  if (!terms.length) return { hits: [], total: 0, capped: false }
  const { entries, capped } = walk(root)
  const last = terms[terms.length - 1]
  const scored: { hit: FileHit; score: number }[] = []
  for (const e of entries) {
    const name = fold(e.name)
    const path = fold(e.rel)
    let score = 0
    let marks: number[] = []
    if (terms.every((t) => path.includes(t))) {
      const i = name.indexOf(last)
      if (i === 0) score = 400
      else if (i > 0) score = 300
      else score = 150
      if (i >= 0) marks = Array.from({ length: last.length }, (_, k) => i + k)
    } else if (terms.length === 1) {
      const sub = subsequence(name, last)
      if (!sub) continue
      score = 60 - (sub[sub.length - 1] - sub[0])
      marks = sub
    } else continue
    // A igualdad, lo menos profundo y lo más corto.
    score -= e.rel.split('/').length * 2 + e.name.length / 20
    if (!e.dir) score += 1
    scored.push({ hit: { rel: e.rel, name: e.name, dir: e.dir, marks }, score })
  }
  scored.sort((a, b) => b.score - a.score || a.hit.rel.localeCompare(b.hit.rel))
  return { hits: scored.slice(0, limit).map((x) => x.hit), total: scored.length, capped }
}
