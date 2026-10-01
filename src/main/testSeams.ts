/**
 * Costuras para las pruebas.
 *
 * Las baterías levantan servidores de mentira en esta misma máquina para no
 * tocar los de verdad. Sólo se les hace caso en la app sin empaquetar y sólo
 * si apuntan a 127.0.0.1: la app instalada habla siempre con el sitio real.
 */
import { app } from 'electron'

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/

/** Dónde está OpenRouter: openrouter.ai, salvo en las pruebas. */
export function openRouterOrigin(): string {
  const override = process.env['ACC_OPENROUTER_URL']
  return !app.isPackaged && override && LOOPBACK.test(override) ? override : 'https://openrouter.ai'
}
