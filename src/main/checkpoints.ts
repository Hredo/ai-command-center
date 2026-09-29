/**
 * Puntos de control por turno: una foto del árbol de trabajo antes de que un
 * agente toque nada, para poder deshacer ese turno entero.
 *
 * La foto es un commit suelto guardado en `refs/acc/checkpoints/<id>`: no
 * está en ninguna rama, no aparece en `git log` y no toca tu stash, tu índice
 * ni tus ficheros. Se hace con un índice temporal (copia del tuyo) al que se
 * añade todo lo que hay en disco —seguido o nuevo, lo ignorado no—, así que
 * incluye también lo que tenías sin confirmar.
 *
 * Deshacer sólo toca el árbol de trabajo: devuelve cada fichero a como
 * estaba y borra los que el turno creó. Antes guarda otra foto de cómo está
 * todo, así que el deshacer también se puede deshacer. Los commits que haya
 * hecho el agente no se tocan: se dice, y decides tú.
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'

const REF = 'refs/acc/checkpoints/'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'AI Command Center',
  GIT_AUTHOR_EMAIL: 'acc@localhost',
  GIT_COMMITTER_NAME: 'AI Command Center',
  GIT_COMMITTER_EMAIL: 'acc@localhost'
}

function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  timeout = 60_000
): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((done) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', ...env }
      },
      (err, stdout, stderr) => done({ ok: !err, out: String(stdout ?? ''), err: String(stderr ?? '').trim() })
    )
  })
}

const safeId = (id: string): string => id.replace(/[^\w.-]/g, '_').slice(0, 120)

async function repoRoot(cwd: string): Promise<string | null> {
  if (!cwd || !existsSync(cwd)) return null
  const r = await run(cwd, ['rev-parse', '--show-toplevel'], {}, 8000)
  return r.ok ? r.out.trim() : null
}

/** El árbol de lo que hay ahora en disco, sin tocar tu índice. */
async function worktreeTree(root: string): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'acc-ckpt-'))
  const index = join(dir, 'index')
  try {
    const gd = await run(root, ['rev-parse', '--absolute-git-dir'], {}, 8000)
    const real = gd.ok ? join(gd.out.trim(), 'index') : ''
    // Partir de tu índice ahorra volver a leer los ficheros que no han cambiado.
    if (real && existsSync(real)) copyFileSync(real, index)
    const env = { GIT_INDEX_FILE: index }
    const add = await run(root, ['add', '-A', '--', '.'], env, 120_000)
    if (!add.ok) return null
    const tree = await run(root, ['write-tree'], env)
    return tree.ok ? tree.out.trim() : null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface Checkpoint {
  commit: string
  root: string
}

/** Guarda la foto de ahora con el nombre del turno. Si no es un repositorio, null. */
export async function createCheckpoint(cwd: string, id: string, note = 'antes del turno'): Promise<Checkpoint | null> {
  const root = await repoRoot(cwd)
  if (!root) return null
  const tree = await worktreeTree(root)
  if (!tree) return null
  const head = await run(root, ['rev-parse', '--verify', '-q', 'HEAD'], {}, 8000)
  const args = ['commit-tree']
  if (head.ok && head.out.trim()) args.push('-p', head.out.trim())
  args.push('-m', `acc: ${note} ${id}`, tree)
  const c = await run(root, args, IDENTITY)
  if (!c.ok) return null
  const commit = c.out.trim()
  const u = await run(root, ['update-ref', REF + safeId(id), commit])
  return u.ok ? { commit, root } : null
}

export interface UndoPreview {
  /** Ficheros que vuelven a como estaban (cambiados o borrados en el turno). */
  restore: string[]
  /** Ficheros que el turno creó y se borran. */
  remove: string[]
  /** El agente hizo commits: esos se quedan. */
  headMoved: boolean
}

async function resolveCheckpoint(cwd: string, id: string): Promise<{ root: string; commit: string } | null> {
  const root = await repoRoot(cwd)
  if (!root) return null
  const r = await run(root, ['rev-parse', '--verify', '-q', REF + safeId(id)], {}, 8000)
  return r.ok && r.out.trim() ? { root, commit: r.out.trim() } : null
}

/** Qué pasaría al deshacer el turno, para enseñarlo antes. */
export async function previewUndo(cwd: string, id: string): Promise<UndoPreview | null> {
  const ck = await resolveCheckpoint(cwd, id)
  if (!ck) return null
  const now = await worktreeTree(ck.root)
  if (!now) return null
  const diff = await run(ck.root, ['diff-tree', '-r', '--no-renames', '--name-status', '-z', `${ck.commit}^{tree}`, now])
  if (!diff.ok) throw new Error(diff.err || 'git diff-tree falló')
  const parts = diff.out.split('\0').filter(Boolean)
  const restore: string[] = []
  const remove: string[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]
    const path = parts[i + 1]
    if (status === 'A') remove.push(path)
    else restore.push(path)
  }
  const parent = await run(ck.root, ['rev-parse', '--verify', '-q', `${ck.commit}^`], {}, 8000)
  const head = await run(ck.root, ['rev-parse', '--verify', '-q', 'HEAD'], {}, 8000)
  const headMoved = (parent.ok ? parent.out.trim() : '') !== (head.ok ? head.out.trim() : '')
  return { restore, remove, headMoved }
}

function inside(root: string, rel: string): string | null {
  const abs = resolve(root, rel)
  const r = relative(root, abs)
  return r && !r.startsWith('..') && !isAbsolute(r) ? abs : null
}

/** Quita las carpetas que se hayan quedado vacías al borrar, sin salir del repositorio. */
function pruneEmptyDirs(root: string, file: string): void {
  let dir = dirname(file)
  while (dir.length > root.length && relative(root, dir) && !relative(root, dir).startsWith('..')) {
    try {
      if (readdirSync(dir).length) return
      rmdirSync(dir)
    } catch {
      return
    }
    dir = dirname(dir)
  }
}

export interface UndoResult extends UndoPreview {
  /** La foto de antes de deshacer, por si quieres volver. */
  safetyId?: string
}

/** Devuelve el árbol de trabajo a como estaba antes del turno. */
export async function undoCheckpoint(cwd: string, id: string): Promise<UndoResult> {
  const ck = await resolveCheckpoint(cwd, id)
  if (!ck) throw new Error('No hay punto de control de este turno (o el repositorio ya no está).')
  const preview = await previewUndo(cwd, id)
  if (!preview) throw new Error('No se pudo leer el estado del repositorio.')

  // Primero una foto de cómo está todo ahora: el deshacer también se deshace.
  const safetyId = `${safeId(id)}-antes-de-deshacer-${Date.now()}`
  const safety = await createCheckpoint(ck.root, safetyId, 'antes de deshacer')
  if (!safety) throw new Error('No se pudo guardar el estado actual antes de deshacer: no se ha tocado nada.')

  // `:(literal)` para que un nombre con asteriscos no se lea como patrón.
  for (let i = 0; i < preview.restore.length; i += 100) {
    const chunk = preview.restore.slice(i, i + 100).map((p) => `:(literal)${p}`)
    const r = await run(ck.root, ['restore', `--source=${ck.commit}`, '--worktree', '--', ...chunk], {}, 120_000)
    if (!r.ok) throw new Error(`No se pudieron restaurar los ficheros: ${r.err}. Lo de antes de deshacer está guardado en ${safetyId}.`)
  }
  for (const rel of preview.remove) {
    const abs = inside(ck.root, rel)
    if (!abs) continue
    try {
      unlinkSync(abs)
      pruneEmptyDirs(ck.root, abs)
    } catch {
      /* ya no estaba */
    }
  }
  return { ...preview, safetyId }
}

/**
 * Poda: se quedan los más recientes de cada repositorio y ninguno más viejo
 * que `maxAgeDays`. Los objetos sueltos los recoge el `gc` de git a su ritmo.
 */
export async function pruneCheckpoints(cwd: string, keep = 200, maxAgeDays = 30): Promise<number> {
  const root = await repoRoot(cwd)
  if (!root) return 0
  const list = await run(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname) %(creatordate:unix)', REF])
  if (!list.ok) return 0
  const cutoff = Date.now() / 1000 - maxAgeDays * 86400
  let removed = 0
  const lines = list.out.split('\n').filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const [ref, at] = lines[i].split(' ')
    if (i < keep && Number(at) >= cutoff) continue
    const d = await run(root, ['update-ref', '-d', ref])
    if (d.ok) removed++
  }
  return removed
}
