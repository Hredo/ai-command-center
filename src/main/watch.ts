/**
 * Vigilante del repositorio y de la carpeta del proyecto.
 *
 * La interfaz no debería tener que pulsar «releer» para enterarse de que
 * acabas de cometer: aquí se mira la carpeta y, cuando algo se mueve, se
 * recalcula el estado y se manda a la ventana.
 *
 * Dos fuentes, porque ninguna es fiable sola: `fs.watch` avisa al instante
 * pero se pierde cosas (un `git commit` que escribe en varias rutas, una
 * unidad de red, un editor que guarda con fichero temporal), y un repaso cada
 * pocos segundos tapa esos huecos sin gastar nada apreciable. Sólo se manda
 * un evento cuando el estado ha cambiado de verdad, así que un repaso que no
 * encuentra nada no repinta nada.
 */
import { watch, type FSWatcher } from 'node:fs'
import { gitInfo, changedFiles, gitState } from './git'
import type { GitWatchEvent } from '@shared/types'

/** Ruido que no cambia el estado de git y sí dispara miles de eventos. */
const IGNORED = [
  '.git/objects', '.git\\objects', '.git/lfs', '.git\\lfs',
  'node_modules', '.next', '.nuxt', '.turbo', '.cache', '__pycache__', '.venv',
  'target/debug', 'target\\debug'
]

/** Cada cuánto se repasa por si `fs.watch` se dejó algo. */
const POLL_MS = 4000
/** Espera tras el último aviso: un commit toca muchas rutas seguidas. */
const DEBOUNCE_MS = 250
/** Suelo entre dos lecturas, para que un `pnpm install` no nos tenga leyendo. */
const MIN_GAP_MS = 700

interface Sub {
  count: number
  watchers: FSWatcher[]
  debounce?: NodeJS.Timeout
  poll?: NodeJS.Timeout
  /** Huella del último estado enviado: si no cambia, no se manda nada. */
  fingerprint: string
  reading: boolean
  again: boolean
  lastReadAt: number
}

const subs = new Map<string, Sub>()
let sendEvent: (e: GitWatchEvent) => void = () => {}

export function initWatch(send: (e: GitWatchEvent) => void): void {
  sendEvent = send
}

function noisy(file: string | null): boolean {
  if (!file) return false
  return IGNORED.some((frag) => file.includes(frag))
}

async function read(path: string, force = false): Promise<void> {
  const sub = subs.get(path)
  if (!sub) return

  // Una lectura cada vez: si llegan avisos mientras se lee, se hace otra al
  // terminar en vez de encolar veinte.
  if (sub.reading) {
    sub.again = true
    return
  }
  sub.reading = true
  try {
    const [info, changes, state] = await Promise.all([gitInfo(path), changedFiles(path), gitState(path)])
    sub.lastReadAt = Date.now()

    const fingerprint = JSON.stringify([
      info.branch, info.head, info.ahead, info.behind, info.upstream, info.detached,
      info.dirty, info.staged, info.untracked, info.lastCommit?.hash,
      info.localBranches, info.remoteBranches,
      changes.map((c) => `${c.status}${c.path}${c.added}/${c.removed}`),
      state.operation, state.conflicts, state.stashes, state.step
    ])

    if (!force && fingerprint === sub.fingerprint) return
    sub.fingerprint = fingerprint
    sendEvent({ path, info, changes, state, at: Date.now() })
  } catch (err) {
    console.error('[watch] no se pudo leer el estado de', path, err)
  } finally {
    sub.reading = false
    if (sub.again) {
      sub.again = false
      setTimeout(() => void read(path), MIN_GAP_MS)
    }
  }
}

function schedule(path: string): void {
  const sub = subs.get(path)
  if (!sub) return
  if (sub.debounce) clearTimeout(sub.debounce)
  const since = Date.now() - sub.lastReadAt
  const wait = since < MIN_GAP_MS ? MIN_GAP_MS - since + DEBOUNCE_MS : DEBOUNCE_MS
  sub.debounce = setTimeout(() => {
    sub.debounce = undefined
    void read(path)
  }, wait)
}

/**
 * Empieza a vigilar una carpeta. Se cuenta cuántas partes de la interfaz la
 * están mirando: la última que se va apaga el vigilante.
 */
export function watchRepo(path: string): boolean {
  if (!path) return false
  const existing = subs.get(path)
  if (existing) {
    existing.count++
    // El que acaba de llegar necesita el estado aunque no haya cambiado nada.
    void read(path, true)
    return true
  }

  const sub: Sub = { count: 1, watchers: [], fingerprint: '', reading: false, again: false, lastReadAt: 0 }
  subs.set(path, sub)

  try {
    // Recursivo: en Windows y macOS es un solo manejador del sistema, así que
    // sale más barato que plantar un vigilante por carpeta.
    sub.watchers.push(
      watch(path, { recursive: true, persistent: false }, (_type, file) => {
        if (noisy(typeof file === 'string' ? file : null)) return
        schedule(path)
      })
    )
  } catch (err) {
    console.error('[watch] sin vigilancia de ficheros en', path, '— queda el repaso periódico:', err)
  }

  sub.poll = setInterval(() => {
    if (Date.now() - sub.lastReadAt >= POLL_MS - 200) void read(path)
  }, POLL_MS)
  if (typeof sub.poll.unref === 'function') sub.poll.unref()

  void read(path, true)
  return true
}

export function unwatchRepo(path: string): boolean {
  const sub = subs.get(path)
  if (!sub) return false
  sub.count--
  if (sub.count > 0) return true

  if (sub.debounce) clearTimeout(sub.debounce)
  if (sub.poll) clearInterval(sub.poll)
  for (const w of sub.watchers) {
    try {
      w.close()
    } catch {
      /* ya estaba cerrado */
    }
  }
  subs.delete(path)
  return true
}

/** Fuerza una lectura: la usan las acciones que ya saben que han cambiado algo. */
export function pokeRepo(path: string): void {
  if (subs.has(path)) void read(path, true)
}

export function stopAllWatches(): void {
  for (const path of [...subs.keys()]) {
    const sub = subs.get(path)
    if (sub) sub.count = 1
    unwatchRepo(path)
  }
}
