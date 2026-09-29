/**
 * English strings for everything added in 0.8.
 *
 * Kept apart from i18n.en.ts only so the new screens can be reviewed in one
 * place; it is merged into the same dictionary and works exactly the same way
 * (Spanish source text as the key, dotted keys for interpolation).
 */
export const enV08: Record<string, string> = {
  /* ------------------------------------------------ Historial y datos */
  'Detalle completo del histórico (días)': 'Full history detail (days)',
  'Pasado ese tiempo, cada ejecución se queda con sus métricas y pierde el paso a paso y la respuesta entera. 0: nunca.':
    'After that, each run keeps its metrics and drops the step-by-step and the full response. 0: never.',
  'Compactar ahora': 'Compact now',
  'No se pudo compactar el histórico': 'Could not compact the history',
  'Histórico compactado: {n} ejecuciones, de {from} a {to}': 'History compacted: {n} runs, from {from} to {to}',
  'No había nada que compactar ({size})': 'Nothing to compact ({size})',
  'Desde siempre': 'All time',
  Hoy: 'Today',
  'Últimos 7 días': 'Last 7 days',
  'Últimos 30 días': 'Last 30 days',
  'Este mes': 'This month',
  'Últimos 90 días': 'Last 90 days',
  'Todo proyecto': 'Any project'
}
