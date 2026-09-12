/**
 * Sesiones: conversaciones y ejecuciones de agentes que sobreviven al cierre
 * de la app. Se pueden archivar (cerrar sin perder) y borrar del todo.
 *
 * Fichero único en JSON con escritura atómica. Aquí no hay métricas: el
 * detalle de cada ejecución vive en runs.jsonl y se referencia por runId.
 * Lo que se guarda es la conversación y los ajustes con los que retomarla.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { paths } from './paths'
import type { StoredSession } from '@shared/types'

/** Tope de sesiones guardadas: las más viejas se descartan al pasarlo. */
const MAX_SESSIONS = 400
/** Tope de turnos por sesión, para que un fichero no crezca sin control. */
const MAX_TURNS = 400

let cache: StoredSession[] | null = null

function load(): StoredSession[] {
  if (cache) return cache
  if (!existsSync(paths.sessions)) {
    cache = []
    return cache
  }
  try {
    const parsed = JSON.parse(readFileSync(paths.sessions, 'utf8'))
    cache = Array.isArray(parsed) ? (parsed as StoredSession[]) : []
  } catch (err) {
    console.error('sessions.json ilegible, se empieza de cero:', err)
    cache = []
  }
  return cache
}

function persist(rows: StoredSession[]): void {
  const trimmed = rows
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
  cache = trimmed
  // Escritura atómica: un corte de corriente no deja el fichero a medias.
  const tmp = paths.sessions + '.tmp'
  writeFileSync(tmp, JSON.stringify(trimmed), 'utf8')
  renameSync(tmp, paths.sessions)
}

export function listSessions(): StoredSession[] {
  return load()
    .slice()
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
}

export function getSession(id: string): StoredSession | undefined {
  return load().find((s) => s.id === id)
}

/** Crea o reemplaza una sesión. Devuelve la versión guardada. */
export function saveSession(session: StoredSession): StoredSession {
  const rows = load()
  const clean: StoredSession = {
    ...session,
    title: (session.title || 'Sin título').slice(0, 160),
    turns: (session.turns ?? []).slice(-MAX_TURNS),
    updatedAt: Date.now()
  }
  const i = rows.findIndex((s) => s.id === clean.id)
  if (i === -1) rows.push(clean)
  else rows[i] = clean
  persist(rows)
  return clean
}

/** Modificación parcial: no hace falta reenviar toda la conversación. */
export function patchSession(id: string, patch: Partial<StoredSession>): StoredSession | undefined {
  const rows = load()
  const i = rows.findIndex((s) => s.id === id)
  if (i === -1) return undefined
  rows[i] = { ...rows[i], ...patch, id, updatedAt: Date.now() }
  persist(rows)
  return rows[i]
}

export function removeSession(id: string): boolean {
  const rows = load()
  const next = rows.filter((s) => s.id !== id)
  if (next.length === rows.length) return false
  persist(next)
  return true
}

/** Cerrar una sesión: sigue guardada y se puede reabrir. */
export function archiveSession(id: string, archived = true): StoredSession | undefined {
  return patchSession(id, { archived })
}

/** Borra todas las archivadas. Devuelve cuántas se fueron. */
export function clearArchived(): number {
  const rows = load()
  const next = rows.filter((s) => !s.archived)
  const gone = rows.length - next.length
  if (gone) persist(next)
  return gone
}

export function clearSessions(): void {
  persist([])
}
