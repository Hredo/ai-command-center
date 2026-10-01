/**
 * ACP (Agent Client Protocol): cómo se habla con un agente de línea de
 * comandos que lo entiende —OpenCode (`opencode acp`), Gemini CLI
 * (`gemini --experimental-acp`)— igual que lo hacen los editores que lo
 * integran (Zed, por ejemplo).
 *
 * Es JSON-RPC 2.0 por la entrada y la salida estándar, un mensaje por línea.
 * La diferencia con lanzar `opencode run` es que el agente puede preguntar:
 * cuando necesita permiso (una carpeta fuera del proyecto, un comando que su
 * configuración tiene en «ask»), la petición llega aquí, se enseña en la
 * conversación con sus botones y la respuesta vuelve al agente, como en su
 * propia terminal. Con `run` esas preguntas se contestaban «no» solas.
 */
import type { AgentStep, FileTouch } from '@shared/types'

export interface AcpPermissionOption {
  optionId: string
  name?: string
  kind?: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string
}

export interface AcpPermissionRequest {
  sessionId: string
  toolCall?: AcpToolCall
  options?: AcpPermissionOption[]
}

export interface AcpToolCall {
  toolCallId?: string
  title?: string
  kind?: string
  status?: string
  locations?: { path?: string; line?: number }[]
  rawInput?: any
  rawOutput?: any
  content?: any[]
}

export type AcpPermissionOutcome = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }

export interface AcpHandlers {
  /** Una notificación session/update. */
  onUpdate: (update: any) => void
  /** El agente pide permiso: se contesta con la opción elegida. */
  onPermission: (req: AcpPermissionRequest) => Promise<AcpPermissionOutcome>
}

export class AcpError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message)
  }
}

/** Una conversación JSON-RPC con el agente, línea a línea. */
export class AcpConnection {
  private next = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

  constructor(
    private write: (line: string) => void,
    private handlers: AcpHandlers
  ) {}

  request<T = any>(method: string, params: unknown): Promise<T> {
    const id = ++this.next
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  notify(method: string, params: unknown): void {
    this.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  private reply(id: unknown, result: unknown): void {
    this.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  }

  private replyError(id: unknown, code: number, message: string): void {
    this.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
  }

  /** Una línea de la salida del agente. Devuelve false si no era JSON-RPC. */
  feed(line: string): boolean {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return false
    }
    if (!msg || typeof msg !== 'object') return false
    // Respuesta a algo que pedimos.
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(Number(msg.id))
      if (!p) return true
      this.pending.delete(Number(msg.id))
      if (msg.error) p.reject(new AcpError(String(msg.error.message ?? 'error del agente'), msg.error.code))
      else p.resolve(msg.result)
      return true
    }
    // Algo que nos pide el agente.
    if (msg.id != null && msg.method) {
      if (msg.method === 'session/request_permission') {
        void this.handlers
          .onPermission(msg.params ?? {})
          .then((outcome) => this.reply(msg.id, { outcome }))
          .catch(() => this.reply(msg.id, { outcome: { outcome: 'cancelled' } }))
      } else {
        // No anunciamos ni ficheros ni terminales: el agente usa los suyos.
        this.replyError(msg.id, -32601, `Método no soportado: ${msg.method}`)
      }
      return true
    }
    if (msg.method === 'session/update') this.handlers.onUpdate(msg.params?.update ?? {})
    return true
  }

  /** El agente se fue: todo lo que esperaba respuesta falla. */
  failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }
}

/* ------------------------------------------------------------------ *
 * De lo que cuenta el agente a la línea de tiempo                    *
 * ------------------------------------------------------------------ */

const KIND_LABEL: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Bash',
  think: 'Think',
  fetch: 'WebFetch',
  switch_mode: 'Mode'
}

/** El nombre de la herramienta tal cual lo dice (read, bash, read_file…); si no, por su tipo. */
export function acpToolName(tc: AcpToolCall, fallback?: string): string {
  const title = String(tc.title ?? '').trim()
  // OpenCode pone el nombre de la herramienta como título mientras no sabe más.
  if (title && /^[a-z_][\w-]*$/i.test(title) && title.length < 30) return title
  if (fallback) return fallback
  return KIND_LABEL[String(tc.kind ?? '')] ?? 'Tool'
}

/** Sobre qué: el comando, la ruta, el patrón o la dirección. */
export function acpTarget(tc: AcpToolCall): string {
  const i = tc.rawInput && typeof tc.rawInput === 'object' ? tc.rawInput : {}
  const direct = i.command ?? i.cmd ?? i.filePath ?? i.file_path ?? i.path ?? i.filepath ?? i.pattern ?? i.query ?? i.url
  if (typeof direct === 'string' && direct) return direct
  if (Array.isArray(direct)) return direct.join(' ')
  const loc = tc.locations?.find((l) => l?.path)?.path
  if (loc) return loc
  const title = String(tc.title ?? '')
  return /^[a-z_][\w-]*$/i.test(title) ? '' : title
}

/** El tipo de toque a un fichero, para «qué ha leído y qué ha tocado». */
export function acpTouchKind(kind: string | undefined): FileTouch['kind'] | null {
  switch (kind) {
    case 'read':
      return 'read'
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit'
    case 'search':
      return 'search'
    case 'execute':
      return 'run'
    default:
      return null
  }
}

/** Líneas añadidas y quitadas, si el agente manda el diff. */
export function acpDiffCounts(content: any[] | undefined): { added: number; removed: number } | null {
  let added = 0
  let removed = 0
  let any = false
  const lines = (s: unknown): number => {
    if (typeof s !== 'string' || !s.length) return 0
    const n = s.split('\n').length
    return s.endsWith('\n') ? n - 1 : n
  }
  for (const c of content ?? []) {
    if (c?.type !== 'diff') continue
    any = true
    added += lines(c.newText)
    removed += lines(c.oldText)
  }
  return any ? { added, removed } : null
}

/** Un resumen de lo que devolvió, o la salida entera si es un comando. */
export function acpResultText(tc: AcpToolCall, kind?: string): string | undefined {
  const out = tc.rawOutput
  const text =
    (typeof out === 'string' ? out : typeof out?.output === 'string' ? out.output : undefined) ??
    (tc.content ?? [])
      .map((c: any) => (c?.type === 'content' && c.content?.type === 'text' ? String(c.content.text ?? '') : ''))
      .filter(Boolean)
      .join('\n')
  if (!text) return undefined
  if (kind === 'execute') return text.slice(-4000)
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 160 ? one.slice(0, 157) + '…' : one
}

export function acpStatus(status: string | undefined): AgentStep['status'] {
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'error'
  return 'running'
}

/**
 * Qué pide, en los términos de la app. OpenCode pregunta por una carpeta
 * fuera del proyecto con el nombre de la carpeta como título y la ruta en
 * rawInput.parentDir.
 */
export function acpAsk(tc: AcpToolCall | undefined): NonNullable<AgentStep['ask']> {
  const input = tc?.rawInput && typeof tc.rawInput === 'object' ? tc.rawInput : {}
  if (typeof input.parentDir === 'string') return { kind: 'outside', target: input.parentDir }
  switch (tc?.kind) {
    case 'edit':
    case 'delete':
    case 'move':
      return { kind: 'edit', target: acpTarget(tc ?? {}) }
    case 'execute':
      return { kind: 'run', target: acpTarget(tc ?? {}) }
    case 'read':
    case 'search':
      return { kind: 'read', target: acpTarget(tc ?? {}) }
    case 'fetch':
      return { kind: 'fetch', target: acpTarget(tc ?? {}) }
    default:
      return { kind: 'other', target: acpTarget(tc ?? {}) || String(tc?.title ?? '') }
  }
}
