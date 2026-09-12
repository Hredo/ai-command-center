import React, { useEffect, useMemo, useState } from 'react'
import {
  Boxes, Search, RefreshCw, Cpu, Cloud, ArrowUpDown, Database, Filter, ExternalLink,
  Download, Copy, Check, AlertCircle
} from 'lucide-react'
import { Panel, Button, Badge, Empty, Input, Select, Tabs, cx, Spinner, Modal } from '../components/ui'
import { useStore } from '../lib/store'
import { price, tokens, relTime, bytes } from '../lib/format'
import type { ModelInfo, ModelLinks } from '@shared/types'

import { useT } from '../lib/i18n'
type SortKey = 'name' | 'priceIn' | 'priceOut' | 'context'

export default function Models(): React.JSX.Element {
  const t = useT()
  const { models, modelsLoading, reloadModels, defs, toast } = useStore()
  const [tab, setTab] = useState<'available' | 'catalog'>('available')
  const [q, setQ] = useState('')
  const [catalog, setCatalog] = useState<ModelInfo[]>([])
  const [meta, setMeta] = useState<{ fetchedAt: number; count: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const [asc, setAsc] = useState(true)
  const [providerFilter, setProviderFilter] = useState('')
  const [onlyFree, setOnlyFree] = useState(false)
  const [detail, setDetail] = useState<ModelInfo | null>(null)
  const [links, setLinks] = useState<ModelLinks | null>(null)
  const [linksLoading, setLinksLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  /** Abre la ficha del modelo y pide sus enlaces al proceso principal. */
  const openDetail = async (m: ModelInfo): Promise<void> => {
    setDetail(m)
    setLinks(null)
    setLinksLoading(true)
    const r = await window.api.models.links(m.providerId, m.id)
    setLinksLoading(false)
    if (r.ok && r.data) setLinks(r.data)
  }

  const go = (url: string): void => {
    void window.api.app.openExternal(url)
  }

  const loadCatalog = async (query: string): Promise<void> => {
    setLoading(true)
    const [r, m] = await Promise.all([window.api.models.catalog(query, 800), window.api.models.catalogMeta()])
    setLoading(false)
    if (r.ok && r.data) setCatalog(r.data)
    if (m.ok && m.data) setMeta(m.data)
  }

  useEffect(() => {
    if (tab === 'catalog') void loadCatalog(q)
  }, [tab])

  useEffect(() => {
    if (tab !== 'catalog') return
    const t = setTimeout(() => void loadCatalog(q), 220)
    return () => clearTimeout(t)
  }, [q, tab])

  const refresh = async (): Promise<void> => {
    setLoading(true)
    const r = await window.api.models.refresh()
    setLoading(false)
    if (r.ok && r.data) {
      toast(
        r.data.errors.length ? 'info' : 'ok',
        `${r.data.count} modelos desde ${r.data.sources.join(', ')}` +
          (r.data.errors.length ? ` · fallos: ${r.data.errors.join(' | ')}` : '')
      )
      await loadCatalog(q)
    } else {
      toast('error', r.error ?? t('No se pudo actualizar el catálogo'))
    }
  }

  const providerName = (id: string): string => defs.find((d) => d.id === id)?.name ?? id
  const isLocal = (id: string): boolean => defs.find((d) => d.id === id)?.local ?? false

  const rows = useMemo(() => {
    const src = tab === 'available' ? models : catalog
    const key = q.trim().toLowerCase()
    let out = src.filter((m) => {
      if (providerFilter && m.providerId !== providerFilter) return false
      if (onlyFree && !(m.priceIn === 0 && m.priceOut === 0)) return false
      if (tab === 'catalog') return true // el filtrado por texto lo hace el backend
      if (!key) return true
      return m.id.toLowerCase().includes(key) || m.name.toLowerCase().includes(key)
    })
    const dir = asc ? 1 : -1
    out = [...out].sort((a, b) => {
      if (sort === 'name') return dir * (a.providerId + a.id).localeCompare(b.providerId + b.id)
      if (sort === 'context') return dir * ((a.contextLength ?? 0) - (b.contextLength ?? 0))
      const av = (sort === 'priceIn' ? a.priceIn : a.priceOut) ?? 0
      const bv = (sort === 'priceIn' ? b.priceIn : b.priceOut) ?? 0
      return dir * (av - bv)
    })
    return out
  }, [tab, models, catalog, q, sort, asc, providerFilter, onlyFree])

  const providersInView = useMemo(() => {
    const src = tab === 'available' ? models : catalog
    return [...new Set(src.map((m) => m.providerId))].sort()
  }, [tab, models, catalog])

  const th = (label: string, key: SortKey, extra?: string): React.JSX.Element => (
    <th className={cx('font-medium py-2', extra)}>
      <button
        onClick={() => {
          if (sort === key) setAsc((a) => !a)
          else {
            setSort(key)
            setAsc(key === 'name')
          }
        }}
        className={cx('inline-flex items-center gap-1 hover:text-ink transition-colors', sort === key && 'text-accent')}
      >
        {label}
        <ArrowUpDown size={10} />
      </button>
    </th>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 shrink-0">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight">{t('Modelos')}</h1>
            <p className="text-[12.5px] text-dim mt-0.5">
              {tab === 'available'
                ? t('Lo que puedes usar ahora mismo con tus proveedores conectados')
                : `Catálogo completo del mercado${meta ? ` · ${meta.count} modelos` : ''}${
                    meta?.fetchedAt ? ` · actualizado ${relTime(meta.fetchedAt)}` : ''
                  }`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'available', label: 'Disponibles', count: models.length },
                { id: 'catalog', label: t('Catálogo global'), count: meta?.count }
              ]}
            />
            {tab === 'available' ? (
              <Button onClick={() => void reloadModels()} loading={modelsLoading}>
                <RefreshCw size={14} /> {t('Refrescar')}
              </Button>
            ) : (
              <Button onClick={() => void refresh()} loading={loading}>
                <Database size={14} /> {t('Actualizar catálogo')}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-[420px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === 'available' ? t('Filtrar modelos…') : t('Buscar en todo el catálogo…')}
              className="pl-8"
            />
          </div>
          <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="w-[190px]">
            <option value="">{t('Todos los proveedores')}</option>
            {providersInView.map((p) => (
              <option key={p} value={p}>
                {providerName(p)}
              </option>
            ))}
          </Select>
          <button
            onClick={() => setOnlyFree((f) => !f)}
            className={cx(
              'h-9 px-3 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition-colors',
              onlyFree ? 'bg-[#0d2019] border-[#194b39] text-ok' : 'bg-raised border-line text-muted hover:text-ink'
            )}
          >
            <Filter size={13} /> {t('Sólo gratis')}
          </button>
          <span className="num text-[11.5px] text-dim ml-auto">{rows.length} resultados</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 pb-5">
        <Panel className="h-full flex flex-col overflow-hidden">
          {(tab === 'available' && modelsLoading) || (tab === 'catalog' && loading && !rows.length) ? (
            <div className="flex-1 flex items-center justify-center gap-2.5 text-dim text-[12.5px]">
              <Spinner /> {t('Consultando…')}
            </div>
          ) : rows.length === 0 ? (
            <Empty
              icon={<Boxes size={30} />}
              title={tab === 'available' ? t('Ningún modelo disponible') : t('Catálogo vacío')}
              hint={
                tab === 'available'
                  ? t('Añade una API key en Ajustes o arranca un motor local. Aquí sólo salen los modelos que puedes usar de verdad.')
                  : t('Pulsa «Actualizar catálogo» para descargar la lista completa de modelos y sus precios.')
              }
              action={
                tab === 'catalog' ? (
                  <Button variant="primary" onClick={() => void refresh()} loading={loading}>
                    <Database size={14} /> {t('Descargar catálogo')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-panel z-10">
                  <tr className="text-[10.5px] uppercase tracking-wider text-dim border-b border-line">
                    {th('Modelo', 'name', 'text-left pl-4')}
                    <th className="font-medium py-2 text-left w-[150px]">{t('Proveedor')}</th>
                    {th('Contexto', 'context', 'text-right w-[92px]')}
                    {th('$ / M entrada', 'priceIn', 'text-right w-[110px]')}
                    {th('$ / M salida', 'priceOut', 'text-right w-[110px]')}
                    <th className="font-medium py-2 text-left w-[130px] pl-4 pr-4">{t('Entradas')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 600).map((m, i) => (
                    <tr
                      key={m.providerId + m.id + i}
                      onClick={() => void openDetail(m)}
                      className="group border-b border-line-soft hover:bg-[#12151f] cursor-pointer"
                      title={t('Ver la ficha del modelo y su enlace')}
                    >
                      <td className="pl-4 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-[12.5px] font-mono group-hover:text-accent transition-colors">
                            {m.id}
                          </span>
                          {m.name && m.name !== m.id ? (
                            <span className="text-[11px] text-dim truncate hidden xl:inline">{m.name}</span>
                          ) : null}
                          <ExternalLink
                            size={11}
                            className="text-dim opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          />
                        </div>
                      </td>
                      <td className="py-2">
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                          {isLocal(m.providerId) ? (
                            <Cpu size={11} className="text-ok" />
                          ) : (
                            <Cloud size={11} className="text-dim" />
                          )}
                          {providerName(m.providerId)}
                        </span>
                      </td>
                      <td className="num text-right text-[12px] text-muted">
                        {m.contextLength ? tokens(m.contextLength) : '—'}
                      </td>
                      <td className="num text-right text-[12px] text-muted">{price(m.priceIn)}</td>
                      <td
                        className={cx(
                          'num text-right text-[12px]',
                          m.priceOut === 0 ? 'text-ok' : 'text-muted'
                        )}
                      >
                        {price(m.priceOut)}
                      </td>
                      <td className="pl-4 pr-4 py-2">
                        <div className="flex gap-1 flex-wrap">
                          {(m.modalities ?? []).slice(0, 3).map((mod) => (
                            <Badge key={mod}>{mod}</Badge>
                          ))}
                          {m.sizeBytes ? <Badge tone="ok">{tokens(m.sizeBytes / 1e6)}MB</Badge> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 600 ? (
                <div className="px-4 py-3 text-[12px] text-dim text-center">
                  {t('models.showing600', { total: rows.length })}
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------ Ficha del modelo */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name && detail.name !== detail.id ? detail.name : (detail?.id ?? '')}
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              {t('Cerrar')}
            </Button>
            {links ? (
              <Button variant="primary" onClick={() => go(links.primary)}>
                <ExternalLink size={13} />
                {links.primaryKind === 'model' ? t('Abrir la ficha del modelo') : t('Abrir la lista del proveedor')}
              </Button>
            ) : null}
          </>
        }
      >
        {detail ? (
          <div className="space-y-4">
            {/* Identificador, que es lo que hay que copiar para usarlo */}
            <div className="bg-raised border border-line rounded-lg px-3 py-2.5 flex items-center gap-2">
              <span className="font-mono text-[12.5px] flex-1 min-w-0 break-all">{detail.id}</span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(detail.id)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                }}
                className="text-dim hover:text-ink shrink-0"
                title={t('Copiar el identificador')}
              >
                {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[12.5px]">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Proveedor')}</div>
                <div className="flex items-center gap-1.5">
                  {isLocal(detail.providerId) ? (
                    <Cpu size={12} className="text-ok" />
                  ) : (
                    <Cloud size={12} className="text-dim" />
                  )}
                  {providerName(detail.providerId)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Contexto')}</div>
                <div className="num">{detail.contextLength ? tokens(detail.contextLength) + ' ' + t('tokens') : '—'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Entrada')}</div>
                <div className="num">{price(detail.priceIn)} / M</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Salida')}</div>
                <div className={cx('num', detail.priceOut === 0 && 'text-ok')}>{price(detail.priceOut)} / M</div>
              </div>
              {detail.maxOutput ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Salida máxima')}</div>
                  <div className="num">{tokens(detail.maxOutput)} tokens</div>
                </div>
              ) : null}
              {detail.sizeBytes ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Peso en disco')}</div>
                  <div className="num">{bytes(detail.sizeBytes)}</div>
                </div>
              ) : null}
            </div>

            {detail.modalities?.length ? (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">{t('Entradas que acepta')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.modalities.map((m) => (
                    <Badge key={m}>{m}</Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.description ? (
              <p className="text-[12.5px] text-muted leading-relaxed">{detail.description}</p>
            ) : null}

            {/* Enlaces */}
            <div className="border-t border-line pt-3.5">
              <div className="text-[11px] uppercase tracking-wider text-dim mb-2">{t('Dónde conseguirlo')}</div>
              {linksLoading ? (
                <Spinner />
              ) : links ? (
                <div className="space-y-1.5">
                  <button
                    onClick={() => go(links.primary)}
                    className="w-full px-3 py-2 rounded-lg border border-line hover:border-[#2c3346] hover:bg-hover flex items-center gap-2.5 text-left"
                  >
                    <ExternalLink size={13} className="text-accent shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px]">
                        {links.primaryKind === 'model' ? t('Ficha del modelo') : `Modelos de ${providerName(detail.providerId)}`}
                      </span>
                      <span className="block text-[10.5px] text-dim truncate">{links.primary}</span>
                    </span>
                  </button>
                  {links.extras.map((e) => (
                    <button
                      key={e.url}
                      onClick={() => go(e.url)}
                      className="w-full px-3 py-2 rounded-lg border border-line hover:border-[#2c3346] hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <Download size={13} className="text-dim shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12.5px]">{e.label}</span>
                        <span className="block text-[10.5px] text-dim truncate">{e.url}</span>
                      </span>
                    </button>
                  ))}
                  {links.primaryKind === 'provider' ? (
                    <p className="text-[11px] text-dim flex items-start gap-1.5 pt-1 leading-relaxed">
                      <AlertCircle size={11} className="shrink-0 mt-0.5" />
                      {t('Este proveedor no publica una página por modelo, así que el enlace lleva a su lista completa en vez de a una dirección inventada que daría un 404.')}
                    </p>
                  ) : null}
                </div>
              ) : (
                <span className="text-[12px] text-dim">{t('No hay enlaces para este modelo.')}</span>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
