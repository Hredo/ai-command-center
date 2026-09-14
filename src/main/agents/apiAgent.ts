/**
 * Modo agente para los modelos por API.
 *
 * Hasta ahora un modelo por API sólo conversaba: le llegaban el árbol del
 * proyecto y el README en el prompt de sistema y contestaba con texto. Podía
 * explicar cómo arreglar algo, pero no arreglarlo. Aquí se le dan herramientas
 * (ver tools.ts) y se entra en el bucle de cualquier agente: el modelo pide una
 * herramienta, se ejecuta, se le devuelve el resultado y sigue, hasta que
 * contesta sin pedir nada más.
 *
 * Cada familia de proveedores habla de herramientas a su manera, así que hay un
 * adaptador por dialecto que guarda la conversación en su formato nativo:
 * OpenAI y compatibles, Ollama, Anthropic y Google.
 */
import { randomUUID } from 'node:crypto'
import { describeCall, executeTool, needsApproval, toolsFor, type AgentTool, type ToolResult } from './tools'
import { lines, readError } from '../providers/http'
import { readUsageLimit } from '../providers/limits'
import { applyAnthropicEffort, applyGoogleEffort, applyOllamaEffort, applyOpenAiEffort, stripEffort } from '../effort'
import type { AgentStep, ChatMessage, FileTouch, ProviderDef, RunOptions, UsageLimit } from '@shared/types'

/** Rondas de herramientas por petición: un modelo que entra en bucle no gira para siempre. */
const MAX_ROUNDS = 40
/** Para el modelo que acaba una vuelta sin decir nada después de usar herramientas. */
const NUDGE =
  'No has escrito ninguna respuesta. Si la última herramienta dio error, corrígelo y sigue (por ejemplo, repite la edición con un fragmento que sea único). Si ya has terminado, resume en una o dos frases qué has hecho.'
/**
 * Fallos seguidos de la misma herramienta sobre lo mismo: al tercero se le
 * avisa y al sexto se le para. Un modelo pequeño puede quedarse repitiendo una
 * edición que no encaja hasta agotar las vueltas y acabar sin decir nada.
 */
const STUCK_WARN = 3
const STUCK_STOP = 6

/**
 * Ventana de contexto que se le pide a Ollama en modo agente.
 *
 * Por omisión Ollama reserva unos pocos miles de tokens y, cuando se llenan,
 * recorta el principio de la conversación sin avisar: tras leer dos archivos
 * el modelo habría olvidado qué se le pidió. 16k entran en una GPU de 8 GB con
 * un modelo de 8B, apurando.
 */
export const OLLAMA_AGENT_CTX = 16_384

export interface AgentCtx {
  def: ProviderDef
  base: string
  key: string
  opts: RunOptions
  /** Raíz del proyecto: todas las herramientas trabajan dentro. */
  root: string
  signal: AbortSignal
  onText: (t: string) => void
  onReasoning: (t: string) => void
  onLimit: (l: UsageLimit | undefined) => void
  /** Un paso nuevo, o uno que ya existía con más datos. */
  onStep: (step: AgentStep) => void
  onTouch: (path: string, kind: FileTouch['kind']) => void
  /** Algo ha cambiado en disco: toca volver a contar los archivos. */
  onEdited: () => void
  onContext: (used: number) => void
  /** Espera a que el usuario diga sí o no. */
  askApproval: (step: AgentStep) => Promise<boolean>
}

export interface AgentTotals {
  inTokens: number
  outTokens: number
  cached: number
  reasoning: number
  /** Nanosegundos de generación, sólo Ollama. */
  evalNs: number
  exact: boolean
  rounds: number
  toolCalls: number
  contextUsed?: number
}

interface ToolCall {
  id: string
  name: string
  args: any
  /** Los argumentos llegaron rotos: se le devuelve el error al modelo. */
  argError?: string
  /** Id tal cual lo mandó el proveedor, si lo mandó. */
  providerId?: string
}

interface Turn {
  calls: ToolCall[]
  inTokens: number
  outTokens: number
  cached: number
  reasoning: number
  evalNs?: number
  exact: boolean
  /** Lo que ocupa la conversación tras esta vuelta. */
  context?: number
}

interface Emit {
  text: (t: string) => void
  reasoning: (t: string) => void
}

interface Dialect {
  turn: (emit: Emit) => Promise<Turn>
  pushResults: (calls: ToolCall[], results: ToolResult[]) => void
  /** Quita la vuelta muda del asistente y le deja un aviso del usuario. */
  nudge: (text: string) => void
}

/* ------------------------------------------------------------------ *
 * Comunes                                                            *
 * ------------------------------------------------------------------ */

function newCallId(): string {
  return 'call_' + randomUUID().replace(/-/g, '').slice(0, 12)
}

function abortError(): Error {
  const e = new Error('parado por el usuario')
  e.name = 'AbortError'
  return e
}

function history(opts: RunOptions): ChatMessage[] {
  const msgs: ChatMessage[] = opts.messages?.length ? opts.messages : [{ role: 'user', content: opts.prompt }]
  return msgs.filter((m) => m.role !== 'system' && m.content)
}

function parseArgs(raw: unknown, name: string): { args: any; argError?: string } {
  if (raw && typeof raw === 'object') return { args: raw }
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { args: {} }
  try {
    const parsed = JSON.parse(text)
    return { args: parsed && typeof parsed === 'object' ? parsed : {} }
  } catch {
    return {
      args: {},
      argError: `Los argumentos de ${name} no son JSON válido: ${text.slice(0, 200)}. Repite la llamada con JSON correcto.`
    }
  }
}

/**
 * Un modelo que no sabe usar herramientas lo dice con un 400. Se traduce a
 * algo que se entienda, porque aquí no se cae en silencio a modo charla: el
 * usuario pidió un agente.
 */
function providerError(def: ProviderDef, model: string, msg: string): Error {
  const noTools =
    /(does not|doesn't|do not|not) support.{0,30}(tool|function)/i.test(msg) ||
    /(tool|function)s?.{0,40}(not supported|unsupported|not enabled)/i.test(msg)
  if (noTools) {
    return new Error(
      `${model} no admite herramientas en ${def.name}, así que no puede trabajar como agente. ` +
        `Elige un modelo que las admita o desactiva el modo agente para conversar con él. (${msg})`
    )
  }
  return new Error(msg)
}

/** Las instrucciones de trabajo, delante del prompt de sistema del usuario. */
function agentInstructions(root: string, tools: AgentTool[]): string {
  const canEdit = tools.some((t) => t.kind === 'edit' || t.kind === 'write')
  const canRun = tools.some((t) => t.kind === 'run')
  return [
    'Eres un agente de programación que trabaja dentro del proyecto del usuario, en su equipo con Windows.',
    `La raíz del proyecto es ${root}. Las rutas que pases a las herramientas son relativas a esa raíz.`,
    'Tienes herramientas para mirar el proyecto' +
      (canEdit ? ', modificar archivos' : '') +
      (canRun ? ' y ejecutar comandos' : '') +
      '. Úsalas tú en vez de decirle al usuario qué abrir, qué copiar o qué lanzar.',
    'Antes de hablar del código, míralo: busca con search_text o find_files y lee con read_file. No inventes el contenido de archivos que no has leído.',
    canEdit
      ? 'Cuando te pidan un cambio, hazlo en los archivos. Lee cada archivo antes de editarlo y usa edit_file con un fragmento exacto y único del archivo actual; write_file sólo para archivos nuevos o para reescribir uno entero.'
      : 'Estás en modo sólo lectura: investiga y propone un plan concreto, con archivos y cambios, pero no puedes modificar nada.',
    canRun
      ? 'Los comandos se ejecutan con PowerShell en la raíz del proyecto. El usuario puede tener que aprobarlos y puede rechazarlos.'
      : '',
    'Si una herramienta devuelve un error, corrige la llamada y sigue. Al terminar, resume en pocas líneas qué has hecho y en qué archivos.'
  ]
    .filter(Boolean)
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * OpenAI y compatibles                                               *
 * ------------------------------------------------------------------ */

function openAiDialect(ctx: AgentCtx, tools: AgentTool[], system: string): Dialect {
  const { def, base, key, opts, signal } = ctx
  const messages: any[] = [
    { role: 'system', content: system },
    ...history(opts).map((m) => ({ role: m.role, content: m.content }))
  ]
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  if (def.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://localhost/ai-command-center'
    headers['X-Title'] = 'AI Command Center'
  }
  const toolDefs = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
  let variant: 'max_tokens' | 'max_completion_tokens' = 'max_tokens'
  let effort = true

  const post = (): Promise<Response> => {
    const body: any = {
      model: opts.model,
      messages,
      tools: toolDefs,
      stream: true,
      stream_options: { include_usage: true }
    }
    body[variant] = opts.maxTokens ?? 8192
    if (variant === 'max_tokens' && opts.temperature != null) body.temperature = opts.temperature
    if (effort) applyOpenAiEffort(body, opts.effort, def.id)
    return fetch(`${base}/chat/completions`, { method: 'POST', signal, headers, body: JSON.stringify(body) })
  }

  return {
    async turn(emit) {
      let res = await post()
      // Igual que en el chat: los modelos nuevos rechazan max_tokens y hay
      // compatibles que no conocen el esfuerzo. Se adapta y se reintenta.
      if (res.status === 400) {
        const msg = await readError(res)
        if (variant === 'max_tokens' && /max_completion_tokens|max_tokens|temperature/i.test(msg)) {
          variant = 'max_completion_tokens'
        } else if (effort && /reasoning|effort/i.test(msg)) {
          effort = false
        } else {
          throw providerError(def, opts.model, msg)
        }
        res = await post()
      }
      ctx.onLimit(readUsageLimit(res.headers, def.name))
      if (!res.ok) throw providerError(def, opts.model, await readError(res))

      const turn: Turn = { calls: [], inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: false }
      const acc = new Map<number, { id: string; name: string; args: string }>()
      let text = ''
      for await (const line of lines(res)) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let evt: any
        try {
          evt = JSON.parse(payload)
        } catch {
          continue
        }
        if (evt.error) throw providerError(def, opts.model, evt.error.message ?? 'Error del proveedor')
        const delta = evt.choices?.[0]?.delta
        if (delta?.content) {
          text += delta.content
          emit.text(delta.content)
        }
        if (delta?.reasoning_content) emit.reasoning(delta.reasoning_content)
        else if (typeof delta?.reasoning === 'string') emit.reasoning(delta.reasoning)
        // Las llamadas llegan troceadas: el nombre en un fragmento y los
        // argumentos repartidos en muchos. El índice dice a cuál pertenecen.
        for (const tc of delta?.tool_calls ?? []) {
          const idx = typeof tc.index === 'number' ? tc.index : acc.size
          const cur = acc.get(idx) ?? { id: '', name: '', args: '' }
          if (tc.id) cur.id = tc.id
          if (tc.function?.name && !cur.name) cur.name = tc.function.name
          if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments
          else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
            cur.args = JSON.stringify(tc.function.arguments)
          }
          acc.set(idx, cur)
        }
        if (evt.usage) {
          turn.inTokens = evt.usage.prompt_tokens ?? turn.inTokens
          turn.outTokens = evt.usage.completion_tokens ?? turn.outTokens
          turn.cached = evt.usage.prompt_tokens_details?.cached_tokens ?? turn.cached
          turn.reasoning = evt.usage.completion_tokens_details?.reasoning_tokens ?? turn.reasoning
          turn.exact = true
        }
      }

      const raw = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).filter((c) => c.name)
      turn.calls = raw.map((c) => ({ id: c.id || newCallId(), name: c.name, ...parseArgs(c.args, c.name) }))
      turn.context = turn.inTokens + turn.outTokens || undefined
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(turn.calls.length
          ? {
              tool_calls: turn.calls.map((c, i) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: raw[i].args || '{}' }
              }))
            }
          : {})
      })
      return turn
    },
    pushResults(calls, results) {
      calls.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: results[i].output }))
    },
    nudge(text) {
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && !last.content && !last.tool_calls) messages.pop()
      messages.push({ role: 'user', content: text })
    }
  }
}

/* ------------------------------------------------------------------ *
 * Ollama                                                             *
 * ------------------------------------------------------------------ */

function ollamaDialect(ctx: AgentCtx, tools: AgentTool[], system: string): Dialect {
  const { def, base, opts, signal } = ctx
  const messages: any[] = [
    { role: 'system', content: system },
    ...history(opts).map((m) => ({ role: m.role, content: m.content }))
  ]
  const toolDefs = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
  let think = true

  const post = (): Promise<Response> => {
    const body: any = {
      model: opts.model,
      messages,
      tools: toolDefs,
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.6,
        num_predict: opts.maxTokens ?? 8192,
        num_ctx: OLLAMA_AGENT_CTX
      }
    }
    if (think) applyOllamaEffort(body, opts.effort)
    return fetch(`${base}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(think ? body : stripEffort(body))
    })
  }

  return {
    async turn(emit) {
      let res = await post()
      if (res.status >= 400) {
        const msg = await readError(res)
        // Un modelo que no piensa rechaza el campo: se reintenta sin él.
        if (think && opts.effort && opts.effort !== 'auto' && /think/i.test(msg)) {
          think = false
          res = await post()
        } else {
          throw providerError(def, opts.model, msg)
        }
      }
      if (!res.ok) throw providerError(def, opts.model, await readError(res))

      const turn: Turn = { calls: [], inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: true }
      let text = ''
      let thinking = ''
      for await (const line of lines(res)) {
        let evt: any
        try {
          evt = JSON.parse(line)
        } catch {
          continue
        }
        if (evt.error) throw providerError(def, opts.model, String(evt.error))
        if (evt.message?.content) {
          text += evt.message.content
          emit.text(evt.message.content)
        }
        if (evt.message?.thinking) {
          thinking += evt.message.thinking
          emit.reasoning(evt.message.thinking)
        }
        for (const tc of evt.message?.tool_calls ?? []) {
          const name = String(tc.function?.name ?? '')
          if (!name) continue
          turn.calls.push({
            id: tc.id ? String(tc.id) : newCallId(),
            providerId: tc.id ? String(tc.id) : undefined,
            name,
            ...parseArgs(tc.function?.arguments, name)
          })
        }
        if (evt.done) {
          turn.inTokens = evt.prompt_eval_count ?? 0
          turn.outTokens = evt.eval_count ?? 0
          turn.evalNs = evt.eval_duration
        }
      }
      turn.context = turn.inTokens + turn.outTokens || undefined
      messages.push({
        role: 'assistant',
        content: text,
        ...(thinking ? { thinking } : {}),
        ...(turn.calls.length
          ? { tool_calls: turn.calls.map((c) => ({ ...(c.providerId ? { id: c.providerId } : {}), function: { name: c.name, arguments: c.args } })) }
          : {})
      })
      return turn
    },
    pushResults(calls, results) {
      calls.forEach((c, i) =>
        messages.push({
          role: 'tool',
          content: results[i].output,
          tool_name: c.name,
          ...(c.providerId ? { tool_call_id: c.providerId } : {})
        })
      )
    },
    nudge(text) {
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && !last.content && !last.tool_calls) messages.pop()
      messages.push({ role: 'user', content: text })
    }
  }
}

/* ------------------------------------------------------------------ *
 * Anthropic                                                          *
 * ------------------------------------------------------------------ */

function anthropicDialect(ctx: AgentCtx, tools: AgentTool[], system: string): Dialect {
  const { def, base, key, opts, signal } = ctx
  const messages: any[] = history(opts).map((m) => ({ role: m.role, content: m.content }))
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  let thinking = true

  const post = (): Promise<Response> => {
    const body: any = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 1,
      system,
      messages,
      tools: toolDefs,
      stream: true
    }
    if (thinking) applyAnthropicEffort(body, opts.effort)
    return fetch(`${base}/v1/messages`, { method: 'POST', signal, headers, body: JSON.stringify(body) })
  }

  return {
    async turn(emit) {
      let res = await post()
      if (res.status === 400) {
        const msg = await readError(res)
        if (thinking && opts.effort && opts.effort !== 'auto' && /thinking|budget/i.test(msg)) {
          thinking = false
          res = await post()
        } else {
          throw providerError(def, opts.model, msg)
        }
      }
      ctx.onLimit(readUsageLimit(res.headers, def.name))
      if (!res.ok) throw providerError(def, opts.model, await readError(res))

      const turn: Turn = { calls: [], inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: true }
      // Los bloques se guardan tal cual llegan, en orden: el pensamiento con
      // su firma tiene que volver intacto en la siguiente vuelta.
      const blocks: any[] = []
      const partial = new Map<number, string>()
      let cacheCreate = 0
      for await (const line of lines(res)) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let evt: any
        try {
          evt = JSON.parse(payload)
        } catch {
          continue
        }
        if (evt.type === 'message_start') {
          const u = evt.message?.usage ?? {}
          turn.inTokens = u.input_tokens ?? 0
          turn.cached = u.cache_read_input_tokens ?? 0
          cacheCreate = u.cache_creation_input_tokens ?? 0
        } else if (evt.type === 'content_block_start') {
          const b = { ...evt.content_block }
          if (b.type === 'tool_use') partial.set(evt.index, '')
          if (b.type === 'text') b.text = b.text ?? ''
          if (b.type === 'thinking') b.thinking = b.thinking ?? ''
          blocks[evt.index] = b
        } else if (evt.type === 'content_block_delta') {
          const b = blocks[evt.index]
          const d = evt.delta ?? {}
          if (!b) continue
          if (d.type === 'text_delta') {
            b.text += d.text ?? ''
            emit.text(d.text ?? '')
          } else if (d.type === 'thinking_delta') {
            b.thinking += d.thinking ?? ''
            emit.reasoning(d.thinking ?? '')
          } else if (d.type === 'signature_delta') {
            b.signature = (b.signature ?? '') + (d.signature ?? '')
          } else if (d.type === 'input_json_delta') {
            partial.set(evt.index, (partial.get(evt.index) ?? '') + (d.partial_json ?? ''))
          }
        } else if (evt.type === 'message_delta') {
          turn.outTokens = evt.usage?.output_tokens ?? turn.outTokens
        } else if (evt.type === 'error') {
          throw providerError(def, opts.model, evt.error?.message ?? 'Error del proveedor')
        }
      }

      const content: any[] = []
      blocks.forEach((b, i) => {
        if (!b) return
        if (b.type === 'text') {
          if (b.text) content.push({ type: 'text', text: b.text })
        } else if (b.type === 'tool_use') {
          const parsed = parseArgs(partial.get(i) ?? '', String(b.name))
          const call: ToolCall = { id: String(b.id), providerId: String(b.id), name: String(b.name), ...parsed }
          turn.calls.push(call)
          content.push({ type: 'tool_use', id: b.id, name: b.name, input: parsed.args })
        } else {
          content.push(b)
        }
      })
      turn.context = turn.inTokens + turn.cached + cacheCreate + turn.outTokens || undefined
      messages.push({ role: 'assistant', content })
      return turn
    },
    pushResults(calls, results) {
      messages.push({
        role: 'user',
        content: calls.map((c, i) => ({
          type: 'tool_result',
          tool_use_id: c.id,
          content: results[i].output,
          ...(results[i].isError ? { is_error: true } : {})
        }))
      })
    },
    nudge(text) {
      // Un turno del asistente sin contenido no se admite: se quita, y el aviso
      // va con los resultados de las herramientas en el mismo turno del usuario.
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && !last.content.some((b: any) => b.type === 'text' || b.type === 'tool_use')) {
        messages.pop()
      }
      const prev = messages[messages.length - 1]
      if (prev?.role === 'user' && Array.isArray(prev.content)) prev.content.push({ type: 'text', text })
      else messages.push({ role: 'user', content: text })
    }
  }
}

/* ------------------------------------------------------------------ *
 * Google Gemini                                                      *
 * ------------------------------------------------------------------ */

/** Gemini quiere los tipos del esquema en mayúsculas y sin `required` vacío. */
function geminiSchema(p: AgentTool['parameters']): any {
  const properties: Record<string, any> = {}
  for (const [k, v] of Object.entries(p.properties)) {
    properties[k] = { type: v.type.toUpperCase(), description: v.description }
  }
  return { type: 'OBJECT', properties, ...(p.required.length ? { required: p.required } : {}) }
}

function googleDialect(ctx: AgentCtx, tools: AgentTool[], system: string): Dialect {
  const { def, base, key, opts, signal } = ctx
  const contents: any[] = history(opts).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))
  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: geminiSchema(t.parameters)
  }))
  const url = `${base}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`
  let thinking = true

  const post = (): Promise<Response> => {
    const body: any = {
      contents,
      systemInstruction: { parts: [{ text: system }] },
      tools: [{ functionDeclarations: declarations }],
      generationConfig: { temperature: opts.temperature ?? 1, maxOutputTokens: opts.maxTokens ?? 8192 }
    }
    if (thinking) applyGoogleEffort(body, opts.effort)
    return fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  return {
    async turn(emit) {
      let res = await post()
      if (res.status === 400) {
        const msg = await readError(res)
        if (thinking && opts.effort && opts.effort !== 'auto' && /thinking/i.test(msg)) {
          thinking = false
          res = await post()
        } else {
          throw providerError(def, opts.model, msg)
        }
      }
      ctx.onLimit(readUsageLimit(res.headers, def.name))
      if (!res.ok) throw providerError(def, opts.model, await readError(res))

      const turn: Turn = { calls: [], inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: true }
      const parts: any[] = []
      for await (const line of lines(res)) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        let evt: any
        try {
          evt = JSON.parse(payload)
        } catch {
          continue
        }
        if (evt.error) throw providerError(def, opts.model, evt.error.message ?? 'Error del proveedor')
        for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text) {
            if (part.thought) emit.reasoning(part.text)
            else emit.text(part.text)
          }
          if (part.functionCall?.name) {
            const name = String(part.functionCall.name)
            turn.calls.push({
              id: part.functionCall.id ? String(part.functionCall.id) : newCallId(),
              providerId: part.functionCall.id ? String(part.functionCall.id) : undefined,
              name,
              ...parseArgs(part.functionCall.args ?? {}, name)
            })
          }
          // Se juntan los trozos de texto seguidos, pero una parte con firma
          // de pensamiento se deja tal cual: Gemini la necesita de vuelta.
          const last = parts[parts.length - 1]
          const plain = (p: any): boolean => typeof p?.text === 'string' && !p.thoughtSignature && !p.functionCall
          if (plain(part) && plain(last) && Boolean(last.thought) === Boolean(part.thought)) last.text += part.text
          else parts.push({ ...part })
        }
        if (evt.usageMetadata) {
          turn.inTokens = evt.usageMetadata.promptTokenCount ?? turn.inTokens
          turn.outTokens = evt.usageMetadata.candidatesTokenCount ?? turn.outTokens
          turn.cached = evt.usageMetadata.cachedContentTokenCount ?? turn.cached
          turn.reasoning = evt.usageMetadata.thoughtsTokenCount ?? turn.reasoning
        }
      }
      turn.context = turn.inTokens + turn.outTokens + turn.reasoning || undefined
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] })
      return turn
    },
    pushResults(calls, results) {
      contents.push({
        role: 'user',
        parts: calls.map((c, i) => ({
          functionResponse: {
            ...(c.providerId ? { id: c.providerId } : {}),
            name: c.name,
            response: results[i].isError ? { error: results[i].output } : { output: results[i].output }
          }
        }))
      })
    },
    nudge(text) {
      const last = contents[contents.length - 1]
      const said = (p: any): boolean => Boolean(p.functionCall) || (typeof p.text === 'string' && p.text !== '' && !p.thought)
      if (last?.role === 'model' && !last.parts.some(said)) contents.pop()
      const prev = contents[contents.length - 1]
      if (prev?.role === 'user') prev.parts.push({ text })
      else contents.push({ role: 'user', parts: [{ text }] })
    }
  }
}

/* ------------------------------------------------------------------ *
 * El bucle                                                           *
 * ------------------------------------------------------------------ */

async function runCall(ctx: AgentCtx, tools: AgentTool[], call: ToolCall): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name)
  // Id propio: hay servidores compatibles que numeran las llamadas desde cero
  // en cada vuelta, y dos pasos con el mismo id se pisarían en la interfaz.
  const step: AgentStep = {
    id: 'tool-' + randomUUID(),
    at: Date.now(),
    kind: 'tool',
    tool: call.name,
    target: describeCall(call.name, call.args),
    status: 'running'
  }

  if (call.argError) {
    ctx.onStep({ ...step, status: 'error', detail: call.argError })
    return { output: call.argError, isError: true }
  }
  if (!tool) {
    const output =
      ctx.opts.permissionMode === 'plan'
        ? `En modo sólo plan no puedes usar ${call.name}: no se puede modificar nada.`
        : `No existe la herramienta «${call.name}». Las disponibles son: ${tools.map((t) => t.name).join(', ')}.`
    ctx.onStep({ ...step, status: 'error', detail: output, denied: ctx.opts.permissionMode === 'plan' })
    return { output, isError: true }
  }

  let approved: AgentStep['approval']
  if (needsApproval(tool, ctx.opts.permissionMode)) {
    // Primero se deja apuntada la espera y luego se anuncia: si la respuesta
    // llegara antes de apuntarla, se perdería y el agente esperaría para siempre.
    const answer = ctx.askApproval(step)
    ctx.onStep({ ...step, approval: 'pending' })
    const ok = await answer
    if (ctx.signal.aborted) throw abortError()
    if (!ok) {
      ctx.onStep({ ...step, status: 'error', approval: 'denied', denied: true, detail: 'no lo has permitido' })
      return {
        output: 'El usuario no ha permitido esta acción. No la repitas: sigue sin ella o explica qué necesitarías.',
        isError: true
      }
    }
    approved = 'approved'
    ctx.onStep({ ...step, at: Date.now(), approval: approved })
  } else {
    ctx.onStep(step)
  }

  const t0 = Date.now()
  const r = await executeTool(call.name, call.args, ctx.root, ctx.signal)
  if (ctx.signal.aborted) throw abortError()
  if (r.touched) ctx.onTouch(r.touched.path, r.touched.kind)
  ctx.onStep({
    ...step,
    approval: approved,
    status: r.isError ? 'error' : 'ok',
    durationMs: Date.now() - t0,
    added: r.added || undefined,
    removed: r.removed || undefined,
    // De un comando interesa la salida entera, que se despliega en la fila.
    detail: tool.kind === 'run' ? r.output.slice(-4000) : r.isError ? r.output.slice(0, 400) : r.summary
  })
  if (!r.isError && (tool.kind === 'edit' || tool.kind === 'write')) ctx.onEdited()
  return r
}

export async function runAgentLoop(ctx: AgentCtx): Promise<AgentTotals> {
  const tools = toolsFor(ctx.opts.permissionMode)
  const system = [agentInstructions(ctx.root, tools), ctx.opts.systemPrompt].filter(Boolean).join('\n\n')
  const dialect =
    ctx.def.kind === 'anthropic'
      ? anthropicDialect(ctx, tools, system)
      : ctx.def.kind === 'google'
        ? googleDialect(ctx, tools, system)
        : ctx.def.kind === 'ollama'
          ? ollamaDialect(ctx, tools, system)
          : openAiDialect(ctx, tools, system)

  const totals: AgentTotals = {
    inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, evalNs: 0, exact: true, rounds: 0, toolCalls: 0
  }
  let wrote = false
  let nudged = false
  const streaks = new Map<string, number>()

  for (let round = 1; ; round++) {
    if (ctx.signal.aborted) throw abortError()
    // Lo que diga en una vuelta nueva va en párrafo aparte: si no, el «Voy a
    // leer el archivo» de antes y el «Listo» de después saldrían pegados.
    let fresh = true
    const emit: Emit = {
      text: (t) => {
        if (!t) return
        if (fresh && wrote) ctx.onText('\n\n')
        fresh = false
        wrote = true
        ctx.onText(t)
      },
      reasoning: (t) => {
        if (t) ctx.onReasoning(t)
      }
    }

    const turn = await dialect.turn(emit)
    totals.rounds = round
    totals.inTokens += turn.inTokens
    totals.outTokens += turn.outTokens
    totals.cached += turn.cached
    totals.reasoning += turn.reasoning
    totals.evalNs += turn.evalNs ?? 0
    totals.exact = totals.exact && turn.exact
    if (turn.context) {
      totals.contextUsed = turn.context
      ctx.onContext(turn.context)
    }

    if (!turn.calls.length) {
      // Los modelos pequeños a veces se callan justo después de un error de
      // herramienta y la respuesta llega vacía. Se les empuja una vez para que
      // lo corrijan o, al menos, cuenten qué han hecho.
      if (fresh && totals.toolCalls > 0 && !nudged) {
        nudged = true
        dialect.nudge(NUDGE)
        continue
      }
      break
    }
    if (round >= MAX_ROUNDS) {
      ctx.onStep({
        id: 'max-rounds',
        at: Date.now(),
        kind: 'note',
        status: 'error',
        detail: `Se ha parado tras ${MAX_ROUNDS} vueltas de herramientas sin terminar. Pídele que siga si hace falta.`
      })
      emit.text(`La app ha parado al agente tras ${MAX_ROUNDS} vueltas de herramientas sin terminar. Pídele que siga si hace falta.`)
      break
    }

    const results: ToolResult[] = []
    for (const call of turn.calls) {
      if (ctx.signal.aborted) throw abortError()
      totals.toolCalls++
      results.push(await runCall(ctx, tools, call))
    }
    dialect.pushResults(turn.calls, results)

    let stuck: { key: string; n: number } | null = null
    for (let i = 0; i < turn.calls.length; i++) {
      const c = turn.calls[i]
      const key = `${c.name} ${describeCall(c.name, c.args)}`.trim()
      const n = results[i].isError ? (streaks.get(key) ?? 0) + 1 : 0
      streaks.set(key, n)
      if (n >= STUCK_WARN && (!stuck || n > stuck.n)) stuck = { key, n }
    }
    if (stuck && stuck.n >= STUCK_STOP) {
      const detail = `${stuck.n} intentos seguidos de «${stuck.key}» han fallado sin avanzar.`
      ctx.onStep({ id: 'stuck', at: Date.now(), kind: 'note', status: 'error', detail })
      emit.text(`La app ha parado al agente: ${detail} Revisa los pasos o dile cómo seguir.`)
      break
    }
    if (stuck && stuck.n === STUCK_WARN) {
      dialect.nudge(
        `Llevas ${STUCK_WARN} intentos seguidos de ${stuck.key} y todos fallan. No lo repitas igual: vuelve a leer el archivo y cambia de enfoque (por ejemplo, reescríbelo entero con write_file), o explica qué te lo impide.`
      )
    }
  }

  return totals
}
