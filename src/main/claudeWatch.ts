/**
 * Vigila la carpeta donde Claude Code escribe sus sesiones.
 *
 * Mientras trabajas en una terminal, el fichero de esa sesión va creciendo.
 * Aquí se mira esa carpeta y, cuando algo se mueve, se relee lo nuevo y se
 * vuelca al histórico: así una sesión que arrancaste fuera de la aplicación
 * aparece en las estadísticas y su gasto sube mientras sigue viva, no cuando
 * te acuerdes de mirar.
 *
 * El primer repaso se hace al arrancar y puede tardar un poco (hay
 * transcripciones de megas), así que se lanza en segundo plano y sin bloquear
 * la ventana: la lectura cede el turno cada pocas líneas. Después sólo se lee
 * lo que ha crecido, que son milisegundos.
 */
import { watch, type FSWatcher } from 'node:fs'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { refreshClaude } from './claudeSessions'

const ROOT = join(homedir(), '.claude', 'projects')

/** Espera tras un cambio: junta las líneas que un mensaje escribe de golpe. */
const SETTLE_MS = 250
/** Aunque no pare de escribir, se relee como mucho con este retraso. */
const MAX_WAIT_MS = 1000
/** Repaso de seguridad, por si el vigilante se pierde algo. */
const POLL_MS = 15_000

type Send = (payload: { imported: number; files: number }) => void

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null
let firstChangeAt = 0
let poll: NodeJS.Timeout | null = null
let busy = false
let again = false

async function refresh(send: Send): Promise<void> {
  // Un cambio que llega a mitad de un repaso no se tira: se repasa otra vez
  // al acabar, o lo último que escribió el agente esperaría al siguiente aviso.
  if (busy) {
    again = true
    return
  }
  busy = true
  try {
    do {
      again = false
      const r = await refreshClaude()
      // Sólo se avisa si de verdad ha cambiado algo: si no, la interfaz estaría
      // recargando el histórico cada dos por tres para nada.
      if (r.imported || r.files) send(r)
    } while (again)
  } catch (err) {
    console.error('[claude] no se pudieron leer las sesiones:', err)
  } finally {
    busy = false
  }
}

function schedule(send: Send): void {
  const now = Date.now()
  if (timer) clearTimeout(timer)
  else firstChangeAt = now
  const wait = Math.max(0, Math.min(SETTLE_MS, firstChangeAt + MAX_WAIT_MS - now))
  timer = setTimeout(() => {
    timer = null
    void refresh(send)
  }, wait)
}

export function watchClaude(send: Send): void {
  if (!existsSync(ROOT)) return

  // El primer repaso, en cuanto la ventana respire.
  setTimeout(() => void refresh(send), 1500)

  try {
    watcher = watch(ROOT, { recursive: true, persistent: false }, (_type, file) => {
      if (file && !String(file).endsWith('.jsonl')) return
      schedule(send)
    })
  } catch (err) {
    console.error('[claude] sin vigilancia de la carpeta de sesiones:', err)
  }

  poll = setInterval(() => void refresh(send), POLL_MS)
  if (typeof poll.unref === 'function') poll.unref()
}

export function stopWatchingClaude(): void {
  if (timer) clearTimeout(timer)
  if (poll) clearInterval(poll)
  try {
    watcher?.close()
  } catch {
    /* ya estaba cerrado */
  }
  watcher = null
  timer = null
  poll = null
}
