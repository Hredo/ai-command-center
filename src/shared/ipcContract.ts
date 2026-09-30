/**
 * El contrato de IPC: cada canal que la interfaz puede invocar en el proceso
 * principal, con sus argumentos y lo que devuelve.
 *
 * Es la única lista. Main registra sus handlers contra ella (`handle` en
 * ipc.ts no acepta un canal que no esté aquí ni una función que no encaje) y el
 * preload llama contra ella (`call` deduce el tipo de la respuesta). Antes cada
 * canal se escribía tres veces, a mano, y nada avisaba si una se desviaba.
 *
 * Canal nuevo: se añade aquí y los otros dos sitios dejan de compilar hasta que
 * se ponen de acuerdo.
 */
import type {
  Agent, AppConfig, Attachment, ClaudeUsage, CliAgent, CliEvent, CliRunOptions, DetectedCli, DetectedServer,
  DetectionResult, DirEntry, EloRow, FileChange, FileContent, GhRepo, GhStatus, GitGraph, GitInfo, GitOpName,
  GitOpParams, GitOpState, GitWatchEvent, HardwareInfo, InstructionFile, KeySource, McpClient, McpCopyPlan,
  McpReport, ModelInfo, ModelLinks, ModelRecommendation, ModelUsage, OllamaStatus, OpencodeModel, Project,
  ProjectInfo, ProviderDef, ProviderStatus, PullProgress, QuotaAlert, QuotaReport, RelayPackage, RelaySource,
  RunOptions, RunRecord, Settings, SkillsReport, StatsBucket, StoredSession, StreamDelta, TermEvent, TermInfo,
  UsageSnapshot, WorktreeInfo, WorktreeSetup
} from './types'

/** Estado del statusLine de la app en la configuración de Claude Code. */
export interface StatusLineInfo {
  installed: boolean
  chained: boolean
  foreign: boolean
  lastAt?: number
  shell: 'sh' | 'powershell'
  settingsPath: string
  untouched?: string
}

/** Lo que la aplicación puede decir sobre su propio aislamiento. */
export interface SecurityReport {
  contextIsolation: boolean
  nodeIntegration: boolean
  sandboxedRenderer: boolean
  startedWithoutSandbox: boolean
  csp: boolean
  navigationLocked: boolean
  permissionsDenied: boolean
  encryptionAvailable: boolean
  packaged: boolean
  dataDir: string
}

/** Lo que devuelve un comando de git lanzado desde la interfaz. */
export interface GitCmd {
  ok: boolean
  out: string
  err: string
  command: string
  refused?: string
}

export interface IpcContract {
  'agents:remove': { args: [id: string]; result: AppConfig }
  'agents:removeCli': { args: [id: string]; result: AppConfig }
  'agents:save': { args: [a: Agent]; result: AppConfig }
  'agents:saveCli': { args: [a: CliAgent]; result: AppConfig }
  'agents:workspace': { args: [id?: string]; result: string }
  'app:chrome': { args: [arg1: { zoom: number; background?: string; symbol?: string; }]; result: boolean }
  'app:info': { args: []; result: any }
  /** El error de abrirla, o vacío si se abrió. */
  'app:openDataDir': { args: []; result: string }
  'app:openExternal': { args: [url: string]; result: void }
  'app:security': { args: []; result: SecurityReport }
  'attach:describe': { args: [path: string]; result: Attachment }
  'attach:pick': { args: []; result: Attachment[] }
  'checkpoints:diff': { args: [root: string, id: string, untilId?: string]; result: { diff: string; until: 'next' | 'now'; truncated: boolean } | null }
  'checkpoints:preview': { args: [root: string, id: string]; result: { restore: string[]; remove: string[]; headMoved: boolean } | null }
  'checkpoints:undo': { args: [root: string, id: string]; result: { restore: string[]; remove: string[]; headMoved: boolean; safetyId?: string } }
  'claude:refresh': { args: []; result: { imported: number } }
  'claude:usage': { args: []; result: ClaudeUsage }
  'cli:kill': { args: [runId: string]; result: boolean }
  'cli:opencodeModels': { args: [force?: boolean]; result: OpencodeModel[] }
  'cli:run': { args: [opts: CliRunOptions, runId: string]; result: RunRecord }
  'config:get': { args: []; result: AppConfig }
  'config:save': { args: [cfg: AppConfig]; result: AppConfig }
  'config:settings': { args: [patch: Partial<Settings>]; result: AppConfig }
  'detect:all': { args: []; result: DetectionResult }
  'detect:clis': { args: []; result: DetectedCli[] }
  'detect:importClis': { args: []; result: { added: number; found: number } }
  'detect:knownClis': { args: []; result: any[] }
  'detect:local': { args: []; result: DetectedServer[] }
  'external:refresh': { args: []; result: { imported: number } }
  'files:create': { args: [root: string, rel: string, dir: boolean]; result: DirEntry | null }
  'files:list': { args: [root: string, rel?: string]; result: DirEntry[] }
  'files:read': { args: [root: string, rel: string]; result: FileContent }
  'files:reveal': { args: [root: string, rel: string]; result: boolean }
  'files:trash': { args: [root: string, rel: string]; result: boolean }
  'files:write': { args: [root: string, rel: string, text: string]; result: FileContent }
  'git:changes': { args: [path: string]; result: FileChange[] }
  'git:checkout': { args: [path: string, branch: string, create?: boolean]; result: { ok: boolean; detail: string; info?: GitInfo } }
  'git:commit': { args: [path: string, message: string, all?: boolean]; result: GitCmd }
  'git:diff': { args: [path: string, file?: string, staged?: boolean]; result: string }
  'git:graph': { args: [path: string, limit?: number, all?: boolean]; result: GitGraph }
  'git:info': { args: [path: string]; result: GitInfo }
  'git:isDestructive': { args: [command: string]; result: boolean }
  'git:log': { args: [path: string, limit?: number]; result: { hash: string; short: string; subject: string; author: string; at: number; refs?: string }[] }
  'git:op': { args: [path: string, op: GitOpName, params?: GitOpParams]; result: GitCmd }
  'git:poke': { args: [path: string]; result: boolean }
  'git:run': { args: [path: string, command: string]; result: GitCmd }
  'git:show': { args: [path: string, hash: string]; result: string }
  'git:stage': { args: [path: string, files: string[], stage: boolean]; result: GitCmd }
  'git:state': { args: [path: string]; result: GitOpState }
  'git:unwatch': { args: [path: string]; result: boolean }
  'git:watch': { args: [path: string]; result: boolean }
  'github:clone': { args: [repo: string, parentDir: string]; result: { ok: boolean; detail: string; path?: string } }
  'github:loginCommand': { args: []; result: string }
  'github:logoutCommand': { args: []; result: string }
  'github:refresh': { args: []; result: GhStatus }
  'github:repos': { args: [limit?: number, query?: string]; result: GhRepo[] }
  'github:status': { args: []; result: GhStatus }
  'instructions:read': { args: [root: string]; result: InstructionFile[] }
  'instructions:write': { args: [root: string, writes: { file: string; content: string; expectedMtime: number | null }[]]; result: InstructionFile[] }
  'mcp:app:add': { args: [input: { name: string; target: string; envVars?: string[] }]; result: boolean }
  'mcp:app:enable': { args: [name: string, enabled: boolean]; result: boolean }
  'mcp:app:remove': { args: [name: string]; result: boolean }
  'mcp:app:test': { args: [name: string]; result: { tools: { name: string; readOnly: boolean; description?: string }[] } }
  'mcp:copy': { args: [from: { client: McpClient; scope: 'personal' | 'project'; name: string }, to: { client: McpClient; scope: 'personal' | 'project' }, projectPath?: string]; result: McpCopyPlan }
  'mcp:list': { args: [projectPath?: string]; result: McpReport }
  'mcp:plan': { args: [from: { client: McpClient; scope: 'personal' | 'project'; name: string }, to: { client: McpClient; scope: 'personal' | 'project' }, projectPath?: string]; result: McpCopyPlan }
  'models:available': { args: []; result: any[] }
  'models:catalog': { args: [query: string, limit?: number]; result: ModelInfo[] }
  'models:catalogMeta': { args: []; result: { fetchedAt: number; count: number } }
  'models:favorite': { args: [key: string, on: boolean]; result: string[] }
  'models:fromProvider': { args: [id: string]; result: ModelInfo[] }
  'models:links': { args: [providerId: string, model: string]; result: ModelLinks }
  'models:price': { args: [providerId: string, model: string]; result: { in: number; out: number; source: string } }
  'models:refresh': { args: []; result: { count: number; sources: string[]; errors: string[] } }
  'notify:arena': { args: [runIds: string[]]; result: number }
  'ollama:best': { args: [n?: number]; result: { hw: HardwareInfo; items: ModelRecommendation[] } }
  'ollama:cancelPull': { args: [name: string]; result: boolean }
  'ollama:delete': { args: [name: string]; result: void }
  'ollama:hardware': { args: []; result: HardwareInfo }
  'ollama:pull': { args: [name: string]; result: { ok: boolean; cancelled: boolean } }
  'ollama:pulls': { args: []; result: string[] }
  'ollama:recommend': { args: []; result: { hw: HardwareInfo; installed: string[]; items: ModelRecommendation[] } }
  'ollama:start': { args: []; result: { started: boolean; detail: string } }
  'ollama:status': { args: []; result: OllamaStatus }
  'projects:context': { args: [path: string, opts?: any]; result: string }
  'projects:files': { args: [path: string, query?: string]; result: string[] }
  'projects:openEditor': { args: [path: string]; result: { ok: boolean; error?: string } }
  'projects:openFolder': { args: [path: string]; result: void }
  'projects:openTerminal': { args: [path: string]; result: { ok: boolean; error?: string } }
  'projects:pick': { args: []; result: string | null }
  'projects:remove': { args: [id: string]; result: AppConfig }
  'projects:save': { args: [p: Project]; result: AppConfig }
  'projects:scan': { args: [path: string]; result: ProjectInfo }
  'providers:defs': { args: []; result: ProviderDef[] }
  'providers:keyPreview': { args: [id: string]; result: string }
  'providers:keyStatus': { args: []; result: Record<string, string> }
  'providers:setBaseUrl': { args: [id: string, url: string]; result: AppConfig }
  'providers:setEnabled': { args: [id: string, enabled: boolean]; result: AppConfig }
  'providers:setKey': { args: [id: string, key: string]; result: { source: string; masked: string } }
  'providers:setPrice': { args: [id: string, model: string, pin: number, pout: number]; result: AppConfig }
  'providers:status': { args: [probe?: boolean]; result: ProviderStatus[] }
  'providers:test': { args: [id: string]; result: { ok: boolean; detail: string; ms: number } }
  'quotas:adminKeys': { args: []; result: Record<'anthropic' | 'openai', { source: KeySource; masked: string }> }
  'quotas:get': { args: [force?: boolean]; result: QuotaReport }
  'quotas:installStatusLine': { args: []; result: StatusLineInfo }
  'quotas:setAdminKey': { args: [which: 'anthropic' | 'openai', key: string]; result: { source: KeySource; masked: string } }
  'quotas:statusLine': { args: []; result: StatusLineInfo }
  'quotas:uninstallStatusLine': { args: []; result: StatusLineInfo }
  'recommend:classify': { args: [text: string, model: string]; result: { category: string; difficulty: number; needsTools: boolean; needsVision: boolean; ms: number } }
  'relay:build': { args: [src: RelaySource]; result: RelayPackage }
  'relay:prompt': { args: [pkg: RelayPackage, opts?: { includeDiff?: boolean; note?: string }]; result: string }
  'run:abort': { args: [runId: string]; result: boolean }
  'run:approve': { args: [runId: string, stepId: string, allow: boolean]; result: boolean }
  'run:prompt': { args: [opts: RunOptions, runId: string]; result: RunRecord }
  'runs:arena': { args: []; result: { arenaId: string; createdAt: number; prompt: string; runs: RunRecord[] }[] }
  'runs:buckets': { args: [field: string, days?: number]; result: StatsBucket[] }
  'runs:clear': { args: []; result: void }
  'runs:compact': { args: []; result: { compacted: number; archived: number; bytesBefore: number; bytesAfter: number } }
  'runs:compare': { args: [ids: string[]]; result: RunRecord[] }
  'runs:delete': { args: [id: string]; result: void }
  'runs:elo': { args: []; result: EloRow[] }
  'runs:export': { args: [format: 'json' | 'csv']; result: { path: string; rows: number } | null }
  'runs:modelUsage': { args: []; result: ModelUsage[] }
  'runs:overview': { args: [days?: number]; result: any }
  'runs:projectTotals': { args: [projectId: string]; result: { runs: number; cost: number; tokens: number; errors: number; lastAt?: number; byAgent: StatsBucket[] } }
  'runs:query': { args: [q?: any]; result: { rows: RunRecord[]; total: number; cost: number; tokens: number } }
  /** Null si esa ejecución ya no está en el histórico. */
  'runs:update': { args: [id: string, patch: Partial<RunRecord>]; result: RunRecord | null }
  'sessions:archive': { args: [id: string, archived: boolean]; result: StoredSession | null }
  'sessions:clear': { args: []; result: void }
  'sessions:clearArchived': { args: []; result: number }
  'sessions:get': { args: [id: string]; result: StoredSession | null }
  'sessions:list': { args: []; result: StoredSession[] }
  'sessions:patch': { args: [id: string, patch: Partial<StoredSession>]; result: StoredSession | null }
  'sessions:remove': { args: [id: string]; result: boolean }
  'sessions:save': { args: [s: StoredSession]; result: StoredSession }
  'skills:copy': { args: [source: string, target: { id: string; scope: 'personal' | 'project' }, projectPath?: string]; result: SkillsReport }
  'skills:list': { args: [projectPath?: string]; result: SkillsReport }
  'term:close': { args: [id: string]; result: boolean }
  'term:create': { args: [opts: {
      cwd?: string; shell?: string; projectId?: string; title?: string
      cols?: number; rows?: number; forcePipe?: boolean
    }]; result: TermInfo }
  'term:cwd': { args: [id: string]; result: string | null }
  'term:home': { args: []; result: string }
  'term:interrupt': { args: [id: string]; result: boolean }
  'term:list': { args: []; result: TermInfo[] }
  'term:pty': { args: []; result: { available: boolean; engine?: 'native' | 'bridge' | 'pipe'; reason?: string } }
  'term:resize': { args: [id: string, cols: number, rows: number]; result: boolean }
  'term:run': { args: [id: string, command: string]; result: boolean }
  'term:shells': { args: []; result: {
        shells: { path: string; label: string }[]
        current: string
        pty: { available: boolean; reason?: string }
      } }
  'term:write': { args: [id: string, data: string]; result: boolean }
  'usage:list': { args: []; result: UsageSnapshot[] }
  'worktrees:create': { args: [cwd: string, opts: { label: string; projectId?: string; base?: string; sessionId?: string }]; result: WorktreeInfo }
  'worktrees:exec': { args: [path: string, command: string]; result: WorktreeSetup }
  'worktrees:link': { args: [path: string, sessionId?: string]; result: boolean }
  'worktrees:list': { args: [cwd: string]; result: WorktreeInfo[] }
  'worktrees:merge': { args: [path: string, opts?: { message?: string }]; result: { ok: boolean; committed: boolean; output: string; conflicts?: string[] } }
  'worktrees:remove': { args: [path: string, opts?: { force?: boolean; deleteBranch?: boolean }]; result: boolean }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Respuesta uniforme de todos los handlers: nunca lanza, siempre informa. */
export interface IpcRes<T> {
  ok: boolean
  data?: T
  error?: string
}

/**
 * Lo que main avisa a la ventana sin que se lo pida: canal y lo que lleva.
 * Main lo manda con `emit` (main/emit.ts) y el preload lo escucha con `on`.
 */
export interface IpcEvents {
  'run:delta': StreamDelta
  'cli:event': CliEvent
  'term:event': TermEvent
  'ollama:pullProgress': PullProgress
  'git:changed': GitWatchEvent
  'claude:updated': { imported: number }
  'usage:updated': UsageSnapshot[]
  'external:updated': { imported: number }
  'quotas:updated': QuotaReport
  'quotas:alert': QuotaAlert
  'live:changed': { topics: string[] }
  'catalog:updated': { count: number; sources: string[]; errors: string[] }
  'detect:localChanged': DetectedServer[]
}

export type IpcEvent = keyof IpcEvents
