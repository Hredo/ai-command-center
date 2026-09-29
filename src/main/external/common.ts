/**
 * Lo común a las sesiones de otras herramientas (Codex, OpenCode, Gemini
 * CLI) que se leen de lo que ellas mismas dejan en disco.
 *
 * Igual que con Claude Code: cada una guarda sus conversaciones en su carpeta,
 * y de ahí salen su gasto para el histórico, su conversación para el relevo y,
 * en las que lo publican, lo que te queda del plan.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { projectForPath } from '../projectMatch'
import type { AgentTodo, RunRecord } from '@shared/types'

export type ExternalTool = 'codex' | 'opencode' | 'gemini'

export const TOOL_NAMES: Record<ExternalTool, string> = {
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI'
}

/** Días hacia atrás que se leen: la ventana más larga que importa es el mes. */
export const EXTERNAL_DAYS = 31

/** Una hora por casilla, para sumar cualquier ventana de un plan. */
export const BUCKET_MS = 3600_000

export interface HourBucket {
  tok: number
  cost: number
  /** Peticiones al modelo: lo que cuenta en los topes diarios de Gemini. */
  req: number
}

/** Una sesión de otra herramienta, resumida. */
export interface ExternalSession {
  tool: ExternalTool
  id: string
  cwd?: string
  model?: string
  provider?: string
  title?: string
  firstPrompt?: string
  startedAt: number
  endedAt: number
  requests: number
  inTok: number
  outTok: number
  cacheRead: number
  reasoning: number
  /** Coste: el que dice la herramienta, o calculado con el catálogo. */
  cost: number
  /** true si el coste no lo da la herramienta sino el catálogo de precios. */
  costEstimated: boolean
  files: string[]
  todos?: AgentTodo[]
  /** Gasto por hora, para las ventanas de los planes. */
  buckets: Record<string, HourBucket>
}

export function home(...parts: string[]): string {
  return join(homedir(), ...parts)
}

export function addBucket(
  buckets: Record<string, HourBucket>,
  at: number,
  add: Partial<HourBucket>
): void {
  if (!at) return
  const key = String(Math.floor(at / BUCKET_MS))
  const b = buckets[key] ?? { tok: 0, cost: 0, req: 0 }
  b.tok += add.tok ?? 0
  b.cost += add.cost ?? 0
  b.req += add.req ?? 0
  buckets[key] = b
}

/** Suma de las casillas desde un instante. */
export function sumBuckets(buckets: Record<string, HourBucket>, since: number): HourBucket {
  const from = Math.floor(since / BUCKET_MS)
  const out = { tok: 0, cost: 0, req: 0 }
  for (const [k, b] of Object.entries(buckets)) {
    if (Number(k) < from) continue
    out.tok += b.tok
    out.cost += b.cost
    out.req += b.req
  }
  return out
}

/** Una sesión de fuera, como fila del histórico. */
export function toRun(s: ExternalSession): RunRecord {
  const project = projectForPath(s.cwd)
  const folder = s.cwd ? s.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : undefined
  const totalIn = s.inTok
  return {
    id: `${s.tool}-${s.id}`,
    createdAt: s.startedAt,
    kind: 'cli',
    providerId: 'cli:' + s.tool,
    model: s.model ?? TOOL_NAMES[s.tool],
    agentName: TOOL_NAMES[s.tool],
    projectId: project?.id,
    projectName: project?.name ?? folder,
    prompt: s.firstPrompt ?? s.title ?? `(sesión de ${TOOL_NAMES[s.tool]})`,
    response: '',
    status: 'ok',
    promptTokens: totalIn,
    completionTokens: s.outTok,
    totalTokens: totalIn + s.outTok,
    cachedTokens: s.cacheRead || undefined,
    reasoningTokens: s.reasoning || undefined,
    totalMs: Math.max(0, s.endedAt - s.startedAt),
    costIn: 0,
    costOut: 0,
    costTotal: s.cost,
    costEstimated: s.costEstimated,
    notes: `${s.requests} peticiones · desde fuera de la app${s.provider ? ' · ' + s.provider : ''}`,
    cliSessionId: s.id,
    source: 'terminal',
    todos: s.todos?.length ? s.todos : undefined,
    filesTouched: s.files.length ? s.files.slice(0, 40).map((path) => ({ path, kind: 'edit' as const, count: 1 })) : undefined
  }
}
