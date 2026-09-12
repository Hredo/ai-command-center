/**
 * Cuánto tiene que pensar el modelo.
 *
 * Cada familia lo pide a su manera: Anthropic con un presupuesto de tokens de
 * pensamiento, OpenAI con un nivel, Google con otro presupuesto, Ollama con un
 * booleano. Aquí se traduce una sola elección a lo que espera cada uno.
 *
 * 'auto' —el valor por omisión— no manda nada: la petición sale idéntica a
 * como salía antes de que esto existiera. Es deliberado: así elegir esfuerzo
 * nunca puede romper un proveedor que no lo entienda.
 */
import type { Effort } from '@shared/types'

/** Presupuesto de pensamiento en tokens, para quien lo pide así. */
const THINK_BUDGET: Record<Exclude<Effort, 'auto'>, number> = {
  minimal: 0,
  low: 2048,
  medium: 6144,
  high: 12288,
  max: 24576
}

/** Nivel textual, para quien lo pide así. */
const OPENAI_LEVEL: Record<Exclude<Effort, 'auto'>, string> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'high'
}

export const EFFORT_LABEL: Record<Effort, string> = {
  auto: 'Automático',
  minimal: 'Mínimo',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  max: 'Máximo'
}

function real(effort?: Effort): Exclude<Effort, 'auto'> | null {
  if (!effort || effort === 'auto') return null
  return effort
}

export function thinkBudget(effort?: Effort): number | null {
  const e = real(effort)
  return e === null ? null : THINK_BUDGET[e]
}

/**
 * Anthropic: el presupuesto de pensamiento tiene que caber dentro de
 * max_tokens, y con thinking activo la temperatura tiene que ser 1.
 */
export function applyAnthropicEffort(body: any, effort?: Effort): void {
  const budget = thinkBudget(effort)
  if (budget === null) return
  if (budget === 0) {
    body.thinking = { type: 'disabled' }
    return
  }
  body.thinking = { type: 'enabled', budget_tokens: budget }
  if ((body.max_tokens ?? 0) <= budget) body.max_tokens = budget + 4096
  body.temperature = 1
}

export function applyOpenAiEffort(body: any, effort?: Effort, providerId?: string): void {
  const e = real(effort)
  if (e === null) return
  if (providerId === 'openrouter') {
    // OpenRouter normaliza el esfuerzo entre proveedores por su cuenta.
    body.reasoning = { effort: OPENAI_LEVEL[e] }
    return
  }
  body.reasoning_effort = OPENAI_LEVEL[e]
}

export function applyGoogleEffort(body: any, effort?: Effort): void {
  const budget = thinkBudget(effort)
  if (budget === null) return
  body.generationConfig = body.generationConfig ?? {}
  body.generationConfig.thinkingConfig =
    budget === 0 ? { thinkingBudget: 0 } : { thinkingBudget: budget, includeThoughts: true }
}

export function applyOllamaEffort(body: any, effort?: Effort): void {
  const e = real(effort)
  if (e === null) return
  // Ollama acepta un booleano, y en los modelos que lo soportan un nivel.
  body.think = e === 'minimal' ? false : OPENAI_LEVEL[e]
}

/** Los campos que hay que quitar si el proveedor los rechaza. */
export const EFFORT_FIELDS = ['reasoning_effort', 'reasoning', 'thinking', 'think']

export function stripEffort(body: any): any {
  const copy = { ...body }
  for (const f of EFFORT_FIELDS) delete copy[f]
  if (copy.generationConfig?.thinkingConfig) {
    copy.generationConfig = { ...copy.generationConfig }
    delete copy.generationConfig.thinkingConfig
  }
  return copy
}

/* ------------------------------------------------------------------ *
 * Agentes de línea de comandos                                       *
 * ------------------------------------------------------------------ */

/**
 * Argumentos extra por CLI para pedirle más o menos razonamiento.
 *
 * Sólo están los que tienen una opción de verdad documentada. Para el resto
 * la app dice que ese CLI no expone el esfuerzo en vez de colar una bandera
 * inventada que lo haría fallar al arrancar.
 */
const CLI_EFFORT: Record<string, Partial<Record<Exclude<Effort, 'auto'>, string[]>>> = {
  // claude --effort low|medium|high|xhigh|max (desde 2.1)
  claude: {
    minimal: ['--effort', 'low'],
    low: ['--effort', 'low'],
    medium: ['--effort', 'medium'],
    high: ['--effort', 'high'],
    max: ['--effort', 'max']
  },
  // codex exec -c model_reasoning_effort="high"
  codex: {
    minimal: ['-c', 'model_reasoning_effort=minimal'],
    low: ['-c', 'model_reasoning_effort=low'],
    medium: ['-c', 'model_reasoning_effort=medium'],
    high: ['-c', 'model_reasoning_effort=high'],
    max: ['-c', 'model_reasoning_effort=high']
  },
  // aider --reasoning-effort high
  aider: {
    minimal: ['--reasoning-effort', 'minimal'],
    low: ['--reasoning-effort', 'low'],
    medium: ['--reasoning-effort', 'medium'],
    high: ['--reasoning-effort', 'high'],
    max: ['--reasoning-effort', 'high']
  }
}

/** Nombre del ejecutable sin ruta ni extensión. */
function baseCommand(command: string): string {
  return (command.split(/[\\/]/).pop() ?? command).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

/** Los argumentos que se añadirán, o null si ese CLI no admite esfuerzo. */
export function cliEffortArgs(command: string, effort?: Effort): string[] | null {
  const e = real(effort)
  if (e === null) return []
  const table = CLI_EFFORT[baseCommand(command)]
  if (!table) return null
  return table[e] ?? null
}

/* ------------------------------------------------------------------ *
 * Modelo y permisos                                                  *
 * ------------------------------------------------------------------ */

/**
 * Con qué opción se le dice a cada CLI qué modelo usar.
 *
 * Igual que con el esfuerzo: sólo están los que tienen una opción de verdad.
 * Con el resto la interfaz dice que ese agente no deja elegir modelo desde
 * aquí, que es mejor que inventarse una bandera y que falle al arrancar.
 */
const CLI_MODEL_FLAG: Record<string, string> = {
  claude: '--model',
  codex: '-m',
  opencode: '-m',
  gemini: '-m',
  qwen: '-m',
  aider: '--model'
}

/** Los argumentos del modelo, o null si ese CLI no deja elegirlo. */
export function cliModelArgs(command: string, model?: string): string[] | null {
  const flag = CLI_MODEL_FLAG[baseCommand(command)]
  if (!flag) return null
  const m = (model ?? '').trim()
  if (!m) return []
  return [flag, m]
}

/** De momento sólo Claude Code expone los modos de permiso. */
export function cliSupportsPermissionMode(command: string): boolean {
  return baseCommand(command) === 'claude'
}

const CLAUDE_MODES = new Set(['acceptEdits', 'auto', 'plan', 'manual', 'bypassPermissions'])

/** Los argumentos del modo de permisos, o null si ese CLI no los admite. */
export function cliPermissionArgs(command: string, mode?: string): string[] | null {
  if (!cliSupportsPermissionMode(command)) return null
  const m = (mode ?? '').trim()
  if (!m) return []
  if (!CLAUDE_MODES.has(m)) return []
  return ['--permission-mode', m]
}
