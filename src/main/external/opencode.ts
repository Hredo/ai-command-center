/**
 * OpenCode: lo que guarda en su base de datos (`~/.local/share/opencode/
 * opencode.db`, SQLite).
 *
 * Se abre **sólo para leer** y se consulta únicamente `session`, `message`,
 * `part` y `todo`. Esa base de datos tiene también tablas con las cuentas y
 * credenciales de OpenCode: ninguna consulta de aquí las toca, ni las tocará.
 *
 * `node:sqlite` viene dentro de Node (Electron 44 lleva Node 24): no hace falta
 * ningún módulo nativo, que es la razón por la que el histórico propio de la
 * app es JSONL. Si una versión futura de OpenCode cambia el esquema, las
 * consultas fallan, se registra y la app sigue sin estos datos.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { addBucket, EXTERNAL_DAYS, home, sumBuckets, type ExternalSession, type HourBucket } from './common'
import type { AgentTodo } from '@shared/types'

type Db = {
  prepare: (sql: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown }
  close: () => void
}

export function opencodeDbPath(): string {
  const base = process.env['XDG_DATA_HOME'] ? join(process.env['XDG_DATA_HOME'], 'opencode') : home('.local', 'share', 'opencode')
  return join(base, 'opencode.db')
}

function open(): Db | null {
  const path = opencodeDbPath()
  if (!existsSync(path)) return null
  try {
    // require en tiempo de ejecución: así un Electron sin sqlite no rompe el arranque.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string, o: object) => Db }
    return new DatabaseSync(path, { readOnly: true })
  } catch (err) {
    console.error('[opencode] no se pudo abrir su base de datos:', (err as Error).message)
    return null
  }
}

/** Lo que cambió desde la última lectura: el fichero y su diario (WAL). */
let lastStamp = ''
function stamp(): string {
  const path = opencodeDbPath()
  const parts: string[] = []
  for (const p of [path, path + '-wal']) {
    try {
      const st = statSync(p)
      parts.push(`${st.size}:${st.mtimeMs}`)
    } catch {
      parts.push('-')
    }
  }
  return parts.join('|')
}

let sessions: ExternalSession[] = []
const firstPrompts = new Map<string, string | undefined>()
/** Gasto por hora del plan Go (proveedor opencode-go), para sus topes. */
let goBuckets: Record<string, HourBucket> = {}

function parseModel(raw: unknown): { id?: string; provider?: string } {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const m = JSON.parse(raw)
    return { id: m?.id ?? m?.modelID, provider: m?.providerID }
  } catch {
    return { id: raw }
  }
}

/** Relee si la base de datos cambió. Devuelve si hubo cambios. */
export function scanOpencode(): boolean {
  const now = stamp()
  if (now === lastStamp) return false
  const db = open()
  if (!db) {
    lastStamp = now
    return false
  }
  try {
    const since = Date.now() - EXTERNAL_DAYS * 86_400_000
    const rows = db
      .prepare(
        `select id, directory, title, model, cost, tokens_input, tokens_output, tokens_reasoning,
                tokens_cache_read, time_created, time_updated, parent_id
           from session where time_updated >= ? order by time_updated desc`
      )
      .all(since) as any[]

    // Por mensaje del asistente: peticiones, tokens y coste por hora.
    const msgs = db
      .prepare(
        `select session_id s, time_created t,
                json_extract(data, '$.providerID') p, json_extract(data, '$.modelID') m,
                json_extract(data, '$.cost') c, json_extract(data, '$.tokens.input') i,
                json_extract(data, '$.tokens.output') o
           from message
          where time_created >= ? and json_extract(data, '$.role') = 'assistant'`
      )
      .all(since) as any[]

    const per = new Map<string, { req: number; buckets: Record<string, HourBucket>; provider?: string; model?: string }>()
    const go: Record<string, HourBucket> = {}
    for (const m of msgs) {
      const e = per.get(m.s) ?? { req: 0, buckets: {} }
      e.req++
      if (m.p) e.provider = String(m.p)
      if (m.m) e.model = String(m.m)
      const tok = (Number(m.i) || 0) + (Number(m.o) || 0)
      addBucket(e.buckets, Number(m.t), { tok, cost: Number(m.c) || 0, req: 1 })
      per.set(m.s, e)
      if (m.p === 'opencode-go') addBucket(go, Number(m.t), { tok, cost: Number(m.c) || 0, req: 1 })
    }
    goBuckets = go

    // La primera petición de cada sesión, para el título del histórico. No
    // cambia nunca: se consulta una vez por sesión.
    const firstPrompt = (id: string): string | undefined => {
      if (firstPrompts.has(id)) return firstPrompts.get(id)
      const r = db
        .prepare(
          `select json_extract(p.data, '$.text') t from part p
             join message m on m.id = p.message_id
            where p.session_id = ? and json_extract(m.data, '$.role') = 'user'
              and json_extract(p.data, '$.type') = 'text'
            order by p.time_created asc limit 1`
        )
        .get(id) as { t?: string } | undefined
      const text = r?.t ? String(r.t).replace(/\s+/g, ' ').trim().slice(0, 300) : undefined
      firstPrompts.set(id, text)
      return text
    }

    sessions = rows
      // Las subtareas cuelgan de su sesión madre: se cuentan en ella.
      .filter((r) => !r.parent_id)
      .map((r) => {
        const model = parseModel(r.model)
        const e = per.get(r.id)
        return {
          tool: 'opencode' as const,
          id: String(r.id),
          cwd: r.directory ? String(r.directory) : undefined,
          model: e?.model ?? model.id,
          provider: e?.provider ?? model.provider,
          title: r.title ? String(r.title) : undefined,
          firstPrompt: firstPrompt(String(r.id)),
          startedAt: Number(r.time_created) || 0,
          endedAt: Number(r.time_updated) || 0,
          requests: e?.req ?? 0,
          inTok: Number(r.tokens_input) || 0,
          outTok: Number(r.tokens_output) || 0,
          cacheRead: Number(r.tokens_cache_read) || 0,
          reasoning: Number(r.tokens_reasoning) || 0,
          // El coste lo calcula OpenCode con los precios de models.dev.
          cost: Number(r.cost) || 0,
          costEstimated: false,
          files: [],
          buckets: e?.buckets ?? {}
        }
      })
      .filter((s) => s.requests > 0)
    lastStamp = now
    return true
  } catch (err) {
    console.error('[opencode] esquema inesperado, se ignoran sus datos:', (err as Error).message)
    lastStamp = now
    return false
  } finally {
    db.close()
  }
}

export function opencodeSessions(): ExternalSession[] {
  return sessions
}

/** Lo gastado con el plan Go desde un instante, valorado como lo valora OpenCode. */
export function opencodeGoSince(since: number): HourBucket {
  return sumBuckets(goBuckets, since)
}

/** La conversación de una sesión y su lista de tareas, para el relevo. */
export function opencodeTranscript(
  sessionId: string
): { turns: { role: 'user' | 'assistant'; content: string }[]; todos: AgentTodo[]; session?: ExternalSession } | null {
  const db = open()
  if (!db) return null
  try {
    const parts = db
      .prepare(
        `select json_extract(m.data, '$.role') r, json_extract(p.data, '$.text') t
           from part p join message m on m.id = p.message_id
          where p.session_id = ? and json_extract(p.data, '$.type') = 'text'
          order by p.time_created asc`
      )
      .all(sessionId) as { r: string; t: string }[]
    const turns: { role: 'user' | 'assistant'; content: string }[] = []
    for (const p of parts) {
      if (!p.t?.trim()) continue
      const role = p.r === 'user' ? 'user' : 'assistant'
      const last = turns[turns.length - 1]
      // Varios trozos seguidos del mismo turno se juntan.
      if (last && last.role === role) last.content += '\n' + p.t
      else turns.push({ role, content: String(p.t) })
    }
    const todos = (
      db.prepare('select content, status from todo where session_id = ? order by position').all(sessionId) as {
        content: string
        status: string
      }[]
    ).map((t) => ({ text: String(t.content), done: t.status === 'completed', active: t.status === 'in_progress' }))
    return { turns, todos, session: sessions.find((s) => s.id === sessionId) }
  } catch (err) {
    console.error('[opencode] no se pudo leer la sesión:', (err as Error).message)
    return null
  } finally {
    db.close()
  }
}
