/**
 * Cupos de todas tus IAs, en un solo sitio.
 *
 * Cada fuente dice qué mide, cuánto llevas, cuándo se repone y de dónde sale
 * el dato (`origin`):
 *  - Claude Pro/Max: el % oficial de su barra de estado (si lo activas) o,
 *    sin él, lo gastado en esta máquina sin tope inventado.
 *  - ChatGPT · Codex: el % oficial que Codex apunta en sus sesiones.
 *  - Gemini CLI: peticiones del día contra el tope publicado de tu plan.
 *  - OpenCode Go: su gasto contra los topes publicados del plan.
 *  - GitHub Copilot, OpenRouter, DeepSeek, Kimi y el gasto de organización de
 *    Anthropic y OpenAI: preguntando al proveedor (`remote.ts`).
 *  - Límites de ritmo de cualquier API que los mande en cabeceras.
 *  - Tus presupuestos (`budgets.ts`).
 * Lo que no se puede saber va en `gaps`, con el porqué y dónde mirarlo.
 *
 * Se recalcula en cuanto cambia algo (una sesión de fuera, una ejecución, un
 * ajuste, la barra de estado de Claude, una respuesta remota) y, además, cada
 * minuto, porque las ventanas se reponen con el reloj.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baseCommand } from '@shared/cliCaps'
import { pickRelayAgent, type PickCandidate } from '@shared/quotaPick'
import { getConfig } from '../config'
import { claudeWindows } from '../claudeSessions'
import { cliLimitOf, usageSnapshots } from '../usage'
import { codexLimits, type CodexWindow } from '../external/codex'
import { geminiDir, geminiSessions, geminiSince } from '../external/gemini'
import { opencodeGoSince, opencodeSessions } from '../external/opencode'
import { codexSessions } from '../external/codex'
import { home } from '../external/common'
import { providerById, PROVIDERS } from '../providers/catalog'
import { resolveKey } from '../secrets'
import { paths } from '../paths'
import { writeFileAtomic } from '../atomic'
import { onLiveChange } from '../live'
import { notifyQuota } from '../notify'
import { readClaudePlan, watchClaudePlan, stopWatchingClaudePlan, type ClaudePlanWindow } from './claudeStatusLine'
import { remoteQuotas, onRemoteChange, adminKey } from './remote'
import { budgetQuotas } from './budgets'
import { project } from './projection'
import type { CliLimit, GeminiPlan, Quota, QuotaAlert, QuotaGap, QuotaReport, UsageWindow } from '@shared/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/* ------------------------------------------------------------------ *
 * Claude                                                             *
 * ------------------------------------------------------------------ */

function claudeQuotas(now: number): Quota[] {
  const statusOn = getConfig().settings.quotas?.claudeStatusLine === true
  const plan = statusOn ? readClaudePlan() : null
  const fiveEv = cliLimitOf('five_hour')
  const weekEv = cliLimitOf('seven_day') ?? cliLimitOf('seven_day_opus') ?? cliLimitOf('seven_day_sonnet')
  const w = claudeWindows(fiveEv?.resetsAt)
  if (!plan && !fiveEv && !weekEv && w.weekly.messages === 0) return []

  const one = (
    id: string,
    label: string,
    windowMs: number,
    official: ClaudePlanWindow | undefined,
    ev: CliLimit | undefined,
    measured: UsageWindow,
    measuredLabel: string
  ): Quota => {
    const base = { id: `claude.${id}`, provider: 'Claude', providerKey: 'claude', kind: 'window' as const, windowMs, agents: ['claude'] }
    if (plan && official && (!official.resetsAt || official.resetsAt > now)) {
      return {
        ...base,
        label,
        unit: 'percent',
        usedPct: official.usedPct,
        resetsAt: official.resetsAt,
        origin: 'official',
        how: [
          'El porcentaje que Claude Code enseña en su barra de estado.',
          'Cuenta todo lo que gastas con tu cuenta: la app, las terminales, claude.ai y la app de Claude.',
          'Se actualiza mientras tengas una sesión interactiva abierta.'
        ].join('\n'),
        updatedAt: plan.at,
        stale: now - plan.at > 30 * MIN
      }
    }
    const resets = ev?.resetsAt && ev.resetsAt > now ? ev.resetsAt : measured.resetsAt
    const rejected = ev?.status === 'rejected' && Boolean(ev.resetsAt && ev.resetsAt > now)
    const why = statusOn
      ? 'La lectura de la barra de estado está activada, pero no hay dato vigente de esta ventana: llega al abrir una sesión interactiva de Claude Code.'
      : 'Claude no publica el tope: activa en Ajustes › Cupos la lectura de la barra de estado para ver el % oficial.'
    return {
      ...base,
      label: resets ? label : measuredLabel,
      unit: 'tokens',
      used: measured.tokens,
      usedPct: rejected ? 100 : undefined,
      resetsAt: resets,
      origin: rejected ? 'official' : 'measured',
      how: [
        'Tokens gastados en esta máquina (la app y las terminales).',
        why,
        ev?.status === 'allowed_warning' ? 'Claude ha avisado de que te acercas al tope.' : '',
        rejected ? 'Claude ha rechazado peticiones hasta que se reponga.' : ''
      ].filter(Boolean).join('\n'),
      updatedAt: w.scannedAt || now
    }
  }

  const out = [
    one('five_hour', 'Ventana de 5 h', 5 * HOUR, plan?.fiveHour, fiveEv, w.fiveHour, 'Últimas 5 h'),
    one('seven_day', 'Semana', 7 * DAY, plan?.sevenDay, weekEv, w.weekly, 'Últimos 7 días')
  ]
  if (plan?.spend && (!plan.spend.resetsAt || plan.spend.resetsAt > now)) {
    out.push({
      id: 'claude.spend',
      provider: 'Claude',
      providerKey: 'claude',
      label: 'Gasto extra',
      kind: 'window',
      unit: 'percent',
      usedPct: plan.spend.usedPct,
      resetsAt: plan.spend.resetsAt,
      origin: 'official',
      how: 'El tope de gasto extra de tu organización, según la barra de estado de Claude Code.',
      updatedAt: plan.at,
      stale: now - plan.at > 30 * MIN,
      agents: ['claude']
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * ChatGPT · Codex                                                    *
 * ------------------------------------------------------------------ */

function windowLabel(minutes?: number): string {
  if (!minutes) return 'Ventana'
  if (minutes % 10080 === 0) return minutes === 10080 ? 'Semana' : `${minutes / 10080} semanas`
  if (minutes % 1440 === 0) return minutes === 1440 ? 'Día' : `${minutes / 1440} días`
  if (minutes % 60 === 0) return `Ventana de ${minutes / 60} h`
  return `Ventana de ${minutes} min`
}

function codexQuotas(now: number): Quota[] {
  const l = codexLimits()
  if (!l) return []
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
  const provider = l.plan ? `ChatGPT ${cap(l.plan)} · Codex` : 'ChatGPT · Codex'
  const out: Quota[] = []
  const add = (key: string, w?: CodexWindow): void => {
    if (!w) return
    const reset = w.resetsAt
    const expired = Boolean(reset && reset <= now)
    out.push({
      id: `codex.${key}`,
      provider,
      providerKey: 'codex',
      label: windowLabel(w.windowMinutes),
      kind: 'window',
      unit: 'percent',
      usedPct: expired ? undefined : w.usedPercent,
      resetsAt: expired ? undefined : reset,
      windowMs: w.windowMinutes ? w.windowMinutes * MIN : undefined,
      origin: 'official',
      how: expired
        ? 'La ventana ya se ha repuesto: el dato nuevo llega con la próxima sesión de Codex.'
        : [
            'El porcentaje que Codex apunta en sus sesiones (~/.codex/sessions).',
            'Incluye lo que gastes en Codex desde cualquier sitio con tu cuenta.'
          ].join('\n'),
      updatedAt: l.at,
      stale: expired || now - l.at > 6 * HOUR,
      agents: ['codex']
    })
  }
  add('primary', l.primary)
  add('secondary', l.secondary)
  return out
}

/* ------------------------------------------------------------------ *
 * Gemini CLI                                                         *
 * ------------------------------------------------------------------ */

/** Topes diarios publicados por Google para Gemini CLI con cuenta de Google. */
const GEMINI_DAILY: Partial<Record<GeminiPlan, number>> = {
  free: 1000,
  pro: 1500,
  ultra: 2000,
  standard: 1500,
  enterprise: 2000
}
const GEMINI_NAMES: Partial<Record<GeminiPlan, string>> = {
  free: 'gratuito',
  pro: 'Google AI Pro',
  ultra: 'Google AI Ultra',
  standard: 'Code Assist Standard',
  enterprise: 'Code Assist Enterprise'
}

/** El día de cuota de Google empieza a medianoche en la hora del Pacífico. */
export function pacificDay(now = Date.now()): { start: number; end: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(now))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const into = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000 + (now % 1000)
  const start = now - into
  return { start, end: start + DAY }
}

function geminiAuth(): string | undefined {
  try {
    const s = JSON.parse(readFileSync(join(geminiDir(), 'settings.json'), 'utf8'))
    return s?.security?.auth?.selectedType ?? s?.selectedAuthType
  } catch {
    return undefined
  }
}

function geminiQuotas(now: number): Quota[] {
  const chosen = getConfig().settings.quotas?.geminiPlan ?? 'auto'
  if (chosen === 'none') return []
  const { start, end } = pacificDay(now)
  const today = geminiSince(start)
  if (!today.req && !geminiSessions().length) return []

  let plan: GeminiPlan | undefined = chosen === 'auto' ? undefined : chosen
  let note = ''
  if (chosen === 'auto') {
    const auth = geminiAuth()
    if (auth === 'oauth-personal') {
      plan = 'free'
      note = 'Se supone el plan gratuito: si tienes Google AI Pro o Ultra, elígelo en Ajustes › Cupos.'
    } else if (auth === 'gemini-api-key' || auth === 'vertex-ai') {
      note = 'Con clave de API o Vertex el tope depende de tu nivel de pago, que no se puede leer: sólo se cuenta.'
    } else {
      note = 'No se sabe con qué cuenta entras: elige tu plan en Ajustes › Cupos para medirlo.'
    }
  }
  const limit = plan ? GEMINI_DAILY[plan] : undefined
  return [{
    id: 'gemini.daily',
    provider: 'Gemini CLI',
    target: plan ? GEMINI_NAMES[plan] : undefined,
    providerKey: 'gemini',
    label: 'Peticiones de hoy',
    kind: 'window',
    unit: 'requests',
    used: today.req,
    limit,
    remaining: limit != null ? Math.max(0, limit - today.req) : undefined,
    usedPct: limit ? Math.min(100, (today.req / limit) * 100) : undefined,
    resetsAt: end,
    windowMs: DAY,
    origin: 'measured',
    how: [
      'Peticiones al modelo contadas en las conversaciones de Gemini CLI desde la medianoche del Pacífico.',
      limit ? 'El tope es el diario que publica Google para tu plan.' : '',
      'No cuenta lo que gastes desde el IDE (Gemini Code Assist), que comparte cupo.',
      note
    ].filter(Boolean).join('\n'),
    updatedAt: now,
    agents: ['gemini']
  }]
}

/* ------------------------------------------------------------------ *
 * OpenCode Go                                                        *
 * ------------------------------------------------------------------ */

const GO_WINDOWS: { id: string; label: string; ms: number; usd: number }[] = [
  { id: '5h', label: 'Últimas 5 h', ms: 5 * HOUR, usd: 12 },
  { id: '7d', label: 'Últimos 7 días', ms: 7 * DAY, usd: 30 },
  { id: '30d', label: 'Últimos 30 días', ms: 30 * DAY, usd: 60 }
]

function opencodeGoQuotas(now: number): Quota[] {
  const setting = getConfig().settings.quotas?.opencodeGo
  if (setting === false) return []
  // Sin decir nada, se activa solo si hay uso del plan Go en tu OpenCode.
  if (setting !== true && opencodeGoSince(now - 30 * DAY).cost <= 0) return []
  return GO_WINDOWS.map((g) => {
    const used = opencodeGoSince(now - g.ms).cost
    return {
      id: `opencode-go.${g.id}`,
      provider: 'OpenCode Go',
      providerKey: 'opencode-go',
      label: g.label,
      kind: 'window' as const,
      unit: 'usd' as const,
      used,
      limit: g.usd,
      remaining: Math.max(0, g.usd - used),
      usedPct: Math.min(100, (used / g.usd) * 100),
      windowMs: g.ms,
      origin: 'measured' as const,
      how: [
        'El coste que OpenCode apunta en su base de datos para los modelos del plan Go.',
        'Los topes son los que publica OpenCode: 12 $ cada 5 h, 30 $ a la semana y 60 $ al mes.',
        'Cuenta por horas enteras.'
      ].join('\n'),
      updatedAt: now,
      agents: ['opencode']
    }
  })
}

/* ------------------------------------------------------------------ *
 * Límites de ritmo de las API (cabeceras)                             *
 * ------------------------------------------------------------------ */

function headerQuotas(now: number): Quota[] {
  const out: Quota[] = []
  for (const s of usageSnapshots()) {
    const l = s.limit
    if (!l || !s.limitAt) continue
    if (l.resetAt ? l.resetAt <= now : now - s.limitAt > 10 * MIN) continue
    const provider = s.providerName ?? providerById(s.providerId)?.name ?? s.providerId
    const base = {
      provider,
      providerKey: s.providerId,
      kind: 'rate' as const,
      resetsAt: l.resetAt,
      origin: 'official' as const,
      how: 'Lo que dijo el proveedor en las cabeceras de su última respuesta.',
      updatedAt: s.limitAt
    }
    if (l.requestsLimit && l.requestsRemaining != null) {
      const used = Math.max(0, l.requestsLimit - l.requestsRemaining)
      out.push({ ...base, id: `rate.${s.providerId}.requests`, label: 'Peticiones (ritmo)', unit: 'requests', used, limit: l.requestsLimit, remaining: l.requestsRemaining, usedPct: (used / l.requestsLimit) * 100 })
    }
    if (l.tokensLimit && l.tokensRemaining != null) {
      const used = Math.max(0, l.tokensLimit - l.tokensRemaining)
      out.push({ ...base, id: `rate.${s.providerId}.tokens`, label: 'Tokens (ritmo)', unit: 'tokens', used, limit: l.tokensLimit, remaining: l.tokensRemaining, usedPct: (used / l.tokensLimit) * 100 })
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Lo que no se puede saber                                            *
 * ------------------------------------------------------------------ */

function gaps(quotas: Quota[]): QuotaGap[] {
  const cfg = getConfig()
  const q = cfg.settings.quotas ?? {}
  const commands = new Set(cfg.cliAgents.map((a) => baseCommand(a.command)))
  const out: QuotaGap[] = []
  const has = (key: string): boolean => quotas.some((x) => x.providerKey === key)

  if (commands.has('cursor-agent') || commands.has('cursor') || existsSync(home('.cursor'))) {
    out.push({ provider: 'Cursor', why: 'Cursor sólo enseña tu uso con la sesión iniciada en su web.', url: 'https://cursor.com/dashboard' })
  }
  if (opencodeSessions().some((s) => s.provider === 'opencode')) {
    out.push({ provider: 'OpenCode Zen', why: 'El saldo de Zen sólo se ve en la consola web de OpenCode.', url: 'https://opencode.ai/zen' })
  }
  if (commands.has('codex') || codexSessions().length) {
    if (!has('codex')) {
      out.push({ provider: 'ChatGPT · Codex', why: 'Codex todavía no ha apuntado tu cupo: aparece tras tu primera sesión con él.' })
    }
    out.push({ provider: 'ChatGPT (web y app)', why: 'Los mensajes de ChatGPT tienen su propio límite y OpenAI no lo publica.', url: 'https://chatgpt.com' })
  }
  if (commands.has('gemini') || geminiSessions().length) {
    out.push({ provider: 'Gemini (app y web)', why: 'La app de Gemini no publica cuánto llevas; Gemini CLI sí se cuenta arriba.', url: 'https://gemini.google.com' })
  }
  if (!q.copilot && (commands.has('copilot') || commands.has('gh'))) {
    out.push({ provider: 'GitHub Copilot', why: 'Actívalo en Ajustes › Cupos para preguntar a GitHub con tu sesión de gh.' })
  }
  if (resolveKey('anthropic').key && !adminKey('anthropic')) {
    out.push({
      provider: 'Anthropic (API)',
      why: 'Tu saldo de créditos no se puede leer por API. Con una clave de administrador se ve el gasto del mes de la organización.',
      url: 'https://console.anthropic.com/settings/billing'
    })
  }
  if (resolveKey('openai').key && !adminKey('openai')) {
    out.push({
      provider: 'OpenAI (API)',
      why: 'Tu saldo de créditos no se puede leer por API. Con una clave de administrador se ve el gasto del mes.',
      url: 'https://platform.openai.com/settings/organization/billing/overview'
    })
  }
  const WITH_BALANCE = new Set(['openrouter', 'deepseek', 'moonshot', 'anthropic', 'openai'])
  const noBalance = PROVIDERS.filter((p) => !p.local && !WITH_BALANCE.has(p.id) && resolveKey(p.id).source !== 'none').map((p) => p.name)
  if (noBalance.length) {
    out.push({
      provider: noBalance.join(', '),
      why: 'No publican el saldo por API. Sus límites de ritmo aparecen aquí tras la primera petición, si los mandan.'
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Avisos                                                             *
 * ------------------------------------------------------------------ */

type AlertState = Record<string, { win: string; level: number }>
let alertState: AlertState | null = null
const alertsFile = (): string => join(paths.dir, 'quota-alerts.json')

function loadAlerts(): AlertState {
  if (alertState) return alertState
  try {
    alertState = JSON.parse(readFileSync(alertsFile(), 'utf8'))
  } catch {
    alertState = {}
  }
  return alertState!
}

function candidates(): PickCandidate[] {
  const cfg = getConfig()
  return [
    ...cfg.cliAgents.map((a) => ({ id: a.id, name: a.name, command: a.command })),
    ...cfg.agents.map((a) => ({ id: a.id, name: a.name, providerId: a.providerId }))
  ]
}

/** Compara con lo que ya se avisó y avisa de lo nuevo. */
function checkAlerts(quotas: Quota[], emit: (a: QuotaAlert) => void): void {
  const cfg = getConfig().settings.quotas ?? {}
  const levels = [...(cfg.thresholds?.length ? cfg.thresholds : [50, 80, 95]), 100]
    .filter((n) => n > 0 && n <= 100)
    .sort((a, b) => a - b)
  const st = loadAlerts()
  let dirty = false
  for (const q of quotas) {
    if (q.usedPct == null || q.stale || q.error) continue
    const win = q.resetsAt ? String(Math.round(q.resetsAt / (10 * MIN))) : 'móvil'
    let prev = st[q.id]
    if (!prev || prev.win !== win) {
      prev = { win, level: 0 }
      st[q.id] = prev
      dirty = true
    }
    // Una ventana móvil que ha bajado vuelve a poder avisar.
    if (q.usedPct < levels[0] - 5 && prev.level > 0) {
      prev.level = 0
      dirty = true
    }
    const reached = levels.filter((l) => q.usedPct! >= l).pop() ?? 0
    if (reached <= prev.level) continue
    prev.level = reached
    dirty = true
    const alert: QuotaAlert = {
      quotaId: q.id,
      provider: q.provider,
      label: q.label,
      usedPct: q.usedPct,
      level: reached,
      resetsAt: q.resetsAt,
      etaAt: q.projection?.etaAt
    }
    if (reached >= 100 && q.kind !== 'budget') {
      const pick = pickRelayAgent(quotas, candidates(), { quotaId: q.id })
      if (pick) {
        alert.suggestion = { agentId: pick.agent.id, agentName: pick.agent.name, reason: pick.reason, left: pick.left, where: pick.where }
      }
    }
    emit(alert)
  }
  if (dirty) {
    try {
      writeFileAtomic(alertsFile(), JSON.stringify(st))
    } catch {
      /* sin memoria de avisos: como mucho se repite uno */
    }
  }
}

/* ------------------------------------------------------------------ *
 * Registro                                                           *
 * ------------------------------------------------------------------ */

function safe<T>(name: string, fn: () => T[]): T[] {
  try {
    return fn()
  } catch (err) {
    console.error(`[cupos] ${name}:`, (err as Error).message)
    return []
  }
}

export function collectQuotas(opts: { force?: boolean } = {}): QuotaReport {
  const now = Date.now()
  const raw = [
    ...safe('claude', () => claudeQuotas(now)),
    ...safe('codex', () => codexQuotas(now)),
    ...safe('gemini', () => geminiQuotas(now)),
    ...safe('opencode-go', () => opencodeGoQuotas(now)),
    ...safe('remotos', () => remoteQuotas(opts.force)),
    ...safe('cabeceras', () => headerQuotas(now)),
    ...safe('presupuestos', () => budgetQuotas(now))
  ]
  const quotas = raw.map((q) => project(q, now))
  return { quotas, gaps: safe('huecos', () => gaps(quotas)), at: now }
}

let current: QuotaReport | null = null
let timer: NodeJS.Timeout | null = null
let ticker: NodeJS.Timeout | null = null
let sendReport: (r: QuotaReport) => void = () => {}
let sendAlert: (a: QuotaAlert) => void = () => {}

function recompute(force = false): QuotaReport {
  current = collectQuotas({ force })
  sendReport(current)
  checkAlerts(current.quotas, (a) => {
    notifyQuota(a)
    sendAlert(a)
  })
  return current
}

/** Algo ha cambiado: se recalcula en un momento, juntando las ráfagas. */
export function pokeQuotas(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    recompute()
  }, 800)
}

export function quotaReport(force = false): QuotaReport {
  if (force || !current) return recompute(force)
  return current
}

export function startQuotas(send: (r: QuotaReport) => void, alert: (a: QuotaAlert) => void): void {
  sendReport = send
  sendAlert = alert
  onRemoteChange(pokeQuotas)
  onLiveChange(pokeQuotas)
  watchClaudePlan(pokeQuotas)
  ticker = setInterval(() => recompute(), MIN)
  setTimeout(() => recompute(), 3000)
}

export function stopQuotas(): void {
  if (ticker) clearInterval(ticker)
  if (timer) clearTimeout(timer)
  ticker = timer = null
  stopWatchingClaudePlan()
}
