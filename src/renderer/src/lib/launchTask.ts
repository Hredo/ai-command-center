/**
 * Lanzar una tarea: un agente sobre un proyecto, en su propia conversación y,
 * si se pide, en un worktree aparte. Lo usan el tablero de Tareas («Nueva
 * tarea») y las tareas programadas, que así funcionan exactamente igual.
 */
import { newSession, patchSessionConfig, sendTurn } from './engine'
import { PERMISSION_MODES, API_PERMISSION_MODES, type AppConfig, type RunRecord } from '@shared/types'

export interface TaskSpec {
  projectId: string
  /** 'cli:<id>', 'api:<id>' o 'model' (con `pick`). */
  agent: string
  pick?: { providerId: string; model: string } | null
  permissionMode?: string
  worktree: boolean
  prompt: string
  title?: string
}

export interface TaskLaunch {
  /** La conversación creada, aunque luego no se haya podido lanzar. */
  sessionId?: string
  /** No se llegó a lanzar. */
  error?: string
  /** Se lanzó, pero con algo que avisar (la preparación del worktree falló). */
  warning?: string
  /** Termina cuando el agente acaba su turno. */
  done: Promise<{ run?: RunRecord; error?: string }>
}

const nothing = Promise.resolve({})

type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * Los modos de permiso que entiende cada agente: los de Claude Code para él,
 * ninguno para los demás CLI y los de la app para lo que va por API.
 */
export function permissionModesFor(agent: string, config: AppConfig): readonly { id: string; label: string; hint: string }[] | null {
  if (agent.startsWith('cli:')) {
    const a = config.cliAgents.find((x) => x.id === agent.slice(4))
    return a?.command.toLowerCase() === 'claude' ? PERMISSION_MODES : null
  }
  return API_PERMISSION_MODES
}

export async function launchTask(spec: TaskSpec, config: AppConfig, t: Translate): Promise<TaskLaunch> {
  const p = config.projects.find((x) => x.id === spec.projectId)
  if (!p) return { error: t('Ese proyecto ya no existe'), done: nothing }
  const text = spec.prompt.trim()
  if (!text) return { error: t('La tarea está vacía'), done: nothing }
  const cliAgent = spec.agent.startsWith('cli:') ? config.cliAgents.find((a) => a.id === spec.agent.slice(4)) : undefined
  const apiAgent = spec.agent.startsWith('api:') ? config.agents.find((a) => a.id === spec.agent.slice(4)) : undefined
  if (spec.agent !== 'model' && !cliAgent && !apiAgent) return { error: t('Ese agente ya no existe'), done: nothing }
  if (spec.agent === 'model' && !spec.pick) return { error: t('Falta el modelo'), done: nothing }

  // Con nombre propio (una programada) se queda con él: el primer turno no lo cambia.
  const named = Boolean(spec.title?.trim())
  const title = spec.title?.trim() || text.replace(/\s+/g, ' ').slice(0, 54)
  const modes = permissionModesFor(spec.agent, config)
  const mode = spec.permissionMode && modes?.some((m) => m.id === spec.permissionMode) ? spec.permissionMode : undefined
  const id = cliAgent
    ? await newSession('cli', { title, titled: named, cliAgentId: cliAgent.id, cliModel: cliAgent.model, projectId: p.id, permissionMode: mode })
    : apiAgent
      ? await newSession('chat', {
          title,
          titled: named,
          agentId: apiAgent.id,
          providerId: apiAgent.providerId,
          model: apiAgent.model,
          systemPrompt: apiAgent.systemPrompt,
          temperature: apiAgent.temperature,
          maxTokens: apiAgent.maxTokens,
          effort: apiAgent.effort,
          projectId: p.id,
          permissionMode: mode
        })
      : await newSession('chat', {
          title,
          titled: named,
          providerId: spec.pick!.providerId,
          model: spec.pick!.model,
          projectId: p.id,
          agentMode: true,
          maxTokens: 8192,
          permissionMode: mode
        })

  let warning: string | undefined
  if (spec.worktree) {
    const r = await window.api.worktrees.create(p.path, { label: title, projectId: p.id, sessionId: id })
    if (!r.ok || !r.data) {
      return { sessionId: id, error: t('No se pudo crear el worktree: {error}. La tarea está en la Consola sin lanzar.', { error: r.error ?? '' }), done: nothing }
    }
    patchSessionConfig(id, { worktreePath: r.data.path })
    if (r.data.setup && !r.data.setup.ok) warning = t('El worktree está creado, pero su preparación falló: {cmd}', { cmd: r.data.setup.command })
  }
  return { sessionId: id, warning, done: sendTurn(id, text, config) }
}
