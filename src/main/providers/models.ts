import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { paths } from '../paths'
import { PROVIDERS, providerById, effectiveBaseUrl } from './catalog'
import { resolveKey } from '../secrets'
import { getConfig } from '../config'
import { isContextVariant } from '../ollama'
import type { ModelInfo, ProviderDef } from '@shared/types'

/** fetch con timeout, porque un endpoint local caído cuelga el arranque. */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} · ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : {}
  } finally {
    clearTimeout(timer)
  }
}

function authHeaders(def: ProviderDef, key: string): Record<string, string> {
  if (def.kind === 'anthropic') {
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  }
  if (def.kind === 'google') return {}
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/** Lista los modelos que un proveedor concreto expone ahora mismo. */
export async function fetchProviderModels(providerId: string): Promise<ModelInfo[]> {
  const def = providerById(providerId)
  if (!def) throw new Error(`Proveedor desconocido: ${providerId}`)
  const override = getConfig().providers[providerId]
  const base = effectiveBaseUrl(def, override?.baseUrl)
  if (!base) throw new Error('Este proveedor necesita que definas su endpoint en Ajustes.')
  const { key } = resolveKey(providerId)
  if (!def.local && !key && providerId !== 'openrouter') {
    throw new Error('Falta la API key.')
  }
  if (!def.modelsPath) throw new Error('Este proveedor no publica lista de modelos; añádelos a mano.')

  const url =
    def.kind === 'google'
      ? `${base}${def.modelsPath}?key=${encodeURIComponent(key)}&pageSize=200`
      : `${base}${def.modelsPath}`

  const json = await fetchJson(url, { headers: authHeaders(def, key) })

  // Ollama nativo
  if (def.kind === 'ollama') {
    return (json.models ?? []).filter((m: any) => !isContextVariant(m.name ?? '')).map((m: any) => ({
      id: m.name,
      providerId,
      name: m.name,
      source: 'local' as const,
      local: true,
      sizeBytes: m.size,
      contextLength: m.details?.context_length,
      priceIn: 0,
      priceOut: 0,
      updatedAt: m.modified_at ? Date.parse(m.modified_at) : Date.now(),
      description: [m.details?.parameter_size, m.details?.quantization_level].filter(Boolean).join(' · ')
    }))
  }

  // Google
  if (def.kind === 'google') {
    return (json.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => ({
        id: String(m.name).replace(/^models\//, ''),
        providerId,
        name: m.displayName || m.name,
        contextLength: m.inputTokenLimit,
        maxOutput: m.outputTokenLimit,
        source: 'provider' as const,
        description: m.description
      }))
  }

  // Anthropic
  if (def.kind === 'anthropic') {
    return (json.data ?? []).map((m: any) => ({
      id: m.id,
      providerId,
      name: m.display_name || m.id,
      source: 'provider' as const,
      updatedAt: m.created_at ? Date.parse(m.created_at) : undefined
    }))
  }

  // OpenAI compatible. OpenRouter añade precios y contexto en la misma respuesta.
  return (json.data ?? []).map((m: any) => {
    const info: ModelInfo = {
      id: m.id,
      providerId,
      name: m.name || m.id,
      contextLength: m.context_length ?? m.context_window,
      maxOutput: m.top_provider?.max_completion_tokens ?? m.max_completion_tokens,
      source: 'provider',
      description: m.description,
      updatedAt: m.created ? m.created * 1000 : undefined
    }
    if (m.pricing) {
      info.priceIn = Number(m.pricing.prompt) * 1e6 || 0
      info.priceOut = Number(m.pricing.completion) * 1e6 || 0
      if (m.pricing.input_cache_read) info.priceCacheRead = Number(m.pricing.input_cache_read) * 1e6
      if (m.pricing.input_cache_write) info.priceCacheWrite = Number(m.pricing.input_cache_write) * 1e6
    }
    if (m.architecture?.input_modalities) info.modalities = m.architecture.input_modalities
    return info
  })
}

// ---------------------------------------------------------------------------
// Catálogo global: todos los modelos que existen, con precios.
// ---------------------------------------------------------------------------

interface CatalogFile {
  fetchedAt: number
  models: ModelInfo[]
}

let catalogMemo: CatalogFile | null = null

export function getCatalog(): CatalogFile {
  if (catalogMemo) return catalogMemo
  if (existsSync(paths.modelCache)) {
    try {
      catalogMemo = JSON.parse(readFileSync(paths.modelCache, 'utf8'))
      return catalogMemo!
    } catch {
      /* cache corrupta: se regenera */
    }
  }
  catalogMemo = { fetchedAt: 0, models: [] }
  return catalogMemo
}

/** models.dev publica fichas y precios de casi todos los proveedores. */
async function fromModelsDev(): Promise<ModelInfo[]> {
  const json = await fetchJson('https://models.dev/api.json', {}, 20_000)
  const out: ModelInfo[] = []
  for (const [provId, prov] of Object.entries<any>(json)) {
    for (const [modelId, m] of Object.entries<any>(prov.models ?? {})) {
      out.push({
        id: modelId,
        providerId: provId,
        name: m.name || modelId,
        contextLength: m.limit?.context,
        maxOutput: m.limit?.output,
        priceIn: m.cost?.input,
        priceOut: m.cost?.output,
        priceCacheRead: m.cost?.cache_read,
        priceCacheWrite: m.cost?.cache_write,
        modalities: m.modalities?.input,
        source: 'catalog',
        updatedAt: m.last_updated ? Date.parse(m.last_updated) : undefined,
        description: prov.name
      })
    }
  }
  return out
}

/** El catálogo público de OpenRouter no necesita key. */
async function fromOpenRouter(): Promise<ModelInfo[]> {
  const json = await fetchJson('https://openrouter.ai/api/v1/models', {}, 20_000)
  return (json.data ?? []).map((m: any) => ({
    id: m.id,
    providerId: 'openrouter',
    name: m.name || m.id,
    contextLength: m.context_length,
    maxOutput: m.top_provider?.max_completion_tokens,
    priceIn: Number(m.pricing?.prompt) * 1e6 || 0,
    priceOut: Number(m.pricing?.completion) * 1e6 || 0,
    modalities: m.architecture?.input_modalities,
    source: 'catalog' as const,
    description: m.description?.slice(0, 400)
  }))
}

/**
 * Refresca el catálogo global. Las dos fuentes son independientes: si una
 * falla nos quedamos con la otra en vez de dejar la pestaña vacía.
 */
export async function refreshCatalog(): Promise<{ count: number; sources: string[]; errors: string[] }> {
  const models: ModelInfo[] = []
  const sources: string[] = []
  const errors: string[] = []

  const results = await Promise.allSettled([fromModelsDev(), fromOpenRouter()])
  const names = ['models.dev', 'openrouter']
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      models.push(...r.value)
      sources.push(`${names[i]} (${r.value.length})`)
    } else {
      errors.push(`${names[i]}: ${r.reason?.message ?? r.reason}`)
    }
  })

  catalogMemo = { fetchedAt: Date.now(), models }
  writeFileSync(paths.modelCache, JSON.stringify(catalogMemo), 'utf8')
  return { count: models.length, sources, errors }
}

/** Busca en el catálogo por texto libre, ordenado por relevancia simple. */
export function searchCatalog(query: string, limit = 400): ModelInfo[] {
  const models = getCatalog().models
  if (!query.trim()) return models.slice(0, limit)
  const q = query.toLowerCase()
  return models
    .filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.providerId.includes(q))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

/** Red de seguridad con los modelos más usados, por si no hay catálogo aún. */
const FALLBACK_PRICES: Record<string, [number, number]> = {
  'claude-opus-4': [15, 75],
  'claude-sonnet-4': [3, 15],
  'claude-3-5-haiku': [0.8, 4],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'o3-mini': [1.1, 4.4],
  'gemini-2.5-pro': [1.25, 10],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.0-flash': [0.1, 0.4],
  'deepseek-chat': [0.27, 1.1],
  'deepseek-reasoner': [0.55, 2.19],
  'grok-3': [3, 15],
  'mistral-large': [2, 6],
  // Las familias van al final: sólo se usan si no hubo un modelo concreto que
  // encajara antes. Sirven para versiones nuevas que todavía no están en el
  // catálogo, y quedan marcadas como estimación.
  'claude-opus': [15, 75],
  'claude-sonnet': [3, 15],
  'claude-haiku': [1, 5]
}

export interface Price {
  in: number
  out: number
  cacheRead?: number
  source: 'manual' | 'catalog' | 'fallback' | 'local' | 'none'
}

/** Resuelve el precio de un modelo: override manual > catálogo > tabla > 0. */
export function priceFor(providerId: string, modelId: string): Price {
  const def = providerById(providerId)
  if (def?.local) return { in: 0, out: 0, source: 'local' }

  const manual = getConfig().providers[providerId]?.pricing?.[modelId]
  if (manual) return { in: manual[0], out: manual[1], source: 'manual' }

  const custom = getConfig().customModels.find((m) => m.providerId === providerId && m.id === modelId)
  if (custom?.priceIn != null) {
    return { in: custom.priceIn, out: custom.priceOut ?? 0, source: 'manual' }
  }

  const models = getCatalog().models
  const exact = models.find((m) => m.providerId === providerId && m.id === modelId)
  if (exact?.priceIn != null) {
    return { in: exact.priceIn, out: exact.priceOut ?? 0, cacheRead: exact.priceCacheRead, source: 'catalog' }
  }

  // El mismo modelo servido por otro proveedor: sirve como aproximación.
  const bare = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  const loose = models.find((m) => m.id === modelId || m.id.endsWith('/' + bare) || m.id === bare)
  if (loose?.priceIn != null) {
    return { in: loose.priceIn, out: loose.priceOut ?? 0, cacheRead: loose.priceCacheRead, source: 'catalog' }
  }

  for (const [slug, [pin, pout]] of Object.entries(FALLBACK_PRICES)) {
    if (modelId.toLowerCase().includes(slug)) return { in: pin, out: pout, source: 'fallback' }
  }
  return { in: 0, out: 0, source: 'none' }
}

/**
 * Ventana de contexto del modelo, con la misma cascada que el precio: lo que
 * el usuario haya fijado a mano, el catálogo, o nada. Sin dato no se dibuja
 * ningún porcentaje: mejor no decir nada que decir un número inventado.
 */
export function contextLimitFor(providerId: string, modelId: string): number | undefined {
  const custom = getConfig().customModels.find((m) => m.providerId === providerId && m.id === modelId)
  if (custom?.contextLength) return custom.contextLength

  const models = getCatalog().models
  const exact = models.find((m) => m.providerId === providerId && m.id === modelId)
  if (exact?.contextLength) return exact.contextLength

  const bare = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  const loose = models.find((m) => m.id === modelId || m.id.endsWith('/' + bare) || m.id === bare)
  return loose?.contextLength ?? undefined
}

export function computeCost(
  providerId: string,
  modelId: string,
  tokensIn: number,
  tokensOut: number,
  cachedIn = 0
): { costIn: number; costOut: number; costTotal: number; estimated: boolean } {
  const p = priceFor(providerId, modelId)
  const billableIn = Math.max(0, tokensIn - cachedIn)
  const costIn = (billableIn / 1e6) * p.in + (cachedIn / 1e6) * (p.cacheRead ?? p.in * 0.1)
  const costOut = (tokensOut / 1e6) * p.out
  return {
    costIn,
    costOut,
    costTotal: costIn + costOut,
    estimated: p.source !== 'local' && p.source !== 'manual'
  }
}

/**
 * Modelos utilizables ahora mismo: lo que devuelven los proveedores activos,
 * enriquecido con los precios del catálogo global.
 */
export function enrich(models: ModelInfo[]): ModelInfo[] {
  return models.map((m) => {
    if (m.priceIn != null) return m
    const p = priceFor(m.providerId, m.id)
    const cat = getCatalog().models.find((c) => c.providerId === m.providerId && c.id === m.id)
    return {
      ...m,
      priceIn: p.in,
      priceOut: p.out,
      contextLength: m.contextLength ?? cat?.contextLength,
      maxOutput: m.maxOutput ?? cat?.maxOutput
    }
  })
}

export function providerCount(): number {
  return PROVIDERS.length
}
