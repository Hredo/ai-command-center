import React, { Suspense, lazy, useEffect, useState } from 'react'
import {
  Activity, DollarSign, Gauge, Zap, Coins, ArrowRight, Cpu, Cloud, AlertTriangle, Timer
} from 'lucide-react'
import { Panel, PanelHeader, Stat, Button, Tabs, Empty, Meter, Badge, Dot, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { ClaudeWindows, UsageRows, useClaudeUsage } from '../components/AgentPanel'
import { useInFlight, useRunsVersion } from '../lib/engine'
import { useIsPageActive } from '../lib/pageActive'
import { cost, tokens, ms, tps, relTime, shortModel, colorFor, pct } from '../lib/format'
import type { RunRecord, StatsBucket } from '@shared/types'
import type { PageId } from '../App'

import { useT } from '../lib/i18n'
// La librería de gráficas entra sola la primera vez que hay algo que dibujar.
const DashboardCharts = lazy(() => import('../components/DashboardCharts'))

export default function Dashboard({ onNav }: { onNav: (p: PageId) => void }): React.JSX.Element {
  const t = useT()
  const { status, models } = useStore()
  const [days, setDays] = useState<7 | 30 | 90>(30)
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

  const activeProviders = status.filter((s) => (s.local ? s.reachable : s.keySource !== 'none'))
  const localUp = status.filter((s) => s.local && s.reachable)

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 max-w-[1500px] mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight">{t('Panel')}</h1>
            <p className="text-[12.5px] text-dim mt-0.5">
              {t('dash.lastDays', { n: days })}
            </p>
          </div>
          <Tabs
            value={String(days) as any}
            onChange={(v) => setDays(Number(v) as 7 | 30 | 90)}
            items={[
              { id: '7' as any, label: '7 d' },
              { id: '30' as any, label: '30 d' },
              { id: '90' as any, label: '90 d' }
            ]}
          />
        </div>

        {/* ------------------------------------------------ Métricas clave */}
        <div className="grid grid-cols-5 gap-3">
          <Stat
            label={t('Ejecuciones')}
            value={ov?.totalRuns ?? '—'}
            sub={ov ? `${ov.runsToday} hoy` : ''}
            icon={<Activity size={14} />}
          />
          <Stat
            label={t('Gasto')}
            value={ov ? cost(ov.totalCost + inflight.cost) : '—'}
            sub={
              ov
                ? `${cost(ov.costMonth + inflight.cost)} este mes` +
                  (inflight.count ? ` · ${inflight.count} en curso` : '')
                : ''
            }
            tone="accent"
            icon={<DollarSign size={14} />}
          />
          <Stat
            label="Tokens"
            value={ov ? tokens(ov.totalTokensIn + ov.totalTokensOut + inflight.tokens) : '—'}
            sub={ov ? `${tokens(ov.totalTokensIn)} in · ${tokens(ov.totalTokensOut)} out` : ''}
            icon={<Coins size={14} />}
          />
          <Stat
            label={t('Latencia inicial')}
            value={ov ? ms(ov.avgTtft) : '—'}
            sub="media hasta el primer token"
            icon={<Timer size={14} />}
          />
          <Stat
            label={t('Velocidad')}
            value={ov ? tps(ov.avgTps) : '—'}
            sub={ov && ov.errorRate > 0 ? `${pct(ov.errorRate)} de errores` : t('sin errores')}
            tone={ov && ov.errorRate > 0.1 ? 'warn' : 'ok'}
            icon={<Zap size={14} />}
          />
        </div>

        {/* --------------------------------------- Consumo y límites */}
        <div className={cx('grid gap-3', claude ? 'grid-cols-3' : 'grid-cols-1')}>
          <Panel className={claude ? 'col-span-2' : ''}>
            <PanelHeader
              title={t('Consumo y límites')}
              subtitle={t('lo que cada proveedor dice que te queda y cuándo se repone')}
              icon={<Gauge size={14} />}
            />
            <UsageRows />
          </Panel>

          {/* Claude Code no publica su tope, pero sí cuándo se reinicia la
              cuenta: con lo gastado en la máquina ya se sabe por dónde vas. */}
          {claude ? (
            <Panel>
              <PanelHeader title={t('Plan de Claude')} subtitle={t('incluye lo que lanzas en la terminal')} icon={<Timer size={14} />} />
              <div className="p-3">
                <ClaudeWindows usage={claude} />
              </div>
            </Panel>
          ) : null}
        </div>

        {empty ? (
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

        {/* ------------------------------------------------ Gasto en el tiempo */}
        {/* Las gráficas sólo existen mientras se ven. Recalcular dos lienzos
            de recharts contra un contenedor de tamaño cero, que es lo que hay
            cuando la sección está oculta, no le sirve a nadie. */}
        {!empty && active ? (
          <Suspense fallback={<div className="h-[268px]" />}>
            <DashboardCharts data={chartData} />
          </Suspense>
        ) : null}

        {/* ------------------------------------------------ Comparativa por modelo */}
        {!empty ? (
          <div className="grid grid-cols-3 gap-3">
            <Panel className="col-span-2">
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
                      <th className="text-right font-medium w-14">Ejec.</th>
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
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: colorFor(m.key) }}
                            />
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
                            <span className="num text-[11.5px] text-muted w-14 text-right shrink-0">
                              {cost(m.cost)}
                            </span>
                          </div>
                        </td>
                        <td className="pl-3">
                          <div className="flex items-center gap-2">
                            <Meter value={m.avgTps} max={maxTps} color="#34d399" />
                            <span className="num text-[11.5px] text-muted w-11 text-right shrink-0">
                              {m.avgTps ? m.avgTps.toFixed(0) : '—'}
                            </span>
                          </div>
                        </td>
                        <td className="num text-right text-[11.5px] text-muted">{ms(m.avgTtft)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={t('Últimas ejecuciones')} icon={<Activity size={14} />} />
              <div className="divide-y divide-[#171a26] max-h-[260px] overflow-y-auto">
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
          </div>
        ) : null}

        {/* ------------------------------------------------ Infraestructura */}
        <div className="grid grid-cols-3 gap-3">
          <Panel className="col-span-2">
            <PanelHeader
              title={t('Proveedores activos')}
              subtitle={`${activeProviders.length} de ${status.length} listos · ${models.length} modelos disponibles`}
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
              <div className="p-3 grid grid-cols-3 gap-2">
                {activeProviders.map((p) => (
                  <div
                    key={p.id}
                    className="bg-raised border border-line rounded-lg px-3 py-2 flex items-center gap-2.5"
                  >
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
                    <span className="num text-[11px] text-dim">{s.modelCount} modelos</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
