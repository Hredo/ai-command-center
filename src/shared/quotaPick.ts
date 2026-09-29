/**
 * A quién pasarle el trabajo cuando un cupo se agota: al agente cuyo cupo
 * tiene más margen. Se usa en main (para el aviso) y en la interfaz (para
 * proponer el relevo), con los mismos datos.
 */
import { baseCommand } from './cliCaps'
import type { Quota } from './types'

export interface PickCandidate {
  id: string
  name: string
  /** Agentes de consola: su ejecutable. */
  command?: string
  /** Agentes de API: su proveedor. */
  providerId?: string
}

/** Los cupos de los que gasta un agente. */
export function quotasOfAgent(a: PickCandidate, quotas: Quota[]): Quota[] {
  if (a.command) {
    const c = baseCommand(a.command)
    return quotas.filter((q) => q.kind !== 'budget' && q.agents?.includes(c))
  }
  if (a.providerId) return quotas.filter((q) => q.kind !== 'budget' && q.providerKey === a.providerId)
  return []
}

/** El peor cupo conocido de un agente, en %; undefined si no se sabe de ninguno. */
export function worstPct(a: PickCandidate, quotas: Quota[]): { pct?: number; quota?: Quota } {
  let worst: Quota | undefined
  for (const q of quotasOfAgent(a, quotas)) {
    if (q.usedPct == null || q.stale) continue
    if (!worst || q.usedPct > (worst.usedPct ?? 0)) worst = q
  }
  return { pct: worst?.usedPct, quota: worst }
}

/**
 * El mejor candidato para seguir. Se descarta el agente que se ha quedado sin
 * cupo (y cualquiera que gaste del mismo) y los que estén por encima del 95 %.
 * Los que tienen cupo conocido y holgado van primero; los que no tienen dato,
 * después.
 */
export function pickRelayAgent(
  quotas: Quota[],
  candidates: PickCandidate[],
  exclude: { command?: string; agentId?: string; quotaId?: string } = {}
): RelayPick | null {
  const exCmd = exclude.command ? baseCommand(exclude.command) : undefined
  let best: (RelayPick & { score: number }) | null = null
  for (const a of candidates) {
    if (a.id === exclude.agentId) continue
    if (exCmd && a.command && baseCommand(a.command) === exCmd) continue
    const mine = quotasOfAgent(a, quotas)
    if (exclude.quotaId && mine.some((q) => q.id === exclude.quotaId)) continue
    const { pct, quota } = worstPct(a, quotas)
    if (pct != null && pct >= 95) continue
    const score = pct ?? 60
    const left = pct != null ? Math.max(0, Math.round(100 - pct)) : undefined
    const where = quota ? `${quota.provider} · ${quota.label}` : undefined
    const reason =
      left != null && where ? `le queda un ${left} % en ${where}` : 'no tiene ningún cupo conocido agotado'
    if (!best || score < best.score) best = { agent: a, score, left, where, reason }
  }
  if (!best) return null
  const { score: _score, ...pick } = best
  return pick
}

export interface RelayPick {
  agent: PickCandidate
  /** % que le queda en su cupo más apurado, si se sabe. */
  left?: number
  /** Cuál es ese cupo: «Claude · Semana». */
  where?: string
  /** Lo anterior en una frase, en español (para los avisos del sistema). */
  reason: string
}
