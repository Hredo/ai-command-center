/**
 * Las sesiones de Codex, OpenCode y Gemini CLI que no lanzaste desde aquí.
 *
 * Igual que las de Claude Code (claudeSessions.ts): entran al histórico con su
 * gasto, cuentan en su proyecto y en los cupos de su plan, y se pueden relevar
 * a otro agente. Se vigilan sus carpetas con `fs.watch` y un repaso corto por
 * lo que se escape, para que el gasto de otra terminal se vea mientras ocurre.
 */
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { paths } from '../paths'
import { writeFileAtomic } from '../atomic'
import { allRuns, upsertRuns } from '../runs'
import { toRun, TOOL_NAMES, type ExternalSession, type ExternalTool } from './common'
import { codexRoot, codexSessions, codexTranscript, scanCodex, exportCodexState, importCodexState } from './codex'
import { opencodeDbPath, opencodeSessions, opencodeTranscript, scanOpencode } from './opencode'
import { geminiRoot, geminiSessions, geminiTranscript, scanGemini } from './gemini'
import type { AgentTodo } from '@shared/types'

const STATE = () => join(paths.dir, 'external-index.json')
/** Repaso de respaldo: lo que fs.watch no cuente (redes, WSL, discos lentos). */
const POLL_MS = 5000
/** Juntar los avisos de una ráfaga de escrituras. */
const SETTLE_MS = 400

const watched = new Map<string, FSWatcher>()
let poll: NodeJS.Timeout | null = null
let pending: NodeJS.Timeout | null = null
let busy = false
let onUpdate: (p: { imported: number }) => void = () => {}

function loadState(): void {
  try {
    if (existsSync(STATE())) importCodexState(JSON.parse(readFileSync(STATE(), 'utf8'))?.codex)
  } catch {
    /* se reconstruye leyendo */
  }
}

function saveState(): void {
  try {
    writeFileAtomic(STATE(), JSON.stringify({ version: 1, codex: exportCodexState() }))
  } catch (err) {
    console.error('[externas] no se pudo guardar el índice:', err)
  }
}

/** Todas las sesiones de fuera que se conocen ahora mismo. */
export function externalSessions(): ExternalSession[] {
  return [...codexSessions(), ...opencodeSessions(), ...geminiSessions()]
}

/**
 * Las que se lanzaron desde la app ya están en el histórico con su ejecución
 * de verdad (llevan el mismo id de sesión): ésas no se importan otra vez.
 */
function importAll(): number {
  const fromApp = new Set(
    allRuns()
      .filter((r) => r.cliSessionId && r.source !== 'terminal')
      .map((r) => r.cliSessionId as string)
  )
  const rows = externalSessions()
    .filter((s) => !fromApp.has(s.id))
    .map(toRun)
  return upsertRuns(rows)
}

/** Un repaso: lee lo nuevo de las tres y lo vuelca al histórico. */
export async function refreshExternal(force = false): Promise<{ imported: number }> {
  if (busy) return { imported: 0 }
  busy = true
  try {
    const codex = await scanCodex()
    const oc = scanOpencode()
    const gem = scanGemini()
    if (codex) saveState()
    // Forzado (a mano, o al cambiar los proyectos) se vuelve a volcar todo:
    // así una sesión ya importada pasa a contar en un proyecto dado de alta después.
    const imported = force || codex || oc || gem ? importAll() : 0
    if (codex || oc || gem) onUpdate({ imported })
    return { imported }
  } catch (err) {
    console.error('[externas] repaso fallido:', err)
    return { imported: 0 }
  } finally {
    busy = false
  }
}

function soon(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    void refreshExternal()
  }, SETTLE_MS)
}

function tryWatch(dir: string, recursive: boolean): void {
  if (watched.has(dir) || !existsSync(dir)) return
  try {
    const w = watch(dir, { recursive }, () => soon())
    w.on('error', () => {
      w.close()
      watched.delete(dir)
    })
    watched.set(dir, w)
  } catch {
    // Sin vigilancia recursiva en este sistema: queda el repaso periódico.
  }
}

/** Una herramienta instalada con la app ya abierta: su carpeta aparece después. */
function watchAll(): void {
  tryWatch(codexRoot(), true)
  tryWatch(geminiRoot(), true)
  // OpenCode escribe en su base de datos y en el diario (-wal) de al lado.
  tryWatch(dirname(opencodeDbPath()), false)
}

export function watchExternal(cb: (p: { imported: number }) => void): void {
  onUpdate = cb
  loadState()
  void refreshExternal()
  watchAll()
  poll = setInterval(() => {
    watchAll()
    void refreshExternal()
  }, POLL_MS)
}

export function stopWatchingExternal(): void {
  for (const w of watched.values()) w.close()
  watched.clear()
  if (poll) clearInterval(poll)
  if (pending) clearTimeout(pending)
  poll = pending = null
}

/** Lo que el relevo necesita de una sesión de fuera. */
export async function externalTranscript(
  tool: ExternalTool,
  id: string
): Promise<{
  label: string
  agent?: string
  cwd?: string
  branch?: string
  goal?: string
  turns: { role: 'user' | 'assistant'; content: string }[]
  todos: AgentTodo[]
  files: string[]
  reason?: string
} | null> {
  const got =
    tool === 'codex' ? await codexTranscript(id) : tool === 'opencode' ? opencodeTranscript(id) : geminiTranscript(id)
  if (!got) return null
  const s = got.session
  const own: AgentTodo[] = 'todos' in got && Array.isArray(got.todos) ? got.todos : []
  const todos: AgentTodo[] = own.length ? own : (s?.todos ?? [])
  const goal = got.turns.find((t) => t.role === 'user')?.content ?? s?.firstPrompt
  return {
    label: s?.title ?? (goal ? goal.replace(/\s+/g, ' ').slice(0, 60) : TOOL_NAMES[tool]),
    agent: TOOL_NAMES[tool] + (s?.model ? ` (${s.model})` : ''),
    cwd: s?.cwd,
    goal,
    turns: got.turns,
    todos,
    files: s?.files ?? []
  }
}
