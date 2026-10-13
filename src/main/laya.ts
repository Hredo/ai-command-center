/**
 * Laya: el modelo de decisiones que lee el prompt para el enrutador.
 *
 * Laya (github.com/NandhaKishorM/laya, Apache-2.0) no escribe texto: recibe un
 * texto y preguntas tipadas (sí/no, elegir una, puntuar) y devuelve
 * probabilidades en una sola pasada. Aquí contesta qué tipo de tarea es, cuánto
 * cuesta, si hay que tocar archivos o mirar imágenes y si hay que pensar con
 * calma; con eso el enrutador elige modelo, esfuerzo y proveedor.
 *
 * Corre en este equipo, con su paquete oficial de Python, en un entorno propio
 * dentro de la carpeta de datos de la app. Lo que se instala está fijado a lo
 * que se revisó:
 *
 *  - el paquete `laya` 0.4.6, comprobando el SHA-256 de su rueda (la publicada
 *    en PyPI desde el flujo de release del repositorio, con procedencia);
 *  - PyTorch sólo para CPU, del índice oficial de PyTorch;
 *  - los pesos del modelo multilingüe (`safetensors`, nada de pickle) en el
 *    commit revisado de Hugging Face. Tras la descarga se carga sin red.
 *
 * No se usa su servidor HTTP (escucha en 0.0.0.0 y sin clave por omisión): el
 * proceso es un hijo que habla JSON por stdin/stdout, sin abrir ningún puerto.
 * Se apaga solo tras un rato sin uso para devolver la memoria.
 */
import { app } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IS_MAC, IS_WIN, findInPath, killTree } from './platform'
import type { LayaEvent, LayaStatus } from '@shared/types'

export const LAYA_VERSION = '0.4.6'
/** SHA-256 de laya-0.4.6-py3-none-any.whl, la rueda revisada. */
const LAYA_WHEEL_SHA256 = '93fab7677aab9cb71cd4f9cb4477e334618f85ccdff684520a5dd144c3316a88'
export const LAYA_REPO = 'convaiinnovations/laya-multilingual'
/** El commit revisado del modelo multilingüe (el mismo que fija `laya.revisions`). */
export const LAYA_REVISION = 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'
/** Lo que pesa la descarga del modelo, para enseñar el avance. */
const WEIGHTS_BYTES = 643_835_514 + 34_363_188
/** Sin peticiones durante este tiempo, el proceso se cierra. */
const IDLE_MS = 10 * 60 * 1000

/* ------------------------------------------------------------------ *
 * Carpetas                                                           *
 * ------------------------------------------------------------------ */

/**
 * En Windows va en una ruta corta de LOCALAPPDATA: pip no sabe instalar
 * PyTorch si la ruta pasa de 260 caracteres (WinError 206), y 1,5 GB de caché
 * no deben viajar con el perfil itinerante. En las pruebas se puede cambiar.
 */
function root(): string {
  const test = process.env['ACC_LAYA_DIR']
  if (test && !app.isPackaged) return test
  if (IS_WIN && process.env['LOCALAPPDATA']) return join(process.env['LOCALAPPDATA'], 'AICommandCenter', 'laya')
  return join(app.getPath('userData'), 'laya')
}
const venvDir = (): string => join(root(), 'venv')
const hfHome = (): string => join(root(), 'hf')
const scriptPath = (): string => join(root(), 'acc_laya.py')
const markerPath = (): string => join(root(), 'instalado.json')
const venvPython = (): string => (IS_WIN ? join(venvDir(), 'Scripts', 'python.exe') : join(venvDir(), 'bin', 'python'))

/* ------------------------------------------------------------------ *
 * El programa de Python                                              *
 * ------------------------------------------------------------------ */

/**
 * Lee una petición JSON por línea y contesta otra. La salida estándar de
 * verdad queda reservada para las respuestas: lo que impriman las librerías
 * va a la de errores, que main sólo guarda para explicar un fallo.
 */
const SCRIPT = String.raw`import json, os, sys, time
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
_out = sys.stdout
sys.stdout = sys.stderr

def reply(obj):
    _out.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _out.flush()

REPO = sys.argv[1]
REVISION = sys.argv[2]
agent = None

def ensure():
    global agent
    if agent is None:
        import laya
        agent = laya.load(REPO, revision=REVISION, device="cpu")
    return agent

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = {}
    try:
        msg = json.loads(line)
        op = msg.get("op")
        if op == "download":
            from huggingface_hub import snapshot_download
            snapshot_download(REPO, revision=REVISION, allow_patterns=["rl_agent_config.json", "model.safetensors", "tokenizer/*", "encoder/*", "config.json"])
            reply({"id": msg.get("id"), "ok": True})
        elif op == "load":
            t = time.perf_counter()
            ensure()
            reply({"id": msg.get("id"), "ok": True, "ms": (time.perf_counter() - t) * 1000})
        elif op == "predict":
            a = ensure()
            t = time.perf_counter()
            r = a.predict(msg["text"], msg["questions"])
            reply({"id": msg.get("id"), "ok": True, "answers": r["answers"], "ms": (time.perf_counter() - t) * 1000})
        else:
            reply({"id": msg.get("id"), "ok": False, "error": "operación desconocida"})
    except Exception as e:
        reply({"id": msg.get("id"), "ok": False, "error": type(e).__name__ + ": " + str(e)[:500]})
`

/* ------------------------------------------------------------------ *
 * Estado                                                             *
 * ------------------------------------------------------------------ */

type Emit = (e: LayaEvent) => void
let emit: Emit = () => {}
export function initLaya(send: Emit): void {
  emit = send
}

let installing: Promise<void> | null = null
let installAbort: (() => void) | null = null
let lastError: string | undefined
interface Proc {
  child: ChildProcess
  pending: Map<number, (r: any) => void>
  buf: string
  err: string
}
let proc: Proc | null = null
let starting: Promise<Proc> | null = null
let seq = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
let loadedMs: number | undefined

function marker(): { version: string; revision: string; python: string; at: number } | null {
  try {
    return JSON.parse(readFileSync(markerPath(), 'utf8'))
  } catch {
    return null
  }
}

function dirSize(dir: string): number {
  let total = 0
  const walk = (d: string): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        try {
          total += statSync(p).size
        } catch {
          /* se fue mientras se miraba */
        }
      }
    }
  }
  walk(dir)
  return total
}

function isReady(): boolean {
  const m = marker()
  return Boolean(m && m.version === LAYA_VERSION && m.revision === LAYA_REVISION && existsSync(venvPython()))
}

/** Lo que ocupa: recorrer 1,5 GB de ficheros cuesta segundos, así que se guarda un rato. */
let sizeCache: { at: number; bytes: number } | null = null
function diskBytes(): number {
  if (!sizeCache || Date.now() - sizeCache.at > 5 * 60 * 1000) sizeCache = { at: Date.now(), bytes: dirSize(root()) }
  return sizeCache.bytes
}

export function layaStatus(): LayaStatus {
  const m = marker()
  const ready = isReady()
  return {
    state: installing ? 'installing' : ready ? 'ready' : 'absent',
    version: LAYA_VERSION,
    repo: LAYA_REPO,
    revision: LAYA_REVISION,
    running: Boolean(proc),
    loadedMs,
    python: m?.python,
    diskBytes: ready && !installing ? diskBytes() : undefined,
    error: lastError
  }
}

/* ------------------------------------------------------------------ *
 * Encontrar Python                                                   *
 * ------------------------------------------------------------------ */

function run(file: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, out, stderr) =>
      resolve({ ok: !err, out: String(out ?? ''), err: String(stderr ?? '') })
    )
  })
}

const PROBE = 'import sys,struct;print(sys.executable);print("%d.%d" % sys.version_info[:2]);print(struct.calcsize("P")*8)'

/**
 * Un Python 3.10 o más nuevo, de 64 bits. En Windows primero el lanzador `py`
 * (el del instalador oficial, firmado) y luego lo que haya en el PATH, sin
 * caer en el atajo de la Tienda que sólo abre la Tienda.
 */
export async function findPython(): Promise<{ path: string; version: string } | { error: string }> {
  const candidates: [string, string[]][] = []
  const own = process.env['ACC_LAYA_PYTHON']
  if (own) candidates.push([own, []])
  if (IS_WIN) {
    const py = findInPath('py')
    if (py) candidates.push([py, ['-3']])
  }
  for (const name of IS_WIN ? ['python', 'python3'] : ['python3', 'python']) {
    const p = findInPath(name)
    if (p && !/WindowsApps/i.test(p)) candidates.push([p, []])
  }
  if (IS_MAC) for (const p of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3']) if (existsSync(p)) candidates.push([p, []])
  const seen: string[] = []
  for (const [file, pre] of candidates) {
    const r = await run(file, [...pre, '-I', '-c', PROBE])
    const [exe, version, bits] = r.out.trim().split(/\r?\n/)
    if (!r.ok || !exe || !version) continue
    const [maj, min] = version.split('.').map(Number)
    seen.push(`${version} (${bits} bits)`)
    if (maj === 3 && min >= 10 && bits === '64') return { path: exe.trim(), version }
  }
  return {
    error: seen.length
      ? `Hace falta Python 3.10 o más nuevo de 64 bits; he encontrado ${seen.join(', ')}.`
      : 'No encuentro Python. Instala Python 3.10 o más nuevo (python.org) y vuelve a intentarlo.'
  }
}

/* ------------------------------------------------------------------ *
 * Instalar                                                           *
 * ------------------------------------------------------------------ */

function step(
  file: string,
  args: string[],
  phase: LayaEvent['phase'],
  detail: string,
  vars?: Record<string, string | number>
): Promise<void> {
  emit({ phase, detail, vars })
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let tail = ''
    const keep = (b: Buffer): void => {
      tail = (tail + b.toString('utf8')).slice(-4000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    installAbort = () => killTree(child)
    child.on('error', (e) => reject(e))
    child.on('close', (code, signal) => {
      installAbort = null
      if (code === 0) return resolve()
      if (signal || code === null) return reject(new Error('cancelado'))
      const last = tail.trim().split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(' · ')
      const what = vars ? detail.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? '')) : detail
      reject(new Error(`${what}: ${last || `salió con código ${code}`}`))
    })
  })
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

async function doInstall(): Promise<void> {
  lastError = undefined
  const py = await findPython()
  if ('error' in py) throw new Error(py.error)
  mkdirSync(root(), { recursive: true })
  rmSync(markerPath(), { force: true })

  if (!existsSync(venvPython())) await step(py.path, ['-m', 'venv', venvDir()], 'venv', 'Creando el entorno con Python {v}', { v: py.version })
  const vpy = venvPython()

  // PyTorch sólo para CPU: unas diez veces menos que el de CUDA y Laya va de sobra.
  const torchIndex = IS_MAC ? [] : ['--index-url', 'https://download.pytorch.org/whl/cpu']
  await step(vpy, ['-m', 'pip', 'install', '--upgrade', 'pip'], 'packages', 'Actualizando pip')
  await step(vpy, ['-m', 'pip', 'install', 'torch>=2.4,<3', ...torchIndex], 'packages', 'Instalando PyTorch (sólo CPU)')

  // La rueda de Laya se baja aparte y se comprueba antes de instalarla.
  const wheels = join(root(), 'ruedas')
  rmSync(wheels, { recursive: true, force: true })
  await step(vpy, ['-m', 'pip', 'download', `laya==${LAYA_VERSION}`, '--no-deps', '--only-binary', ':all:', '-d', wheels], 'packages', 'Descargando laya {v}', { v: LAYA_VERSION })
  const wheel = readdirSync(wheels).find((f) => f.endsWith('.whl'))
  if (!wheel) throw new Error('pip no dejó la rueda de laya')
  const got = sha256(join(wheels, wheel))
  if (got !== LAYA_WHEEL_SHA256) throw new Error(`La rueda de laya no es la revisada (SHA-256 ${got.slice(0, 12)}…): no se instala`)
  await step(
    vpy,
    ['-m', 'pip', 'install', join(wheels, wheel), 'transformers>=5,<6', 'huggingface_hub>=1,<2', 'safetensors>=0.4', 'numpy'],
    'packages',
    'Instalando laya {v} y sus dependencias',
    { v: LAYA_VERSION }
  )
  rmSync(wheels, { recursive: true, force: true })

  writeFileSync(scriptPath(), SCRIPT, 'utf8')
  // Los pesos: se enseña el avance mirando lo que ocupa la caché.
  const base = dirSize(hfHome())
  const timer = setInterval(() => {
    const pct = Math.min(99, Math.round(((dirSize(hfHome()) - base) / WEIGHTS_BYTES) * 100))
    emit({ phase: 'weights', detail: 'Descargando el modelo multilingüe (680 MB)', pct: Math.max(0, pct) })
  }, 1500)
  try {
    stopLaya()
    const p = await ensureProc(false)
    const r = await request(p, { op: 'download' }, 60 * 60 * 1000)
    if (!r.ok) throw new Error(r.error ?? 'no se pudo descargar el modelo')
    emit({ phase: 'load', detail: 'Cargando el modelo por primera vez' })
    stopLaya()
    const q = await ensureProc(true)
    const l = await request(q, { op: 'load' }, 10 * 60 * 1000)
    if (!l.ok) throw new Error(l.error ?? 'no se pudo cargar el modelo')
    loadedMs = l.ms
  } finally {
    clearInterval(timer)
  }
  sizeCache = null
  writeFileSync(markerPath(), JSON.stringify({ version: LAYA_VERSION, revision: LAYA_REVISION, python: py.version, at: Date.now() }), 'utf8')
}

export function installLaya(): Promise<{ ok: boolean; error?: string }> {
  installing ??= doInstall()
    .then(() => emit({ phase: 'done', ok: true }))
    .catch((e: unknown) => {
      lastError = e instanceof Error ? e.message : String(e)
      emit({ phase: 'done', ok: false, error: lastError })
      stopLaya()
    })
    .finally(() => {
      installing = null
    })
  return installing.then(() => (lastError ? { ok: false, error: lastError } : { ok: true }))
}

export function cancelLayaInstall(): boolean {
  if (!installing) return false
  installAbort?.()
  stopLaya()
  return true
}

/** Borra el entorno y los pesos: 1,5 GB que vuelven al disco. */
export function removeLaya(): void {
  cancelLayaInstall()
  stopLaya()
  rmSync(root(), { recursive: true, force: true })
  sizeCache = null
  lastError = undefined
  loadedMs = undefined
}

/* ------------------------------------------------------------------ *
 * El proceso                                                         *
 * ------------------------------------------------------------------ */

function ensureProc(offline = true): Promise<Proc> {
  if (proc) return Promise.resolve(proc)
  starting ??= new Promise<Proc>((resolve, reject) => {
    if (!existsSync(venvPython()) || !existsSync(scriptPath())) {
      reject(new Error('Laya no está instalado'))
      return
    }
    const child = spawn(venvPython(), ['-I', scriptPath(), LAYA_REPO, LAYA_REVISION], {
      windowsHide: true,
      cwd: root(),
      env: {
        ...process.env,
        HF_HOME: hfHome(),
        HF_HUB_DISABLE_TELEMETRY: '1',
        // Ya descargado, se carga sin tocar la red.
        ...(offline ? { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } : {}),
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        TOKENIZERS_PARALLELISM: 'false'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const p: Proc = { child, pending: new Map<number, (r: any) => void>(), buf: '', err: '' }
    child.stdout!.on('data', (b: Buffer) => {
      p.buf += b.toString('utf8')
      let i: number
      while ((i = p.buf.indexOf('\n')) >= 0) {
        const line = p.buf.slice(0, i).trim()
        p.buf = p.buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          const cb = p.pending.get(msg.id)
          if (cb) {
            p.pending.delete(msg.id)
            cb(msg)
          }
        } catch {
          /* una línea que no es nuestra */
        }
      }
    })
    child.stderr!.on('data', (b: Buffer) => {
      p.err = (p.err + b.toString('utf8')).slice(-4000)
    })
    child.on('error', (e) => {
      if (proc === p) proc = null
      reject(e)
    })
    child.on('close', (code) => {
      if (proc === p) proc = null
      const why = p.err.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' · ') || `Laya se cerró (código ${code})`
      for (const cb of p.pending.values()) cb({ ok: false, error: why })
      p.pending.clear()
    })
    proc = p
    resolve(p)
  }).finally(() => {
    starting = null
  })
  return starting
}

function request(p: Proc, msg: Record<string, unknown>, timeout: number): Promise<any> {
  return new Promise((resolve) => {
    const id = ++seq
    const timer = setTimeout(() => {
      p.pending.delete(id)
      resolve({ ok: false, error: 'Laya tardó demasiado en contestar' })
    }, timeout)
    p.pending.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    p.child.stdin!.write(JSON.stringify({ ...msg, id }) + '\n')
  })
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => stopLaya(), IDLE_MS)
  idleTimer.unref?.()
}

export function stopLaya(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const p = proc
  proc = null
  if (p) {
    try {
      p.child.stdin?.end()
    } catch {
      /* ya cerrado */
    }
    killTree(p.child)
  }
}

export type LayaQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

/** Pregunta a Laya. Arranca el proceso si hace falta (la primera vez tarda unos segundos). */
export async function layaPredict(
  text: string,
  questions: Record<string, LayaQuestion>
): Promise<{ answers: Record<string, any>; ms: number }> {
  if (installing) throw new Error('Laya se está instalando')
  if (!isReady()) throw new Error('Laya no está instalado')
  const p = await ensureProc(true)
  touch()
  const r = await request(p, { op: 'predict', text: text.slice(0, 6000), questions }, 120_000)
  touch()
  if (!r.ok) throw new Error(r.error ?? 'Laya no contestó')
  return { answers: r.answers, ms: r.ms }
}

/**
 * Arranca el proceso y carga el modelo sin preguntar nada: lo llama la
 * interfaz al abrir el enrutador, para que la primera consulta no espere los
 * diez o quince segundos de la carga.
 */
export async function warmLaya(): Promise<boolean> {
  if (installing || !isReady()) return false
  const p = await ensureProc(true)
  touch()
  const r = await request(p, { op: 'load' }, 5 * 60 * 1000)
  if (r.ok && r.ms > 50) loadedMs = r.ms
  return Boolean(r.ok)
}
