/**
 * Qué nivel de OpenCode (`--variant`) corresponde a cada esfuerzo de la app.
 *
 * Cada modelo trae los suyos —GPT: none…xhigh; Claude: low…max; muchos,
 * ninguno—, así que se elige el primero de la lista que el modelo tenga. Vive
 * aquí porque lo usan los dos lados: el proceso principal para lanzar y la
 * ventana para no ofrecer un nivel que no va a ninguna parte.
 */
import type { Effort } from './types'

const VARIANT_FOR: Record<Exclude<Effort, 'auto'>, string[]> = {
  minimal: ['none', 'minimal', 'low'],
  low: ['low', 'minimal'],
  medium: ['medium'],
  high: ['high'],
  max: ['max', 'xhigh', 'high']
}

export function opencodeVariantFor(variants: string[], effort?: Effort): string | undefined {
  if (!effort || effort === 'auto') return undefined
  return VARIANT_FOR[effort].find((v) => variants.includes(v))
}
