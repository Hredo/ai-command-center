import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { AppConfig, ProviderStatus, ModelInfo, ProviderDef } from '@shared/types'

export interface Toast {
  id: string
  kind: 'ok' | 'error' | 'info'
  text: string
}

interface Store {
  config: AppConfig | null
  defs: ProviderDef[]
  status: ProviderStatus[]
  models: ModelInfo[]
  modelsLoading: boolean
  info: any
  reload: () => Promise<void>
  reloadStatus: () => Promise<void>
  reloadModels: () => Promise<void>
  toast: (kind: Toast['kind'], text: string) => void
  toasts: Toast[]
  dismiss: (id: string) => void
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore fuera del proveedor')
  return s
}

export function StoreProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [defs, setDefs] = useState<ProviderDef[]>([])
  const [status, setStatus] = useState<ProviderStatus[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [info, setInfo] = useState<any>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, number>>({})

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = crypto.randomUUID()
    setToasts((t) => [...t, { id, kind, text }])
    timers.current[id] = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      delete timers.current[id]
    }, kind === 'error' ? 7000 : 3800)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const reload = useCallback(async () => {
    const [c, d, i] = await Promise.all([
      window.api.config.get(),
      window.api.providers.defs(),
      window.api.app.info()
    ])
    if (c.ok && c.data) setConfig(c.data)
    if (d.ok && d.data) setDefs(d.data)
    if (i.ok && i.data) setInfo(i.data)
  }, [])

  const reloadStatus = useCallback(async () => {
    const s = await window.api.providers.status(true)
    if (s.ok && s.data) setStatus(s.data)
  }, [])

  const reloadModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const r = await window.api.models.available()
      if (r.ok && r.data) {
        const clean = r.data.filter((m: any) => !m.__error) as ModelInfo[]
        const errors = r.data.filter((m: any) => m.__error)
        setModels(clean)
        for (const e of errors) {
          console.warn(`Modelos de ${e.providerId}: ${e.message}`)
        }
      }
    } finally {
      setModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await reload()
      await reloadStatus()
      await reloadModels()
    })()

    const offCatalog = window.api.app.onCatalogUpdated((r) => {
      if (r?.count) toast('info', `Catálogo actualizado: ${r.count} modelos`)
    })

    // El proceso principal vigila los puertos de los motores locales. Cuando
    // uno aparece o desaparece se recarga el estado y la lista de modelos:
    // arrancar Ollama con la app abierta se nota sin tocar nada.
    const offLocal = window.api.app.onLocalChanged((servers) => {
      const up = servers.filter((s) => s.up)
      void reloadStatus()
      void reloadModels()
      if (up.length) {
        const names = up.map((s) => `${s.name} (${s.models.length} modelos)`).join(', ')
        toast('ok', `Motor local detectado: ${names}`)
      }
    })

    // La configuración también cambia por detrás —la detección de CLIs, otra
    // parte de la app que guarda—: se relee en cuanto el proceso principal avisa.
    const offLive = window.api.live.onChanged((e) => {
      if (e.topics.includes('config')) void reload()
    })

    return () => {
      offCatalog()
      offLocal()
      offLive()
    }
  }, [reload, reloadStatus, reloadModels, toast])

  return (
    <Ctx.Provider
      value={{
        config, defs, status, models, modelsLoading, info,
        reload, reloadStatus, reloadModels, toast, toasts, dismiss
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
