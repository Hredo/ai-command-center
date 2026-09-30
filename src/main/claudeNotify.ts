/**
 * «Necesita tu respuesta» para Claude Code en una terminal.
 *
 * Claude Code avisa con un hook `Notification` cuando espera algo de ti: que
 * le des permiso, que contestes una pregunta o que sigas tras un rato parado.
 * Si lo activas, la app añade a tu `~/.claude/settings.json` un hook suyo que
 * deja cada aviso en su carpeta de datos; aquí se recoge, sale como
 * notificación del sistema y como tarjeta en Tareas, y se retira solo en
 * cuanto Claude vuelve a escribir en esa sesión (le has contestado).
 *
 * Igual que el statusLine: opcional y apagado de fábrica, con copia de
 * seguridad antes de escribir. Tus hooks no se tocan: el de la app se añade al
 * lado y al quitarlo sólo se quita el suyo.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { paths } from './paths'
import { writeFileAtomic } from './atomic'
import type { NotifyHookInfo, TerminalAttention } from '@shared/types'

const MARK = 'acc-notify'
/** Los avisos que importan: permiso, pregunta, espera y un subagente que te necesita. */
const MATCHER = 'permission_prompt|idle_prompt|elicitation_dialog|agent_needs_input'
/** Un aviso sin respuesta se olvida pasado este rato. */
const MAX_AGE = 2 * 60 * 60_000

function claudeDir(): string {
  return process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')
}
function settingsPath(): string {
  return join(claudeDir(), 'settings.json')
}
function workDir(): string {
  const d = join(paths.dir, 'claude-notify')
  mkdirSync(d, { recursive: true })
  return d
}
function inbox(): string {
  const d = join(workDir(), 'inbox')
  mkdirSync(d, { recursive: true })
  return d
}

const fwd = (p: string): string => p.replace(/\\/g, '/')

function gitBash(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const candidates = [
    process.env['CLAUDE_CODE_GIT_BASH_PATH'],
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
  ]
  return candidates.find((c) => c && existsSync(c))
}

function shScript(): string {
  return `#!/bin/sh
# AI Command Center: Claude Code avisa de que espera tu respuesta; el aviso se
# deja en la carpeta de la app, que lo enseña. No cambia nada de lo que hace Claude.
dir="${fwd(inbox())}"
mkdir -p "$dir" 2>/dev/null
f="$dir/$(date +%s)-$$"
cat > "$f.tmp" 2>/dev/null && mv -f "$f.tmp" "$f.json" 2>/dev/null
exit 0
`
}

function psScript(): string {
  const dir = inbox().replace(/'/g, "''")
  return `# AI Command Center: Claude Code avisa de que espera tu respuesta; el aviso se
# deja en la carpeta de la app, que lo enseña. No cambia nada de lo que hace Claude.
$ErrorActionPreference = 'SilentlyContinue'
$dir = '${dir}'
$raw = [Console]::In.ReadToEnd()
$name = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() + '-' + $PID
$tmp = Join-Path $dir ($name + '.tmp')
[IO.File]::WriteAllText($tmp, $raw, (New-Object System.Text.UTF8Encoding($false)))
Move-Item -Force $tmp (Join-Path $dir ($name + '.json'))
exit 0
`
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

const ours = (h: any): boolean => typeof h?.command === 'string' && h.command.includes(MARK)

let lastAt: number | undefined

export function notifyHookInfo(): NotifyHookInfo {
  const settings = readJson(settingsPath()) ?? {}
  const groups = Array.isArray(settings?.hooks?.Notification) ? settings.hooks.Notification : []
  return {
    installed: groups.some((g: any) => Array.isArray(g?.hooks) && g.hooks.some(ours)),
    settingsPath: settingsPath(),
    shell: process.platform === 'win32' && !gitBash() ? 'powershell' : 'sh',
    lastAt
  }
}

export function installNotifyHook(): NotifyHookInfo {
  const file = settingsPath()
  mkdirSync(claudeDir(), { recursive: true })
  const exists = existsSync(file)
  const settings = exists ? readJson(file) : {}
  if (exists && (settings === undefined || typeof settings !== 'object' || Array.isArray(settings))) {
    throw new Error(`${file} no es un JSON válido: no se toca. Arréglalo y vuelve a intentarlo.`)
  }
  if (notifyHookInfo().installed) return notifyHookInfo()
  if (exists) copyFileSync(file, join(workDir(), `settings.backup-${Date.now()}.json`))

  const useSh = !(process.platform === 'win32' && !gitBash())
  const script = join(workDir(), useSh ? `${MARK}.sh` : `${MARK}.ps1`)
  writeFileAtomic(script, useSh ? shScript() : psScript(), { encoding: 'utf8', mode: 0o755 })
  const hook = useSh
    ? { type: 'command', command: `sh "${fwd(script)}"`, timeout: 10 }
    : { type: 'command', command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${fwd(script)}"`, shell: 'powershell', timeout: 10 }

  const hooks = settings.hooks && typeof settings.hooks === 'object' ? { ...settings.hooks } : {}
  const groups = Array.isArray(hooks.Notification) ? [...hooks.Notification] : []
  groups.push({ matcher: MATCHER, hooks: [hook] })
  hooks.Notification = groups
  writeFileAtomic(file, JSON.stringify({ ...settings, hooks }, null, 2) + '\n')
  return notifyHookInfo()
}

/** Quita sólo el hook de la app; los tuyos, en el mismo evento o en otros, se quedan. */
export function uninstallNotifyHook(): NotifyHookInfo {
  const file = settingsPath()
  const settings = readJson(file)
  if (!settings || !notifyHookInfo().installed) return notifyHookInfo()
  copyFileSync(file, join(workDir(), `settings.backup-${Date.now()}.json`))
  const hooks = { ...settings.hooks }
  const groups = (hooks.Notification as any[])
    .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h: any) => !ours(h)) } : g))
    .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length)
  if (groups.length) hooks.Notification = groups
  else delete hooks.Notification
  const next = { ...settings }
  if (Object.keys(hooks).length) next.hooks = hooks
  else delete next.hooks
  writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n')
  return notifyHookInfo()
}

/* ------------------------------------------------------------------ *
 * Los avisos                                                         *
 * ------------------------------------------------------------------ */

const pending = new Map<string, TerminalAttention>()
let onChange: (list: TerminalAttention[], added?: TerminalAttention) => void = () => undefined

export function attentionList(): TerminalAttention[] {
  return [...pending.values()].sort((a, b) => b.at - a.at)
}

export function dismissAttention(id: string): void {
  if (pending.delete(id)) onChange(attentionList())
}

function mtime(p?: string): number {
  try {
    return p ? statSync(p).mtimeMs : 0
  } catch {
    return 0
  }
}

/** Lee lo que dejó el hook y lo borra. Uno por sesión: el último manda. */
function drain(): void {
  let files: string[]
  try {
    files = readdirSync(inbox()).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return
  }
  for (const f of files) {
    const full = join(inbox(), f)
    const raw = readJson(full)
    try {
      unlinkSync(full)
    } catch {
      /* otra vez será */
    }
    if (!raw || raw.hook_event_name !== 'Notification') continue
    const at = Number(f.split('-')[0]) > 1e12 ? Number(f.split('-')[0]) : Number(f.split('-')[0]) * 1000 || Date.now()
    if (Date.now() - at > MAX_AGE) continue
    const sessionId = String(raw.session_id ?? '')
    const entry: TerminalAttention = {
      id: sessionId || f,
      sessionId: sessionId || undefined,
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      project: typeof raw.cwd === 'string' ? basename(raw.cwd) : undefined,
      message: String(raw.message ?? 'Claude Code espera tu respuesta').slice(0, 300),
      type: typeof raw.notification_type === 'string' ? raw.notification_type : undefined,
      transcriptPath: typeof raw.transcript_path === 'string' ? raw.transcript_path : undefined,
      at
    }
    // Lo que ya había escrito Claude antes del aviso no cuenta como respuesta.
    entry.seenMtime = mtime(entry.transcriptPath)
    pending.set(entry.id, entry)
    lastAt = Date.now()
    onChange(attentionList(), entry)
  }
}

/** Se retira el aviso cuando Claude sigue escribiendo en esa sesión, o por viejo. */
function sweep(): void {
  let changed = false
  for (const [id, e] of pending) {
    const m = mtime(e.transcriptPath)
    if (Date.now() - e.at > MAX_AGE || (e.transcriptPath && m > (e.seenMtime ?? 0) + 1000)) {
      pending.delete(id)
      changed = true
    }
  }
  if (changed) onChange(attentionList())
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

export function watchAttention(cb: (list: TerminalAttention[], added?: TerminalAttention) => void): void {
  onChange = cb
  if (watcher) return
  drain()
  try {
    watcher = watch(inbox(), (_e, name) => {
      if (name && String(name).endsWith('.json')) drain()
    })
  } catch {
    /* sin vigilancia: el repaso periódico también lee la carpeta */
  }
  timer = setInterval(() => {
    drain()
    sweep()
  }, 3000)
  timer.unref?.()
}

export function stopWatchingAttention(): void {
  watcher?.close()
  watcher = null
  if (timer) clearInterval(timer)
  timer = null
}
