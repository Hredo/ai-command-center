/**
 * El porcentaje de tu plan de Claude, leído de su propia barra de estado.
 *
 * Claude Code le pasa a su statusLine un JSON con `rate_limits.five_hour` y
 * `rate_limits.seven_day` (`used_percentage` y `resets_at`): el dato oficial de
 * cuánto llevas de cada ventana. No hay otra forma de leerlo desde fuera, así
 * que la app puede poner un statusLine suyo que guarda ese JSON en la carpeta
 * de datos y después ejecuta la barra que tuvieras, con la misma entrada: tu
 * barra se sigue viendo igual.
 *
 * Es opcional y viene apagado: toca `~/.claude/settings.json`, que es tuyo.
 * Al instalarlo se guarda una copia; al quitarlo se deja como estaba. Si has
 * cambiado el statusLine después, no se toca y se dice.
 *
 * Sólo se actualiza mientras hay una sesión interactiva de Claude Code
 * abierta: en modo `-p` Claude no pinta barra.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { paths } from '../paths'
import { writeFileAtomic } from '../atomic'

const MARK = 'acc-statusline'

function claudeDir(): string {
  return process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')
}
function settingsPath(): string {
  return join(claudeDir(), 'settings.json')
}
function workDir(): string {
  const d = join(paths.dir, 'statusline')
  mkdirSync(d, { recursive: true })
  return d
}
export function capturePath(): string {
  return join(paths.dir, 'claude-statusline.json')
}
const statePath = (): string => join(workDir(), 'state.json')
const prevPath = (): string => join(workDir(), 'prev-command.txt')

/** Las rutas van con barras normales: Git Bash se come las invertidas. */
const fwd = (p: string): string => p.replace(/\\/g, '/')

/** En Windows Claude Code usa Git Bash si está; si no, PowerShell. */
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
  const dir = fwd(paths.dir)
  return `#!/bin/sh
# AI Command Center: guarda lo que Claude Code manda a su barra de estado (el
# uso de tu plan) y ejecuta después la barra que tuvieras, con la misma entrada.
dir="${dir}"
input=$(cat)
printf '%s' "$input" > "$dir/claude-statusline.json.tmp" 2>/dev/null && mv -f "$dir/claude-statusline.json.tmp" "$dir/claude-statusline.json" 2>/dev/null
if [ -s "$dir/statusline/prev-command.txt" ]; then
  prev=$(cat "$dir/statusline/prev-command.txt")
  if command -v bash >/dev/null 2>&1; then printf '%s' "$input" | bash -c "$prev"; else printf '%s' "$input" | sh -c "$prev"; fi
fi
`
}

function psScript(): string {
  const dir = paths.dir.replace(/'/g, "''")
  return `# AI Command Center: guarda lo que Claude Code manda a su barra de estado (el
# uso de tu plan) y ejecuta después la barra que tuvieras, con la misma entrada.
$ErrorActionPreference = 'SilentlyContinue'
$dir = '${dir}'
$raw = [Console]::In.ReadToEnd()
$tmp = Join-Path $dir 'claude-statusline.json.tmp'
[IO.File]::WriteAllText($tmp, $raw, (New-Object System.Text.UTF8Encoding($false)))
Move-Item -Force $tmp (Join-Path $dir 'claude-statusline.json')
$prevFile = Join-Path $dir 'statusline\\prev-command.txt'
if ((Test-Path $prevFile) -and ((Get-Item $prevFile).Length -gt 0)) {
  $prev = Get-Content -Raw $prevFile
  $raw | powershell -NoProfile -Command $prev
}
`
}

interface State {
  installedAt: number
  command: string
  /** El statusLine que había antes, tal cual; null si no había. */
  previous: unknown
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export interface StatusLineInfo {
  /** El nuestro está puesto en settings.json. */
  installed: boolean
  /** Había otro antes, y se sigue ejecutando detrás. */
  chained: boolean
  /** settings.json tiene un statusLine que no es el nuestro. */
  foreign: boolean
  /** Cuándo llegó el último dato. */
  lastAt?: number
  shell: 'sh' | 'powershell'
  settingsPath: string
}

export function statusLineInfo(): StatusLineInfo {
  const settings = readJson(settingsPath()) ?? {}
  const cmd = String(settings?.statusLine?.command ?? '')
  const installed = cmd.includes(MARK)
  const lastAt = existsSync(capturePath()) ? statMtime(capturePath()) : undefined
  return {
    installed,
    chained: installed && existsSync(prevPath()) && readFileSync(prevPath(), 'utf8').trim().length > 0,
    foreign: Boolean(cmd) && !installed,
    lastAt,
    shell: process.platform === 'win32' && !gitBash() ? 'powershell' : 'sh',
    settingsPath: settingsPath()
  }
}

function statMtime(p: string): number | undefined {
  try {
    return statSync(p).mtimeMs
  } catch {
    return undefined
  }
}

/** Pone el statusLine de la app, encadenando el que hubiera. */
export function installStatusLine(): StatusLineInfo {
  const file = settingsPath()
  mkdirSync(claudeDir(), { recursive: true })
  const exists = existsSync(file)
  const settings = exists ? readJson(file) : {}
  if (exists && settings === undefined) {
    throw new Error(`${file} no es un JSON válido: no se toca. Arréglalo y vuelve a intentarlo.`)
  }
  const current = settings.statusLine
  if (String(current?.command ?? '').includes(MARK)) return statusLineInfo()

  // Copia de seguridad antes de escribir nada.
  if (exists) copyFileSync(file, join(workDir(), `settings.backup-${Date.now()}.json`))

  const useSh = !(process.platform === 'win32' && !gitBash())
  const script = join(workDir(), useSh ? `${MARK}.sh` : `${MARK}.ps1`)
  writeFileAtomic(script, useSh ? shScript() : psScript(), { encoding: 'utf8', mode: 0o755 })
  const command = useSh ? `sh "${fwd(script)}"` : `powershell -NoProfile -ExecutionPolicy Bypass -File "${fwd(script)}"`

  const prevCmd = typeof current?.command === 'string' ? current.command : ''
  writeFileAtomic(prevPath(), prevCmd)
  const state: State = { installedAt: Date.now(), command, previous: current ?? null }
  writeFileAtomic(statePath(), JSON.stringify(state, null, 2))

  const next = { ...settings, statusLine: { ...(current ?? {}), type: 'command', command } }
  writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n')
  return statusLineInfo()
}

/** Quita el statusLine de la app y deja el que había. Si ya no es el nuestro, no toca nada. */
export function uninstallStatusLine(): StatusLineInfo & { untouched?: string } {
  const file = settingsPath()
  const settings = readJson(file)
  if (!settings) return statusLineInfo()
  const cmd = String(settings?.statusLine?.command ?? '')
  if (!cmd.includes(MARK)) {
    return {
      ...statusLineInfo(),
      untouched: cmd ? 'El statusLine de settings.json ya no es el de la app: no se ha tocado.' : undefined
    }
  }
  const state = readJson(statePath()) as State | undefined
  copyFileSync(file, join(workDir(), `settings.backup-${Date.now()}.json`))
  const next = { ...settings }
  if (state?.previous) next.statusLine = state.previous
  else delete next.statusLine
  writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n')
  writeFileAtomic(prevPath(), '')
  return statusLineInfo()
}

/* ------------------------------------------------------------------ *
 * Lectura del dato                                                   *
 * ------------------------------------------------------------------ */

export interface ClaudePlanWindow {
  usedPct: number
  resetsAt?: number
}

export interface ClaudePlanSnapshot {
  at: number
  fiveHour?: ClaudePlanWindow
  sevenDay?: ClaudePlanWindow
  /** Tope de gasto de la organización, si va detrás de una pasarela. */
  spend?: ClaudePlanWindow
  model?: string
}

function win(w: any): ClaudePlanWindow | undefined {
  if (!w || typeof w.used_percentage !== 'number') return undefined
  const r = typeof w.resets_at === 'number' ? (w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000) : undefined
  return { usedPct: w.used_percentage, resetsAt: r }
}

export function readClaudePlan(): ClaudePlanSnapshot | null {
  const raw = readJson(capturePath())
  if (!raw?.rate_limits) return null
  return {
    at: statMtime(capturePath()) ?? Date.now(),
    fiveHour: win(raw.rate_limits.five_hour),
    sevenDay: win(raw.rate_limits.seven_day),
    spend: win(raw.rate_limits.spend_limit),
    model: raw.model?.display_name ?? raw.model?.id
  }
}

let watcher: FSWatcher | null = null

/** Avisa cuando Claude Code escribe un dato nuevo. */
export function watchClaudePlan(cb: () => void): void {
  if (watcher) return
  try {
    watcher = watch(paths.dir, (_e, name) => {
      if (name && String(name).startsWith('claude-statusline.json') && !String(name).endsWith('.tmp')) cb()
    })
  } catch {
    /* sin vigilancia: queda el repaso periódico de los cupos */
  }
}

export function stopWatchingClaudePlan(): void {
  watcher?.close()
  watcher = null
}
