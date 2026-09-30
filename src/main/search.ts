/**
 * Búsqueda de texto completo en las conversaciones de la Consola y en el
 * histórico de ejecuciones.
 *
 * Sin índice: los datos ya están en memoria (sesiones e histórico se cargan
 * una vez) y recorrerlos es rápido. Sin distinguir mayúsculas ni tildes;
 * varias palabras tienen que estar todas en el mismo mensaje, y "entre
 * comillas" busca la frase tal cual.
 */
import { listSessions } from './sessions'
import { allRuns } from './runs'
import type { SearchHit, SearchQuery, SearchResult } from '@shared/types'

const MAX_HITS = 200
const BEFORE = 80
const AFTER = 160

const MARKS = /\p{M}/gu
export const fold = (s: string): string => s.normalize('NFD').replace(MARKS, '').toLowerCase()

/**
 * Lo ya plegado, por objeto. Las sesiones y las ejecuciones no se cambian en
 * sitio (cada cambio es un objeto nuevo), así que buscar otra vez mientras
 * escribes no vuelve a plegar todo el histórico.
 */
const folded = new WeakMap<object, string>()
function foldOf(owner: object, text: string): string {
  let f = folded.get(owner)
  if (f === undefined) {
    f = fold(text)
    folded.set(owner, f)
  }
  return f
}
const promptKeys = new WeakMap<object, object>()
/** Una llave distinta para el prompt y para la respuesta de la misma ejecución. */
function promptKey(r: object): object {
  let k = promptKeys.get(r)
  if (!k) {
    k = {}
    promptKeys.set(r, k)
  }
  return k
}

/** El texto plegado y, para cada carácter plegado, de qué carácter original viene. */
function foldMap(s: string): { f: string; map: number[] } {
  let f = ''
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const g = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : ch.normalize('NFD').replace(MARKS, '').toLowerCase()
    for (let k = 0; k < g.length; k++) {
      f += g[k]
      map.push(i)
    }
  }
  map.push(s.length)
  return { f, map }
}

/** Palabras y "frases entre comillas", ya plegadas. */
export function parseQuery(text: string): string[] {
  const terms: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  for (const m of text.matchAll(re)) {
    const t = fold((m[1] ?? m[2] ?? '').trim())
    if (t && !terms.includes(t)) terms.push(t)
  }
  return terms
}

function count(hay: string, needle: string, cap = 20): number {
  let n = 0
  let at = hay.indexOf(needle)
  while (at !== -1 && n < cap) {
    n++
    at = hay.indexOf(needle, at + needle.length)
  }
  return n
}

/** Un trozo alrededor del primer acierto, con dónde está cada palabra buscada dentro. */
function snippet(text: string, terms: string[]): { snippet: string; ranges: [number, number][] } {
  const { f, map } = foldMap(text)
  let first = Infinity
  for (const t of terms) {
    const i = f.indexOf(t)
    if (i !== -1 && i < first) first = i
  }
  const pos = first === Infinity ? 0 : map[first]
  let start = Math.max(0, pos - BEFORE)
  let end = Math.min(text.length, pos + AFTER)
  // Sin partir palabras.
  if (start > 0) {
    const sp = text.lastIndexOf(' ', start)
    if (sp !== -1 && start - sp < 20) start = sp + 1
  }
  if (end < text.length) {
    const sp = text.indexOf(' ', end)
    if (sp !== -1 && sp - end < 20) end = sp
  }
  const body = text.slice(start, end).replace(/\s+/g, ' ')
  const prefix = start > 0 ? '…' : ''
  const out = prefix + body + (end < text.length ? '…' : '')
  const folded = foldMap(out)
  const ranges: [number, number][] = []
  for (const t of terms) {
    let i = folded.f.indexOf(t)
    while (i !== -1 && ranges.length < 40) {
      ranges.push([folded.map[i], folded.map[i + t.length]])
      i = folded.f.indexOf(t, i + t.length)
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  return { snippet: out, ranges }
}

/** Cuanto más reciente, algo más arriba. */
function recency(at: number, now: number): number {
  const days = (now - at) / 86_400_000
  return days < 1 ? 3 : days < 7 ? 2 : days < 30 ? 1 : 0
}

export function search(q: SearchQuery): SearchResult {
  const t0 = Date.now()
  const terms = parseQuery(String(q?.text ?? ''))
  if (!terms.length || terms.every((t) => t.length < 2)) return { hits: [], total: 0, tookMs: 0, truncated: false }
  const scope = q.scope ?? 'all'
  const now = Date.now()
  const hits: SearchHit[] = []
  const matchesAll = (folded: string): boolean => terms.every((t) => folded.includes(t))
  const score = (folded: string): number => terms.reduce((s, t) => s + count(folded, t), 0)

  const sessions = listSessions()
  const runs = allRuns()
  // Los mensajes no llevan hora: la de la ejecución que los contestó.
  const runAt = new Map(runs.map((r) => [r.id, r.createdAt]))
  if (scope !== 'runs') {
    for (const s of sessions) {
      if (q.projectId && s.projectId !== q.projectId) continue
      if (q.archived === false && s.archived) continue
      if (q.from && s.updatedAt < q.from) continue
      const title = fold(s.title)
      const inTitle = terms.some((t) => title.includes(t))
      const turns = s.turns ?? []
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i]
        if (!turn.content) continue
        const text = foldOf(turn, turn.content)
        if (!matchesAll(text)) continue
        const runId = turn.runId ?? (turn.role === 'user' ? turns[i + 1]?.runId : undefined)
        const at = (runId && runAt.get(runId)) || s.updatedAt
        const snip = snippet(turn.content, terms)
        hits.push({
          kind: 'turn',
          id: `${s.id}:${turn.id}`,
          sessionId: s.id,
          turnId: turn.id,
          title: s.title,
          role: turn.role,
          at,
          projectId: s.projectId,
          model: turn.model,
          sessionKind: s.kind === 'cli' ? 'cli' : 'chat',
          archived: s.archived || undefined,
          score: score(text) + (inTitle ? 5 : 0) + recency(at, now),
          ...snip
        })
      }
    }
  }

  if (scope !== 'sessions') {
    // Lo que ya está en una conversación sale desde ella: el histórico de esa
    // ejecución diría lo mismo dos veces.
    const live = scope === 'all' ? new Set(sessions.map((s) => s.id)) : new Set<string>()
    for (const r of runs) {
      if (r.conversationId && live.has(r.conversationId)) continue
      if (q.projectId && r.projectId !== q.projectId) continue
      if (q.from && r.createdAt < q.from) continue
      const prompt = foldOf(promptKey(r), r.prompt ?? '')
      const response = foldOf(r, r.response ?? '')
      const whole = prompt + '\n' + response
      if (!matchesAll(whole)) continue
      // El trozo, de donde más aciertos haya.
      const inPrompt = score(prompt)
      const inResponse = score(response)
      const field: 'prompt' | 'response' = inResponse > inPrompt ? 'response' : 'prompt'
      const snip = snippet(field === 'prompt' ? r.prompt : r.response, terms)
      hits.push({
        kind: 'run',
        id: r.id,
        runId: r.id,
        title: r.agentName || r.model,
        field,
        at: r.createdAt,
        projectId: r.projectId,
        projectName: r.projectName,
        model: r.model,
        runKind: r.kind,
        score: inPrompt + inResponse + recency(r.createdAt, now),
        ...snip
      })
    }
  }

  hits.sort((a, b) => b.score - a.score || b.at - a.at)
  const limit = Math.min(MAX_HITS, Math.max(1, q.limit ?? MAX_HITS))
  return { hits: hits.slice(0, limit), total: hits.length, tookMs: Date.now() - t0, truncated: hits.length > limit }
}
