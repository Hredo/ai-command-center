/**
 * Exportar e importar conversaciones de la Consola.
 *
 * - Markdown: para leerla, compartirla o pegarla en otro sitio. Lleva los
 *   mensajes, el razonamiento plegado, las herramientas que usó y lo que
 *   costó cada respuesta. Se puede volver a importar (sólo los mensajes).
 * - JSON: la conversación entera, tal cual se guarda, para llevarla a otro
 *   equipo o guardar una copia. Al importarla vuelve igual.
 *
 * Lo que sólo vale en este equipo no se importa: la sesión propia del agente
 * de consola, el worktree, o un proyecto o agente que aquí no existe.
 */
import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { getConfig } from './config'
import { getSession, listSessions, saveSession } from './sessions'
import type { SessionTurn, StoredSession } from '@shared/types'

export const EXPORT_FORMAT = 'ai-command-center/conversations'

type Lang = 'es' | 'en'

const L = {
  es: { you: 'Tú', answer: 'Respuesta', exported: 'Exportada', model: 'Modelo', agent: 'Agente', project: 'Proyecto', reasoning: 'Razonamiento', tools: 'Herramientas', attachments: 'Adjuntos', error: 'Error' },
  en: { you: 'You', answer: 'Answer', exported: 'Exported', model: 'Model', agent: 'Agent', project: 'Project', reasoning: 'Reasoning', tools: 'Tools', attachments: 'Attachments', error: 'Error' }
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** Una conversación en Markdown. */
export function sessionToMarkdown(s: StoredSession, lang: Lang = 'es'): string {
  const w = L[lang]
  const cfg = getConfig()
  const project = cfg.projects.find((p) => p.id === s.projectId)?.name
  const cli = cfg.cliAgents.find((a) => a.id === s.cliAgentId)?.name
  const lines: string[] = [`# ${s.title}`, '']
  lines.push(`- ${w.exported}: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
  if (s.kind === 'cli' && cli) lines.push(`- ${w.agent}: ${cli}`)
  else if (s.model) lines.push(`- ${w.model}: ${s.providerId ? s.providerId + '/' : ''}${s.model}`)
  if (project) lines.push(`- ${w.project}: ${project}`)
  lines.push('')

  for (const t of s.turns ?? []) {
    if (t.role === 'user') {
      lines.push(`## ${w.you}`, '', t.content.trim(), '')
      if (t.attachments?.length) lines.push(`_${w.attachments}: ${t.attachments.map((a) => a.name).join(', ')}_`, '')
      continue
    }
    const m = t.metrics
    const bits = [t.model, m?.totalTokens ? `${fmtTokens(m.totalTokens)} tokens` : '', m?.costTotal ? `$${m.costTotal.toFixed(4)}` : '']
      .filter(Boolean)
      .join(' · ')
    lines.push(`## ${w.answer}${bits ? ' · ' + bits : ''}`, '')
    if (t.reasoning?.trim()) {
      lines.push('<details>', `<summary>${w.reasoning}</summary>`, '', t.reasoning.trim(), '', '</details>', '')
    }
    const tools = new Map<string, number>()
    for (const st of t.steps ?? []) if (st.kind === 'tool' && st.tool) tools.set(st.tool, (tools.get(st.tool) ?? 0) + 1)
    if (tools.size) lines.push(`_${w.tools}: ${[...tools].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ')}_`, '')
    if (t.error) lines.push(`> **${w.error}:** ${t.error.replace(/\n/g, ' ')}`, '')
    else lines.push(t.content.trim(), '')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Lee una conversación exportada en Markdown (la de esta app): título y mensajes. */
export function parseMarkdown(text: string): { title: string; turns: SessionTurn[] } {
  const src = text.replace(/\r\n/g, '\n')
  const title = /^#\s+(.+)$/m.exec(src)?.[1]?.trim() || 'Conversación importada'
  const turns: SessionTurn[] = []
  // Sin \b: la «ú» de «Tú» no cuenta como letra para él.
  const heading = /^##\s+(Tú|You|Respuesta|Answer)(?=\s|$)(.*)$/gm
  const marks = [...src.matchAll(heading)]
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? src.length) : src.length
    let body = src.slice(start, end)
    // Lo que añadió la exportación y no es parte del mensaje.
    body = body
      .replace(/<details>[\s\S]*?<\/details>/g, '')
      .replace(/^_(Adjuntos|Attachments|Herramientas|Tools): .*_$/gm, '')
      .trim()
    const user = m[1] === 'Tú' || m[1] === 'You'
    const model = user ? undefined : m[2].replace(/^\s*·\s*/, '').split(' · ')[0]?.trim() || undefined
    if (!body) continue
    turns.push({ id: randomUUID(), role: user ? 'user' : 'assistant', content: body, model })
  }
  return { title, turns }
}

/* ------------------------------------------------------------------ *
 * Importar                                                           *
 * ------------------------------------------------------------------ */

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Un turno de fuera, sólo con lo que se sabe leer. */
function cleanTurn(raw: any): SessionTurn | null {
  if (!raw || typeof raw !== 'object') return null
  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : null
  if (!role || typeof raw.content !== 'string') return null
  return {
    id: str(raw.id) || randomUUID(),
    role,
    content: raw.content,
    reasoning: str(raw.reasoning),
    runId: str(raw.runId),
    model: str(raw.model),
    providerId: str(raw.providerId),
    error: str(raw.error),
    // Sin el punto de control: es de un repositorio de otro equipo (o de otro momento).
    metrics: raw.metrics && typeof raw.metrics === 'object' ? { ...raw.metrics, checkpoint: undefined, undone: undefined } : undefined,
    raw: str(raw.raw),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.filter((a: any) => a && typeof a.path === 'string') : undefined,
    steps: Array.isArray(raw.steps) ? raw.steps.filter((x: any) => x && typeof x.id === 'string') : undefined
  }
}

/**
 * Una conversación de fuera, lista para guardar. Id nuevo si ya existe uno
 * igual; sin lo que sólo vale en el equipo donde se creó.
 */
export function cleanImported(raw: any, taken: Set<string>): StoredSession | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.turns)) return null
  const turns = raw.turns.map(cleanTurn).filter((t: SessionTurn | null): t is SessionTurn => Boolean(t))
  if (!turns.length) return null
  const cfg = getConfig()
  const kind = raw.kind === 'cli' ? 'cli' : 'chat'
  let id = str(raw.id) || randomUUID()
  if (taken.has(id)) id = randomUUID()
  taken.add(id)
  const now = Date.now()
  return {
    id,
    kind,
    title: (str(raw.title) || 'Conversación importada').slice(0, 160),
    titled: true,
    createdAt: Number(raw.createdAt) || now,
    updatedAt: now,
    providerId: str(raw.providerId),
    model: str(raw.model),
    systemPrompt: str(raw.systemPrompt),
    temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
    maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
    effort: str(raw.effort) as StoredSession['effort'],
    permissionMode: str(raw.permissionMode),
    agentMode: typeof raw.agentMode === 'boolean' ? raw.agentMode : undefined,
    includeContext: typeof raw.includeContext === 'boolean' ? raw.includeContext : true,
    // Sólo si aquí existen.
    projectId: cfg.projects.some((p) => p.id === raw.projectId) ? raw.projectId : undefined,
    agentId: cfg.agents.some((a) => a.id === raw.agentId) ? raw.agentId : undefined,
    cliAgentId: cfg.cliAgents.some((a) => a.id === raw.cliAgentId) ? raw.cliAgentId : undefined,
    cliModel: str(raw.cliModel),
    // Su sesión de agente no existe en este equipo: el primer turno le pasa
    // la conversación dentro del prompt.
    cliRewound: kind === 'cli' ? true : undefined,
    turns
  }
}

export interface ImportResult {
  imported: { id: string; title: string }[]
  skipped: { file: string; reason: string }[]
}

/** Lee lo que haya en un fichero exportado (JSON de esta app o Markdown). */
export function importFromText(text: string, file: string): ImportResult {
  const out: ImportResult = { imported: [], skipped: [] }
  const taken = new Set(listSessions().map((s) => s.id))
  const name = basename(file)
  let candidates: any[] = []
  if (extname(file).toLowerCase() === '.md' || !/^\s*[[{]/.test(text)) {
    const md = parseMarkdown(text)
    if (!md.turns.length) {
      out.skipped.push({ file: name, reason: 'no tiene mensajes con los encabezados de una exportación de la app' })
      return out
    }
    candidates = [{ kind: 'chat', title: md.title, turns: md.turns }]
  } else {
    let data: any
    try {
      data = JSON.parse(text)
    } catch (e: any) {
      out.skipped.push({ file: name, reason: `no es JSON válido: ${e?.message ?? e}` })
      return out
    }
    candidates = Array.isArray(data) ? data : Array.isArray(data?.sessions) ? data.sessions : data?.session ? [data.session] : [data]
  }
  for (const raw of candidates) {
    const s = cleanImported(raw, taken)
    if (!s) {
      out.skipped.push({ file: name, reason: 'una conversación sin mensajes o con un formato que no es el de la app' })
      continue
    }
    const saved = saveSession(s)
    out.imported.push({ id: saved.id, title: saved.title })
  }
  return out
}

export async function importSessions(): Promise<ImportResult | null> {
  const r = await dialog.showOpenDialog({
    title: 'Importar conversaciones',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Conversaciones', extensions: ['json', 'md'] },
      { name: 'Todo', extensions: ['*'] }
    ]
  })
  if (r.canceled || !r.filePaths.length) return null
  const all: ImportResult = { imported: [], skipped: [] }
  for (const f of r.filePaths) {
    let text: string
    try {
      text = readFileSync(f, 'utf8')
    } catch (e: any) {
      all.skipped.push({ file: basename(f), reason: e?.message ?? String(e) })
      continue
    }
    const one = importFromText(text, f)
    all.imported.push(...one.imported)
    all.skipped.push(...one.skipped)
  }
  return all
}

/* ------------------------------------------------------------------ *
 * Exportar                                                           *
 * ------------------------------------------------------------------ */

const safeName = (s: string): string =>
  s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'conversacion'

/** Lo que se escribe: una o varias conversaciones, en Markdown o en JSON. */
export function exportText(ids: string[], format: 'md' | 'json', lang: Lang = 'es'): { text: string; count: number } {
  const list = ids.map((id) => getSession(id)).filter((s): s is StoredSession => Boolean(s))
  if (!list.length) throw new Error('No hay conversaciones que exportar')
  if (format === 'md') return { text: list.map((s) => sessionToMarkdown(s, lang)).join('\n---\n\n'), count: list.length }
  return {
    text: JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), sessions: list }, null, 2),
    count: list.length
  }
}

export async function exportSessions(
  ids: string[],
  format: 'md' | 'json',
  lang: Lang = 'es'
): Promise<{ path: string; count: number } | null> {
  const { text, count } = exportText(ids, format, lang)
  const first = getSession(ids[0])
  const base = count === 1 && first ? safeName(first.title) : `conversaciones-${new Date().toISOString().slice(0, 10)}`
  const r = await dialog.showSaveDialog({
    title: count === 1 ? 'Exportar la conversación' : `Exportar ${count} conversaciones`,
    defaultPath: `${base}.${format}`,
    filters: format === 'md' ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'JSON', extensions: ['json'] }]
  })
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, text, 'utf8')
  return { path: r.filePath, count }
}
