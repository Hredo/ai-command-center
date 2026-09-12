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
