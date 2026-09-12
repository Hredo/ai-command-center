/**
 * Git para la vista de proyecto y de sesión.
 *
 * Dos cosas: saber dónde estás (rama, adelanto, sucio) y saber qué ha tocado
 * un agente. Lo segundo se mide comparando el estado del repositorio antes y
 * después de la ejecución, no fiándose de lo que el agente diga: así funciona
 * igual con cualquier CLI, informe o no informe de sus herramientas.
 *
 * El commit de partida se guarda junto al estado, porque un agente puede
 * cometer a mitad de la tarea. Comparando contra ese commit el recuento sigue
 * saliendo bien aunque haya commits nuevos por medio.
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type {
  FileChange, GitGraph, GitInfo, GitOpName, GitOpParams, GitOpState, GraphCommit, GraphRef
} from '@shared/types'

/** Separador de campos del log: no aparece en asuntos ni en nombres. */
const UNIT_SEP = String.fromCharCode(0x1f)

/**
 * Entorno de todas las llamadas.
 *
 * Sin editor y sin preguntas: aquí no hay teclado. `GIT_EDITOR=true` hace que
 * un merge o un rebase que quisiera abrir el editor del mensaje siga adelante
 * con el que git propone, en vez de quedarse colgado para siempre; y
 * `GIT_TERMINAL_PROMPT=0` hace que un push sin credenciales falle rápido con
 * su motivo en vez de esperar a un usuario que nunca va a escribir.
 */
const GIT_ENV = {
  ...process.env,
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C'
}

/** Nada de shell: los nombres de rama y de archivo llegan tal cual. */
function git(cwd: string, args: string[], timeout = 8000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: GIT_ENV },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: (stdout ?? '').toString(), err: (stderr ?? '').toString().trim() })
      }
    )
  })
}

function isRepoPath(cwd: string): boolean {
  return Boolean(cwd) && existsSync(cwd)
}

export async function gitInfo(cwd: string): Promise<GitInfo> {
  const none: GitInfo = { repo: false, dirty: 0, staged: 0, untracked: 0, localBranches: [], remoteBranches: [] }
  if (!isRepoPath(cwd)) return none

  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out.trim() !== 'true') return none

  const [headRef, headHash, status, locals, remotes, upstream, log] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['rev-parse', '--short', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']),
    git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
    git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    git(cwd, ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%at'])
  ])

  const branch = headRef.ok ? headRef.out.trim() : undefined
  const detached = branch === 'HEAD'

  let dirty = 0
  let staged = 0
  let untracked = 0
  for (const line of status.out.split('\n')) {
    if (!line.trim()) continue
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') untracked++
    else {
      if (x !== ' ' && x !== '?') staged++
      if (y !== ' ' && y !== '?') dirty++
    }
  }

  let ahead: number | undefined
  let behind: number | undefined
  if (upstream.ok && upstream.out.trim()) {
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', `${upstream.out.trim()}...HEAD`])
    if (counts.ok) {
      const [b, a] = counts.out.trim().split(/\s+/).map((n) => Number(n) || 0)
      behind = b
      ahead = a
    }
  }

  let lastCommit: GitInfo['lastCommit']
  if (log.ok && log.out.trim()) {
    const [hash, subject, author, at] = log.out.trim().split(UNIT_SEP)
    lastCommit = { hash, subject, author, at: (Number(at) || 0) * 1000 }
  }

  return {
    repo: true,
    branch: detached ? undefined : branch,
    detached,
    head: headHash.ok ? headHash.out.trim() : undefined,
    ahead,
    behind,
    upstream: upstream.ok ? upstream.out.trim() || undefined : undefined,
    dirty,
    staged,
    untracked,
    localBranches: locals.out.split('\n').map((s) => s.trim()).filter(Boolean),
    remoteBranches: remotes.out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.endsWith('/HEAD')),
    lastCommit
  }
}

/**
 * Cambia de rama.
 *
 * Git ya se niega solo si se perderían cambios; ese mensaje se devuelve tal
 * cual en vez de traducirlo mal o forzar nada.
 */
export async function gitCheckout(
  cwd: string,
  branch: string,
  opts: { create?: boolean } = {}
): Promise<{ ok: boolean; detail: string; info?: GitInfo }> {
  if (!isRepoPath(cwd)) return { ok: false, detail: 'la carpeta del proyecto no existe' }
  const name = branch.trim()
  if (!name) return { ok: false, detail: 'falta el nombre de la rama' }

  const args = opts.create ? ['checkout', '-b', name] : ['checkout', name]
  const r = await git(cwd, args, 20000)
  if (!r.ok) return { ok: false, detail: r.err || 'git checkout falló' }
  return { ok: true, detail: r.err || `en ${name}`, info: await gitInfo(cwd) }
}

const MAX_UNTRACKED_LINES_BYTES = 2 * 1024 * 1024

function countLines(file: string): { lines: number; binary: boolean } {
  try {
    if (statSync(file).size > MAX_UNTRACKED_LINES_BYTES) return { lines: 0, binary: false }
    const buf = readFileSync(file)
    if (buf.includes(0)) return { lines: 0, binary: true }
    if (buf.length === 0) return { lines: 0, binary: false }
    // Se cuentan como git: un salto final cierra la última línea, no abre otra.
    let n = 0
    for (const b of buf) if (b === 0x0a) n++
    if (buf[buf.length - 1] !== 0x0a) n++
    return { lines: n, binary: false }
  } catch {
    return { lines: 0, binary: false }
  }
}

/**
 * Archivos que difieren de `since` (por defecto HEAD), con sus líneas.
 * Incluye los que aún no están en el índice, contando sus líneas a mano
 * porque para git no existen todavía.
 */
export async function changedFiles(cwd: string, since = 'HEAD'): Promise<FileChange[]> {
  if (!isRepoPath(cwd)) return []
  const out = new Map<string, FileChange>()

  const numstat = await git(cwd, ['diff', '--numstat', '--find-renames', since, '--'])
  for (const line of numstat.out.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [a, r] = parts
    const path = parts.slice(2).join('\t')
    const binary = a === '-' || r === '-'
    out.set(path, {
      path,
      added: binary ? 0 : Number(a) || 0,
      removed: binary ? 0 : Number(r) || 0,
      status: 'M',
      binary: binary || undefined
    })
  }

  // El estado da la letra correcta (añadido, borrado, renombrado) y los
  // archivos sin seguimiento, que el diff no ve.
  const status = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])
  for (const line of status.out.split('\n')) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3)
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    // "viejo -> nuevo" en los renombrados
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)

    if (code === '??') {
      const { lines, binary } = countLines(join(cwd, path))
      out.set(path, { path, added: lines, removed: 0, status: '?', binary: binary || undefined })
      continue
    }
    const prev = out.get(path)
    const letter: FileChange['status'] =
      code.includes('A') ? 'A' : code.includes('D') ? 'D' : code.includes('R') ? 'R' : 'M'
    if (prev) prev.status = letter
    else out.set(path, { path, added: 0, removed: 0, status: letter })
  }

  return [...out.values()].sort((a, b) => b.added + b.removed - (a.added + a.removed))
}

/** Foto del repositorio para comparar después. */
export interface GitSnapshot {
  cwd: string
  head?: string
  branch?: string
  files: Map<string, FileChange>
}

export async function snapshot(cwd: string): Promise<GitSnapshot | null> {
  if (!isRepoPath(cwd)) return null
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out.trim() !== 'true') return null
  const [head, branch, files] = await Promise.all([
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    changedFiles(cwd)
  ])
  const name = branch.ok ? branch.out.trim() : ''
  return {
    cwd,
    head: head.ok ? head.out.trim() : undefined,
    branch: name && name !== 'HEAD' ? name : undefined,
    files: new Map(files.map((f) => [f.path, f]))
  }
}

/**
 * Qué ha cambiado desde la foto. Se compara contra el commit de partida, así
 * que cuenta igual si el agente ha cometido por el camino, y se resta lo que
 * ya estaba modificado antes de empezar.
 */
export async function changesSince(snap: GitSnapshot | null): Promise<FileChange[]> {
  if (!snap) return []
  const now = await changedFiles(snap.cwd, snap.head ?? 'HEAD')
  const out: FileChange[] = []
  for (const f of now) {
    const before = snap.files.get(f.path)
    if (!before) {
      if (f.added || f.removed || f.status === 'D' || f.status === 'A' || f.status === '?') out.push(f)
      continue
    }
    const added = f.added - before.added
    const removed = f.removed - before.removed
    if (added === 0 && removed === 0 && f.status === before.status) continue
    out.push({ ...f, added: Math.max(0, added), removed: Math.max(0, removed) })
  }
  return out.sort((a, b) => b.added + b.removed - (a.added + a.removed))
}

/* ------------------------------------------------------------------ *
 * Operaciones                                                        *
 * ------------------------------------------------------------------ */

/**
 * Subcomandos permitidos desde la caja de comandos de la interfaz.
 *
 * No es una shell: los argumentos van tal cual a git, sin pasar por cmd ni
 * por PowerShell, así que no hay forma de encadenar otro programa. La lista
 * deja fuera lo que no tiene sentido en una ventana sin teclado interactivo
 * (`git rebase -i` abriría un editor y se quedaría colgado).
 */
const ALLOWED = new Set([
  'status', 'log', 'diff', 'show', 'add', 'restore', 'reset', 'commit', 'push', 'pull',
  'fetch', 'branch', 'checkout', 'switch', 'merge', 'stash', 'tag', 'remote', 'clone',
  'rev-parse', 'describe', 'blame', 'shortlog', 'cherry-pick', 'revert', 'clean',
  'config', 'ls-files', 'rm', 'mv', 'apply', 'bisect', 'reflog', 'worktree', 'submodule',
  'rebase'
])

/** Los que pueden tirar trabajo por la ventana: la interfaz los confirma. */
export const DESTRUCTIVE = [
  /^reset\s+.*--hard/,
  /^clean\s+.*-[a-z]*f/,
  /^push\s+.*--force(?!-with-lease)/,
  /^push\s+.*(^|\s)-f(\s|$)/,
  /^checkout\s+.*(^|\s)--(\s|$)/,
  /^branch\s+.*-D/,
  /^stash\s+drop/,
  /^stash\s+clear/
]

export function isDestructive(command: string): boolean {
  const c = command.trim().replace(/^git\s+/, '')
  return DESTRUCTIVE.some((re) => re.test(c))
}

/**
 * Parte una línea de comando en argumentos respetando las comillas. Hace
 * falta para los mensajes de commit escritos en la caja.
 */
function splitArgs(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

export interface GitRunResult {
  ok: boolean
  out: string
  err: string
  command: string
  refused?: string
}

/** Ejecuta un comando de git en el proyecto. Sin shell por medio. */
export async function gitRun(cwd: string, command: string, timeout = 120000): Promise<GitRunResult> {
  const line = command.trim().replace(/^git\s+/, '')
  const args = splitArgs(line)
  const sub = args[0] ?? ''
  const base = { command: 'git ' + line, out: '', err: '' }

  if (!isRepoPath(cwd)) return { ...base, ok: false, refused: 'la carpeta del proyecto no existe' }
  if (!sub) return { ...base, ok: false, refused: 'escribe un comando' }
  if (!ALLOWED.has(sub)) {
    return {
      ...base,
      ok: false,
      refused: `"${sub}" no está permitido desde aquí; en la terminal integrada tienes git completo`
    }
  }
  // El rebase normal sí se puede: se ejecuta sin editor. El interactivo no,
  // porque necesita que alguien edite la lista de commits.
  if (args.includes('-i') || args.includes('--interactive')) {
    return { ...base, ok: false, refused: 'los comandos interactivos abrirían un editor: úsalos en la terminal' }
  }

  const r = await git(cwd, args, timeout)
  return { ...base, ok: r.ok, out: r.out, err: r.err }
}

export interface GitCommit {
  hash: string
  short: string
  subject: string
  author: string
  at: number
  refs?: string
}

export async function gitLog(cwd: string, limit = 30): Promise<GitCommit[]> {
  if (!isRepoPath(cwd)) return []
  const fmt = ['%H', '%h', '%s', '%an', '%at', '%D'].join('%x1f')
  const r = await git(cwd, ['log', `-${Math.max(1, Math.min(200, limit))}`, `--format=${fmt}`])
  if (!r.ok) return []
  return r.out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [hash, short, subject, author, at, refs] = l.split(UNIT_SEP)
      return { hash, short, subject, author, at: (Number(at) || 0) * 1000, refs: refs || undefined }
    })
}

/** Parche de todo el árbol o de un solo fichero, con o sin índice. */
export async function gitDiff(
  cwd: string,
  opts: { file?: string; staged?: boolean } = {}
): Promise<string> {
  if (!isRepoPath(cwd)) return ''
  const args = ['diff', '--no-color']
  if (opts.staged) args.push('--cached')
  args.push('--')
  if (opts.file) args.push(opts.file)
  const r = await git(cwd, args, 20000)
  if (r.out.trim()) return r.out
  // Un fichero sin seguimiento no sale en el diff: se muestra entero.
  if (opts.file && !opts.staged) {
    const untracked = await git(cwd, ['status', '--porcelain=v1', '--', opts.file])
    if (untracked.out.startsWith('??')) {
      const show = await git(cwd, ['diff', '--no-color', '--no-index', '/dev/null', opts.file], 20000)
      return show.out || ''
    }
  }
  return r.out
}

export async function gitStage(cwd: string, files: string[], stage: boolean): Promise<GitRunResult> {
  const list = files.filter((f) => f && !f.startsWith('-'))
  if (!list.length) return { ok: false, out: '', err: '', command: 'git add', refused: 'no hay ficheros' }
  const args = stage ? ['add', '--', ...list] : ['restore', '--staged', '--', ...list]
  const r = await git(cwd, args, 60000)
  return { ok: r.ok, out: r.out, err: r.err, command: 'git ' + args.slice(0, 2).join(' ') }
}

export async function gitCommit(
  cwd: string,
  message: string,
  opts: { all?: boolean } = {}
): Promise<GitRunResult> {
  const msg = message.trim()
  if (!msg) return { ok: false, out: '', err: '', command: 'git commit', refused: 'falta el mensaje' }
  const args = ['commit', '-m', msg]
  if (opts.all) args.splice(1, 0, '-a')
  const r = await git(cwd, args, 60000)
  return { ok: r.ok, out: r.out, err: r.err, command: 'git commit' }
}

/* ------------------------------------------------------------------ *
 * Árbol de commits                                                   *
 * ------------------------------------------------------------------ */

/**
 * El log con sus padres, que es lo que hace falta para dibujar el árbol.
 *
 * Se pide en orden de fecha (`--date-order`) porque es el que se parece a lo
 * que uno espera ver: los commits bajan en el tiempo y las ramas se abren y
 * se cierran a los lados. Los carriles se calculan en la interfaz, que es
 * quien sabe cuánto sitio tiene.
 */
export async function gitGraph(cwd: string, opts: { limit?: number; all?: boolean } = {}): Promise<GitGraph> {
  const empty: GitGraph = { commits: [], truncated: false }
  if (!isRepoPath(cwd)) return empty

  const limit = Math.max(10, Math.min(500, opts.limit ?? 120))
  const fmt = ['%H', '%h', '%P', '%s', '%an', '%ae', '%at', '%D'].join('%x1f')
  const args = ['log', `-${limit + 1}`, '--date-order', `--format=${fmt}`]
  if (opts.all !== false) args.push('--branches', '--remotes', '--tags')
  args.push('HEAD')

  const [log, remotes, headRef, headHash] = await Promise.all([
    git(cwd, args, 20000),
    git(cwd, ['remote']),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['rev-parse', 'HEAD'])
  ])
  if (!log.ok) return empty

  const remoteNames = remotes.out.split('\n').map((s) => s.trim()).filter(Boolean)
  const rows = log.out.split('\n').filter((l) => l.trim())
  const truncated = rows.length > limit

  const commits: GraphCommit[] = rows.slice(0, limit).map((line) => {
    const [hash, short, parents, subject, author, email, at, refs] = line.split(UNIT_SEP)
    return {
      hash,
      short,
      parents: parents ? parents.trim().split(/\s+/).filter(Boolean) : [],
      subject,
      author,
      email: email || undefined,
      at: (Number(at) || 0) * 1000,
      refs: parseRefs(refs ?? '', remoteNames)
    }
  })

  const branch = headRef.ok ? headRef.out.trim() : ''
  return {
    commits,
    head: headHash.ok ? headHash.out.trim() : undefined,
    branch: branch && branch !== 'HEAD' ? branch : undefined,
    truncated
  }
}

/** "HEAD -> main, origin/main, tag: v1" en etiquetas con su tipo. */
function parseRefs(decoration: string, remoteNames: string[]): GraphRef[] {
  const out: GraphRef[] = []
  for (const raw of decoration.split(',')) {
    const name = raw.trim()
    if (!name) continue
    if (name.startsWith('HEAD ->')) out.push({ name: name.slice(7).trim(), kind: 'head' })
    else if (name === 'HEAD') out.push({ name: 'HEAD', kind: 'head' })
    else if (name.startsWith('tag:')) out.push({ name: name.slice(4).trim(), kind: 'tag' })
    else if (remoteNames.some((r) => name.startsWith(r + '/'))) out.push({ name, kind: 'remote' })
    else out.push({ name, kind: 'local' })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Operación a medias                                                 *
 * ------------------------------------------------------------------ */

/** .git suele ser carpeta; en un worktree o un submódulo es un fichero que apunta. */
function gitDirOf(cwd: string): string {
  const dot = join(cwd, '.git')
  try {
    if (statSync(dot).isDirectory()) return dot
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'))
    if (m) {
      const p = m[1].trim()
      return isAbsolute(p) ? p : join(cwd, p)
    }
  } catch {
    /* si no se puede leer, se devuelve la ruta de siempre */
  }
  return dot
}

function firstLine(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8').split('\n')[0].trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Si hay un merge, un rebase o un cherry-pick a medias, y qué ficheros están
 * en conflicto. Es lo que decide si la interfaz enseña «continuar» y
 * «abortar» en vez de los botones de siempre.
 */
export async function gitState(cwd: string): Promise<GitOpState> {
  const none: GitOpState = { operation: 'none', conflicts: [], stashes: 0 }
  if (!isRepoPath(cwd)) return none

  const dir = gitDirOf(cwd)
  const [conflicts, stash] = await Promise.all([
    git(cwd, ['diff', '--name-only', '--diff-filter=U']),
    git(cwd, ['stash', 'list'])
  ])

  const state: GitOpState = {
    operation: 'none',
    conflicts: conflicts.out.split('\n').map((s) => s.trim()).filter(Boolean),
    stashes: stash.out.split('\n').filter((l) => l.trim()).length
  }

  const rebaseDir = existsSync(join(dir, 'rebase-merge'))
    ? join(dir, 'rebase-merge')
    : existsSync(join(dir, 'rebase-apply'))
      ? join(dir, 'rebase-apply')
      : null

  if (rebaseDir) {
    state.operation = 'rebase'
    const head = firstLine(join(rebaseDir, 'head-name'))?.replace('refs/heads/', '')
    const onto = firstLine(join(rebaseDir, 'onto'))
    const step = Number(firstLine(join(rebaseDir, 'msgnum')) ?? '')
    const total = Number(firstLine(join(rebaseDir, 'end')) ?? '')
    if (Number.isFinite(step) && step > 0) state.step = step
    if (Number.isFinite(total) && total > 0) state.total = total
    state.detail = head ? `rebase de ${head}${onto ? ' sobre ' + onto.slice(0, 7) : ''}` : 'rebase en marcha'
  } else if (existsSync(join(dir, 'MERGE_HEAD'))) {
    state.operation = 'merge'
    state.detail = 'merge sin terminar'
  } else if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) {
    state.operation = 'cherry-pick'
    state.detail = 'cherry-pick sin terminar'
  } else if (existsSync(join(dir, 'REVERT_HEAD'))) {
    state.operation = 'revert'
    state.detail = 'revert sin terminar'
  }

  return state
}

/* ------------------------------------------------------------------ *
 * Operaciones del árbol                                              *
 * ------------------------------------------------------------------ */

/** Un nombre de rama, de etiqueta o un hash: nada que git pueda leer como opción. */
function safeRef(ref: string | undefined): string | null {
  const r = (ref ?? '').trim()
  if (!r || r.startsWith('-')) return null
  if (/[\s~^:?*[\]\\]/.test(r)) return null
  return r
}

const OP_LABEL: Record<GitOpName, string> = {
  merge: 'merge',
  rebase: 'rebase',
  continue: 'continuar',
  abort: 'abortar',
  skip: 'saltar el commit',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
  reset: 'reset',
  branch: 'crear la rama',
  'branch-delete': 'borrar la rama',
  tag: 'crear la etiqueta',
  'tag-delete': 'borrar la etiqueta',
  stash: 'guardar en stash',
  'stash-pop': 'recuperar del stash',
  checkout: 'ir a',
  fetch: 'fetch',
  pull: 'pull',
  push: 'push'
}

/**
 * Las operaciones del árbol, con los argumentos construidos aquí.
 *
 * No es la caja de comandos: aquí no llega texto libre. La interfaz dice qué
 * quiere hacer y sobre qué referencia, y esta función arma la llamada. Así no
 * hay forma de colar una opción de git por el nombre de una rama.
 */
export async function gitOp(cwd: string, op: GitOpName, params: GitOpParams = {}): Promise<GitRunResult> {
  const label = OP_LABEL[op] ?? op
  const base = { command: 'git ' + op, out: '', err: '' }
  if (!isRepoPath(cwd)) return { ...base, ok: false, refused: 'la carpeta del proyecto no existe' }

  const ref = safeRef(params.ref)
  const name = safeRef(params.name)
  const noRef: GitRunResult = {
    ...base,
    ok: false,
    refused: params.ref?.trim()
      ? `${label}: «${params.ref.trim()}» no vale como nombre; git no admite espacios ni ~ ^ : ? * [ ]`
      : `${label}: falta la rama o el commit sobre el que actuar`
  }
  const noName: GitRunResult = {
    ...base,
    ok: false,
    refused: params.name?.trim()
      ? `«${params.name.trim()}» no vale como nombre; git no admite espacios ni ~ ^ : ? * [ ]`
      : 'falta el nombre'
  }

  let args: string[]

  switch (op) {
    case 'merge': {
      if (!ref) return noRef
      args = ['merge']
      if (params.noFf) args.push('--no-ff')
      if (params.squash) args.push('--squash')
      args.push(ref)
      break
    }
    case 'rebase': {
      if (!ref) return noRef
      args = ['rebase']
      if (params.autostash) args.push('--autostash')
      args.push(ref)
      break
    }
    case 'continue':
    case 'abort':
    case 'skip': {
      const st = await gitState(cwd)
      if (st.operation === 'none') return { ...base, ok: false, refused: 'no hay ninguna operación a medias' }
      if (op === 'continue' && st.conflicts.length) {
        return {
          ...base,
          ok: false,
          refused: `siguen en conflicto ${st.conflicts.length} fichero(s): resuélvelos y prepáralos antes de continuar`
        }
      }
      args = [st.operation, `--${op}`]
      break
    }
    case 'cherry-pick':
    case 'revert': {
      if (!ref) return noRef
      args = [op, ref]
      if (op === 'revert') args.push('--no-edit')
      break
    }
    case 'reset': {
      if (!ref) return noRef
      const mode = params.mode === 'hard' ? '--hard' : params.mode === 'soft' ? '--soft' : '--mixed'
      args = ['reset', mode, ref]
      break
    }
    case 'branch': {
      if (!name) return noName
      args = params.checkout === false ? ['branch', name] : ['checkout', '-b', name]
      if (ref) args.push(ref)
      break
    }
    case 'branch-delete': {
      if (!name) return noName
      args = ['branch', params.force ? '-D' : '-d', name]
      break
    }
    case 'tag': {
      if (!name) return noName
      args = ['tag', name]
      if (ref) args.push(ref)
      break
    }
    case 'tag-delete': {
      if (!name) return noName
      args = ['tag', '-d', name]
      break
    }
    case 'stash': {
      args = ['stash', 'push', '--include-untracked']
      if (params.message?.trim()) args.push('-m', params.message.trim().slice(0, 200))
      break
    }
    case 'stash-pop':
      args = ['stash', 'pop']
      break
    case 'checkout': {
      if (!ref) return noRef
      args = ['checkout', ref]
      break
    }
    case 'fetch':
      args = ['fetch', '--all', '--prune']
      break
    case 'pull':
      args = ['pull', params.rebase ? '--rebase' : '--ff-only']
      break
    case 'push': {
      args = ['push']
      if (params.setUpstream) args.push('-u', 'origin', 'HEAD')
      if (params.force) args.push('--force-with-lease')
      break
    }
    default:
      return { ...base, ok: false, refused: `operación desconocida: ${String(op)}` }
  }

  const r = await git(cwd, args, 180000)
  return { ok: r.ok, out: r.out, err: r.err, command: 'git ' + args.join(' ') }
}

/** El parche de un commit, para verlo desde el árbol. */
export async function gitShow(cwd: string, hash: string): Promise<string> {
  if (!isRepoPath(cwd)) return ''
  const ref = safeRef(hash)
  if (!ref) return ''
  const r = await git(cwd, ['show', '--no-color', '--stat', '--patch', '--find-renames', ref], 20000)
  return r.out
}
