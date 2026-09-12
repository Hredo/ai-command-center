import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { paths } from './paths'
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
  allRuns().push(run)
  appendFileSync(paths.runs, JSON.stringify(run) + '\n', 'utf8')
  return run
}

/** Reescribe el fichero entero; se usa al editar notas, votos o borrar. */
function rewrite(): void {
  writeFileSync(paths.runs, allRuns().map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}

export function updateRun(id: string, patch: Partial<RunRecord>): RunRecord | null {
  const runs = allRuns()
  const i = runs.findIndex((r) => r.id === id)
  if (i === -1) return null
  runs[i] = { ...runs[i], ...patch }
  rewrite()
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
      if (prev.totalTokens === run.totalTokens && prev.totalMs === run.totalMs) continue
      // Lo que el usuario haya puesto a mano (voto, notas propias) no se pisa.
      runs[at] = { ...run, rating: prev.rating, winner: prev.winner }
      changed++
    }
  }

  if (changed) rewrite()
  return changed
}

export function deleteRun(id: string): void {
  memo = allRuns().filter((r) => r.id !== id)
  rewrite()
}

export function clearRuns(): void {
  memo = []
  writeFileSync(paths.runs, '', 'utf8')
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

export function queryRuns(q: RunQuery = {}): { rows: RunRecord[]; total: number } {
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
        r.model.toLowerCase().includes(s)
    )
  }
  const total = rows.length
  rows = rows.slice().sort((a, b) => b.createdAt - a.createdAt)
  const offset = q.offset ?? 0
  const limit = q.limit ?? 200
  return { rows: rows.slice(offset, offset + limit), total }
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
