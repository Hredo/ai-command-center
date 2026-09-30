/**
 * Recomendador de IA: qué modelo usar para una tarea.
 *
 * La idea es no gastar de más: para un «hola mundo» no hace falta el modelo
 * más caro. Por eso la opción principal es la suficiente —el más barato que
 * llega al nivel que pide la tarea—, y al lado van la equilibrada (más nivel
 * si sale a cuenta) y la máxima.
 *
 * El nivel sale de los índices públicos de Artificial Analysis que publica
 * OpenRouter: código para programar, agéntico para trabajar sobre un
 * proyecto, inteligencia para lo demás. El listón de cada dificultad se pone
 * con percentiles del mercado entero, no de tus modelos: así «difícil» quiere
 * decir lo mismo tengas lo que tengas. Un modelo sin puntuación pública no
 * entra en la comparación —no se le inventa una—; los locales, que nunca la
 * tienen, van aparte, gratis y diciéndolo.
 *
 * El coste y el tiempo son estimaciones: tokens según el tipo y la dificultad,
 * precio del catálogo y velocidad medida con tu propio uso (si no la hay, se
 * dice «sin medir»).
 */
import type { CliAgent, ModelInfo, ModelUsage, Quota } from '@shared/types'

export type TaskCategory = 'code' | 'agentic' | 'reasoning' | 'writing' | 'design' | 'general'

export const TASK_CATEGORIES: TaskCategory[] = ['code', 'agentic', 'reasoning', 'writing', 'design', 'general']

export interface TaskProfile {
  category: TaskCategory
  /** 1 trivial … 5 muy difícil. */
  difficulty: number
  needsTools: boolean
  needsVision: boolean
  /** Tokens estimados de entrada y salida, contando las vueltas de un agente. */
  inTokens: number
  outTokens: number
  source: 'rules' | 'local' | 'manual'
  /** El modelo local que la clasificó. */
  classifier?: string
}

export interface ModelPick {
  model: ModelInfo
  index?: number
  indexName: 'coding' | 'agentic' | 'intelligence'
  /** Coste estimado en USD. Sin precio en el catálogo, no hay. */
  cost?: number
  /** Segundos estimados con tu velocidad medida. Sin medir, no hay. */
  seconds?: number
  elo?: number
  runs?: number
}

export interface SubscriptionPick {
  agent: CliAgent
  /** El cupo que más aprieta de los que gasta. */
  quota?: Quota
  leftPct?: number
}

export interface Recommendation {
  profile: TaskProfile
  /** El nivel mínimo que pide la dificultad, en el índice que toca. */
  threshold?: number
  sufficient?: ModelPick
  balanced?: ModelPick
  best?: ModelPick
  /** Ninguno de tus modelos llega al nivel: la suficiente es el mejor que tienes. */
  belowBar: boolean
  /** El mejor modelo local, gratis y sin puntuación pública. */
  local?: ModelPick
  /** Cuántos no tienen puntuación pública y no entran en la comparación. */
  unrated: number
  /** Cuántos se quedan fuera por lo que pide la tarea. */
  excluded: { tools: number; vision: number; context: number }
  subscriptions: SubscriptionPick[]
}

/* ------------------------------------------------------------------ *
 * Clasificar                                                         *
 * ------------------------------------------------------------------ */

const TRIVIAL = /\b(hola mundo|hello world|qu[eé] hora|chiste|saluda|traduce (esta|la) (frase|palabra)|corrige (la )?ortograf[ií]a)\b/i
// Raíces sin \b al final: «refactoriza», «compilación», «pruebas»…
const CODE = /(```|\b(c[oó]digo|funci[oó]n|bug|error|excepci[oó]n|stack ?trace|refactori[zc]|tests?\b|pruebas|compila|typescript|javascript|python|java\b|rust\b|golang|sql\b|regex|endpoint|componente|react|vue\b|css\b|html\b|script|clase|m[eé]todo|m[oó]dulo|npm\b|pnpm\b|pip\b))/i
/** Dentro del código, lo que suele costar más que escribir una función suelta. */
const CODE_WORK = /\b(refactori[zc]|pruebas|tests?\b|arquitect|depura|rendimiento)/i
const AGENTIC = /\b(repositorio|en el proyecto|en todo el proyecto|varios (archivos|ficheros)|implementa|migra|a[nñ]ade (una )?funcionalidad|arregla (los|todos)|pasa (los )?tests|pull request|commit|despliega|monorepo|codebase)\b/i
const REASONING = /\b(demuestra|calcula|probabilidad|ecuaci[oó]n|algoritmo|complejidad|optimiza|matem[aá]tic|l[oó]gica|razona|paso a paso|estad[ií]stic)/i
const DESIGN = /\b(dise[nñ]o|interfaz|ui|ux|maqueta|landing|logo|paleta|animaci[oó]n|figma)\b/i
const WRITING = /\b(redacta|escribe (un|una) (email|correo|art[ií]culo|post|carta)|resume|resumen|traduce|reescribe|tono|ortograf)/i
const HARD = /\b(arquitectura|producci[oó]n|seguridad|concurren|distribuid|escalab|rendimiento|migraci[oó]n|legacy|multihilo|criptogr|compilador|kernel|complej)/i
const EASY = /\b(simple|sencill|r[aá]pid|b[aá]sic|ejemplo|peque[nñ]|breve|corto)/i
const VISION = /\b(imagen|im[aá]genes|captura|foto|screenshot|pantallazo)\b/i

/** Tokens que va a mover la tarea. Un agente relee el contexto en cada vuelta. */
export function estimateTokens(text: string, p: Pick<TaskProfile, 'category' | 'difficulty' | 'needsTools'>): { inTokens: number; outTokens: number } {
  const prompt = Math.ceil(text.length / 4)
  const d = p.difficulty
  if (p.category === 'agentic' || p.needsTools) {
    const rounds = 3 * d
    return { inTokens: prompt + 12_000 * rounds, outTokens: 700 * rounds }
  }
  const out = [0, 150, 400, 900, 2_000, 4_000][d] ?? 900
  return { inTokens: prompt + 400, outTokens: p.category === 'reasoning' ? out * 2 : out }
}

/** Primera aproximación mientras escribes: reglas, sin modelos. */
export function classifyByRules(text: string, opts: { project?: boolean; images?: boolean } = {}): TaskProfile {
  const s = text.trim()
  let category: TaskCategory = 'general'
  if (opts.project || AGENTIC.test(s)) category = 'agentic'
  else if (CODE.test(s)) category = 'code'
  else if (REASONING.test(s)) category = 'reasoning'
  else if (DESIGN.test(s)) category = 'design'
  else if (WRITING.test(s)) category = 'writing'

  let difficulty = s.length < 200 ? 2 : s.length < 800 ? 3 : 4
  if (HARD.test(s)) difficulty++
  if (category === 'agentic') difficulty++
  if (category === 'code' && CODE_WORK.test(s)) difficulty++
  if (EASY.test(s)) difficulty--
  if (TRIVIAL.test(s) || (s.length < 60 && category === 'general')) difficulty = 1
  difficulty = Math.min(5, Math.max(1, difficulty))

  const needsTools = category === 'agentic'
  const needsVision = Boolean(opts.images) || VISION.test(s)
  return { category, difficulty, needsTools, needsVision, ...estimateTokens(s, { category, difficulty, needsTools }), source: 'rules' }
}

/* ------------------------------------------------------------------ *
 * Recomendar                                                         *
 * ------------------------------------------------------------------ */

/** Lo que no es un modelo de chat: no se recomienda para una tarea. */
const NOT_CHAT = /(embed|rerank|whisper|tts|speech|transcri|moderation|dall-e|image-gen|stable-diffusion|flux)/i

/** Percentil del mercado que pide cada dificultad. */
const BAR: Record<number, number> = { 1: 0, 2: 0.25, 3: 0.5, 4: 0.7, 5: 0.85 }

export function indexOf(m: ModelInfo, cat: TaskCategory): { value?: number; name: ModelPick['indexName'] } {
  const b = m.bench
  if (!b) return { name: 'intelligence' }
  if (cat === 'code' && b.coding != null) return { value: b.coding, name: 'coding' }
  if (cat === 'agentic' && b.agentic != null) return { value: b.agentic, name: 'agentic' }
  if (cat === 'agentic' && b.coding != null) return { value: b.coding, name: 'coding' }
  return { value: b.intelligence, name: 'intelligence' }
}

function percentile(values: number[], q: number): number | undefined {
  if (!values.length) return undefined
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]
}

/** En tu equipo: el modelo lo dice, o su proveedor es local (Ollama, LM Studio, vLLM…). */
function isLocal(m: ModelInfo, localProviders?: Set<string>): boolean {
  return Boolean(m.local || m.source === 'local' || localProviders?.has(m.providerId))
}

function costOf(m: ModelInfo, p: TaskProfile, local: boolean): number | undefined {
  if (local) return 0
  if (m.priceIn == null || m.priceOut == null) return undefined
  return (p.inTokens * m.priceIn + p.outTokens * m.priceOut) / 1_000_000
}

function pickOf(m: ModelInfo, p: TaskProfile, usage: ModelUsage[], local: boolean): ModelPick {
  const u = usage.find((x) => x.providerId === m.providerId && x.model === m.id)
  const idx = indexOf(m, p.category)
  const tps = u && u.avgTps > 0 ? u.avgTps : undefined
  return {
    model: m,
    index: idx.value,
    indexName: idx.name,
    cost: costOf(m, p, local),
    seconds: tps ? (u!.avgTtft || 0) / 1000 + p.outTokens / tps : undefined,
    elo: u?.elo,
    runs: u?.runs
  }
}

/** Menos es mejor: coste conocido primero, después más nivel y tu Elo. */
function cheaper(a: ModelPick, b: ModelPick): number {
  const ca = a.cost ?? Infinity
  const cb = b.cost ?? Infinity
  if (ca !== cb) return ca - cb
  if ((b.index ?? 0) !== (a.index ?? 0)) return (b.index ?? 0) - (a.index ?? 0)
  return (b.elo ?? 0) - (a.elo ?? 0)
}

export function recommend(
  profile: TaskProfile,
  models: ModelInfo[],
  usage: ModelUsage[],
  market: ModelInfo[],
  opts: { cliAgents?: CliAgent[]; quotas?: Quota[]; localProviders?: string[] } = {}
): Recommendation {
  const localSet = new Set(opts.localProviders ?? [])
  const local = (m: ModelInfo): boolean => isLocal(m, localSet)
  const excluded = { tools: 0, vision: 0, context: 0 }
  const fits: ModelInfo[] = []
  for (const m of models) {
    if (NOT_CHAT.test(m.id)) continue
    if (profile.needsTools && m.caps?.tools !== true) {
      excluded.tools++
      continue
    }
    if (profile.needsVision && !(m.modalities ?? []).includes('image') && m.caps?.attachments !== true) {
      excluded.vision++
      continue
    }
    // Un agente no lo mete todo a la vez: cuenta la vuelta más grande, no la suma.
    const perCall = profile.needsTools ? 30_000 : profile.inTokens + profile.outTokens
    if (m.contextLength && m.contextLength < perCall) {
      excluded.context++
      continue
    }
    fits.push(m)
  }

  const picks = fits.filter((m) => !local(m)).map((m) => pickOf(m, profile, usage, false))
  const rated = picks.filter((p) => p.index != null)
  const unrated = picks.length - rated.length

  // El listón, con el mercado entero (si no hay catálogo, con lo que tienes).
  const pool = (market.length ? market : models).filter((m) => !NOT_CHAT.test(m.id))
  const values = pool.map((m) => indexOf(m, profile.category).value).filter((v): v is number => v != null)
  const threshold = percentile(values, BAR[profile.difficulty] ?? 0.5)

  const out: Recommendation = { profile, threshold, belowBar: false, unrated, excluded, subscriptions: [] }

  if (rated.length) {
    const pass = rated.filter((p) => threshold == null || (p.index ?? 0) >= threshold)
    if (pass.length) {
      out.sufficient = [...pass].sort(cheaper)[0]
      // Equilibrada: más nivel sólo si sale a cuenta. Cada vez que el precio se
      // dobla respecto a la suficiente tiene que ganar al menos 10 puntos.
      const base = Math.max(out.sufficient.cost ?? 0, 1e-5)
      const score = (p: ModelPick): number => (p.index ?? 0) - 10 * Math.log2(Math.max(p.cost ?? Infinity, 1e-5) / base)
      out.balanced = [...pass].filter((p) => p.cost != null).sort((a, b) => score(b) - score(a) || cheaper(a, b))[0] ?? out.sufficient
    } else {
      out.belowBar = true
      out.sufficient = [...rated].sort((a, b) => (b.index ?? 0) - (a.index ?? 0) || cheaper(a, b))[0]
      out.balanced = out.sufficient
    }
    out.best = [...rated].sort((a, b) => (b.index ?? 0) - (a.index ?? 0) || cheaper(a, b))[0]
  }

  // Los locales no tienen puntuación pública: el tuyo con mejor Elo o, si no, el más grande.
  if (profile.difficulty <= 3) {
    const locals = fits.filter(local).map((m) => pickOf(m, profile, usage, true))
    out.local = locals.sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0) || (b.model.sizeBytes ?? 0) - (a.model.sizeBytes ?? 0))[0]
  }

  // Tus suscripciones: los agentes de consola gastan de su plan, no de dólares.
  for (const agent of opts.cliAgents ?? []) {
    const cmd = agent.command.toLowerCase().split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/, '')
    const qs = (opts.quotas ?? []).filter((q) => q.agents?.includes(cmd) && q.usedPct != null && (q.kind === 'window' || q.kind === 'budget'))
    const tight = qs.sort((a, b) => (b.usedPct ?? 0) - (a.usedPct ?? 0))[0]
    out.subscriptions.push({ agent, quota: tight, leftPct: tight ? Math.max(0, Math.round(100 - (tight.usedPct ?? 0))) : undefined })
  }
  out.subscriptions.sort((a, b) => (b.leftPct ?? -1) - (a.leftPct ?? -1))
  return out
}

// Para las pruebas y la consola de depuración, como el motor.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__accRecommend = { classifyByRules, recommend, estimateTokens }
}
