/* Tipos compartidos entre main, preload y renderer. */

export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'ollama'

/** Definición estática de un proveedor del catálogo. */
export interface ProviderDef {
  id: string
  name: string
  kind: ProviderKind
  /** Base URL por defecto (sin barra final). */
  baseUrl: string
  /** Ruta relativa para listar modelos, si el proveedor la expone. */
  modelsPath?: string
  /** Nombres de variables de entorno donde suele vivir la API key. */
  envKeys: string[]
  /** true si corre en la máquina del usuario (sin coste y sin key). */
  local: boolean
  /** Puerto por defecto cuando es local, para autodetección. */
  port?: number
  docsUrl?: string
  /** Prefijos de id de modelo que este proveedor sirve (para el catálogo global). */
  slugs?: string[]
  notes?: string
}

export type KeySource = 'stored' | 'env' | 'none'

/** Estado en vivo de un proveedor: configurado + detectado. */
export interface ProviderStatus {
  id: string
  name: string
  kind: ProviderKind
  local: boolean
  baseUrl: string
  enabled: boolean
  keySource: KeySource
  /** Variable de entorno concreta donde se encontró la key, si aplica. */
  envVar?: string
  /** Resultado del último sondeo: local vivo / key válida. */
  reachable: boolean | null
  detail?: string
  modelCount?: number
  checkedAt?: number
}

export interface ModelInfo {
  id: string
  providerId: string
  name: string
  /** Ventana de contexto en tokens. */
  contextLength?: number
  maxOutput?: number
  /** USD por 1M tokens. */
  priceIn?: number
  priceOut?: number
  priceCacheRead?: number
  priceCacheWrite?: number
  modalities?: string[]
  /** De dónde salió la ficha: api del proveedor, catálogo remoto o local. */
  source: 'provider' | 'catalog' | 'local' | 'manual'
  local?: boolean
  sizeBytes?: number
  updatedAt?: number
  description?: string
  /** Qué sabe hacer, según el catálogo (models.dev u OpenRouter). */
  caps?: ModelCaps
  /** Hasta cuándo llega lo que sabe: «2025-03». */
  knowledge?: string
  releaseDate?: string
  /** Puntuaciones públicas, cuando las hay. */
  bench?: ModelBench
}

export interface ModelCaps {
  reasoning?: boolean
  tools?: boolean
  structured?: boolean
  openWeights?: boolean
  /** Acepta ficheros adjuntos. */
  attachments?: boolean
}

/**
 * Puntuaciones públicas de un modelo, tal como las publica OpenRouter:
 * los índices de Artificial Analysis (0–100, más es mejor) y el Elo de
 * Design Arena por categoría. No son de la app: se dice de dónde salen.
 */
export interface ModelBench {
  intelligence?: number
  coding?: number
  agentic?: number
  design?: { arena: string; category: string; elo: number; rank?: number }[]
}

/**
 * Lo que tú has medido de un modelo con tu uso: velocidad, latencia, coste y,
 * si ha competido en la Arena, su Elo personal.
 */
export interface ModelUsage extends StatsBucket {
  providerId: string
  model: string
  /** Última vez que se usó. */
  lastAt: number
  elo?: number
  games?: number
  wins?: number
}

/** Una fila de la clasificación personal que sale de los ganadores de la Arena. */
export interface EloRow {
  key: string
  providerId: string
  model: string
  label: string
  elo: number
  games: number
  wins: number
}

/** Preset de agente que trabaja por API. */
export interface Agent {
  id: string
  name: string
  type: 'api'
  providerId: string
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  color: string
  icon?: string
  createdAt: number
  /** Cuánto piensa por omisión. */
  effort?: Effort
  /** Qué puede hacer sin preguntar. Ver API_PERMISSION_MODES. */
  permissionMode?: string
}

/**
 * Cómo se lee la salida de un agente de línea de comandos. Los que hablan en
 * JSON dan pasos, tokens y el id de su sesión; `plain` es sólo texto.
 */
export type CliParser = 'claude-stream-json' | 'opencode-json' | 'codex-json' | 'gemini-stream-json' | 'plain'

/** Definición de un agente de línea de comandos (claude, codex, aider...). */
export interface CliAgent {
  id: string
  name: string
  type: 'cli'
  /** Ejecutable, tal cual se invoca en la shell. */
  command: string
  /** Plantilla de argumentos. {{prompt}} se sustituye por el prompt. */
  args: string[]
  /** Formato de salida para extraer métricas. */
  parser: CliParser
  color: string
  detected?: boolean
  path?: string
  createdAt: number
  env?: Record<string, string>
  /** Modelo por defecto para este agente, si su CLI admite elegirlo. */
  model?: string
  /** Modo de permisos por defecto, si su CLI lo admite. */
  permissionMode?: string
}

export interface Project {
  id: string
  name: string
  path: string
  /** Agente por defecto (id de Agent o CliAgent). */
  defaultAgentId?: string
  systemPrompt?: string
  color: string
  createdAt: number
  lastOpenedAt?: number
  pinned?: boolean
  tags?: string[]
  /** Cerrado: sigue dado de alta pero fuera de la lista principal. */
  closed?: boolean
  /** Qué ejecutar en cada worktree nuevo para dejarlo listo: «pnpm install». */
  worktreeSetup?: string
  /** Ficheros sin seguir que se copian a cada worktree nuevo: «.env». */
  worktreeCopy?: string[]
  /** Orden que pasa las pruebas del proyecto (p. ej. pnpm test): la usa la Arena de código. */
  testCommand?: string
  /** Ficheros de instrucciones que se guardan como copia de AGENTS.md (CLAUDE.md, GEMINI.md). */
  instructionsMirror?: string[]
}

/** Cómo fue la preparación de un worktree nuevo. */
export interface WorktreeSetup {
  command: string
  ok: boolean
  at: number
  ms: number
  /** El final de lo que escribió. */
  output: string
}

/** Un worktree del repositorio, con lo que la app sabe de él. */
/* ------------------------------------------------------------------ *
 * MCP                                                                *
 * ------------------------------------------------------------------ */

/**
 * Un servidor MCP en un formato común a todos los CLIs. Las referencias a
 * variables de entorno van como `${VAR}`: al escribir se traducen a la
 * sintaxis de cada uno.
 */
export interface McpSpec {
  transport: 'stdio' | 'http' | 'sse' | 'ws'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

/** Quién usa servidores MCP: los CLIs y los agentes por API de esta app. */
export type McpClient = 'claude' | 'codex' | 'opencode' | 'gemini' | 'copilot' | 'app'

/** Un valor de env o de cabecera tal como se enseña: nunca el secreto. */
export interface McpValue {
  key: string
  /** Variable de entorno de la que sale. */
  ref?: string
  /** Es un secreto escrito tal cual: no se enseña ni se copia. */
  secret?: boolean
  /** El valor, sólo si no es un secreto ni una referencia. */
  value?: string
}

/** Cómo está definido un servidor en un sitio concreto. */
export interface McpDefinition {
  client: McpClient
  scope: 'personal' | 'project'
  file: string
  enabled: boolean
  transport: McpSpec['transport']
  /** La orden o la URL, con los secretos tapados. */
  summary: string
  env: McpValue[]
  headers: McpValue[]
  /** Para ver si dos definiciones son la misma. */
  hash: string
  /** Lleva un secreto escrito en los argumentos o en la URL: así no se copia. */
  secretInline?: boolean
}

export interface McpServerRow {
  name: string
  scope: 'personal' | 'project'
  definitions: McpDefinition[]
  /** Las definiciones no son todas iguales. */
  differs: boolean
}

export interface McpClientFile {
  client: McpClient
  scope: 'personal' | 'project'
  file: string
  exists: boolean
  /** No se pudo leer (JSON o TOML roto): no se escribe en él. */
  error?: string
}

export interface McpReport {
  files: McpClientFile[]
  servers: McpServerRow[]
}

/** Lo que haría copiar un servidor a otro sitio, antes de hacerlo. */
export interface McpCopyPlan {
  client: McpClient
  scope: 'personal' | 'project'
  file: string
  /** El fragmento que se añade, en el formato de destino. */
  snippet: string
  /** Variables de entorno que hay que tener definidas para que funcione. */
  needsEnv: string[]
  warnings: string[]
  /** Si no se puede copiar, por qué. */
  error?: string
  /** Dónde queda la copia de seguridad del fichero de destino. */
  backup?: string
}

/** Un servidor MCP de los agentes por API de esta app. */
export interface AppMcpServer extends McpSpec {
  enabled: boolean
  addedAt: number
}

/* ------------------------------------------------------------------ *
 * Baterías de prompts                                                *
 * ------------------------------------------------------------------ */

/**
 * Qué se comprueba de una respuesta: que contenga (o no) un texto, que case
 * con una expresión regular, que sea JSON, que pasen las pruebas del repo (en
 * la Arena de código) o que un juez local le dé al menos una nota.
 */
export type BatteryCheckKind = 'contains' | 'not_contains' | 'regex' | 'json' | 'tests' | 'judge'

export interface BatteryCheck {
  id: string
  kind: BatteryCheckKind
  /** El texto, la expresión regular o, para el juez, la rúbrica. */
  value?: string
  /** Juez: nota mínima para aprobar, de 1 a 10. */
  min?: number
}

export interface BatteryCase {
  id: string
  prompt: string
  checks: BatteryCheck[]
}

/* ------------------------------------------------------------------ *
 * Pull requests y CI (por gh)                                        *
 * ------------------------------------------------------------------ */

export interface PullSummary {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  draft: boolean
  head: string
  base: string
  author?: string
  updatedAt?: number
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED… */
  review?: string
  /** Cómo va su CI: cuántas comprobaciones pasan, fallan o siguen en marcha. */
  checks: { pass: number; fail: number; pending: number; total: number }
}

export interface PullCheck {
  name: string
  state: 'pass' | 'fail' | 'pending' | 'skipped' | 'cancel'
  url?: string
  workflow?: string
}

export interface WorkflowRun {
  id: number
  title: string
  workflow: string
  /** queued, in_progress, completed… */
  status: string
  /** success, failure, cancelled… al terminar. */
  conclusion?: string
  branch?: string
  event?: string
  createdAt: number
  url: string
}

export interface PullsReport {
  /** `missing`: gh no está; `noauth`: sin sesión; `ok`: se puede hablar con GitHub. */
  gh: 'missing' | 'noauth' | 'ok'
  /** El repositorio tiene un remoto de GitHub. */
  github: boolean
  branch?: string
  /** La rama principal, hacia la que se abren las PR por omisión. */
  base?: string
  /** La PR de la rama en la que estás, si la hay. */
  current?: PullSummary | null
  open: PullSummary[]
  /** Últimas ejecuciones de Actions de esta rama. */
  runs: WorkflowRun[]
  /** La rama no está subida o tiene commits sin subir. */
  needsPush?: boolean
  upstream?: boolean
  error?: string
}

/** Búsqueda de texto completo en conversaciones e histórico. */
export interface SearchQuery {
  text: string
  /** Dónde: todo, sólo las conversaciones o sólo el histórico. */
  scope?: 'all' | 'sessions' | 'runs'
  projectId?: string
  /** Desde cuándo (ms). */
  from?: number
  /** false deja fuera las conversaciones cerradas. */
  archived?: boolean
  limit?: number
}

export interface SearchHit {
  /** Un mensaje de una conversación o una ejecución del histórico. */
  kind: 'turn' | 'run'
  id: string
  sessionId?: string
  turnId?: string
  runId?: string
  /** Título de la conversación, o el agente o el modelo de la ejecución. */
  title: string
  role?: 'user' | 'assistant'
  /** En qué parte de la ejecución está. */
  field?: 'prompt' | 'response'
  /** El trozo alrededor del acierto y dónde está cada palabra dentro. */
  snippet: string
  ranges: [number, number][]
  at: number
  projectId?: string
  projectName?: string
  model?: string
  sessionKind?: 'chat' | 'cli'
  runKind?: string
  archived?: boolean
  score: number
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  tookMs: number
  truncated: boolean
}

/**
 * Un prompt de la biblioteca. `{{nombre}}` o `{{nombre:valor por omisión}}`
 * son variables que se piden al insertarlo; `{{proyecto}}`, `{{rama}}` y
 * `{{fecha}}` se rellenan solas.
 */
export interface PromptTemplate {
  id: string
  name: string
  text: string
  description?: string
  createdAt: number
  updatedAt?: number
  /** Veces que se ha insertado. */
  uses?: number
  lastUsedAt?: number
}

export interface Battery {
  id: string
  name: string
  cases: BatteryCase[]
  createdAt: number
  /** Modelo de Ollama que hace de juez, si alguna comprobación lo usa. */
  judgeModel?: string
}

export interface BatteryCheckResult {
  checkId: string
  kind: BatteryCheckKind
  pass: boolean
  /** Por qué falló, o lo que dijo el juez. */
  detail?: string
  /** La nota del juez (su opinión, no un hecho). */
  score?: number
}

export interface BatteryCell {
  caseId: string
  contender: string
  runId?: string
  ok: boolean
  checks: BatteryCheckResult[]
  cost: number
  ms: number
  error?: string
}

export interface BatteryRun {
  id: string
  batteryId: string
  batteryName: string
  at: number
  contenders: { key: string; label: string }[]
  cells: BatteryCell[]
  judgeModel?: string
  /** Se paró antes de acabar todos los casos. */
  stopped?: boolean
}

/** Claude Code, en una terminal, espera tu respuesta (su hook Notification). */
export interface TerminalAttention {
  /** La sesión de Claude Code: un aviso por sesión. */
  id: string
  sessionId?: string
  cwd?: string
  /** El nombre de la carpeta, para enseñarlo. */
  project?: string
  message: string
  /** permission_prompt, idle_prompt… tal cual lo manda Claude Code. */
  type?: string
  transcriptPath?: string
  at: number
  /** Hasta dónde había escrito Claude al avisar: si sigue, es que contestaste. */
  seenMtime?: number
}

/** Estado del hook de avisos de la app en Claude Code. */
export interface NotifyHookInfo {
  installed: boolean
  settingsPath: string
  shell: 'sh' | 'powershell'
  lastAt?: number
}

/** Un fichero de instrucciones para agentes (AGENTS.md, CLAUDE.md, GEMINI.md). */
export interface InstructionFile {
  file: string
  exists: boolean
  content: string
  /** Para no pisar lo que haya cambiado otro desde que se leyó. */
  mtimeMs: number | null
  bytes: number
}

/** Los CLIs que cargan Skills (SKILL.md) y en qué carpetas las buscan. */
export type SkillTool = 'claude' | 'codex' | 'opencode' | 'gemini' | 'copilot'

/** Una carpeta de Skills: de quién es y quién la lee. */
export interface SkillLocation {
  /** claude, agents, opencode, gemini, copilot, github, claude-synced */
  id: string
  scope: 'personal' | 'project'
  path: string
  readers: SkillTool[]
  exists: boolean
  /** Sólo se lee de ella (las que baja claude.ai): no se copia nada ahí. */
  readOnly?: boolean
}

/** Una Skill, con todas las carpetas donde está. */
export interface SkillInfo {
  /** Nombre de su carpeta: el que cuenta para copiarla. */
  dir: string
  scope: 'personal' | 'project'
  /** El `name` y la `description` de su SKILL.md. */
  name?: string
  description?: string
  copies: { location: string; path: string; hash: string }[]
  /** Qué CLIs la cargan, por alguna de sus copias. */
  readers: SkillTool[]
  /** Hay copias que ya no son iguales. */
  differs: boolean
  warnings: string[]
  /** CLIs que la ven en su carpeta pero no la cargan por cómo está escrita. */
  rejectedBy: SkillTool[]
}

export interface SkillsReport {
  locations: SkillLocation[]
  skills: SkillInfo[]
}

export interface WorktreeInfo {
  path: string
  branch?: string
  head?: string
  /** La carpeta principal del repositorio. */
  main: boolean
  locked?: boolean
  prunable?: boolean
  /** Para qué se creó. */
  label?: string
  projectId?: string
  /** De qué rama salió. */
  base?: string
  createdAt?: number
  /** Conversación que trabaja en él. */
  sessionId?: string
  setup?: WorktreeSetup
  /** Ficheros sin confirmar. */
  dirty?: number
  /** Commits que lleva por delante de la rama de la que salió. */
  ahead?: number
}

/** Información escaneada de un proyecto en disco. */
export interface ProjectInfo {
  path: string
  exists: boolean
  gitBranch?: string
  gitDirty?: number
  languages: string[]
  packageManager?: string
  /** Dependencias relacionadas con IA encontradas. */
  aiDeps: string[]
  /** Nombres de claves detectadas en .env (nunca el valor). */
  envKeyNames: string[]
  fileCount?: number
  sizeBytes?: number
  readme?: string
  scripts?: Record<string, string>
}

/** Los scripts del package.json de cada proyecto, por su carpeta. */
export type ProjectScripts = Record<string, { packageManager: string; scripts: Record<string, string> }>

export type RunStatus = 'ok' | 'error' | 'aborted' | 'running'

/** Una ejecución: la unidad de análisis de toda la app. */
export interface RunRecord {
  id: string
  createdAt: number
  /** `git`: lo que la app le pide a un modelo para git (el mensaje de un commit…). */
  kind: 'chat' | 'arena' | 'cli' | 'git'
  providerId: string
  model: string
  agentId?: string
  agentName?: string
  projectId?: string
  projectName?: string
  /** Agrupa las ejecuciones de una misma comparativa. */
  arenaId?: string
  conversationId?: string

  prompt: string
  systemPrompt?: string
  response: string

  status: RunStatus
  error?: string
  finishReason?: string

  // Métricas
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens?: number
  reasoningTokens?: number
  /** Time to first token, ms. */
  ttftMs?: number
  totalMs: number
  /** Tokens de salida por segundo durante la generación. */
  tokensPerSec?: number

  // Coste en USD
  costIn: number
  costOut: number
  costTotal: number
  /** true si el coste se estimó con precios del catálogo y no lo dio la API. */
  costEstimated: boolean

  temperature?: number
  maxTokens?: number

  /** Voto manual en comparativas. */
  rating?: number
  winner?: boolean
  notes?: string

  effort?: Effort
  /** Rama en la que se ejecutó. */
  branch?: string
  filesChanged?: FileChange[]
  filesTouched?: FileTouch[]
  usageLimit?: UsageLimit
  contextLimit?: number
  /** Contexto ocupado según el agente, si lo informa. */
  contextUsed?: number
  attachmentCount?: number
  /** Lo que hizo el agente, paso a paso. */
  steps?: AgentStep[]
  /** Ventana de uso del plan que anunció el agente durante la ejecución. */
  cliLimit?: CliLimit
  /** Id de la sesión del CLI, para casar con su transcripción en disco. */
  cliSessionId?: string
  /** Sesión del agente que retomó, si continuaba una anterior. */
  resumedFrom?: string
  /** Retomó en una sesión nueva (bifurcación). */
  forked?: boolean
  /** La última lista de tareas que llevaba el agente. */
  todos?: AgentTodo[]
  /** Qué podía hacer sin preguntar. */
  permissionMode?: string
  /** De dónde salió: de la app o de una sesión suelta en la terminal. */
  source?: 'app' | 'terminal'
  /** Ya pasó por la poda: le falta el detalle, pero no las métricas. */
  compacted?: boolean
  /** Foto del árbol de trabajo antes del turno, para poder deshacerlo. */
  checkpoint?: RunCheckpoint
}

/** Dónde está la foto de antes de un turno: el repositorio y el commit suelto. */
export interface RunCheckpoint {
  root: string
  commit: string
}

export interface StreamDelta {
  runId: string
  type: 'start' | 'text' | 'reasoning' | 'usage' | 'done' | 'error' | 'limit' | 'step' | 'files'
  text?: string
  run?: RunRecord
  error?: string
  ttftMs?: number
  /** Lo que dicen las cabeceras del proveedor sobre tus límites. */
  usageLimit?: UsageLimit
  contextLimit?: number
  /** Modo agente: lo que ocupa la conversación tras la última vuelta. */
  contextUsed?: number
  /** Modo agente: un paso nuevo, o uno que ya estaba y ahora trae más datos. */
  step?: AgentStep
  /** Modo agente: archivos cambiados en disco (medido con git). */
  files?: FileChange[]
  /** Modo agente: archivos que dice haber leído o editado. */
  touched?: FileTouch[]
}

/** Cada cuánto se repite una tarea programada. */
export type ScheduleRepeat = 'daily' | 'weekdays' | 'weekly' | 'hourly'

/**
 * Una tarea que se lanza sola a su hora, como las del tablero de Tareas: un
 * agente sobre un proyecto, normalmente en un worktree aparte, y queda para
 * revisar. Sólo corre con la app abierta (vale en la bandeja).
 */
export interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  projectId: string
  /** 'cli:<id>', 'api:<id>' o 'model' (un modelo por API como agente, el de `pick`). */
  agent: string
  pick?: { providerId: string; model: string }
  permissionMode?: string
  /** En un worktree aparte: tu carpeta no se toca. */
  worktree: boolean
  prompt: string
  repeat: ScheduleRepeat
  /** Hora local HH:MM (diaria, laborables y semanal). */
  time?: string
  /** Día de la semana, 0 domingo … 6 sábado (semanal). */
  weekday?: number
  /** Cada cuántas horas (repetición por horas). */
  everyHours?: number
  /** Si la app estaba cerrada a su hora, lanzarla al abrir (por omisión, sí). */
  catchUp?: boolean
  createdAt: number
  lastRunAt?: number
  lastStatus?: 'running' | 'ok' | 'error' | 'missed'
  lastError?: string
  /** La conversación de la última vez, para revisarla. */
  lastSessionId?: string
}

/** Abrir la app al iniciar sesión (en la bandeja). */
export interface LoginItemStatus {
  /** Sólo en la app instalada. */
  supported: boolean
  enabled: boolean
  /** dev: en desarrollo no se registra nada. */
  reason?: 'dev'
}

/** Una tarea programada con su próxima hora ya calculada. */
export type ScheduledTaskView = ScheduledTask & { nextRunAt: number | null; running: boolean }

/** Main pide a la ventana que lance una tarea programada. */
export interface ScheduleRun {
  runId: string
  reason: 'time' | 'catchup' | 'manual'
  task: ScheduledTask
}

/** Un fichero de una versión publicada, para este sistema. */
export interface UpdateDownload {
  name: string
  url: string
  size: number
  kind: 'installer' | 'portable' | 'dmg' | 'appimage' | 'deb' | 'checksums'
}

/** Lo último que se sabe de las versiones publicadas en GitHub. */
export interface UpdateInfo {
  current: string
  latest?: string
  /** La publicada es más nueva que la instalada. */
  newer: boolean
  /** Es más nueva, pero pediste no volver a anunciarla. */
  skipped?: boolean
  /** Página de la versión en GitHub. */
  url?: string
  publishedAt?: string
  /** Notas de la versión (markdown). */
  notes?: string
  downloads: UpdateDownload[]
  checkedAt: number
  error?: string
}

/** Un prompt lanzado desde la ventana del prompt rápido, camino de la Consola. */
export interface QuickRun {
  requestId: string
  prompt: string
  providerId: string
  model: string
  /** Para seguir la misma conversación con otra pregunta. */
  sessionId?: string
}

/** Lo que le llega a la ventana del prompt rápido mientras contesta. */
export interface QuickEvent {
  requestId: string
  sessionId?: string
  /** Un trozo de la respuesta, tal cual lo manda el proveedor. */
  delta?: StreamDelta
  /** Terminó: con la respuesta entera y sus números. */
  done?: boolean
  response?: string
  error?: string
  model?: string
  costTotal?: number
  totalMs?: number
}

/** El atajo global: cuál es, si se pudo registrar y por qué no. */
export interface QuickHotkeyStatus {
  accelerator: string
  /** El que se usa si no eliges otro. */
  defaultAccelerator: string
  registered: boolean
  /** taken: otra app ya lo tiene; invalid: no es un atajo válido. */
  error?: 'taken' | 'invalid'
  /**
   * Linux: la orden que abre el prompt rápido, para asignarla en los atajos del
   * escritorio cuando el atajo global no llega (Wayland).
   */
  command?: string
}

/** Idioma de la interfaz. */
export type Language = 'es' | 'en'

/** Identificador de un tema visual. Los presets viven en el renderer. */
export type ThemeId = string

/** Densidad de la interfaz: cuánto respira cada control. */
export type Density = 'compact' | 'cozy' | 'comfortable'

/** Redondeo global de esquinas. */
export type Corners = 'sharp' | 'soft' | 'round'

/** Apariencia de la aplicación. Todo esto se traduce a variables CSS. */
export interface Appearance {
  /** Preset de color. Ver THEMES en el renderer. */
  theme: ThemeId
  /** Color de acento; vacío usa el del tema. */
  accent?: string
  /** Tipografía de la interfaz (no del código). */
  uiFont: string
  /** Tamaño base del texto de la interfaz, en px. */
  uiFontSize: number
  /**
   * Escala de toda la ventana, en tanto por ciento. Es el zoom del motor web,
   * el mismo que el nivel de zoom de VS Code: agranda hasta los bordes.
   */
  uiScale: number
  density: Density
  corners: Corners
  /** Animaciones y transiciones. Apagarlas ahorra pintados. */
  animations: boolean
  /** Rejilla de fondo del área de trabajo. */
  backgroundGrid: boolean
  /** Barras de desplazamiento finas al estilo del editor. */
  slimScrollbars: boolean
  /** Opacidad del fondo de los paneles, 0.6–1. */
  panelOpacity: number
}

export type WordWrap = 'off' | 'on' | 'bounded'
export type LineNumbers = 'off' | 'on' | 'relative'
export type CursorStyle = 'line' | 'block' | 'underline'

/** Preferencias del editor de código, calcadas de las de VS Code. */
export interface EditorPrefs {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  /** Ligaduras tipográficas (fi, =>, !==) si la fuente las trae. */
  ligatures: boolean
  tabSize: number
  /** Insertar espacios al tabular en vez de un tabulador real. */
  insertSpaces: boolean
  wordWrap: WordWrap
  /** Columna donde corta `wordWrap: 'bounded'`. */
  wrapColumn: number
  lineNumbers: LineNumbers
  /** Guías verticales de sangría. */
  indentGuides: boolean
  /** Resaltar la línea donde está el cursor. */
  highlightActiveLine: boolean
  /** Puntos y flechas en espacios y tabuladores. */
  renderWhitespace: boolean
  /** Colorear parejas de paréntesis, llaves y corchetes por profundidad. */
  bracketPairColorization: boolean
  minimap: boolean
  /** Regla vertical en la columna indicada. 0 la quita. */
  rulerColumn: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  /** Cerrar automáticamente comillas, paréntesis y llaves. */
  autoClosingBrackets: boolean
  /** Mantener la sangría de la línea anterior al pulsar Intro. */
  autoIndent: boolean
  /** Espacio extra bajo la última línea, para poder centrarla. */
  scrollBeyondLastLine: boolean
  /** Tema de sintaxis; vacío usa el del tema de la aplicación. */
  syntaxTheme?: ThemeId
}

/** Tamaños de los paneles redimensionables, por clave. */
export type PaneSizes = Record<string, number>

export interface Settings {
  theme: 'dark' | 'light'
  /** Idioma de toda la interfaz. */
  language: Language
  appearance: Appearance
  editor: EditorPrefs
  /** Anchos y altos que el usuario ha arrastrado. */
  panes: PaneSizes
  defaultProviderId?: string
  defaultModel?: string
  editorCommand: string
  terminalCommand: string
  /** Refrescar catálogo remoto de modelos al arrancar. */
  autoRefreshCatalog: boolean
  catalogRefreshedAt?: number
  currency: 'USD' | 'EUR'
  eurRate: number
  /** Presupuesto mensual en USD para el panel de gasto. */
  monthlyBudget?: number
  arenaDefaults: string[]
  /**
   * Modelo de Ollama que clasifica la tarea en el recomendador. Vacío: el más
   * pequeño que tengas; 'rules': sólo reglas, sin modelo.
   */
  recommendClassifier?: string
  /** Avisar con una notificación del sistema al terminar una tarea. */
  notifyOnFinish: boolean
  /** Sólo notificar si la ventana no está en primer plano. */
  notifyOnlyWhenUnfocused: boolean
  /**
   * Al cerrar la ventana se esconde en la bandeja y lo que está en marcha
   * sigue (por omisión). Con false, cerrar sale, preguntando si hay algo en marcha.
   */
  closeToTray?: boolean
  /** Ya se avisó una vez de que la app sigue en la bandeja. */
  trayHintShown?: boolean
  /** La mesa de trabajo: qué secciones están a la vista y cómo se reparten. Ver shared/workspace.ts. */
  workspace?: import('./workspace').Workspace
  /** Distribuciones de la mesa guardadas con nombre. */
  layouts?: import('./workspace').SavedLayout[]
  /** El menú lateral a tu gusto: el orden de las secciones y las que no quieres ver. */
  nav?: { order?: string[]; hidden?: string[] }
  /** Ya se hizo (o se saltó) el recorrido de bienvenida. */
  tourDone?: boolean
  /**
   * Atajo global del prompt rápido, en formato de Electron
   * («Control+Alt+Space»). Sin definir: el de cada sistema; vacío: apagado.
   */
  quickHotkey?: string
  /** El modelo que usó el prompt rápido la última vez. */
  quickModel?: { providerId: string; model: string } | null
  /** Mirar en GitHub si hay versión nueva (por omisión, sí). */
  checkUpdates?: boolean
  /** Versión que pediste no volver a anunciar. */
  skippedVersion?: string
  /** Ejecutable de la shell para las terminales integradas. */
  shellPath?: string
  /** Segundos entre sondeos automáticos de motores locales. 0 lo desactiva. */
  localPollSeconds: number
  /**
   * Días que una ejecución conserva todo su detalle (pasos, respuesta
   * entera). Después se compacta y se queda con las métricas. 0: nunca.
   */
  historyDetailDays?: number
  /** Qué fuentes de cupo se consultan y cuándo avisar. */
  quotas?: QuotaSettings
  /** Presupuestos de gasto. Sustituyen al antiguo `monthlyBudget`, que se migra. */
  budgets?: Budget[]
  /** Guardar una foto del repositorio antes de cada turno de un agente. Sí por omisión. */
  checkpoints?: boolean
  /** Modelo que escribe mensajes de commit y descripciones de PR: mejor uno barato o local. */
  gitModel?: { providerId: string; model: string }
}

export interface AppConfig {
  settings: Settings
  providers: Record<string, ProviderOverride>
  agents: Agent[]
  cliAgents: CliAgent[]
  projects: Project[]
  favorites: string[]
  customModels: ModelInfo[]
  /** Servidores MCP que pueden usar los agentes por API (sin secretos: sólo `${VAR}`). */
  mcpServers?: Record<string, AppMcpServer>
  /** Baterías de prompts con sus comprobaciones, para relanzarlas en la Arena. */
  batteries?: Battery[]
  /** Biblioteca de prompts: se insertan con «/» en la Consola, la Arena y las baterías. */
  prompts?: PromptTemplate[]
  /** Tareas que se lanzan solas a su hora (Tareas › Programadas). */
  schedules?: ScheduledTask[]
}

export interface ProviderOverride {
  enabled?: boolean
  baseUrl?: string
  /** Precios manuales por modelo: modelId -> [in, out] USD/1M. */
  pricing?: Record<string, [number, number]>
}

/* ------------------------------------------------------------------ *
 * Git, esfuerzo, adjuntos y límites                                  *
 * ------------------------------------------------------------------ */

/** Estado del repositorio de un proyecto. */
export interface GitInfo {
  repo: boolean
  branch?: string
  /** HEAD suelto: no hay rama, sólo un commit. */
  detached?: boolean
  head?: string
  ahead?: number
  behind?: number
  upstream?: string
  dirty: number
  staged: number
  untracked: number
  localBranches: string[]
  remoteBranches: string[]
  lastCommit?: { hash: string; subject: string; author: string; at: number }
}

/* ------------------------------------------------------------------ *
 * Árbol de commits                                                   *
 * ------------------------------------------------------------------ */

/** Una etiqueta colgada de un commit: rama, remota, tag o el propio HEAD. */
export interface GraphRef {
  name: string
  kind: 'head' | 'local' | 'remote' | 'tag'
}

/** Un commit con sus padres: con eso se dibujan los carriles. */
export interface GraphCommit {
  hash: string
  short: string
  parents: string[]
  subject: string
  author: string
  email?: string
  at: number
  refs: GraphRef[]
}

export interface GitGraph {
  commits: GraphCommit[]
  /** Hash completo de HEAD. */
  head?: string
  /** Rama actual, salvo que el HEAD esté suelto. */
  branch?: string
  /** Había más commits de los que se pidieron. */
  truncated: boolean
}

/** Merge, rebase o cherry-pick a medias, con sus conflictos. */
export interface GitOpState {
  operation: 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'
  detail?: string
  conflicts: string[]
  stashes: number
  /** En un rebase: por qué commit va y cuántos son. */
  step?: number
  total?: number
}

export type GitOpName =
  | 'merge' | 'rebase' | 'continue' | 'abort' | 'skip'
  | 'cherry-pick' | 'revert' | 'reset'
  | 'branch' | 'branch-delete' | 'tag' | 'tag-delete'
  | 'stash' | 'stash-pop' | 'checkout' | 'fetch' | 'pull' | 'push'

/** Lo que la interfaz puede pedir. No hay texto libre: sólo estos campos. */
export interface GitOpParams {
  /** Rama, etiqueta o hash sobre el que actúa. */
  ref?: string
  /** Nombre nuevo, al crear ramas o etiquetas. */
  name?: string
  mode?: 'soft' | 'mixed' | 'hard'
  noFf?: boolean
  squash?: boolean
  autostash?: boolean
  rebase?: boolean
  force?: boolean
  setUpstream?: boolean
  checkout?: boolean
  message?: string
}

/** Lo que manda el vigilante del repositorio cuando algo cambia en disco. */
export interface GitWatchEvent {
  path: string
  info: GitInfo
  changes: FileChange[]
  state: GitOpState
  at: number
}

/** Un archivo que cambió, con sus líneas. */
export interface FileChange {
  path: string
  added: number
  removed: number
  /** M modificado, A añadido, D borrado, R renombrado, ? sin seguimiento. */
  status: 'M' | 'A' | 'D' | 'R' | '?'
  binary?: boolean
}

/**
 * Un paso de lo que hace un agente: un pensamiento, una llamada a una
 * herramienta o un aviso suyo. Es lo que se pinta en la línea de tiempo
 * mientras trabaja, para que se vea que está vivo y qué está tocando.
 */
export interface AgentStep {
  id: string
  at: number
  kind: 'thinking' | 'tool' | 'note'
  /** Nombre de la herramienta: Read, Edit, Bash, Grep… */
  tool?: string
  /** Sobre qué: la ruta, el comando o el patrón. */
  target?: string
  /** El pensamiento entero, o un resumen de lo que devolvió la herramienta. */
  detail?: string
  status: 'running' | 'ok' | 'error'
  durationMs?: number
  /** Líneas añadidas y quitadas, cuando el paso edita un archivo. */
  added?: number
  removed?: number
  /** El agente pidió permiso y no lo tenía. */
  denied?: boolean
  /** La regla de permiso que lo habría dejado (Claude Code): «Bash(npm test)». */
  rule?: string
  /** El paso espera tu permiso, o ya lo tuvo, o se le negó (agentes por API y CLIs que preguntan). */
  approval?: 'pending' | 'approved' | 'denied'
  /** Qué pide exactamente, dicho por el propio agente (una carpeta fuera del proyecto, un comando…). */
  ask?: { kind: 'outside' | 'edit' | 'run' | 'read' | 'fetch' | 'other'; target?: string }
  /**
   * El agente ofrece «permitir siempre» y hasta dónde llega: esta sesión,
   * este proyecto o todo tu usuario, y qué regla o modo quedaría.
   */
  always?: { scope: 'session' | 'project' | 'user'; what?: string }
}

/** Una tarea de la lista que lleva el propio agente (TodoWrite y compañía). */
export interface AgentTodo {
  text: string
  done: boolean
  /** La que tiene entre manos ahora. */
  active?: boolean
}

/**
 * Ventana de uso del plan, tal como la anuncia el propio CLI. Claude Code
 * manda un `rate_limit_event` con el tipo de ventana y cuándo se reinicia.
 * El tope no lo publica, así que no se inventa: se enseña lo que sí dice.
 */
export interface CliLimit {
  /** five_hour, weekly… tal cual lo llama el agente. */
  type: string
  /** allowed, allowed_warning, rejected… */
  status: string
  /** Epoch en ms en que se reinicia la ventana. */
  resetsAt?: number
  usingOverage?: boolean
}

/** Cuánto se ha gastado en una ventana del plan. */
export interface UsageWindow {
  /** Desde cuándo se cuenta. */
  since: number
  /** Cuándo se reinicia, si el agente lo ha dicho. */
  resetsAt?: number
  /** Tokens nuevos: entrada, salida y lo que se escribió en caché. */
  tokens: number
  /** Lo releído de caché, que va aparte porque se repite en cada mensaje. */
  cached: number
  /** Lo que costaría a precio de API; con plan de pago no es lo que pagas. */
  cost: number
  messages: number
  sessions: number
  /** Mensajes de modelos sin precio conocido: no están dentro de `cost`. */
  unpriced: number
}

/**
 * Uso de Claude Code sumando todo lo que corre en esta máquina: la app, las
 * terminales y la app de Claude. El tope del plan no lo publica nadie, así
 * que aquí sólo va lo gastado y cuándo se reinicia la cuenta.
 */
export interface ClaudeUsage {
  fiveHour: UsageWindow
  weekly: UsageWindow
  /** Cuándo se leyeron las transcripciones por última vez. */
  scannedAt: number
  /** true si la ventana corta está anclada al reinicio que dijo el agente. */
  exact: boolean
  limit: CliLimit | null
}

/** Un archivo que el agente tocó, según sus propias herramientas. */
export interface FileTouch {
  path: string
  kind: 'read' | 'edit' | 'write' | 'run' | 'search'
  /** Cuántas veces. */
  count: number
}

/**
 * Lo que el proveedor dice de tus límites. Sale de las cabeceras de la
 * respuesta: si no las manda, no se inventa nada.
 */
export interface UsageLimit {
  source: string
  requestsLimit?: number
  requestsRemaining?: number
  tokensLimit?: number
  tokensRemaining?: number
  inputTokensRemaining?: number
  outputTokensRemaining?: number
  /** Epoch ms en que se reponen. */
  resetAt?: number
  retryAfterSeconds?: number
}

/**
 * Lo último que se sabe del consumo de un proveedor o de un agente. Vive en
 * memoria mientras la app esté abierta: `at` dice de cuándo es el dato para
 * que la interfaz pueda decirlo en vez de darlo por actual.
 */
export interface UsageSnapshot {
  providerId: string
  providerName?: string
  model?: string
  limit?: UsageLimit
  /** Cuándo llegaron esas cabeceras. */
  limitAt?: number
  contextUsed?: number
  contextLimit?: number
  /** Última petición vista de este proveedor. */
  at: number
}

/**
 * Cuánto quieres que piense. 'auto' no manda nada al proveedor: el
 * comportamiento es exactamente el de siempre.
 */
export type Effort = 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'max'

/**
 * Hasta dónde puede llegar un agente sin preguntar.
 *
 * Los nombres son los de Claude Code, que es quien lo expone. En modo no
 * interactivo nadie puede pulsar «aceptar», así que «pregunta» significa que
 * el agente se para y cuenta qué necesitaba: por eso se explica en la propia
 * interfaz en vez de dejarlo a la imaginación.
 */
export const PERMISSION_MODES = [
  { id: 'acceptEdits', label: 'Edita solo', hint: 'crea y modifica archivos sin preguntar; para lo demás pide permiso' },
  { id: 'auto', label: 'Automático', hint: 'decide él qué necesita aprobación, como en la app de Claude' },
  { id: 'plan', label: 'Sólo plan', hint: 'mira y propone, pero no toca nada' },
  { id: 'manual', label: 'Pregunta', hint: 'te pregunta aquí antes de cada cosa, como en su terminal' },
  { id: 'bypassPermissions', label: 'Sin límites', hint: 'hace cualquier cosa sin pedir nada: ojo con lo que le mandas' }
] as const

/**
 * Lo mismo para un modelo por API que trabaja como agente. Aquí la app sí
 * puede preguntarte: lo que necesita permiso se queda esperando en la
 * conversación con sus botones de permitir y rechazar.
 */
export const API_PERMISSION_MODES = [
  { id: 'acceptEdits', label: 'Edita solo', hint: 'lee y edita archivos sin preguntar; cada comando espera a que lo permitas' },
  { id: 'manual', label: 'Pregunta', hint: 'cada edición y cada comando esperan a que los permitas aquí' },
  { id: 'plan', label: 'Sólo plan', hint: 'lee y busca, pero no puede tocar nada' },
  { id: 'bypassPermissions', label: 'Sin límites', hint: 'edita y ejecuta comandos sin preguntar: ojo con lo que le pides' }
] as const

/**
 * OpenCode y Gemini CLI hablan ACP: lo que su configuración tiene en «ask»
 * llega aquí como una pregunta con sus botones, como en su terminal.
 */
export const ACP_PERMISSION_MODES = [
  { id: 'manual', label: 'Pregunta', hint: 'lo que su configuración pide confirmar te lo pregunta aquí, como en su terminal' },
  { id: 'plan', label: 'Sólo plan', hint: 'su modo plan: mira y propone, pero no edita nada' },
  { id: 'bypassPermissions', label: 'Sin límites', hint: 'dice que sí a todo lo que pregunte (lo que tengas denegado sigue denegado)' }
] as const

/**
 * Codex, por su app-server: los modos de su selector de aprobaciones (Read
 * Only, Auto y Full Access) más el de preguntar por todo lo que no sea de fiar.
 */
export const CODEX_PERMISSION_MODES = [
  { id: 'acceptEdits', label: 'Edita solo', hint: 'trabaja dentro del proyecto sin preguntar; para salir de él o usar la red te pregunta aquí (su modo Auto)' },
  { id: 'manual', label: 'Pregunta', hint: 'sólo hace sin preguntar lo que es de fiar (leer, listar); lo demás te lo pregunta aquí' },
  { id: 'plan', label: 'Sólo lectura', hint: 'lee y propone; para editar o ejecutar algo te pregunta aquí (su modo Read Only)' },
  { id: 'bypassPermissions', label: 'Sin límites', hint: 'sin sandbox y sin preguntas (su Full Access): ojo con lo que le mandas' }
] as const

export const EFFORTS: Effort[] = ['auto', 'minimal', 'low', 'medium', 'high', 'max']

/** Un archivo adjunto al prompt. */
export interface Attachment {
  path: string
  name: string
  bytes: number
  /** false para binarios: se manda la ruta, no el contenido. */
  text: boolean
  /** Imagen que un modelo con visión recibe como imagen (PNG, JPEG, GIF o WebP). */
  image?: boolean
  mime?: string
  lines?: number
  /** Motivo por el que no se envía el contenido, si aplica. */
  skipped?: string
}

/* ------------------------------------------------------------------ *
 * Ficheros del proyecto                                              *
 * ------------------------------------------------------------------ */

/** Una entrada de carpeta, tal como se pinta en el árbol. */
export interface DirEntry {
  name: string
  /** Ruta relativa a la raíz del proyecto, con barras normales. */
  rel: string
  dir: boolean
  bytes?: number
  modified: number
  /** Carpeta de las que no conviene recorrer sola (node_modules y compañía). */
  heavy?: boolean
}

export interface FileContent {
  rel: string
  bytes: number
  modified: number
  binary: boolean
  truncated: boolean
  text?: string
  lines?: number
  eol?: 'lf' | 'crlf'
}

/* ------------------------------------------------------------------ *
 * GitHub                                                             *
 * ------------------------------------------------------------------ */

/**
 * Una cuenta con la que se puede iniciar sesión: GitHub (por gh) o un CLI con
 * su propio inicio de sesión. La app sólo pregunta a la herramienta si hay
 * sesión; el secreto lo guarda ella.
 */
export interface AccountStatus {
  id: string
  name: string
  kind: 'github' | 'cli'
  installed: boolean
  /** null: está instalada pero no dice desde fuera si hay sesión. */
  signedIn: boolean | null
  /** La cuenta, o los proveedores conectados. */
  who?: string
  /** El plan o el tipo de sesión (pro, plus, API…). */
  plan?: string
  detail?: string
  /** El comando oficial que inicia sesión, para lanzarlo en una terminal. */
  loginCommand?: string
  logoutCommand?: string
  installCommand?: string
  installUrl?: string
  /** El inicio de sesión se hace sin salir de la app (GitHub). */
  inApp?: boolean
}

/** Lo que va pasando en un inicio de sesión lanzado desde la app. */
export interface AccountsEvent {
  id: 'github' | 'openrouter'
  /** code: gh ha dado su código de un solo uso. browser: la dirección que hay que abrir. done: terminó. */
  phase: 'code' | 'browser' | 'done'
  code?: string
  url?: string
  ok?: boolean
  error?: string
}

export interface GhStatus {
  installed: boolean
  authed: boolean
  path?: string
  version?: string
  login?: string
  name?: string
  url?: string
  scopes?: string
  hint?: string
  /**
   * Orden que lo instala en este sistema (winget, Homebrew, apt, dnf…), para
   * lanzarla en la terminal integrada. Sin ella se enlaza la web de gh.
   */
  installCommand?: string
}

export interface GhRepo {
  nameWithOwner: string
  description?: string
  private: boolean
  fork: boolean
  archived: boolean
  language?: string
  updatedAt?: number
  stars: number
  url: string
  defaultBranch?: string
  sizeKb?: number
}

export interface RunOptions {
  providerId: string
  model: string
  prompt: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  messages?: ChatMessage[]
  agentId?: string
  agentName?: string
  projectId?: string
  projectName?: string
  arenaId?: string
  conversationId?: string
  kind?: 'chat' | 'arena' | 'git'
  /** Cuánto debe pensar. 'auto' o sin valor: no se toca la petición. */
  effort?: Effort
  attachments?: Attachment[]
  /** Ruta del proyecto: donde trabaja en modo agente y donde se cuentan los archivos que cambian. */
  projectPath?: string
  /** Trabaja como agente: con herramientas para leer, editar y ejecutar dentro del proyecto. */
  agentMode?: boolean
  /** Qué puede hacer sin preguntar en modo agente. Ver API_PERMISSION_MODES. */
  permissionMode?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Lo que el usuario adjuntó a ese mensaje: se vuelve a mandar con el historial. */
  attachments?: Attachment[]
  /** Ya compuesto: las imágenes que van como imagen (sólo en main). */
  images?: ImageRef[]
}

/** Una imagen de un mensaje: se lee del disco al montar la petición. */
export interface ImageRef {
  path: string
  mime: string
  name?: string
}

export interface CliRunOptions {
  agentId: string
  projectPath: string
  prompt: string
  projectId?: string
  projectName?: string
  /** Agrupa la ejecución con otras de la misma comparativa. */
  arenaId?: string
  conversationId?: string
  kind?: 'cli' | 'arena'
  effort?: Effort
  attachments?: Attachment[]
  /** Modelo concreto para esta ejecución, si el CLI admite elegirlo. */
  model?: string
  /** Qué puede hacer sin preguntar. Ver CLI_PERMISSION_MODES. */
  permissionMode?: string
  /** Sesión del propio agente que se retoma, para que recuerde lo anterior. */
  resumeSessionId?: string
  /**
   * Reglas de permiso de Claude Code sólo para esta ejecución («Bash(npm test)»,
   * «Edit(src/app.js)»): lo que le faltó en el turno anterior.
   */
  allowTools?: string[]
  /** Retomar en una sesión nueva, dejando la original como estaba. */
  fork?: boolean
  /**
   * La conversación hasta ahora. Sólo se usa si el CLI no sabe retomar su
   * sesión: entonces va dentro del prompt para que no empiece de cero.
   */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /**
   * La conversación se ha rebobinado: lo que el CLI guarda (por id o en la
   * carpeta) lleva mensajes que ya no están, así que no se retoma y la
   * conversación va en el prompt.
   */
  rewound?: boolean
}

export interface CliEvent {
  runId: string
  type: 'stdout' | 'stderr' | 'exit' | 'meta' | 'reasoning' | 'files' | 'usage' | 'step' | 'limit'
  data?: string
  code?: number
  run?: RunRecord
  /** Archivos que han cambiado hasta ahora, mientras el agente trabaja. */
  files?: FileChange[]
  /** Archivos que el agente dice estar leyendo o editando. */
  touched?: FileTouch[]
  /** Contexto en vivo, cuando el agente lo informa. */
  contextUsed?: number
  contextLimit?: number
  /** Un paso nuevo o la actualización de uno que ya estaba. */
  step?: AgentStep
  /** Ventana de uso del plan, según el propio agente. */
  limit?: CliLimit
  /** Id de la sesión del agente, para poder casarla con su transcripción. */
  cliSessionId?: string
}

export interface DetectionResult {
  providers: ProviderStatus[]
  clis: DetectedCli[]
  localServers: DetectedServer[]
  envKeys: { name: string; providerId?: string; masked: string }[]
  configDirs: { name: string; path: string; exists: boolean }[]
  scannedAt: number
}

export interface DetectedCli {
  id: string
  name: string
  command: string
  found: boolean
  path?: string
  version?: string
}

export interface DetectedServer {
  id: string
  name: string
  url: string
  up: boolean
  models: string[]
  latencyMs?: number
}

export interface StatsBucket {
  key: string
  runs: number
  tokensIn: number
  tokensOut: number
  cost: number
  avgTtft: number
  avgTps: number
  avgMs: number
  errors: number
}

/* ------------------------------------------------------------------ *
 * Terminales integradas                                              *
 * ------------------------------------------------------------------ */

/**
 * Motor de la terminal.
 *
 * 'pty' es una consola de verdad (ConPTY en Windows): las aplicaciones de
 * pantalla completa como opencode, vim o los agentes en modo interactivo
 * funcionan igual que en Windows Terminal.
 *
 * 'pipe' es el respaldo por tuberías, que organiza la salida en bloques con
 * su código de salida. Sólo se usa si el módulo nativo del PTY no carga.
 */
export type TermBackend = 'pty' | 'pipe'

/** Una terminal viva: una shell persistente con su directorio actual. */
export interface TermInfo {
  id: string
  /** Ejecutable real de la shell. */
  shell: string
  /** Nombre legible: PowerShell, cmd, bash… */
  shellLabel: string
  cwd: string
  alive: boolean
  createdAt: number
  pid?: number
  /** Proyecto al que está asociada, si nació desde uno. */
  projectId?: string
  title?: string
  backend: TermBackend
  /** Motivo por el que no hay PTY, si se ha caído al respaldo. */
  backendReason?: string
}

/**
 * Eventos de una terminal. La salida llega troceada tal cual la emite la
 * shell; 'block-end' cierra el bloque de un comando con su código y su cwd.
 */
export interface TermEvent {
  termId: string
  type: 'out' | 'err' | 'block-end' | 'exit' | 'ready' | 'cwd' | 'title'
  data?: string
  exitCode?: number
  ok?: boolean
  cwd?: string
  /** Milisegundos que tardó el comando, sólo en 'block-end'. */
  durationMs?: number
}

/* ------------------------------------------------------------------ *
 * Sesiones: conversaciones y ejecuciones de CLI que persisten         *
 * ------------------------------------------------------------------ */

/** Métricas congeladas de un turno. El detalle completo vive en runs.jsonl. */
export interface TurnMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens?: number
  reasoningTokens?: number
  ttftMs?: number
  totalMs: number
  tokensPerSec?: number
  costTotal: number
  costEstimated: boolean
  status: RunStatus
  /** Contexto gastado y ventana del modelo. */
  contextUsed?: number
  contextLimit?: number
  /** Lo que dicen las cabeceras del proveedor sobre tus límites. */
  usageLimit?: UsageLimit
  /** Archivos que cambiaron mientras corría, medido con git. */
  filesChanged?: FileChange[]
  /** Archivos que el agente dijo abrir o editar. */
  filesTouched?: FileTouch[]
  effort?: Effort
  branch?: string
  /** Ventana de uso del plan anunciada por el agente. */
  cliLimit?: CliLimit
  permissionMode?: string
  checkpoint?: RunCheckpoint
  /** Ya se deshizo este turno. */
  undone?: boolean
}

export interface SessionTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  runId?: string
  model?: string
  providerId?: string
  error?: string
  metrics?: TurnMetrics
  /** Salida cruda, para turnos de agentes de línea de comandos. */
  raw?: string
  /** Adjuntos del turno del usuario. */
  attachments?: Attachment[]
  /** Lo que hizo el agente, paso a paso. */
  steps?: AgentStep[]
}

export type SessionKind = 'chat' | 'cli'

/** Una conversación o sesión de agente que se puede cerrar y retomar. */
export interface StoredSession {
  id: string
  kind: SessionKind
  title: string
  /** El título se puso a mano (o es el de una copia): el primer prompt no lo cambia. */
  titled?: boolean
  createdAt: number
  updatedAt: number
  /** Ajustes con los que se retoma la sesión. */
  providerId?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  agentId?: string
  cliAgentId?: string
  projectId?: string
  includeContext?: boolean
  /** Esfuerzo elegido para esta conversación. */
  effort?: Effort
  /** Modelo del agente de línea de comandos, cuando su CLI deja elegirlo. */
  cliModel?: string
  /** Qué deja hacer al agente sin preguntar. */
  permissionMode?: string
  /**
   * Chat por API con proyecto: si el modelo trabaja como agente, con
   * herramientas sobre los archivos. Sin valor cuenta como sí.
   */
  agentMode?: boolean
  /** Sesión de la pestaña Agente de un proyecto que trabaja con un modelo por API. */
  projectTab?: boolean
  /** Sesión propia del agente de línea de comandos, para retomarla en el turno siguiente. */
  cliSessionId?: string
  /** De qué agente es esa sesión: la de uno no vale para otro. */
  cliSessionAgentId?: string
  /** Seguir en la sesión del agente entre turnos. Sin valor cuenta como sí. */
  cliContinue?: boolean
  /** El próximo turno retoma en una sesión nueva (bifurca). */
  cliForkNext?: boolean
  /**
   * Se editó o regeneró un mensaje: la sesión del agente tiene lo descartado,
   * así que el próximo turno empieza una nueva con la conversación en el prompt.
   */
  cliRewound?: boolean
  /** Trabaja en un worktree aparte (su carpeta) en vez de en la del proyecto. */
  worktreePath?: string
  /**
   * La diste por hecha en el tablero de Tareas, con cuántos turnos tenía: si
   * le vuelves a escribir, vuelve a su columna.
   */
  taskDone?: { at: number; turns: number }
  turns: SessionTurn[]
  pinned?: boolean
  /** Cerrada: sigue guardada y se puede reabrir. */
  archived?: boolean
}

/* ------------------------------------------------------------------ *
 * Ollama y hardware                                                  *
 * ------------------------------------------------------------------ */

export interface OllamaModel {
  name: string
  sizeBytes: number
  parameterSize?: string
  quantization?: string
  family?: string
  contextLength?: number
  modifiedAt?: number
  capabilities?: string[]
}

export interface OllamaStatus {
  /** El servidor responde en su puerto. */
  up: boolean
  /** El ejecutable existe en el equipo. */
  installed: boolean
  version?: string
  binPath?: string
  baseUrl: string
  models: OllamaModel[]
  error?: string
}

/** Un modelo que OpenCode puede usar, con lo que hace falta para elegirlo. */
export interface OpencodeModel {
  /** Tal cual se elige: proveedor/modelo. Los de Ollama llevan el nombre del modelo, no el de su variante. */
  id: string
  provider: 'opencode' | 'ollama'
  name: string
  /** Niveles de esfuerzo que admite (`--variant`); vacío si no tiene. */
  variants: string[]
  context?: number
  free?: boolean
}

export interface GpuInfo {
  name: string
  /** En un Mac con chip de Apple, la parte de la memoria que puede usar la GPU. */
  vramMb?: number
  /** true si es la GPU dedicada con más memoria. */
  primary?: boolean
  /** Comparte la memoria con el sistema (Mac con chip de Apple). */
  unified?: boolean
}

export interface HardwareInfo {
  cpu: string
  cores: number
  ramGb: number
  gpus: GpuInfo[]
  /** VRAM de la mejor GPU, en MB. Es lo que decide qué modelos entran. */
  bestVramMb?: number
  /** La GPU y el sistema comparten memoria: no hay VRAM aparte. */
  unifiedMemory?: boolean
  platform: string
}

/** Recomendación de modelo local calculada a partir del hardware. */
export interface ModelRecommendation {
  /** Etiqueta exacta para `ollama pull`. */
  name: string
  label: string
  params: string
  sizeGb: number
  contextLength?: number
  why: string
  /** Si cabe entero en la GPU, parcialmente, o va por CPU. */
  fits: 'gpu' | 'partial' | 'cpu'
  /** Orden de preferencia calculado. */
  score: number
  tags: string[]
}

export interface PullProgress {
  model: string
  status: string
  completed?: number
  total?: number
  done?: boolean
  error?: string
}

/** Enlaces de un modelo hacia su ficha, sus pesos o su documentación. */
export interface ModelLinks {
  /** Enlace principal: la ficha del modelo, o la lista del proveedor. */
  primary: string
  /** A qué apunta el principal, para poder decirlo en la interfaz. */
  primaryKind: 'model' | 'provider'
  /** Alternativas útiles: pesos, precios, documentación. */
  extras: { label: string; url: string }[]
}

/* ------------------------------------------------------------------ *
 * Relevo entre agentes                                               *
 * ------------------------------------------------------------------ */

/**
 * De dónde sale un relevo: una conversación de la Consola (`session`), una
 * sesión de Claude Code de cualquier sitio (`claude`) o una de Codex, OpenCode
 * o Gemini CLI abierta fuera de la app.
 */
export interface RelaySource {
  kind: 'session' | 'claude' | 'codex' | 'opencode' | 'gemini'
  id: string
}

/** Lo que recibe el agente que toma el relevo. Se enseña entero antes de lanzarlo. */
export interface RelayPackage {
  source: RelaySource
  label: string
  /** Quién lo estaba haciendo. */
  fromAgent?: string
  projectPath?: string
  projectId?: string
  projectName?: string
  branch?: string
  /** La primera petición. */
  goal?: string
  exchanges: { role: 'user' | 'assistant'; content: string }[]
  todos: AgentTodo[]
  filesTouched: string[]
  /** `git diff HEAD --stat`. */
  gitStat: string
  untracked: string[]
  diff: string
  diffTruncated: boolean
  /** Por qué se releva, si se sabe: cupo agotado, un error… */
  reason?: string
}

/* ------------------------------------------------------------------ *
 * Cupos de todas las IAs y presupuestos                              *
 * ------------------------------------------------------------------ */

/**
 * De dónde sale un cupo, que es lo que dice cuánto fiarse de él:
 *  - `official`: lo dice el propio proveedor (el % de la ventana, un saldo).
 *  - `measured`: lo cuenta la app con tu uso real contra un tope que el
 *    proveedor publica en su documentación, pero no por API.
 *  - `own`: un presupuesto que has puesto tú.
 */
export type QuotaOrigin = 'official' | 'measured' | 'own'

export interface Quota {
  /** Único y estable: 'claude.five_hour', 'codex.primary', 'budget.<id>'… */
  id: string
  /** A quién pertenece, legible: «Claude», «ChatGPT · Codex», «OpenRouter»… */
  provider: string
  /** Para agrupar y para saber qué agentes dependen de él. */
  providerKey: string
  /** Qué ventana o qué saldo es: «Ventana de 5 h», «Semana», «Saldo»… */
  label: string
  /** De qué es, si hace falta decirlo: el plan («Pro»), el nombre del presupuesto… */
  target?: string
  kind: 'window' | 'balance' | 'rate' | 'budget'
  /** Unidad de `used`, `limit` y `remaining`. */
  unit: 'percent' | 'usd' | 'requests' | 'tokens' | 'cny'
  used?: number
  limit?: number
  remaining?: number
  /** 0–100 cuando se sabe. Sin tope conocido no hay porcentaje. */
  usedPct?: number
  resetsAt?: number
  /** Duración de la ventana, si es una ventana. */
  windowMs?: number
  origin: QuotaOrigin
  /** Cómo se sabe: frases sueltas separadas por saltos de línea (se traducen una a una). */
  how: string
  updatedAt: number
  /** Comandos de agentes que gastan de este cupo: 'claude', 'codex'… */
  agents?: string[]
  /**
   * A este ritmo, cuándo llega al tope. Sin tope o sin ritmo, no hay. El
   * ritmo va en la unidad de `used` o, si no la hay, en puntos de % por hora.
   */
  projection?: { ratePerHour: number; etaAt?: number; hitsBeforeReset?: boolean }
  /** El dato es de hace demasiado: se enseña, pero diciéndolo. */
  stale?: boolean
  error?: string
}

/** Un proveedor que usas y cuyo cupo no se puede saber desde aquí, y por qué. */
export interface QuotaGap {
  provider: string
  why: string
  url?: string
}

export interface QuotaReport {
  quotas: Quota[]
  gaps: QuotaGap[]
  at: number
}

/** Un cupo ha cruzado un umbral de aviso (o se ha agotado). */
export interface QuotaAlert {
  quotaId: string
  provider: string
  label: string
  usedPct: number
  /** El umbral cruzado: 50, 80, 95… o 100 si se ha agotado. */
  level: number
  resetsAt?: number
  etaAt?: number
  /** Si se ha agotado: el agente con más margen para seguir. */
  suggestion?: { agentId: string; agentName: string; reason: string; left?: number; where?: string }
}

/** Plan de Gemini CLI: de él sale el tope diario que publica Google. */
export type GeminiPlan = 'auto' | 'free' | 'pro' | 'ultra' | 'standard' | 'enterprise' | 'none'

export interface QuotaSettings {
  /** Leer el % del plan de Claude con un statusLine propio (encadena el tuyo). */
  claudeStatusLine?: boolean
  /** Preguntar a GitHub por el cupo de Copilot con el token de `gh`. */
  copilot?: boolean
  geminiPlan?: GeminiPlan
  /** Tienes el plan Go de OpenCode: se miden sus topes. */
  opencodeGo?: boolean
  /** Consultar saldos de las claves (OpenRouter, DeepSeek, Kimi…). Sí por omisión. */
  balances?: boolean
  /** Avisos del sistema al cruzar los umbrales. Sí por omisión. */
  alerts?: boolean
  /** Umbrales de aviso en %. Por omisión 50, 80 y 95. */
  thresholds?: number[]
}

/** Un presupuesto de gasto en dinero, sobre lo que quieras. */
export interface Budget {
  id: string
  label?: string
  /** Sobre qué se cuenta. */
  scope: 'total' | 'provider' | 'project' | 'agent'
  /** providerId, projectId o nombre del agente, según el ámbito. */
  target?: string
  period: 'day' | 'week' | 'month'
  limitUsd: number
  /** Además de avisar, no deja lanzar nada que cuente en él al llegar al 100 %. */
  hard?: boolean
  /**
   * Contar también lo estimado (lo que costaría a precio de API lo que va por
   * suscripción). Por omisión no: un presupuesto es dinero de verdad.
   */
  includeEstimated?: boolean
}
