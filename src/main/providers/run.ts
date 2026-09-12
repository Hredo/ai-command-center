import { randomUUID } from 'node:crypto'
import { providerById, effectiveBaseUrl } from './catalog'
import { computeCost, contextLimitFor } from './models'
import { readUsageLimit } from './limits'
import { resolveKey } from '../secrets'
import { getConfig } from '../config'
import { addRun } from '../runs'
import { recordUsage } from '../usage'
import { composePrompt } from '../attach'
import { snapshot, changesSince, type GitSnapshot } from '../git'
import {
  applyAnthropicEffort,
  applyGoogleEffort,
  applyOllamaEffort,
  applyOpenAiEffort,
  stripEffort
} from '../effort'
import type { RunRecord, RunOptions, ChatMessage, ProviderDef, UsageLimit } from '@shared/types'

export type DeltaFn = (d: {
  type: 'start' | 'text' | 'reasoning' | 'done' | 'error' | 'limit'
  text?: string
  run?: RunRecord
  error?: string
  usageLimit?: UsageLimit
  contextLimit?: number
}) => void

const inflight = new Map<string, AbortController>()

export function abortRun(runId: string): boolean {
  const c = inflight.get(runId)
  if (!c) return false
  c.abort()
  inflight.delete(runId)
  return true
}

/** Aproximación cuando el proveedor no devuelve uso real. ~4 chars por token. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

interface Usage {
  inTokens: number
  outTokens: number
  cached: number
  reasoning: number
  /** ns de generación, sólo Ollama. Da tokens/s exactos. */
  evalNs?: number
  exact: boolean
}

/** Lee un cuerpo SSE/NDJSON línea a línea sin cargarlo entero en memoria. */
async function* lines(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (line) yield line
    }
  }
  if (buffer.trim()) yield buffer.trim()
}

function buildMessages(opts: RunOptions): ChatMessage[] {
  if (opts.messages?.length) return opts.messages
  return [{ role: 'user', content: opts.prompt }]
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text)
    return j.error?.message || j.error?.type || j.message || text.slice(0, 500)
  } catch {
    return text.slice(0, 500) || `HTTP ${res.status}`
  }
}

interface StreamCtx {
  def: ProviderDef
  base: string
  key: string
  opts: RunOptions
  signal: AbortSignal
  onText: (t: string) => void
  onReasoning: (t: string) => void
  onLimit: (l: UsageLimit | undefined) => void
}

// ---------------------------------------------------------------------------
// Dialecto Anthropic
// ---------------------------------------------------------------------------
async function streamAnthropic(ctx: StreamCtx): Promise<Usage> {
  const { def, base, key, opts, signal } = ctx
  const msgs = buildMessages(opts).filter((m) => m.role !== 'system')
  const body: any = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 1,
    system: opts.systemPrompt || undefined,
    messages: msgs.map((m) => ({ role: m.role, content: m.content })),
    stream: true
  }
  applyAnthropicEffort(body, opts.effort)

  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01'
  }
  let res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(body)
  })

  // Si el modelo no admite pensamiento extendido, se reintenta sin el antes
  // de dar la ejecucion por perdida.
  if (res.status === 400 && body.thinking) {
    const msg = await readError(res)
    if (/thinking|budget/i.test(msg)) {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify(stripEffort(body))
      })
    } else {
      throw new Error(msg)
    }
  }
  ctx.onLimit(readUsageLimit(res.headers, def.name))
  if (!res.ok) throw new Error(await readError(res))

  const usage: Usage = { inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: true }
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
      usage.inTokens = u.input_tokens ?? 0
      usage.cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    } else if (evt.type === 'content_block_delta') {
      if (evt.delta?.type === 'text_delta') ctx.onText(evt.delta.text ?? '')
      else if (evt.delta?.type === 'thinking_delta') ctx.onReasoning(evt.delta.thinking ?? '')
    } else if (evt.type === 'message_delta') {
      usage.outTokens = evt.usage?.output_tokens ?? usage.outTokens
    } else if (evt.type === 'error') {
      throw new Error(evt.error?.message ?? 'Error del proveedor')
    }
  }
  void def
  return usage
}

// ---------------------------------------------------------------------------
// Dialecto OpenAI (y los ~20 proveedores compatibles)
// ---------------------------------------------------------------------------
function openAiBody(
  opts: RunOptions,
  variant: 'max_tokens' | 'max_completion_tokens',
  providerId?: string
): any {
  const msgs = buildMessages(opts)
  const all: ChatMessage[] = opts.systemPrompt
    ? [{ role: 'system', content: opts.systemPrompt }, ...msgs.filter((m) => m.role !== 'system')]
    : msgs
  const body: any = {
    model: opts.model,
    messages: all,
    stream: true,
    stream_options: { include_usage: true }
  }
  body[variant] = opts.maxTokens ?? 4096
  // Los modelos de razonamiento sólo admiten temperature 1; se omite y ya.
  if (variant === 'max_tokens' && opts.temperature != null) body.temperature = opts.temperature
  applyOpenAiEffort(body, opts.effort, providerId)
  return body
}

async function streamOpenAI(ctx: StreamCtx): Promise<Usage> {
  const { base, key, opts, signal } = ctx
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  if (ctx.def.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://localhost/ai-command-center'
    headers['X-Title'] = 'AI Command Center'
  }

  let variant: 'max_tokens' | 'max_completion_tokens' = 'max_tokens'
  let res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(openAiBody(opts, variant, ctx.def.id))
  })

  // Los modelos nuevos de OpenAI rechazan max_tokens, y hay compatibles que
  // no conocen el esfuerzo: en los dos casos se reintenta adaptando, que es
  // mejor que devolver un error que el usuario no puede arreglar.
  if (res.status === 400) {
    const msg = await readError(res)
    const badMax = /max_completion_tokens|max_tokens|temperature/i.test(msg)
    const badEffort = /reasoning|effort/i.test(msg)
    if (badMax || badEffort) {
      if (badMax) variant = 'max_completion_tokens'
      const retry = openAiBody(opts, variant, ctx.def.id)
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify(badEffort ? stripEffort(retry) : retry)
      })
    } else {
      throw new Error(msg)
    }
  }
  ctx.onLimit(readUsageLimit(res.headers, ctx.def.name))
  if (!res.ok) throw new Error(await readError(res))

  const usage: Usage = { inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: false }
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
    if (evt.error) throw new Error(evt.error.message ?? 'Error del proveedor')
    const delta = evt.choices?.[0]?.delta
    if (delta?.content) ctx.onText(delta.content)
    if (delta?.reasoning_content) ctx.onReasoning(delta.reasoning_content)
    if (delta?.reasoning) ctx.onReasoning(typeof delta.reasoning === 'string' ? delta.reasoning : '')
    if (evt.usage) {
      usage.inTokens = evt.usage.prompt_tokens ?? usage.inTokens
      usage.outTokens = evt.usage.completion_tokens ?? usage.outTokens
      usage.cached = evt.usage.prompt_tokens_details?.cached_tokens ?? usage.cached
      usage.reasoning = evt.usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning
      usage.exact = true
    }
  }
  return usage
}

// ---------------------------------------------------------------------------
// Dialecto Google Gemini
// ---------------------------------------------------------------------------
async function streamGoogle(ctx: StreamCtx): Promise<Usage> {
  const { base, key, opts, signal } = ctx
  const msgs = buildMessages(opts).filter((m) => m.role !== 'system')
  const body: any = {
    contents: msgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    })),
    generationConfig: {
      temperature: opts.temperature ?? 1,
      maxOutputTokens: opts.maxTokens ?? 4096
    }
  }
  if (opts.systemPrompt) body.systemInstruction = { parts: [{ text: opts.systemPrompt }] }
  applyGoogleEffort(body, opts.effort)

  const url = `${base}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`
  let res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (res.status === 400 && body.generationConfig?.thinkingConfig) {
    const msg = await readError(res)
    if (/thinking/i.test(msg)) {
      res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(stripEffort(body))
      })
    } else {
      throw new Error(msg)
    }
  }
  ctx.onLimit(readUsageLimit(res.headers, ctx.def.name))
  if (!res.ok) throw new Error(await readError(res))

  const usage: Usage = { inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: true }
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
    for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) part.thought ? ctx.onReasoning(part.text) : ctx.onText(part.text)
    }
    if (evt.usageMetadata) {
      usage.inTokens = evt.usageMetadata.promptTokenCount ?? usage.inTokens
      usage.outTokens = evt.usageMetadata.candidatesTokenCount ?? usage.outTokens
      usage.cached = evt.usageMetadata.cachedContentTokenCount ?? usage.cached
      usage.reasoning = evt.usageMetadata.thoughtsTokenCount ?? usage.reasoning
    }
  }
  return usage
}

// ---------------------------------------------------------------------------
// Dialecto Ollama (NDJSON, con métricas de motor)
// ---------------------------------------------------------------------------
async function streamOllama(ctx: StreamCtx): Promise<Usage> {
  const { base, opts, signal } = ctx
  const msgs = buildMessages(opts)
  const all = opts.systemPrompt
    ? [{ role: 'system', content: opts.systemPrompt }, ...msgs.filter((m) => m.role !== 'system')]
    : msgs
  const body: any = {
    model: opts.model,
    messages: all,
    stream: true,
    options: { temperature: opts.temperature ?? 0.8, num_predict: opts.maxTokens ?? 4096 }
  }
  applyOllamaEffort(body, opts.effort)

  let res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  // Un modelo local que no piense rechaza el campo: se reintenta sin el.
  if (res.status >= 400 && body.think !== undefined) {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stripEffort(body))
    })
  }
  if (!res.ok) throw new Error(await readError(res))

  const usage: Usage = { inTokens: 0, outTokens: 0, cached: 0, reasoning: 0, exact: true }
  for await (const line of lines(res)) {
    let evt: any
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    if (evt.error) throw new Error(evt.error)
    if (evt.message?.content) ctx.onText(evt.message.content)
    if (evt.message?.thinking) ctx.onReasoning(evt.message.thinking)
    if (evt.done) {
      usage.inTokens = evt.prompt_eval_count ?? 0
      usage.outTokens = evt.eval_count ?? 0
      usage.evalNs = evt.eval_duration
    }
  }
  return usage
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

/**
 * Ejecuta un prompt contra un proveedor, emitiendo texto por `onDelta` y
 * devolviendo la ejecución con todas sus métricas ya persistida.
 */
export async function runPrompt(
  rawOpts: RunOptions,
  onDelta: DeltaFn,
  runId: string = randomUUID()
): Promise<RunRecord> {
  const def = providerById(rawOpts.providerId)
  const startedAt = Date.now()

  // El modelo no puede abrir archivos: los adjuntos entran en el prompt. En el
  // histórico se guarda lo que escribió el usuario, no el volcado, y aparte
  // cuántos adjuntos llevaba.
  const composed = composePrompt(rawOpts.prompt, rawOpts.attachments, 'api')
  const opts: RunOptions =
    composed === rawOpts.prompt
      ? rawOpts
      : {
          ...rawOpts,
          prompt: composed,
          messages: rawOpts.messages?.length
            ? [...rawOpts.messages.slice(0, -1), { role: 'user', content: composed }]
            : undefined
        }

  const contextLimit = contextLimitFor(rawOpts.providerId, rawOpts.model)
  let usageLimit: UsageLimit | undefined
  let gitSnap: GitSnapshot | null = null

  const base: Partial<RunRecord> = {
    id: runId,
    createdAt: startedAt,
    kind: opts.kind ?? 'chat',
    providerId: opts.providerId,
    model: opts.model,
    agentId: opts.agentId,
    agentName: opts.agentName,
    projectId: opts.projectId,
    projectName: opts.projectName,
    arenaId: opts.arenaId,
    conversationId: opts.conversationId,
    prompt: rawOpts.prompt,
    systemPrompt: opts.systemPrompt,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    effort: rawOpts.effort && rawOpts.effort !== 'auto' ? rawOpts.effort : undefined,
    attachmentCount: rawOpts.attachments?.length || undefined,
    contextLimit
  }

  const fail = (msg: string): RunRecord => {
    const run: RunRecord = {
      ...(base as RunRecord),
      response: '',
      status: 'error',
      error: msg,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalMs: Date.now() - startedAt,
      costIn: 0,
      costOut: 0,
      costTotal: 0,
      costEstimated: false
    }
    addRun(run)
    onDelta({ type: 'error', error: msg, run })
    return run
  }

  if (!def) return fail(`Proveedor desconocido: ${opts.providerId}`)

  const override = getConfig().providers[opts.providerId]
  const baseUrl = effectiveBaseUrl(def, override?.baseUrl)
  if (!baseUrl) return fail('Este proveedor no tiene endpoint configurado. Ponlo en Ajustes.')

  const { key } = resolveKey(opts.providerId)
  if (!def.local && !key) return fail(`Falta la API key de ${def.name}. Añádela en Ajustes.`)

  const ctrl = new AbortController()
  inflight.set(runId, ctrl)

  let text = ''
  let reasoning = ''
  let ttftMs: number | undefined
  let firstTokenAt = 0

  const onText = (t: string): void => {
    if (!t) return
    if (ttftMs === undefined) {
      firstTokenAt = Date.now()
      ttftMs = firstTokenAt - startedAt
    }
    text += t
    onDelta({ type: 'text', text: t })
  }
  const onReasoning = (t: string): void => {
    if (!t) return
    if (ttftMs === undefined) {
      firstTokenAt = Date.now()
      ttftMs = firstTokenAt - startedAt
    }
    reasoning += t
    onDelta({ type: 'reasoning', text: t })
  }

  const onLimit = (l: UsageLimit | undefined): void => {
    if (!l) return
    usageLimit = l
    onDelta({ type: 'limit', usageLimit: l, contextLimit })
    // También se guarda fuera de la ejecución: así la barra lateral puede
    // decir cuánto queda aunque la conversación de ahora no haya pedido nada.
    recordUsage({
      providerId: opts.providerId,
      providerName: def?.name,
      model: opts.model,
      limit: l,
      contextLimit
    })
  }

  const ctx: StreamCtx = { def, base: baseUrl, key, opts, signal: ctrl.signal, onText, onReasoning, onLimit }
  onDelta({ type: 'start', contextLimit })

  // Si la ejecución pasa por un proyecto, se guarda el estado del repositorio
  // para poder decir después qué archivos cambiaron y cuántas líneas.
  if (rawOpts.projectPath) {
    try {
      gitSnap = await snapshot(rawOpts.projectPath)
    } catch {
      gitSnap = null
    }
  }

  try {
    let usage: Usage
    switch (def.kind) {
      case 'anthropic':
        usage = await streamAnthropic(ctx)
        break
      case 'google':
        usage = await streamGoogle(ctx)
        break
      case 'ollama':
        usage = await streamOllama(ctx)
        break
      default:
        usage = await streamOpenAI(ctx)
    }

    const endedAt = Date.now()
    const totalMs = endedAt - startedAt

    if (!usage.inTokens) usage.inTokens = estimateTokens((opts.systemPrompt ?? '') + opts.prompt)
    if (!usage.outTokens) usage.outTokens = estimateTokens(text + reasoning)

    // Velocidad: si el motor da el tiempo de generación se usa ese; si no,
    // el tramo desde el primer token, que es lo honesto (excluye la espera).
    const genMs = usage.evalNs ? usage.evalNs / 1e6 : firstTokenAt ? endedAt - firstTokenAt : totalMs
    const tokensPerSec = genMs > 0 ? usage.outTokens / (genMs / 1000) : 0

    const cost = computeCost(opts.providerId, opts.model, usage.inTokens, usage.outTokens, usage.cached)

    const run: RunRecord = {
      ...(base as RunRecord),
      response: text,
      status: 'ok',
      promptTokens: usage.inTokens,
      completionTokens: usage.outTokens,
      totalTokens: usage.inTokens + usage.outTokens,
      cachedTokens: usage.cached || undefined,
      reasoningTokens: usage.reasoning || undefined,
      ttftMs,
      totalMs,
      tokensPerSec,
      costIn: cost.costIn,
      costOut: cost.costOut,
      costTotal: cost.costTotal,
      costEstimated: cost.estimated && !usage.exact ? true : cost.estimated,
      usageLimit,
      filesChanged: gitSnap ? await changesSince(gitSnap) : undefined,
      branch: gitSnap?.branch
    }
    recordUsage({
      providerId: opts.providerId,
      providerName: def.name,
      model: opts.model,
      limit: usageLimit,
      contextUsed: run.totalTokens || undefined,
      contextLimit
    })
    addRun(run)
    onDelta({ type: 'done', run })
    return run
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      const run: RunRecord = {
        ...(base as RunRecord),
        response: text,
        status: 'aborted',
        promptTokens: estimateTokens(opts.prompt),
        completionTokens: estimateTokens(text),
        totalTokens: 0,
        totalMs: Date.now() - startedAt,
        ttftMs,
        costIn: 0,
        costOut: 0,
        costTotal: 0,
        costEstimated: true
      }
      run.totalTokens = run.promptTokens + run.completionTokens
      addRun(run)
      onDelta({ type: 'done', run })
      return run
    }
    return fail(err?.message ?? String(err))
  } finally {
    inflight.delete(runId)
  }
}

/** Prueba rápida de conectividad y credenciales de un proveedor. */
export async function testProvider(providerId: string): Promise<{ ok: boolean; detail: string; ms: number }> {
  const def = providerById(providerId)
  const t0 = Date.now()
  if (!def) return { ok: false, detail: 'Proveedor desconocido', ms: 0 }
  const override = getConfig().providers[providerId]
  const base = effectiveBaseUrl(def, override?.baseUrl)
  if (!base) return { ok: false, detail: 'Sin endpoint configurado', ms: 0 }
  const { key, source } = resolveKey(providerId)
  if (!def.local && !key) return { ok: false, detail: 'Sin API key', ms: 0 }

  try {
    const url =
      def.kind === 'google'
        ? `${base}/models?key=${encodeURIComponent(key)}&pageSize=1`
        : `${base}${def.modelsPath ?? '/models'}`
    const headers: Record<string, string> =
      def.kind === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : key
          ? { Authorization: `Bearer ${key}` }
          : {}
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetch(url, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    const ms = Date.now() - t0
    if (!res.ok) return { ok: false, detail: await readError(res), ms }
    return { ok: true, detail: source === 'env' ? 'OK (key del entorno)' : 'OK', ms }
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e), ms: Date.now() - t0 }
  }
}
