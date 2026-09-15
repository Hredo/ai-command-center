/**
 * Gestión de Ollama desde la app: estado, arranque del servidor, y descarga,
 * borrado y recomendación de modelos.
 *
 * Las recomendaciones no son una lista fija de tamaños a ojo: hay una lista de
 * candidatos con su ficha, pero el peso real de cada uno se consulta al
 * registro de Ollama y la puntuación se calcula con la VRAM de la máquina.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cpus, totalmem, homedir } from 'node:os'
import { join } from 'node:path'
import { getConfig } from './config'
import { effectiveBaseUrl, providerById } from './providers/catalog'
import type {
  GpuInfo, HardwareInfo, ModelRecommendation, OllamaModel, OllamaStatus, PullProgress
} from '@shared/types'

const REGISTRY = 'https://registry.ollama.ai/v2/library'

export function ollamaBase(): string {
  const def = providerById('ollama')!
  const override = getConfig().providers['ollama']?.baseUrl
  return effectiveBaseUrl(def, override) || 'http://127.0.0.1:11434'
}

function run(cmd: string, args: string[], timeout = 8000): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ out: (stdout || stderr || '').toString().trim(), code: err ? 1 : 0 })
    })
  })
}

/** Rutas habituales del ejecutable en Windows, además del PATH. */
function findBinary(): string | undefined {
  if (process.platform === 'win32') {
    const candidates = [
      join(homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe'
    ]
    const hit = candidates.find((p) => existsSync(p))
    if (hit) return hit
  } else {
    for (const p of ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama']) {
      if (existsSync(p)) return p
    }
  }
  return undefined
}

/** timeoutMs <= 0 significa sin límite: las descargas duran lo que duran. */
async function api(path: string, init?: RequestInit, timeoutMs = 6000): Promise<Response> {
  if (timeoutMs <= 0) return fetch(ollamaBase() + path, init)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(ollamaBase() + path, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ *
 * Estado                                                             *
 * ------------------------------------------------------------------ */

export async function ollamaStatus(): Promise<OllamaStatus> {
  const binPath = findBinary()
  const base = ollamaBase()
  const out: OllamaStatus = { up: false, installed: Boolean(binPath), binPath, baseUrl: base, models: [] }

  try {
    const res = await api('/api/tags', undefined, 3000)
    if (!res.ok) {
      out.error = `El servidor respondió ${res.status}`
      return out
    }
    const json: any = await res.json()
    out.up = true
    out.models = (json.models ?? []).filter((m: any) => !isContextVariant(m.name ?? m.model ?? '')).map(
      (m: any): OllamaModel => ({
        name: m.name ?? m.model,
        sizeBytes: m.size ?? 0,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        family: m.details?.family,
        contextLength: m.details?.context_length,
        modifiedAt: m.modified_at ? Date.parse(m.modified_at) : undefined,
        capabilities: m.capabilities
      })
    )
  } catch (err: any) {
    out.error = err?.name === 'AbortError' ? 'El servidor no responde' : (err?.message ?? String(err))
    return out
  }

  try {
    const v = await api('/api/version', undefined, 2500)
    if (v.ok) out.version = ((await v.json()) as { version?: string }).version
  } catch {
    // La versión es un extra: no invalida el estado.
  }
  return out
}

/**
 * Arranca el servidor. En Windows se prefiere la app de bandeja, que es como
 * lo tiene instalado el usuario y sobrevive al cierre de esta app.
 */
export async function startOllama(): Promise<{ started: boolean; detail: string }> {
  const pre = await ollamaStatus()
  if (pre.up) return { started: true, detail: 'Ya estaba corriendo' }

  const bin = findBinary()
  if (!bin) return { started: false, detail: 'No encuentro el ejecutable de Ollama en este equipo' }

  const trayApp = join(bin, '..', process.platform === 'win32' ? 'ollama app.exe' : 'ollama')
  const useTray = process.platform === 'win32' && existsSync(trayApp)

  try {
    const child = useTray
      ? spawn(trayApp, [], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch (err: any) {
    return { started: false, detail: `No se pudo lanzar: ${err?.message ?? err}` }
  }

  // El servidor tarda un par de segundos en aceptar conexiones.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const s = await ollamaStatus()
    if (s.up) return { started: true, detail: `Servidor arriba en ${((i + 1) * 0.5).toFixed(1)}s` }
  }
  return { started: false, detail: 'Lo lancé pero no llegó a responder en 10s' }
}

/* ------------------------------------------------------------------ *
 * Contexto                                                           *
 * ------------------------------------------------------------------ */

interface ModelFacts {
  context?: number
  capabilities: string[]
}

const facts = new Map<string, ModelFacts>()

/** La ficha del modelo (`/api/show`), leída una vez. */
async function modelFacts(name: string): Promise<ModelFacts | undefined> {
  const hit = facts.get(name)
  if (hit) return hit
  try {
    const res = await api('/api/show', { method: 'POST', body: JSON.stringify({ model: name }) }, 5000)
    if (!res.ok) return undefined
    const json = (await res.json()) as { model_info?: Record<string, unknown>; capabilities?: string[] }
    const info = json.model_info ?? {}
    const key = Object.keys(info).find((k) => k.endsWith('.context_length'))
    const n = key ? Number(info[key]) : NaN
    const f: ModelFacts = { context: Number.isFinite(n) && n > 0 ? n : undefined, capabilities: json.capabilities ?? [] }
    facts.set(name, f)
    return f
  } catch {
    return undefined
  }
}

/**
 * La ventana más grande que admite un modelo, según su propia ficha.
 *
 * Ollama no la usa por su cuenta: reserva unos pocos miles de tokens y, al
 * llenarse, recorta el principio de la conversación sin avisar. Por eso cada
 * petición pide la ventana entera. Ocupa más memoria —en una GPU de 8 GB parte
 * del modelo pasa a la CPU y va más lento—, pero el modelo no olvida nada.
 */
export async function modelContextMax(name: string): Promise<number | undefined> {
  return (await modelFacts(name))?.context
}

/** Lo que sabe hacer el modelo: tools, thinking, vision… */
export async function modelCapabilities(name: string): Promise<string[]> {
  return (await modelFacts(name))?.capabilities ?? []
}

/**
 * Nombre de la variante de un modelo con su ventana entera fijada.
 *
 * Quien habla con Ollama por su API compatible con OpenAI —OpenCode entre
 * otros— no puede pedir num_ctx: esa API lo ignora y el modelo se carga con
 * 4096 tokens. Las instrucciones de OpenCode ya ocupan unos 15.000, así que se
 * recortan y el modelo contesta a otra cosa. Una variante con `num_ctx` en sus
 * parámetros comparte los pesos del original, no ocupa disco y se carga siempre
 * con la ventana entera.
 */
export function contextVariantName(name: string, ctx: number): string {
  const full = name.includes(':') ? name : `${name}:latest`
  return `${full}-ctx${Math.round(ctx / 1024)}k`
}

/** Las variantes son un detalle interno: no se enseñan como modelos aparte. */
export function isContextVariant(name: string): boolean {
  return /-ctx\d+k$/.test(name)
}

const variants = new Set<string>()

/** Crea la variante si hace falta. null si el modelo no dice su ventana u Ollama no la admite. */
export async function ensureContextVariant(name: string): Promise<{ name: string; context: number } | null> {
  const context = await modelContextMax(name)
  if (!context) return null
  const variant = contextVariantName(name, context)
  if (variants.has(variant)) return { name: variant, context }
  try {
    const res = await api(
      '/api/create',
      {
        method: 'POST',
        body: JSON.stringify({ model: variant, from: name, parameters: { num_ctx: context }, stream: false })
      },
      60_000
    )
    if (!res.ok) return null
    variants.add(variant)
    return { name: variant, context }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Modelos                                                            *
 * ------------------------------------------------------------------ */

export async function deleteModel(name: string): Promise<void> {
  // Las versiones nuevas esperan "model" y las viejas "name": se mandan ambas.
  const res = await api('/api/delete', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, name })
  }, 20_000)
  if (!res.ok) throw new Error(`No se pudo borrar ${name}: ${res.status} ${await res.text()}`)
  facts.delete(name)
  // Sus variantes de ventana entera no sirven sin él.
  const full = name.includes(':') ? name : `${name}:latest`
  for (const v of [...variants].filter((v) => v.startsWith(`${full}-ctx`))) {
    variants.delete(v)
    await api('/api/delete', { method: 'DELETE', body: JSON.stringify({ model: v, name: v }) }, 20_000).catch(
      () => undefined
    )
  }
}

/** Descargas en curso, para poder cancelarlas desde la UI. */
const pulls = new Map<string, AbortController>()

export function cancelPull(name: string): boolean {
  const ctrl = pulls.get(name)
  if (!ctrl) return false
  ctrl.abort()
  pulls.delete(name)
  return true
}

export function activePulls(): string[] {
  return [...pulls.keys()]
}

/** Descarga un modelo informando del avance. Resuelve cuando termina. */
export async function pullModel(name: string, onProgress: (p: PullProgress) => void): Promise<void> {
  if (pulls.has(name)) throw new Error(`${name} ya se está descargando`)
  const ctrl = new AbortController()
  pulls.set(name, ctrl)

  try {
    await pullInner(name, ctrl, onProgress)
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      onProgress({ model: name, status: 'cancelada', done: true, error: 'Descarga cancelada' })
      return
    }
    throw err
  } finally {
    pulls.delete(name)
  }
}

async function pullInner(
  name: string,
  ctrl: AbortController,
  onProgress: (p: PullProgress) => void
): Promise<void> {
  const res = await api('/api/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, name, stream: true }),
    signal: ctrl.signal
  }, 0)

  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${name}: ${res.status}`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let lastEmit = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let evt: any
      try {
        evt = JSON.parse(line)
      } catch {
        continue
      }
      if (evt.error) throw new Error(evt.error)

      const now = Date.now()
      const finished = evt.status === 'success'
      // Se limita a ~8 avisos por segundo: si no, la UI se ahoga en eventos.
      if (finished || now - lastEmit > 120) {
        lastEmit = now
        onProgress({
          model: name,
          status: evt.status ?? 'descargando',
          completed: evt.completed,
          total: evt.total,
          done: finished
        })
      }
    }
  }
  onProgress({ model: name, status: 'listo', done: true })
}

/* ------------------------------------------------------------------ *
 * Hardware                                                           *
 * ------------------------------------------------------------------ */

let hwCache: { at: number; data: HardwareInfo } | null = null

export async function hardware(): Promise<HardwareInfo> {
  if (hwCache && Date.now() - hwCache.at < 300_000) return hwCache.data

  const list = cpus()
  const info: HardwareInfo = {
    cpu: list[0]?.model?.trim() ?? 'desconocida',
    cores: list.length,
    ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    gpus: [],
    platform: process.platform
  }

  // nvidia-smi da la VRAM exacta. Win32_VideoController miente: su AdapterRAM
  // es un entero de 32 bits y se queda topado en 4 GB.
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], 6000)
  if (smi.code === 0 && smi.out) {
    for (const line of smi.out.split(/\r?\n/)) {
      const [name, mb] = line.split(',').map((s) => s.trim())
      if (name) info.gpus.push({ name, vramMb: Number(mb) || undefined })
    }
  }

  if (process.platform === 'win32') {
    const wmi = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }'],
      8000
    )
    if (wmi.code === 0) {
      for (const name of wmi.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
        if (!info.gpus.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
          info.gpus.push({ name })
        }
      }
    }
  }

  let best: GpuInfo | undefined
  for (const g of info.gpus) if (g.vramMb && (!best || g.vramMb > (best.vramMb ?? 0))) best = g
  if (best) {
    best.primary = true
    info.bestVramMb = best.vramMb
  }

  hwCache = { at: Date.now(), data: info }
  return info
}

/* ------------------------------------------------------------------ *
 * Recomendaciones                                                    *
 * ------------------------------------------------------------------ */

/**
 * Candidatos: modelos abiertos y gratuitos que merecen la pena en local.
 * El peso se consulta al registro, así que aquí sólo va la ficha cualitativa.
 */
interface Candidate {
  name: string
  label: string
  params: string
  /** Nota de calidad general, 0-100, para ordenar entre los que caben. */
  quality: number
  role: 'general' | 'code' | 'reason' | 'small'
  contextLength?: number
  why: string
  tags: string[]
  /** Parámetros activos si es una mezcla de expertos: pesa poco al generar. */
  moeActive?: string
}

const CANDIDATES: Candidate[] = [
  {
    name: 'qwen3:8b', label: 'Qwen3 8B', params: '8B', quality: 88, role: 'general',
    contextLength: 40960, tags: ['razonamiento', 'herramientas', 'Apache 2.0'],
    why: 'El generalista más equilibrado que entra entero en 8 GB: razona, usa herramientas y va en 30 idiomas.'
  },
  {
    name: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', params: '7B', quality: 86, role: 'code',
    contextLength: 32768, tags: ['código', 'relleno de huecos', 'Apache 2.0'],
    why: 'El mejor modelo de código de su tamaño: completa, explica y corrige, con relleno de huecos.'
  },
  {
    name: 'deepseek-r1:8b', label: 'DeepSeek R1 8B', params: '8B', quality: 82, role: 'reason',
    contextLength: 131072, tags: ['cadena de pensamiento', 'MIT'],
    why: 'Razonamiento explícito paso a paso; útil para problemas donde quieres ver el porqué.'
  },
  {
    name: 'llama3.1:8b', label: 'Llama 3.1 8B', params: '8B', quality: 76, role: 'general',
    contextLength: 131072, tags: ['herramientas', '128k contexto'],
    why: 'Sólido y muy compatible, pero ya lo han superado los Qwen3 de su tamaño.'
  },
  {
    name: 'gemma3:4b', label: 'Gemma 3 4B', params: '4B', quality: 72, role: 'small',
    contextLength: 131072, tags: ['visión', 'ligero'],
    why: 'Muy ligero y además entiende imágenes. Buen comodín cuando la GPU está ocupada.'
  },
  {
    name: 'qwen3:4b', label: 'Qwen3 4B', params: '4B', quality: 74, role: 'small',
    contextLength: 40960, tags: ['razonamiento', 'ligero'],
    why: 'Rinde por encima de su tamaño y deja VRAM libre para otras cosas.'
  },
  {
    name: 'mistral-nemo:12b', label: 'Mistral Nemo 12B', params: '12B', quality: 80, role: 'general',
    contextLength: 131072, tags: ['multilingüe', 'Apache 2.0'],
    why: 'Buen multilingüe de 12B, aunque en 8 GB de VRAM ya se sale un poco.'
  },
  {
    name: 'gemma3:12b', label: 'Gemma 3 12B', params: '12B', quality: 84, role: 'general',
    contextLength: 131072, tags: ['visión', '128k contexto'],
    why: 'Más listo que los de 8B y entiende imágenes, pero no cabe entero en 8 GB.'
  },
  {
    name: 'qwen3:14b', label: 'Qwen3 14B', params: '14B', quality: 90, role: 'general',
    contextLength: 40960, tags: ['razonamiento', 'Apache 2.0'],
    why: 'Claramente mejor que los de 8B; pide 10 GB de VRAM para ir fino.'
  },
  {
    name: 'gpt-oss:20b', label: 'GPT-OSS 20B', params: '20B', quality: 92, role: 'reason',
    contextLength: 131072, tags: ['mezcla de expertos', 'Apache 2.0'], moeActive: '3.6B',
    why: 'Mezcla de expertos: sólo activa 3,6B por token, así que aguanta bien aun repartido con la RAM.'
  },
  {
    name: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B', params: '14B', quality: 89, role: 'code',
    contextLength: 32768, tags: ['código', 'Apache 2.0'],
    why: 'El salto de calidad en código sobre el de 7B, si tienes VRAM de sobra.'
  }
]

const sizeCache = new Map<string, number>()

/** Peso real de los pesos del modelo, según el manifiesto del registro. */
async function registrySize(ref: string): Promise<number | undefined> {
  if (sizeCache.has(ref)) return sizeCache.get(ref)
  const [name, tag = 'latest'] = ref.split(':')
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`${REGISTRY}/${name}/manifests/${tag}`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return undefined
    const json: any = await res.json()
    const bytes = (json.layers ?? [])
      .filter((l: any) => String(l.mediaType ?? '').includes('model'))
      .reduce((s: number, l: any) => s + (l.size ?? 0), 0)
    if (!bytes) return undefined
    sizeCache.set(ref, bytes)
    return bytes
  } catch {
    return undefined
  }
}

/**
 * Ordena los candidatos para esta máquina.
 *
 * El criterio: un modelo que entra entero en la GPU va muchísimo más rápido
 * que uno que se reparte con la RAM, así que caber pesa más que la nota de
 * calidad. Se reserva ~1,3 GB de VRAM para el escritorio y la caché de
 * atención, que también ocupa.
 */
export async function recommendations(): Promise<{ hw: HardwareInfo; installed: string[]; items: ModelRecommendation[] }> {
  const [hw, status] = await Promise.all([hardware(), ollamaStatus()])
  const installed = status.models.map((m) => m.name)

  const vramGb = hw.bestVramMb ? hw.bestVramMb / 1024 : 0
  const budgetGb = Math.max(0, vramGb - 1.3)
  const ramGb = hw.ramGb

  const sizes = await Promise.all(CANDIDATES.map((c) => registrySize(c.name)))

  const items: ModelRecommendation[] = CANDIDATES.map((c, i) => {
    const bytes = sizes[i]
    const sizeGb = bytes ? Math.round((bytes / 1e9) * 100) / 100 : 0

    let fits: ModelRecommendation['fits']
    if (sizeGb && sizeGb <= budgetGb) fits = 'gpu'
    else if (sizeGb && sizeGb <= budgetGb + ramGb * 0.5) fits = 'partial'
    else fits = 'cpu'

    // Una mezcla de expertos repartida sigue siendo rápida: se le perdona.
    const penalty = fits === 'gpu' ? 0 : fits === 'partial' ? (c.moeActive ? 8 : 26) : 55
    const headroom = fits === 'gpu' && budgetGb > 0 ? Math.min(6, (budgetGb - sizeGb) * 2) : 0

    return {
      name: c.name,
      label: c.label,
      params: c.moeActive ? `${c.params} (${c.moeActive} activos)` : c.params,
      sizeGb,
      contextLength: c.contextLength,
      why: c.why,
      fits,
      score: Math.round(c.quality - penalty + headroom),
      tags: [...c.tags, c.role === 'code' ? 'código' : c.role === 'reason' ? 'razonamiento' : 'generalista']
    }
  })
    // Sin peso conocido no se puede juzgar si cabe: fuera de la lista.
    .filter((r) => r.sizeGb > 0)
    .sort((a, b) => b.score - a.score)

  return { hw, installed, items }
}

/**
 * Los N mejores cubriendo papeles distintos: no tiene sentido recomendar dos
 * generalistas casi idénticos cuando falta uno de código.
 */
export async function bestPicks(n = 2): Promise<{ hw: HardwareInfo; items: ModelRecommendation[] }> {
  const { hw, items } = await recommendations()
  const out: ModelRecommendation[] = []
  const roles = new Set<string>()

  for (const it of items) {
    const role = it.tags.includes('código') ? 'código' : it.tags.includes('razonamiento') ? 'razonamiento' : 'generalista'
    if (roles.has(role)) continue
    roles.add(role)
    out.push(it)
    if (out.length >= n) break
  }
  for (const it of items) {
    if (out.length >= n) break
    if (!out.includes(it)) out.push(it)
  }
  return { hw, items: out }
}
