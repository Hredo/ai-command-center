/**
 * La parte local del recomendador: un modelo de Ollama lee la tarea y dice de
 * qué tipo es y cuánto cuesta hacerla. Nada sale del equipo.
 *
 * Se le pide JSON con esquema (salidas estructuradas de Ollama) y la ventana
 * entera del modelo, como en todo lo que se le manda. A los que razonan se les
 * pide que no lo hagan: aquí cuenta la rapidez, y la pregunta es sencilla.
 */
import { ollamaBase, modelContextMax, modelCapabilities } from './ollama'
import { layaPredict, type LayaQuestion } from './laya'
import type { LayaClassification } from '@shared/types'

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

/* ------------------------------------------------------------------ *
 * Laya                                                               *
 * ------------------------------------------------------------------ */

/**
 * Las preguntas que se le hacen a Laya. Son las que se midieron con tareas en
 * español etiquetadas a mano: sí/no por separado da mejor la dificultad que
 * una puntuación (que sale casi constante), y el tipo sale mejor juntando las
 * dos formas de preguntarlo. Van en español porque así acierta más.
 */
const LAYA_QUESTIONS: Record<string, LayaQuestion> = {
  code: { type: 'noul', instructions: '¿Pide escribir, arreglar o explicar código de programación?' },
  agentic: {
    type: 'noul',
    instructions: '¿Pide cambiar un proyecto o repositorio entero: varios archivos, ejecutar comandos, pruebas, commits o desplegar?'
  },
  reasoning: { type: 'noul', instructions: '¿Es un problema de matemáticas, lógica, algoritmos o análisis que exige razonar?' },
  writing: { type: 'noul', instructions: '¿Pide redactar, resumir, traducir, corregir o reescribir un texto?' },
  design: { type: 'noul', instructions: '¿Pide diseñar algo visual: una interfaz, una página, un logo o colores?' },
  trivial: { type: 'noul', instructions: '¿Es una tarea trivial que se resuelve en una o dos frases?' },
  expert: { type: 'noul', instructions: '¿Es una tarea muy difícil que exige conocimiento experto o mucho trabajo?' },
  tools: { type: 'noul', instructions: '¿Hay que abrir o cambiar archivos o ejecutar comandos en el ordenador?' },
  vision: { type: 'noul', instructions: '¿Hay que mirar una imagen, foto o captura?' },
  think: { type: 'noul', instructions: '¿Hace falta pensar con calma varios pasos antes de responder?' },
  category: {
    type: 'choice',
    instructions: '¿Qué tipo de tarea le pide el usuario a una IA?',
    criteria: {
      code: 'escribir, arreglar o explicar un trozo de código concreto',
      agentic: 'trabajar sobre un proyecto entero: varios archivos, ejecutar comandos, pruebas, commits',
      reasoning: 'matemáticas, lógica, análisis o razonamiento paso a paso',
      writing: 'redactar, resumir, traducir o reescribir texto',
      design: 'interfaz, diseño visual o gráfico',
      general: 'pregunta general o charla'
    }
  }
}

/** Lo que contesta Laya: probabilidad de «sí» de cada pregunta y el reparto del tipo. */
export async function classifyWithLaya(text: string): Promise<LayaClassification> {
  const t0 = Date.now()
  const { answers, ms } = await layaPredict(text, LAYA_QUESTIONS)
  const yes: Record<string, number> = {}
  for (const k of Object.keys(LAYA_QUESTIONS)) {
    if (k === 'category') continue
    const v = Number(answers[k]?.noul)
    yes[k] = Number.isFinite(v) ? v : 0.5
  }
  const category: Record<string, number> = {}
  for (const [k, v] of Object.entries(answers['category']?.probabilities ?? {})) category[k] = Number(v) || 0
  return { yes, category, ms: ms ?? Date.now() - t0 }
}
