/**
 * Mantenimiento que corre solo mientras la app está abierta.
 *
 * Hoy es la poda del histórico: una vez al poco de arrancar —sin frenar el
 * arranque— y después cada seis horas, por si la app se queda días abierta.
 */
import { getConfig } from './config'
import { compactRuns, type CompactResult } from './runs'

/** Días de detalle completo si el usuario no ha dicho otra cosa. */
export const DEFAULT_DETAIL_DAYS = 180

const FIRST_RUN_MS = 20_000
const EVERY_MS = 6 * 3600_000

let first: NodeJS.Timeout | null = null
let every: NodeJS.Timeout | null = null

export function runMaintenance(): CompactResult {
  const days = getConfig().settings.historyDetailDays ?? DEFAULT_DETAIL_DAYS
  return compactRuns(Math.max(0, Math.floor(days)))
}

function safeRun(): void {
  try {
    const r = runMaintenance()
    if (r.compacted || r.archived) {
      console.log(`[mantenimiento] ${r.compacted} ejecuciones compactadas, ${r.archived} archivadas`)
    }
  } catch (err) {
    console.error('[mantenimiento] no se pudo podar el histórico:', err)
  }
}

export function startMaintenance(): void {
  if (first || every) return
  first = setTimeout(safeRun, FIRST_RUN_MS)
  every = setInterval(safeRun, EVERY_MS)
}

export function stopMaintenance(): void {
  if (first) clearTimeout(first)
  if (every) clearInterval(every)
  first = every = null
}
