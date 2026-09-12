/**
 * Vigila la carpeta donde Claude Code escribe sus sesiones.
 *
 * Mientras trabajas en una terminal, el fichero de esa sesión va creciendo.
 * Aquí se mira esa carpeta y, cuando algo se mueve, se relee lo nuevo y se
 * vuelca al histórico: así una sesión que arrancaste fuera de la aplicación
 * aparece en las estadísticas mientras sigue viva, no cuando te acuerdes de
 * mirar.
 *
 * El primer repaso se hace al arrancar y puede tardar un poco (hay
 * transcripciones de megas), así que se lanza en segundo plano y sin bloquear
 * la ventana: la lectura cede el turno cada pocas líneas.
 */
import { watch, type FSWatcher } from 'node:fs'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { refreshClaude } from './claudeSessions'

const ROOT = join(homedir(), '.claude', 'projects')

/** Espera tras el último cambio: un agente escribe muchas líneas seguidas. */
const DEBOUNCE_MS = 4000
/** Repaso de seguridad, por si el vigilante se pierde algo. */
const POLL_MS = 120_000

let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null
let poll: NodeJS.Timeout | null = null
let busy = false

async function refresh(send: (payload: { imported: number }) => void): Promise<void> {
  if (busy) return
  busy = true
  try {
    const r = await refreshClaude()
    // Sólo se avisa si de verdad ha cambiado algo: si no, la interfaz estaría
    // recargando el histórico cada dos por tres para nada.
    if (r.imported) send(r)
  } catch (err) {
    console.error('[claude] no se pudieron leer las sesiones:', err)
  } finally {
    busy = false
  }
}

export function watchClaude(send: (payload: { imported: number }) => void): void {
  if (!existsSync(ROOT)) return

  // El primer repaso, en cuanto la ventana respire.
  setTimeout(() => void refresh(send), 2500)

  try {
    watcher = watch(ROOT, { recursive: true, persistent: false }, () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        void refresh(send)
      }, DEBOUNCE_MS)
    })
  } catch (err) {
    console.error('[claude] sin vigilancia de la carpeta de sesiones:', err)
  }

  poll = setInterval(() => void refresh(send), POLL_MS)
  if (typeof poll.unref === 'function') poll.unref()
}

export function stopWatchingClaude(): void {
  if (debounce) clearTimeout(debounce)
  if (poll) clearInterval(poll)
  try {
    watcher?.close()
  } catch {
    /* ya estaba cerrado */
  }
  watcher = null
  debounce = null
  poll = null
}
