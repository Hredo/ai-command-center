/**
 * Avisos de cambio para la interfaz.
 *
 * Las pantallas que leen del histórico o de la configuración no preguntan cada
 * tanto: en cuanto algo cambia aquí —una ejecución que termina, una sesión de
 * Claude Code en otra terminal que sigue gastando, un ajuste guardado— se avisa
 * a la ventana y ella se relee. Los avisos que llegan a la vez se juntan en uno
 * para que una ráfaga de cambios no se convierta en una ráfaga de relecturas.
 */
export type LiveTopic = 'runs' | 'config'

/** Lo justo para juntar los cambios de un mismo instante sin que se note. */
const COALESCE_MS = 30

let sink: (topics: LiveTopic[]) => void = () => {}
const pending = new Set<LiveTopic>()
let timer: NodeJS.Timeout | null = null
/** Lo que dentro de main también depende del histórico o de la configuración. */
const listeners: ((topics: LiveTopic[]) => void)[] = []

export function initLive(send: (topics: LiveTopic[]) => void): void {
  sink = send
}

export function onLiveChange(cb: (topics: LiveTopic[]) => void): void {
  listeners.push(cb)
}

export function notifyChange(topic: LiveTopic): void {
  pending.add(topic)
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const topics = [...pending]
    pending.clear()
    try {
      sink(topics)
    } catch (err) {
      console.error('[live] no se pudo avisar a la ventana:', err)
    }
    for (const cb of listeners) {
      try {
        cb(topics)
      } catch (err) {
        console.error('[live] un oyente falló:', err)
      }
    }
  }, COALESCE_MS)
}
