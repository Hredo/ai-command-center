/**
 * MCP para los agentes por API.
 *
 * Los servidores MCP que tengas en la app (Agentes › MCP, columna «Esta app»)
 * se arrancan cuando un agente por API empieza a trabajar y sus herramientas
 * se le ofrecen junto a las propias: leer, editar, ejecutar… y lo que traiga
 * cada servidor. Se usa el SDK oficial, que sabe lanzar `npx` en Windows y
 * habla stdio, HTTP transmitible y SSE.
 *
 * Los permisos siguen las reglas de siempre. Una herramienta que el servidor
 * declara de sólo lectura se trata como leer un archivo; el resto, como
 * ejecutar un comando: espera a que la permitas salvo en «Sin límites», y en
 * «Sólo plan» ni se ofrece.
 *
 * Las conexiones se reutilizan entre turnos y se cierran tras diez minutos
 * sin uso, al cambiar la configuración y al salir.
 */
import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { getConfig } from '../config'
import type { AgentTool, ToolResult } from '../agents/tools'
import type { McpSpec } from '@shared/types'

const CONNECT_TIMEOUT = 60_000
const LIST_TIMEOUT = 20_000
const CALL_TIMEOUT = 120_000
const IDLE_MS = 10 * 60_000
/** Lo que vuelve al modelo de una llamada, como mucho. */
const MAX_OUTPUT = 30_000

interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: any
  annotations?: { readOnlyHint?: boolean; title?: string }
}

interface Conn {
  key: string
  client: Client
  tools: McpToolInfo[]
  lastUsed: number
  stderr: string[]
}

const conns = new Map<string, Conn>()
const pending = new Map<string, Promise<Conn>>()
/** Uno que no arrancó no se reintenta en cada turno: se recuerda un minuto (salvo que cambie). */
const failures = new Map<string, { key: string; at: number; error: string }>()
const RETRY_MS = 60_000

/** Sustituye `${VAR}` y `${VAR:-por defecto}` con el entorno de la app. */
export function resolveRefs(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, def?: string) => {
    const v = process.env[name]
    if (v !== undefined && v !== '') return v
    if (def !== undefined) return def
    throw new Error(`falta la variable de entorno ${name}`)
  })
}

function resolveRecord(r?: Record<string, string>): Record<string, string> | undefined {
  return r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, resolveRefs(v)])) : undefined
}

function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') out[k] = v
  return out
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: no respondió en ${Math.round(ms / 1000)} s`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

async function open(name: string, spec: McpSpec, key: string): Promise<Conn> {
  const stderr: string[] = []
  let transport
  if (spec.transport === 'stdio') {
    if (!spec.command) throw new Error('no tiene orden')
    const t = new StdioClientTransport({
      command: resolveRefs(spec.command),
      args: (spec.args ?? []).map(resolveRefs),
      env: { ...baseEnv(), ...(resolveRecord(spec.env) ?? {}) },
      cwd: spec.cwd ? resolveRefs(spec.cwd) : undefined,
      stderr: 'pipe'
    })
    t.stderr?.on('data', (c: Buffer) => {
      stderr.push(String(c))
      if (stderr.length > 40) stderr.shift()
    })
    transport = t
  } else if (spec.transport === 'http' || spec.transport === 'sse') {
    const url = new URL(resolveRefs(spec.url ?? ''))
    const headers = resolveRecord(spec.headers)
    transport =
      spec.transport === 'http'
        ? new StreamableHTTPClientTransport(url, { requestInit: headers ? { headers } : undefined })
        : new SSEClientTransport(url, { requestInit: headers ? { headers } : undefined })
  } else {
    throw new Error('los servidores por WebSocket no se admiten aquí')
  }
  const client = new Client({ name: 'ai-command-center', version: app.getVersion() })
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT, 'al conectar')
    const listed = await withTimeout(client.listTools(), LIST_TIMEOUT, 'al pedir sus herramientas')
    return { key, client, tools: (listed.tools ?? []) as McpToolInfo[], lastUsed: Date.now(), stderr }
  } catch (err) {
    void client.close().catch(() => undefined)
    const tail = stderr.join('').trim().split('\n').slice(-3).join(' | ')
    throw new Error(`${(err as Error).message}${tail ? ` (${tail.slice(0, 300)})` : ''}`)
  }
}

/** La conexión a un servidor, abierta o reutilizada. */
async function connection(name: string, spec: McpSpec): Promise<Conn> {
  const key = JSON.stringify(spec)
  const cur = conns.get(name)
  if (cur && cur.key === key) {
    cur.lastUsed = Date.now()
    return cur
  }
  if (cur) {
    conns.delete(name)
    void cur.client.close().catch(() => undefined)
  }
  const wait = pending.get(name)
  if (wait) return wait
  const failed = failures.get(name)
  if (failed && failed.key === key && Date.now() - failed.at < RETRY_MS) throw new Error(failed.error)
  const p = open(name, spec, key)
    .then((c) => {
      conns.set(name, c)
      failures.delete(name)
      return c
    })
    .catch((err: Error) => {
      failures.set(name, { key, at: Date.now(), error: err.message })
      throw err
    })
    .finally(() => pending.delete(name))
  pending.set(name, p)
  return p
}

/** Nombre de herramienta que aceptan todos los proveedores: letras, números, _ y -, hasta 64. */
function toolName(server: string, tool: string): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '_')
  const full = `mcp__${clean(server)}__${clean(tool)}`
  return full.length <= 64 ? full : full.slice(0, 55) + '_' + Math.abs(hashCode(full)).toString(36).slice(0, 8)
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/** El esquema de entrada tal cual, con lo mínimo que exigen los proveedores. */
function schemaOf(input: any): AgentTool['parameters'] {
  const s = input && typeof input === 'object' ? { ...input } : {}
  delete s.$schema
  return { ...s, type: 'object', properties: s.properties ?? {}, required: Array.isArray(s.required) ? s.required : [] }
}

export interface McpTools {
  tools: AgentTool[]
  /** Servidores que no arrancaron, con el motivo: se enseñan en la actividad del agente. */
  failed: { server: string; error: string }[]
}

/** Las herramientas MCP para un agente, según hasta dónde puede llegar. */
export async function mcpToolsFor(mode?: string): Promise<McpTools> {
  const servers = Object.entries(getConfig().mcpServers ?? {}).filter(([, s]) => s.enabled)
  const out: McpTools = { tools: [], failed: [] }
  await Promise.all(
    servers.map(async ([name, s]) => {
      const { enabled: _e, addedAt: _a, ...spec } = s
      try {
        const c = await connection(name, spec)
        for (const t of c.tools) {
          const readOnly = t.annotations?.readOnlyHint === true
          if (mode === 'plan' && !readOnly) continue
          out.tools.push({
            name: toolName(name, t.name),
            kind: readOnly ? 'read' : 'mcp',
            description: `[MCP ${name}] ${t.description ?? t.annotations?.title ?? t.name}`.slice(0, 1024),
            parameters: schemaOf(t.inputSchema),
            mcp: { server: name, tool: t.name }
          })
        }
      } catch (err) {
        out.failed.push({ server: name, error: (err as Error).message })
      }
    })
  )
  // Si dos nombres coinciden tras limpiarlos, el segundo no se ofrece.
  const seen = new Set<string>()
  out.tools = out.tools.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
  return out
}

/** Llama a una herramienta MCP. Nunca lanza: un fallo vuelve al modelo como texto. */
export async function callMcpTool(target: { server: string; tool: string }, args: any, signal: AbortSignal): Promise<ToolResult> {
  const s = getConfig().mcpServers?.[target.server]
  if (!s || !s.enabled) return { output: `El servidor MCP «${target.server}» ya no está activo.`, isError: true }
  try {
    const { enabled: _e, addedAt: _a, ...spec } = s
    const c = await connection(target.server, spec)
    c.lastUsed = Date.now()
    const res: any = await c.client.callTool(
      { name: target.tool, arguments: args && typeof args === 'object' ? args : {} },
      undefined,
      { signal, timeout: CALL_TIMEOUT }
    )
    const parts: string[] = []
    for (const p of res?.content ?? []) {
      if (p?.type === 'text') parts.push(String(p.text ?? ''))
      else if (p?.type === 'resource') parts.push(String(p.resource?.text ?? `[recurso ${p.resource?.uri ?? ''}]`))
      else if (p?.type === 'resource_link') parts.push(`[enlace a recurso ${p.uri ?? ''}]`)
      else if (p?.type === 'image') parts.push('[imagen]')
      else if (p?.type === 'audio') parts.push('[audio]')
    }
    if (!parts.length && res?.structuredContent) parts.push(JSON.stringify(res.structuredContent))
    let output = parts.join('\n') || '(sin contenido)'
    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + `\n… (recortado: ${output.length} caracteres)`
    const first = output.split('\n')[0].slice(0, 120)
    return { output, isError: res?.isError === true, summary: first }
  } catch (err) {
    return { output: `Error del servidor MCP «${target.server}»: ${(err as Error).message}`, isError: true }
  }
}

/** Prueba un servidor de la app: conecta y dice qué herramientas trae. */
export async function testAppMcp(name: string): Promise<{ tools: { name: string; readOnly: boolean; description?: string }[] }> {
  const s = getConfig().mcpServers?.[name]
  if (!s) throw new Error('No existe ese servidor')
  // Probar es pedir otro intento: se olvida el fallo anterior.
  failures.delete(name)
  const { enabled: _e, addedAt: _a, ...spec } = s
  const c = await connection(name, spec)
  return { tools: c.tools.map((t) => ({ name: t.name, readOnly: t.annotations?.readOnlyHint === true, description: t.description })) }
}

/** Cierra lo que no se use: los servidores de la app que ya no están o llevan rato parados. */
export function pruneMcp(force = false): void {
  const cfg = getConfig().mcpServers ?? {}
  for (const [name, c] of conns) {
    const s = cfg[name]
    const stale = !s || !s.enabled || force || Date.now() - c.lastUsed > IDLE_MS
    if (!stale) continue
    conns.delete(name)
    void c.client.close().catch(() => undefined)
  }
}

const idle = setInterval(() => pruneMcp(false), 60_000)
idle.unref?.()
app.on('will-quit', () => pruneMcp(true))
