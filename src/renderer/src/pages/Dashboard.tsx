import React, { Suspense, lazy, useEffect, useState } from 'react'
import {
  Activity, DollarSign, Gauge, Zap, Coins, ArrowRight, Cpu, Cloud, AlertTriangle, Timer, PieChart, LayoutGrid, Check, RotateCcw, Plus
} from 'lucide-react'
import { Panel, PanelHeader, Stat, Button, Tabs, Empty, Meter, Badge, Dot, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { ClaudeWindows, UsageRows, useClaudeUsage } from '../components/AgentPanel'
import { QuotasPanel } from '../components/QuotasPanel'
import { navigate } from '../lib/nav'
import { useInFlight, useRunsVersion } from '../lib/engine'
import { useIsPageActive } from '../lib/pageActive'
import { cost, tokens, ms, tps, relTime, shortModel, colorFor, pct } from '../lib/format'
import type { RunRecord, StatsBucket } from '@shared/types'
import type { PageId } from '../App'
import { DashboardGrid, type TileDef } from '../components/DashboardGrid'
import { DEFAULT_TILES, normalizeLayout, setHidden } from '../lib/dashboardLayout'
import type { DashboardLayout } from '@shared/types'

import { useT } from '../lib/i18n'
// La librería de gráficas entra sola la primera vez que hay algo que dibujar.
const CostChart = lazy(() => import('../components/DashboardCharts').then((m) => ({ default: m.CostChart })))
const TokensChart = lazy(() => import('../components/DashboardCharts').then((m) => ({ default: m.TokensChart })))

/** Nombre de cada recuadro, para «Organizar» y para volver a enseñar los escondidos. */
const TILE_TITLES: Record<string, string> = {
  runs: 'Ejecuciones',
  spend: 'Gasto',
  tokens: 'Tokens',
  ttft: 'Latencia inicial',
  speed: 'Velocidad',
  quotas: 'Cupos de tus IAs',
  usage: 'Consumo y límites',
  claude: 'Plan de Claude',
  costChart: 'Gasto por día',
  tokensChart: 'Tokens por día',
  models: 'Modelos',
  recent: 'Últimas ejecuciones',
  split: 'Reparto',
  providers: 'Proveedores activos',
  local: 'En tu máquina'
}

export default function Dashboard({ onNav }: { onNav: (p: PageId) => void }): React.JSX.Element {
  const t = useT()
  const { status, models, config } = useStore()
  const [editing, setEditing] = useState(false)
  const [layout, setLayout] = useState<DashboardLayout>(() => normalizeLayout(config?.settings.dashboard))
  // La configuración llega después del primer pintado: se coge en cuanto está.
  const savedLayout = config?.settings.dashboard
  useEffect(() => {
    if (!editing) setLayout(normalizeLayout(savedLayout))
  }, [savedLayout, editing])
  const changeLayout = (next: DashboardLayout): void => {
    setLayout(next)
    void window.api.config.settings({ dashboard: next })
  }
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [split, setSplit] = useState<'project' | 'agent' | 'provider'>('project')
  const [ov, setOv] = useState<any>(null)
  const [recent, setRecent] = useState<RunRecord[]>([])
  // En cuanto termina una ejecución, el panel se vuelve a leer: nada de
  // números de hace media hora mientras trabajas.
  const version = useRunsVersion()
  const claude = useClaudeUsage()
  const active = useIsPageActive()
  // Lo que se está generando y aún no ha entrado al histórico, estimado.
  const inflight = useInFlight()

  // Con el panel a la vista se relee en cuanto termina una ejecución. Oculto no
  // se lee nada: al volver, `active` cambia y el efecto se dispara solo, así que
  // lo que ves al entrar siempre está al día sin haber consultado de más.
  useEffect(() => {
    if (!active) return
    void (async () => {
      const [o, r] = await Promise.all([window.api.runs.overview(days), window.api.runs.query({ limit: 12 })])
      if (o.ok) setOv(o.data)
      if (r.ok && r.data) setRecent(r.data.rows)
    })()
  }, [days, version, active])

  const empty = ov && ov.totalRuns === 0
  const chartData = (ov?.byDay ?? []).map((d: any) => ({
    ...d,
    label: d.day.slice(5).replace('-', '/')
  }))

  const topModels: StatsBucket[] = (ov?.byModel ?? []).slice(0, 7)
  const maxCost = Math.max(...topModels.map((m) => m.cost), 0.0001)
  const maxTps = Math.max(...topModels.map((m) => m.avgTps), 1)

  // Reparto por proyecto, agente o proveedor: lo calcula ya el resumen.
  const splitRows: StatsBucket[] = (
    split === 'project' ? ov?.byProject : split === 'agent' ? ov?.byAgent : ov?.byProvider
  ) ?? []
  const splitMaxCost = Math.max(...splitRows.map((b) => b.cost), 0.0001)
  const splitMaxRuns = Math.max(...splitRows.map((b) => b.runs), 1)
  const splitName = (key: string): string => {
    if (split !== 'provider') return key
    if (key.startsWith('cli:')) return `${key.slice(4)} · ${t('consola')}`
    return status.find((s) => s.id === key)?.name ?? key
  }

  const activeProviders = status.filter((s) => (s.local ? s.reachable : s.keySource !== 'none'))
  const localUp = status.filter((s) => s.local && s.reachable)

  const tiles: TileDef[] = [
    {
      id: 'runs',
      title: TILE_TITLES['runs'],
      render: () => (
        <Stat label={t('Ejecuciones')} value={ov?.totalRuns ?? '—'} sub={ov ? t('dash.today', { n: ov.runsToday }) : ''} icon={<Activity size={14} />} />
      )
    },
    {
      id: 'spend',
      title: TILE_TITLES['spend'],
      render: () => (
        <Stat
          label={t('Gasto')}
          value={ov ? cost(ov.totalCost + inflight.cost) : '—'}
          sub={
            ov
              ? t('dash.thisMonth', { cost: cost(ov.costMonth + inflight.cost) }) +
                (inflight.count ? ' · ' + t('dash.inFlight', { n: inflight.count }) : '')
              : ''
          }
          tone="accent"
          icon={<DollarSign size={14} />}
        />
      )
    },
    {
      id: 'tokens',
      title: TILE_TITLES['tokens'],
      render: () => (
        <Stat
          label="Tokens"
          value={ov ? tokens(ov.totalTokensIn + ov.totalTokensOut + inflight.tokens) : '—'}
          sub={ov ? `${tokens(ov.totalTokensIn)} in · ${tokens(ov.totalTokensOut)} out` : ''}
          icon={<Coins size={14} />}
        />
      )
    },
    {
      id: 'ttft',
      title: TILE_TITLES['ttft'],
      render: () => (
        <Stat label={t('Latencia inicial')} value={ov ? ms(ov.avgTtft) : '—'} sub={t('media hasta el primer token')} icon={<Timer size={14} />} />
      )
    },
    {
      id: 'speed',
      title: TILE_TITLES['speed'],
      render: () => (
        <Stat
          label={t('Velocidad')}
          value={ov ? tps(ov.avgTps) : '—'}
          sub={ov && ov.errorRate > 0 ? t('dash.errorRate', { pct: pct(ov.errorRate) }) : t('sin errores')}
          tone={ov && ov.errorRate > 0.1 ? 'warn' : 'ok'}
          icon={<Zap size={14} />}
        />
      )
    },
    {
      id: 'quotas',
      title: TILE_TITLES['quotas'],
      render: () => <QuotasPanel onSettings={() => navigate({ page: 'settings', tab: 'quotas' })} />
    },
    {
      id: 'usage',
      title: TILE_TITLES['usage'],
      render: () => (
        <Panel>
          <PanelHeader
            title={t('Consumo y límites')}
            subtitle={t('lo que cada proveedor dice que te queda y cuándo se repone')}
            icon={<Gauge size={14} />}
          />
          <UsageRows />
        </Panel>
      )
    },
    {
      // Claude Code no publica su tope, pero sí cuándo se reinicia la cuenta:
      // con lo gastado en la máquina ya se sabe por dónde vas.
      id: 'claude',
      title: TILE_TITLES['claude'],
      render: () =>
        claude ? (
          <Panel>
            <PanelHeader title={t('Plan de Claude')} subtitle={t('incluye lo que lanzas en la terminal')} icon={<Timer size={14} />} />
            <div className="p-3">
              <ClaudeWindows usage={claude} />
            </div>
          </Panel>
        ) : null
    },
    {
      // Las gráficas sólo existen mientras se ven: recalcular recharts contra
      // un contenedor de tamaño cero, que es lo que hay con la sección oculta,
      // no le sirve a nadie.
      id: 'costChart',
      title: TILE_TITLES['costChart'],
      render: () =>
        !empty && active ? (
          <Suspense fallback={<div />}>
            <CostChart data={chartData} />
          </Suspense>
        ) : null
    },
    {
      id: 'tokensChart',
      title: TILE_TITLES['tokensChart'],
      render: () =>
        !empty && active ? (
          <Suspense fallback={<div />}>
            <TokensChart data={chartData} />
          </Suspense>
        ) : null
    },
    {
      id: 'models',
      title: TILE_TITLES['models'],
      render: () =>
        empty ? null : (
          <Panel>
            <PanelHeader
              title={t('Modelos')}
              subtitle={t('quién se lleva el presupuesto y quién corre más')}
              icon={<Gauge size={14} />}
              right={
                <Button size="sm" variant="ghost" onClick={() => onNav('history')}>
                  {t('Ver histórico')} <ArrowRight size={13} />
                </Button>
              }
            />
            <div className="px-4 py-2">
              <table className="w-full">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wider text-dim">
                    <th className="text-left font-medium py-1.5">{t('Modelo')}</th>
                    <th className="text-right font-medium w-14">{t('Ejec.')}</th>
                    <th className="text-left font-medium w-[128px] pl-3">{t('Coste')}</th>
                    <th className="text-left font-medium w-[112px] pl-3">{t('Velocidad')}</th>
                    <th className="text-right font-medium w-16">TTFT</th>
                  </tr>
                </thead>
                <tbody>
                  {topModels.map((m) => (
                    <tr key={m.key} className="border-t border-line-soft">
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorFor(m.key) }} />
                          <span className="truncate text-[12.5px]">{shortModel(m.key)}</span>
                          {m.errors > 0 ? (
                            <Badge tone="bad" className="shrink-0">
                              {m.errors} err
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="num text-right text-muted text-[12px]">{m.runs}</td>
                      <td className="pl-3">
                        <div className="flex items-center gap-2">
                          <Meter value={m.cost} max={maxCost} color={colorFor(m.key)} />
                          <span className="num text-[11.5px] text-muted w-14 text-right shrink-0">{cost(m.cost)}</span>
                        </div>
                      </td>
                      <td className="pl-3">
                        <div className="flex items-center gap-2">
                          <Meter value={m.avgTps} max={maxTps} color="#34d399" />
                          <span className="num text-[11.5px] text-muted w-11 text-right shrink-0">{m.avgTps ? m.avgTps.toFixed(0) : '—'}</span>
                        </div>
                      </td>
                      <td className="num text-right text-[11.5px] text-muted">{ms(m.avgTtft)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
    },
    {
      id: 'recent',
      title: TILE_TITLES['recent'],
      render: () =>
        empty ? null : (
          <Panel>
            <PanelHeader title={t('Últimas ejecuciones')} icon={<Activity size={14} />} />
            <div className="divide-y divide-line-soft">
              {recent.map((r) => (
                <div key={r.id} className="px-4 py-2 flex items-center gap-2.5">
                  <Dot tone={r.status === 'ok' ? 'ok' : r.status === 'error' ? 'bad' : 'warn'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px]">{shortModel(r.model)}</div>
                    <div className="text-[10.5px] text-dim truncate">
                      {relTime(r.createdAt)}
                      {r.projectName ? ` · ${r.projectName}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="num text-[11.5px] text-muted">{cost(r.costTotal)}</div>
                    <div className="num text-[10.5px] text-dim">{ms(r.totalMs)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )
    },
    {
      id: 'split',
      title: TILE_TITLES['split'],
      render: () =>
        empty ? null : (
          <Panel>
            <PanelHeader
              title={t('Reparto')}
              subtitle={t('en qué se va el gasto y quién trabaja más')}
              icon={<PieChart size={14} />}
              right={
                <Tabs
                  value={split}
                  onChange={setSplit}
                  items={[
                    { id: 'project', label: t('Proyectos'), count: ov?.byProject?.length },
                    { id: 'agent', label: t('Agentes'), count: ov?.byAgent?.length },
                    { id: 'provider', label: t('Proveedores'), count: ov?.byProvider?.length }
                  ]}
                />
              }
            />
            {splitRows.length === 0 ? (
              <div className="px-4 py-5 text-[12px] text-dim">
                {split === 'project' ? t('Ninguna ejecución de estos días va apuntada a un proyecto.') : t('Nada que repartir en estos días.')}
              </div>
            ) : (
              <div className="px-4 py-2">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wider text-dim">
                      <th className="text-left font-medium py-1.5">
                        {split === 'project' ? t('Proyecto') : split === 'agent' ? t('Agente') : t('Proveedor')}
                      </th>
                      <th className="text-left font-medium w-[150px] pl-3">{t('Ejecuciones')}</th>
                      <th className="text-left font-medium w-[170px] pl-3">{t('Coste')}</th>
                      <th className="text-right font-medium w-20">Tokens</th>
                      <th className="text-right font-medium w-20">{t('Velocidad')}</th>
                      <th className="text-right font-medium w-16">{t('Errores')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {splitRows.slice(0, 10).map((b) => (
                      <tr key={b.key} className="border-t border-line-soft">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorFor(b.key) }} />
                            <span className="truncate text-[12.5px]">{splitName(b.key)}</span>
                          </div>
                        </td>
                        <td className="pl-3">
                          <div className="flex items-center gap-2">
                            <Meter value={b.runs} max={splitMaxRuns} color="#818cf8" />
                            <span className="num text-[11.5px] text-muted w-10 text-right shrink-0">{b.runs}</span>
                          </div>
                        </td>
                        <td className="pl-3">
                          <div className="flex items-center gap-2">
                            <Meter value={b.cost} max={splitMaxCost} color={colorFor(b.key)} />
                            <span className="num text-[11.5px] text-muted w-16 text-right shrink-0">{cost(b.cost)}</span>
                          </div>
                        </td>
                        <td className="num text-right text-[11.5px] text-muted">{tokens(b.tokensIn + b.tokensOut)}</td>
                        <td className="num text-right text-[11.5px] text-muted">{b.avgTps ? b.avgTps.toFixed(0) : '—'}</td>
                        <td className={cx('num text-right text-[11.5px]', b.errors ? 'text-bad' : 'text-dim')}>{b.errors || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {splitRows.length > 10 ? <div className="text-[11px] text-dim py-1.5">{t('y {n} más', { n: splitRows.length - 10 })}</div> : null}
              </div>
            )}
          </Panel>
        )
    },
    {
      id: 'providers',
      title: TILE_TITLES['providers'],
      render: () => (
        <Panel>
          <PanelHeader
            title={t('Proveedores activos')}
            subtitle={t('dash.providersReady', { ready: activeProviders.length, total: status.length, models: models.length })}
            icon={<Cloud size={14} />}
            right={
              <Button size="sm" variant="ghost" onClick={() => onNav('settings')}>
                {t('Gestionar')} <ArrowRight size={13} />
              </Button>
            }
          />
          {activeProviders.length === 0 ? (
            <Empty
              icon={<AlertTriangle size={26} />}
              title={t('Ningún proveedor conectado')}
              hint={t('Añade una API key o arranca un motor local como Ollama. La app detecta sola lo que tengas en el equipo.')}
              action={
                <Button variant="primary" size="sm" onClick={() => onNav('settings')}>
                  {t('Ir a Ajustes')}
                </Button>
              }
            />
          ) : (
            <div className="p-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {activeProviders.map((p) => (
                <div key={p.id} className="bg-raised border border-line rounded-lg px-3 py-2 flex items-center gap-2.5">
                  {p.local ? <Cpu size={14} className="text-ok shrink-0" /> : <Cloud size={14} className="text-accent shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] truncate">{p.name}</div>
                    <div className="text-[10.5px] text-dim truncate">{p.detail}</div>
                  </div>
                  <Dot tone={p.local ? (p.reachable ? 'ok' : 'bad') : 'ok'} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      )
    },
    {
      id: 'local',
      title: TILE_TITLES['local'],
      render: () => (
        <Panel>
          <PanelHeader title={t('En tu máquina')} subtitle={t('motores locales detectados')} icon={<Cpu size={14} />} />
          <div className="p-3 space-y-2">
            {localUp.length === 0 ? (
              <div className="text-[12.5px] text-dim px-1 py-3 leading-relaxed">
                {t('No hay motores locales encendidos. Arranca Ollama o LM Studio y pulsa')}
                <span className="text-muted"> {t('Reescanear')} </span> {t('en Ajustes.')}
              </div>
            ) : (
              localUp.map((s) => (
                <div key={s.id} className="flex items-center gap-2.5 px-1">
                  <Dot tone="ok" pulse />
                  <span className="text-[12.5px] flex-1 truncate">{s.name}</span>
                  <span className="num text-[11px] text-dim">
                    {s.modelCount} {t('modelos')}
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>
      )
    }
  ]

  const hidden = layout.hidden.filter((id) => TILE_TITLES[id])

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 max-w-[1500px] mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight">{t('Panel')}</h1>
            <p className="text-[12.5px] text-dim mt-0.5">
              {editing
                ? t('Arrastra cada recuadro por su asa, cambia su tamaño desde la esquina o escóndelo. Se guarda solo.')
                : t('dash.lastDays', { n: days })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => changeLayout(normalizeLayout({ tiles: DEFAULT_TILES, hidden: [] }))}
                  title={t('Vuelve al orden y los tamaños de siempre, con todo a la vista')}
                  data-dashboard-reset
                >
                  <RotateCcw size={13} /> {t('Restablecer')}
                </Button>
                <Button size="sm" variant="primary" onClick={() => setEditing(false)} data-dashboard-done>
                  <Check size={13} /> {t('Listo')}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} title={t('Ordenar, redimensionar y esconder recuadros')} data-dashboard-edit>
                  <LayoutGrid size={13} /> {t('Organizar')}
                </Button>
                <Tabs
                  value={String(days) as any}
                  onChange={(v) => setDays(Number(v) as 7 | 30 | 90)}
                  items={[
                    { id: '7' as any, label: '7 d' },
                    { id: '30' as any, label: '30 d' },
                    { id: '90' as any, label: '90 d' }
                  ]}
                />
              </>
            )}
          </div>
        </div>

        {editing && hidden.length ? (
          <div className="flex items-center gap-1.5 flex-wrap text-[12px]" data-dashboard-hidden>
            <span className="text-dim">{t('Escondidos:')}</span>
            {hidden.map((id) => (
              <Button key={id} size="sm" variant="outline" onClick={() => changeLayout(setHidden(layout, id, false))}>
                <Plus size={12} /> {t(TILE_TITLES[id])}
              </Button>
            ))}
          </div>
        ) : null}

        {empty && !editing ? (
          <Panel>
            <Empty
              icon={<Activity size={30} />}
              title={t('Todavía no hay datos')}
              hint={t('En cuanto lances tu primer prompt desde la Consola o una comparativa en la Arena, aquí verás tokens, velocidad, latencia y coste de cada modelo.')}
              action={
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => onNav('chat')}>
                    {t('Abrir consola')} <ArrowRight size={14} />
                  </Button>
                  <Button onClick={() => onNav('settings')}>{t('Configurar proveedores')}</Button>
                </div>
              }
            />
          </Panel>
        ) : null}

        <DashboardGrid layout={layout} tiles={tiles} editing={editing} onChange={changeLayout} />
      </div>
    </div>
  )
}
