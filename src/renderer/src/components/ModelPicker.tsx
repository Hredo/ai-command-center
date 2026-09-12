import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, Cpu, Cloud, Check } from 'lucide-react'
import { useStore } from '../lib/store'
import { cx, Badge } from './ui'
import { price, tokens, shortModel } from '../lib/format'
import type { ModelInfo } from '@shared/types'

import { useT } from '../lib/i18n'
export interface Pick {
  providerId: string
  model: string
}

/**
 * Selector de modelo con buscador. Lista sólo modelos utilizables ahora mismo
 * (proveedor con key o motor local encendido).
 */
export function ModelPicker({
  value,
  onChange,
  className,
  placeholder = 'Elegir modelo',
  compact,
  exclude
}: {
  value?: Pick | null
  onChange: (p: Pick) => void
  className?: string
  placeholder?: string
  compact?: boolean
  exclude?: string[]
}): React.JSX.Element {
  const t = useT()
  const { models, defs, modelsLoading } = useStore()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    setTimeout(() => inputRef.current?.focus(), 20)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const providerName = (id: string): string => defs.find((d) => d.id === id)?.name ?? id
  const isLocal = (id: string): boolean => defs.find((d) => d.id === id)?.local ?? false

  const groups = useMemo(() => {
    const key = q.trim().toLowerCase()
    const filtered = models.filter((m) => {
      if (exclude?.includes(`${m.providerId}:${m.id}`)) return false
      if (!key) return true
      return (
        m.id.toLowerCase().includes(key) ||
        m.name.toLowerCase().includes(key) ||
        providerName(m.providerId).toLowerCase().includes(key)
      )
    })
    const map = new Map<string, ModelInfo[]>()
    for (const m of filtered) {
      if (!map.has(m.providerId)) map.set(m.providerId, [])
      map.get(m.providerId)!.push(m)
    }
    // Los motores locales primero: son los que el usuario tiene delante.
    return [...map.entries()].sort((a, b) => {
      const la = isLocal(a[0]) ? 0 : 1
      const lb = isLocal(b[0]) ? 0 : 1
      return la - lb || a[0].localeCompare(b[0])
    })
  }, [models, q, exclude, defs])

  const current = value ? models.find((m) => m.providerId === value.providerId && m.id === value.model) : null

  return (
    <div className={cx('relative', className)} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'w-full flex items-center gap-2 bg-void border border-line rounded-lg px-2.5 transition-colors',
          'hover:border-[#2c3245] text-left',
          compact ? 'h-8 text-[12.5px]' : 'h-9'
        )}
      >
        {value ? (
          isLocal(value.providerId) ? (
            <Cpu size={13} className="text-ok shrink-0" />
          ) : (
            <Cloud size={13} className="text-accent shrink-0" />
          )
        ) : (
          <Search size={13} className="text-dim shrink-0" />
        )}
        <span className={cx('truncate flex-1', !value && 'text-dim')}>
          {value ? shortModel(value.model) : placeholder}
        </span>
        {current?.priceOut != null && !isLocal(value!.providerId) ? (
          <span className="num text-[11px] text-dim shrink-0">{price(current.priceOut)}/M</span>
        ) : null}
        <ChevronDown size={14} className="text-dim shrink-0" />
      </button>

      {open ? (
        <div className="absolute z-40 mt-1.5 w-full min-w-[340px] bg-panel border border-line rounded-xl shadow-2xl overflow-hidden fade-up">
          <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
            <Search size={14} className="text-dim shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('Buscar modelo o proveedor…')}
              className="bg-transparent outline-none flex-1 placeholder:text-dim text-[12.5px]"
            />
            <span className="num text-[11px] text-dim">{models.length}</span>
          </div>

          <div className="max-h-[380px] overflow-y-auto py-1">
            {modelsLoading ? (
              <div className="px-3 py-6 text-center text-dim text-[12.5px]">{t('Consultando proveedores…')}</div>
            ) : groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-dim text-[12.5px] leading-relaxed">
                {models.length === 0
                  ? t('Ningún proveedor activo todavía. Añade una API key en Ajustes o arranca Ollama.')
                  : t('Sin resultados.')}
              </div>
            ) : (
              groups.map(([pid, list]) => (
                <div key={pid}>
                  <div className="px-3 py-1.5 flex items-center gap-1.5 sticky top-0 bg-panel z-10">
                    {isLocal(pid) ? <Cpu size={11} className="text-ok" /> : <Cloud size={11} className="text-dim" />}
                    <span className="text-[10.5px] uppercase tracking-wider text-dim font-medium">
                      {providerName(pid)}
                    </span>
                    <span className="num text-[10.5px] text-[#3a4255]">{list.length}</span>
                  </div>
                  {list.map((m) => {
                    const sel = value?.providerId === m.providerId && value?.model === m.id
                    return (
                      <button
                        key={pid + m.id}
                        onClick={() => {
                          onChange({ providerId: m.providerId, model: m.id })
                          setOpen(false)
                          setQ('')
                        }}
                        className={cx(
                          'w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors',
                          sel ? 'bg-[#0d2b33]' : 'hover:bg-hover'
                        )}
                      >
                        <span className="w-3.5 shrink-0">
                          {sel ? <Check size={13} className="text-accent" /> : null}
                        </span>
                        <span className="flex-1 truncate text-[12.5px]">{m.id}</span>
                        {m.contextLength ? (
                          <span className="num text-[10.5px] text-[#4a5266] shrink-0">
                            {tokens(m.contextLength)}
                          </span>
                        ) : null}
                        {isLocal(pid) ? (
                          <Badge tone="ok">local</Badge>
                        ) : m.priceOut != null ? (
                          <span className="num text-[10.5px] text-dim shrink-0 w-14 text-right">
                            {price(m.priceOut)}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
