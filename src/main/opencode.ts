/**
 * OpenCode con proveedor a elegir: sus modelos de Zen o los locales de Ollama.
 *
 * OpenCode no trae Ollama configurado, y su configuración global es del
 * usuario: la app no la toca. Le pasa la suya en OPENCODE_CONFIG_CONTENT, que
 * OpenCode suma a la global, en cada ejecución y en cada terminal integrada.
 *
 * Dos cosas que no se ven desde fuera:
 *  - OpenCode habla con Ollama por su API compatible con OpenAI, que no deja
 *    pedir ventana de contexto. Con los 4096 tokens de omisión sus propias
 *    instrucciones (unos 15.000) no caben y el modelo contesta a otra cosa, así
 *    que cada modelo va por su variante de ventana entera (ensureContextVariant).
 *  - OpenCode no deduce niveles de esfuerzo para un modelo añadido a mano. Se le
 *    declaran como variantes con reasoningEffort, que Ollama respeta en los
 *    modelos que razonan.
 */
import { execFile } from 'node:child_process'
import {
  ensureContextVariant, modelCapabilities, modelContextMax, ollamaBase, ollamaStatus, startOllama
} from './ollama'
import { opencodeVariantFor } from '@shared/opencode'
import type { Effort, OpencodeModel } from '@shared/types'

/** La lista de Zen cambia poco y sacarla tarda unos segundos. */
const ZEN_TTL_MS = 10 * 60_000
/** Lo que puede tardar en montarse la configuración al abrir una terminal. */
const TERMINAL_WAIT_MS = 4000
/** Niveles que se le declaran a un modelo local que razona. */
const LOCAL_VARIANTS = ['none', 'low', 'medium', 'high']
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')

let zenCache: { at: number; models: OpencodeModel[] } | null = null

function runOpencode(args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // En Windows opencode es un .cmd de npm: hay que pasar por cmd.
    const win = process.platform === 'win32'
    execFile(
      win ? 'cmd.exe' : 'opencode',
      win ? ['/d', '/s', '/c', ['opencode', ...args].join(' ')] : args,
      { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => (err && !stdout ? reject(err) : resolve(String(stdout)))
    )
  })
}

/** `opencode models <proveedor> --verbose` saca cada modelo en una línea y su ficha en JSON debajo. */
function parseVerbose(text: string): OpencodeModel[] {
  const parts = text.replace(ANSI, '').split(/^(opencode\/\S+)\s*$/m)
  const out: OpencodeModel[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i]
    try {
      const info = JSON.parse(parts[i + 1].trim())
      out.push({
        id,
        provider: 'opencode',
        name: String(info.name ?? id.slice('opencode/'.length)),
        variants: Object.keys(info.variants ?? {}),
        context: typeof info.limit?.context === 'number' ? info.limit.context : undefined,
        free: info.cost ? !info.cost.input && !info.cost.output : undefined
      })
    } catch {
      // Una ficha que no se entiende no tumba la lista entera.
    }
  }
  return out
}

async function zenModels(force = false): Promise<OpencodeModel[]> {
  if (!force && zenCache && Date.now() - zenCache.at < ZEN_TTL_MS) return zenCache.models
  const models = parseVerbose(await runOpencode(['models', 'opencode', '--verbose']))
  if (models.length) zenCache = { at: Date.now(), models }
  return models
}

/** Los modelos de Ollama que valen para OpenCode: tienen que saber usar herramientas. */
async function localModels(): Promise<{ model: OpencodeModel; thinking: boolean }[]> {
  const status = await ollamaStatus()
  if (!status.up) return []
  const all = await Promise.all(
    status.models.map(async (m) => {
      const caps = await modelCapabilities(m.name)
      const thinking = caps.includes('thinking')
      const model: OpencodeModel = {
        id: `ollama/${m.name}`,
        provider: 'ollama',
        name: m.name,
        variants: thinking ? LOCAL_VARIANTS : [],
        context: (await modelContextMax(m.name)) ?? m.contextLength,
        free: true
      }
      return { model, thinking, tools: caps.includes('tools') }
    })
  )
  return all.filter((m) => m.tools).map(({ model, thinking }) => ({ model, thinking }))
}

/** Todo lo que se puede elegir: Zen y, si Ollama está encendido, los locales. */
export async function opencodeModels(force = false): Promise<OpencodeModel[]> {
  const [zen, local] = await Promise.all([
    zenModels(force).catch(() => [] as OpencodeModel[]),
    localModels().catch(() => [])
  ])
  return [...zen, ...local.map((l) => l.model)]
}

/**
 * Lo que se le suma a la configuración de OpenCode: el proveedor Ollama con
 * cada modelo local apuntando a su variante de ventana entera.
 */
async function ollamaProviderConfig(): Promise<{ content: string; variantOf: Map<string, string> } | null> {
  const local = await localModels()
  const models: Record<string, unknown> = {}
  const variantOf = new Map<string, string>()
  for (const { model, thinking } of local) {
    const v = await ensureContextVariant(model.name)
    if (!v) continue
    variantOf.set(model.name, v.name)
    models[v.name] = {
      name: model.name,
      tools: true,
      reasoning: thinking,
      limit: { context: v.context, output: Math.min(8192, Math.floor(v.context / 4)) },
      ...(thinking ? { variants: Object.fromEntries(LOCAL_VARIANTS.map((e) => [e, { reasoningEffort: e }])) } : {})
    }
  }
  if (!variantOf.size) return null
  const content = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      ollama: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Ollama (local)',
        options: { baseURL: `${ollamaBase()}/v1` },
        models
      }
    }
  })
  return { content, variantOf }
}

export interface OpencodeLaunch {
  /** Lo que se añade a la línea de comandos: modelo y nivel de esfuerzo. */
  args: string[]
  /** Ventana del modelo elegido, para el indicador de contexto. */
  context?: number
  env: Record<string, string>
  /** Lo que no se pudo pedir, para contarlo en la línea de tiempo. */
  notes: string[]
}

function pushVariant(out: OpencodeLaunch, variants: string[], effort: Effort | undefined, label: string): void {
  if (!effort || effort === 'auto') return
  const v = opencodeVariantFor(variants, effort)
  if (v) out.args.push('--variant', v)
  else if (variants.length) out.notes.push(`${label} no tiene un nivel de esfuerzo «${effort}»: va con el suyo`)
  else out.notes.push(`${label} no tiene niveles de esfuerzo: va con el suyo`)
}

/**
 * Modelo, esfuerzo y entorno para lanzar OpenCode. Con un modelo de Ollama se
 * enciende Ollama si hace falta. Lanza un error con el motivo si no se puede.
 */
export async function opencodeLaunch(model: string | undefined, effort: Effort | undefined): Promise<OpencodeLaunch> {
  const out: OpencodeLaunch = { args: [], env: {}, notes: [] }
  const id = (model ?? '').trim()

  if (id.startsWith('ollama/')) {
    const name = id.slice('ollama/'.length)
    const up = await startOllama()
    if (!up.started) throw new Error(`Para usar ${name} con OpenCode hace falta Ollama encendido: ${up.detail}`)
    const cfg = await ollamaProviderConfig()
    const variant = cfg?.variantOf.get(name)
    if (!cfg || !variant) {
      throw new Error(`${name} no está en Ollama o no sabe usar herramientas, y OpenCode las necesita.`)
    }
    out.env['OPENCODE_CONFIG_CONTENT'] = cfg.content
    out.args.push('-m', `ollama/${variant}`)
    out.context = await modelContextMax(name)
    const thinking = (await modelCapabilities(name)).includes('thinking')
    pushVariant(out, thinking ? LOCAL_VARIANTS : [], effort, name)
    return out
  }

  if (id) {
    out.args.push('-m', id)
    const info = (await zenModels().catch(() => [] as OpencodeModel[])).find((m) => m.id === id)
    out.context = info?.context
    pushVariant(out, info?.variants ?? [], effort, id)
  } else if (effort && effort !== 'auto') {
    out.notes.push('Sin modelo elegido OpenCode usa el suyo, y no se sabe qué niveles de esfuerzo admite')
  }
  return out
}

/**
 * Para las terminales integradas: la misma configuración, así el `/models` de
 * OpenCode enseña también los modelos de Ollama. Sólo si Ollama ya está
 * encendido, y sin hacer esperar a la terminal más de unos segundos.
 */
export async function opencodeTerminalEnv(): Promise<Record<string, string>> {
  let timer: NodeJS.Timeout | undefined
  const cfg = await Promise.race([
    ollamaProviderConfig().catch(() => null),
    new Promise<null>((r) => {
      timer = setTimeout(() => r(null), TERMINAL_WAIT_MS)
    })
  ]).finally(() => clearTimeout(timer))
  return cfg ? { OPENCODE_CONFIG_CONTENT: cfg.content } : {}
}
