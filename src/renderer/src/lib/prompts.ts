/**
 * Variables de los prompts de la biblioteca y el «/» que los inserta.
 *
 * `{{nombre}}` pide un valor al insertar; `{{nombre:por omisión}}` lo trae ya
 * puesto. `{{proyecto}}`, `{{rama}}` y `{{fecha}}` se rellenan solas con lo
 * que haya donde lo insertas, y aun así se pueden cambiar.
 */
import type { PromptTemplate } from '@shared/types'

export interface PromptVar {
  /** Como está escrita en el prompt. */
  name: string
  /** En minúsculas: la misma variable escrita de dos formas es una sola. */
  key: string
  default?: string
  builtin: boolean
}

const VAR_RE = /\{\{\s*([^{}:]+?)\s*(?::([^{}]*))?\}\}/g

/** Las que se rellenan solas, en español y en inglés. */
export const BUILTIN_VARS = ['proyecto', 'rama', 'fecha', 'project', 'branch', 'date'] as const

export function promptVars(text: string): PromptVar[] {
  const seen = new Map<string, PromptVar>()
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1].trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.set(key, {
      name,
      key,
      default: m[2]?.trim() || undefined,
      builtin: (BUILTIN_VARS as readonly string[]).includes(key)
    })
  }
  return [...seen.values()]
}

/** El texto con cada variable sustituida. Una vacía toma su valor por omisión, o nada. */
export function fillPrompt(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (_m, name: string, def?: string) => {
    const v = values[name.trim().toLowerCase()]
    return v != null && v !== '' ? v : (def?.trim() ?? '')
  })
}

/** Los valores de las variables que se rellenan solas. */
export function builtinValues(ctx: { project?: string; branch?: string }): Record<string, string> {
  const project = ctx.project ?? ''
  const branch = ctx.branch ?? ''
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  return { proyecto: project, project, rama: branch, branch, fecha: date, date }
}

/**
 * Si justo antes del cursor hay un «/palabra» al principio de una línea o
 * tras un espacio, dónde empieza y qué se ha escrito detrás de la barra. Una
 * ruta como «src/app» no cuenta: la barra no va detrás de un espacio.
 */
export function slashToken(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)\/([^\s/]{0,40})$/.exec(before)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Los que encajan con lo escrito tras «/»: primero los que empiezan así, luego los más usados. */
export function rankPrompts(list: PromptTemplate[], query: string): PromptTemplate[] {
  const q = fold(query.trim())
  const score = (p: PromptTemplate): number => {
    const name = fold(p.name)
    if (!q) return 0
    if (name.startsWith(q)) return 3
    if (name.split(/[\s\-_]+/).some((w) => w.startsWith(q))) return 2
    if (name.includes(q) || fold(p.description ?? '').includes(q)) return 1
    if (fold(p.text).includes(q)) return 0.5
    return -1
  }
  return list
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || (b.p.lastUsedAt ?? 0) - (a.p.lastUsedAt ?? 0) || (b.p.uses ?? 0) - (a.p.uses ?? 0) || a.p.name.localeCompare(b.p.name))
    .map((x) => x.p)
}
