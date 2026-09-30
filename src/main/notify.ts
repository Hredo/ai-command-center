/**
 * Notificaciones del sistema al terminar una tarea.
 *
 * En Windows sólo aparecen si la app declara su AppUserModelId y tiene un
 * acceso directo en el menú Inicio; el instalador lo crea, así que funciona
 * en la versión instalada. En `pnpm dev` puede que Windows las descarte.
 */
import { Notification, BrowserWindow, app } from 'electron'
import { getConfig } from './config'
import type { QuotaAlert, RunRecord } from '@shared/types'

function fmtCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 0.01) return '$' + usd.toFixed(4)
  return '$' + usd.toFixed(usd < 10 ? 3 : 2)
}

let getWin: () => BrowserWindow | null = () => null

export function initNotify(resolver: () => BrowserWindow | null): void {
  getWin = resolver
  if (process.platform === 'win32') app.setAppUserModelId('com.hrval.aicommandcenter')
}

function shouldNotify(): boolean {
  const s = getConfig().settings
  if (!s.notifyOnFinish) return false
  if (!Notification.isSupported()) return false
  if (s.notifyOnlyWhenUnfocused) {
    const win = getWin()
    if (win && !win.isDestroyed() && win.isFocused()) return false
  }
  return true
}

/** Al pulsar la notificación se trae la ventana al frente. */
function show(title: string, body: string, urgent = false): void {
  const n = new Notification({
    title,
    body,
    silent: false,
    urgency: urgent ? 'critical' : 'normal'
  })
  n.on('click', () => {
    const win = getWin()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
  n.show()
}

function secs(msValue: number): string {
  return msValue < 1000 ? `${Math.round(msValue)} ms` : `${(msValue / 1000).toFixed(1)} s`
}

/** Aviso de una ejecución de API o de un agente de línea de comandos. */
export function notifyRun(run: RunRecord, label?: string): void {
  if (!shouldNotify()) return
  const who = label ?? run.agentName ?? run.model

  if (run.status === 'error') {
    show(`Falló: ${who}`, (run.error ?? 'Error desconocido').slice(0, 220), true)
    return
  }
  if (run.status === 'aborted') {
    show(`Parado: ${who}`, `Lo detuviste a los ${secs(run.totalMs)}.`)
    return
  }

  const bits = [
    `${run.completionTokens} tokens en ${secs(run.totalMs)}`,
    run.tokensPerSec ? `${run.tokensPerSec.toFixed(1)} t/s` : null,
    run.costTotal > 0 ? fmtCost(run.costTotal) : 'sin coste'
  ].filter(Boolean)

  show(`Listo: ${who}`, bits.join(' · '))
}

/** Aviso de una comparativa completa. */
export function notifyArena(runs: RunRecord[]): void {
  if (!shouldNotify()) return
  const ok = runs.filter((r) => r.status === 'ok')
  if (!ok.length) {
    show('Comparativa fallida', 'Ningún modelo llegó a responder.', true)
    return
  }
  const fastest = ok.reduce((a, b) => ((b.tokensPerSec ?? 0) > (a.tokensPerSec ?? 0) ? b : a))
  const cheapest = ok.reduce((a, b) => (b.costTotal < a.costTotal ? b : a))
  show(
    `Comparativa lista · ${ok.length} de ${runs.length}`,
    `Más rápido ${fastest.model} (${(fastest.tokensPerSec ?? 0).toFixed(1)} t/s) · ` +
      `más barato ${cheapest.model} (${fmtCost(cheapest.costTotal)})`
  )
}

/** Aviso de una descarga de modelo terminada. */
export function notifyPull(model: string, ok: boolean, detail?: string): void {
  if (!shouldNotify()) return
  if (ok) show('Modelo descargado', `${model} ya está disponible en Ollama.`)
  else show('Descarga fallida', `${model}: ${detail ?? 'error desconocido'}`, true)
}

/**
 * Aviso de un cupo que cruza un umbral. Tiene su propio interruptor en los
 * ajustes de cupos: no depende del aviso de fin de tarea ni de si la ventana
 * está delante, porque quedarse sin cupo importa aunque estés mirando.
 */
export function notifyQuota(a: QuotaAlert): void {
  if (getConfig().settings.quotas?.alerts === false) return
  if (!Notification.isSupported()) return
  const at = (ms?: number): string =>
    ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const who = `${a.provider} · ${a.label}`
  if (a.level >= 100) {
    const next = a.suggestion ? ` Puedes seguir con ${a.suggestion.agentName}: ${a.suggestion.reason}.` : ''
    show(`Sin cupo: ${who}`, `${a.resetsAt ? `Se repone a las ${at(a.resetsAt)}.` : ''}${next}`.trim(), true)
    return
  }
  const eta = a.etaAt && (!a.resetsAt || a.etaAt < a.resetsAt) ? ` A este ritmo llegas al tope a las ${at(a.etaAt)}.` : ''
  show(`${Math.round(a.usedPct)} % gastado: ${who}`, `Has pasado del ${a.level} %.${eta}`, a.level >= 95)
}

/**
 * Un agente espera tu respuesta: un permiso, una pregunta. Va aunque no hayas
 * pedido avisos de fin de tarea —para eso lo activaste—, salvo que estés
 * mirando la ventana y prefieras no recibirlos entonces.
 */
export function notifyAttention(title: string, body: string): void {
  if (!Notification.isSupported()) return
  if (getConfig().settings.notifyOnlyWhenUnfocused) {
    const win = getWin()
    if (win && !win.isDestroyed() && win.isFocused()) return
  }
  show(title, body, true)
}

/** Aviso de un comando de terminal largo que ha terminado. */
export function notifyCommand(command: string, exitCode: number, durationMs: number): void {
  if (!shouldNotify()) return
  // Sólo los que han tardado de verdad: avisar de un `ls` sería ruido.
  if (durationMs < 12_000) return
  const short = command.length > 60 ? command.slice(0, 58) + '…' : command
  if (exitCode === 0) show('Comando terminado', `${short}\nen ${secs(durationMs)}`)
  else show('Comando con error', `${short}\nsalió con código ${exitCode}`, true)
}
