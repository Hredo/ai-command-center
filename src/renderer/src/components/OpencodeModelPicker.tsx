/**
 * Modelo de OpenCode en dos pasos: proveedor (Zen u Ollama) y modelo.
 *
 * La lista la da el proceso principal (opencode.ts): la de Zen sale del propio
 * OpenCode y la de Ollama sólo aparece con Ollama encendido. Al lanzar con un
 * modelo local la app enciende Ollama si hace falta y le pide la ventana entera
 * del modelo.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Power, RefreshCw } from 'lucide-react'
import { Select, cx } from './ui'
import { useT } from '../lib/i18n'
import type { OpencodeModel } from '@shared/types'

type Translate = ReturnType<typeof useT>
type Provider = OpencodeModel['provider']

/** Lo último que se supo, para que al volver a la pantalla no salga vacía. */
let last: OpencodeModel[] = []

export function isOpencodeCommand(command: string): boolean {
  return /(^|[\\/])opencode(\.(cmd|exe))?$/i.test(command.trim())
}

export function useOpencodeModels(enabled: boolean): {
  models: OpencodeModel[]
  loading: boolean
  refresh: () => void
} {
  const [models, setModels] = useState<OpencodeModel[]>(last)
  const [loading, setLoading] = useState(false)

  const fetchModels = useCallback((forceZen: boolean) => {
    setLoading(true)
    void window.api.cli
      .opencodeModels(forceZen)
      .then((r) => {
        if (r.ok && r.data) {
          last = r.data
          setModels(r.data)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!enabled) return
    fetchModels(false)
    // Encender o apagar Ollama cambia la lista de locales: se vuelve a pedir sola.
    return window.api.app.onLocalChanged(() => fetchModels(false))
  }, [enabled, fetchModels])

  return { models, loading, refresh: () => fetchModels(true) }
}

export function opencodeEffortHint(model: string | undefined, variants: string[], t: Translate): string {
  if (!model) return t('Elige un modelo para ver sus niveles de esfuerzo')
  if (!variants.length) return t('Este modelo no tiene niveles de esfuerzo')
  const levels = t('Niveles de este modelo: {list}', { list: variants.join(', ') })
  // Comprobado con qwen3:8b: sin razonar repetía pasos o editaba el archivo que no era.
  return model.startsWith('ollama/') && variants.includes('none')
    ? `${levels}. ${t('En un modelo local, «Mínimo» no razona: va más rápido pero se equivoca más con las herramientas.')}`
    : levels
}

function label(m: OpencodeModel, t: Translate): string {
  const extra = [
    m.free && m.provider === 'opencode' ? t('gratis') : null,
    m.context ? `${Math.round(m.context / 1000)}k` : null
  ]
  return [m.name, ...extra.filter(Boolean)].join(' · ')
}

export function OpencodeModelPicker({
  value,
  onChange,
  models,
  loading,
  onRefresh,
  compact
}: {
  value?: string
  onChange: (id: string | undefined) => void
  models: OpencodeModel[]
  loading: boolean
  onRefresh: () => void
  /** En línea y pequeño, como los demás mandos de la pestaña Agente. */
  compact?: boolean
}): React.JSX.Element {
  const t = useT()
  const [provider, setProvider] = useState<Provider>(value?.startsWith('ollama/') ? 'ollama' : 'opencode')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (value) setProvider(value.startsWith('ollama/') ? 'ollama' : 'opencode')
  }, [value])

  const list = models.filter((m) => m.provider === provider)
  const known = !value || list.some((m) => m.id === value)
  const small = 'bg-raised border border-line rounded-md px-1.5 py-1 text-[11px] outline-none'

  const changeProvider = (p: Provider): void => {
    setProvider(p)
    onChange(undefined)
  }

  const startOllama = async (): Promise<void> => {
    setStarting(true)
    await window.api.ollama.start()
    setStarting(false)
    onRefresh()
  }

  const providerOptions = (
    <>
      <option value="opencode">OpenCode Zen</option>
      <option value="ollama">{t('Ollama (local)')}</option>
    </>
  )
  const modelOptions = (
    <>
      <option value="">{provider === 'opencode' ? t('El que use por omisión') : t('Elegir modelo…')}</option>
      {/* Mientras llega la lista, lo elegido se sigue viendo. */}
      {!known && value ? <option value={value}>{value.slice(value.indexOf('/') + 1)}</option> : null}
      {list.map((m) => (
        <option key={m.id} value={m.id}>
          {label(m, t)}
        </option>
      ))}
    </>
  )
  const refresh = (
    <button
      type="button"
      onClick={onRefresh}
      title={t('Volver a leer la lista de modelos')}
      className="text-dim hover:text-ink shrink-0"
    >
      <RefreshCw size={12} className={cx(loading && 'animate-spin')} />
    </button>
  )
  const localHint =
    provider === 'ollama' && !list.length && !loading ? (
      <span className="flex items-center gap-1.5 text-[11px] text-warn flex-wrap">
        {t('Ollama está apagado o no tiene modelos que sepan usar herramientas.')}
        <button
          type="button"
          onClick={() => void startOllama()}
          disabled={starting}
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          <Power size={11} /> {starting ? t('encendiendo…') : t('Encender Ollama')}
        </button>
      </span>
    ) : null

  if (compact) {
    return (
      <>
        <select value={provider} onChange={(e) => changeProvider(e.target.value as Provider)} className={small}>
          {providerOptions}
        </select>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={cx(small, 'max-w-[260px]')}
        >
          {modelOptions}
        </select>
        {refresh}
        {localHint}
      </>
    )
  }

  return (
    <div className="space-y-2">
      <Select value={provider} onChange={(e) => changeProvider(e.target.value as Provider)}>
        {providerOptions}
      </Select>
      <div className="flex items-center gap-2">
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          {modelOptions}
        </Select>
        {refresh}
      </div>
      {localHint}
    </div>
  )
}
