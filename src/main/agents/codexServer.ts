/**
 * Codex por su `app-server`: el mismo protocolo con el que lo conducen su
 * extensión de VS Code y su app de escritorio.
 *
 * Es JSON-RPC por la entrada y la salida estándar, un mensaje por línea y sin
 * el campo `jsonrpc`. La diferencia con `codex exec` es que aquí Codex puede
 * preguntar: cuando un comando se sale de su sandbox, quiere red o va a
 * aplicar un parche que necesita permiso, la petición llega aquí, se enseña
 * en la conversación con sus botones y la respuesta vuelve a Codex, como en
 * su terminal. Con `exec` esas preguntas no existen: lo que no puede, falla.
 *
 * Los nombres de métodos y campos son los del esquema que genera el propio
 * Codex (`codex app-server generate-ts`, 0.159).
 */
import type { AgentStep, AgentTodo, FileTouch } from '@shared/types'

export interface CodexHandlers {
  /** Una notificación del servidor (item/started, turn/completed…). */
  onNotification: (method: string, params: any) => void
  /** Algo que pide el servidor (una aprobación): lo que se devuelva es su respuesta. */
  onRequest: (method: string, params: any, requestId: string) => Promise<unknown>
}

export class CodexError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message)
  }
}

/** Lo que el servidor pide y no sabemos contestar. */
export class CodexUnsupported extends Error {}

/** Una conversación con `codex app-server`, línea a línea. */
export class CodexConnection {
  private next = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

  constructor(
    private write: (line: string) => void,
    private handlers: CodexHandlers
  ) {}

  request<T = any>(method: string, params?: unknown): Promise<T> {
    const id = ++this.next
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write(JSON.stringify(params === undefined ? { id, method } : { id, method, params }) + '\n')
    })
  }

  notify(method: string, params?: unknown): void {
    this.write(JSON.stringify(params === undefined ? { method } : { method, params }) + '\n')
  }

  /** Una línea de su salida. Devuelve false si no era un mensaje. */
  feed(line: string): boolean {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return false
    }
    if (!msg || typeof msg !== 'object') return false
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(Number(msg.id))
      if (!p) return true
      this.pending.delete(Number(msg.id))
      if (msg.error) p.reject(new CodexError(String(msg.error.message ?? 'error de Codex'), msg.error.code))
      else p.resolve(msg.result)
      return true
    }
    if (msg.id != null && msg.method) {
      void this.handlers
        .onRequest(String(msg.method), msg.params ?? {}, String(msg.id))
        .then((result) => this.write(JSON.stringify({ id: msg.id, result }) + '\n'))
        .catch((e: unknown) =>
          this.write(
            JSON.stringify({
              id: msg.id,
              error: { code: e instanceof CodexUnsupported ? -32601 : -32000, message: e instanceof Error ? e.message : String(e) }
            }) + '\n'
          )
        )
      return true
    }
    if (typeof msg.method === 'string') this.handlers.onNotification(msg.method, msg.params ?? {})
    return true
  }

  /** Codex se fue: todo lo que esperaba respuesta falla. */
  failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }
}

/* ------------------------------------------------------------------ *
 * Permisos: los modos de la app en los términos de Codex             *
 * ------------------------------------------------------------------ */

export interface CodexPolicy {
  approvalPolicy: 'untrusted' | 'on-request' | 'never'
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
}

/**
 * Los cuatro modos son los de su selector de aprobaciones: Read Only, Auto
 * (el suyo por omisión en una carpeta de confianza) y Full Access, más el de
 * preguntar por todo lo que no sea de fiar. Sin modo elegido no se le dice
 * nada y manda lo que tengas en ~/.codex/config.toml.
 */
export function codexPolicy(mode: string | undefined): CodexPolicy | null {
  switch (mode) {
    case 'acceptEdits':
      return { approvalPolicy: 'on-request', sandbox: 'workspace-write' }
    case 'manual':
      return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' }
    case 'plan':
      return { approvalPolicy: 'on-request', sandbox: 'read-only' }
    case 'bypassPermissions':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' }
    default:
      return null
  }
}

/** Las opciones `-c clave=valor` (y --enable/--disable) del agente: valen igual para el servidor. */
export function codexConfigArgs(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if ((a === '-c' || a === '--config' || a === '--enable' || a === '--disable' || a === '-p' || a === '--profile') && i + 1 < args.length) {
      out.push(a, args[i + 1])
      i++
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * De lo que cuenta Codex a la línea de tiempo                        *
 * ------------------------------------------------------------------ */

function oneLine(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function shortPath(p: string, cwd?: string): string {
  let out = p.replace(/\\/g, '/')
  if (cwd) {
    const base = cwd.replace(/\\/g, '/').replace(/\/$/, '')
    if (out.toLowerCase().startsWith(base.toLowerCase() + '/')) out = out.slice(base.length + 1)
  }
  return out.length > 90 ? '…' + out.slice(-89) : out
}

function itemStatus(status: unknown): AgentStep['status'] {
  if (status === 'completed') return 'ok'
  if (status === 'failed' || status === 'declined') return 'error'
  return 'running'
}

/** Líneas añadidas y quitadas de un diff unificado. */
export function codexDiffCounts(changes: any[]): { added: number; removed: number } | null {
  let added = 0
  let removed = 0
  let any = false
  for (const c of changes ?? []) {
    if (typeof c?.diff !== 'string' || !c.diff) continue
    any = true
    for (const line of c.diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line[0] === '+') added++
      else if (line[0] === '-') removed++
    }
  }
  return any ? { added, removed } : null
}

export interface CodexItemView {
  step?: AgentStep
  touches?: { path: string; kind: FileTouch['kind'] }[]
}

/**
 * Un elemento del turno (un comando, un parche, una herramienta…) como paso
 * de la línea de tiempo. Los mensajes y el razonamiento no pasan por aquí:
 * llegan a trozos y los lleva quien escucha.
 */
export function codexItemView(item: any, done: boolean, cwd?: string): CodexItemView {
  const id = 'cx-' + String(item?.id ?? '')
  const at = Date.now()
  const status = done && item?.status === 'inProgress' ? 'ok' : itemStatus(item?.status ?? (done ? 'completed' : 'inProgress'))
  switch (item?.type) {
    case 'commandExecution': {
      const command = String(item.command ?? '')
      const out = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput.trim() : ''
      const failed = done && typeof item.exitCode === 'number' && item.exitCode !== 0
      const touches: CodexItemView['touches'] = []
      for (const a of Array.isArray(item.commandActions) ? item.commandActions : []) {
        if (a?.type === 'read' && a.path) touches.push({ path: String(a.path), kind: 'read' })
        else if ((a?.type === 'search' || a?.type === 'listFiles') && a.path) touches.push({ path: String(a.path), kind: 'search' })
      }
      if (!touches.length && command) touches.push({ path: command, kind: 'run' })
      return {
        step: {
          id,
          at,
          kind: 'tool',
          tool: 'Bash',
          target: oneLine(command, 200),
          status: failed ? 'error' : status,
          detail: out ? out.slice(-4000) : undefined,
          durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined
        },
        touches
      }
    }
    case 'fileChange': {
      const changes: any[] = Array.isArray(item.changes) ? item.changes : []
      const counts = codexDiffCounts(changes)
      return {
        step: {
          id,
          at,
          kind: 'tool',
          tool: 'Edit',
          target: changes.map((c) => shortPath(String(c?.path ?? ''), cwd)).filter(Boolean).join(', '),
          status,
          added: counts?.added || undefined,
          removed: counts?.removed || undefined
        },
        touches: changes.filter((c) => c?.path).map((c) => ({ path: String(c.path), kind: c.kind?.type === 'add' ? 'write' : 'edit' }))
      }
    }
    case 'mcpToolCall':
      return {
        step: {
          id,
          at,
          kind: 'tool',
          tool: `${item.tool ?? 'herramienta'} (${item.server ?? 'mcp'})`,
          status,
          detail: item.error?.message ? oneLine(String(item.error.message)) : undefined,
          durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined
        }
      }
    case 'dynamicToolCall':
      return { step: { id, at, kind: 'tool', tool: String(item.tool ?? 'herramienta'), status: item.success === false ? 'error' : status } }
    case 'webSearch':
      return { step: { id, at, kind: 'tool', tool: 'WebSearch', target: oneLine(String(item.query ?? '')), status: done ? 'ok' : 'running' } }
    case 'imageView':
      return {
        step: { id, at, kind: 'tool', tool: 'Read', target: shortPath(String(item.path ?? ''), cwd), status: done ? 'ok' : 'running' },
        touches: item.path ? [{ path: String(item.path), kind: 'read' }] : undefined
      }
    case 'collabAgentToolCall':
      return {
        step: {
          id,
          at,
          kind: 'tool',
          tool: 'Task',
          target: oneLine(String(item.prompt ?? item.tool ?? ''), 120),
          status: item.status === 'failed' ? 'error' : done ? 'ok' : 'running'
        }
      }
    case 'contextCompaction':
      return { step: { id, at, kind: 'note', status: 'ok', detail: 'Codex ha compactado la conversación para hacer sitio' } }
    case 'enteredReviewMode':
      return { step: { id, at, kind: 'note', status: 'ok', detail: 'Entra en modo revisión' } }
    default:
      return {}
  }
}

/** Su plan del turno, como la lista de tareas de la app. */
export function codexTodos(plan: any[]): AgentTodo[] {
  return (Array.isArray(plan) ? plan : [])
    .map((p) => ({ text: String(p?.step ?? '').slice(0, 300), done: p?.status === 'completed', active: p?.status === 'inProgress' }))
    .filter((t) => t.text)
}

/** Lo que pide permiso, en los términos de la app. */
export function codexAsk(method: string, params: any, step?: AgentStep): NonNullable<AgentStep['ask']> {
  if (method === 'item/commandExecution/requestApproval') {
    const net = params?.networkApprovalContext
    if (net?.host) return { kind: 'fetch', target: String(net.host) }
    return { kind: 'run', target: String(params?.command ?? step?.target ?? '') }
  }
  if (method === 'item/fileChange/requestApproval') {
    if (typeof params?.grantRoot === 'string' && params.grantRoot) return { kind: 'outside', target: params.grantRoot }
    return { kind: 'edit', target: step?.target }
  }
  if (method === 'item/permissions/requestApproval') {
    const fs = params?.permissions?.fileSystem
    const dirs = [...(Array.isArray(fs?.write) ? fs.write : []), ...(Array.isArray(fs?.read) ? fs.read : [])].map(String)
    if (dirs.length) return { kind: 'outside', target: dirs.join(', ') }
    if (params?.permissions?.network?.enabled) return { kind: 'fetch', target: 'la red' }
  }
  return { kind: 'other', target: String(params?.reason ?? '') }
}

/** El motivo de un turno fallido, legible. */
export function codexErrorText(error: any): string {
  const message = String(error?.message ?? 'error sin detalle')
  const info = error?.codexErrorInfo
  const code = typeof info === 'string' ? info : info && typeof info === 'object' ? Object.keys(info)[0] : ''
  const status = info && typeof info === 'object' ? (Object.values(info)[0] as any)?.httpStatusCode : undefined
  if (code === 'unauthorized' || status === 401) {
    return 'Codex no tiene sesión iniciada. Entra con «codex login» (Ajustes → Cuentas) y vuelve a lanzarlo.'
  }
  if (code === 'usageLimitExceeded') return 'Has llegado al tope de tu plan en Codex: ' + message
  const details = typeof error?.additionalDetails === 'string' && error.additionalDetails ? ` (${oneLine(error.additionalDetails, 200)})` : ''
  return message + details
}
