/**
 * Cupos y saldos que sólo se saben preguntando al proveedor.
 *
 * Cada fuente se consulta como mucho una vez por su intervalo (`ttl`) y el
 * resultado se guarda en memoria: el registro de cupos se recalcula a menudo
 * (cada vez que cambia un fichero vigilado) y no puede martillear a nadie.
 * Mientras llega la respuesta se enseña lo último que se supo.
 *
 * Cada clave va sólo a su propio proveedor y a su dirección oficial, nunca a
 * la que se haya puesto a mano para las peticiones normales. El token de
 * GitHub no pasa por la app: la consulta de Copilot la hace `gh`.
 */
import { fetchJson } from '../providers/models'
import { getStoredKey, resolveKey } from '../secrets'
import { getConfig } from '../config'
import { ghApi } from '../github'
import { allRuns } from '../runs'
import type { Quota } from '@shared/types'

interface Source {
  key: string
  /** Cada cuánto se vuelve a preguntar, en ms. */
  ttl: number
  enabled: () => boolean
  fetch: () => Promise<Quota[]>
  /** Nombre para el error, si falla. */
  provider: string
}

interface State {
  at: number
  quotas: Quota[]
  error?: string
  running?: boolean
}

const MIN = 60_000
const state = new Map<string, State>()
let changed: () => void = () => {}

/** A quién avisar cuando llega una respuesta nueva. */
export function onRemoteChange(cb: () => void): void {
  changed = cb
}

/* ------------------------------------------------------------------ *
 * Utilidades                                                         *
 * ------------------------------------------------------------------ */

const bearer = (key: string): RequestInit => ({ headers: { Authorization: `Bearer ${key}` } })
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}
const pct = (used?: number, limit?: number): number | undefined =>
  used != null && limit ? Math.max(0, Math.min(100, (used / limit) * 100)) : undefined

/** Medianoche UTC siguiente. */
function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}
function startOfUtcDay(now = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
function startOfUtcMonth(now = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}
function nextUtcMonth(now = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}
/** Lunes siguiente a las 00:00 UTC. */
function nextUtcMonday(now = Date.now()): number {
  const start = startOfUtcDay(now)
  const dow = new Date(start).getUTCDay() // 0 domingo
  const days = ((8 - dow) % 7) || 7
  return start + days * 86_400_000
}

/* ------------------------------------------------------------------ *
 * OpenRouter                                                         *
 * ------------------------------------------------------------------ */

async function openrouter(): Promise<Quota[]> {
  const { key } = resolveKey('openrouter')
  const now = Date.now()
  const out: Quota[] = []
  const k = (await fetchJson('https://openrouter.ai/api/v1/key', bearer(key)))?.data ?? {}

  // El tope de la propia clave, si le has puesto uno.
  const limit = num(k.limit)
  if (limit != null) {
    const remaining = num(k.limit_remaining)
    const reset = String(k.limit_reset ?? '')
    const used =
      remaining != null ? limit - remaining
      : reset === 'daily' ? num(k.usage_daily)
      : reset === 'weekly' ? num(k.usage_weekly)
      : reset === 'monthly' ? num(k.usage_monthly)
      : num(k.usage)
    out.push({
      id: 'openrouter.key',
      provider: 'OpenRouter',
      providerKey: 'openrouter',
      label: reset ? `Tope de la clave (${reset === 'daily' ? 'día' : reset === 'weekly' ? 'semana' : 'mes'})` : 'Tope de la clave',
      kind: 'balance',
      unit: 'usd',
      used,
      limit,
      remaining,
      usedPct: pct(used, limit),
      resetsAt: reset === 'daily' ? nextUtcMidnight(now) : reset === 'weekly' ? nextUtcMonday(now) : reset === 'monthly' ? nextUtcMonth(now) : undefined,
      origin: 'official',
      how: 'Lo dice OpenRouter de tu clave (/api/v1/key).',
      updatedAt: now
    })
  }

  // Créditos de la cuenta. Con algunas claves no se puede leer: no pasa nada.
  let totalCredits: number | undefined
  try {
    const c = (await fetchJson('https://openrouter.ai/api/v1/credits', bearer(key)))?.data ?? {}
    totalCredits = num(c.total_credits)
    const totalUsage = num(c.total_usage)
    if (totalCredits != null && totalUsage != null) {
      out.push({
        id: 'openrouter.credits',
        provider: 'OpenRouter',
        providerKey: 'openrouter',
        label: 'Créditos',
        kind: 'balance',
        unit: 'usd',
        used: totalUsage,
        limit: totalCredits,
        remaining: Math.max(0, totalCredits - totalUsage),
        usedPct: pct(totalUsage, totalCredits),
        origin: 'official',
        how: 'Créditos comprados y gastados según OpenRouter (/api/v1/credits).',
        updatedAt: now
      })
    }
  } catch {
    /* la clave no puede leer los créditos */
  }

  // Modelos gratis: tope diario publicado (50 sin haber comprado créditos,
  // 1.000 con 10 $ o más). Sólo se cuentan las peticiones hechas desde la app.
  const since = startOfUtcDay(now)
  const free = allRuns().filter(
    (r) => r.providerId === 'openrouter' && r.createdAt >= since && /:free$/.test(r.model)
  ).length
  if (free > 0) {
    const cap = totalCredits != null ? (totalCredits >= 10 ? 1000 : 50) : k.is_free_tier === true ? 50 : undefined
    out.push({
      id: 'openrouter.free',
      provider: 'OpenRouter',
      providerKey: 'openrouter',
      label: 'Modelos gratis hoy',
      kind: 'window',
      unit: 'requests',
      used: free,
      limit: cap,
      remaining: cap != null ? Math.max(0, cap - free) : undefined,
      usedPct: pct(free, cap),
      resetsAt: nextUtcMidnight(now),
      windowMs: 86_400_000,
      origin: 'measured',
      how: [
        'Peticiones de hoy (UTC) a modelos «:free» lanzadas desde la app.',
        'El tope es el que publica OpenRouter: 50 al día sin créditos comprados y 1.000 con 10 $ o más.',
        'Lo que hagas con la misma clave fuera de la app no se ve.',
        cap == null ? 'No se ha podido saber cuántos créditos has comprado, así que no se da tope.' : ''
      ].filter(Boolean).join('\n'),
      updatedAt: now
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * DeepSeek y Moonshot (Kimi): saldo de la cuenta                      *
 * ------------------------------------------------------------------ */

async function deepseek(): Promise<Quota[]> {
  const { key } = resolveKey('deepseek')
  const j = await fetchJson('https://api.deepseek.com/user/balance', bearer(key))
  const infos: any[] = Array.isArray(j?.balance_infos) ? j.balance_infos : []
  const info = infos.find((i) => i?.currency === 'USD') ?? infos[0]
  if (!info) return []
  const balance = num(info.total_balance)
  return [{
    id: 'deepseek.balance',
    provider: 'DeepSeek',
    providerKey: 'deepseek',
    label: 'Saldo',
    kind: 'balance',
    unit: info.currency === 'CNY' ? 'cny' : 'usd',
    remaining: balance,
    origin: 'official',
    how: 'Saldo de la cuenta según DeepSeek (/user/balance).',
    updatedAt: Date.now(),
    error: j?.is_available === false ? 'Saldo insuficiente' : undefined
  }]
}

async function moonshot(): Promise<Quota[]> {
  const { key } = resolveKey('moonshot')
  // La plataforma china cobra en yuanes y la internacional en dólares; las dos
  // son de Moonshot. Se usa la que hayas puesto para el proveedor.
  const override = getConfig().providers['moonshot']?.baseUrl ?? ''
  const cn = /moonshot\.cn/i.test(override)
  const j = await fetchJson(`https://api.moonshot.${cn ? 'cn' : 'ai'}/v1/users/me/balance`, bearer(key))
  const available = num(j?.data?.available_balance)
  if (available == null) return []
  return [{
    id: 'moonshot.balance',
    provider: 'Moonshot (Kimi)',
    providerKey: 'moonshot',
    label: 'Saldo',
    kind: 'balance',
    unit: cn ? 'cny' : 'usd',
    remaining: available,
    origin: 'official',
    how: 'Saldo disponible según Moonshot (/v1/users/me/balance).',
    updatedAt: Date.now(),
    error: available <= 0 ? 'Sin saldo' : undefined
  }]
}

/* ------------------------------------------------------------------ *
 * GitHub Copilot                                                     *
 * ------------------------------------------------------------------ */

const COPILOT_LABELS: Record<string, string> = {
  premium_interactions: 'Peticiones premium',
  chat: 'Chat',
  completions: 'Completados'
}

async function copilot(): Promise<Quota[]> {
  // Ruta interna de GitHub: la misma que usa la extensión de Copilot. No está
  // documentada, así que si cambia se dice y no se inventa nada.
  const u = await ghApi('copilot_internal/user')
  const now = Date.now()
  const out: Quota[] = []
  const resetRaw = u?.quota_reset_date_utc ?? u?.quota_reset_date ?? u?.limited_user_reset_date
  const resetsAt = resetRaw ? Date.parse(String(resetRaw)) || undefined : undefined
  const plan = typeof u?.copilot_plan === 'string' ? u.copilot_plan : undefined
  const base = {
    provider: 'GitHub Copilot',
    target: plan,
    providerKey: 'copilot',
    kind: 'window' as const,
    unit: 'requests' as const,
    resetsAt,
    origin: 'official' as const,
    how: ['Lo dice GitHub de tu cuenta (copilot_internal/user).', 'Se consulta con gh: la app no ve tu token.'].join('\n'),
    updatedAt: now,
    agents: ['copilot', 'gh']
  }

  const snaps = u?.quota_snapshots
  if (snaps && typeof snaps === 'object') {
    for (const [name, s] of Object.entries<any>(snaps)) {
      if (!s || s.unlimited) continue
      const limit = num(s.entitlement)
      const remaining = num(s.remaining)
      if (limit == null || remaining == null) continue
      const used = Math.max(0, limit - remaining)
      out.push({
        ...base,
        id: `copilot.${name}`,
        label: COPILOT_LABELS[name] ?? name,
        used,
        limit,
        remaining,
        usedPct: num(s.percent_remaining) != null ? 100 - Number(s.percent_remaining) : pct(used, limit)
      })
    }
  } else if (u?.monthly_quotas && u?.limited_user_quotas) {
    // Plan gratuito: los topes van en monthly_quotas y lo que queda en limited_user_quotas.
    for (const [name, lim] of Object.entries<any>(u.monthly_quotas)) {
      const limit = num(lim)
      const remaining = num(u.limited_user_quotas[name])
      if (limit == null || remaining == null) continue
      const used = Math.max(0, limit - remaining)
      out.push({ ...base, id: `copilot.${name}`, label: COPILOT_LABELS[name] ?? name, used, limit, remaining, usedPct: pct(used, limit) })
    }
  }
  if (!out.length) throw new Error('GitHub no ha devuelto cupos de Copilot para esta cuenta')
  return out
}

/* ------------------------------------------------------------------ *
 * Gasto de la organización con clave de administrador                 *
 * ------------------------------------------------------------------ */

/** Las claves de administrador van aparte: nunca se usan para pedir nada más. */
export const ADMIN_KEYS = {
  anthropic: { id: 'anthropic-admin', env: 'ANTHROPIC_ADMIN_KEY' },
  openai: { id: 'openai-admin', env: 'OPENAI_ADMIN_KEY' }
} as const

export function adminKey(which: keyof typeof ADMIN_KEYS): string {
  const k = ADMIN_KEYS[which]
  return getStoredKey(k.id) || process.env[k.env]?.trim() || ''
}

async function anthropicCost(): Promise<Quota[]> {
  const key = adminKey('anthropic')
  const now = Date.now()
  const start = new Date(startOfUtcMonth(now)).toISOString()
  let total = 0
  let page: string | undefined
  for (let i = 0; i < 5; i++) {
    const qs = new URLSearchParams({ starting_at: start, bucket_width: '1d', limit: '31' })
    if (page) qs.set('page', page)
    const j = await fetchJson(`https://api.anthropic.com/v1/organizations/cost_report?${qs}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    })
    for (const b of j?.data ?? []) for (const r of b?.results ?? []) total += (num(r?.amount) ?? 0) / 100
    if (!j?.has_more || !j?.next_page) break
    page = String(j.next_page)
  }
  return [{
    id: 'anthropic.org',
    provider: 'Anthropic (API)',
    providerKey: 'anthropic',
    label: 'Gasto de la organización este mes',
    kind: 'balance',
    unit: 'usd',
    used: total,
    resetsAt: nextUtcMonth(now),
    origin: 'official',
    how: [
      'Informe de costes de tu organización en Anthropic (clave de administrador).',
      'Anthropic no publica por API ni tu saldo ni tu tope de gasto.'
    ].join('\n'),
    updatedAt: now
  }]
}

async function openaiCost(): Promise<Quota[]> {
  const key = adminKey('openai')
  const now = Date.now()
  let total = 0
  let page: string | undefined
  for (let i = 0; i < 5; i++) {
    const qs = new URLSearchParams({ start_time: String(Math.floor(startOfUtcMonth(now) / 1000)), bucket_width: '1d', limit: '31' })
    if (page) qs.set('page', page)
    const j = await fetchJson(`https://api.openai.com/v1/organization/costs?${qs}`, bearer(key))
    for (const b of j?.data ?? []) for (const r of b?.results ?? []) total += num(r?.amount?.value) ?? 0
    if (!j?.has_more || !j?.next_page) break
    page = String(j.next_page)
  }
  return [{
    id: 'openai.org',
    provider: 'OpenAI (API)',
    providerKey: 'openai',
    label: 'Gasto de la organización este mes',
    kind: 'balance',
    unit: 'usd',
    used: total,
    resetsAt: nextUtcMonth(now),
    origin: 'official',
    how: [
      'Costes de tu organización en OpenAI (clave de administrador).',
      'OpenAI no publica por API tu saldo de créditos.'
    ].join('\n'),
    updatedAt: now
  }]
}

/* ------------------------------------------------------------------ *
 * Registro                                                           *
 * ------------------------------------------------------------------ */

const balancesOn = (): boolean => getConfig().settings.quotas?.balances !== false
const hasKey = (id: string): boolean => Boolean(resolveKey(id).key)

const SOURCES: Source[] = [
  { key: 'openrouter', provider: 'OpenRouter', ttl: 10 * MIN, enabled: () => balancesOn() && hasKey('openrouter'), fetch: openrouter },
  { key: 'deepseek', provider: 'DeepSeek', ttl: 15 * MIN, enabled: () => balancesOn() && hasKey('deepseek'), fetch: deepseek },
  { key: 'moonshot', provider: 'Moonshot (Kimi)', ttl: 15 * MIN, enabled: () => balancesOn() && hasKey('moonshot'), fetch: moonshot },
  { key: 'copilot', provider: 'GitHub Copilot', ttl: 5 * MIN, enabled: () => getConfig().settings.quotas?.copilot === true, fetch: copilot },
  { key: 'anthropic-admin', provider: 'Anthropic (API)', ttl: 30 * MIN, enabled: () => Boolean(adminKey('anthropic')), fetch: anthropicCost },
  { key: 'openai-admin', provider: 'OpenAI (API)', ttl: 30 * MIN, enabled: () => Boolean(adminKey('openai')), fetch: openaiCost }
]

function refresh(src: Source): void {
  const prev = state.get(src.key)
  if (prev?.running) return
  state.set(src.key, { at: prev?.at ?? 0, quotas: prev?.quotas ?? [], error: prev?.error, running: true })
  src
    .fetch()
    .then((quotas) => state.set(src.key, { at: Date.now(), quotas }))
    .catch((err: Error) => {
      // Se conserva lo último bueno, marcado como viejo, y se dice qué pasó.
      state.set(src.key, {
        at: Date.now(),
        quotas: (prev?.quotas ?? []).map((q) => ({ ...q, stale: true })),
        error: String(err?.message ?? err).slice(0, 240)
      })
    })
    .finally(() => changed())
}

/**
 * Lo último que se sabe de cada fuente remota activa. Las que llevan más de su
 * intervalo sin preguntar se consultan de fondo; `force` las consulta todas.
 */
export function remoteQuotas(force = false): Quota[] {
  const now = Date.now()
  const out: Quota[] = []
  for (const src of SOURCES) {
    if (!src.enabled()) {
      state.delete(src.key)
      continue
    }
    const st = state.get(src.key)
    if (!st || force || now - st.at > src.ttl) refresh(src)
    if (!st) continue
    out.push(...st.quotas)
    if (st.error && !st.quotas.length) {
      out.push({
        id: `${src.key}.error`,
        provider: src.provider,
        providerKey: src.key,
        label: 'Sin datos',
        kind: 'balance',
        unit: 'usd',
        origin: 'official',
        how: 'No se ha podido consultar.',
        updatedAt: st.at,
        error: st.error
      })
    }
  }
  return out
}

/** Para las pruebas: olvida lo consultado. */
export function resetRemote(): void {
  state.clear()
}
