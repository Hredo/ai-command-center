/**
 * Lo último que se sabe de las versiones publicadas, compartido por la barra
 * de arriba, el aviso y Ajustes. Lo manda el proceso principal al mirar (solo,
 * cada seis horas, o a mano).
 */
import { useSyncExternalStore } from 'react'
import type { UpdateInfo } from '@shared/types'

let current: UpdateInfo | null = null
const listeners = new Set<() => void>()
let wired = false

function set(u: UpdateInfo | null): void {
  current = u
  for (const l of [...listeners]) l()
}

function wire(): void {
  if (wired || typeof window === 'undefined' || !window.api?.updates) return
  wired = true
  void window.api.updates.get().then((r) => {
    if (r.ok && r.data) set(r.data)
  })
  window.api.updates.onStatus((u) => set(u))
}

export function useUpdate(): UpdateInfo | null {
  wire()
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => current,
    () => current
  )
}

/** Hay una más nueva y no pediste saltártela. */
export function updateAvailable(u: UpdateInfo | null): boolean {
  return Boolean(u?.newer && !u.skipped && u.latest)
}

export async function checkUpdateNow(): Promise<UpdateInfo | null> {
  const r = await window.api.updates.check()
  if (r.ok && r.data) set(r.data)
  return r.ok && r.data ? r.data : null
}

export async function skipUpdate(version: string | null): Promise<void> {
  const r = await window.api.updates.skip(version)
  if (r.ok && r.data) set(r.data)
}
