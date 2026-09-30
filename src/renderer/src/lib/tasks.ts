/**
 * El tablero de Tareas: en qué columna va cada trabajo de un agente.
 *
 * Una tarea es una conversación que trabaja sobre algo —un agente de línea de
 * comandos, un agente por API o un modelo con proyecto— o la Arena de código.
 * Las charlas sueltas sin proyecto no son tareas y no salen.
 *
 * Las columnas se deducen de lo que ya hay, sin estado aparte: si está
 * generando, en marcha; si espera tu permiso, falló, se quedó sin cupo, le
 * faltó un permiso o acabó preguntándote algo, necesita tu respuesta; si
 * acabó sin más, para revisar. Lo único que se guarda es que la diste por
 * hecha, y con cuántos turnos: si le vuelves a escribir, vuelve al tablero.
 */
import type { AgentStep, FileChange, RunCheckpoint, SessionTurn, StoredSession } from '@shared/types'
import type { ArenaState, ChatState, Turn } from './engine'

export type TaskColumn = 'running' | 'attention' | 'review' | 'done'

export const TASK_COLUMNS: TaskColumn[] = ['running', 'attention', 'review', 'done']

/** Por qué una tarea necesita tu respuesta. El texto es la clave de i18n. */
export interface TaskReason {
  text: string
  args?: Record<string, string | number>
}

export interface TaskCard {
  /** Id de la conversación, o 'arena'. */
  id: string
  kind: 'session' | 'arena'
  column: TaskColumn
  title: string
  reason?: TaskReason
  projectId?: string
  /** Agente de línea de comandos, agente por API o modelo suelto. */
  cliAgentId?: string
  agentId?: string
  model?: string
  providerId?: string
  worktreePath?: string
  branch?: string
  cost: number
  costEstimated: boolean
  added: number
  removed: number
  files: number
  /** Última actividad, para ordenar y filtrar por fecha. */
  updatedAt: number
  turns: number
  /** Ejecución en curso y desde cuándo. */
  runningRunId?: string
  startedAt?: number
  /** Lo último que está haciendo el agente. */
  current?: AgentStep
  /** Paso que espera tu permiso (agentes por API). */
  pending?: { runId: string; step: AgentStep }
  /**
   * Desde dónde revisar todo lo que ha cambiado la tarea: la foto del primer
   * turno que trabajó en la misma carpeta que el último.
   */
  review?: { runId: string; checkpoint: RunCheckpoint }
  doneAt?: number
}

type AnyTurn = SessionTurn & Partial<Pick<Turn, 'streaming' | 'live' | 'files'>>

/**
 * ¿El turno acabó porque se agotó un cupo o un límite? Es cuando más sentido
 * tiene ofrecer el relevo sin que haya que ir a buscarlo.
 */
export function endedByLimit(turn: {
  error?: string
  metrics?: { cliLimit?: { status: string }; status?: string }
  content?: string
}): boolean {
  if (turn.metrics?.cliLimit?.status === 'rejected') return true
  const text = `${turn.error ?? ''} ${turn.metrics?.status === 'error' ? turn.content ?? '' : ''}`
  return /usage limit|session limit|rate.?limit|quota|429|credit balance|insufficient|límite|cupo|saldo|exceeded|too many requests/i.test(
    text
  )
}

/**
 * ¿Acaba preguntándote algo? Se mira el final del mensaje sin el adorno de
 * markdown que suele quedar detrás (negritas, paréntesis, espacios).
 */
export function endsWithQuestion(text: string): boolean {
  const tail = text.trim().replace(/[\s*_`)\]"'»]+$/u, '')
  return tail.endsWith('?')
}

/** ¿Cuenta como tarea? Un agente, un proyecto o un worktree: algo sobre lo que trabaja. */
export function isTaskSession(s: StoredSession): boolean {
  return s.kind === 'cli' || Boolean(s.projectId || s.worktreePath || s.agentId)
}

function sumChanges(turns: AnyTurn[]): { added: number; removed: number; files: number } {
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  for (const t of turns) {
    if (t.role !== 'assistant' || t.metrics?.undone) continue
    const list: FileChange[] | undefined = t.streaming ? t.files : t.metrics?.filesChanged
    for (const f of list ?? []) {
      added += f.added
      removed += f.removed
      paths.add(f.path)
    }
  }
  return { added, removed, files: paths.size }
}

/** La foto desde la que se ve todo lo que ha hecho la tarea en su carpeta actual. */
function reviewBase(turns: AnyTurn[]): TaskCard['review'] {
  const withCk = turns.filter((t) => t.role === 'assistant' && t.runId && t.metrics?.checkpoint)
  const last = [...withCk].reverse().find((t) => !t.metrics?.undone)
  if (!last) return undefined
  const root = last.metrics!.checkpoint!.root
  const first = withCk.find((t) => t.metrics!.checkpoint!.root === root)!
  return { runId: first.runId!, checkpoint: first.metrics!.checkpoint! }
}

/** En qué columna va una conversación y por qué. Null si no es una tarea. */
export function taskOf(s: StoredSession, live?: ChatState): TaskCard | null {
  if (s.archived || !isTaskSession(s)) return null
  const session = live?.session ?? s
  const turns: AnyTurn[] = live?.turns ?? s.turns ?? []
  if (!turns.length) return null

  const runningRunId = live?.runningRunId
  const runningTurn = runningRunId ? turns.find((t) => t.runId === runningRunId) : undefined
  const assistants = turns.filter((t) => t.role === 'assistant')
  const last = assistants[assistants.length - 1]

  let cost = 0
  let costEstimated = false
  for (const t of assistants) {
    if (!t.metrics) continue
    cost += t.metrics.costTotal
    if (t.metrics.costEstimated && t.metrics.costTotal > 0) costEstimated = true
  }
  const changes = sumChanges(turns)
  const branch = [...assistants].reverse().find((t) => t.metrics?.branch)?.metrics?.branch

  const card: TaskCard = {
    id: s.id,
    kind: 'session',
    column: 'review',
    title: session.title,
    projectId: session.projectId,
    cliAgentId: session.kind === 'cli' ? session.cliAgentId : undefined,
    agentId: session.kind === 'chat' ? session.agentId : undefined,
    model: session.kind === 'cli' ? session.cliModel : session.model,
    providerId: session.kind === 'chat' ? session.providerId : undefined,
    worktreePath: session.worktreePath,
    branch,
    cost,
    costEstimated,
    ...changes,
    updatedAt: session.updatedAt,
    turns: turns.length,
    review: changes.files ? reviewBase(turns) : undefined
  }

  if (runningTurn?.streaming) {
    card.runningRunId = runningRunId
    card.startedAt = runningTurn.live?.startedAt
    const steps = runningTurn.steps ?? []
    card.current = steps[steps.length - 1]
    const pending = steps.find((st) => st.approval === 'pending')
    if (pending) {
      card.column = 'attention'
      card.pending = { runId: runningRunId!, step: pending }
      card.reason = { text: 'Espera tu permiso para seguir' }
    } else card.column = 'running'
    return card
  }

  const done = session.taskDone
  if (done && turns.length <= done.turns) {
    card.column = 'done'
    card.doneAt = done.at
    return card
  }

  if (!last) return card
  if (endedByLimit(last)) {
    card.column = 'attention'
    card.reason = { text: 'Se quedó sin cupo' }
  } else if (last.error || last.metrics?.status === 'error') {
    card.column = 'attention'
    card.reason = { text: 'Falló: {error}', args: { error: (last.error ?? '').split('\n')[0].slice(0, 140) } }
  } else if (last.steps?.some((st) => st.denied)) {
    const st = last.steps.find((x) => x.denied)!
    card.column = 'attention'
    card.reason = { text: 'Le faltó permiso para {what}', args: { what: [st.tool, st.target].filter(Boolean).join(' ') } }
  } else if (endsWithQuestion(last.content)) {
    card.column = 'attention'
    card.reason = { text: 'Te ha preguntado algo' }
  }
  return card
}

/**
 * La Arena de código también es una tarea: varios agentes con la misma, cada
 * uno en su worktree. La de sólo respuestas no toca nada y no sale.
 */
export function arenaTask(a: ArenaState): TaskCard | null {
  if (!a.project || !a.arenaId) return null
  const started = a.contenders.filter((c) => c.runId || c.streaming || c.phase || c.worktreePath)
  if (!started.length) return null
  let cost = 0
  let added = 0
  let removed = 0
  let files = 0
  let costEstimated = false
  for (const c of started) {
    if (c.run) {
      cost += c.run.costTotal
      if (c.run.costEstimated && c.run.costTotal > 0) costEstimated = true
      for (const f of c.run.filesChanged ?? []) {
        added += f.added
        removed += f.removed
        files++
      }
    }
  }
  const card: TaskCard = {
    id: 'arena',
    kind: 'arena',
    column: 'done',
    title: a.prompt.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Arena',
    projectId: a.project.id,
    cost,
    costEstimated,
    added,
    removed,
    files,
    updatedAt: Math.max(0, ...started.map((c) => c.run?.createdAt ?? 0)) || Date.now(),
    turns: started.length
  }
  const pending = started.flatMap((c) =>
    c.runId ? (c.steps ?? []).filter((st) => st.approval === 'pending').map((st) => ({ runId: c.runId!, step: st })) : []
  )[0]
  if (pending) {
    card.column = 'attention'
    card.pending = pending
    card.reason = { text: 'Espera tu permiso para seguir' }
  } else if (a.running) {
    card.column = 'running'
  } else if (started.some((c) => c.worktreePath && !c.outcome)) {
    card.column = 'review'
    card.reason = { text: 'Elige el ganador y fusiónalo' }
  }
  return card
}

/** Todas las tarjetas, sin filtrar. */
export function buildTasks(list: StoredSession[], chats: Record<string, ChatState>, a: ArenaState): TaskCard[] {
  const out: TaskCard[] = []
  const seen = new Set<string>()
  for (const s of list) {
    seen.add(s.id)
    const card = taskOf(s, chats[s.id])
    if (card) out.push(card)
  }
  // Una conversación recién creada puede estar en memoria antes que en la lista.
  for (const [id, st] of Object.entries(chats)) {
    if (seen.has(id)) continue
    const card = taskOf(st.session, st)
    if (card) out.push(card)
  }
  const arena = arenaTask(a)
  if (arena) out.push(arena)
  return out
}

/** Cuántas esperan algo de ti: la insignia del menú. */
export function attentionCount(list: StoredSession[], chats: Record<string, ChatState>, a: ArenaState): number {
  return buildTasks(list, chats, a).filter((c) => c.column === 'attention').length
}
