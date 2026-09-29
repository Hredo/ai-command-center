/**
 * Presupuestos de gasto: sobre todo, un proveedor, un proyecto o un agente,
 * por día, semana o mes.
 *
 * Por omisión sólo cuenta el dinero de verdad: lo que pagas por uso (las
 * llamadas a API que hace la app y lo que OpenCode cobra de Zen o de tus
 * claves). Lo que va por un plan de suscripción (Claude, ChatGPT, Gemini,
 * Copilot) es lo que costaría a precio de API, no lo que pagas; se puede
 * sumar marcando `includeEstimated`.
 *
 * Los periodos son de calendario en tu hora local: el día empieza a las 00:00,
 * la semana el lunes y el mes el día 1.
 */
import { baseCommand } from '@shared/cliCaps'
import { allRuns } from '../runs'
import { getConfig } from '../config'
import { providerById } from '../providers/catalog'
import type { Budget, Quota, RunRecord } from '@shared/types'

export function periodStart(period: Budget['period'], now = Date.now()): number {
  const d = new Date(now)
  if (period === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7 // 0 lunes
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime()
  }
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function periodEnd(period: Budget['period'], now = Date.now()): number {
  const s = new Date(periodStart(period, now))
  if (period === 'day') return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1).getTime()
  if (period === 'week') return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7).getTime()
  return new Date(s.getFullYear(), s.getMonth() + 1, 1).getTime()
}

/** El comando de CLI que hizo una ejecución: 'claude', 'opencode'… */
export function commandOf(r: Pick<RunRecord, 'providerId'>): string | undefined {
  if (!r.providerId.startsWith('cli:')) return undefined
  const id = r.providerId.slice(4)
  const agent = getConfig().cliAgents.find((a) => a.id === id)
  return baseCommand(agent?.command ?? id)
}

/**
 * ¿Es dinero que pagas por lo que usas? Las llamadas a API sí. De los CLI,
 * sólo OpenCode cobra por uso (Zen o tus claves), salvo con el plan Go. Los
 * demás van con plan y su coste es una estimación.
 */
export function billedPerUse(r: Pick<RunRecord, 'kind' | 'providerId' | 'model' | 'notes'>): boolean {
  if (r.kind !== 'cli' && !r.providerId.startsWith('cli:')) return !providerById(r.providerId)?.local
  if (commandOf(r) === 'opencode') return !/opencode-go/i.test(`${r.model} ${r.notes ?? ''}`)
  return false
}

type RunLike = Pick<RunRecord, 'kind' | 'providerId' | 'model' | 'notes' | 'projectId' | 'agentId' | 'agentName'>

/** Si una ejecución cuenta en un presupuesto (sin mirar la fecha). */
export function countsIn(b: Budget, r: RunLike): boolean {
  if (!b.includeEstimated && !billedPerUse(r)) return false
  switch (b.scope) {
    case 'total':
      return true
    case 'provider':
      return r.providerId === b.target || (r.providerId.startsWith('cli:') && 'cli:' + commandOf(r) === b.target)
    case 'project':
      return Boolean(b.target) && r.projectId === b.target
    case 'agent':
      return Boolean(b.target) && (r.agentId === b.target || r.providerId === 'cli:' + b.target)
  }
}

export function budgetSpend(b: Budget, now = Date.now(), runs: RunRecord[] = allRuns()): number {
  const since = periodStart(b.period, now)
  let sum = 0
  for (const r of runs) {
    if (r.createdAt < since || r.createdAt > now || !(r.costTotal > 0)) continue
    if (countsIn(b, r)) sum += r.costTotal
  }
  return sum
}

const PERIOD_LABEL: Record<Budget['period'], string> = { day: 'Hoy', week: 'Esta semana', month: 'Este mes' }
const PERIOD_MS: Record<Budget['period'], number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }

/** Sobre qué es un presupuesto, legible. */
export function budgetTarget(b: Budget): string {
  const cfg = getConfig()
  switch (b.scope) {
    case 'total':
      return 'Todo'
    case 'provider': {
      const t = b.target ?? ''
      if (t.startsWith('cli:')) return t.slice(4)
      return providerById(t)?.name ?? t
    }
    case 'project':
      return cfg.projects.find((p) => p.id === b.target)?.name ?? 'Proyecto borrado'
    case 'agent':
      return (
        cfg.agents.find((a) => a.id === b.target)?.name ??
        cfg.cliAgents.find((a) => a.id === b.target)?.name ??
        'Agente borrado'
      )
  }
}

/** Dólares sin comerse los céntimos de los topes pequeños: 0,015 no es 0,01. */
function usd(v: number): string {
  return '$' + (v >= 1 ? v.toFixed(2) : String(Number(v.toFixed(4))))
}

export function budgetQuotas(now = Date.now()): Quota[] {
  const budgets = getConfig().settings.budgets ?? []
  if (!budgets.length) return []
  const runs = allRuns()
  return budgets
    .filter((b) => b.limitUsd > 0)
    .map((b) => {
      const used = budgetSpend(b, now, runs)
      return {
        id: `budget.${b.id}`,
        provider: 'Presupuestos',
        target: b.label?.trim() || budgetTarget(b),
        providerKey: 'budget',
        label: PERIOD_LABEL[b.period],
        kind: 'budget' as const,
        unit: 'usd' as const,
        used,
        limit: b.limitUsd,
        remaining: Math.max(0, b.limitUsd - used),
        usedPct: Math.min(100, (used / b.limitUsd) * 100),
        resetsAt: periodEnd(b.period, now),
        windowMs: PERIOD_MS[b.period],
        origin: 'own' as const,
        how: [
          b.includeEstimated
            ? 'Suma todo el coste, también lo estimado de los planes de suscripción.'
            : 'Suma sólo lo que pagas por uso: llamadas a API y lo que OpenCode cobra de Zen o de tus claves.',
          b.hard ? 'Al llegar al 100 % no deja lanzar nada que cuente en él.' : ''
        ].filter(Boolean).join('\n'),
        updatedAt: now
      }
    })
}

/**
 * Antes de lanzar algo: si un presupuesto con bloqueo en el que contaría ya
 * está agotado, devuelve por qué. Si no, null.
 */
export function budgetBlock(r: RunLike, now = Date.now()): string | null {
  const budgets = (getConfig().settings.budgets ?? []).filter((b) => b.hard && b.limitUsd > 0)
  if (!budgets.length) return null
  const runs = allRuns()
  for (const b of budgets) {
    if (!countsIn(b, r)) continue
    const used = budgetSpend(b, now, runs)
    if (used >= b.limitUsd) {
      const name = b.label?.trim() || budgetTarget(b)
      return (
        `Presupuesto agotado: «${name}» (${PERIOD_LABEL[b.period].toLowerCase()}) lleva ` +
        `${usd(used)} de ${usd(b.limitUsd)}. Súbelo o quita el freno en Ajustes › Cupos para seguir.`
      )
    }
  }
  return null
}
