/**
 * La parte local del recomendador: un modelo de Ollama lee la tarea y dice de
 * qué tipo es y cuánto cuesta hacerla. Nada sale del equipo.
 *
 * Se le pide JSON con esquema (salidas estructuradas de Ollama) y la ventana
 * entera del modelo, como en todo lo que se le manda. A los que razonan se les
 * pide que no lo hagan: aquí cuenta la rapidez, y la pregunta es sencilla.
 */
import { ollamaBase, modelContextMax, modelCapabilities } from './ollama'

export interface LocalClassification {
  category: 'code' | 'agentic' | 'reasoning' | 'writing' | 'design' | 'general'
  difficulty: number
  needsTools: boolean
  needsVision: boolean
  ms: number
}

const CATEGORIES = ['code', 'agentic', 'reasoning', 'writing', 'design', 'general'] as const

const SYSTEM = [
  'Clasificas tareas que un usuario quiere encargar a una IA. No haces la tarea: sólo la describes.',
  'Devuelve JSON con:',
  '- category: code (escribir o arreglar código concreto), agentic (trabajar sobre un proyecto entero: varios archivos, ejecutar comandos, pruebas), reasoning (matemáticas, lógica, análisis), writing (redactar, resumir, traducir), design (interfaces, diseño visual), general (lo demás).',
  '- difficulty: 1 trivial (un hola mundo, una pregunta corta), 2 sencilla, 3 normal, 4 difícil, 5 muy difícil (sistemas complejos, producción, mucha ambigüedad).',
  '- needsTools: true si hay que abrir o cambiar archivos o ejecutar cosas.',
  '- needsVision: true si hay que mirar imágenes.'
].join('\n')

const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...CATEGORIES] },
    difficulty: { type: 'integer', minimum: 1, maximum: 5 },
    needsTools: { type: 'boolean' },
    needsVision: { type: 'boolean' }
  },
  required: ['category', 'difficulty', 'needsTools', 'needsVision']
}

export async function classifyWithOllama(text: string, model: string): Promise<LocalClassification> {
  const t0 = Date.now()
  const [ctx, caps] = await Promise.all([modelContextMax(model), modelCapabilities(model)])
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 45_000)
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
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text.slice(0, 12_000) }
        ]
      })
    })
    if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json: any = await res.json()
    const out = JSON.parse(String(json?.message?.content ?? '{}'))
    const category = CATEGORIES.includes(out.category) ? out.category : 'general'
    const difficulty = Math.min(5, Math.max(1, Math.round(Number(out.difficulty) || 3)))
    return { category, difficulty, needsTools: out.needsTools === true, needsVision: out.needsVision === true, ms: Date.now() - t0 }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`${model} tardó demasiado en clasificar`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}
