/**
 * Lo que sabe hacer cada agente de línea de comandos, para no ofrecer en la
 * interfaz lo que su CLI no admite ni colarle una bandera inventada.
 *
 * Reanudar: seguir en la misma sesión del agente en vez de empezar de cero en
 * cada turno. Bifurcar: seguir desde ella pero en una sesión nueva, dejando la
 * original como estaba. Las opciones son las documentadas por cada CLI.
 */

import { ACP_PERMISSION_MODES, PERMISSION_MODES } from './types'

/** Nombre del ejecutable sin ruta ni extensión. */
export function baseCommand(command: string): string {
  return (command.split(/[\\/]/).pop() ?? command).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

export interface ResumeCaps {
  /** Puede retomar una sesión concreta por su id. */
  byId: boolean
  /** Puede bifurcar al retomar. */
  fork: boolean
  /** Retoma, pero no por id: lo que haya guardado en la carpeta (Aider). */
  byFolder?: boolean
}

const CAPS: Record<string, ResumeCaps> = {
  // claude -p --resume <id> [--fork-session]
  claude: { byId: true, fork: true },
  // opencode run --session <id> [--fork]
  opencode: { byId: true, fork: true },
  // codex exec resume <id> "prompt"
  codex: { byId: true, fork: false },
  // gemini --resume <uuid> -p "prompt"
  gemini: { byId: true, fork: false },
  qwen: { byId: true, fork: false },
  // cursor-agent --resume <chatId> -p "prompt"
  'cursor-agent': { byId: true, fork: false },
  // aider --restore-chat-history: la conversación guardada en el repositorio
  aider: { byId: false, fork: false, byFolder: true }
}

export function resumeCaps(command: string): ResumeCaps {
  return CAPS[baseCommand(command)] ?? { byId: false, fork: false }
}

/**
 * Los argumentos que retoman la sesión, y dónde van.
 *
 * `beforePrompt`: Codex usa un subcomando (`exec resume <id>`) que tiene que
 * ir detrás de las opciones de `exec` y justo delante del prompt. El resto son
 * opciones normales y se encajan como las del esfuerzo o el modelo.
 * Devuelve null si ese CLI no puede hacer lo que se le pide.
 */
export function resumeArgs(
  command: string,
  sessionId: string | undefined,
  fork = false
): { args: string[]; beforePrompt?: boolean } | null {
  const cmd = baseCommand(command)
  const caps = resumeCaps(command)
  if (caps.byFolder) return fork ? null : { args: ['--restore-chat-history'] }
  if (!caps.byId || !sessionId) return null
  if (fork && !caps.fork) return null
  switch (cmd) {
    case 'claude':
      return { args: ['--resume', sessionId, ...(fork ? ['--fork-session'] : [])] }
    case 'opencode':
      return { args: ['--session', sessionId, ...(fork ? ['--fork'] : [])] }
    case 'codex':
      return { args: ['resume', sessionId], beforePrompt: true }
    case 'gemini':
    case 'qwen':
    case 'cursor-agent':
      return { args: ['--resume', sessionId] }
    default:
      return null
  }
}

/**
 * Los modos de permiso que entiende cada CLI desde aquí, y con cuál empieza:
 * Claude Code los suyos (y pregunta por la entrada estándar); OpenCode y
 * Gemini CLI, por ACP, preguntar, sólo plan o decir que sí a todo. El resto
 * no deja elegir.
 */
export function cliPermissionModes(
  command: string
): { modes: readonly { id: string; label: string; hint: string }[]; initial: string } | null {
  const cmd = baseCommand(command)
  if (cmd === 'claude') return { modes: PERMISSION_MODES, initial: 'acceptEdits' }
  if (cmd === 'opencode' || cmd === 'gemini') return { modes: ACP_PERMISSION_MODES, initial: 'manual' }
  return null
}
