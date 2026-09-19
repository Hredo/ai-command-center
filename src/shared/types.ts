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
  topP?: number
  color: string
  icon?: string
  createdAt: number
  /** Contexto extra: rutas relativas dentro del proyecto que se adjuntan. */
  contextGlobs?: string[]
  /** Cuánto piensa por omisión. */
  effort?: Effort
  /** Qué puede hacer sin preguntar. Ver API_PERMISSION_MODES. */
  permissionMode?: string
}

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
  parser: 'claude-stream-json' | 'opencode-json' | 'plain'
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

export type RunStatus = 'ok' | 'error' | 'aborted' | 'running'

/** Una ejecución: la unidad de análisis de toda la app. */
export interface RunRecord {
  id: string
  createdAt: number
  kind: 'chat' | 'arena' | 'cli'
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
  /** Qué podía hacer sin preguntar. */
  permissionMode?: string
  /** De dónde salió: de la app o de una sesión suelta en la terminal. */
  source?: 'app' | 'terminal'
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
  streamChunkMs: number
  /** Avisar con una notificación del sistema al terminar una tarea. */
  notifyOnFinish: boolean
  /** Sólo notificar si la ventana no está en primer plano. */
  notifyOnlyWhenUnfocused: boolean
  /** Ejecutable de la shell para las terminales integradas. */
  shellPath?: string
  /** Segundos entre sondeos automáticos de motores locales. 0 lo desactiva. */
  localPollSeconds: number
}

export interface AppConfig {
  settings: Settings
  providers: Record<string, ProviderOverride>
  agents: Agent[]
  cliAgents: CliAgent[]
  projects: Project[]
  favorites: string[]
  customModels: ModelInfo[]
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
  /** Agente por API: el paso espera tu permiso, o ya lo tuvo, o se le negó. */
  approval?: 'pending' | 'approved' | 'denied'
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
  { id: 'manual', label: 'Pregunta', hint: 'se detiene y te dice qué necesitaba; aquí no puede preguntarte' },
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

export const EFFORTS: Effort[] = ['auto', 'minimal', 'low', 'medium', 'high', 'max']

/** Un archivo adjunto al prompt. */
export interface Attachment {
  path: string
  name: string
  bytes: number
  /** false para binarios: se manda la ruta, no el contenido. */
  text: boolean
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
  kind?: 'chat' | 'arena'
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
