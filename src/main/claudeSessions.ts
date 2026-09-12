/**
 * Lo que Claude Code deja escrito en disco.
 *
 * Cada sesión —la lances desde esta aplicación, desde una terminal o desde la
 * app de Claude— se guarda en `~/.claude/projects/<carpeta>/<sesión>.jsonl`,
 * una línea por evento. De ahí salen dos cosas que la app no podía saber de
 * otra forma:
 *
 * - Las sesiones que arrancaste tú en una terminal, con sus tokens y su coste,
 *   para que entren en el histórico como cualquier otra ejecución.
 * - Cuánto llevas gastado en las últimas horas y en la semana, que es lo que
 *   consume el límite del plan.
 *
 * Los ficheros crecen por el final y nunca se reescriben, así que se leen una
 * vez enteros y después sólo lo que se haya añadido. El índice se guarda al
 * lado de la configuración para que reabrir la app no cueste nada.
 *
 * Lo que no se hace: adivinar el tope del plan. Claude Code dice cuándo se
 * reinicia la ventana, no cuánto te queda; así que se enseña el gasto real y
 * la hora del reinicio, y ahí se para.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { paths } from './paths'
import { computeCost, priceFor } from './providers/models'
import { allRuns, upsertRuns } from './runs'
import type { RunRecord, UsageWindow } from '@shared/types'

const ROOT = join(homedir(), '.claude', 'projects')
const INDEX = () => join(paths.dir, 'claude-index.json')

/** Sólo interesan las sesiones recientes: la ventana más larga es de 7 días. */
const DAYS = 10
/** Una hora por casilla: sobra para cualquier ventana que queramos sumar. */
const BUCKET_MS = 3600_000

interface Bucket {
  /** Tokens nuevos: lo que de verdad hubo que procesar esa hora. */
  tok: number
  /** Relectura de caché, aparte: si se suma con lo demás sale un disparate. */
  cache: number
  cost: number
  msgs: number
  /** Mensajes de un modelo sin precio conocido: su gasto no entra en `cost`. */
  nc: number
}

interface FileState {
  size: number
  mtimeMs: number
  sessionId?: string
  cwd?: string
  entrypoint?: string
  version?: string
  model?: string
  gitBranch?: string
  firstPrompt?: string
  startedAt?: number
  endedAt?: number
  messages: number
  tools: number
  inTok: number
  outTok: number
  cacheRead: number
  cacheCreate: number
  cost: number
  /** Mensajes cuyo modelo no está en el catálogo: no se les puede poner precio. */
  unpriced: number
  /** Archivos que editó o escribió, para el resumen. */
  files: string[]
  /** Gasto por hora, para poder sumar cualquier ventana. */
  buckets: Record<string, Bucket>
}

interface Index {
  version: number
  files: Record<string, FileState>
  scannedAt: number
}

let index: Index = { version: 1, files: {}, scannedAt: 0 }
let loaded = false
let scanning = false

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(readFileSync(INDEX(), 'utf8'))
    if (raw?.version === 1 && raw.files) index = raw
  } catch {
    /* sin índice todavía: se construye en el primer repaso */
  }
}

function save(): void {
  try {
    writeFileSync(INDEX(), JSON.stringify(index), 'utf8')
  } catch (err) {
    console.error('[claude] no se pudo guardar el índice:', err)
  }
}

function emptyState(size: number, mtimeMs: number): FileState {
  return {
    size,
    mtimeMs,
    messages: 0,
    tools: 0,
    inTok: 0,
    outTok: 0,
    cacheRead: 0,
    cacheCreate: 0,
    cost: 0,
    unpriced: 0,
    files: [],
    buckets: {}
  }
}

/* ------------------------------------------------------------------ *
 * Lectura                                                            *
 * ------------------------------------------------------------------ */

/** Las transcripciones de los últimos días, de la más reciente a la más vieja. */
function recentFiles(): { path: string; size: number; mtimeMs: number }[] {
  if (!existsSync(ROOT)) return []
  const cutoff = Date.now() - DAYS * 86_400_000
  const out: { path: string; size: number; mtimeMs: number }[] = []
  for (const dir of readdirSync(ROOT)) {
    const full = join(ROOT, dir)
    let entries: string[]
    try {
      if (!statSync(full).isDirectory()) continue
      entries = readdirSync(full)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(full, name)
      try {
        const st = statSync(path)
        if (st.mtimeMs < cutoff) continue
        out.push({ path, size: st.size, mtimeMs: st.mtimeMs })
      } catch {
        /* desapareció mientras mirábamos */
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * Suma una línea al estado de su fichero.
 *
 * Se filtra por texto antes de parsear: la mayoría de las líneas son adjuntos
 * y capturas de ficheros que pueden ocupar megas, y parsearlas para tirarlas
 * sería el grueso del trabajo.
 */
function eatLine(line: string, st: FileState): void {
  if (line.length < 20) return
  const isAssistant = line.includes('"type":"assistant"')
  const isUser = line.includes('"type":"user"')
  if (!isAssistant && !isUser) return

  let evt: any
  try {
    evt = JSON.parse(line)
  } catch {
    return
  }

  const at = Date.parse(evt.timestamp ?? '') || 0
  if (at) {
    if (!st.startedAt || at < st.startedAt) st.startedAt = at
    if (!st.endedAt || at > st.endedAt) st.endedAt = at
  }
  if (evt.sessionId && !st.sessionId) st.sessionId = String(evt.sessionId)
  if (evt.cwd && !st.cwd) st.cwd = String(evt.cwd)
  if (evt.entrypoint && !st.entrypoint) st.entrypoint = String(evt.entrypoint)
  if (evt.version) st.version = String(evt.version)
  if (evt.gitBranch) st.gitBranch = String(evt.gitBranch)

  if (evt.type === 'user') {
    // El primer mensaje de verdad del usuario da título a la sesión. Los que
    // llevan tool_result son respuestas de herramientas, no cosas que dijera.
    const content = evt.message?.content
    if (!st.firstPrompt && typeof content === 'string' && content.trim() && !content.startsWith('<')) {
      st.firstPrompt = content.replace(/\s+/g, ' ').trim().slice(0, 300)
    }
    return
  }

  const msg = evt.message
  if (!msg || msg.model === '<synthetic>') return
  if (msg.model) st.model = String(msg.model)

  for (const block of msg.content ?? []) {
    if (block?.type !== 'tool_use') continue
    st.tools++
    const name = String(block.name ?? '').toLowerCase()
    const file = block.input?.file_path ?? block.input?.notebook_path
    if (typeof file === 'string' && /^(edit|multiedit|write|notebookedit)/.test(name)) {
      const short = file.replace(/\\/g, '/')
      if (!st.files.includes(short) && st.files.length < 60) st.files.push(short)
    }
  }

  const u = msg.usage
  if (!u) return
  const inTok = u.input_tokens ?? 0
  const outTok = u.output_tokens ?? 0
  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheCreate = u.cache_creation_input_tokens ?? 0
  if (!inTok && !outTok && !cacheRead && !cacheCreate) return

  st.messages++
  st.inTok += inTok
  st.outTok += outTok
  st.cacheRead += cacheRead
  st.cacheCreate += cacheCreate

  // El coste sale del catálogo de precios: las transcripciones no lo traen. Si
  // el modelo no está en el catálogo no se le inventa una tarifa: se cuenta
  // aparte para poder avisar de que ese gasto falta en la suma.
  const model = st.model ?? 'claude-sonnet-5'
  const known = priceFor('anthropic', model).source !== 'none'
  const costTotal = known
    ? computeCost('anthropic', model, inTok + cacheCreate + cacheRead, outTok, cacheRead).costTotal
    : 0
  if (known) st.cost += costTotal
  else st.unpriced++

  if (at) {
    const key = String(Math.floor(at / BUCKET_MS))
    const b = st.buckets[key] ?? { tok: 0, cache: 0, cost: 0, msgs: 0, nc: 0 }
    // Ojo con la caché: en una conversación larga, cada mensaje vuelve a leer
    // todo lo anterior, así que sumar `cache_read` con lo demás da cientos de
    // millones de tokens para una tarde de trabajo. Lo nuevo va por un lado y
    // lo releído por otro.
    b.tok += inTok + outTok + cacheCreate
    b.cache += cacheRead
    b.cost += costTotal
    b.msgs++
    if (!known) b.nc++
    st.buckets[key] = b
  }
}

/** Lee un fichero desde `from` bytes, cediendo el turno para no bloquear. */
function readFrom(path: string, from: number, st: FileState): Promise<void> {
  return new Promise((resolve) => {
    const stream = createReadStream(path, { encoding: 'utf8', start: from })
    let buffer = ''
    let since = 0

    stream.on('data', (chunk: string | Buffer) => {
      buffer += chunk.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.trim()) eatLine(line, st)
        // Cada tantas líneas se para un momento: así una transcripción de
        // catorce megas no deja la aplicación clavada.
        if (++since >= 2000) {
          since = 0
          stream.pause()
          setImmediate(() => stream.resume())
        }
      }
    })
    stream.on('error', () => resolve())
    stream.on('end', () => {
      if (buffer.trim()) eatLine(buffer, st)
      resolve()
    })
  })
}

/**
 * Repasa las transcripciones recientes. Sólo lee lo que ha crecido desde la
 * última vez, así que en marcha cuesta milisegundos.
 */
export async function scanClaude(): Promise<{ files: number; sessions: number }> {
  load()
  if (scanning) return { files: 0, sessions: Object.keys(index.files).length }
  scanning = true
  try {
    const files = recentFiles()
    let touched = 0

    for (const f of files) {
      const prev = index.files[f.path]
      if (prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs) continue

      // Si el fichero encogió, es que ya no es el mismo: se lee de cero.
      const grew = prev && f.size > prev.size
      const st = grew ? { ...prev } : emptyState(f.size, f.mtimeMs)
      await readFrom(f.path, grew ? prev!.size : 0, st)
      st.size = f.size
      st.mtimeMs = f.mtimeMs
      index.files[f.path] = st
      touched++
    }

    // Lo que ya no está en disco tampoco tiene que estar en el índice.
    const alive = new Set(files.map((f) => f.path))
    for (const path of Object.keys(index.files)) {
      if (!alive.has(path)) delete index.files[path]
    }

    index.scannedAt = Date.now()
    if (touched) save()
    return { files: touched, sessions: Object.keys(index.files).length }
  } finally {
    scanning = false
  }
}

/* ------------------------------------------------------------------ *
 * Ventanas de uso                                                    *
 * ------------------------------------------------------------------ */

function sumSince(since: number): {
  tokens: number
  cached: number
  cost: number
  messages: number
  sessions: number
  unpriced: number
} {
  const firstBucket = Math.floor(since / BUCKET_MS)
  let tokens = 0
  let cached = 0
  let cost = 0
  let messages = 0
  let sessions = 0
  let unpriced = 0
  for (const st of Object.values(index.files)) {
    let used = false
    for (const [key, b] of Object.entries(st.buckets)) {
      if (Number(key) < firstBucket) continue
      tokens += b.tok
      cached += b.cache ?? 0
      cost += b.cost
      messages += b.msgs
      unpriced += b.nc ?? 0
      used = true
    }
    if (used) sessions++
  }
  return { tokens, cached, cost, messages, sessions, unpriced }
}

/**
 * Cuánto llevas gastado en la ventana corta y en la semana.
 *
 * `resetsAt` viene del propio Claude Code cuando ha mandado un
 * `rate_limit_event`; si no, se cuentan las últimas cinco horas a secas y se
 * dice que es así.
 */
export function claudeWindows(resetsAt?: number): {
  fiveHour: UsageWindow
  weekly: UsageWindow
  scannedAt: number
  exact: boolean
} {
  load()
  const now = Date.now()
  const exact = Boolean(resetsAt && resetsAt > now)
  const start = exact ? (resetsAt as number) - 5 * 3600_000 : now - 5 * 3600_000
  const weekStart = now - 7 * 86_400_000

  return {
    fiveHour: { since: start, resetsAt: exact ? resetsAt : undefined, ...sumSince(start) },
    weekly: { since: weekStart, ...sumSince(weekStart) },
    scannedAt: index.scannedAt,
    exact
  }
}

/* ------------------------------------------------------------------ *
 * Sesiones sueltas al histórico                                      *
 * ------------------------------------------------------------------ */

/** Nombre corto de la carpeta donde corrió la sesión. */
function projectOf(cwd?: string): string | undefined {
  if (!cwd) return undefined
  const clean = cwd.replace(/[\\/]+$/, '')
  return basename(clean) || undefined
}

/**
 * Mete en el histórico las sesiones de Claude Code que no lanzó la app.
 *
 * Se identifican por su id de sesión: las que arrancaron aquí ya lo guardan en
 * su ejecución, así que no se duplican. Una sesión que sigue viva se
 * actualiza en cada repaso en vez de crear otra fila.
 */
export function importClaudeSessions(): number {
  load()
  const runs = allRuns()
  const fromApp = new Set(runs.filter((r) => r.cliSessionId).map((r) => r.cliSessionId as string))

  const pending: RunRecord[] = []
  for (const st of Object.values(index.files)) {
    if (!st.sessionId || !st.messages || !st.startedAt) continue
    if (fromApp.has(st.sessionId)) continue

    const id = 'claude-' + st.sessionId
    // Lo releído de caché no se suma al total: iría multiplicado por el número
    // de mensajes de la sesión y daría cifras de ciencia ficción.
    const totalIn = st.inTok + st.cacheCreate
    const where = st.entrypoint === 'cli' ? 'terminal' : st.entrypoint === 'claude-desktop' ? 'app de Claude' : (st.entrypoint ?? 'fuera')

    pending.push({
      id,
      createdAt: st.startedAt,
      kind: 'cli',
      providerId: 'cli:claude',
      model: st.model ?? 'claude',
      agentName: 'Claude Code',
      projectName: projectOf(st.cwd),
      prompt: st.firstPrompt ?? '(sesión de Claude Code)',
      response: '',
      status: 'ok',
      promptTokens: totalIn,
      completionTokens: st.outTok,
      totalTokens: totalIn + st.outTok,
      cachedTokens: st.cacheRead || undefined,
      totalMs: Math.max(0, (st.endedAt ?? st.startedAt) - st.startedAt),
      costIn: 0,
      costOut: 0,
      costTotal: st.cost,
      // El coste sale de los precios del catálogo, no de la factura.
      costEstimated: true,
      branch: st.gitBranch,
      // Si el modelo no está en el catálogo, el coste sale a cero y eso se lee
      // como "gratis": mejor decirlo en la nota que dejar el cero a secas.
      notes:
        `${st.messages} mensajes · ${st.tools} herramientas · desde ${where}` +
        (st.unpriced ? ` · sin precio para ${st.model ?? 'este modelo'}` : ''),
      cliSessionId: st.sessionId,
      source: 'terminal',
      filesTouched: st.files.length
        ? st.files.slice(0, 40).map((path) => ({ path, kind: 'edit' as const, count: 1 }))
        : undefined
    })
  }

  return upsertRuns(pending)
}

/** Un repaso completo: leer lo nuevo y volcarlo al histórico. */
export async function refreshClaude(): Promise<{ imported: number }> {
  await scanClaude()
  return { imported: importClaudeSessions() }
}
