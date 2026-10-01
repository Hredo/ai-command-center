/**
 * Cuentas: el estado de cada sesión (GitHub, Claude Code, Codex, Gemini CLI,
 * OpenCode) y los inicios de sesión que se lanzan desde la app.
 *
 * Vive fuera de los componentes porque lo comparten Ajustes, el panel de
 * GitHub de Proyectos y el diálogo del código de GitHub, y porque un inicio
 * de sesión sigue en marcha aunque cambies de sección.
 */
import { useSyncExternalStore } from 'react'
import { openTerm, sendTermCommand } from './engine'
import { navigate } from './nav'
import type { AccountStatus } from '@shared/types'

export interface GithubFlow {
  phase: 'starting' | 'code' | 'error'
  code?: string
  url?: string
  error?: string
}

interface State {
  list: AccountStatus[] | null
  loading: boolean
  github: GithubFlow | null
  /** OpenRouter: esperando a que autorices en el navegador. */
  openrouter: { url?: string } | null
  /** Cuántas veces ha cambiado una sesión: quien dependa de ellas, recarga. */
  signedInTick: number
  /** Lo último que pasó, para avisarlo una vez. */
  notice: { n: number; name: string; signedIn: boolean } | null
}

let state: State = { list: null, loading: false, github: null, openrouter: null, signedInTick: 0, notice: null }
const changed = (name: string, signedIn: boolean): Partial<State> => ({
  signedInTick: state.signedInTick + 1,
  notice: { n: state.signedInTick + 1, name, signedIn }
})
const listeners = new Set<() => void>()
const set = (patch: Partial<State>): void => {
  state = { ...state, ...patch }
  for (const l of [...listeners]) l()
}
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  wire()
  return () => {
    listeners.delete(cb)
  }
}

export function useAccounts(): State {
  return useSyncExternalStore(subscribe, () => state)
}

let inflight: Promise<void> | null = null
export function refreshAccounts(): Promise<void> {
  inflight ??= (async () => {
    set({ loading: true })
    const r = await window.api.accounts.status()
    set({ loading: false, ...(r.ok && r.data ? { list: r.data } : {}) })
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/**
 * Tras lanzar un inicio de sesión en una terminal se pregunta a menudo, para
 * que la fila cambie sola en cuanto termines: no hay un «ya entré» que pulsar.
 */
let fastUntil = 0
let fastTimer: ReturnType<typeof setInterval> | null = null
export function watchAccounts(id?: string, ms = 5 * 60 * 1000): void {
  const before = id ? state.list?.find((a) => a.id === id)?.signedIn : undefined
  fastUntil = Date.now() + ms
  if (fastTimer) return
  fastTimer = setInterval(() => {
    void refreshAccounts().then(() => {
      const account = id ? state.list?.find((a) => a.id === id) : undefined
      const moved = account != null && account.signedIn !== before && account.signedIn !== null
      if (moved) set(changed(account.name, Boolean(account.signedIn)))
      if (moved || Date.now() > fastUntil) {
        if (fastTimer) clearInterval(fastTimer)
        fastTimer = null
      }
    })
  }, 2500)
}

let wired = false
function wire(): void {
  if (wired) return
  wired = true
  window.api.accounts.onEvent((e) => {
    if (e.id === 'github') {
      if (e.phase === 'code') set({ github: { phase: 'code', code: e.code, url: e.url } })
      else if (e.phase === 'done') {
        if (e.ok) {
          set({ github: null, ...changed('GitHub', true) })
          void window.api.github.refresh().then(() => refreshAccounts())
        } else if (state.github) {
          // Cerrar el diálogo lo cancela: eso no es un error que enseñar.
          set({ github: e.error === 'cancelado' ? null : { phase: 'error', error: e.error } })
        }
      }
    } else if (e.id === 'openrouter') {
      if (e.phase === 'browser') set({ openrouter: { url: e.url } })
      else if (e.phase === 'done') set({ openrouter: null })
    }
  })
}

/** GitHub: pide el código a gh y abre el diálogo que lo enseña. */
export async function startGithubLogin(): Promise<void> {
  wire()
  set({ github: { phase: 'starting' } })
  const r = await window.api.accounts.githubLogin()
  if (!r.ok || !r.data?.ok) set({ github: { phase: 'error', error: r.data?.error ?? r.error ?? 'no se pudo lanzar gh' } })
}

export function cancelGithubLogin(): void {
  set({ github: null })
  void window.api.accounts.githubCancel()
}

/** OpenRouter: abre el navegador y espera. Devuelve cómo acabó. */
export async function startOpenRouterLogin(): Promise<{ ok: boolean; error?: string }> {
  wire()
  set({ openrouter: {} })
  const r = await window.api.accounts.openrouterLogin()
  set({ openrouter: null })
  return r.ok && r.data ? r.data : { ok: false, error: r.error }
}

export function cancelOpenRouterLogin(): void {
  void window.api.accounts.openrouterCancel()
}

/**
 * Lanza un comando de cuenta (entrar, salir, instalar) en una terminal de la
 * app y te lleva a ella: es el comando oficial de la herramienta, a la vista.
 */
export async function runAccountCommand(account: AccountStatus, command: string): Promise<string | null> {
  const { id, error } = await openTerm({ title: account.name })
  if (!id) return error ?? 'no se pudo abrir una terminal'
  sendTermCommand(id, command)
  navigate({ page: 'terminal', termId: id })
  watchAccounts(account.id)
  return null
}
