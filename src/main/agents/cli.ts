import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { getConfig } from '../config'
import { addRun } from '../runs'
import { recordUsage, recordCliLimit } from '../usage'
import { composePrompt } from '../attach'
import { cliEffortArgs, cliModelArgs, cliPermissionArgs } from '../effort'
import { contextLimitFor } from '../providers/models'
import { snapshot, changesSince, type GitSnapshot } from '../git'
import type {
  AgentStep, CliAgent, CliLimit, CliRunOptions, FileChange, FileTouch, RunRecord
} from '@shared/types'

export type CliEventFn = (e: {
  type: 'stdout' | 'stderr' | 'exit' | 'meta' | 'reasoning' | 'files' | 'usage' | 'step' | 'limit'
  data?: string
  code?: number
  run?: RunRecord
  files?: FileChange[]
  touched?: FileTouch[]
  contextUsed?: number
  contextLimit?: number
  step?: AgentStep
  limit?: CliLimit
  cliSessionId?: string
}) => void

const running = new Map<string, ChildProcess>()

export function killCli(runId: string): boolean {
  const child = running.get(runId)
  if (!child) return false
  // En Windows hay que matar el árbol: el .cmd lanza un node hijo.
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
  running.delete(runId)
  return true
}

/** Escapado para la línea de comandos de cmd.exe. */
function cmdEscape(arg: string): string {
  if (!/[\s"^&|<>()%!]/.test(arg)) return arg
  return '"' + arg.replace(/"/g, '""') + '"'
}

/** Comillas simples de PowerShell: dentro sólo hay que doblar la comilla. */
function psQuote(arg: string): string {
  return "'" + arg.replace(/'/g, "''") + "'"
}

/**
 * Cómo lanzar el agente en Windows.
 *
 * Los CLIs instalados con npm son .cmd, así que hay que pasar por un shell.
 * Con cmd.exe eso tiene un límite duro: un argumento con saltos de línea no
 * sobrevive —se comprobó, y el prompt llegaba cortado en la primera línea—.
 * Cuando algún argumento trae saltos se usa PowerShell y ese argumento viaja
 * por una variable de entorno, que sí los conserva enteros.
 */
function windowsLaunch(
  command: string,
  args: string[]
): { file: string; argv: string[]; env: Record<string, string> } {
  const multiline = args.some((a) => a.includes('\n') || a.includes('\r'))
  if (!multiline) {
    const cmdline = [command, ...args].map(cmdEscape).join(' ')
    return { file: 'cmd.exe', argv: ['/d', '/s', '/c', cmdline], env: {} }
  }

  const env: Record<string, string> = {}
  const pieces = args.map((a, i) => {
    if (!a.includes('\n') && !a.includes('\r')) return psQuote(a)
    const name = `ACC_ARG_${i}`
    env[name] = a
    return `$env:${name}`
  })
  const script = `& ${psQuote(command)} ${pieces.join(' ')}`
  return {
    file: 'powershell.exe',
    argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    env
  }
}

function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4))
}

interface AgentMeta {
  costUsd?: number
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  model?: string
  numTurns?: number
  result?: string
  /** Contexto ocupado según el propio agente. */
  contextUsed?: number
  /** Ventana del modelo según el propio agente, que es mejor que el catálogo. */
  contextLimit?: number
  finishReason?: string
  /** Por qué se rindió el agente, cuando lo dice él mismo. */
  error?: string
  /** La dirección a la que no pudo llegar, si la da. */
  errorUrl?: string
  ttftMs?: number
  /** Con qué permisos dice el agente que ha arrancado. */
  permissionMode?: string
}

/**
 * Lo que hay que recordar entre líneas del stream: la sesión, el directorio
 * y las herramientas lanzadas que todavía no han devuelto resultado.
 */
interface ClaudeCtx {
  sessionId?: string
  cwd?: string
  pending: Map<string, { step: AgentStep; tool: string; input: any }>
}

/**
 * De qué herramienta se puede deducir que un archivo se toca, y con qué
 * intención: leer no es lo mismo que escribir. Los nombres cambian de un
 * agente a otro, así que se reconocen por parecido.
 */
function touchKind(tool: string): FileTouch['kind'] | null {
  const t = tool.toLowerCase()
  if (/^(read|view|open|cat)/.test(t)) return 'read'
  if (/^(edit|multiedit|apply_patch|patch|str_replace|notebookedit)/.test(t)) return 'edit'
  if (/^(write|create)/.test(t)) return 'write'
  if (/^(bash|shell|run|exec|terminal)/.test(t)) return 'run'
  if (/^(grep|glob|search|find|list|ls)/.test(t)) return 'search'
  return null
}

function pathFromToolInput(input: any): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  for (const k of ['file_path', 'filePath', 'path', 'notebook_path', 'file', 'target_file', 'pattern']) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** Toques acumulados por archivo e intención. */
class Touches {
  private map = new Map<string, FileTouch>()
  add(path: string, kind: FileTouch['kind']): void {
    const key = kind + '\u0000' + path
    const prev = this.map.get(key)
    if (prev) prev.count++
    else this.map.set(key, { path, kind, count: 1 })
  }
  list(): FileTouch[] {
    return [...this.map.values()].sort((a, b) => b.count - a.count)
  }
  get size(): number {
    return this.map.size
  }
}

/* ------------------------------------------------------------------ *
 * Pasos: lo que el agente va haciendo                                *
 * ------------------------------------------------------------------ */

/** Una ruta larga cansa de leer: se enseña desde la carpeta del proyecto. */
function shortPath(p: string, cwd?: string): string {
  let out = p.replace(/\\/g, '/')
  if (cwd) {
    const base = cwd.replace(/\\/g, '/').replace(/\/$/, '')
    if (out.toLowerCase().startsWith(base.toLowerCase() + '/')) out = out.slice(base.length + 1)
  }
  return out.length > 90 ? '…' + out.slice(-89) : out
}

function oneLine(s: string, max = 120): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/**
 * Sobre qué actúa una herramienta, en una línea legible: la ruta del archivo,
 * el comando, el patrón de búsqueda o la dirección. Si no se reconoce, se deja
 * vacío en vez de enseñar el JSON de sus argumentos.
 */
function describeTool(tool: string, input: any, cwd?: string): string {
  if (!input || typeof input !== 'object') return ''
  const t = tool.toLowerCase()
  const file = pathFromToolInput(input)
  if (/^(bash|shell|run|exec|terminal|powershell)/.test(t)) {
    return oneLine(String(input.command ?? input.cmd ?? input.script ?? ''))
  }
  if (/^(grep|search)/.test(t)) {
    const where = input.path ? ' en ' + shortPath(String(input.path), cwd) : ''
    return oneLine(String(input.pattern ?? '') + where)
  }
  if (/^(webfetch|fetch)/.test(t)) return oneLine(String(input.url ?? ''))
  if (/^websearch/.test(t)) return oneLine(String(input.query ?? ''))
  if (/^task/.test(t)) return oneLine(String(input.description ?? input.subagent_type ?? ''))
  if (/^todowrite/.test(t)) {
    const n = Array.isArray(input.todos) ? input.todos.length : 0
    return n ? `${n} tarea${n === 1 ? '' : 's'}` : ''
  }
  if (file) return shortPath(file, cwd)
  return oneLine(String(input.description ?? input.prompt ?? ''), 90)
}

/** Nombre de la herramienta como para enseñarlo: sin el prefijo de MCP. */
function toolLabel(tool: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool)
  if (m) return m[2] + ' (' + m[1] + ')'
  return tool
}

/** Líneas añadidas y quitadas de un parche estructurado de Claude Code. */
function patchCounts(patch: any): { added: number; removed: number } | null {
  if (!Array.isArray(patch) || patch.length === 0) return null
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    for (const line of hunk?.lines ?? []) {
      const c = String(line)[0]
      if (c === '+') added++
      else if (c === '-') removed++
    }
  }
  return { added, removed }
}

/** Cuando no hay parche, se cuenta a ojo con lo que pedía la herramienta. */
function editCounts(tool: string, input: any): { added: number; removed: number } | null {
  if (!input || typeof input !== 'object') return null
  // Un texto que acaba en salto de línea no tiene una línea más al final:
  // "a\nb\n" son dos líneas, no tres.
  const lines = (s: unknown): number => {
    if (typeof s !== 'string' || !s.length) return 0
    const n = s.split('\n').length
    return s.endsWith('\n') ? n - 1 : n
  }
  const t = tool.toLowerCase()
  if (t.startsWith('write')) return { added: lines(input.content), removed: 0 }
  if (t.startsWith('edit')) return { added: lines(input.new_string), removed: lines(input.old_string) }
  if (t.startsWith('multiedit') && Array.isArray(input.edits)) {
    let added = 0
    let removed = 0
    for (const e of input.edits) {
      added += lines(e?.new_string)
      removed += lines(e?.old_string)
    }
    return { added, removed }
  }
  return null
}

/** Resumen de lo que devolvió una herramienta, para la línea de tiempo. */
function describeResult(tool: string, result: any, content: any): string | undefined {
  const t = tool.toLowerCase()
  // "File created successfully at: C:\...\x.ts" no aporta nada: el archivo ya
  // sale como destino del paso y el +/- dice cuánto cambió. Se calla.
  if (t.startsWith('write') || t.startsWith('edit') || t.startsWith('multiedit')) return undefined
  if (result && typeof result === 'object') {
    if (typeof result.numFiles === 'number') return `${result.numFiles} archivo${result.numFiles === 1 ? '' : 's'}`
    if (typeof result.numMatches === 'number') return `${result.numMatches} coincidencia${result.numMatches === 1 ? '' : 's'}`
    if (typeof result.numLines === 'number') return `${result.numLines} líneas`
    if (result.file && typeof result.file.numLines === 'number') return `${result.file.numLines} líneas`
    if (typeof result.stdout === 'string' && result.stdout.trim()) return oneLine(result.stdout, 160)
    if (typeof result.stderr === 'string' && result.stderr.trim()) return oneLine(result.stderr, 160)
  }
  if (typeof content === 'string' && content.trim()) return oneLine(content, 160)
  if (Array.isArray(content)) {
    const text = content.find((c: any) => c?.type === 'text' && typeof c.text === 'string')
    if (text) return oneLine(text.text, 160)
  }
  void t
  return undefined
}

/**
 * Claude Code con --output-format stream-json emite una línea JSON por evento,
 * incluida una final con coste y uso reales. Eso nos da métricas exactas.
 */
interface ParseSink {
  onText: (t: string) => void
  onThink: (t: string) => void
  onTouch: (path: string, kind: FileTouch['kind']) => void
  onUsage: () => void
  /** Un paso nuevo, o uno que ya existía y ahora tiene resultado. */
  onStep: (step: AgentStep) => void
  onLimit: (limit: CliLimit) => void
  onSession: (id: string) => void
}

function parseClaudeLine(line: string, meta: AgentMeta, sink: ParseSink, ctx: ClaudeCtx): void {
  let evt: any
  try {
    evt = JSON.parse(line)
  } catch {
    return
  }

  if (evt.session_id && !ctx.sessionId) {
    ctx.sessionId = String(evt.session_id)
    sink.onSession(ctx.sessionId)
  }

  // El arranque dice con qué modelo y con qué permisos va a trabajar.
  if (evt.type === 'system' && evt.subtype === 'init') {
    if (evt.model) meta.model = evt.model
    if (evt.cwd) ctx.cwd = String(evt.cwd)
    if (evt.permissionMode) meta.permissionMode = String(evt.permissionMode)
    const tools = Array.isArray(evt.tools) ? evt.tools.length : 0
    sink.onStep({
      id: 'init',
      at: Date.now(),
      kind: 'note',
      detail:
        `Arranca ${evt.model ?? 'el agente'}` +
        (evt.permissionMode ? ` · permisos: ${evt.permissionMode}` : '') +
        (tools ? ` · ${tools} herramientas` : ''),
      status: 'ok'
    })
    return
  }

  // La ventana de uso del plan: el propio agente dice cuál es y cuándo se
  // reinicia. El tope no lo publica, así que eso no se enseña.
  if (evt.type === 'rate_limit_event' && evt.rate_limit_info) {
    const info = evt.rate_limit_info
    sink.onLimit({
      type: String(info.rateLimitType ?? 'desconocida'),
      status: String(info.status ?? ''),
      resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined,
      usingOverage: Boolean(info.isUsingOverage)
    })
    return
  }

  // El resultado de una herramienta: cierra el paso que estaba en marcha.
  if (evt.type === 'user' && Array.isArray(evt.message?.content)) {
    for (const block of evt.message.content) {
      if (block?.type !== 'tool_result') continue
      const open = ctx.pending.get(String(block.tool_use_id))
      if (!open) continue
      ctx.pending.delete(String(block.tool_use_id))

      const result = evt.tool_use_result ?? evt.toolUseResult
      const patch = patchCounts(result?.structuredPatch)
      const counts = patch ?? editCounts(open.tool, open.input)
      const isError = Boolean(block.is_error) || Boolean(result?.is_error)

      sink.onStep({
        ...open.step,
        status: isError ? 'error' : 'ok',
        durationMs:
          typeof result?.durationMs === 'number' ? result.durationMs : Date.now() - open.step.at,
        added: counts?.added || undefined,
        removed: counts?.removed || undefined,
        detail: describeResult(open.tool, result, block.content) ?? open.step.detail
      })
    }
    return
  }

  if (evt.type === 'assistant' && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === 'text' && block.text) sink.onText(block.text)
      // El razonamiento tal como lo publica el agente. Si no lo publica no se
      // muestra nada: no se reconstruye adivinando sobre la salida.
      else if (block.type === 'thinking' && block.thinking) {
        sink.onThink(block.thinking)
        sink.onStep({
          id: block.signature ? 'th-' + String(block.signature).slice(0, 12) : 'th-' + randomUUID(),
          at: Date.now(),
          kind: 'thinking',
          detail: block.thinking,
          status: 'ok'
        })
      } else if (block.type === 'redacted_thinking') sink.onThink('[pensamiento cifrado por el proveedor]')
      else if (block.type === 'tool_use') {
        const tool = String(block.name ?? '')
        const kind = touchKind(tool)
        const path = pathFromToolInput(block.input)
        if (kind && path) sink.onTouch(path, kind)

        const step: AgentStep = {
          id: String(block.id ?? randomUUID()),
          at: Date.now(),
          kind: 'tool',
          tool: toolLabel(tool),
          target: describeTool(tool, block.input, ctx.cwd),
          status: 'running'
        }
        ctx.pending.set(step.id, { step, tool, input: block.input })
        sink.onStep(step)
      }
    }
    const u = evt.message.usage
    if (u) {
      meta.inputTokens = (meta.inputTokens ?? 0) + (u.input_tokens ?? 0)
      meta.outputTokens = (meta.outputTokens ?? 0) + (u.output_tokens ?? 0)
      meta.cachedTokens = (meta.cachedTokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      // Lo que ocupa la conversación ahora: entrada, caché y salida del turno.
      const ctx =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.output_tokens ?? 0)
      if (ctx > (meta.contextUsed ?? 0)) meta.contextUsed = ctx
      sink.onUsage()
    }
    if (evt.message.model) meta.model = evt.message.model
  } else if (evt.type === 'result') {
    meta.costUsd = evt.total_cost_usd ?? meta.costUsd
    meta.durationMs = evt.duration_ms ?? meta.durationMs
    meta.numTurns = evt.num_turns
    meta.result = evt.result
    if (typeof evt.ttft_ms === 'number') meta.ttftMs = evt.ttft_ms
    if (evt.stop_reason) meta.finishReason = String(evt.stop_reason)
    if (evt.usage) {
      meta.inputTokens = evt.usage.input_tokens ?? meta.inputTokens
      meta.outputTokens = evt.usage.output_tokens ?? meta.outputTokens
      meta.cachedTokens = evt.usage.cache_read_input_tokens ?? meta.cachedTokens
    }

    // modelUsage trae la ventana de contexto real del modelo que ha usado,
    // que es mejor dato que el del catálogo.
    const usage = evt.modelUsage && typeof evt.modelUsage === 'object' ? evt.modelUsage : null
    if (usage) {
      const [name, u] = Object.entries<any>(usage)[0] ?? []
      if (name && !meta.model) meta.model = name
      if (u?.contextWindow) meta.contextLimit = u.contextWindow
    }

    // Lo que quiso hacer y no pudo, porque no tenía permiso: se enseña, que
    // es justo lo que explica por qué una tarea se quedó a medias.
    for (const denial of evt.permission_denials ?? []) {
      const tool = String(denial?.tool_name ?? denial?.tool ?? 'una herramienta')
      sink.onStep({
        id: 'denied-' + randomUUID(),
        at: Date.now(),
        kind: 'tool',
        tool: toolLabel(tool),
        target: describeTool(tool, denial?.tool_input ?? denial?.input, ctx.cwd),
        detail: 'no tenía permiso para hacerlo',
        status: 'error',
        denied: true
      })
    }

    // Cualquier herramienta que se quedara sin resultado se cierra: si no, la
    // línea de tiempo se queda con un paso girando para siempre.
    for (const [id, open] of ctx.pending) {
      sink.onStep({ ...open.step, status: 'ok', durationMs: Date.now() - open.step.at })
      ctx.pending.delete(id)
    }

    sink.onUsage()
  } else if (evt.type === 'system' && evt.model) {
    meta.model = evt.model
  }
}

/**
 * OpenCode con --format json emite un evento por línea. Los campos van
 * dentro de `part`, y de ahí salen texto, razonamiento, herramientas y —en
 * step-finish— los tokens y el coste reales del proveedor.
 */
function parseOpencodeLine(line: string, meta: AgentMeta, sink: ParseSink): void {
  let evt: any
  try {
    evt = JSON.parse(line)
  } catch {
    return
  }
  const part = evt.part ?? evt
  const kind = String(part.type ?? evt.type ?? '')

  // Cuando OpenCode se rinde (sin red, sin saldo, una clave mala…) lo cuenta
  // en un evento de error y sale. Sin leerlo sólo quedaba el código de salida.
  if (kind === 'error') {
    const err = evt.error ?? {}
    const message = String(err.data?.message ?? err.message ?? err.name ?? 'error sin detalle')
    meta.error = message
    if (typeof err.data?.metadata?.url === 'string') meta.errorUrl = err.data.metadata.url
    sink.onStep({ id: 'error', at: Date.now(), kind: 'note', status: 'error', detail: message })
    return
  }
  if (kind === 'text' && typeof part.text === 'string') {
    sink.onText(part.text)
    return
  }
  if (kind === 'reasoning' && typeof part.text === 'string') {
    sink.onThink(part.text)
    return
  }
  if (kind === 'tool' || kind === 'tool-invocation' || part.tool) {
    const tool = String(part.tool ?? part.name ?? '')
    const input = part.state?.input ?? part.input ?? part.state?.args
    const k = touchKind(tool)
    const path = pathFromToolInput(input)
    if (k && path) sink.onTouch(path, k)

    // OpenCode manda la misma herramienta varias veces según avanza: el id
    // del part identifica el paso, así que la fila se actualiza en su sitio.
    const state = String(part.state?.status ?? part.status ?? '')
    const counts = editCounts(tool, input)
    sink.onStep({
      id: String(part.id ?? part.callID ?? tool + ':' + (path ?? '')),
      at: Date.now(),
      kind: 'tool',
      tool: toolLabel(tool),
      target: describeTool(tool, input),
      status: state === 'error' ? 'error' : state === 'completed' ? 'ok' : 'running',
      added: counts?.added || undefined,
      removed: counts?.removed || undefined,
      detail:
        typeof part.state?.output === 'string' ? oneLine(part.state.output, 160) : undefined
    })
    return
  }
  if (kind === 'step-finish' || kind === 'step_finish') {
    const t = part.tokens
    if (t) {
      meta.inputTokens = (meta.inputTokens ?? 0) + (t.input ?? 0)
      meta.outputTokens = (meta.outputTokens ?? 0) + (t.output ?? 0)
      meta.reasoningTokens = (meta.reasoningTokens ?? 0) + (t.reasoning ?? 0)
      meta.cachedTokens = (meta.cachedTokens ?? 0) + (t.cache?.read ?? 0)
      // `total` de OpenCode es justo lo que ocupa el contexto del paso.
      if (typeof t.total === 'number' && t.total > (meta.contextUsed ?? 0)) meta.contextUsed = t.total
    }
    if (typeof part.cost === 'number') meta.costUsd = (meta.costUsd ?? 0) + part.cost
    if (part.reason) meta.finishReason = String(part.reason)
    meta.numTurns = (meta.numTurns ?? 0) + 1
    sink.onUsage()
  }
}

/** Lo que puede tardar la comprobación de DNS antes de darla por perdida. */
const DNS_CHECK_MS = 4000

/**
 * El agente no llegó a su API y su mensaje —«¿hay una errata en la URL o el
 * puerto?»— manda a buscar donde no es. Se mira si el nombre se resuelve: en
 * las redes que filtran dominios (eduroam no resuelve opencode.ai) el fallo
 * está ahí, y decirlo ahorra la búsqueda.
 */
async function explainUnreachable(message: string, url?: string): Promise<string> {
  if (!url || !/cannot connect|unable to connect|typo in the url|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) {
    return message
  }
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return message
  }
  let timer: NodeJS.Timeout | undefined
  const resolved = await Promise.race([
    lookup(host).then(
      () => 'ok',
      (err: NodeJS.ErrnoException) => err.code ?? 'error'
    ),
    new Promise<string>((r) => {
      timer = setTimeout(() => r('timeout'), DNS_CHECK_MS)
    })
  ]).finally(() => clearTimeout(timer))

  if (resolved === 'ok') {
    return `${message} · ${host} sí se resuelve: lo que falla es la conexión (cortafuegos, proxy o el servicio caído).`
  }
  return (
    `${message} · ${host} no se resuelve desde esta red (${resolved}): el DNS no da ninguna dirección. ` +
    'O no hay conexión o la red bloquea ese dominio; con otra red, o con un proveedor al que sí llegue, el agente funcionará.'
  )
}

/**
 * Dónde encajar los argumentos de esfuerzo.
 *
 * Si la plantilla empieza por una opción, van delante de todo; si empieza por
 * un subcomando, justo detrás. Así no se cuelan entre una opción y su valor,
 * que es la forma más fácil de romper la línea de comandos.
 */
function injectArgs(template: string[], extra: string[]): string[] {
  if (extra.length === 0) return template
  if (template.length === 0) return [...extra]
  const at = template[0].startsWith('-') ? 0 : 1
  return [...template.slice(0, at), ...extra, ...template.slice(at)]
}

/**
 * Lanza un agente de línea de comandos dentro de un proyecto.
 * Si la plantilla de argumentos no incluye {{prompt}}, el prompt va por stdin,
 * que evita cualquier problema de escapado con textos largos.
 */
export async function runCliAgent(
  opts: CliRunOptions,
  onEvent: CliEventFn,
  runId: string = randomUUID()
): Promise<RunRecord> {
  // La foto del repositorio se toma antes de arrancar el agente. Si se tomara
  // después, sus primeros cambios contarían como si ya estuvieran ahí.
  let gitSnap: GitSnapshot | null = null
  if (opts.projectPath) {
    try {
      gitSnap = await snapshot(opts.projectPath)
    } catch {
      gitSnap = null
    }
  }
  return startCliAgent(opts, onEvent, runId, gitSnap)
}

function startCliAgent(
  opts: CliRunOptions,
  onEvent: CliEventFn,
  runId: string,
  gitSnap: GitSnapshot | null
): Promise<RunRecord> {
  return new Promise((resolve) => {
    const cfg = getConfig()
    const agent: CliAgent | undefined = cfg.cliAgents.find((a) => a.id === opts.agentId)
    const startedAt = Date.now()

    const finish = (run: RunRecord): void => {
      running.delete(runId)
      addRun(run)
      onEvent({ type: 'exit', code: run.status === 'ok' ? 0 : 1, run })
      resolve(run)
    }

    const baseRun = (): RunRecord => ({
      id: runId,
      createdAt: startedAt,
      kind: opts.kind ?? 'cli',
      providerId: 'cli:' + (agent?.command ?? 'desconocido'),
      model: agent?.name ?? 'CLI',
      agentId: opts.agentId,
      agentName: agent?.name,
      projectId: opts.projectId,
      projectName: opts.projectName,
      arenaId: opts.arenaId,
      conversationId: opts.conversationId,
      prompt: opts.prompt,
      response: '',
      status: 'ok',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalMs: 0,
      costIn: 0,
      costOut: 0,
      costTotal: 0,
      costEstimated: true
    })

    if (!agent) {
      const run = baseRun()
      run.status = 'error'
      run.error = `Agente CLI no encontrado: ${opts.agentId}`
      run.totalMs = 0
      finish(run)
      return
    }

    // A un agente de línea de comandos se le pasan las rutas de los adjuntos:
    // tiene herramientas para abrirlos y así el prompt no se infla.
    const prompt = composePrompt(opts.prompt, opts.attachments, 'cli')

    const effortArgs = cliEffortArgs(agent.command, opts.effort)
    // El modelo y el modo de permisos de esta ejecución mandan sobre los que
    // tenga guardados el agente.
    const modelArgs = cliModelArgs(agent.command, opts.model ?? agent.model)
    const permissionArgs = cliPermissionArgs(agent.command, opts.permissionMode ?? agent.permissionMode)
    const extra = [...(effortArgs ?? []), ...(modelArgs ?? []), ...(permissionArgs ?? [])]

    const usesArgPrompt = agent.args.some((a) => a.includes('{{prompt}}'))
    const args = injectArgs(agent.args, extra).map((a) =>
      a.replace('{{prompt}}', prompt).replace('{{projectPath}}', opts.projectPath)
    )

    // En la Arena se puede lanzar un CLI sin proyecto: entonces trabaja en el
    // directorio del usuario en vez de fallar por un cwd que no existe.
    const cwd = opts.projectPath && existsSync(opts.projectPath) ? opts.projectPath : homedir()

    let child: ChildProcess
    try {
      if (process.platform === 'win32') {
        // Los CLIs de npm son .cmd: Node exige pasar por el shell para ejecutarlos.
        const launch = windowsLaunch(agent.command, args)
        child = spawn(launch.file, launch.argv, {
          cwd,
          windowsHide: true,
          env: { ...process.env, ...(agent.env ?? {}), ...launch.env },
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } else {
        child = spawn(agent.command, args, {
          cwd,
          env: { ...process.env, ...(agent.env ?? {}) },
          stdio: ['pipe', 'pipe', 'pipe']
        })
      }
    } catch (e: any) {
      const run = baseRun()
      run.status = 'error'
      run.error = `No se pudo lanzar "${agent.command}": ${e?.message ?? e}`
      run.totalMs = Date.now() - startedAt
      finish(run)
      return
    }

    running.set(runId, child)

    if (!usesArgPrompt) {
      child.stdin?.write(prompt)
      child.stdin?.end()
    } else {
      child.stdin?.end()
    }

    const meta: AgentMeta = {}
    const touches = new Touches()
    let text = ''
    let reasoning = ''
    let rawOut = ''
    let errOut = ''
    let ttftMs: number | undefined
    let stdoutBuf = ''
    let contextLimit: number | undefined

    // La línea de tiempo de lo que va haciendo. Los pasos se identifican por
    // id: cuando una herramienta devuelve, se actualiza el suyo en su sitio
    // en vez de añadir una fila nueva.
    const steps: AgentStep[] = []
    const stepIndex = new Map<string, number>()
    let cliLimit: CliLimit | undefined
    const claudeCtx: ClaudeCtx = { pending: new Map(), cwd: opts.projectPath }

    const onStep = (step: AgentStep): void => {
      const at = stepIndex.get(step.id)
      if (at == null) {
        stepIndex.set(step.id, steps.length)
        steps.push(step)
      } else {
        steps[at] = { ...steps[at], ...step }
      }
      onEvent({ type: 'step', step: at == null ? step : steps[stepIndex.get(step.id)!] })
    }

    const onLimit = (limit: CliLimit): void => {
      cliLimit = limit
      // Se guarda fuera de la ejecución: la ventana de 5 horas sigue viva
      // aunque esta tarea haya terminado.
      recordCliLimit(limit)
      onEvent({ type: 'limit', limit })
    }

    const onSession = (id: string): void => {
      onEvent({ type: 'step', step: { id: 'session', at: Date.now(), kind: 'note', status: 'ok',
        detail: `Sesión ${id}` }, cliSessionId: id })
    }

    // El comando exacto y lo que no se le pudo pedir van como notas de la
    // línea de tiempo, no metidos dentro de la respuesta.
    onStep({
      id: 'cmd',
      at: Date.now(),
      kind: 'note',
      status: 'ok',
      detail: `$ ${agent.command} ${args.join(' ')}`
    })
    if (effortArgs === null && opts.effort && opts.effort !== 'auto') {
      onStep({
        id: 'sin-esfuerzo',
        at: Date.now(),
        kind: 'note',
        status: 'ok',
        detail: `${agent.command} no tiene opción de esfuerzo: va con la suya por omisión`
      })
    }
    if (modelArgs === null && (opts.model ?? agent.model)) {
      onStep({
        id: 'sin-modelo',
        at: Date.now(),
        kind: 'note',
        status: 'ok',
        detail: `${agent.command} no deja elegir el modelo desde aquí: usa el suyo`
      })
    }

    const onText = (t: string): void => {
      if (ttftMs === undefined) ttftMs = Date.now() - startedAt
      text += t
    }

    const onThink = (t: string): void => {
      if (!t) return
      if (ttftMs === undefined) ttftMs = Date.now() - startedAt
      reasoning += t
      onEvent({ type: 'reasoning', data: t })
    }

    const onTouch = (path: string, kind: FileTouch['kind']): void => {
      const before = touches.size
      touches.add(path, kind)
      if (touches.size !== before) onEvent({ type: 'files', touched: touches.list() })
    }

    const onUsage = (): void => {
      // Lo que dice el propio agente manda; el catálogo es el respaldo.
      if (meta.contextLimit) contextLimit = meta.contextLimit
      if (contextLimit === undefined && meta.model) {
        contextLimit = contextLimitFor(agent.parser === 'claude-stream-json' ? 'anthropic' : '', meta.model)
      }
      onEvent({ type: 'usage', contextUsed: meta.contextUsed, contextLimit })
      // El agente de línea de comandos también cuenta como «lo que estoy
      // usando»: se guarda aparte para el panel de consumo.
      recordUsage({
        providerId: 'cli:' + agent.id,
        providerName: agent.name,
        model: meta.model,
        contextUsed: meta.contextUsed,
        contextLimit
      })
    }

    const sink: ParseSink = { onText, onThink, onTouch, onUsage, onStep, onLimit, onSession }

    // Mientras trabaja se va mirando qué archivos cambian, para que no haya
    // que esperar al final para ver dónde está tocando.
    let polling = false
    const watch = gitSnap
      ? setInterval(() => {
          if (polling) return
          polling = true
          void changesSince(gitSnap)
            .then((files) => onEvent({ type: 'files', files }))
            .catch(() => undefined)
            .finally(() => {
              polling = false
            })
        }, 2500)
      : null
    const stopWatch = (): void => {
      if (watch) clearInterval(watch)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      rawOut += s
      if (agent.parser === 'claude-stream-json' || agent.parser === 'opencode-json') {
        stdoutBuf += s
        let nl: number
        while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, nl).trim()
          stdoutBuf = stdoutBuf.slice(nl + 1)
          if (line) {
            const before = text.length
            if (agent.parser === 'claude-stream-json') parseClaudeLine(line, meta, sink, claudeCtx)
            else parseOpencodeLine(line, meta, sink)
            if (text.length > before) onEvent({ type: 'stdout', data: text.slice(before) })
          }
        }
      } else {
        if (ttftMs === undefined) ttftMs = Date.now() - startedAt
        text += s
        onEvent({ type: 'stdout', data: s })
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      errOut += s
      onEvent({ type: 'stderr', data: s })
    })

    child.on('error', (err) => {
      stopWatch()
      const run = baseRun()
      run.status = 'error'
      run.error = `${err.message}. ¿Está "${agent.command}" en el PATH?`
      run.totalMs = Date.now() - startedAt
      run.response = text
      finish(run)
    })

    child.on('close', (code) => {
      stopWatch()
      const totalMs = Date.now() - startedAt
      const finalText = meta.result ?? text ?? rawOut
      // Si el agente avisó de un error y no dio respuesta, es un fallo aunque
      // salga con 0.
      const failed = code !== 0 || (meta.error != null && !finalText.trim())
      const inTok = meta.inputTokens ?? estimateTokens(opts.prompt)
      const outTok = meta.outputTokens ?? estimateTokens(finalText)
      if (meta.ttftMs != null) ttftMs = meta.ttftMs
      const genMs = ttftMs ? totalMs - ttftMs : totalMs

      const run: RunRecord = {
        ...baseRun(),
        model: meta.model ?? agent.name,
        response: finalText,
        status: failed ? 'error' : 'ok',
        // Lo que dice el agente vale más que el final de stderr, que suele ir vacío.
        error: failed ? meta.error ?? (errOut.slice(-1500) || `Salió con código ${code}`) : undefined,
        finishReason: meta.finishReason,
        promptTokens: inTok,
        completionTokens: outTok,
        totalTokens: inTok + outTok,
        cachedTokens: meta.cachedTokens,
        reasoningTokens: meta.reasoningTokens || undefined,
        ttftMs,
        totalMs: meta.durationMs ?? totalMs,
        tokensPerSec: genMs > 0 ? outTok / (genMs / 1000) : 0,
        costIn: 0,
        costOut: 0,
        costTotal: meta.costUsd ?? 0,
        // Claude Code y OpenCode devuelven el coste real; otros CLIs no dicen nada.
        costEstimated: meta.costUsd == null,
        notes: meta.numTurns ? `${meta.numTurns} turnos` : undefined,
        effort: opts.effort && opts.effort !== 'auto' ? opts.effort : undefined,
        attachmentCount: opts.attachments?.length || undefined,
        contextLimit,
        contextUsed: meta.contextUsed,
        branch: gitSnap?.branch,
        filesTouched: touches.size ? touches.list() : undefined,
        steps: steps.length ? steps : undefined,
        cliLimit,
        cliSessionId: claudeCtx.sessionId,
        permissionMode: meta.permissionMode ?? opts.permissionMode ?? agent.permissionMode,
        source: 'app'
      }

      const pending: Promise<unknown>[] = []
      if (failed && meta.error) {
        pending.push(explainUnreachable(meta.error, meta.errorUrl).then((why) => (run.error = why)))
      }
      // El recuento final se hace después de que el agente haya cerrado, que
      // es cuando el disco ya está quieto.
      if (gitSnap) {
        pending.push(
          changesSince(gitSnap).then((files) => {
            if (files.length) run.filesChanged = files
          })
        )
      }
      if (pending.length) void Promise.allSettled(pending).then(() => finish(run))
      else finish(run)
    })
  })
}
