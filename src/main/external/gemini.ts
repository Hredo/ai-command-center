/**
 * Gemini CLI: lo que guarda en `~/.gemini/tmp/<proyecto>/chats/`.
 *
 * Hasta la 0.38 cada sesión era un `session-*.json` con todos sus mensajes;
 * desde la 0.39 es un `session-*.jsonl` que crece por el final. Se leen los
 * dos. Cada mensaje del modelo (`type: "gemini"`) es una petición a la API y
 * trae sus tokens: es lo que cuenta en el tope diario de peticiones del plan
 * de Google, que Gemini CLI no publica por fichero pero sí Google en su
 * documentación.
 *
 * La carpeta del proyecto es el SHA-256 de su ruta (o un nombre con un
 * `.project_root` dentro, en las versiones nuevas): con eso se sabe a qué
 * proyecto tuyo pertenece cada sesión.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from '../config'
import { computeCost, priceFor } from '../providers/models'
import { todosFrom } from '../agents/cli'
import { addBucket, EXTERNAL_DAYS, home, sumBuckets, type ExternalSession, type HourBucket } from './common'

export function geminiRoot(): string {
  const base = process.env['GEMINI_CLI_HOME'] ?? home('.gemini')
  return join(base, 'tmp')
}

interface FileState {
  size: number
  mtimeMs: number
  session: ExternalSession
  turns: { role: 'user' | 'assistant'; content: string }[]
  /** Carpeta de Gemini de la que sale, para resolver el proyecto más tarde. */
  dir: string
  dirName: string
}

const files = new Map<string, FileState>()

/** De la carpeta de Gemini a la ruta del proyecto. */
function cwdOf(dir: string, name: string): string | undefined {
  const marker = join(dir, '.project_root')
  if (existsSync(marker)) {
    try {
      return readFileSync(marker, 'utf8').trim() || undefined
    } catch {
      /* sin permiso */
    }
  }
  for (const p of getConfig().projects) {
    if (createHash('sha256').update(p.path).digest('hex') === name) return p.path
  }
  return undefined
}

function empty(id: string, cwd?: string): ExternalSession {
  return {
    tool: 'gemini',
    id,
    cwd,
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

/** Un mensaje, venga suelto (jsonl) o dentro de `messages` (json). */
function eatMessage(m: any, st: FileState): void {
  if (!m || typeof m !== 'object') return
  if (m.sessionId && typeof m.sessionId === 'string') st.session.id = m.sessionId
  const msg = m.type === 'message' && m.data ? m.data : m
  const at = Date.parse(msg.timestamp ?? '') || 0
  const s = st.session
  if (at) {
    if (!s.startedAt || at < s.startedAt) s.startedAt = at
    if (at > s.endedAt) s.endedAt = at
  }
  const text =
    typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text ?? '').join('')
        : ''
  if (msg.type === 'user') {
    if (text.trim()) {
      if (!s.firstPrompt) s.firstPrompt = text.replace(/\s+/g, ' ').trim().slice(0, 300)
      st.turns.push({ role: 'user', content: text })
    }
    return
  }
  if (msg.type !== 'gemini' && msg.type !== 'model') return
  if (text.trim()) st.turns.push({ role: 'assistant', content: text })
  if (msg.model) s.model = String(msg.model)
  for (const call of Array.isArray(msg.toolCalls) ? msg.toolCalls : []) {
    const name = String(call?.name ?? '')
    const args = call?.args ?? call?.input
    const file = args?.file_path ?? args?.absolute_path ?? args?.path
    if (typeof file === 'string' && /write|replace|edit/.test(name) && !s.files.includes(file)) s.files.push(file)
    const todos = todosFrom(name, args)
    if (todos) s.todos = todos
  }
  const t = msg.tokens
  if (!t) return
  s.requests++
  const input = Number(t.input ?? t.prompt ?? 0)
  const output = Number(t.output ?? t.candidates ?? 0)
  const cached = Number(t.cached ?? 0)
  const thoughts = Number(t.thoughts ?? 0)
  s.inTok += input
  s.outTok += output + thoughts
  s.cacheRead += cached
  s.reasoning += thoughts
  const model = s.model ?? 'gemini-2.5-pro'
  const cost =
    priceFor('google', model).source !== 'none' ? computeCost('google', model, input, output + thoughts, cached).costTotal : 0
  s.cost += cost
  addBucket(s.buckets, at, { tok: input - cached + output + thoughts, cost, req: 1 })
}

function parseWhole(path: string, st: FileState): void {
  let raw: any
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return
  }
  if (raw?.sessionId) st.session.id = String(raw.sessionId)
  for (const m of Array.isArray(raw?.messages) ? raw.messages : []) eatMessage(m, st)
}

function parseLines(path: string, from: number, st: FileState): void {
  let text: string
  try {
    const buf = readFileSync(path)
    text = buf.subarray(from).toString('utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      eatMessage(JSON.parse(line), st)
    } catch {
      /* línea a medias: la próxima pasada la verá entera */
    }
  }
}

export function scanGemini(): number {
  const root = geminiRoot()
  if (!existsSync(root)) return 0
  const cutoff = Date.now() - EXTERNAL_DAYS * 86_400_000
  let changed = 0
  let dirs: string[]
  try {
    dirs = readdirSync(root)
  } catch {
    return 0
  }
  for (const name of dirs) {
    const dir = join(root, name)
    const chats = join(dir, 'chats')
    if (!existsSync(chats)) continue
    let entries: string[]
    try {
      entries = readdirSync(chats)
    } catch {
      continue
    }
    let cwd: string | undefined
    let cwdKnown = false
    for (const f of entries) {
      if (!f.endsWith('.json') && !f.endsWith('.jsonl')) continue
      const path = join(chats, f)
      let st
      try {
        st = statSync(path)
      } catch {
        continue
      }
      if (st.mtimeMs < cutoff) continue
      const prev = files.get(path)
      if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue
      if (!cwdKnown) {
        cwd = cwdOf(dir, name)
        cwdKnown = true
      }
      const id = f.replace(/\.jsonl?$/, '')
      if (f.endsWith('.jsonl') && prev && st.size >= prev.size) {
        parseLines(path, prev.size, prev)
        prev.size = st.size
        prev.mtimeMs = st.mtimeMs
      } else {
        const fresh: FileState = {
          size: st.size,
          mtimeMs: st.mtimeMs,
          session: empty(id, cwd),
          turns: [],
          dir,
          dirName: name
        }
        if (f.endsWith('.jsonl')) parseLines(path, 0, fresh)
        else parseWhole(path, fresh)
        files.set(path, fresh)
      }
      changed++
    }
  }
  return changed
}

export function geminiSessions(): ExternalSession[] {
  const out: ExternalSession[] = []
  for (const f of files.values()) {
    // El proyecto puede haberse dado de alta después de leer la sesión.
    if (!f.session.cwd) f.session.cwd = cwdOf(f.dir, f.dirName)
    if (f.session.requests > 0 && f.session.startedAt > 0) out.push(f.session)
  }
  return out
}

/** Peticiones y gasto de Gemini CLI desde un instante, de todas las sesiones. */
export function geminiSince(since: number): HourBucket {
  const out = { tok: 0, cost: 0, req: 0 }
  for (const f of files.values()) {
    const b = sumBuckets(f.session.buckets, since)
    out.tok += b.tok
    out.cost += b.cost
    out.req += b.req
  }
  return out
}

export function geminiTranscript(
  sessionId: string
): { turns: { role: 'user' | 'assistant'; content: string }[]; session?: ExternalSession } | null {
  for (const f of files.values()) if (f.session.id === sessionId) return { turns: f.turns, session: f.session }
  return null
}
