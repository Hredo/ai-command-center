/**
 * Biblioteca de prompts: textos que repites, con variables `{{nombre}}` que se
 * rellenan al usarlos. Viven en la configuración, como los agentes.
 */
import { getConfig, saveConfig, upsert } from './config'
import type { AppConfig, PromptTemplate } from '@shared/types'

const MAX_TEXT = 100_000
const MAX_PROMPTS = 500

export function savePrompt(p: PromptTemplate): AppConfig {
  if (!p?.id || typeof p.text !== 'string') throw new Error('Prompt no válido')
  if (!p.text.trim()) throw new Error('El prompt está vacío')
  const cfg = getConfig()
  const list = cfg.prompts ?? []
  if (!list.some((x) => x.id === p.id) && list.length >= MAX_PROMPTS) throw new Error(`La biblioteca ya tiene ${MAX_PROMPTS} prompts`)
  const clean: PromptTemplate = {
    id: String(p.id),
    name: String(p.name ?? '').trim().slice(0, 120) || p.text.trim().split('\n')[0].slice(0, 60),
    text: p.text.slice(0, MAX_TEXT),
    description: p.description?.trim().slice(0, 300) || undefined,
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Date.now(),
    uses: p.uses,
    lastUsedAt: p.lastUsedAt
  }
  return saveConfig({ ...cfg, prompts: upsert(list, clean) })
}

export function removePrompt(id: string): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, prompts: (cfg.prompts ?? []).filter((p) => p.id !== id) })
}

/** Se ha insertado: cuenta para ordenar la lista por lo que más usas. */
export function markPromptUsed(id: string): boolean {
  const cfg = getConfig()
  const list = cfg.prompts ?? []
  const p = list.find((x) => x.id === id)
  if (!p) return false
  saveConfig({ ...cfg, prompts: upsert(list, { ...p, uses: (p.uses ?? 0) + 1, lastUsedAt: Date.now() }) })
  return true
}
