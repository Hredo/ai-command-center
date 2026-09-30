/**
 * Baterías de prompts: su definición vive en la configuración y sus
 * resultados en un fichero aparte (baterias.json), que crece con cada pasada
 * y no tiene por qué viajar con cada lectura de la configuración.
 *
 * El juez es un modelo local de Ollama que puntúa una respuesta con una
 * rúbrica. Es una opinión, no una medida: se guarda y se enseña como tal, con
 * el modelo que la dio.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'
import { writeFileAtomic } from './atomic'
import { getConfig, saveConfig, upsert } from './config'
import { ollamaBase, modelContextMax, modelCapabilities } from './ollama'
import type { AppConfig, Battery, BatteryRun } from '@shared/types'

/** Pasadas que se guardan: las más viejas se van. */
const MAX_RUNS = 60

const file = (): string => join(paths.dir, 'baterias.json')

function load(): BatteryRun[] {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as BatteryRun[]) : []
  } catch {
    return []
  }
}

export function saveBattery(b: Battery): AppConfig {
  if (!b?.id || typeof b.name !== 'string' || !Array.isArray(b.cases)) throw new Error('Batería no válida')
  const clean: Battery = {
    ...b,
    name: b.name.trim().slice(0, 120) || 'Batería',
    cases: b.cases.slice(0, 200).map((c) => ({ ...c, prompt: String(c.prompt ?? ''), checks: (c.checks ?? []).slice(0, 20) }))
  }
  const cfg = getConfig()
  return saveConfig({ ...cfg, batteries: upsert(cfg.batteries ?? [], clean) })
}

export function removeBattery(id: string): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, batteries: (cfg.batteries ?? []).filter((b) => b.id !== id) })
}

export function batteryRuns(batteryId?: string): BatteryRun[] {
  const all = load().sort((a, b) => b.at - a.at)
  return batteryId ? all.filter((r) => r.batteryId === batteryId) : all
}

export function saveBatteryRun(run: BatteryRun): boolean {
  if (!run?.id || !run.batteryId || !Array.isArray(run.cells)) throw new Error('Resultado no válido')
  const rest = load().filter((r) => r.id !== run.id)
  const next = [run, ...rest].sort((a, b) => b.at - a.at).slice(0, MAX_RUNS)
  writeFileAtomic(file(), JSON.stringify(next))
  return true
}

export function removeBatteryRun(id: string): boolean {
  const all = load()
  const next = all.filter((r) => r.id !== id)
  if (next.length === all.length) return false
  writeFileAtomic(file(), JSON.stringify(next))
  return true
}

const JUDGE = [
  'Eres un juez. Puntúas del 1 al 10 cuánto cumple una respuesta con una rúbrica, sin tener en cuenta nada más.',
  '1 es que no la cumple en absoluto y 10 que la cumple por completo.',
  'Devuelve JSON con score (entero de 1 a 10) y reason (una frase que explique la nota).'
].join('\n')

const SCHEMA = {
  type: 'object',
  properties: { score: { type: 'integer', minimum: 1, maximum: 10 }, reason: { type: 'string' } },
  required: ['score', 'reason']
}

/** La nota del juez local. Nada sale del equipo. */
export async function judgeWithOllama(
  model: string,
  input: { rubric: string; prompt: string; response: string }
): Promise<{ score: number; reason: string }> {
  const [ctx, caps] = await Promise.all([modelContextMax(model), modelCapabilities(model)])
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 120_000)
  try {
    const res = await fetch(`${ollamaBase()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: SCHEMA,
        ...(caps.includes('thinking') ? { think: false } : {}),
        options: { temperature: 0, ...(ctx ? { num_ctx: ctx } : {}) },
        messages: [
          { role: 'system', content: JUDGE },
          {
            role: 'user',
            content: `Tarea que se pidió:\n${input.prompt.slice(0, 8000)}\n\nRúbrica:\n${input.rubric.slice(0, 4000)}\n\nRespuesta que juzgas:\n${input.response.slice(0, 20_000)}`
          }
        ]
      })
    })
    if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json: any = await res.json()
    const out = JSON.parse(String(json?.message?.content ?? '{}'))
    const score = Math.min(10, Math.max(1, Math.round(Number(out.score) || 1)))
    return { score, reason: String(out.reason ?? '').slice(0, 400) }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`${model} tardó demasiado en juzgar`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}
