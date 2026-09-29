/**
 * Un worktree por tarea: una copia de trabajo aparte del mismo repositorio,
 * en su propia rama, para que un agente trabaje sin pisar tu carpeta ni a
 * otro agente.
 *
 * Se crean al lado del repositorio (`<repo>.worktrees/<tarea>`) en una rama
 * `acc/<tarea>` que sale de la rama en la que estás. Cada proyecto puede
 * decir qué ficheros sin seguir copiar (el .env, que no está en git) y qué
 * ejecutar para dejarlo listo (`pnpm install`). Al acabar se fusiona la rama
 * en la tuya o se tira; quitar uno con cambios sin confirmar hay que pedirlo
 * expresamente.
 *
 * Lo que git no guarda (para qué se creó, de qué sesión es, cómo fue la
 * preparación) va en `worktrees.json`, en la carpeta de datos.
 */
import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { paths } from './paths'
import { writeFileAtomic } from './atomic'
import { getConfig } from './config'
import { killTree } from './platform'
import type { WorktreeInfo, WorktreeSetup } from '@shared/types'

function git(cwd: string, args: string[], timeout = 60_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((done) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' }
      },
      (err, stdout, stderr) => done({ ok: !err, out: String(stdout ?? ''), err: String(stderr ?? '').trim() })
    )
  })
}

/* ------------------------------------------------------------------ *
 * Lo que la app sabe de cada worktree                                 *
 * ------------------------------------------------------------------ */

interface Meta {
  repo: string
  projectId?: string
  label?: string
  branch?: string
  base?: string
  createdAt: number
  sessionId?: string
  setup?: WorktreeSetup
}

const metaFile = (): string => join(paths.dir, 'worktrees.json')
const norm = (p: string): string => resolve(p).replace(/[\\/]+$/, '')
const key = (p: string): string => (process.platform === 'win32' ? norm(p).toLowerCase() : norm(p))

function readMeta(): Record<string, Meta> {
  try {
    return JSON.parse(readFileSync(metaFile(), 'utf8'))
  } catch {
    return {}
  }
}

function writeMeta(all: Record<string, Meta>): void {
  writeFileAtomic(metaFile(), JSON.stringify(all, null, 2))
}

function patchMeta(path: string, patch: Partial<Meta> | null): void {
  const all = readMeta()
  if (patch === null) delete all[key(path)]
  else all[key(path)] = { ...(all[key(path)] ?? { repo: '', createdAt: Date.now() }), ...patch }
  writeMeta(all)
}

/* ------------------------------------------------------------------ *
 * Lectura                                                            *
 * ------------------------------------------------------------------ */

/** La carpeta principal del repositorio, se pregunte desde donde se pregunte. */
export async function mainRoot(cwd: string): Promise<string | null> {
  if (!cwd || !existsSync(cwd)) return null
  // El directorio común de git es el del repositorio principal, también
  // desde dentro de un worktree.
  let common = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 8000)
  // git anterior a la 2.31 no conoce --path-format: la ruta llega relativa.
  if (!common.ok) common = await git(cwd, ['rev-parse', '--git-common-dir'], 8000)
  if (!common.ok) return null
  const dir = resolve(cwd, common.out.trim())
  if (basename(dir) === '.git') return norm(dirname(dir))
  const top = await git(cwd, ['rev-parse', '--show-toplevel'], 8000)
  return top.ok ? norm(top.out.trim()) : null
}

function parsePorcelain(out: string): { path: string; head?: string; branch?: string; locked?: boolean; prunable?: boolean; bare?: boolean }[] {
  const list: { path: string; head?: string; branch?: string; locked?: boolean; prunable?: boolean; bare?: boolean }[] = []
  for (const block of out.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean)
    const w = lines.find((l) => l.startsWith('worktree '))
    if (!w) continue
    const item: (typeof list)[number] = { path: norm(w.slice(9)) }
    for (const l of lines) {
      if (l.startsWith('HEAD ')) item.head = l.slice(5)
      else if (l.startsWith('branch ')) item.branch = l.slice(7).replace(/^refs\/heads\//, '')
      else if (l.startsWith('locked')) item.locked = true
      else if (l.startsWith('prunable')) item.prunable = true
      else if (l === 'bare') item.bare = true
    }
    list.push(item)
  }
  return list
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const root = await mainRoot(cwd)
  if (!root) return []
  const r = await git(root, ['worktree', 'list', '--porcelain'], 15_000)
  if (!r.ok) return []
  const meta = readMeta()
  const items = parsePorcelain(r.out)
  const mainBranch = items[0]?.branch
  return Promise.all(
    items.map(async (w, i) => {
      const m = meta[key(w.path)]
      const info: WorktreeInfo = {
        path: w.path,
        branch: w.branch,
        head: w.head,
        main: i === 0,
        locked: w.locked,
        prunable: w.prunable,
        label: m?.label,
        projectId: m?.projectId,
        base: m?.base,
        createdAt: m?.createdAt,
        sessionId: m?.sessionId,
        setup: m?.setup
      }
      if (i > 0 && existsSync(w.path)) {
        const [status, ahead] = await Promise.all([
          git(w.path, ['status', '--porcelain'], 15_000),
          w.branch ? git(root, ['rev-list', '--count', `${m?.base ?? mainBranch ?? 'HEAD'}..${w.branch}`], 8000) : null
        ])
        info.dirty = status.ok ? status.out.split('\n').filter(Boolean).length : undefined
        info.ahead = ahead?.ok ? Number(ahead.out.trim()) || 0 : undefined
      }
      return info
    })
  )
}

/** El worktree tiene que ser uno de los de ese repositorio, y no el principal. */
async function ownWorktree(path: string): Promise<{ root: string; info: WorktreeInfo }> {
  const root = await mainRoot(path)
  if (!root) throw new Error('No es un repositorio git')
  const list = await listWorktrees(root)
  const info = list.find((w) => key(w.path) === key(path))
  if (!info) throw new Error('Esa carpeta no es un worktree de este repositorio')
  if (info.main) throw new Error('Es la carpeta principal del repositorio, no un worktree')
  return { root, info }
}

/* ------------------------------------------------------------------ *
 * Crear                                                              *
 * ------------------------------------------------------------------ */

function slugify(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'tarea'
}

/** Ejecuta la preparación del proyecto en el worktree nuevo, con su shell. */
function runSetup(cwd: string, command: string, timeoutMs = 15 * 60_000): Promise<WorktreeSetup> {
  return new Promise((done) => {
    const started = Date.now()
    let out = ''
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: process.env })
    const keep = (b: Buffer): void => {
      out += b.toString('utf8')
      if (out.length > 20_000) out = out.slice(-12_000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    const timer = setTimeout(() => {
      out += `\n[se paró: más de ${Math.round(timeoutMs / 60_000)} min]`
      killTree(child)
    }, timeoutMs)
    const finish = (code: number | null, extra = ''): void => {
      clearTimeout(timer)
      done({ command, ok: code === 0, at: Date.now(), ms: Date.now() - started, output: (out + extra).slice(-4000) })
    }
    child.on('error', (e) => finish(1, `\n${e.message}`))
    child.on('close', (code) => finish(code))
  })
}

export interface CreateWorktreeOptions {
  /** Para qué es: da nombre a la carpeta y a la rama. */
  label: string
  projectId?: string
  /** Rama o commit del que sale. Por omisión, la rama actual. */
  base?: string
  sessionId?: string
}

export async function createWorktree(cwd: string, opts: CreateWorktreeOptions): Promise<WorktreeInfo> {
  const root = await mainRoot(cwd)
  if (!root) throw new Error('Esa carpeta no es un repositorio git: los worktrees sólo existen en git.')
  const current = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 8000)
  const base = opts.base?.trim() || (current.ok && current.out.trim() !== 'HEAD' ? current.out.trim() : 'HEAD')
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], 8000)
  if (!hasHead.ok) throw new Error('El repositorio no tiene ningún commit todavía: haz el primero antes de crear worktrees.')

  const parent = join(dirname(root), `${basename(root)}.worktrees`)
  mkdirSync(parent, { recursive: true })
  let slug = slugify(opts.label)
  for (let i = 2; existsSync(join(parent, slug)) || (await git(root, ['rev-parse', '--verify', '-q', `refs/heads/acc/${slug}`], 8000)).ok; i++) {
    slug = `${slugify(opts.label)}-${i}`
  }
  const dir = join(parent, slug)
  const branch = `acc/${slug}`
  const add = await git(root, ['worktree', 'add', '-b', branch, dir, base], 120_000)
  if (!add.ok) throw new Error(add.err || 'git worktree add falló')

  const project = getConfig().projects.find((p) => p.id === opts.projectId)
  // Lo que no está en git pero hace falta para arrancar (el .env).
  for (const rel of project?.worktreeCopy ?? []) {
    const clean = rel.trim()
    if (!clean) continue
    const from = resolve(root, clean)
    const to = resolve(dir, clean)
    const inRoot = relative(root, from)
    const inDir = relative(dir, to)
    if (!inRoot || inRoot.startsWith('..') || isAbsolute(inRoot) || inDir.startsWith('..')) continue
    try {
      if (existsSync(from) && statSync(from).isFile()) {
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(from, to)
      }
    } catch {
      /* uno que no se puede copiar no frena el resto */
    }
  }

  patchMeta(dir, { repo: root, projectId: opts.projectId, label: opts.label, branch, base, createdAt: Date.now(), sessionId: opts.sessionId })
  const command = project?.worktreeSetup?.trim()
  if (command) patchMeta(dir, { setup: await runSetup(dir, command) })

  const list = await listWorktrees(root)
  const info = list.find((w) => key(w.path) === key(dir))
  if (!info) throw new Error('El worktree se creó pero git no lo lista')
  return info
}

/* ------------------------------------------------------------------ *
 * Fusionar y quitar                                                  *
 * ------------------------------------------------------------------ */

export interface MergeResult {
  ok: boolean
  /** Se confirmó lo que había sin confirmar en el worktree antes de fusionar. */
  committed: boolean
  output: string
  conflicts?: string[]
}

/**
 * Lleva el trabajo del worktree a la rama en la que estás en el repositorio
 * principal: primero confirma lo que haya sin confirmar allí (con el mensaje
 * que digas) y luego `git merge --no-ff`. Si hay conflictos se para y se
 * dicen: se resuelven en la pestaña Git como cualquier otro merge.
 */
export async function mergeWorktree(path: string, opts: { message?: string } = {}): Promise<MergeResult> {
  const { root, info } = await ownWorktree(path)
  if (!info.branch) throw new Error('El worktree no está en ninguna rama (HEAD suelto): no hay qué fusionar')
  let committed = false
  if (info.dirty) {
    const message = opts.message?.trim()
    if (!message) throw new Error('El worktree tiene cambios sin confirmar: di con qué mensaje confirmarlos antes de fusionar.')
    const add = await git(info.path, ['add', '-A'], 60_000)
    const c = add.ok ? await git(info.path, ['commit', '-m', message], 60_000) : add
    if (!c.ok) throw new Error(`No se pudieron confirmar los cambios del worktree: ${c.err}`)
    committed = true
  }
  const m = await git(root, ['merge', '--no-ff', '-m', `Fusiona ${info.branch}${info.label ? `: ${info.label}` : ''}`, info.branch], 120_000)
  if (m.ok) return { ok: true, committed, output: m.out.trim() }
  const unmerged = await git(root, ['diff', '--name-only', '--diff-filter=U'], 8000)
  const conflicts = unmerged.ok ? unmerged.out.split('\n').filter(Boolean) : []
  return { ok: false, committed, output: (m.err || m.out).trim(), conflicts: conflicts.length ? conflicts : undefined }
}

export async function removeWorktree(path: string, opts: { force?: boolean; deleteBranch?: boolean } = {}): Promise<void> {
  const { root, info } = await ownWorktree(path)
  if (info.dirty && !opts.force) {
    throw new Error(`Tiene ${info.dirty} ficheros sin confirmar. Fusiónalo o confirma antes, o quítalo a sabiendas.`)
  }
  const r = await git(root, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), info.path], 120_000)
  if (!r.ok) throw new Error(r.err || 'git worktree remove falló')
  if (opts.deleteBranch && info.branch?.startsWith('acc/')) {
    await git(root, ['branch', opts.force ? '-D' : '-d', info.branch], 8000)
  }
  patchMeta(info.path, null)
}

/** Relaciona un worktree con una conversación (o lo suelta). */
export function linkWorktree(path: string, sessionId?: string): void {
  if (!readMeta()[key(path)]) return
  patchMeta(path, { sessionId })
}
