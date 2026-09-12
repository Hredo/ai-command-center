/**
 * Lo último que se sabe del consumo de cada proveedor y de cada agente.
 *
 * Los límites llegan en las cabeceras de cada respuesta, así que sólo se
 * conocen después de pedir algo. Aquí se guarda lo último que dijo cada uno
 * para poder enseñarlo en la barra lateral aunque la conversación de ahora no
 * haya hecho todavía ninguna petición.
 *
 * Se guarda en memoria y nada más: un límite de hace tres días no dice nada, y
 * enseñarlo como si fuera de ahora sería mentir. Si no hay dato, la interfaz
 * dice que no lo hay.
 */
import type { CliLimit, UsageLimit, UsageSnapshot } from '@shared/types'

const store = new Map<string, UsageSnapshot>()
let broadcast: (all: UsageSnapshot[]) => void = () => {}

export function initUsage(send: (all: UsageSnapshot[]) => void): void {
  broadcast = send
}

export function recordUsage(patch: {
  providerId: string
  providerName?: string
  model?: string
  limit?: UsageLimit
  contextUsed?: number
  contextLimit?: number
}): void {
  if (!patch.providerId) return
  const prev = store.get(patch.providerId)

  const next: UsageSnapshot = {
    providerId: patch.providerId,
    providerName: patch.providerName ?? prev?.providerName,
    model: patch.model ?? prev?.model,
    // Un límite nuevo pisa al viejo; si esta petición no trajo cabeceras se
    // conserva el anterior, que sigue siendo lo último que se sabe.
    limit: patch.limit ?? prev?.limit,
    limitAt: patch.limit ? Date.now() : prev?.limitAt,
    contextUsed: patch.contextUsed ?? prev?.contextUsed,
    contextLimit: patch.contextLimit ?? prev?.contextLimit,
    at: Date.now()
  }

  store.set(patch.providerId, next)
  broadcast([...store.values()])
}

/* ------------------------------------------------------------------ *
 * Ventanas del plan de los agentes de línea de comandos              *
 * ------------------------------------------------------------------ */

/** Lo último que dijo cada CLI sobre sus ventanas, por tipo (5 h, semanal…). */
const cliLimits = new Map<string, CliLimit>()

export function recordCliLimit(limit: CliLimit): void {
  if (!limit?.type) return
  cliLimits.set(limit.type, limit)
}

export function cliLimitOf(type: string): CliLimit | undefined {
  return cliLimits.get(type)
}

export function usageSnapshots(): UsageSnapshot[] {
  return [...store.values()].sort((a, b) => b.at - a.at)
}
