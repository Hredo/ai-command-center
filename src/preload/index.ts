import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type {
  AppConfig, Settings, Agent, CliAgent, Project, RunOptions, CliRunOptions, RunRecord, StoredSession,
  GitOpName, GitOpParams, RelaySource, RelayPackage, McpClient, Battery, BatteryRun, PromptTemplate, SearchQuery
} from '@shared/types'
import type { IpcChannel, IpcArgs, IpcResult, IpcRes, IpcEvent, IpcEvents } from '@shared/ipcContract'

/**
 * Invoca un canal del proceso principal. El canal, sus argumentos y el tipo
 * de la respuesta salen del contrato (shared/ipcContract.ts): un canal mal
 * escrito o un argumento de más no compilan.
 */
const call = <C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcRes<IpcResult<C>>> =>
  ipcRenderer.invoke(channel, ...args)

/** Escucha un aviso de main. Devuelve la función para dejar de escucharlo. */
const on = <E extends IpcEvent>(channel: E, cb: (payload: IpcEvents[E]) => void): (() => void) => {
  const listener = (_e: unknown, payload: IpcEvents[E]): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  /**
   * El sistema, sin esperar a nadie: la interfaz lo necesita al pintar (los
   * semáforos de macOS, Cmd o Ctrl en los atajos, cómo se llama el Finder).
   */
  platform: process.platform as 'win32' | 'darwin' | 'linux',
  config: {
    get: () => call('config:get'),
    save: (cfg: AppConfig) => call('config:save', cfg),
    settings: (patch: Partial<Settings>) => call('config:settings', patch)
  },
  providers: {
    defs: () => call('providers:defs'),
    status: (probe = true) => call('providers:status', probe),
    test: (id: string) => call('providers:test', id),
    setKey: (id: string, key: string) => call('providers:setKey', id, key),
    keyStatus: () => call('providers:keyStatus'),
    keyPreview: (id: string) => call('providers:keyPreview', id),
    setBaseUrl: (id: string, url: string) => call('providers:setBaseUrl', id, url),
    setEnabled: (id: string, enabled: boolean) => call('providers:setEnabled', id, enabled),
    setPrice: (id: string, model: string, pin: number, pout: number) =>
      call('providers:setPrice', id, model, pin, pout)
  },
  models: {
    fromProvider: (id: string) => call('models:fromProvider', id),
    catalog: (query: string, limit?: number) => call('models:catalog', query, limit),
    catalogMeta: () => call('models:catalogMeta'),
    refresh: () => call('models:refresh'),
    price: (providerId: string, model: string) =>
      call('models:price', providerId, model),
    available: () => call('models:available'),
    links: (providerId: string, model: string) => call('models:links', providerId, model),
    /** Marca o desmarca un favorito («proveedor:modelo»); devuelve la lista entera. */
    favorite: (key: string, on: boolean) => call('models:favorite', key, on)
  },
  detect: {
    all: () => call('detect:all'),
    clis: () => call('detect:clis'),
    local: () => call('detect:local'),
    knownClis: () => call('detect:knownClis'),
    importClis: () => call('detect:importClis')
  },
  run: {
    prompt: (opts: RunOptions, runId: string) => call('run:prompt', opts, runId),
    abort: (runId: string) => call('run:abort', runId),
    /** Contesta a un agente por API que pide permiso para un paso. */
    approve: (runId: string, stepId: string, allow: boolean) => call('run:approve', runId, stepId, allow),
    /** Devuelve la función para desuscribirse. */
    onDelta: (cb: (d: IpcEvents['run:delta']) => void) => on('run:delta', cb)
  },
  cli: {
    run: (opts: CliRunOptions, runId: string) => call('cli:run', opts, runId),
    kill: (runId: string) => call('cli:kill', runId),
    /** Modelos de OpenCode: los de Zen y, con Ollama encendido, los locales. */
    opencodeModels: (force?: boolean) => call('cli:opencodeModels', force),
    onEvent: (cb: (e: IpcEvents['cli:event']) => void) => on('cli:event', cb)
  },
  agents: {
    save: (a: Agent) => call('agents:save', a),
    saveCli: (a: CliAgent) => call('agents:saveCli', a),
    remove: (id: string) => call('agents:remove', id),
    removeCli: (id: string) => call('agents:removeCli', id),
    /** Carpeta donde trabaja un agente cuando no hay proyecto. */
    workspace: (id?: string) => call('agents:workspace', id)
  },
  projects: {
    pick: () => call('projects:pick'),
    save: (p: Project) => call('projects:save', p),
    remove: (id: string) => call('projects:remove', id),
    scan: (path: string) => call('projects:scan', path),
    context: (path: string, opts?: any) => call('projects:context', path, opts),
    files: (path: string, query?: string) => call('projects:files', path, query),
    openEditor: (path: string) => call('projects:openEditor', path),
    openFolder: (path: string) => call('projects:openFolder', path),
    openTerminal: (path: string) => call('projects:openTerminal', path)
  },
  runs: {
    query: (q?: any) => call('runs:query', q),
    overview: (days?: number) => call('runs:overview', days),
    update: (id: string, patch: Partial<RunRecord>) => call('runs:update', id, patch),
    remove: (id: string) => call('runs:delete', id),
    clear: () => call('runs:clear'),
    arena: () => call('runs:arena'),
    /** Quita el detalle a las ejecuciones viejas y archiva el exceso; las métricas se quedan. */
    compact: () =>
      call('runs:compact'),
    compare: (ids: string[]) => call('runs:compare', ids),
    /** Lo medido de cada modelo que has usado, con su Elo si ha competido. */
    modelUsage: () => call('runs:modelUsage'),
    /** Clasificación personal con los ganadores de la Arena. */
    elo: () => call('runs:elo'),
    /** Lo gastado en un proyecto desde siempre, con el reparto por agente. */
    projectTotals: (projectId: string) =>
      call(
        'runs:projectTotals',
        projectId
      ),
    buckets: (field: string, days?: number) => call('runs:buckets', field, days),
    export: (format: 'json' | 'csv') => call('runs:export', format)
  },
  /** Terminales integradas: una shell persistente por pestaña. */
  term: {
    create: (opts: {
      cwd?: string; shell?: string; projectId?: string; title?: string
      cols?: number; rows?: number; forcePipe?: boolean
    }) => call('term:create', opts),
    /** Ajusta la rejilla de la consola al tamaño del panel. */
    resize: (id: string, cols: number, rows: number) => call('term:resize', id, cols, rows),
    /** Si hay consola de verdad (PTY) o se está usando el respaldo. */
    pty: () => call('term:pty'),
    /** Lanza un comando y abre un bloque nuevo. */
    run: (id: string, command: string) => call('term:run', id, command),
    /** Escritura cruda en stdin, para responder a un programa que pregunta. */
    write: (id: string, data: string) => call('term:write', id, data),
    interrupt: (id: string) => call('term:interrupt', id),
    close: (id: string) => call('term:close', id),
    list: () => call('term:list'),
    cwd: (id: string) => call('term:cwd', id),
    shells: () =>
      call('term:shells'),
    home: () => call('term:home'),
    onEvent: (cb: (e: IpcEvents['term:event']) => void) => on('term:event', cb)
  },
  /** Conversaciones y sesiones de agente que se pueden cerrar y retomar. */
  sessions: {
    list: () => call('sessions:list'),
    get: (id: string) => call('sessions:get', id),
    save: (s: StoredSession) => call('sessions:save', s),
    patch: (id: string, patch: Partial<StoredSession>) => call('sessions:patch', id, patch),
    remove: (id: string) => call('sessions:remove', id),
    archive: (id: string, archived: boolean) => call('sessions:archive', id, archived),
    clearArchived: () => call('sessions:clearArchived'),
    clear: () => call('sessions:clear')
  },
  ollama: {
    status: () => call('ollama:status'),
    start: () => call('ollama:start'),
    hardware: () => call('ollama:hardware'),
    recommend: () =>
      call('ollama:recommend'),
    best: (n?: number) => call('ollama:best', n),
    pull: (name: string) => call('ollama:pull', name),
    cancelPull: (name: string) => call('ollama:cancelPull', name),
    pulls: () => call('ollama:pulls'),
    remove: (name: string) => call('ollama:delete', name),
    onPullProgress: (cb: (p: IpcEvents['ollama:pullProgress']) => void) => on('ollama:pullProgress', cb)
  },
  git: {
    info: (path: string) => call('git:info', path),
    changes: (path: string) => call('git:changes', path),
    checkout: (path: string, branch: string, create = false) =>
      call('git:checkout', path, branch, create),
    log: (path: string, limit = 30) =>
      call(
        'git:log',
        path,
        limit
      ),
    diff: (path: string, file?: string, staged = false) => call('git:diff', path, file, staged),
    stage: (path: string, files: string[], stage: boolean) => call('git:stage', path, files, stage),
    commit: (path: string, message: string, all = false) => call('git:commit', path, message, all),
    /** Un modelo escribe el mensaje del commit a partir del diff. */
    suggestCommit: (path: string, pick: { providerId: string; model: string }, lang?: 'es' | 'en') =>
      call('git:suggestCommit', path, pick, lang),
    run: (path: string, command: string) => call('git:run', path, command),
    isDestructive: (command: string) => call('git:isDestructive', command),
    /** Árbol de commits con sus padres, para dibujar ramas y merges. */
    graph: (path: string, limit = 120, all = true) => call('git:graph', path, limit, all),
    /** Si hay un merge o un rebase a medias y qué ficheros están en conflicto. */
    state: (path: string) => call('git:state', path),
    show: (path: string, hash: string) => call('git:show', path, hash),
    /** Acciones del árbol: merge, rebase, continuar, abortar, ramas, etiquetas… */
    op: (path: string, op: GitOpName, params?: GitOpParams) => call('git:op', path, op, params),
    /** Vigila la carpeta: mientras haya alguien mirando, llegan avisos solos. */
    watch: (path: string) => call('git:watch', path),
    unwatch: (path: string) => call('git:unwatch', path),
    poke: (path: string) => call('git:poke', path),
    onChanged: (cb: (e: IpcEvents['git:changed']) => void) => on('git:changed', cb)
  },
  /** Consumo: lo último que dijo cada proveedor sobre tus límites. */
  usage: {
    list: () => call('usage:list'),
    /** Uso de Claude Code: ventana de 5 h y semana, con lo de fuera de la app. */
    claude: () => call('claude:usage'),
    refreshClaude: () => call('claude:refresh'),
    onClaudeUpdated: (cb: (p: IpcEvents['claude:updated']) => void) => on('claude:updated', cb),
    onUpdated: (cb: (all: IpcEvents['usage:updated']) => void) => on('usage:updated', cb)
  },
  files: {
    list: (root: string, rel = '') => call('files:list', root, rel),
    /** Busca por nombre en todo el proyecto (sin node_modules ni .git). */
    search: (root: string, query: string) => call('files:search', root, query),
    read: (root: string, rel: string) => call('files:read', root, rel),
    write: (root: string, rel: string, text: string) => call('files:write', root, rel, text),
    create: (root: string, rel: string, dir: boolean) => call('files:create', root, rel, dir),
    trash: (root: string, rel: string) => call('files:trash', root, rel),
    reveal: (root: string, rel: string) => call('files:reveal', root, rel)
  },
  github: {
    status: () => call('github:status'),
    refresh: () => call('github:refresh'),
    repos: (limit = 60, query?: string) => call('github:repos', limit, query),
    clone: (repo: string, parentDir: string) =>
      call('github:clone', repo, parentDir),
    loginCommand: () => call('github:loginCommand'),
    logoutCommand: () => call('github:logoutCommand')
  },
  attach: {
    pick: () => call('attach:pick'),
    describe: (path: string) => call('attach:describe', path),
    /** Una imagen pegada: se guarda en la carpeta de datos y vuelve como adjunto. */
    paste: (data: Uint8Array, mime: string) => call('attach:paste', data, mime),
    /** Miniatura en data URL de una imagen adjunta. */
    thumb: (path: string) => call('attach:thumb', path),
    /** Abre un adjunto con el programa del sistema. */
    open: (path: string) => call('attach:open', path),
    /** La ruta en disco de un archivo arrastrado a la ventana. */
    pathOf: (file: File): string => webUtils.getPathForFile(file)
  },
  /** Relevo: pasar un trabajo a medias de una IA a otra con todo su contexto. */
  relay: {
    build: (src: RelaySource) => call('relay:build', src),
    prompt: (pkg: RelayPackage, opts?: { includeDiff?: boolean; note?: string }) =>
      call('relay:prompt', pkg, opts)
  },
  /** Sesiones de Codex, OpenCode y Gemini CLI abiertas fuera de la app. */
  external: {
    refresh: () => call('external:refresh'),
    onUpdated: (cb: (p: IpcEvents['external:updated']) => void) => on('external:updated', cb)
  },
  /** AGENTS.md, CLAUDE.md y GEMINI.md de un proyecto. */
  instructions: {
    read: (root: string) => call('instructions:read', root),
    /** Guarda uno o varios a la vez; falla sin tocar nada si alguno cambió en disco. */
    write: (root: string, writes: { file: string; content: string; expectedMtime: number | null }[]) =>
      call('instructions:write', root, writes)
  },
  /** Las Skills (SKILL.md) de cada CLI: dónde están, quién las ve y copiarlas. */
  skills: {
    list: (projectPath?: string) => call('skills:list', projectPath),
    copy: (source: string, target: { id: string; scope: 'personal' | 'project' }, projectPath?: string) =>
      call('skills:copy', source, target, projectPath)
  },
  /** Baterías de prompts: definición, resultados y el juez local. */
  batteries: {
    save: (battery: Battery) => call('batteries:save', battery),
    remove: (id: string) => call('batteries:remove', id),
    runs: (batteryId?: string) => call('batteries:runs', batteryId),
    saveRun: (run: BatteryRun) => call('batteries:saveRun', run),
    removeRun: (id: string) => call('batteries:removeRun', id),
    judge: (model: string, input: { rubric: string; prompt: string; response: string }) => call('batteries:judge', model, input)
  },
  /** Exportar e importar conversaciones (Markdown y JSON). */
  exchange: {
    export: (ids: string[], format: 'md' | 'json', lang?: 'es' | 'en') => call('sessions:export', ids, format, lang),
    import: () => call('sessions:import')
  },
  /** Búsqueda de texto completo en conversaciones e histórico. */
  search: {
    query: (q: SearchQuery) => call('search:query', q)
  },
  /** Biblioteca de prompts con variables. */
  prompts: {
    save: (prompt: PromptTemplate) => call('prompts:save', prompt),
    remove: (id: string) => call('prompts:remove', id),
    used: (id: string) => call('prompts:used', id)
  },
  /** El recomendador: un modelo local de Ollama clasifica la tarea. */
  recommend: {
    classify: (text: string, model: string) =>
      call('recommend:classify', text, model)
  },
  /** Servidores MCP de cada CLI y de los agentes por API de la app. */
  mcp: {
    list: (projectPath?: string) => call('mcp:list', projectPath),
    /** Qué se escribiría al copiar, sin escribir nada. */
    plan: (
      from: { client: McpClient; scope: 'personal' | 'project'; name: string },
      to: { client: McpClient; scope: 'personal' | 'project' },
      projectPath?: string
    ) => call('mcp:plan', from, to, projectPath),
    copy: (
      from: { client: McpClient; scope: 'personal' | 'project'; name: string },
      to: { client: McpClient; scope: 'personal' | 'project' },
      projectPath?: string
    ) => call('mcp:copy', from, to, projectPath),
    enable: (name: string, enabled: boolean) => call('mcp:app:enable', name, enabled),
    remove: (name: string) => call('mcp:app:remove', name),
    add: (input: { name: string; target: string; envVars?: string[] }) => call('mcp:app:add', input),
    test: (name: string) =>
      call('mcp:app:test', name)
  },
  /** Un worktree por tarea: crear, listar, fusionar y quitar. */
  worktrees: {
    list: (cwd: string) => call('worktrees:list', cwd),
    create: (cwd: string, opts: { label: string; projectId?: string; base?: string; sessionId?: string }) =>
      call('worktrees:create', cwd, opts),
    merge: (path: string, opts?: { message?: string }) =>
      call('worktrees:merge', path, opts),
    remove: (path: string, opts?: { force?: boolean; deleteBranch?: boolean }) => call('worktrees:remove', path, opts),
    link: (path: string, sessionId?: string) => call('worktrees:link', path, sessionId),
    /** Ejecuta una orden (las pruebas) dentro de un worktree del repositorio. */
    exec: (path: string, command: string) => call('worktrees:exec', path, command)
  },
  /** Puntos de control: deshacer lo que hizo un turno de un agente. */
  checkpoints: {
    preview: (root: string, id: string) =>
      call('checkpoints:preview', root, id),
    undo: (root: string, id: string) =>
      call('checkpoints:undo', root, id),
    /** Lo que cambió desde antes del turno: hasta el turno siguiente (untilId) o hasta ahora. */
    diff: (root: string, id: string, untilId?: string) =>
      call('checkpoints:diff', root, id, untilId)
  },
  /** Cupos de todas las IAs, presupuestos y avisos. */
  /** Claude Code en una terminal que espera tu respuesta (su hook Notification). */
  attention: {
    list: () => call('attention:list'),
    dismiss: (id: string) => call('attention:dismiss', id),
    hook: () => call('attention:hook'),
    install: () => call('attention:install'),
    uninstall: () => call('attention:uninstall'),
    onChanged: (cb: (list: IpcEvents['attention:changed']) => void) => on('attention:changed', cb)
  },
  quotas: {
    get: (force?: boolean) => call('quotas:get', force),
    statusLine: () => call('quotas:statusLine'),
    installStatusLine: () => call('quotas:installStatusLine'),
    uninstallStatusLine: () => call('quotas:uninstallStatusLine'),
    adminKeys: () => call('quotas:adminKeys'),
    setAdminKey: (which: 'anthropic' | 'openai', key: string) =>
      call('quotas:setAdminKey', which, key),
    onUpdated: (cb: (r: IpcEvents['quotas:updated']) => void) => on('quotas:updated', cb),
    onAlert: (cb: (a: IpcEvents['quotas:alert']) => void) => on('quotas:alert', cb)
  },
  /** Avisos de que algo cambió en el proceso principal: quien lo lea se relee. */
  live: {
    onChanged: (cb: (e: IpcEvents['live:changed']) => void) => on('live:changed', cb)
  },
  notify: {
    /** La Arena avisa como grupo cuando todas sus columnas han terminado. */
    arena: (runIds: string[]) => call('notify:arena', runIds)
  },
  app: {
    info: () => call('app:info'),
    openExternal: (url: string) => call('app:openExternal', url),
    openDataDir: () => call('app:openDataDir'),
    /** Qué está cerrado y qué no: lo enseña la pestaña de Seguridad. */
    security: () => call('app:security'),
    /**
     * Escala de la ventana y colores de la barra de título.
     *
     * El zoom se aplica aquí mismo porque `webFrame` sólo existe de este lado
     * del puente; el proceso principal se entera para recolocar los botones de
     * Windows, que los pinta el sistema y no se enteran del zoom por su cuenta.
     */
    setChrome: (opts: { zoom?: number; background?: string; symbol?: string }) => {
      const zoom = Math.min(2, Math.max(0.5, Number(opts?.zoom) || 1))
      webFrame.setZoomFactor(zoom)
      return call('app:chrome', { ...opts, zoom })
    },
    onCatalogUpdated: (cb: (r: IpcEvents['catalog:updated']) => void) => on('catalog:updated', cb),
    /** Se dispara cuando un motor local aparece, desaparece o cambia modelos. */
    onLocalChanged: (cb: (servers: IpcEvents['detect:localChanged']) => void) => on('detect:localChanged', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
