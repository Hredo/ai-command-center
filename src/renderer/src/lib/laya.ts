/**
 * Laya en la interfaz: si está instalado y cómo va la instalación.
 *
 * Vive fuera de los componentes porque la instalación (PyTorch y 680 MB de
 * modelo) tarda minutos y sigue aunque cambies de sección; el enrutador, el
 * recomendador y Ajustes leen lo mismo.
 */
import { useSyncExternalStore } from 'react'
import type { LayaEvent, LayaStatus } from '@shared/types'

interface State {
  status: LayaStatus | null
  progress: LayaEvent | null
}

let state: State = { status: null, progress: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>): void => {
  state = { ...state, ...patch }
  for (const l of [...listeners]) l()
}

let wired = false
function wire(): void {
  if (wired) return
  wired = true
  window.api.laya.onEvent((e) => {
    if (e.phase === 'done') {
      set({ progress: e.ok ? null : e })
      void refreshLaya()
    } else {
      // El estado se pidió antes de que arrancara: cualquier avance dice que ya está en marcha.
      const status = state.status && state.status.state !== 'installing' ? { ...state.status, state: 'installing' as const, error: undefined } : state.status
      set({ progress: e, status })
    }
  })
  void refreshLaya()
}

export function refreshLaya(): Promise<void> {
  return window.api.laya.status().then((r) => {
    if (r.ok && r.data) set({ status: r.data })
  })
}

export function useLaya(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      wire()
      return () => {
        listeners.delete(cb)
      }
    },
    () => state
  )
}

export async function installLaya(): Promise<{ ok: boolean; error?: string }> {
  wire()
  set({
    progress: { phase: 'venv', detail: 'Buscando Python' },
    status: state.status ? { ...state.status, state: 'installing', error: undefined } : state.status
  })
  const r = await window.api.laya.install()
  void refreshLaya()
  return r.ok && r.data ? r.data : { ok: false, error: r.error }
}

export function cancelLayaInstall(): void {
  void window.api.laya.cancel()
}

export async function removeLaya(): Promise<void> {
  const r = await window.api.laya.remove()
  if (r.ok && r.data) set({ status: r.data, progress: null })
}
