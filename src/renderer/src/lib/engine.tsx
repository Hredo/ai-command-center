/**
 * Motor de ejecución del renderer.
 *
 * Todo lo que está vivo —conversaciones, agentes de línea de comandos,
 * terminales y la Arena— se guarda aquí, en almacenes externos a React que
 * viven mientras viva la ventana. Antes cada página se suscribía a los eventos
 * y guardaba su propio estado, así que al cambiar de pantalla se desmontaba y
 * la ejecución se quedaba huérfana: seguía en el proceso principal pero la
 * interfaz perdía el hilo. Ahora las páginas sólo leen; nada se interrumpe al
 * navegar.
 *
 * Se usan almacenes por rebanada y useSyncExternalStore para que un fragmento
 * de texto de un chat no repinte las terminales. El texto en streaming se
 * acumula en un búfer y se vuelca una vez por fotograma: sin eso, un modelo
 * rápido dispara cientos de renders por segundo.
 */
import React, { useEffect, useSyncExternalStore } from 'react'
import type {
  RunRecord, StoredSession, SessionTurn, TurnMetrics, TermInfo, TermEvent,
  ChatMessage, SessionKind, UsageLimit, FileChange, FileTouch, Attachment, Effort,
  AgentStep, CliLimit
} from '@shared/types'

/* ------------------------------------------------------------------ *
 * Almacén mínimo                                                     *
 * ------------------------------------------------------------------ */

type Listener = () => void

class Slice<T> {
  private listeners = new Set<Listener>()
  constructor(private value: T) {}

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  get = (): T => this.value

  set(next: T): void {
    if (next === this.value) return
    this.value = next
    for (const l of [...this.listeners]) l()
  }

  update(fn: (v: T) => T): void {
    this.set(fn(this.value))
  }
}

function useSlice<T>(slice: Slice<T>): T {
  return useSyncExternalStore(slice.subscribe, slice.get, slice.get)
}

/* ------------------------------------------------------------------ *
 * Tipos de la interfaz                                               *
 * ------------------------------------------------------------------ */

/** Métricas mientras algo está generando. Se estiman; al acabar llegan las reales. */
export interface LiveMetrics {
  startedAt: number
  ttftMs?: number
  chars: number
  approxTokens: number
  /** Tokens de entrada reales, si el proveedor los ha adelantado. */
  promptTokens?: number
  /** Contexto ocupado y ventana del modelo, cuando se sabe. */
  contextUsed?: number
  contextLimit?: number
  /** Lo que dicen las cabeceras del proveedor sobre tus límites. */
  usageLimit?: UsageLimit
  /** Ventana de uso del plan, según el propio agente de línea de comandos. */
  cliLimit?: CliLimit
}

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  runId?: string
  run?: RunRecord
  metrics?: TurnMetrics
  streaming?: boolean
  error?: string
  model?: string
  providerId?: string
  live?: LiveMetrics
  /** Salida cruda de un agente de línea de comandos. */
  raw?: string
  /** Lo que va haciendo el agente: pensamientos y herramientas. */
  steps?: AgentStep[]
  /** Archivos que han cambiado en el proyecto durante el turno. */
  files?: FileChange[]
  /** Archivos que el agente dice haber abierto o editado. */
  touched?: FileTouch[]
  /** Adjuntos, en el turno del usuario. */
  attachments?: Attachment[]
}

export interface ChatState {
  session: StoredSession
  turns: Turn[]
  /** Id de la ejecución en curso, si hay una. */
  runningRunId?: string
}

export interface TermSegment {
  kind: 'out' | 'err'
  text: string
}

export interface TermBlock {
  id: string
  command: string
  startedAt: number
  segments: TermSegment[]
  exitCode?: number
  ok?: boolean
  cwd?: string
  durationMs?: number
  running: boolean
  /** Bloque sin comando: salida que llegó sin que hubiera nada lanzado. */
  system?: boolean
}

export interface TermState {
  info: TermInfo
  /** Sólo en el motor de respaldo: la salida troceada en bloques. */
  blocks: TermBlock[]
  /** Historial de comandos para las flechas arriba y abajo. */
  history: string[]
  busy: boolean
  ready: boolean
  exited?: number
  /** Resultado del último comando, para la franja de estado del PTY. */
  lastExit?: { code: number; durationMs?: number; at: number }
}

/** Un contendiente de la Arena: un modelo por API o un agente de CLI. */
export interface Contender {
  key: string
  mode: 'api' | 'cli'
  providerId?: string
  model?: string
  cliAgentId?: string
  projectPath?: string
  runId?: string
  content: string
  run?: RunRecord
  streaming: boolean
  error?: string
  live?: LiveMetrics
}

export interface ArenaState {
  contenders: Contender[]
  prompt: string
  system: string
  arenaId?: string
  running: boolean
}

/* ------------------------------------------------------------------ *
 * Almacenes                                                          *
 * ------------------------------------------------------------------ */

const chats = new Slice<Record<string, ChatState>>({})
const terms = new Slice<Record<string, TermState>>({})
const sessions = new Slice<StoredSession[]>([])
const arena = new Slice<ArenaState>({
  contenders: [],
  prompt: '',
  system: '',
  running: false
})
/** Cambia cada 250 ms mientras algo esté corriendo: mueve los contadores. */
const ticker = new Slice<number>(0)
/**
 * Sube cada vez que una ejecución termina. Las pantallas que leen del
 * histórico (el Panel, la barra de título, el Histórico) se enganchan aquí y
 * se refrescan solas en cuanto hay algo nuevo que contar.
 */
const runsVersion = new Slice<number>(0)

export const uid = (): string => crypto.randomUUID()

function approxTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4))
}

/* ------------------------------------------------------------------ *
 * Volcado de texto por fotograma                                     *
 * ------------------------------------------------------------------ */

const pendingText = new Map<string, { text: string; reasoning: string; firstAt: number }>()
let flushScheduled = false
let flushTimer: number | null = null

/**
 * El texto se junta y se vuelca una vez por fotograma: así un agente que
 * escribe a chorro no provoca mil repintados.
 *
 * Con una pega: cuando la ventana está minimizada, tapada o en otro
 * escritorio, el navegador deja de dar fotogramas, y entonces el volcado no
 * llegaba nunca. El texto seguía entrando por detrás pero no se veía, y al
 * volver aparecía todo de golpe: daba la impresión de que la IA se había
 * colgado. Por eso hay también un temporizador de respaldo; corre el que
 * llegue antes.
 */
function queueText(runId: string, text: string, reasoning = ''): void {
  const cur = pendingText.get(runId) ?? { text: '', reasoning: '', firstAt: Date.now() }
  cur.text += text
  cur.reasoning += reasoning
  pendingText.set(runId, cur)

  if (flushScheduled) return
  flushScheduled = true

  const run = (): void => {
    if (!flushScheduled) return
    flushScheduled = false
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer)
      flushTimer = null
    }
    const batch = new Map(pendingText)
    pendingText.clear()
    if (batch.size) applyText(batch)
  }

  requestAnimationFrame(run)
  flushTimer = window.setTimeout(run, FLUSH_FALLBACK_MS)
}

/** Cada cuánto se vuelca como mucho si no hay fotogramas. */
const FLUSH_FALLBACK_MS = 120

/**
 * Vuelca ya lo que esté esperando fotograma.
 *
 * Hace falta justo antes de cerrar un turno: el volcado va por
 * requestAnimationFrame, así que un agente que acaba inmediatamente después de
 * hablar dejaba el último trozo en el aire. Con el texto no se notaba —el
 * registro final lo trae completo— pero el razonamiento se perdía, porque de
 * eso no hay copia en el registro.
 */
function flushPendingText(): void {
  if (!pendingText.size) return
  const batch = new Map(pendingText)
  pendingText.clear()
  applyText(batch)
}

function applyText(batch: Map<string, { text: string; reasoning: string; firstAt: number }>): void {
  // Chats
  chats.update((all) => {
    let changed = false
    const next: Record<string, ChatState> = {}
    for (const [sid, state] of Object.entries(all)) {
      let touched = false
      const turns = state.turns.map((t) => {
        const add = t.runId ? batch.get(t.runId) : undefined
        if (!add || !t.streaming) return t
        touched = true
        const content = t.content + add.text
        return {
          ...t,
          content,
          reasoning: add.reasoning ? (t.reasoning ?? '') + add.reasoning : t.reasoning,
          live: {
            ...t.live,
            startedAt: t.live?.startedAt ?? Date.now(),
            // Se mide con el instante en que llegó el trozo, no con el del
            // volcado: si no, el fotograma añadiría hasta 16 ms de más.
            ttftMs: t.live?.ttftMs ?? Math.max(0, add.firstAt - (t.live?.startedAt ?? add.firstAt)),
            promptTokens: t.live?.promptTokens,
            chars: content.length,
            approxTokens: approxTokens(content)
          }
        }
      })
      next[sid] = touched ? { ...state, turns } : state
      if (touched) changed = true
    }
    return changed ? next : all
  })

  // Arena
  arena.update((a) => {
    let changed = false
    const contenders = a.contenders.map((c) => {
      const add = c.runId ? batch.get(c.runId) : undefined
      if (!add || !c.streaming) return c
      changed = true
      const content = c.content + add.text
      return {
        ...c,
        content,
        live: {
          ...c.live,
          startedAt: c.live?.startedAt ?? Date.now(),
          ttftMs: c.live?.ttftMs ?? Math.max(0, add.firstAt - (c.live?.startedAt ?? add.firstAt)),
          chars: content.length,
          approxTokens: approxTokens(content)
        }
      }
    })
    return changed ? { ...a, contenders } : a
  })
}

/* ------------------------------------------------------------------ *
 * Persistencia de sesiones (con retardo)                             *
 * ------------------------------------------------------------------ */

const saveTimers = new Map<string, number>()

function toStoredTurn(t: Turn): SessionTurn {
  return {
    id: t.id,
    role: t.role,
    content: t.content,
    reasoning: t.reasoning,
    runId: t.runId,
    model: t.model,
    providerId: t.providerId,
    error: t.error,
    metrics: t.metrics,
    raw: t.raw,
    steps: t.steps,
    attachments: t.attachments
  }
}

function schedulePersist(sessionId: string): void {
  const prev = saveTimers.get(sessionId)
  if (prev) window.clearTimeout(prev)
  saveTimers.set(
    sessionId,
    window.setTimeout(() => {
      saveTimers.delete(sessionId)
      const state = chats.get()[sessionId]
      if (!state) return
      const payload: StoredSession = {
        ...state.session,
        turns: state.turns.map(toStoredTurn),
        updatedAt: Date.now()
      }
      void window.api.sessions.save(payload).then((r) => {
        if (r.ok && r.data) {
          // La lista lateral tiene que reflejar el título y la fecha nuevos.
          sessions.update((list) => {
            const i = list.findIndex((s) => s.id === payload.id)
            const row = r.data as StoredSession
            if (i === -1) return [row, ...list]
            const copy = list.slice()
            copy[i] = row
            return copy
          })
        }
      })
    }, 700)
  )
}

/** Fuerza el guardado inmediato de todo lo pendiente. */
export function flushPersist(): void {
  for (const [id, timer] of saveTimers) {
    window.clearTimeout(timer)
    saveTimers.delete(id)
    const state = chats.get()[id]
    if (!state) continue
    void window.api.sessions.save({
      ...state.session,
      turns: state.turns.map(toStoredTurn),
      updatedAt: Date.now()
    })
  }
}

/* ------------------------------------------------------------------ *
 * Suscripción a los eventos del proceso principal                    *
 * ------------------------------------------------------------------ */

let wired = false
let tickTimer: number | null = null

function anythingRunning(): boolean {
  if (Object.values(chats.get()).some((c) => c.runningRunId)) return true
  if (arena.get().running) return true
  if (Object.values(terms.get()).some((t) => t.busy)) return true
  return false
}

function ensureTicker(): void {
  if (tickTimer !== null) return
  tickTimer = window.setInterval(() => {
    if (!anythingRunning()) {
      if (tickTimer !== null) window.clearInterval(tickTimer)
      tickTimer = null
      ticker.update((n) => n + 1)
      return
    }
    ticker.update((n) => n + 1)
  }, 250)
}

/**
 * Parchea el turno que está generando, en la conversación y en la Arena.
 * Lo usan los datos que llegan a mitad de camino: contexto, límites de uso y
 * archivos tocados.
 */
function patchRunningTurn(runId: string, patch: (t: Turn) => Turn): void {
  chats.update((all) => {
    let changed = false
    const next: Record<string, ChatState> = {}
    for (const [sid, st] of Object.entries(all)) {
      let touched = false
      const turns = st.turns.map((t) => {
        if (t.runId !== runId) return t
        touched = true
        return patch(t)
      })
      next[sid] = touched ? { ...st, turns } : st
      if (touched) changed = true
    }
    return changed ? next : all
  })
  arena.update((a) => {
    let changed = false
    const contenders = a.contenders.map((c) => {
      if (c.runId !== runId) return c
      changed = true
      const asTurn = patch({ id: c.key, role: 'assistant', content: c.content, live: c.live } as Turn)
      return { ...c, live: asTurn.live }
    })
    return changed ? { ...a, contenders } : a
  })
}

/** Fija el primer token cuando el proveedor lo informa explícitamente. */
function markTtft(runId: string, ttftMs: number): void {
  const stamp = ttftMs
  chats.update((all) => {
    let changed = false
    const next: Record<string, ChatState> = {}
    for (const [sid, st] of Object.entries(all)) {
      let touched = false
      const turns = st.turns.map((t) => {
        if (t.runId !== runId || !t.streaming || t.live?.ttftMs != null) return t
        touched = true
        return { ...t, live: { ...(t.live ?? { startedAt: Date.now(), chars: 0, approxTokens: 0 }), ttftMs: stamp } }
      })
      next[sid] = touched ? { ...st, turns } : st
      if (touched) changed = true
    }
    return changed ? next : all
  })
  arena.update((a) => {
    let changed = false
    const contenders = a.contenders.map((c) => {
      if (c.runId !== runId || !c.streaming || c.live?.ttftMs != null) return c
      changed = true
      return { ...c, live: { ...(c.live ?? { startedAt: Date.now(), chars: 0, approxTokens: 0 }), ttftMs: stamp } }
    })
    return changed ? { ...a, contenders } : a
  })
}

function wire(): void {
  if (wired) return
  wired = true

  window.api.run.onDelta((d) => {
    if (d.type === 'text') {
      queueText(d.runId, d.text ?? '')
      if (d.ttftMs != null) markTtft(d.runId, d.ttftMs)
    } else if (d.type === 'reasoning') {
      queueText(d.runId, '', d.text ?? '')
    } else if (d.type === 'limit' || d.type === 'start') {
      // Los límites llegan en las cabeceras de la respuesta, así que se ven
      // en cuanto el proveedor contesta, no al final.
      if (d.usageLimit || d.contextLimit != null) {
        patchRunningTurn(d.runId, (t) => ({
          ...t,
          live: {
            ...(t.live ?? { startedAt: Date.now(), chars: 0, approxTokens: 0 }),
            usageLimit: d.usageLimit ?? t.live?.usageLimit,
            contextLimit: d.contextLimit ?? t.live?.contextLimit
          }
        }))
      }
    }
    if (d.type === 'done' || d.type === 'error') runsVersion.update((n) => n + 1)
    // El evento 'start' no fija el primer token: llegaría siempre a cero y
    // taparía la medida real, que es cuando aparece el primer fragmento.
  })

  window.api.cli.onEvent((e) => {
    // 'meta' ya no llega al texto: el comando y los avisos del lanzamiento
    // son pasos de la línea de tiempo.
    if (e.type === 'stdout' || e.type === 'stderr') {
      queueText(e.runId, e.data ?? '')
    } else if (e.type === 'reasoning') {
      queueText(e.runId, '', e.data ?? '')
    } else if (e.type === 'files') {
      patchRunningTurn(e.runId, (t) => ({
        ...t,
        files: e.files ?? t.files,
        touched: e.touched ?? t.touched
      }))
    } else if (e.type === 'usage') {
      patchRunningTurn(e.runId, (t) => ({
        ...t,
        live: {
          ...(t.live ?? { startedAt: Date.now(), chars: 0, approxTokens: 0 }),
          contextUsed: e.contextUsed ?? t.live?.contextUsed,
          contextLimit: e.contextLimit ?? t.live?.contextLimit
        }
      }))
    } else if (e.type === 'step' && e.step) {
      const step = e.step
      patchRunningTurn(e.runId, (t) => {
        const prev = t.steps ?? []
        const at = prev.findIndex((s) => s.id === step.id)
        // Un paso que ya estaba se actualiza en su sitio: es la misma acción,
        // que ahora tiene resultado.
        const steps = at === -1 ? [...prev, step] : prev.map((s, i) => (i === at ? { ...s, ...step } : s))
        return { ...t, steps }
      })
    } else if (e.type === 'limit' && e.limit) {
      const limit = e.limit
      patchRunningTurn(e.runId, (t) => ({
        ...t,
        live: { ...(t.live ?? { startedAt: Date.now(), chars: 0, approxTokens: 0 }), cliLimit: limit }
      }))
    } else if (e.type === 'exit') {
      runsVersion.update((n) => n + 1)
    }
  })

  window.api.term.onEvent(handleTermEvent)
}

/* ------------------------------------------------------------------ *
 * Terminales                                                         *
 * ------------------------------------------------------------------ */

function pushSegment(block: TermBlock, kind: 'out' | 'err', text: string): TermBlock {
  const segs = block.segments.slice()
  const last = segs[segs.length - 1]
  // Se fusionan tramos consecutivos del mismo canal: si no, un comando
  // hablador genera miles de nodos.
  if (last && last.kind === kind) segs[segs.length - 1] = { kind, text: last.text + text }
  else segs.push({ kind, text })
  return { ...block, segments: segs }
}

/* ------------------------------------------------------------------ *
 * Salida del PTY                                                     *
 * ------------------------------------------------------------------ */

/**
 * Con una consola de verdad la salida son bytes crudos que van directos al
 * emulador, no datos que pinte React. Si pasaran por el almacén reactivo,
 * cada trozo provocaría un render: un `ls` de un directorio grande dejaría la
 * interfaz de rodillas. Así que van por dos caminos aparte del estado:
 *
 * - `termListeners`: la vista abierta recibe cada trozo y lo escribe en xterm.
 * - `scrollbacks`: una copia recortada, para poder repintar la pantalla
 *   cuando vuelves a la pestaña y el emulador se ha creado de nuevo.
 */
/** Lo que recibe la vista del emulador: datos, o la orden de limpiar. */
export type TermFeed = { type: 'data'; data: string } | { type: 'clear' }

const termListeners = new Map<string, Set<(f: TermFeed) => void>>()
const scrollbacks = new Map<string, string>()

/** Tope del historial que se guarda para repintar, en caracteres. */
const SCROLLBACK_CAP = 400_000

export function onTermData(termId: string, cb: (f: TermFeed) => void): () => void {
  let set = termListeners.get(termId)
  if (!set) {
    set = new Set()
    termListeners.set(termId, set)
  }
  set.add(cb)
  return () => {
    set?.delete(cb)
  }
}

export function termScrollback(termId: string): string {
  return scrollbacks.get(termId) ?? ''
}

function pushTermData(termId: string, data: string): void {
  const prev = scrollbacks.get(termId) ?? ''
  const next = prev.length + data.length > SCROLLBACK_CAP
    ? (prev + data).slice(-SCROLLBACK_CAP)
    : prev + data
  scrollbacks.set(termId, next)
  const set = termListeners.get(termId)
  if (set) for (const cb of set) cb({ type: 'data', data })
}

function handleTermEvent(e: TermEvent): void {
  // En modo consola la salida no toca el estado reactivo.
  const st0 = terms.get()[e.termId]
  if (st0?.info.backend === 'pty' && (e.type === 'out' || e.type === 'err')) {
    if (e.data) pushTermData(e.termId, e.data)
    return
  }

  terms.update((all) => {
    const st = all[e.termId]
    if (!st) return all

    if (e.type === 'cwd') {
      return { ...all, [e.termId]: { ...st, info: { ...st.info, cwd: e.cwd ?? st.info.cwd } } }
    }

    if (st.info.backend === 'pty') {
      if (e.type === 'ready') {
        return { ...all, [e.termId]: { ...st, ready: true, info: { ...st.info, cwd: e.cwd ?? st.info.cwd } } }
      }
      if (e.type === 'block-end') {
        return {
          ...all,
          [e.termId]: {
            ...st,
            busy: false,
            lastExit: { code: e.exitCode ?? 0, durationMs: e.durationMs, at: Date.now() },
            info: { ...st.info, cwd: e.cwd ?? st.info.cwd }
          }
        }
      }
      if (e.type === 'exit') {
        return { ...all, [e.termId]: { ...st, busy: false, exited: e.exitCode ?? 0, info: { ...st.info, alive: false } } }
      }
      return all
    }

    if (e.type === 'ready') {
      return {
        ...all,
        [e.termId]: { ...st, ready: true, info: { ...st.info, cwd: e.cwd ?? st.info.cwd } }
      }
    }

    if (e.type === 'exit') {
      const blocks = st.blocks.map((b) => (b.running ? { ...b, running: false } : b))
      return {
        ...all,
        [e.termId]: { ...st, busy: false, exited: e.exitCode ?? 0, blocks, info: { ...st.info, alive: false } }
      }
    }

    if (e.type === 'out' || e.type === 'err') {
      const text = e.data ?? ''
      if (!text) return all
      const blocks = st.blocks.slice()
      const idx = blocks.findIndex((b) => b.running)
      if (idx !== -1) {
        blocks[idx] = pushSegment(blocks[idx], e.type, text)
      } else {
        // Salida sin comando lanzado: aviso de la propia shell.
        const last = blocks[blocks.length - 1]
        if (last?.system) blocks[blocks.length - 1] = pushSegment(last, e.type, text)
        else
          blocks.push({
            id: uid(),
            command: '',
            startedAt: Date.now(),
            segments: [{ kind: e.type, text }],
            running: false,
            system: true
          })
      }
      return { ...all, [e.termId]: { ...st, blocks } }
    }

    if (e.type === 'block-end') {
      const blocks = st.blocks.slice()
      const idx = blocks.findIndex((b) => b.running)
      if (idx !== -1) {
        blocks[idx] = {
          ...blocks[idx],
          running: false,
          exitCode: e.exitCode,
          ok: e.ok,
          cwd: e.cwd,
          durationMs: e.durationMs
        }
      }
      return {
        ...all,
        [e.termId]: { ...st, busy: false, blocks, info: { ...st.info, cwd: e.cwd ?? st.info.cwd } }
      }
    }

    return all
  })
}

/**
 * Abre una terminal nueva.
 *
 * Devuelve el motivo cuando no se puede: una pestaña que se queda pensando
 * "abriendo una shell" para siempre no le dice nada a nadie.
 */
export async function openTerm(opts: {
  cwd?: string
  projectId?: string
  title?: string
  cols?: number
  rows?: number
  forcePipe?: boolean
} = {}): Promise<{ id: string | null; error?: string }> {
  const r = await window.api.term.create(opts)
  if (!r.ok || !r.data) {
    return { id: null, error: r.error || 'el proceso principal no devolvió la terminal' }
  }
  const info = r.data
  scrollbacks.set(info.id, '')
  terms.update((all) => ({
    ...all,
    [info.id]: { info, blocks: [], history: [], busy: false, ready: false }
  }))
  return { id: info.id }
}

/** Ejecuta un comando como si lo hubieras tecleado y pulsado Intro. */
export function sendTermCommand(termId: string, command: string): void {
  const cmd = command.trim()
  if (!cmd) return
  terms.update((all) => {
    const st = all[termId]
    if (!st) return all
    const history = st.history[st.history.length - 1] === cmd ? st.history : [...st.history, cmd].slice(-200)

    // En modo consola no hay bloques: la salida la pinta el emulador.
    if (st.info.backend === 'pty') {
      return { ...all, [termId]: { ...st, busy: true, history } }
    }
    const block: TermBlock = {
      id: uid(),
      command: cmd,
      startedAt: Date.now(),
      segments: [],
      running: true,
      cwd: st.info.cwd
    }
    return { ...all, [termId]: { ...st, blocks: [...st.blocks, block], busy: true, history } }
  })
  ensureTicker()
  void window.api.term.run(termId, cmd)
}

/**
 * Teclas y texto tal cual, para el emulador. Si el usuario pulsa Intro se
 * marca la terminal como ocupada: el fin lo dirá el marcador de la shell.
 */
export function writeTerm(termId: string, data: string): void {
  if (data.includes('\r') || data.includes('\n')) {
    terms.update((all) => {
      const st = all[termId]
      if (!st || st.busy) return all
      return { ...all, [termId]: { ...st, busy: true } }
    })
    ensureTicker()
  }
  void window.api.term.write(termId, data)
}

export function resizeTerm(termId: string, cols: number, rows: number): void {
  void window.api.term.resize(termId, cols, rows)
}

export function interruptTerm(termId: string): void {
  void window.api.term.interrupt(termId)
}

export async function closeTerm(termId: string): Promise<void> {
  await window.api.term.close(termId)
  scrollbacks.delete(termId)
  termListeners.delete(termId)
  terms.update((all) => {
    const next = { ...all }
    delete next[termId]
    return next
  })
}

export function clearTerm(termId: string): void {
  const st = terms.get()[termId]
  if (st?.info.backend === 'pty') {
    // Se limpia el historial guardado y se avisa a la vista para que borre la
    // pantalla del emulador.
    scrollbacks.set(termId, '')
    const set = termListeners.get(termId)
    if (set) for (const cb of set) cb({ type: 'clear' })
    return
  }
  terms.update((all) => {
    const s = all[termId]
    if (!s) return all
    return { ...all, [termId]: { ...s, blocks: [] } }
  })
}


/* ------------------------------------------------------------------ *
 * Sesiones                                                           *
 * ------------------------------------------------------------------ */

export async function loadSessions(): Promise<void> {
  const r = await window.api.sessions.list()
  if (r.ok && r.data) sessions.update(() => r.data as StoredSession[])
}

function fromStored(s: StoredSession): ChatState {
  return {
    session: s,
    turns: (s.turns ?? []).map((t) => ({
      id: t.id,
      role: t.role,
      content: t.content,
      reasoning: t.reasoning,
      runId: t.runId,
      model: t.model,
      providerId: t.providerId,
      error: t.error,
      metrics: t.metrics,
      raw: t.raw,
      steps: t.steps,
      attachments: t.attachments,
      streaming: false
    }))
  }
}

/** Crea una sesión y la deja abierta. */
export async function newSession(kind: SessionKind, partial: Partial<StoredSession> = {}): Promise<string> {
  const now = Date.now()
  const session: StoredSession = {
    id: uid(),
    kind,
    title: partial.title ?? (kind === 'chat' ? 'Conversación nueva' : 'Sesión de agente'),
    createdAt: now,
    updatedAt: now,
    turns: [],
    temperature: 0.7,
    maxTokens: 4096,
    includeContext: true,
    ...partial
  }
  chats.update((all) => ({ ...all, [session.id]: { session, turns: [] } }))
  const r = await window.api.sessions.save(session)
  const saved = (r.ok && r.data ? r.data : session) as StoredSession
  sessions.update((list) => [saved, ...list.filter((s) => s.id !== saved.id)])
  return session.id
}

/**
 * Deja una sesión cargada en memoria. Si ya estaba —porque hay una ejecución
 * viva— no se toca: reabrirla no debe borrar lo que está llegando.
 */
export async function openSession(id: string): Promise<void> {
  if (chats.get()[id]) return
  const r = await window.api.sessions.get(id)
  if (r.ok && r.data) {
    const state = fromStored(r.data)
    chats.update((all) => ({ ...all, [id]: state }))
  }
}

export function patchSessionConfig(id: string, patch: Partial<StoredSession>): void {
  chats.update((all) => {
    const st = all[id]
    if (!st) return all
    return { ...all, [id]: { ...st, session: { ...st.session, ...patch } } }
  })
  sessions.update((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  schedulePersist(id)
}

export async function renameSession(id: string, title: string): Promise<void> {
  patchSessionConfig(id, { title })
}

/** Cerrar: se archiva y se descarga de memoria, pero no se pierde. */
export async function archiveSession(id: string): Promise<void> {
  flushPersist()
  await window.api.sessions.archive(id, true)
  chats.update((all) => {
    const next = { ...all }
    delete next[id]
    return next
  })
  sessions.update((list) => list.map((s) => (s.id === id ? { ...s, archived: true } : s)))
}

export async function unarchiveSession(id: string): Promise<void> {
  await window.api.sessions.archive(id, false)
  sessions.update((list) => list.map((s) => (s.id === id ? { ...s, archived: false } : s)))
}

export async function deleteSession(id: string): Promise<void> {
  const timer = saveTimers.get(id)
  if (timer) {
    window.clearTimeout(timer)
    saveTimers.delete(id)
  }
  await window.api.sessions.remove(id)
  chats.update((all) => {
    const next = { ...all }
    delete next[id]
    return next
  })
  sessions.update((list) => list.filter((s) => s.id !== id))
}

/** Título automático con las primeras palabras del primer prompt. */
function autoTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  return clean.length > 54 ? clean.slice(0, 52) + '…' : clean || 'Conversación nueva'
}

function metricsOf(run: RunRecord): TurnMetrics {
  return {
    promptTokens: run.promptTokens,
    completionTokens: run.completionTokens,
    totalTokens: run.totalTokens,
    cachedTokens: run.cachedTokens,
    reasoningTokens: run.reasoningTokens,
    ttftMs: run.ttftMs,
    totalMs: run.totalMs,
    tokensPerSec: run.tokensPerSec,
    costTotal: run.costTotal,
    costEstimated: run.costEstimated,
    status: run.status,
    // Lo que diga el propio agente manda: incluye la caché y el historial,
    // que es justo lo que ocupa sitio en la ventana.
    contextUsed: run.contextUsed ?? (run.promptTokens + run.completionTokens || undefined),
    contextLimit: run.contextLimit,
    usageLimit: run.usageLimit,
    filesChanged: run.filesChanged,
    filesTouched: run.filesTouched,
    effort: run.effort,
    branch: run.branch,
    cliLimit: run.cliLimit,
    permissionMode: run.permissionMode
  }
}

function finishTurn(sessionId: string, runId: string, run?: RunRecord): void {
  flushPendingText()
  chats.update((all) => {
    const st = all[sessionId]
    if (!st) return all
    const turns = st.turns.map((t) => {
      if (t.runId !== runId) return t
      const metrics = run ? metricsOf(run) : t.metrics
      // El registro manda, pero lo que se vio en vivo no se tira: un agente
      // que informe del contexto o de sus archivos y no los repita al final
      // seguiría teniendo el dato en pantalla.
      if (metrics) {
        if (metrics.contextUsed == null && t.live?.contextUsed != null) metrics.contextUsed = t.live.contextUsed
        if (metrics.contextLimit == null && t.live?.contextLimit != null) metrics.contextLimit = t.live.contextLimit
        if (!metrics.usageLimit && t.live?.usageLimit) metrics.usageLimit = t.live.usageLimit
        if (!metrics.filesChanged?.length && t.files?.length) metrics.filesChanged = t.files
        if (!metrics.filesTouched?.length && t.touched?.length) metrics.filesTouched = t.touched
        if (!metrics.cliLimit && t.live?.cliLimit) metrics.cliLimit = t.live.cliLimit
      }
      return {
        ...t,
        streaming: false,
        run,
        metrics,
        // Los pasos del registro mandan; si no los trae, se queda con los que
        // se vieron llegar en vivo.
        steps: run?.steps?.length ? run.steps : t.steps,
        content: run?.response || t.content,
        error: run?.status === 'error' ? run.error : undefined,
        files: metrics?.filesChanged ?? t.files,
        touched: metrics?.filesTouched ?? t.touched,
        live: undefined
      }
    })
    return { ...all, [sessionId]: { ...st, turns, runningRunId: undefined } }
  })
  schedulePersist(sessionId)
}

/**
 * Manda un prompt en una conversación. Devuelve la ejecución terminada.
 * El estado vive en el almacén, así que la página puede desmontarse mientras
 * el modelo sigue generando.
 */
export async function sendChat(
  sessionId: string,
  opts: {
    prompt: string
    providerId: string
    model: string
    systemPrompt?: string
    temperature?: number
    maxTokens?: number
    agentId?: string
    agentName?: string
    projectId?: string
    projectName?: string
    projectPath?: string
    effort?: Effort
    attachments?: Attachment[]
  }
): Promise<RunRecord | undefined> {
  const state = chats.get()[sessionId]
  if (!state || state.runningRunId) return undefined

  const runId = uid()
  const history: ChatMessage[] = state.turns
    .filter((t) => !t.error && t.content)
    .map((t) => ({ role: t.role, content: t.content }))

  const first = state.turns.length === 0
  chats.update((all) => {
    const st = all[sessionId]
    if (!st) return all
    return {
      ...all,
      [sessionId]: {
        ...st,
        session: first ? { ...st.session, title: autoTitle(opts.prompt) } : st.session,
        runningRunId: runId,
        turns: [
          ...st.turns,
          { id: uid(), role: 'user', content: opts.prompt, attachments: opts.attachments },
          {
            id: uid(),
            role: 'assistant',
            content: '',
            runId,
            streaming: true,
            model: opts.model,
            providerId: opts.providerId,
            live: { startedAt: Date.now(), chars: 0, approxTokens: 0 }
          }
        ]
      }
    }
  })
  if (first) sessions.update((list) => list.map((s) => (s.id === sessionId ? { ...s, title: autoTitle(opts.prompt) } : s)))
  ensureTicker()

  const res = await window.api.run.prompt(
    {
      providerId: opts.providerId,
      model: opts.model,
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      messages: [...history, { role: 'user', content: opts.prompt }],
      agentId: opts.agentId,
      agentName: opts.agentName,
      projectId: opts.projectId,
      projectName: opts.projectName,
      projectPath: opts.projectPath,
      effort: opts.effort,
      attachments: opts.attachments,
      conversationId: sessionId,
      kind: 'chat'
    },
    runId
  )

  finishTurn(sessionId, runId, res.data)
  return res.data
}

/** Lanza un agente de línea de comandos dentro de una sesión. */
export async function sendCli(
  sessionId: string,
  opts: {
    prompt: string
    agentId: string
    agentName?: string
    projectPath: string
    projectId?: string
    projectName?: string
    effort?: Effort
    attachments?: Attachment[]
    /** Modelo concreto, si el CLI deja elegirlo. */
    model?: string
    /** Hasta dónde puede llegar sin preguntar. */
    permissionMode?: string
  }
): Promise<RunRecord | undefined> {
  const state = chats.get()[sessionId]
  if (!state || state.runningRunId) return undefined

  const runId = uid()
  const first = state.turns.length === 0
  chats.update((all) => {
    const st = all[sessionId]
    if (!st) return all
    return {
      ...all,
      [sessionId]: {
        ...st,
        session: first ? { ...st.session, title: autoTitle(opts.prompt) } : st.session,
        runningRunId: runId,
        turns: [
          ...st.turns,
          { id: uid(), role: 'user', content: opts.prompt, attachments: opts.attachments },
          {
            id: uid(),
            role: 'assistant',
            content: '',
            runId,
            streaming: true,
            model: opts.agentName ?? 'CLI',
            live: { startedAt: Date.now(), chars: 0, approxTokens: 0 }
          }
        ]
      }
    }
  })
  if (first) sessions.update((list) => list.map((s) => (s.id === sessionId ? { ...s, title: autoTitle(opts.prompt) } : s)))
  ensureTicker()

  const res = await window.api.cli.run(
    {
      agentId: opts.agentId,
      projectPath: opts.projectPath,
      prompt: opts.prompt,
      projectId: opts.projectId,
      projectName: opts.projectName,
      effort: opts.effort,
      attachments: opts.attachments,
      model: opts.model,
      permissionMode: opts.permissionMode,
      conversationId: sessionId,
      kind: 'cli'
    },
    runId
  )

  finishTurn(sessionId, runId, res.data)
  return res.data
}

export function stopSession(sessionId: string): void {
  const st = chats.get()[sessionId]
  if (!st?.runningRunId) return
  const runId = st.runningRunId
  if (st.session.kind === 'cli') void window.api.cli.kill(runId)
  else void window.api.run.abort(runId)
}

/* ------------------------------------------------------------------ *
 * Arena                                                              *
 * ------------------------------------------------------------------ */

export function setArena(patch: Partial<ArenaState>): void {
  arena.update((a) => ({ ...a, ...patch }))
}

export function setContenders(fn: (cs: Contender[]) => Contender[]): void {
  arena.update((a) => ({ ...a, contenders: fn(a.contenders) }))
}

export function emptyContender(mode: 'api' | 'cli' = 'api'): Contender {
  return { key: uid(), mode, content: '', streaming: false }
}

/**
 * Lanza la comparativa. Los contendientes pueden ser modelos por API o
 * agentes de línea de comandos: cada uno sale por su canal pero comparten
 * arenaId, así que las métricas se comparan en la misma tabla.
 */
export async function launchArena(): Promise<void> {
  const state = arena.get()
  const ready = state.contenders.filter((c) => (c.mode === 'api' ? c.providerId && c.model : c.cliAgentId))
  if (!state.prompt.trim() || !ready.length || state.running) return

  const arenaId = uid()
  const withIds = state.contenders.map((c) => {
    const usable = c.mode === 'api' ? c.providerId && c.model : c.cliAgentId
    if (!usable) return c
    return {
      ...c,
      runId: uid(),
      content: '',
      run: undefined,
      error: undefined,
      streaming: true,
      live: { startedAt: Date.now(), chars: 0, approxTokens: 0 }
    }
  })
  arena.update((a) => ({ ...a, arenaId, running: true, contenders: withIds }))
  ensureTicker()

  const settle = (runId: string, run?: RunRecord): void => {
    arena.update((a) => ({
      ...a,
      contenders: a.contenders.map((x) =>
        x.runId === runId
          ? {
              ...x,
              streaming: false,
              run,
              content: run?.response || x.content,
              error: run?.status === 'error' ? run.error : undefined,
              live: undefined
            }
          : x
      )
    }))
  }

  const launched = withIds.filter((c) => c.runId && c.streaming)

  await Promise.all(
    launched.map(async (c) => {
      if (!c.runId) return
      if (c.mode === 'api' && c.providerId && c.model) {
        const res = await window.api.run.prompt(
          {
            providerId: c.providerId,
            model: c.model,
            prompt: state.prompt.trim(),
            systemPrompt: state.system || undefined,
            temperature: 0.7,
            maxTokens: 4096,
            arenaId,
            kind: 'arena'
          },
          c.runId
        )
        settle(c.runId, res.data)
      } else if (c.mode === 'cli' && c.cliAgentId) {
        // Al CLI se le pasa el prompt de sistema por delante: no tiene un
        // canal aparte para instrucciones permanentes.
        const prompt = state.system
          ? `${state.system}\n\n---\n\n${state.prompt.trim()}`
          : state.prompt.trim()
        const res = await window.api.cli.run(
          {
            agentId: c.cliAgentId,
            projectPath: c.projectPath ?? '',
            prompt,
            arenaId,
            kind: 'arena'
          },
          c.runId
        )
        settle(c.runId, res.data)
      }
    })
  )

  arena.update((a) => ({ ...a, running: false }))
  const ids = launched.map((c) => c.runId!).filter(Boolean)
  if (ids.length) void window.api.notify.arena(ids)
}

export function stopArena(): void {
  for (const c of arena.get().contenders) {
    if (!c.runId || !c.streaming) continue
    if (c.mode === 'cli') void window.api.cli.kill(c.runId)
    else void window.api.run.abort(c.runId)
  }
}

/* ------------------------------------------------------------------ *
 * Enganche con React                                                 *
 * ------------------------------------------------------------------ */

export function EngineProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    wire()
    void loadSessions()
    // Al cerrar la ventana se vuelca lo que quede pendiente de guardar.
    const onUnload = (): void => flushPersist()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // No hay contexto que repartir: el motor vive en módulos y se lee con los
  // hooks de más abajo. Este componente sólo existe para arrancarlo una vez y
  // para volcar lo pendiente al cerrar.
  return <>{children}</>
}

export function useSessions(): StoredSession[] {
  return useSlice(sessions)
}

export function useChat(sessionId: string | null): ChatState | undefined {
  const all = useSlice(chats)
  return sessionId ? all[sessionId] : undefined
}

export function useOpenChats(): Record<string, ChatState> {
  return useSlice(chats)
}

export function useTerms(): Record<string, TermState> {
  return useSlice(terms)
}

export function useTerm(termId: string | null): TermState | undefined {
  const all = useSlice(terms)
  return termId ? all[termId] : undefined
}

export function useArena(): ArenaState {
  return useSlice(arena)
}

/** Se repinta cada 250 ms mientras algo corre: para los contadores en vivo. */
export function useTick(): number {
  return useSlice(ticker)
}

/* ------------------------------------------------------------------ *
 * Acceso para pruebas y depuración                                   *
 * ------------------------------------------------------------------ */

/**
 * El motor queda accesible en window.__accEngine. No añade ninguna capacidad
 * —el renderer ya tiene window.api entero— pero permite conducir la app desde
 * los scripts de prueba y hurgar en el estado desde las herramientas de
 * desarrollo sin tener que instrumentar los componentes.
 */
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__accEngine = {
    newSession, openSession, archiveSession, unarchiveSession, deleteSession,
    patchSessionConfig, renameSession, sendChat, sendCli, stopSession,
    flushPersist, loadSessions,
    openTerm, sendTermCommand, writeTerm, closeTerm, interruptTerm, clearTerm,
    resizeTerm, termScrollback, onTermData,
    launchArena, stopArena, setArena, setContenders, emptyContender,
    peekChat: (id: string) => chats.get()[id],
    peekTerm: (id: string) => terms.get()[id],
    peekTerms: () => terms.get(),
    peekArena: () => arena.get(),
    peekSessions: () => sessions.get()
  }
}

/**
 * Sube cada vez que termina una ejecución. Quien lo lea vuelve a pedir sus
 * datos y deja de enseñar números de hace un rato.
 */
export function useRunsVersion(): number {
  return useSlice(runsVersion)
}

/** Cuántas cosas hay corriendo ahora mismo, para el indicador global. */
export function useBusyCount(): { chats: number; arena: number; terms: number } {
  const c = useSlice(chats)
  const a = useSlice(arena)
  const t = useSlice(terms)
  return {
    chats: Object.values(c).filter((x) => x.runningRunId).length,
    arena: a.running ? a.contenders.filter((x) => x.streaming).length : 0,
    terms: Object.values(t).filter((x) => x.busy).length
  }
}
