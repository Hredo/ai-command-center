import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type {
  AppConfig, Settings, ProviderDef, ProviderStatus, ModelInfo, Agent, CliAgent, Project,
  ProjectInfo, RunOptions, CliRunOptions, RunRecord, DetectionResult, DetectedCli,
  DetectedServer, StatsBucket, StreamDelta, CliEvent, TermInfo, TermEvent,
  StoredSession, OllamaStatus, HardwareInfo, ModelRecommendation, PullProgress, ModelLinks, OpencodeModel,
  GitInfo, FileChange, Attachment, DirEntry, FileContent, GhStatus, GhRepo,
  GitGraph, GitOpState, GitOpName, GitOpParams, GitWatchEvent, UsageSnapshot, ClaudeUsage
} from '@shared/types'

/** Lo que la aplicación puede decir sobre su propio aislamiento. */
interface SecurityReport {
  contextIsolation: boolean
  nodeIntegration: boolean
  sandboxedRenderer: boolean
  csp: boolean
  navigationLocked: boolean
  permissionsDenied: boolean
  encryptionAvailable: boolean
  packaged: boolean
  dataDir: string
}

/** Lo que devuelve un comando de git lanzado desde la interfaz. */
interface GitCmd {
  ok: boolean
  out: string
  err: string
  command: string
  refused?: string
}

/** Respuesta uniforme de todos los handlers: nunca lanza, siempre informa. */
interface Res<T> {
  ok: boolean
  data?: T
  error?: string
}

const call = <T>(channel: string, ...args: any[]): Promise<Res<T>> => ipcRenderer.invoke(channel, ...args)

const api = {
  /**
   * El sistema, sin esperar a nadie: la interfaz lo necesita al pintar (los
   * semáforos de macOS, Cmd o Ctrl en los atajos, cómo se llama el Finder).
   */
  platform: process.platform as 'win32' | 'darwin' | 'linux',
  config: {
    get: () => call<AppConfig>('config:get'),
    save: (cfg: AppConfig) => call<AppConfig>('config:save', cfg),
    settings: (patch: Partial<Settings>) => call<AppConfig>('config:settings', patch)
  },
  providers: {
    defs: () => call<ProviderDef[]>('providers:defs'),
    status: (probe = true) => call<ProviderStatus[]>('providers:status', probe),
    test: (id: string) => call<{ ok: boolean; detail: string; ms: number }>('providers:test', id),
    setKey: (id: string, key: string) => call<{ source: string; masked: string }>('providers:setKey', id, key),
    keyStatus: () => call<Record<string, string>>('providers:keyStatus'),
    keyPreview: (id: string) => call<string>('providers:keyPreview', id),
    setBaseUrl: (id: string, url: string) => call<AppConfig>('providers:setBaseUrl', id, url),
    setEnabled: (id: string, enabled: boolean) => call<AppConfig>('providers:setEnabled', id, enabled),
    setPrice: (id: string, model: string, pin: number, pout: number) =>
      call<AppConfig>('providers:setPrice', id, model, pin, pout)
  },
  models: {
    fromProvider: (id: string) => call<ModelInfo[]>('models:fromProvider', id),
    catalog: (query: string, limit?: number) => call<ModelInfo[]>('models:catalog', query, limit),
    catalogMeta: () => call<{ fetchedAt: number; count: number }>('models:catalogMeta'),
    refresh: () => call<{ count: number; sources: string[]; errors: string[] }>('models:refresh'),
    price: (providerId: string, model: string) =>
      call<{ in: number; out: number; source: string }>('models:price', providerId, model),
    available: () => call<any[]>('models:available'),
    links: (providerId: string, model: string) => call<ModelLinks>('models:links', providerId, model)
  },
  detect: {
    all: () => call<DetectionResult>('detect:all'),
    clis: () => call<DetectedCli[]>('detect:clis'),
    local: () => call<DetectedServer[]>('detect:local'),
    knownClis: () => call<any[]>('detect:knownClis'),
    importClis: () => call<{ added: number; found: number }>('detect:importClis')
  },
  run: {
    prompt: (opts: RunOptions, runId: string) => call<RunRecord>('run:prompt', opts, runId),
    abort: (runId: string) => call<boolean>('run:abort', runId),
    /** Contesta a un agente por API que pide permiso para un paso. */
    approve: (runId: string, stepId: string, allow: boolean) => call<boolean>('run:approve', runId, stepId, allow),
    /** Devuelve la función para desuscribirse. */
    onDelta: (cb: (d: StreamDelta) => void) => {
      const listener = (_e: unknown, payload: StreamDelta): void => cb(payload)
      ipcRenderer.on('run:delta', listener)
      return () => {
        ipcRenderer.removeListener('run:delta', listener)
      }
    }
  },
  cli: {
    run: (opts: CliRunOptions, runId: string) => call<RunRecord>('cli:run', opts, runId),
    kill: (runId: string) => call<boolean>('cli:kill', runId),
    /** Modelos de OpenCode: los de Zen y, con Ollama encendido, los locales. */
    opencodeModels: (force?: boolean) => call<OpencodeModel[]>('cli:opencodeModels', force),
    onEvent: (cb: (e: CliEvent) => void) => {
      const listener = (_e: unknown, payload: CliEvent): void => cb(payload)
      ipcRenderer.on('cli:event', listener)
      return () => {
        ipcRenderer.removeListener('cli:event', listener)
      }
    }
  },
  agents: {
    save: (a: Agent) => call<AppConfig>('agents:save', a),
    saveCli: (a: CliAgent) => call<AppConfig>('agents:saveCli', a),
    remove: (id: string) => call<AppConfig>('agents:remove', id),
    removeCli: (id: string) => call<AppConfig>('agents:removeCli', id),
    /** Carpeta donde trabaja un agente cuando no hay proyecto. */
    workspace: (id?: string) => call<string>('agents:workspace', id)
  },
  projects: {
    pick: () => call<string | null>('projects:pick'),
    save: (p: Project) => call<AppConfig>('projects:save', p),
    remove: (id: string) => call<AppConfig>('projects:remove', id),
    scan: (path: string) => call<ProjectInfo>('projects:scan', path),
    context: (path: string, opts?: any) => call<string>('projects:context', path, opts),
    files: (path: string, query?: string) => call<string[]>('projects:files', path, query),
    openEditor: (path: string) => call<{ ok: boolean; error?: string }>('projects:openEditor', path),
    openFolder: (path: string) => call<void>('projects:openFolder', path),
    openTerminal: (path: string) => call<{ ok: boolean; error?: string }>('projects:openTerminal', path)
  },
  runs: {
    query: (q?: any) => call<{ rows: RunRecord[]; total: number }>('runs:query', q),
    overview: (days?: number) => call<any>('runs:overview', days),
    update: (id: string, patch: Partial<RunRecord>) => call<RunRecord>('runs:update', id, patch),
    remove: (id: string) => call<void>('runs:delete', id),
    clear: () => call<void>('runs:clear'),
    arena: () => call<{ arenaId: string; createdAt: number; prompt: string; runs: RunRecord[] }[]>('runs:arena'),
    compare: (ids: string[]) => call<RunRecord[]>('runs:compare', ids),
    buckets: (field: string, days?: number) => call<StatsBucket[]>('runs:buckets', field, days),
    export: (format: 'json' | 'csv') => call<{ path: string; rows: number } | null>('runs:export', format)
  },
  /** Terminales integradas: una shell persistente por pestaña. */
  term: {
    create: (opts: {
      cwd?: string; shell?: string; projectId?: string; title?: string
      cols?: number; rows?: number; forcePipe?: boolean
    }) => call<TermInfo>('term:create', opts),
    /** Ajusta la rejilla de la consola al tamaño del panel. */
    resize: (id: string, cols: number, rows: number) => call<boolean>('term:resize', id, cols, rows),
    /** Si hay consola de verdad (PTY) o se está usando el respaldo. */
    pty: () => call<{ available: boolean; engine?: 'native' | 'bridge' | 'pipe'; reason?: string }>('term:pty'),
    /** Lanza un comando y abre un bloque nuevo. */
    run: (id: string, command: string) => call<boolean>('term:run', id, command),
    /** Escritura cruda en stdin, para responder a un programa que pregunta. */
    write: (id: string, data: string) => call<boolean>('term:write', id, data),
    interrupt: (id: string) => call<boolean>('term:interrupt', id),
    close: (id: string) => call<boolean>('term:close', id),
    list: () => call<TermInfo[]>('term:list'),
    cwd: (id: string) => call<string | null>('term:cwd', id),
    shells: () =>
      call<{
        shells: { path: string; label: string }[]
        current: string
        pty: { available: boolean; reason?: string }
      }>('term:shells'),
    home: () => call<string>('term:home'),
    onEvent: (cb: (e: TermEvent) => void) => {
      const listener = (_e: unknown, payload: TermEvent): void => cb(payload)
      ipcRenderer.on('term:event', listener)
      return () => {
        ipcRenderer.removeListener('term:event', listener)
      }
    }
  },
  /** Conversaciones y sesiones de agente que se pueden cerrar y retomar. */
  sessions: {
    list: () => call<StoredSession[]>('sessions:list'),
    get: (id: string) => call<StoredSession | null>('sessions:get', id),
    save: (s: StoredSession) => call<StoredSession>('sessions:save', s),
    patch: (id: string, patch: Partial<StoredSession>) => call<StoredSession | null>('sessions:patch', id, patch),
    remove: (id: string) => call<boolean>('sessions:remove', id),
    archive: (id: string, archived: boolean) => call<StoredSession | null>('sessions:archive', id, archived),
    clearArchived: () => call<number>('sessions:clearArchived'),
    clear: () => call<void>('sessions:clear')
  },
  ollama: {
    status: () => call<OllamaStatus>('ollama:status'),
    start: () => call<{ started: boolean; detail: string }>('ollama:start'),
    hardware: () => call<HardwareInfo>('ollama:hardware'),
    recommend: () =>
      call<{ hw: HardwareInfo; installed: string[]; items: ModelRecommendation[] }>('ollama:recommend'),
    best: (n?: number) => call<{ hw: HardwareInfo; items: ModelRecommendation[] }>('ollama:best', n),
    pull: (name: string) => call<{ ok: boolean; cancelled: boolean }>('ollama:pull', name),
    cancelPull: (name: string) => call<boolean>('ollama:cancelPull', name),
    pulls: () => call<string[]>('ollama:pulls'),
    remove: (name: string) => call<void>('ollama:delete', name),
    onPullProgress: (cb: (p: PullProgress) => void) => {
      const listener = (_e: unknown, payload: PullProgress): void => cb(payload)
      ipcRenderer.on('ollama:pullProgress', listener)
      return () => {
        ipcRenderer.removeListener('ollama:pullProgress', listener)
      }
    }
  },
  git: {
    info: (path: string) => call<GitInfo>('git:info', path),
    changes: (path: string) => call<FileChange[]>('git:changes', path),
    checkout: (path: string, branch: string, create = false) =>
      call<{ ok: boolean; detail: string; info?: GitInfo }>('git:checkout', path, branch, create),
    log: (path: string, limit = 30) =>
      call<{ hash: string; short: string; subject: string; author: string; at: number; refs?: string }[]>(
        'git:log',
        path,
        limit
      ),
    diff: (path: string, file?: string, staged = false) => call<string>('git:diff', path, file, staged),
    stage: (path: string, files: string[], stage: boolean) => call<GitCmd>('git:stage', path, files, stage),
    commit: (path: string, message: string, all = false) => call<GitCmd>('git:commit', path, message, all),
    run: (path: string, command: string) => call<GitCmd>('git:run', path, command),
    isDestructive: (command: string) => call<boolean>('git:isDestructive', command),
    /** Árbol de commits con sus padres, para dibujar ramas y merges. */
    graph: (path: string, limit = 120, all = true) => call<GitGraph>('git:graph', path, limit, all),
    /** Si hay un merge o un rebase a medias y qué ficheros están en conflicto. */
    state: (path: string) => call<GitOpState>('git:state', path),
    show: (path: string, hash: string) => call<string>('git:show', path, hash),
    /** Acciones del árbol: merge, rebase, continuar, abortar, ramas, etiquetas… */
    op: (path: string, op: GitOpName, params?: GitOpParams) => call<GitCmd>('git:op', path, op, params),
    /** Vigila la carpeta: mientras haya alguien mirando, llegan avisos solos. */
    watch: (path: string) => call<boolean>('git:watch', path),
    unwatch: (path: string) => call<boolean>('git:unwatch', path),
    poke: (path: string) => call<boolean>('git:poke', path),
    onChanged: (cb: (e: GitWatchEvent) => void) => {
      const listener = (_e: unknown, payload: GitWatchEvent): void => cb(payload)
      ipcRenderer.on('git:changed', listener)
      return () => {
        ipcRenderer.removeListener('git:changed', listener)
      }
    }
  },
  /** Consumo: lo último que dijo cada proveedor sobre tus límites. */
  usage: {
    list: () => call<UsageSnapshot[]>('usage:list'),
    /** Uso de Claude Code: ventana de 5 h y semana, con lo de fuera de la app. */
    claude: () => call<ClaudeUsage>('claude:usage'),
    refreshClaude: () => call<{ imported: number }>('claude:refresh'),
    onClaudeUpdated: (cb: (p: { imported: number }) => void) => {
      const listener = (_e: unknown, payload: { imported: number }): void => cb(payload)
      ipcRenderer.on('claude:updated', listener)
      return () => {
        ipcRenderer.removeListener('claude:updated', listener)
      }
    },
    onUpdated: (cb: (all: UsageSnapshot[]) => void) => {
      const listener = (_e: unknown, payload: UsageSnapshot[]): void => cb(payload)
      ipcRenderer.on('usage:updated', listener)
      return () => {
        ipcRenderer.removeListener('usage:updated', listener)
      }
    }
  },
  files: {
    list: (root: string, rel = '') => call<DirEntry[]>('files:list', root, rel),
    read: (root: string, rel: string) => call<FileContent>('files:read', root, rel),
    write: (root: string, rel: string, text: string) => call<FileContent>('files:write', root, rel, text),
    create: (root: string, rel: string, dir: boolean) => call<DirEntry | null>('files:create', root, rel, dir),
    trash: (root: string, rel: string) => call<boolean>('files:trash', root, rel),
    reveal: (root: string, rel: string) => call<boolean>('files:reveal', root, rel)
  },
  github: {
    status: () => call<GhStatus>('github:status'),
    refresh: () => call<GhStatus>('github:refresh'),
    repos: (limit = 60, query?: string) => call<GhRepo[]>('github:repos', limit, query),
    clone: (repo: string, parentDir: string) =>
      call<{ ok: boolean; detail: string; path?: string }>('github:clone', repo, parentDir),
    loginCommand: () => call<string>('github:loginCommand'),
    logoutCommand: () => call<string>('github:logoutCommand')
  },
  attach: {
    pick: () => call<Attachment[]>('attach:pick'),
    describe: (path: string) => call<Attachment>('attach:describe', path)
  },
  /** Avisos de que algo cambió en el proceso principal: quien lo lea se relee. */
  live: {
    onChanged: (cb: (e: { topics: string[] }) => void) => {
      const listener = (_e: unknown, payload: { topics: string[] }): void => cb(payload)
      ipcRenderer.on('live:changed', listener)
      return () => {
        ipcRenderer.removeListener('live:changed', listener)
      }
    }
  },
  notify: {
    /** La Arena avisa como grupo cuando todas sus columnas han terminado. */
    arena: (runIds: string[]) => call<number>('notify:arena', runIds)
  },
  app: {
    info: () => call<any>('app:info'),
    openExternal: (url: string) => call<void>('app:openExternal', url),
    openDataDir: () => call<void>('app:openDataDir'),
    /** Qué está cerrado y qué no: lo enseña la pestaña de Seguridad. */
    security: () => call<SecurityReport>('app:security'),
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
      return call<boolean>('app:chrome', { ...opts, zoom })
    },
    onCatalogUpdated: (cb: (r: any) => void) => {
      const listener = (_e: unknown, payload: any): void => cb(payload)
      ipcRenderer.on('catalog:updated', listener)
      return () => {
        ipcRenderer.removeListener('catalog:updated', listener)
      }
    },
    /** Se dispara cuando un motor local aparece, desaparece o cambia modelos. */
    onLocalChanged: (cb: (servers: DetectedServer[]) => void) => {
      const listener = (_e: unknown, payload: DetectedServer[]): void => cb(payload)
      ipcRenderer.on('detect:localChanged', listener)
      return () => {
        ipcRenderer.removeListener('detect:localChanged', listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
