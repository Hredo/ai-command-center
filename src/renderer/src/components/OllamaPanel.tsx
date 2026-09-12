/**
 * Gestión de Ollama desde dentro de la app: estado del servidor, hardware de
 * la máquina, modelos instalados y recomendaciones para descargar.
 *
 * Las recomendaciones se calculan con la VRAM real de la GPU y con el peso que
 * publica el registro de Ollama, no con una lista fija: un modelo que entra
 * entero en la tarjeta va mucho más rápido que uno repartido con la RAM, y eso
 * pesa más que la nota de calidad al ordenarlos.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  Cpu, HardDrive, Power, RefreshCw, Trash2, Download, Check, AlertTriangle,
  MonitorPlay, Zap, CircleSlash, X, Sparkles, ExternalLink
} from 'lucide-react'
import { Panel, PanelHeader, Button, Badge, Empty, cx, Dot, Modal, Spinner } from './ui'
import { bytes, relTime } from '../lib/format'
import { useStore } from '../lib/store'
import type { HardwareInfo, ModelRecommendation, OllamaModel, OllamaStatus, PullProgress } from '@shared/types'

import { useT } from '../lib/i18n'
function fitBadge(fit: ModelRecommendation['fits']): React.JSX.Element {
  const t = useT()
  if (fit === 'gpu') {
    return (
      <Badge tone="ok" title={t('Los pesos caben enteros en la VRAM: va a máxima velocidad')}>
        <Zap size={9} /> {t('entra en la GPU')}
      </Badge>
    )
  }
  if (fit === 'partial') {
    return (
      <Badge tone="warn" title={t('Parte de los pesos van a la RAM del sistema: irá más lento')}>
        {t('reparte con la RAM')}
      </Badge>
    )
  }
  return (
    <Badge tone="bad" title={t('No cabe: iría por CPU y sería impracticable')}>
      <CircleSlash size={9} /> {t('no cabe')}
    </Badge>
  )
}

function ProgressBar({ p }: { p: PullProgress }): React.JSX.Element {
  const pct = p.total && p.completed ? Math.min(100, (p.completed / p.total) * 100) : null
  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-[#1a1f2e] rounded-full overflow-hidden">
        <div
          className={cx('h-full rounded-full transition-all', pct == null && 'animate-pulse')}
          style={{
            width: pct == null ? '100%' : `${pct}%`,
            background: 'linear-gradient(90deg,#22d3ee,#a78bfa)'
          }}
        />
      </div>
      <div className="flex items-center justify-between text-[10.5px] text-dim">
        <span>{p.status}</span>
        {p.total ? (
          <span className="num">
            {bytes(p.completed ?? 0)} / {bytes(p.total)}
            {pct != null ? ` · ${pct.toFixed(0)}%` : ''}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function OllamaPanel(): React.JSX.Element {
  const t = useT()
  const { toast, reloadStatus, reloadModels } = useStore()
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [recs, setRecs] = useState<ModelRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recsLoading, setRecsLoading] = useState(false)
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({})
  const [confirmDelete, setConfirmDelete] = useState<OllamaModel | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [s, h] = await Promise.all([window.api.ollama.status(), window.api.ollama.hardware()])
    setLoading(false)
    if (s.ok && s.data) setStatus(s.data)
    if (h.ok && h.data) setHw(h.data)
  }, [])

  const loadRecs = useCallback(async () => {
    setRecsLoading(true)
    const r = await window.api.ollama.recommend()
    setRecsLoading(false)
    if (r.ok && r.data) {
      setRecs(r.data.items)
      setHw(r.data.hw)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // El avance de las descargas llega por evento desde el proceso principal.
  useEffect(() => {
    return window.api.ollama.onPullProgress((p) => {
      setPulls((prev) => {
        if (p.done) {
          const next = { ...prev }
          delete next[p.model]
          return next
        }
        return { ...prev, [p.model]: p }
      })
    })
  }, [])

  const start = async (): Promise<void> => {
    setStarting(true)
    const r = await window.api.ollama.start()
    setStarting(false)
    if (r.ok && r.data?.started) {
      toast('ok', `Ollama arrancado · ${r.data.detail}`)
      await refresh()
      await reloadStatus()
      await reloadModels()
    } else {
      toast('error', r.data?.detail ?? r.error ?? t('No se pudo arrancar Ollama'))
    }
  }

  const pull = async (name: string): Promise<void> => {
    setPulls((p) => ({ ...p, [name]: { model: name, status: 'preparando' } }))
    const r = await window.api.ollama.pull(name)
    setPulls((p) => {
      const next = { ...p }
      delete next[name]
      return next
    })
    if (r.ok && r.data?.ok) {
      toast('ok', `${name} descargado`)
      await refresh()
      await reloadModels()
      await loadRecs()
    } else if (r.data?.cancelled) {
      toast('info', `Descarga de ${name} cancelada`)
    } else {
      toast('error', r.error ?? `No se pudo descargar ${name}`)
    }
  }

  const remove = async (m: OllamaModel): Promise<void> => {
    setConfirmDelete(null)
    const r = await window.api.ollama.remove(m.name)
    if (r.ok) {
      toast('ok', `${m.name} borrado · ${bytes(m.sizeBytes)} liberados`)
      await refresh()
      await reloadModels()
      await loadRecs()
    } else {
      toast('error', r.error ?? `No se pudo borrar ${m.name}`)
    }
  }

  const installed = new Set((status?.models ?? []).map((m) => m.name))
  const diskUsed = (status?.models ?? []).reduce((s, m) => s + m.sizeBytes, 0)
  const primaryGpu = hw?.gpus.find((g) => g.primary) ?? hw?.gpus[0]

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------ Estado */}
      <Panel>
        <PanelHeader
          title="Ollama"
          icon={<Cpu size={14} />}
          subtitle={status?.baseUrl}
          right={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => void refresh()} loading={loading}>
                <RefreshCw size={13} />
              </Button>
              {status && !status.up ? (
                <Button size="sm" variant="primary" onClick={() => void start()} loading={starting} disabled={!status.installed}>
                  <Power size={13} /> {t('Arrancar')}
                </Button>
              ) : null}
            </div>
          }
        />
        <div className="p-4">
          {!status ? (
            <Spinner />
          ) : status.up ? (
            <div className="flex items-center gap-5 text-[12.5px] flex-wrap">
              <span className="flex items-center gap-1.5">
                <Dot tone="ok" /> {t('Encendido')}
              </span>
              {status.version ? <span className="num text-dim">v{status.version}</span> : null}
              <span className="num text-dim">
                {t('ollama.installed', { n: status.models.length, size: bytes(diskUsed) })}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" />
              <div className="text-[12.5px] leading-relaxed">
                <div className="text-warn font-medium mb-0.5">
                  {status.installed ? t('Instalado pero apagado') : t('No está instalado')}
                </div>
                <div className="text-muted">
                  {status.installed ? (
                    <>
                      {t('ollama.notResponding', { url: status.baseUrl })}
                      {status.error ? <span className="text-dim"> ({status.error})</span> : null}
                    </>
                  ) : (
                    <>
                      {t('No encuentro el ejecutable en este equipo.')}{' '}
                      <button
                        onClick={() => void window.api.app.openExternal('https://ollama.com/download')}
                        className="text-accent hover:underline inline-flex items-center gap-1"
                      >
                        {t('Descargar Ollama')} <ExternalLink size={10} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* ------------------------------------------------ Hardware */}
      <Panel>
        <PanelHeader title={t('Tu equipo')} icon={<MonitorPlay size={14} />} />
        <div className="p-4 grid grid-cols-3 gap-4 text-[12.5px]">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Procesador')}</div>
            <div className="truncate" title={hw?.cpu}>{hw?.cpu ?? '—'}</div>
            <div className="num text-[11px] text-dim mt-0.5">{hw?.cores ?? '—'} hilos</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Memoria')}</div>
            <div className="num">{hw ? `${hw.ramGb} GB` : '—'}</div>
            <div className="text-[11px] text-dim mt-0.5">{t('RAM del sistema')}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Gráfica')}</div>
            <div className="truncate" title={primaryGpu?.name}>{primaryGpu?.name ?? '—'}</div>
            <div className="num text-[11px] text-dim mt-0.5">
              {primaryGpu?.vramMb ? `${(primaryGpu.vramMb / 1024).toFixed(1)} GB de VRAM` : t('VRAM sin determinar')}
            </div>
          </div>
        </div>
        {hw && hw.gpus.length > 1 ? (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
            {hw.gpus.filter((g) => !g.primary).map((g) => (
              <Badge key={g.name}>{g.name}</Badge>
            ))}
          </div>
        ) : null}
      </Panel>

      {/* ------------------------------------------------ Instalados */}
      <Panel>
        <PanelHeader
          title={t('Modelos instalados')}
          icon={<HardDrive size={14} />}
          subtitle={status?.models.length ? `${bytes(diskUsed)} ocupados` : undefined}
          right={<span className="num text-[11.5px] text-dim">{status?.models.length ?? 0}</span>}
        />
        {!status?.up ? (
          <div className="px-4 py-5 text-[12.5px] text-dim">{t('Arranca Ollama para ver sus modelos.')}</div>
        ) : status.models.length === 0 ? (
          <Empty
            icon={<HardDrive size={26} />}
            title={t('No tienes ningún modelo')}
            hint={t('Descarga uno de los recomendados de abajo: están ordenados por cómo rinden en tu equipo.')}
          />
        ) : (
          <div className="divide-y divide-[#171a26]">
            {status.models.map((m) => (
              <div key={m.name} className="px-4 py-2.5 flex items-center gap-3">
                <Cpu size={13} className="text-ok shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12.5px] truncate">{m.name}</div>
                  <div className="text-[10.5px] text-dim flex items-center gap-2 flex-wrap">
                    {m.parameterSize ? <span>{m.parameterSize}</span> : null}
                    {m.quantization ? <span>{m.quantization}</span> : null}
                    {m.family ? <span>{m.family}</span> : null}
                    {m.modifiedAt ? <span>{relTime(m.modifiedAt)}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(m.capabilities ?? []).includes('tools') ? <Badge tone="violet">{t('herramientas')}</Badge> : null}
                  {(m.capabilities ?? []).includes('vision') ? <Badge tone="accent">{t('visión')}</Badge> : null}
                  <span className="num text-[11.5px] text-muted w-[72px] text-right">{bytes(m.sizeBytes)}</span>
                  <button
                    onClick={() => setConfirmDelete(m)}
                    className="text-dim hover:text-bad transition-colors p-1"
                    title={t('Borrar del disco')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ------------------------------------------------ Recomendaciones */}
      <Panel>
        <PanelHeader
          title={t('Recomendados para tu equipo')}
          icon={<Sparkles size={14} />}
          subtitle={
            primaryGpu?.vramMb
              ? t('ollama.computedWith', {
                  vram: (primaryGpu.vramMb / 1024).toFixed(1),
                  ram: hw?.ramGb ?? '?'
                })
              : t('Sin VRAM detectada: se ordena suponiendo que todo va por CPU')
          }
          right={
            <Button size="sm" variant="ghost" onClick={() => void loadRecs()} loading={recsLoading}>
              <RefreshCw size={13} /> {recs.length ? 'Recalcular' : 'Calcular'}
            </Button>
          }
        />
        {recs.length === 0 ? (
          <div className="px-4 py-5">
            {recsLoading ? (
              <div className="flex items-center gap-2 text-[12.5px] text-dim">
                <Spinner /> {t('Consultando pesos reales en el registro de Ollama…')}
              </div>
            ) : (
              <div className="text-[12.5px] text-dim leading-relaxed">
                {t('Pulsa «Calcular» y la app consulta el peso real de cada candidato en el registro de Ollama y los ordena según lo que aguanta tu GPU.')}
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#171a26]">
            {recs.map((r) => {
              const has = installed.has(r.name)
              const prog = pulls[r.name]
              return (
                <div key={r.name} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-mono text-[12.5px]">{r.name}</span>
                        <span className="text-[11.5px] text-dim">{r.params}</span>
                        {fitBadge(r.fits)}
                        {has ? (
                          <Badge tone="ok">
                            <Check size={9} /> {t('instalado')}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[12px] text-muted leading-relaxed">{r.why}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {r.tags.map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 text-right space-y-1.5">
                      <div className="num text-[12px] text-muted">{r.sizeGb} GB</div>
                      {prog ? (
                        <Button size="sm" variant="danger" onClick={() => void window.api.ollama.cancelPull(r.name)}>
                          <X size={11} /> {t('Cancelar')}
                        </Button>
                      ) : has ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const m = status?.models.find((x) => x.name === r.name)
                            if (m) setConfirmDelete(m)
                          }}
                        >
                          <Trash2 size={11} />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void pull(r.name)}
                          disabled={!status?.up}
                          title={status?.up ? t('Descargar con Ollama') : 'Arranca Ollama primero'}
                        >
                          <Download size={11} /> {t('Instalar')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {prog ? (
                    <div className="mt-2.5">
                      <ProgressBar p={prog} />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {/* Confirmación de borrado */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={t('Borrar el modelo')}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" onClick={() => confirmDelete && void remove(confirmDelete)}>
              <Trash2 size={13} /> {t('Borrar')}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted leading-relaxed">
          {t('ollama.deleteExplain', {
            name: confirmDelete?.name ?? '',
            size: bytes(confirmDelete?.sizeBytes ?? 0)
          })}
        </p>
        <p className="text-[12.5px] text-dim leading-relaxed mt-2">
          Se puede volver a descargar cuando quieras; lo que se pierde es el tiempo de bajada.
        </p>
      </Modal>
    </div>
  )
}
