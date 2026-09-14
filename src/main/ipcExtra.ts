/**
 * Canales de terminales, sesiones, Ollama, enlaces de modelos y avisos.
 * Van aparte de ipc.ts sólo para no tener un fichero de mil líneas.
 */
import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { handle } from './ipc'
import {
  createTerm, runInTerm, writeTerm, interruptTerm, closeTerm, listTerms,
  availableShells, defaultShell, termCwd, resizeTerm, terminalStatus
} from './terminal'
import {
  listSessions, getSession, saveSession, patchSession, removeSession,
  archiveSession, clearArchived, clearSessions
} from './sessions'
import {
  ollamaStatus, startOllama, pullModel, cancelPull, activePulls, deleteModel,
  hardware, recommendations, bestPicks
} from './ollama'
import { modelLinks } from './providers/links'
import {
  gitInfo, gitCheckout, changedFiles, gitRun, gitLog, gitDiff, gitStage, gitCommit, isDestructive,
  gitGraph, gitState, gitOp, gitShow
} from './git'
import { watchRepo, unwatchRepo, pokeRepo } from './watch'
import { usageSnapshots, cliLimitOf } from './usage'
import { claudeWindows, refreshClaude } from './claudeSessions'
import { pickAttachments, describeFile } from './attach'
import { listDir, readProjectFile, writeProjectFile, createEntry, trashEntry, revealEntry } from './files'
import { ghStatus, ghRepos, ghClone, ghLoginCommand, ghLogoutCommand, forgetGhPath } from './github'
import { notifyArena, notifyCommand, notifyPull } from './notify'
import { allRuns } from './runs'
import { getConfig } from './config'
import type { GitOpName, GitOpParams, StoredSession, TermEvent, PullProgress } from '@shared/types'

export function registerExtraIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  /* -------------------------------- Terminales -------------------------------- */

  // El comando de cada bloque se recuerda aquí para poder avisar al terminar
  // uno largo sin obligar al renderer a devolvérnoslo.
  const lastCommand = new Map<string, { text: string; at: number }>()

  const dispatch = (termId: string, e: Omit<TermEvent, 'termId'>): void => {
    send('term:event', { termId, ...e })
    if (e.type === 'block-end' && e.durationMs) {
      const cmd = lastCommand.get(termId)
      if (cmd) notifyCommand(cmd.text, e.exitCode ?? 0, e.durationMs)
    }
  }

  handle('term:resize', (id: string, cols: number, rows: number) => resizeTerm(id, cols, rows))
  handle('term:pty', () => terminalStatus())

  handle('term:create', async (opts: {
    cwd?: string; shell?: string; projectId?: string; title?: string
    cols?: number; rows?: number; forcePipe?: boolean
  }) => {
    const shell = opts?.shell || getConfig().settings.shellPath || defaultShell()
    // El id no se conoce hasta que createTerm devuelve, así que lo que llegue
    // mientras tanto se encola y se despacha justo después.
    const holder: { id?: string } = {}
    const queue: Omit<TermEvent, 'termId'>[] = []

    const info = await createTerm({ ...opts, shell }, (e) => {
      if (holder.id) dispatch(holder.id, e)
      else queue.push(e)
    })

    holder.id = info.id
    for (const e of queue.splice(0)) dispatch(info.id, e)
    return info
  })

  handle('term:run', (id: string, command: string) => {
    lastCommand.set(id, { text: command, at: Date.now() })
    return runInTerm(id, command)
  })
  handle('term:write', (id: string, data: string) => writeTerm(id, data))
  handle('term:interrupt', (id: string) => interruptTerm(id))
  handle('term:close', (id: string) => {
    lastCommand.delete(id)
    return closeTerm(id)
  })
  handle('term:list', () => listTerms())
  handle('term:cwd', (id: string) => termCwd(id) ?? null)
  handle('term:shells', async () => ({
    shells: availableShells(),
    current: getConfig().settings.shellPath || defaultShell(),
    pty: await terminalStatus()
  }))
  handle('term:home', () => homedir())

  /* -------------------------------- Sesiones ---------------------------------- */

  handle('sessions:list', () => listSessions())
  handle('sessions:get', (id: string) => getSession(id) ?? null)
  handle('sessions:save', (s: StoredSession) => saveSession(s))
  handle('sessions:patch', (id: string, patch: Partial<StoredSession>) => patchSession(id, patch) ?? null)
  handle('sessions:remove', (id: string) => removeSession(id))
  handle('sessions:archive', (id: string, archived: boolean) => archiveSession(id, archived) ?? null)
  handle('sessions:clearArchived', () => clearArchived())
  handle('sessions:clear', () => clearSessions())

  /* --------------------------------- Ollama ----------------------------------- */

  handle('ollama:status', () => ollamaStatus())
  handle('ollama:start', () => startOllama())
  handle('ollama:hardware', () => hardware())
  handle('ollama:recommend', () => recommendations())
  handle('ollama:best', (n: number) => bestPicks(n ?? 2))
  handle('ollama:delete', (name: string) => deleteModel(name))
  handle('ollama:pulls', () => activePulls())
  handle('ollama:cancelPull', (name: string) => cancelPull(name))
  handle('ollama:pull', async (name: string) => {
    let last: PullProgress | undefined
    try {
      await pullModel(name, (p) => {
        last = p
        send('ollama:pullProgress', p)
      })
      const cancelled = (last as PullProgress | undefined)?.status === 'cancelada'
      notifyPull(name, !cancelled, cancelled ? 'cancelada' : undefined)
      return { ok: !cancelled, cancelled }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      send('ollama:pullProgress', { model: name, status: 'error', done: true, error: msg })
      notifyPull(name, false, msg)
      throw err
    }
  })

  /* ----------------------------------- Git ------------------------------------ */

  handle('git:info', (path: string) => gitInfo(path))
  handle('git:changes', (path: string) => changedFiles(path))
  handle('git:checkout', async (path: string, branch: string, create?: boolean) => {
    const r = await gitCheckout(path, branch, { create: Boolean(create) })
    pokeRepo(path)
    return r
  })

  handle('git:log', (path: string, limit?: number) => gitLog(path, limit ?? 30))
  handle('git:diff', (path: string, file?: string, staged?: boolean) =>
    gitDiff(path, { file, staged: Boolean(staged) })
  )
  handle('git:stage', async (path: string, files: string[], stage: boolean) => {
    const r = await gitStage(path, files, stage)
    pokeRepo(path)
    return r
  })
  handle('git:commit', async (path: string, message: string, all?: boolean) => {
    const r = await gitCommit(path, message, { all: Boolean(all) })
    pokeRepo(path)
    return r
  })
  handle('git:run', async (path: string, command: string) => {
    const r = await gitRun(path, command)
    // Lo que acaba de tocar el repositorio se relee sin esperar al vigilante.
    pokeRepo(path)
    return r
  })
  handle('git:isDestructive', (command: string) => isDestructive(command))

  // --- Árbol de commits, estado de la operación en curso y sus acciones ---
  handle('git:graph', (path: string, limit?: number, all?: boolean) =>
    gitGraph(path, { limit, all: all !== false })
  )
  handle('git:state', (path: string) => gitState(path))
  handle('git:show', (path: string, hash: string) => gitShow(path, hash))
  handle('git:op', async (path: string, op: GitOpName, params?: GitOpParams) => {
    const r = await gitOp(path, op, params ?? {})
    pokeRepo(path)
    return r
  })

  // --- Vigilancia: la interfaz se entera sola de lo que pasa en disco ---
  handle('git:watch', (path: string) => watchRepo(path))
  handle('git:unwatch', (path: string) => unwatchRepo(path))
  handle('git:poke', (path: string) => {
    pokeRepo(path)
    return true
  })

  /* -------------------------------- Ficheros ---------------------------------- */

  handle('files:list', (root: string, rel?: string) => listDir(root, rel ?? ''))
  handle('files:read', (root: string, rel: string) => readProjectFile(root, rel))
  handle('files:write', (root: string, rel: string, text: string) => {
    const r = writeProjectFile(root, rel, text)
    // Guardar desde el editor cambia el estado de git: se relee ya.
    pokeRepo(root)
    return r
  })
  handle('files:create', (root: string, rel: string, dir: boolean) => createEntry(root, rel, Boolean(dir)))
  handle('files:trash', (root: string, rel: string) => trashEntry(root, rel))
  handle('files:reveal', (root: string, rel: string) => {
    revealEntry(root, rel)
    return true
  })

  /* --------------------------------- GitHub ----------------------------------- */

  handle('github:status', () => ghStatus())
  handle('github:refresh', () => {
    forgetGhPath()
    return ghStatus()
  })
  handle('github:repos', (limit?: number, query?: string) => ghRepos({ limit, query }))
  handle('github:clone', (repo: string, parentDir: string) => ghClone(repo, parentDir))
  handle('github:loginCommand', () => ghLoginCommand())
  handle('github:logoutCommand', () => ghLogoutCommand())

  /* --------------------------------- Adjuntos --------------------------------- */

  handle('attach:pick', () => pickAttachments())
  handle('attach:describe', (path: string) => describeFile(path))

  /* ---------------------------- Enlaces de modelos ---------------------------- */

  handle('models:links', (providerId: string, model: string) => modelLinks(providerId, model))

  /* ---------------------------------- Uso ------------------------------------- */

  handle('usage:list', () => usageSnapshots())

  /**
   * Uso de Claude Code: lo que llevas gastado en la ventana corta y en la
   * semana, contando también lo que lanzas fuera de la app. La hora del
   * reinicio la dice el propio agente; el tope del plan no lo publica nadie,
   * así que no se enseña ninguno.
   */
  handle('claude:usage', () => {
    const five = cliLimitOf('five_hour')
    return { ...claudeWindows(five?.resetsAt), limit: five ?? null }
  })
  handle('claude:refresh', () => refreshClaude())

  /* --------------------------------- Avisos ----------------------------------- */

  // La Arena sabe cuándo han acabado todas sus columnas; main no, porque cada
  // columna es una llamada suelta. Por eso lo avisa el renderer.
  handle('notify:arena', (runIds: string[]) => {
    const ids = new Set(runIds ?? [])
    const rows = allRuns().filter((r) => ids.has(r.id))
    if (rows.length) notifyArena(rows)
    return rows.length
  })
}
