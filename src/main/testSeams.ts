/**
 * Costuras para las pruebas.
 *
 * Las baterías levantan servidores de mentira en esta misma máquina para no
 * tocar los de verdad. Sólo se les hace caso en la app sin empaquetar y sólo
 * si apuntan a 127.0.0.1: la app instalada habla siempre con el sitio real.
 */
import { app } from 'electron'

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/

/**
 * ¿Hay quien pinte iconos de bandeja? En las pruebas se dice a mano (el Linux
 * de pruebas no tiene escritorio); en la app instalada se pregunta al sistema.
 */
export function trayHostOverride(): boolean | null {
  const v = process.env['ACC_TRAY_HOST']
  if (app.isPackaged || (v !== '0' && v !== '1')) return null
  return v === '1'
}

/** Dónde está OpenRouter: openrouter.ai, salvo en las pruebas. */
export function openRouterOrigin(): string {
  const override = process.env['ACC_OPENROUTER_URL']
  return !app.isPackaged && override && LOOPBACK.test(override) ? override : 'https://openrouter.ai'
}
