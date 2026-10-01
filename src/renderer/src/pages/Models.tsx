import React, { useEffect, useMemo, useState } from 'react'
import {
  Boxes, Search, RefreshCw, Cpu, Cloud, ArrowUpDown, Database, Filter, ExternalLink,
  Download, Copy, Check, AlertCircle, Star, GitCompare, X
} from 'lucide-react'
import { Panel, Button, Badge, Empty, Input, Select, Tabs, cx, Spinner, Modal } from '../components/ui'
import { ModelCompare, modelFavKey, usageOf } from '../components/ModelCompare'
import { useStore } from '../lib/store'
import { useRunsVersion, newSession, sendTurn, focusChat } from '../lib/engine'
import { Recommender } from '../components/Recommender'
import { price, tokens, relTime, bytes, ms, tps, cost } from '../lib/format'
import type { ModelInfo, ModelLinks, ModelUsage } from '@shared/types'

import { useT } from '../lib/i18n'
type SortKey = 'name' | 'priceIn' | 'priceOut' | 'context' | 'intelligence' | 'coding' | 'value'

/** Precio mezclado (3 de entrada por 1 de salida), para «calidad por dólar». */
const blended = (m: ModelInfo): number => ((m.priceIn ?? 0) * 3 + (m.priceOut ?? 0)) / 4

/** Calidad por dólar: sin índice va al final; gratis y con índice, lo primero. */
function valueOf(m: ModelInfo): number {
  const q = m.bench?.intelligence
  if (q == null) return -1
  const p = blended(m)
  return p > 0 ? q / p : q * 1e6
}

const MAX_COMPARE = 4

/**
 * La pestaña del recomendador. «Usar» abre una conversación en la Consola
 * con ese modelo (y el proyecto, si eliges uno) y le manda la tarea; con una
 * suscripción, una sesión de su agente de consola.
 */
function RecommendTab(): React.JSX.Element {
  const t = useT()
  const { config, toast } = useStore()
  const [projectId, setProjectId] = useState('')

  const start = async (id: string, text: string): Promise<void> => {
    if (!config) return
    focusChat(id)
    const r = await sendTurn(id, text.trim(), config)
    if (r.error) toast('error', t(r.error))
  }

  return (
    <Panel className="p-4 space-y-3 max-w-[1100px]">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-dim">{t('Proyecto')}</span>
        <div className="w-56">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 text-[12px]">
            <option value="">{t('Ninguno: sólo conversar')}</option>
            {(config?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <span className="text-[11px] text-dim">{t('Con proyecto, la IA trabaja sobre sus archivos como agente.')}</span>
      </div>
      <Recommender
        projectId={projectId || undefined}
        onUse={(m, text) =>
          void newSession('chat', { providerId: m.providerId, model: m.id, projectId: projectId || undefined }).then((id) => start(id, text))
        }
        onUseAgent={(agentId, text) => {
          if (!projectId) {
            toast('error', t('Un agente de línea de comandos necesita un proyecto donde trabajar'))
            return
          }
          void newSession('cli', { cliAgentId: agentId, projectId }).then((id) => start(id, text))
        }}
      />
    </Panel>
  )
}

export default function Models(): React.JSX.Element {
  const t = useT()
  const { models, modelsLoading, reloadModels, defs, toast, config, reload } = useStore()
  const [tab, setTab] = useState<'available' | 'catalog' | 'recommend'>('available')
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
  const [onlyFav, setOnlyFav] = useState(false)
  const [selected, setSelected] = useState<ModelInfo[]>([])
  const [comparing, setComparing] = useState(false)
  const [usage, setUsage] = useState<ModelUsage[]>([])
  const version = useRunsVersion()
  const favorites = config?.favorites ?? []

  // Lo medido con tu uso se relee cuando termina una ejecución.
  useEffect(() => {
    void window.api.runs.modelUsage().then((r) => r.ok && r.data && setUsage(r.data))
  }, [version])

  const toggleFav = async (m: ModelInfo): Promise<void> => {
    const key = modelFavKey(m)
    await window.api.models.favorite(key, !favorites.includes(key))
    await reload()
  }

  const toggleSelected = (m: ModelInfo): void => {
    const key = modelFavKey(m)
    setSelected((cur) => {
      if (cur.some((x) => modelFavKey(x) === key)) return cur.filter((x) => modelFavKey(x) !== key)
      if (cur.length >= MAX_COMPARE) {
        toast('info', t('Se comparan como mucho {n} modelos a la vez', { n: MAX_COMPARE }))
        return cur
      }
      return [...cur, m]
    })
  }
  const isSelected = (m: ModelInfo): boolean => selected.some((x) => modelFavKey(x) === modelFavKey(m))

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
      if (onlyFav && !favorites.includes(modelFavKey(m))) return false
      if (tab === 'catalog') return true // el filtrado por texto lo hace el backend
      if (!key) return true
      return m.id.toLowerCase().includes(key) || m.name.toLowerCase().includes(key)
    })
    const dir = asc ? 1 : -1
    out = [...out].sort((a, b) => {
      if (sort === 'name') return dir * (a.providerId + a.id).localeCompare(b.providerId + b.id)
      if (sort === 'context') return dir * ((a.contextLength ?? 0) - (b.contextLength ?? 0))
      if (sort === 'intelligence') return dir * ((a.bench?.intelligence ?? -1) - (b.bench?.intelligence ?? -1))
      if (sort === 'coding') return dir * ((a.bench?.coding ?? -1) - (b.bench?.coding ?? -1))
      if (sort === 'value') return dir * (valueOf(a) - valueOf(b))
      const av = (sort === 'priceIn' ? a.priceIn : a.priceOut) ?? 0
      const bv = (sort === 'priceIn' ? b.priceIn : b.priceOut) ?? 0
      return dir * (av - bv)
    })
    return out
  }, [tab, models, catalog, q, sort, asc, providerFilter, onlyFree, onlyFav, favorites])

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
              {tab === 'recommend'
                ? t('Qué IA usar para cada tarea, sin gastar de más')
                : tab === 'available'
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
                { id: 'catalog', label: t('Catálogo global'), count: meta?.count },
                { id: 'recommend', label: t('Recomendar') }
              ]}
            />
            {tab === 'recommend' ? null : tab === 'available' ? (
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

        <div className={cx('flex items-center gap-2 flex-wrap', tab === 'recommend' && 'hidden')}>
          <div className="relative flex-1 min-w-[200px] max-w-[420px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === 'available' ? t('Filtrar modelos…') : t('Buscar en todo el catálogo…')}
              className="pl-8"
            />
          </div>
          <div className="w-[190px] shrink-0">
            <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
              <option value="">{t('Todos los proveedores')}</option>
              {providersInView.map((p) => (
                <option key={p} value={p}>
                  {providerName(p)}
                </option>
              ))}
            </Select>
          </div>
          <button
            onClick={() => setOnlyFree((f) => !f)}
            className={cx(
              'h-9 px-3 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap',
              onlyFree ? 'bg-ok/10 border-ok/30 text-ok' : 'bg-raised border-line text-muted hover:text-ink'
            )}
          >
            <Filter size={13} /> {t('Sólo gratis')}
          </button>
          <button
            onClick={() => setOnlyFav((f) => !f)}
            className={cx(
              'h-9 px-3 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap',
              onlyFav ? 'bg-warn/10 border-warn/35 text-warn' : 'bg-raised border-line text-muted hover:text-ink'
            )}
          >
            <Star size={13} /> {t('Favoritos')}
          </button>
          <button
            onClick={() => {
              setSort('value')
              setAsc(false)
            }}
            className={cx(
              'h-9 px-3 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap',
              sort === 'value' ? 'bg-accent/10 border-accent/35 text-accent' : 'bg-raised border-line text-muted hover:text-ink'
            )}
            title={t('Índice de calidad de Artificial Analysis dividido por el precio mezclado (3 de entrada por 1 de salida)')}
          >
            <ArrowUpDown size={13} /> {t('Calidad por dólar')}
          </button>
          <span className="num text-[11.5px] text-dim ml-auto whitespace-nowrap shrink-0">{t('{n} resultados', { n: rows.length })}</span>
        </div>
      </div>

      {tab === 'recommend' ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-5">
          <RecommendTab />
        </div>
      ) : null}

      <div className={cx('flex-1 min-h-0 px-6 pb-5', tab === 'recommend' && 'hidden')}>
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
                    <th className="w-[62px]" />
                    {th(t('Modelo'), 'name', 'text-left')}
                    <th className="font-medium py-2 text-left w-[150px]">{t('Proveedor')}</th>
                    {th(t('Calidad'), 'intelligence', 'text-right w-[86px] pr-2')}
                    {th(t('Código'), 'coding', 'text-right w-[80px] pr-2')}
                    {th(t('Contexto'), 'context', 'text-right w-[92px]')}
                    {th(t('$ / M entrada'), 'priceIn', 'text-right w-[110px]')}
                    {th(t('$ / M salida'), 'priceOut', 'text-right w-[110px]')}
                    <th className="font-medium py-2 text-left w-[230px] pl-4 pr-4">{t('Capacidades')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 600).map((m, i) => (
                    <tr
                      key={m.providerId + m.id + i}
                      onClick={() => void openDetail(m)}
                      className="group border-b border-line-soft hover:bg-raised/60 cursor-pointer"
                      title={t('Ver la ficha del modelo y su enlace')}
                    >
                      <td className="pl-3 pr-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isSelected(m)}
                            onChange={() => toggleSelected(m)}
                            title={t('Añadir al comparador')}
                            className="accent-[var(--color-accent)]"
                          />
                          <button
                            onClick={() => void toggleFav(m)}
                            title={favorites.includes(modelFavKey(m)) ? t('Quitar de favoritos') : t('Añadir a favoritos')}
                            className={favorites.includes(modelFavKey(m)) ? 'text-warn' : 'text-dim hover:text-ink'}
                          >
                            <Star size={12} className={favorites.includes(modelFavKey(m)) ? 'fill-current' : ''} />
                          </button>
                        </div>
                      </td>
                      <td className="py-2">
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
                      <td className="num text-right text-[12px] text-muted pr-2">{m.bench?.intelligence ?? '—'}</td>
                      <td className="num text-right text-[12px] text-muted pr-2">{m.bench?.coding ?? '—'}</td>
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
                        {/* En una sola línea: el detalle completo está en la ficha. */}
                        <div className="flex gap-1 flex-nowrap overflow-hidden">
                          {m.caps?.tools ? <Badge tone="accent">{t('herramientas')}</Badge> : null}
                          {m.caps?.reasoning ? <Badge tone="violet">{t('razona')}</Badge> : null}
                          {m.caps?.openWeights ? <Badge tone="ok">{t('abierto')}</Badge> : null}
                          {(m.modalities ?? []).includes('image') ? <Badge>{t('imagen')}</Badge> : null}
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

      {/* ------------------------------------------------ Comparador */}
      {selected.length ? (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-raised border border-line rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3">
          <span className="text-[12.5px] whitespace-nowrap">{t('{n} para comparar', { n: selected.length })}</span>
          <div className="flex gap-1 max-w-[520px] overflow-hidden">
            {selected.map((m) => (
              <Badge key={modelFavKey(m)} className="max-w-[160px]">
                <span className="truncate">{m.id}</span>
                <button onClick={() => toggleSelected(m)} className="ml-1 text-dim hover:text-ink">
                  <X size={10} />
                </button>
              </Badge>
            ))}
          </div>
          <Button size="sm" variant="primary" disabled={selected.length < 2} onClick={() => setComparing(true)}>
            <GitCompare size={13} /> {t('Comparar')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            {t('Vaciar')}
          </Button>
        </div>
      ) : null}
      <ModelCompare
        open={comparing}
        onClose={() => setComparing(false)}
        models={selected}
        usage={usage}
        providerName={providerName}
        favorites={favorites}
      />

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
            {detail ? (
              <Button variant="ghost" onClick={() => void toggleFav(detail)}>
                <Star size={13} className={favorites.includes(modelFavKey(detail)) ? 'text-warn fill-current' : ''} />
                {favorites.includes(modelFavKey(detail)) ? t('Quitar de favoritos') : t('Añadir a favoritos')}
              </Button>
            ) : null}
            {detail ? (
              <Button variant="ghost" onClick={() => toggleSelected(detail)}>
                <GitCompare size={13} /> {isSelected(detail) ? t('Quitar del comparador') : t('Añadir al comparador')}
              </Button>
            ) : null}
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

            {/* Capacidades y puntuaciones públicas */}
            {detail.caps || detail.knowledge ? (
              <div className="flex flex-wrap gap-1.5 items-center">
                {detail.caps?.tools ? <Badge tone="accent">{t('herramientas')}</Badge> : null}
                {detail.caps?.reasoning ? <Badge tone="violet">{t('razona')}</Badge> : null}
                {detail.caps?.structured ? <Badge>{t('salida estructurada')}</Badge> : null}
                {detail.caps?.openWeights ? <Badge tone="ok">{t('pesos abiertos')}</Badge> : null}
                {detail.caps?.attachments ? <Badge>{t('adjuntos')}</Badge> : null}
                {detail.knowledge ? (
                  <span className="text-[11.5px] text-dim">{t('sabe hasta {date}', { date: detail.knowledge })}</span>
                ) : null}
              </div>
            ) : null}

            {detail.bench ? (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">
                  {t('Puntuaciones públicas')}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    [t('Calidad'), detail.bench.intelligence],
                    [t('Código'), detail.bench.coding],
                    [t('Agéntico'), detail.bench.agentic]
                  ] as [string, number | undefined][]).map(([label, v]) => (
                    <div key={label} className="bg-raised border border-line rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-dim">{label}</div>
                      <div className="num text-[15px]">{v ?? '—'}</div>
                    </div>
                  ))}
                </div>
                {detail.bench.design?.length ? (
                  <div className="mt-2 text-[11.5px] text-muted leading-relaxed">
                    {t('Design Arena')}:{' '}
                    {detail.bench.design
                      .slice()
                      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                      .slice(0, 6)
                      .map((d) => `${d.category} ${d.elo}${d.rank ? ` (#${d.rank})` : ''}`)
                      .join(' · ')}
                  </div>
                ) : null}
                <div className="text-[10.5px] text-dim mt-1">
                  {t('Índices de Artificial Analysis (0–100) y Elo de Design Arena, según OpenRouter.')}
                </div>
              </div>
            ) : null}

            {/* Lo que tú has medido con él */}
            {(() => {
              const u = usageOf(usage, detail)
              if (!u) return null
              return (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">{t('Con tu uso')}</div>
                  <div className="grid grid-cols-4 gap-2 text-[12px]">
                    <div className="bg-raised border border-line rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-dim">{t('Ejecuciones')}</div>
                      <div className="num">{u.runs}{u.errors ? ` · ${u.errors} err` : ''}</div>
                    </div>
                    <div className="bg-raised border border-line rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-dim">{t('Latencia inicial')}</div>
                      <div className="num">{u.avgTtft ? ms(u.avgTtft) : '—'}</div>
                    </div>
                    <div className="bg-raised border border-line rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-dim">{t('Velocidad')}</div>
                      <div className="num">{u.avgTps ? tps(u.avgTps) : '—'}</div>
                    </div>
                    <div className="bg-raised border border-line rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-dim">{t('Coste por ejecución')}</div>
                      <div className="num">{cost(u.cost / Math.max(1, u.runs))}</div>
                    </div>
                  </div>
                  {u.elo ? (
                    <div className="text-[11.5px] text-muted mt-1.5">
                      {t('Tu Elo en la Arena: {elo} ({wins} de {games} duelos ganados)', { elo: u.elo, wins: u.wins ?? 0, games: u.games ?? 0 })}
                    </div>
                  ) : null}
                </div>
              )
            })()}

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
                    className="w-full px-3 py-2 rounded-lg border border-line hover:border-dim/60 hover:bg-hover flex items-center gap-2.5 text-left"
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
                      className="w-full px-3 py-2 rounded-lg border border-line hover:border-dim/60 hover:bg-hover flex items-center gap-2.5 text-left"
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
