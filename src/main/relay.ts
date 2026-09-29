/**
 * Relevo entre agentes: pasar un trabajo a medias de una IA a otra.
 *
 * Pasa cuando a un agente se le acaba el cupo, se atasca o sale más caro de la
 * cuenta: el trabajo tiene que seguir en otro, del mismo fabricante o de otro,
 * sin volver a explicarle todo. Aquí se junta lo que necesita el que llega:
 *
 *  - el objetivo, que es la primera petición;
 *  - los últimos intercambios, recortados;
 *  - la lista de tareas que llevaba el agente, si llevaba una;
 *  - lo que ha cambiado en el repositorio: qué ficheros, cuántas líneas, y el
 *    diff sin confirmar (recortado);
 *  - la rama.
 *
 * Todo eso sale de lo que ya existe en disco —la sesión de la Consola, la
 * transcripción de Claude Code, la sesión de OpenCode o de Codex y el propio
 * repositorio—, no de pedirle un resumen a nadie. El paquete se enseña entero
 * y editable antes de lanzarlo.
 */
import { createReadStream, existsSync } from 'node:fs'
import { getSession } from './sessions'
import { getConfig } from './config'
import { allRuns } from './runs'
import { gitExec } from './git'
import { claudeTranscriptPath } from './claudeSessions'
import { projectForPath } from './projectMatch'
import { externalTranscript } from './external'
import type { AgentTodo, RelayPackage, RelaySource } from '@shared/types'

/** Intercambios que se pasan, los últimos. */
const KEEP_TURNS = 6
/** Tope por mensaje. */
const TURN_CHARS = 1800
/** Tope del diff que va dentro del prompt. */
const DIFF_CHARS = 14_000

function clip(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/* ------------------------------------------------------------------ *
 * De dónde sale                                                      *
 * ------------------------------------------------------------------ */

interface Digest {
  label: string
  agent?: string
  cwd?: string
  branch?: string
  goal?: string
  turns: { role: 'user' | 'assistant'; content: string }[]
  todos: AgentTodo[]
  files: string[]
  /** Por qué se relevó, si lo sabemos (cupo agotado, error…). */
  reason?: string
}

/** Una conversación de la Consola, con lo que dejaron sus ejecuciones. */
function fromAppSession(id: string): Digest | null {
  const s = getSession(id)
  if (!s) return null
  const cfg = getConfig()
  const project = cfg.projects.find((p) => p.id === s.projectId)
  const runIds = new Set(s.turns.map((t) => t.runId).filter(Boolean) as string[])
  const runs = allRuns().filter((r) => runIds.has(r.id)).sort((a, b) => a.createdAt - b.createdAt)
  const last = runs[runs.length - 1]
  const todos = [...runs].reverse().find((r) => r.todos?.length)?.todos ?? []
  const files = new Set<string>()
  for (const r of runs) {
    for (const f of r.filesChanged ?? []) files.add(f.path)
    for (const f of r.filesTouched ?? []) if (f.kind === 'edit' || f.kind === 'write') files.add(f.path)
  }
  const agent =
    cfg.cliAgents.find((a) => a.id === s.cliAgentId)?.name ??
    cfg.agents.find((a) => a.id === s.agentId)?.name ??
    s.model
  const firstUser = s.turns.find((t) => t.role === 'user' && t.content.trim())
  let reason: string | undefined
  if (last?.cliLimit?.status === 'rejected') reason = `${agent ?? 'El agente'} llegó al tope de su plan`
  else if (last?.status === 'error') reason = `${agent ?? 'El agente'} falló: ${clip(last.error ?? '', 200)}`
  return {
    label: s.title,
    agent,
    cwd: project?.path,
    branch: last?.branch,
    goal: firstUser?.content,
    turns: s.turns
      .filter((t) => t.content.trim() && !t.error)
      .map((t) => ({ role: t.role, content: t.content })),
    todos,
    files: [...files],
    reason
  }
}

/**
 * Una sesión de Claude Code, de la app o de cualquier terminal: se lee su
 * transcripción entera, sin quedarse con los adjuntos ni las capturas.
 */
async function fromClaude(sessionId: string): Promise<Digest | null> {
  const path = claudeTranscriptPath(sessionId)
  if (!path) return null
  const d: Digest = { label: 'Claude Code', agent: 'Claude Code', turns: [], todos: [], files: [] }
  await new Promise<void>((resolve) => {
    const stream = createReadStream(path, { encoding: 'utf8' })
    let buf = ''
    const eat = (line: string): void => {
      if (line.length < 20) return
      const isA = line.includes('"type":"assistant"')
      const isU = line.includes('"type":"user"')
      if (!isA && !isU) return
      let evt: any
      try {
        evt = JSON.parse(line)
      } catch {
        return
      }
      if (evt.cwd && !d.cwd) d.cwd = String(evt.cwd)
      if (evt.gitBranch) d.branch = String(evt.gitBranch)
      const content = evt.message?.content
      if (evt.type === 'user') {
        // Lo que escribió la persona; los tool_result y los avisos del
        // sistema (que empiezan por «<») no son peticiones.
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
              : ''
        if (text.trim() && !text.trimStart().startsWith('<')) {
          if (!d.goal) d.goal = text
          d.turns.push({ role: 'user', content: text })
        }
        return
      }
      if (!Array.isArray(content)) return
      const text = content.filter((b: any) => b?.type === 'text' && b.text).map((b: any) => b.text).join('\n')
      if (text.trim()) d.turns.push({ role: 'assistant', content: text })
      for (const b of content) {
        if (b?.type !== 'tool_use') continue
        const name = String(b.name ?? '')
        if (/^todowrite$/i.test(name) && Array.isArray(b.input?.todos)) {
          d.todos = b.input.todos.map((t: any) => ({
            text: String(t.content ?? t.text ?? '').slice(0, 300),
            done: t.status === 'completed',
            active: t.status === 'in_progress'
          }))
        }
        const file = b.input?.file_path ?? b.input?.notebook_path
        if (typeof file === 'string' && /^(edit|multiedit|write|notebookedit)/i.test(name) && !d.files.includes(file)) {
          d.files.push(file)
        }
      }
    }
    stream.on('data', (chunk: string | Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        eat(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    stream.on('error', () => resolve())
    stream.on('end', () => {
      if (buf.trim()) eat(buf)
      resolve()
    })
  })
  d.label = d.goal ? clip(d.goal.replace(/\s+/g, ' '), 60) : 'Sesión de Claude Code'
  // Una sesión que se cortó por el cupo lo deja escrito en su última respuesta.
  const lastA = [...d.turns].reverse().find((t) => t.role === 'assistant')
  if (lastA && /usage limit|session limit|rate limit|limit reached|límite/i.test(lastA.content)) {
    d.reason = 'Claude Code se quedó sin cupo'
  }
  return d
}

/* ------------------------------------------------------------------ *
 * El repositorio                                                     *
 * ------------------------------------------------------------------ */

async function repoState(cwd: string | undefined): Promise<{ stat: string; diff: string; untracked: string[]; branch?: string }> {
  const none = { stat: '', diff: '', untracked: [] as string[] }
  if (!cwd || !existsSync(cwd)) return none
  const inside = await gitExec(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok) return none
  const [stat, diff, others, head] = await Promise.all([
    gitExec(cwd, ['diff', 'HEAD', '--stat', '--no-color']),
    gitExec(cwd, ['diff', 'HEAD', '--no-color', '--no-ext-diff']),
    gitExec(cwd, ['ls-files', '--others', '--exclude-standard']),
    gitExec(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  ])
  return {
    stat: stat.out.trim(),
    diff: diff.out,
    untracked: others.out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 80),
    branch: head.ok ? head.out.trim() : undefined
  }
}

/* ------------------------------------------------------------------ *
 * El paquete y el prompt                                             *
 * ------------------------------------------------------------------ */

export async function buildRelay(src: RelaySource): Promise<RelayPackage> {
  let d: Digest | null = null
  if (src.kind === 'session') d = fromAppSession(src.id)
  else if (src.kind === 'claude') d = await fromClaude(src.id)
  else d = await externalTranscript(src.kind, src.id)
  if (!d) throw new Error('No se encuentra esa sesión: puede que se haya borrado o que sea demasiado antigua.')

  const repo = await repoState(d.cwd)
  const project = projectForPath(d.cwd)
  return {
    source: src,
    label: d.label,
    fromAgent: d.agent,
    projectPath: d.cwd,
    projectId: project?.id,
    projectName: project?.name,
    branch: repo.branch ?? d.branch,
    goal: d.goal ? clip(d.goal, 4000) : undefined,
    exchanges: d.turns.slice(-KEEP_TURNS).map((t) => ({ role: t.role, content: clip(t.content, TURN_CHARS) })),
    todos: d.todos,
    filesTouched: d.files.slice(0, 60),
    gitStat: repo.stat,
    untracked: repo.untracked,
    diff: repo.diff.length > DIFF_CHARS ? repo.diff.slice(0, DIFF_CHARS) + '\n… (diff recortado)' : repo.diff,
    diffTruncated: repo.diff.length > DIFF_CHARS,
    reason: d.reason
  }
}

/**
 * El prompt que recibe el agente que llega. Va en español porque es como
 * trabaja quien lo usa; el agente contesta en el idioma que le hablen.
 */
export function relayPrompt(p: RelayPackage, opts: { includeDiff?: boolean; note?: string } = {}): string {
  const out: string[] = []
  out.push(
    `Tomas el relevo de un trabajo que estaba haciendo ${p.fromAgent ?? 'otra IA'}` +
      (p.reason ? ` (${p.reason})` : '') +
      '. Sigue donde lo dejó: no empieces de cero ni deshagas lo que ya está hecho salvo que esté mal.'
  )
  if (p.projectPath) out.push(`Proyecto: ${p.projectPath}${p.branch ? ` · rama ${p.branch}` : ''}`)
  if (p.goal) out.push(`## Objetivo (la primera petición)\n${p.goal}`)
  if (p.todos.length) {
    out.push(
      '## Su lista de tareas\n' +
        p.todos.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}${t.active ? ' (en curso)' : ''}`).join('\n')
    )
  }
  if (p.exchanges.length) {
    out.push(
      '## Últimos intercambios\n' +
        p.exchanges.map((t) => `**${t.role === 'user' ? 'Usuario' : 'Agente'}:** ${t.content}`).join('\n\n')
    )
  }
  if (p.gitStat || p.untracked.length) {
    out.push(
      '## Cambios sin confirmar en el repositorio\n' +
        (p.gitStat ? '```\n' + p.gitStat + '\n```' : '') +
        (p.untracked.length ? `\nFicheros nuevos: ${p.untracked.join(', ')}` : '')
    )
  } else if (p.filesTouched.length) {
    out.push(`## Ficheros que tocó\n${p.filesTouched.join('\n')}`)
  }
  if (opts.includeDiff && p.diff.trim()) out.push('## Diff sin confirmar\n```diff\n' + p.diff + '\n```')
  out.push(
    opts.note?.trim()
      ? `## Lo que te pido ahora\n${opts.note.trim()}`
      : '## Lo que te pido ahora\nRevisa el estado real de los ficheros, termina las tareas pendientes y di al final qué has hecho y qué falta.'
  )
  return out.join('\n\n')
}
