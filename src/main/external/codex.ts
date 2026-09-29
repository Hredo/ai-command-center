/**
 * OpenAI Codex: lo que deja en `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl`.
 *
 * Una línea por evento. Lo que se usa:
 *
 *  - `session_meta`: id de la sesión, carpeta y rama.
 *  - `turn_context`: el modelo.
 *  - `event_msg` con `user_message` y `agent_message`: la conversación, para
 *    el relevo.
 *  - `event_msg` con `token_count`: los tokens (acumulados en la sesión y los
 *    de la última petición) y, sobre todo, `rate_limits`: el porcentaje usado
 *    de cada ventana del plan de ChatGPT tal como lo dice el servidor. Ese es
 *    el dato oficial de cuánto te queda.
 *
 * Los ficheros crecen por el final: se leen una vez y después sólo lo nuevo.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { computeCost, priceFor } from '../providers/models'
import { todosFrom } from '../agents/cli'
import { addBucket, EXTERNAL_DAYS, home, type ExternalSession } from './common'

/** Una ventana del plan según Codex. No trae nombre: sólo su duración. */
export interface CodexWindow {
  usedPercent: number
  windowMinutes?: number
  resetsAt?: number
}

export interface CodexLimits {
  at: number
  primary?: CodexWindow
  secondary?: CodexWindow
  plan?: string
}

interface FileState {
  size: number
  mtimeMs: number
  session: ExternalSession
  /** Tokens acumulados de la sesión según el último token_count. */
  lastTotal?: { input: number; cached: number; output: number; reasoning: number }
  limits?: CodexLimits
}

export function codexRoot(): string {
  return process.env['CODEX_HOME'] ? join(process.env['CODEX_HOME'], 'sessions') : home('.codex', 'sessions')
}

const files = new Map<string, FileState>()

/** Rollouts de los últimos días, recorriendo AAAA/MM/DD. */
function recentRollouts(): { path: string; size: number; mtimeMs: number }[] {
  const root = codexRoot()
  if (!existsSync(root)) return []
  const cutoff = Date.now() - EXTERNAL_DAYS * 86_400_000
  const out: { path: string; size: number; mtimeMs: number }[] = []
  const walk = (dir: string, depth: number): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth < 4) walk(full, depth + 1)
      } else if (name.startsWith('rollout-') && name.endsWith('.jsonl') && st.mtimeMs >= cutoff) {
        out.push({ path: full, size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  walk(root, 0)
  return out
}

function idFromName(path: string): string {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path)
  return m ? m[1] : path.split(/[\\/]/).pop()!.replace(/\.jsonl$/, '')
}

function emptySession(path: string): ExternalSession {
  return {
    tool: 'codex',
    id: idFromName(path),
    startedAt: 0,
    endedAt: 0,
    requests: 0,
    inTok: 0,
    outTok: 0,
    cacheRead: 0,
    reasoning: 0,
    cost: 0,
    costEstimated: true,
    files: [],
    buckets: {}
  }
}

/** Una ventana de rate_limits, con su reinicio en milisegundos absolutos. */
function windowOf(w: any, at: number): CodexWindow | undefined {
  if (!w || typeof w.used_percent !== 'number') return undefined
  let resetsAt: number | undefined
  if (typeof w.resets_at === 'number') resetsAt = w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000
  else if (typeof w.resets_at === 'string') resetsAt = Date.parse(w.resets_at) || undefined
  else if (typeof w.resets_in_seconds === 'number') resetsAt = at + w.resets_in_seconds * 1000
  return {
    usedPercent: Math.max(0, Math.min(100, w.used_percent)),
    windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : undefined,
    resetsAt
  }
}

function eat(line: string, st: FileState): void {
  if (line.length < 10) return
  let evt: any
  try {
    evt = JSON.parse(line)
  } catch {
    return
  }
  const at = Date.parse(evt.timestamp ?? '') || 0
  const s = st.session
  if (at) {
    if (!s.startedAt || at < s.startedAt) s.startedAt = at
    if (at > s.endedAt) s.endedAt = at
  }
  const p = evt.payload ?? {}
  if (evt.type === 'session_meta') {
    if (p.id) s.id = String(p.id)
    if (p.cwd) s.cwd = String(p.cwd)
    return
  }
  if (evt.type === 'turn_context') {
    if (p.model) s.model = String(p.model)
    if (p.cwd && !s.cwd) s.cwd = String(p.cwd)
    return
  }
  if (evt.type === 'response_item') {
    // Cambios de archivos: apply_patch lleva las rutas en su propio texto.
    const input = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : ''
    if ((p.name === 'apply_patch' || /apply_patch/.test(input)) && input) {
      for (const m of input.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)) {
        const f = m[1].trim()
        if (!s.files.includes(f) && s.files.length < 60) s.files.push(f)
      }
    }
    if (p.name === 'update_plan' || p.name === 'todo_write') {
      try {
        const args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments
        const plan = Array.isArray(args?.plan)
          ? { todos: args.plan.map((x: any) => ({ content: x.step, status: x.status })) }
          : args
        const todos = todosFrom('todowrite', plan)
        if (todos) s.todos = todos
      } catch {
        /* argumentos a medias */
      }
    }
    return
  }
  if (evt.type !== 'event_msg') return
  if (p.type === 'user_message' && typeof p.message === 'string') {
    if (!s.firstPrompt && p.message.trim()) s.firstPrompt = p.message.replace(/\s+/g, ' ').trim().slice(0, 300)
    return
  }
  if (p.type === 'token_count') {
    const total = p.info?.total_token_usage
    const last = p.info?.last_token_usage
    if (total) {
      const t = {
        input: total.input_tokens ?? 0,
        cached: total.cached_input_tokens ?? 0,
        output: total.output_tokens ?? 0,
        reasoning: total.reasoning_output_tokens ?? 0
      }
      st.lastTotal = t
      s.inTok = t.input
      s.cacheRead = t.cached
      s.outTok = t.output
      s.reasoning = t.reasoning
    }
    if (last) {
      s.requests++
      const model = s.model ?? 'gpt-5-codex'
      const known = priceFor('openai', model).source !== 'none'
      const cost = known
        ? computeCost('openai', model, last.input_tokens ?? 0, last.output_tokens ?? 0, last.cached_input_tokens ?? 0).costTotal
        : 0
      addBucket(s.buckets, at, {
        tok: (last.input_tokens ?? 0) - (last.cached_input_tokens ?? 0) + (last.output_tokens ?? 0),
        cost,
        req: 1
      })
    }
    const rl = p.rate_limits ?? evt.rate_limits
    if (rl && (rl.primary || rl.secondary)) {
      st.limits = {
        at: at || Date.now(),
        primary: windowOf(rl.primary, at || Date.now()),
        secondary: windowOf(rl.secondary, at || Date.now()),
        plan: typeof rl.plan_type === 'string' ? rl.plan_type : undefined
      }
    }
  }
}

function readFrom(path: string, from: number, st: FileState): Promise<void> {
  return new Promise((resolve) => {
    const stream = createReadStream(path, { encoding: 'utf8', start: from })
    let buf = ''
    stream.on('data', (chunk: string | Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        eat(buf.slice(0, nl), st)
        buf = buf.slice(nl + 1)
      }
    })
    stream.on('error', () => resolve())
    stream.on('end', () => {
      if (buf.trim()) eat(buf, st)
      resolve()
    })
  })
}

/** Lee lo nuevo. Devuelve cuántos ficheros cambiaron. */
export async function scanCodex(): Promise<number> {
  let changed = 0
  for (const f of recentRollouts()) {
    const prev = files.get(f.path)
    if (prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs) continue
    // Si encogió (reescrito), se lee entero otra vez.
    const st: FileState =
      prev && f.size >= prev.size ? prev : { size: 0, mtimeMs: 0, session: emptySession(f.path) }
    await readFrom(f.path, st.size, st)
    st.size = f.size
    st.mtimeMs = f.mtimeMs
    // El coste de la sesión, con los tokens acumulados y el catálogo.
    const s = st.session
    const model = s.model ?? 'gpt-5-codex'
    s.cost =
      priceFor('openai', model).source !== 'none'
        ? computeCost('openai', model, s.inTok, s.outTok, s.cacheRead).costTotal
        : 0
    files.set(f.path, st)
    changed++
  }
  return changed
}

export function codexSessions(): ExternalSession[] {
  return [...files.values()].map((f) => f.session).filter((s) => s.startedAt > 0 && (s.requests > 0 || s.firstPrompt))
}

/** Lo último que dijo el servidor de OpenAI sobre las ventanas del plan. */
export function codexLimits(): CodexLimits | null {
  let best: CodexLimits | null = null
  for (const f of files.values()) if (f.limits && (!best || f.limits.at > best.at)) best = f.limits
  return best
}

export function codexFileOf(sessionId: string): string | undefined {
  for (const [path, st] of files) if (st.session.id === sessionId) return path
  return undefined
}

/** La conversación entera de una sesión, para el relevo. */
export async function codexTranscript(
  sessionId: string
): Promise<{ turns: { role: 'user' | 'assistant'; content: string }[]; session?: ExternalSession } | null> {
  const path = codexFileOf(sessionId)
  if (!path) return null
  const turns: { role: 'user' | 'assistant'; content: string }[] = []
  await new Promise<void>((resolve) => {
    const stream = createReadStream(path, { encoding: 'utf8' })
    let buf = ''
    const one = (line: string): void => {
      if (!line.includes('"event_msg"')) return
      try {
        const p = JSON.parse(line).payload ?? {}
        if (p.type === 'user_message' && typeof p.message === 'string' && p.message.trim()) {
          turns.push({ role: 'user', content: p.message })
        } else if (p.type === 'agent_message' && typeof p.message === 'string' && p.message.trim()) {
          turns.push({ role: 'assistant', content: p.message })
        }
      } catch {
        /* línea a medias */
      }
    }
    stream.on('data', (c: string | Buffer) => {
      buf += c.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        one(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    stream.on('error', () => resolve())
    stream.on('end', () => {
      if (buf.trim()) one(buf)
      resolve()
    })
  })
  return { turns, session: files.get(path)?.session }
}

/** Estado de lectura, para guardarlo al lado de la configuración. */
export function exportCodexState(): Record<string, FileState> {
  return Object.fromEntries(files)
}

/** Recupera lo leído en la sesión anterior: sólo se leerá lo que haya crecido. */
export function importCodexState(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const cutoff = Date.now() - EXTERNAL_DAYS * 86_400_000
  for (const [path, st] of Object.entries(raw as Record<string, FileState>)) {
    if (!st?.session || typeof st.size !== 'number' || st.mtimeMs < cutoff) continue
    if (!existsSync(path)) continue
    files.set(path, st)
  }
}
