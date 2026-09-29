import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { paths } from './paths'
import { writeFileAtomic } from './atomic'
import { notifyChange } from './live'
import type { RunRecord, StatsBucket } from '@shared/types'

let memo: RunRecord[] | null = null

/** Carga el histórico completo en memoria. Uso personal: miles de filas, sobra. */
export function allRuns(): RunRecord[] {
  if (memo) return memo
  memo = []
  if (existsSync(paths.runs)) {
    const text = readFileSync(paths.runs, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        memo.push(JSON.parse(line))
      } catch {
        /* línea corrupta: se ignora en vez de tumbar la app */
      }
    }
  }
  return memo
}

export function addRun(run: RunRecord): RunRecord {
  const runs = allRuns()
  // Una sesión de Claude Code lanzada desde aquí también deja su transcripción,
  // y el vigilante la va importando mientras trabaja para que el gasto se vea
  // en vivo. En cuanto se guarda la ejecución de verdad esa copia sobra: si se
  // quedara, la sesión contaría dos veces.
  const imported = run.cliSessionId ? runs.findIndex((r) => r.id === 'claude-' + run.cliSessionId) : -1
  if (imported !== -1) {
    runs.splice(imported, 1)
    runs.push(run)
    rewrite()
  } else {
    runs.push(run)
    appendFileSync(paths.runs, JSON.stringify(run) + '\n', 'utf8')
  }
  notifyChange('runs')
  return run
}

/** Reescribe el fichero entero; se usa al editar notas, votos o borrar. */
function rewrite(): void {
  writeFileAtomic(paths.runs, allRuns().map((r) => JSON.stringify(r)).join('\n') + '\n')
}

export function updateRun(id: string, patch: Partial<RunRecord>): RunRecord | null {
  const runs = allRuns()
  const i = runs.findIndex((r) => r.id === id)
  if (i === -1) return null
  runs[i] = { ...runs[i], ...patch }
  rewrite()
  notifyChange('runs')
  return runs[i]
}

/**
 * Alta o actualización de varias ejecuciones de una vez.
 *
 * Lo usa la importación de sesiones de Claude Code: una sesión viva crece con
 * cada repaso, así que hay que poder actualizar su fila sin duplicarla y sin
 * reescribir el fichero una vez por sesión.
 */
export function upsertRuns(list: RunRecord[]): number {
  if (!list.length) return 0
  const runs = allRuns()
  const byId = new Map(runs.map((r, i) => [r.id, i]))
  let changed = 0

  for (const run of list) {
    const at = byId.get(run.id)
    if (at == null) {
      runs.push(run)
      byId.set(run.id, runs.length - 1)
      changed++
    } else {
      const prev = runs[at]
      // Sólo se reescribe si de verdad ha cambiado algo: si no, importar cada
      // pocos segundos dejaría el disco sin parar.
      if (
        prev.totalTokens === run.totalTokens &&
        prev.totalMs === run.totalMs &&
        prev.projectId === run.projectId &&
        prev.projectName === run.projectName
      ) continue
      // Lo que el usuario haya puesto a mano (voto, notas propias) no se pisa.
      runs[at] = { ...run, rating: prev.rating, winner: prev.winner }
      changed++
    }
  }

  if (changed) {
    rewrite()
    notifyChange('runs')
  }
  return changed
}

/** Todo lo gastado en un proyecto, desde siempre: no sólo lo que cabe en una lista. */
export function projectTotals(projectId: string): {
  runs: number
  cost: number
  tokens: number
  errors: number
  lastAt?: number
  byAgent: StatsBucket[]
} {
  const rows = allRuns().filter((r) => r.projectId === projectId)
  let cost = 0
  let tokens = 0
  let errors = 0
  let lastAt: number | undefined
  for (const r of rows) {
    cost += r.costTotal || 0
    tokens += r.totalTokens || 0
    if (r.status === 'error') errors++
    if (!lastAt || r.createdAt > lastAt) lastAt = r.createdAt
  }
  return {
    runs: rows.length,
    cost,
    tokens,
    errors,
    lastAt,
    byAgent: bucketBy(rows, (r) => r.agentName ?? r.model)
  }
}

export function deleteRun(id: string): void {
  memo = allRuns().filter((r) => r.id !== id)
  rewrite()
  notifyChange('runs')
}

/** Quita varias ejecuciones de una vez, con una sola escritura. Devuelve cuántas quitó. */
export function removeRuns(ids: Iterable<string>): number {
  const drop = new Set(ids)
  if (!drop.size) return 0
  const before = allRuns().length
  memo = allRuns().filter((r) => !drop.has(r.id))
  const removed = before - memo.length
  if (removed) {
    rewrite()
    notifyChange('runs')
  }
  return removed
}

/* ------------------------------------------------------------------ *
 * Poda del histórico                                                 *
 * ------------------------------------------------------------------ */

/**
 * Filas a partir de las cuales las más viejas salen a un archivo aparte.
 * El histórico se carga entero en memoria: con esto nunca pasa de un tamaño
 * razonable por mucho que se use la app.
 */
const MAX_ROWS = 50_000
/** Lo que se conserva de un texto largo en una ejecución compactada. */
const KEEP_CHARS = 2_000
/** Archivos tocados que se conservan, los más usados primero. */
const KEEP_TOUCHES = 40

export interface CompactResult {
  /** Ejecuciones a las que se les quitó el detalle. */
  compacted: number
  /** Ejecuciones que salieron al archivo. */
  archived: number
  bytesBefore: number
  bytesAfter: number
}

function cut(s: string | undefined): string | undefined {
  if (s == null || s.length <= KEEP_CHARS) return s
  return s.slice(0, KEEP_CHARS) + '…'
}

/** Lo que ocupa en disco el histórico, contado como se escribe. */
function sizeOf(rows: RunRecord[]): number {
  let n = 0
  for (const r of rows) n += JSON.stringify(r).length + 1
  return n
}

/**
 * Deja el histórico en un tamaño que se pueda cargar siempre.
 *
 * Las ejecuciones más viejas que `detailDays` pierden lo que pesa y no entra
 * en ninguna estadística —el paso a paso del agente, la respuesta entera, la
 * lista completa de archivos que leyó— y conservan todas sus métricas: coste,
 * tokens, tiempos, modelo, proyecto. Las cifras del Panel no cambian.
 *
 * Si aun así hay más de MAX_ROWS filas, las más antiguas se mueven enteras a
 * `runs-archivo.jsonl`, que la app no carga pero que sigue en tu carpeta.
 *
 * `detailDays` 0 desactiva la compactación; el archivo por tamaño sigue.
 */
export function compactRuns(detailDays: number): CompactResult {
  const rows = allRuns()
  const bytesBefore = sizeOf(rows)
  let compacted = 0
  let archived = 0

  if (detailDays > 0) {
    const limit = Date.now() - detailDays * 86_400_000
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.compacted || r.createdAt >= limit || r.status === 'running') continue
      rows[i] = {
        ...r,
        prompt: cut(r.prompt) ?? '',
        response: cut(r.response) ?? '',
        systemPrompt: cut(r.systemPrompt),
        steps: undefined,
        filesTouched: r.filesTouched?.slice(0, KEEP_TOUCHES),
        compacted: true
      }
      compacted++
    }
  }

  if (rows.length > MAX_ROWS) {
    const sorted = rows.slice().sort((a, b) => a.createdAt - b.createdAt)
    const out = sorted.slice(0, rows.length - MAX_ROWS)
    const drop = new Set(out.map((r) => r.id))
    appendFileSync(paths.runsArchive, out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    memo = rows.filter((r) => !drop.has(r.id))
    archived = out.length
  }

  if (compacted || archived) {
    rewrite()
    notifyChange('runs')
  }
  return { compacted, archived, bytesBefore, bytesAfter: compacted || archived ? sizeOf(allRuns()) : bytesBefore }
}

export function clearRuns(): void {
  memo = []
  writeFileAtomic(paths.runs, '')
  notifyChange('runs')
}

export interface RunQuery {
  from?: number
  to?: number
  providerId?: string
  model?: string
  projectId?: string
  agentId?: string
  kind?: string
  status?: string
  search?: string
  limit?: number
  offset?: number
}

export function queryRuns(q: RunQuery = {}): { rows: RunRecord[]; total: number; cost: number; tokens: number } {
  let rows = allRuns()
  if (q.from) rows = rows.filter((r) => r.createdAt >= q.from!)
  if (q.to) rows = rows.filter((r) => r.createdAt <= q.to!)
  if (q.providerId) rows = rows.filter((r) => r.providerId === q.providerId)
  if (q.model) rows = rows.filter((r) => r.model === q.model)
  if (q.projectId) rows = rows.filter((r) => r.projectId === q.projectId)
  if (q.agentId) rows = rows.filter((r) => r.agentId === q.agentId)
  if (q.kind) rows = rows.filter((r) => r.kind === q.kind)
  if (q.status) rows = rows.filter((r) => r.status === q.status)
  if (q.search) {
    const s = q.search.toLowerCase()
    rows = rows.filter(
      (r) =>
        r.prompt.toLowerCase().includes(s) ||
        r.response.toLowerCase().includes(s) ||
        r.model.toLowerCase().includes(s) ||
        (r.agentName ?? '').toLowerCase().includes(s) ||
        (r.projectName ?? '').toLowerCase().includes(s)
    )
  }
  const total = rows.length
  // Las sumas son de todo lo que cumple el filtro, no sólo de la página que se
  // devuelve: si no, el resumen del Histórico se quedaba en las 400 primeras.
  let cost = 0
  let tokens = 0
  for (const r of rows) {
    cost += r.costTotal || 0
    tokens += r.totalTokens || 0
  }
  rows = rows.slice().sort((a, b) => b.createdAt - a.createdAt)
  const offset = q.offset ?? 0
  const limit = q.limit ?? 200
  return { rows: rows.slice(offset, offset + limit), total, cost, tokens }
}

function emptyBucket(key: string): StatsBucket {
  return { key, runs: 0, tokensIn: 0, tokensOut: 0, cost: 0, avgTtft: 0, avgTps: 0, avgMs: 0, errors: 0 }
}

/** Agrupa ejecuciones y promedia sólo sobre las que tienen dato, no sobre todas. */
export function bucketBy(rows: RunRecord[], keyOf: (r: RunRecord) => string): StatsBucket[] {
  const map = new Map<string, StatsBucket & { _ttft: number[]; _tps: number[]; _ms: number[] }>()
  for (const r of rows) {
    const key = keyOf(r) || '—'
    if (!map.has(key)) map.set(key, { ...emptyBucket(key), _ttft: [], _tps: [], _ms: [] })
    const b = map.get(key)!
    b.runs++
    b.tokensIn += r.promptTokens || 0
    b.tokensOut += r.completionTokens || 0
    b.cost += r.costTotal || 0
    if (r.status === 'error') b.errors++
    if (r.ttftMs) b._ttft.push(r.ttftMs)
    if (r.tokensPerSec) b._tps.push(r.tokensPerSec)
    if (r.totalMs) b._ms.push(r.totalMs)
  }
  const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  return [...map.values()]
    .map((b) => ({
      key: b.key,
      runs: b.runs,
      tokensIn: b.tokensIn,
      tokensOut: b.tokensOut,
      cost: b.cost,
      errors: b.errors,
      avgTtft: avg(b._ttft),
      avgTps: avg(b._tps),
      avgMs: avg(b._ms)
    }))
    .sort((a, b) => b.runs - a.runs)
}

export interface Overview {
  totalRuns: number
  totalCost: number
  totalTokensIn: number
  totalTokensOut: number
  avgTtft: number
  avgTps: number
  errorRate: number
  byProvider: StatsBucket[]
  byModel: StatsBucket[]
  byProject: StatsBucket[]
  byAgent: StatsBucket[]
  byDay: { day: string; runs: number; cost: number; tokensIn: number; tokensOut: number }[]
  costMonth: number
  runsToday: number
}

export function overview(days = 30): Overview {
  const since = Date.now() - days * 86_400_000
  const rows = allRuns().filter((r) => r.createdAt >= since)
  const all = bucketBy(rows, () => 'all')[0] ?? emptyBucket('all')

  const dayMap = new Map<string, { runs: number; cost: number; tokensIn: number; tokensOut: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
    dayMap.set(d.toISOString().slice(0, 10), { runs: 0, cost: 0, tokensIn: 0, tokensOut: 0 })
  }
  for (const r of rows) {
    const key = new Date(r.createdAt).toISOString().slice(0, 10)
    const d = dayMap.get(key)
    if (!d) continue
    d.runs++
    d.cost += r.costTotal || 0
    d.tokensIn += r.promptTokens || 0
    d.tokensOut += r.completionTokens || 0
  }

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  return {
    totalRuns: all.runs,
    totalCost: all.cost,
    totalTokensIn: all.tokensIn,
    totalTokensOut: all.tokensOut,
    avgTtft: all.avgTtft,
    avgTps: all.avgTps,
    errorRate: all.runs ? all.errors / all.runs : 0,
    byProvider: bucketBy(rows, (r) => r.providerId),
    byModel: bucketBy(rows, (r) => r.model),
    byProject: bucketBy(rows.filter((r) => r.projectName), (r) => r.projectName!),
    byAgent: bucketBy(rows.filter((r) => r.agentName), (r) => r.agentName!),
    byDay: [...dayMap.entries()].map(([day, v]) => ({ day, ...v })),
    costMonth: allRuns()
      .filter((r) => r.createdAt >= monthStart.getTime())
      .reduce((s, r) => s + (r.costTotal || 0), 0),
    runsToday: allRuns().filter((r) => r.createdAt >= todayStart.getTime()).length
  }
}

/** Devuelve las comparativas agrupadas por arenaId, más recientes primero. */
export function arenaSessions(): { arenaId: string; createdAt: number; prompt: string; runs: RunRecord[] }[] {
  const map = new Map<string, RunRecord[]>()
  for (const r of allRuns()) {
    if (!r.arenaId) continue
    if (!map.has(r.arenaId)) map.set(r.arenaId, [])
    map.get(r.arenaId)!.push(r)
  }
  return [...map.entries()]
    .map(([arenaId, runs]) => ({
      arenaId,
      createdAt: Math.min(...runs.map((r) => r.createdAt)),
      prompt: runs[0]?.prompt ?? '',
      runs: runs.sort((a, b) => a.createdAt - b.createdAt)
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
