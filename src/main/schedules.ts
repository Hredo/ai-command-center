/**
 * Tareas programadas: un agente que se lanza solo a su hora sobre un
 * proyecto, normalmente en un worktree aparte, y queda en Tareas para
 * revisar. «Cada noche, actualiza dependencias y déjalo para mirar».
 *
 * El reloj vive aquí; la tarea la lanza la ventana principal, igual que una
 * del tablero (así se guarda, se ve en vivo y se revisa como cualquier otra).
 * Por eso sólo corre con la app abierta: en la bandeja vale. Si a su hora
 * estaba cerrada, se lanza al abrirla (salvo que se diga lo contrario).
 */
import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { getConfig, saveConfig, upsert } from './config'
import { emit } from './emit'
import { nextRun } from '@shared/schedule'
import type { AppConfig, ScheduleRun, ScheduledTask, ScheduledTaskView } from '@shared/types'

const MAX_SCHEDULES = 100
/** Una ejecución que no avisa de que terminó se da por perdida pasado esto. */
const STALE_MS = 6 * 3600_000
/** Si se lanza con más retraso que esto, es que la app estaba cerrada a su hora. */
const LATE_MS = 5 * 60_000

let timer: NodeJS.Timeout | null = null
let getMain: () => BrowserWindow | null = () => null
/** runId → la tarea y cuándo empezó. */
const running = new Map<string, { scheduleId: string; at: number }>()

/** Cada cuánto se mira el reloj. Las pruebas lo acortan. */
function tickMs(): number {
  const v = Number(process.env['ACC_SCHEDULE_TICK_MS'])
  return v >= 200 && v <= 60_000 ? v : 30_000
}

function isRunning(scheduleId: string): boolean {
  const now = Date.now()
  for (const [runId, r] of running) {
    if (now - r.at > STALE_MS) running.delete(runId)
    else if (r.scheduleId === scheduleId) return true
  }
  return false
}

function list(): ScheduledTask[] {
  return getConfig().schedules ?? []
}

function patch(id: string, p: Partial<ScheduledTask>): void {
  const cfg = getConfig()
  const all = cfg.schedules ?? []
  const cur = all.find((s) => s.id === id)
  if (!cur) return
  saveConfig({ ...cfg, schedules: upsert(all, { ...cur, ...p }) })
}

export function listSchedules(): ScheduledTaskView[] {
  return list().map((s) => ({
    ...s,
    nextRunAt: s.enabled ? nextRun(s, s.lastRunAt ?? s.createdAt) : null,
    running: isRunning(s.id)
  }))
}

const REPEATS = new Set(['daily', 'weekdays', 'weekly', 'hourly'])

export function saveSchedule(s: ScheduledTask): AppConfig {
  if (!s?.id) throw new Error('Tarea no válida')
  const prompt = String(s.prompt ?? '').trim()
  if (!prompt) throw new Error('Escribe qué tiene que hacer')
  const cfg = getConfig()
  if (!cfg.projects.some((p) => p.id === s.projectId)) throw new Error('Elige un proyecto')
  const agent = String(s.agent ?? '')
  if (!/^(cli|api):.+$/.test(agent) && agent !== 'model') throw new Error('Elige un agente')
  if (agent === 'model' && (!s.pick?.providerId || !s.pick?.model)) throw new Error('Elige un modelo')
  const all = cfg.schedules ?? []
  const prev = all.find((x) => x.id === s.id)
  if (!prev && all.length >= MAX_SCHEDULES) throw new Error(`Ya hay ${MAX_SCHEDULES} tareas programadas`)
  const clean: ScheduledTask = {
    id: String(s.id),
    name: String(s.name ?? '').trim().slice(0, 120) || prompt.replace(/\s+/g, ' ').slice(0, 54),
    enabled: s.enabled !== false,
    projectId: String(s.projectId),
    agent,
    pick: agent === 'model' ? { providerId: String(s.pick!.providerId), model: String(s.pick!.model) } : undefined,
    permissionMode: s.permissionMode ? String(s.permissionMode) : undefined,
    worktree: s.worktree !== false,
    prompt: prompt.slice(0, 50_000),
    repeat: REPEATS.has(s.repeat) ? s.repeat : 'daily',
    time: s.time ? String(s.time).slice(0, 5) : undefined,
    weekday: s.weekday != null ? Math.min(6, Math.max(0, Math.round(Number(s.weekday)))) : undefined,
    everyHours: s.everyHours != null ? Math.min(168, Math.max(1, Math.round(Number(s.everyHours)))) : undefined,
    catchUp: s.catchUp !== false,
    createdAt: Number(prev?.createdAt ?? s.createdAt) || Date.now(),
    // Lo que pasó en las ejecuciones lo lleva el programador, no el formulario.
    lastRunAt: prev?.lastRunAt,
    lastStatus: prev?.lastStatus,
    lastError: prev?.lastError,
    lastSessionId: prev?.lastSessionId
  }
  return saveConfig({ ...cfg, schedules: upsert(all, clean) })
}

export function removeSchedule(id: string): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, schedules: (cfg.schedules ?? []).filter((s) => s.id !== id) })
}

/** Manda la tarea a la ventana principal. Devuelve el id de la ejecución o null si no se pudo. */
function fire(task: ScheduledTask, reason: ScheduleRun['reason']): string | null {
  const main = getMain()
  if (!main || main.isDestroyed() || main.webContents.isLoading()) return null
  const runId = randomUUID()
  running.set(runId, { scheduleId: task.id, at: Date.now() })
  patch(task.id, { lastRunAt: Date.now(), lastStatus: 'running', lastError: undefined })
  emit(main, 'schedules:run', { runId, reason, task })
  return runId
}

export function runScheduleNow(id: string): string {
  const task = list().find((s) => s.id === id)
  if (!task) throw new Error('Esa tarea ya no existe')
  if (isRunning(id)) throw new Error('Ya está en marcha')
  const runId = fire(task, 'manual')
  if (!runId) throw new Error('La ventana principal no está lista')
  return runId
}

/** La ventana dice en qué conversación va la tarea. */
export function scheduleStarted(runId: string, sessionId: string): void {
  const r = running.get(runId)
  if (r) patch(r.scheduleId, { lastSessionId: sessionId })
}

/** La ventana dice cómo acabó. */
export function scheduleFinished(runId: string, ok: boolean, error?: string): void {
  const r = running.get(runId)
  if (!r) return
  running.delete(runId)
  patch(r.scheduleId, { lastStatus: ok ? 'ok' : 'error', lastError: ok ? undefined : String(error ?? '').slice(0, 500) || undefined })
}

function tick(): void {
  const now = Date.now()
  for (const s of list()) {
    if (!s.enabled || isRunning(s.id)) continue
    const due = nextRun(s, s.lastRunAt ?? s.createdAt)
    if (due == null || due > now) continue
    const late = now - due > LATE_MS
    if (late && s.catchUp === false) {
      // Estaba cerrada a su hora y se pidió no recuperarla: se apunta y se espera a la siguiente.
      patch(s.id, { lastRunAt: now, lastStatus: 'missed', lastError: undefined })
      continue
    }
    fire(s, late ? 'catchup' : 'time')
  }
}

function loop(): void {
  timer = setTimeout(() => {
    try {
      tick()
    } catch (err) {
      console.error('[schedules]', err)
    }
    loop()
  }, tickMs())
  timer.unref?.()
}

export function startScheduler(resolver: () => BrowserWindow | null): void {
  getMain = resolver
  stopScheduler()
  // Lo que se quedó «en marcha» al cerrar la app no va a avisar nunca.
  for (const s of list()) if (s.lastStatus === 'running') patch(s.id, { lastStatus: 'error', lastError: 'La app se cerró mientras corría' })
  loop()
}

export function stopScheduler(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
