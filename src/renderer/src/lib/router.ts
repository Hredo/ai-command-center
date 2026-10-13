/**
 * Enrutador: escribes el prompt y se decide modelo, esfuerzo y proveedor.
 *
 * Laya lee el prompt y contesta preguntas tipadas (¿es código?, ¿hay que
 * tocar archivos?, ¿es trivial?, ¿hay que pensar con calma?…). Sus respuestas
 * se juntan con las reglas, porque así acierta más que cualquiera de las dos
 * por separado —se midió con 70 tareas etiquetadas a mano, ver el comentario
 * de `mixProfile`—, y con el perfil resultante se elige entre lo que tienes de
 * verdad: modelos con clave de API, CLIs con sesión iniciada y cupo, y modelos
 * locales.
 *
 * La regla de la casa es la del recomendador: la opción más barata que llega
 * al nivel que pide la tarea, no la más lista. Gratis va primero: un modelo
 * local para lo sencillo y, para trabajar sobre un proyecto, un agente de
 * consola que gasta de tu suscripción si le queda cupo.
 */
import type { CliAgent, Effort, LayaClassification, ModelInfo, ModelUsage, Quota } from '@shared/types'
import { baseCommand } from '@shared/cliCaps'
import { classifyByRules, estimateTokens, indexOf, type TaskCategory, type TaskProfile } from './recommend'

/* ------------------------------------------------------------------ *
 * Perfil: Laya + reglas                                              *
 * ------------------------------------------------------------------ */

export interface RoutedProfile extends TaskProfile {
  /** Probabilidad de que haga falta pensar con calma (Laya). */
  think?: number
  /** Cómo de seguro está del tipo: el margen sobre el segundo, 0–1. */
  confidence?: number
  /** Lo que contestó Laya, para enseñarlo. */
  laya?: LayaClassification
}

const LAYA_CATS: TaskCategory[] = ['agentic', 'code', 'reasoning', 'writing', 'design']

/**
 * Junta lo que dice Laya con lo que dicen las reglas.
 *
 * Medido el 2026-10-13 con dos lotes de tareas etiquetadas a mano (30 en las
 * que se afinaron las reglas y 40 nuevas, la mayoría en español):
 *  - tipo de tarea, lote nuevo: reglas 13/40, Laya 18/40, juntas 21/40;
 *  - dificultad a ±1, lote nuevo: reglas 33/40, Laya 28/40, juntas 36/40;
 *  - herramientas: 32/40 juntas, igual que las reglas; imágenes 39/40.
 * Por eso el tipo es una suma de votos (Laya preguntado de dos maneras y las
 * reglas con menos peso) y la dificultad la media de las dos.
 */
export function mixProfile(text: string, laya: LayaClassification | null, opts: { project?: boolean; images?: boolean } = {}): RoutedProfile {
  const rules = classifyByRules(text, opts)
  if (!laya) return rules
  const p = laya.yes
  const score: Record<string, number> = {}
  for (const c of [...LAYA_CATS, 'general'] as TaskCategory[]) {
    score[c] = (c === 'general' ? 0.5 : p[c] ?? 0) * 0.5 + (laya.category[c] ?? 0) * 0.5 + (rules.category === c ? 0.3 : 0)
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1])
  let category = ranked[0][0] as TaskCategory
  if (opts.project) category = 'agentic'

  const layaDifficulty = Math.round(2 + 2 * (p['expert'] ?? 0) - 2 * (p['trivial'] ?? 0)) + 1
  const difficulty = Math.min(5, Math.max(1, Math.round((rules.difficulty + layaDifficulty) / 2)))
  const needsTools = Boolean(opts.project) || category === 'agentic' || ((rules.needsTools ? 1 : 0) + (p['tools'] ?? 0)) / 2 > 0.5
  const needsVision = Boolean(opts.images) || rules.needsVision || (p['vision'] ?? 0) > 0.5
  const profile = { category, difficulty, needsTools, needsVision }
  return {
    ...profile,
    ...estimateTokens(text, profile),
    source: 'laya',
    classifier: 'Laya',
    think: p['think'],
    confidence: Math.max(0, Math.min(1, ranked[0][1] - (ranked[1]?.[1] ?? 0))),
    laya
  }
}

/* ------------------------------------------------------------------ *
 * Esfuerzo                                                           *
 * ------------------------------------------------------------------ */

const EFFORT_BY_DIFFICULTY: Effort[] = ['low', 'low', 'low', 'medium', 'high', 'max']
const STEPS: Effort[] = ['minimal', 'low', 'medium', 'high', 'max']

/** Una frase para enseñar: la clave que se traduce y sus valores. */
export interface Reason {
  key: string
  vars?: Record<string, string | number>
}

/** Cuánto tiene que pensar: lo marca la dificultad y sube si Laya ve que hay que razonar. */
export function effortFor(p: RoutedProfile): { effort: Effort; why: Reason } {
  let effort = EFFORT_BY_DIFFICULTY[p.difficulty] ?? 'medium'
  const d = p.difficulty
  let why: Reason = { key: 'dificultad {d} de 5', vars: { d } }
  const think = p.think ?? (p.category === 'reasoning' ? 0.7 : 0.4)
  if (think > 0.65 || p.category === 'reasoning') {
    effort = STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(effort) + 1)]
    why =
      p.think != null && think > 0.65
        ? { key: 'dificultad {d} de 5 y Laya ve que hay que razonar ({p} %)', vars: { d, p: Math.round(think * 100) } }
        : { key: 'dificultad {d} de 5 y es de razonar', vars: { d } }
  } else if (p.difficulty <= 2 && think < 0.25) {
    effort = 'minimal'
    why = { key: 'dificultad {d} de 5 y no hace falta pensar', vars: { d } }
  }
  return { effort, why }
}

/* ------------------------------------------------------------------ *
 * Opciones                                                           *
 * ------------------------------------------------------------------ */

export type RouteKind = 'api' | 'cli' | 'local'

export interface RouteOption {
  kind: RouteKind
  key: string
  /** Lo que se enseña: modelo o alias. */
  label: string
  /** Quién lo sirve: el proveedor o el agente de consola. */
  via: string
  providerId?: string
  model?: string
  cliAgentId?: string
  cliModel?: string
  /** Índice público del modelo para este tipo de tarea, si lo hay. */
  level?: number
  /** Coste estimado en USD. 0 si es local; sin definir en una suscripción. */
  cost?: number
  /** Gasta de un plan, no de dinero: cuánto le queda. */
  quotaLeftPct?: number
  quotaLabel?: string
  supportsEffort: boolean
  passes: boolean
}

export interface RouteDecision {
  profile: RoutedProfile
  effort: Effort
  effortWhy: Reason
  pick?: RouteOption
  why: Reason[]
  /** Otras que también valdrían, por orden. */
  alternatives: RouteOption[]
  threshold?: number
}

const NOT_CHAT = /(embed|rerank|whisper|tts|speech|transcri|moderation|dall-e|image-gen|stable-diffusion|flux)/i
const BAR: Record<number, number> = { 1: 0, 2: 0.25, 3: 0.5, 4: 0.7, 5: 0.85 }
const EFFORT_CLIS = new Set(['claude', 'codex', 'aider'])

/** Los alias de Claude Code, del más ligero al más capaz. */
const CLAUDE_TIERS: { alias: string; match: RegExp; minDifficulty: number }[] = [
  { alias: 'haiku', match: /claude[^/]*haiku/i, minDifficulty: 1 },
  { alias: 'sonnet', match: /claude[^/]*sonnet/i, minDifficulty: 3 },
  { alias: 'opus', match: /claude[^/]*opus/i, minDifficulty: 4 },
  { alias: 'fable', match: /claude[^/]*fable/i, minDifficulty: 5 }
]

/** Qué cuenta de Cuentas corresponde a cada CLI. */
const ACCOUNT_OF: Record<string, string> = { claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode', copilot: 'copilot', qwen: 'qwen', 'cursor-agent': 'cursor' }

function percentile(values: number[], q: number): number | undefined {
  if (!values.length) return undefined
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]
}

/** El más nuevo del mercado que encaja: su índice vale para el alias del CLI. */
function newest(market: ModelInfo[], re: RegExp): ModelInfo | undefined {
  return market
    .filter((m) => re.test(m.id) && m.bench)
    .sort((a, b) => String(b.releaseDate ?? '').localeCompare(String(a.releaseDate ?? '')) || b.id.localeCompare(a.id))[0]
}

export interface RouteInputs {
  models: ModelInfo[]
  market: ModelInfo[]
  usage: ModelUsage[]
  cliAgents: CliAgent[]
  /** Sesión de cada cuenta: id de cuenta → true / false / null (no se sabe). */
  signedIn: Record<string, boolean | null>
  quotas: Quota[]
  localProviders: string[]
  providerName: (id: string) => string
}

/**
 * El nivel que se exige. Trabajando como agente se pide un punto más (y nunca
 * menos de «normal»): en cada vuelta el error se arrastra a la siguiente, y un
 * modelo justo para una respuesta suelta se pierde en una migración.
 */
export function requiredDifficulty(p: RoutedProfile): number {
  return p.needsTools ? Math.min(5, Math.max(3, p.difficulty + 1)) : p.difficulty
}

export function routeOptions(p: RoutedProfile, inputs: RouteInputs): { options: RouteOption[]; threshold?: number } {
  const pool = (inputs.market.length ? inputs.market : inputs.models).filter((m) => !NOT_CHAT.test(m.id))
  const values = pool.map((m) => indexOf(m, p.category).value).filter((v): v is number => v != null)
  const required = requiredDifficulty(p)
  const threshold = percentile(values, BAR[required] ?? 0.5)
  const localSet = new Set(inputs.localProviders)
  const options: RouteOption[] = []

  for (const m of inputs.models) {
    if (NOT_CHAT.test(m.id)) continue
    if (p.needsTools && m.caps?.tools !== true && !(m.local && p.difficulty <= 2)) continue
    if (p.needsVision && !(m.modalities ?? []).includes('image') && m.caps?.attachments !== true) continue
    const local = Boolean(m.local || m.source === 'local' || localSet.has(m.providerId))
    const level = indexOf(m, p.category).value
    const cost = local ? 0 : m.priceIn != null && m.priceOut != null ? (p.inTokens * m.priceIn + p.outTokens * m.priceOut) / 1_000_000 : undefined
    options.push({
      kind: local ? 'local' : 'api',
      key: `${m.providerId}/${m.id}`,
      label: m.id,
      via: inputs.providerName(m.providerId),
      providerId: m.providerId,
      model: m.id,
      level,
      cost,
      supportsEffort: !local || m.caps?.reasoning === true,
      // Sin puntuación pública, un local sólo vale para lo sencillo.
      passes: level != null ? threshold == null || level >= threshold : local && p.difficulty <= 2
    })
  }

  for (const a of inputs.cliAgents) {
    const cmd = baseCommand(a.command)
    const account = ACCOUNT_OF[cmd]
    if (account && inputs.signedIn[account] === false) continue
    const qs = inputs.quotas.filter((q) => q.agents?.includes(cmd) && q.usedPct != null && (q.kind === 'window' || q.kind === 'budget'))
    const tight = qs.sort((x, y) => (y.usedPct ?? 0) - (x.usedPct ?? 0))[0]
    const left = tight ? Math.max(0, Math.round(100 - (tight.usedPct ?? 0))) : undefined
    if (left === 0) continue
    const base = {
      kind: 'cli' as const,
      via: a.name,
      cliAgentId: a.id,
      quotaLeftPct: left,
      quotaLabel: tight?.label,
      supportsEffort: EFFORT_CLIS.has(cmd)
    }
    if (cmd === 'claude') {
      for (const tier of CLAUDE_TIERS) {
        const ref = newest(inputs.market, tier.match)
        const level = ref ? indexOf(ref, p.category).value : undefined
        options.push({
          ...base,
          key: `cli:${a.id}:${tier.alias}`,
          label: tier.alias,
          cliModel: tier.alias,
          level,
          passes: level != null && threshold != null ? level >= threshold : required >= tier.minDifficulty || tier.alias === 'fable'
        })
      }
    } else {
      options.push({ ...base, key: `cli:${a.id}`, label: a.model || '', cliModel: a.model, passes: true })
    }
  }
  return { options, threshold }
}

/**
 * La decisión. Entre las que llegan al nivel:
 *  - con herramientas (trabajar sobre un proyecto), primero un agente de
 *    consola con cupo —ya es un agente y gasta de tu plan—, luego la API;
 *  - sin herramientas y sencilla, primero lo local: gratis y no sale del equipo;
 *  - después, la API más barata que llega.
 * Si nada llega, la de más nivel que tengas, diciéndolo.
 */
export function decideRoute(p: RoutedProfile, inputs: RouteInputs): RouteDecision {
  const { effort, why: effortWhy } = effortFor(p)
  const { options, threshold } = routeOptions(p, inputs)
  const why: Reason[] = []
  const pass = options.filter((o) => o.passes)
  const byCost = (a: RouteOption, b: RouteOption): number =>
    (a.cost ?? Infinity) - (b.cost ?? Infinity) || (b.level ?? 0) - (a.level ?? 0)
  // Entre agentes de consola: el alias más ligero que llega y, a igualdad, el que más cupo tiene.
  const byTier = (a: RouteOption, b: RouteOption): number =>
    (a.level ?? 0) - (b.level ?? 0) || (b.quotaLeftPct ?? 50) - (a.quotaLeftPct ?? 50)

  const cli = pass.filter((o) => o.kind === 'cli').sort(byTier)
  const local = pass.filter((o) => o.kind === 'local').sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
  const api = pass.filter((o) => o.kind === 'api').sort(byCost)

  let order: RouteOption[]
  if (p.needsTools) {
    order = [...cli, ...api, ...local]
    if (cli[0]) why.push({ key: 'Hay que trabajar con archivos y comandos: un agente de consola lo hace y gasta de tu plan, no de dinero.' })
  } else if (p.difficulty <= 2) {
    order = [...local, ...api, ...cli]
    if (local[0]) why.push({ key: 'Es sencilla: un modelo local la resuelve gratis y sin que el prompt salga del equipo.' })
  } else {
    order = [...api, ...cli, ...local]
    if (api[0]) why.push({ key: 'El más barato de tus modelos que llega al nivel que pide la tarea.' })
  }

  let pick = order[0]
  if (!pick && options.length) {
    pick = [...options].sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || byCost(a, b))[0]
    why.push({ key: 'Ninguna de tus opciones llega al nivel que pide: va la de más nivel que tienes.' })
  }
  if (pick?.kind === 'cli' && pick.quotaLeftPct != null)
    why.push({ key: 'Le queda un {n} % de {what}.', vars: { n: pick.quotaLeftPct, what: pick.quotaLabel ?? 'cupo' } })
  if (pick && !pick.supportsEffort) why.push({ key: 'Este no deja elegir el esfuerzo: va con el suyo.' })
  return {
    profile: p,
    effort: pick && !pick.supportsEffort ? 'auto' : effort,
    effortWhy,
    pick,
    why,
    alternatives: order.filter((o) => o !== pick).slice(0, 4),
    threshold
  }
}
