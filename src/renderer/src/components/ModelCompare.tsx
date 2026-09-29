/**
 * Comparador de modelos: precio, contexto, capacidades y puntuaciones
 * públicas, junto a lo que tú has medido con ellos (latencia, velocidad,
 * coste por ejecución y tu Elo de la Arena). En cada fila se marca el mejor.
 */
import React from 'react'
import { Check, Minus, Star } from 'lucide-react'
import { Modal, Button, cx } from './ui'
import { price, tokens, ms, tps, cost } from '../lib/format'
import { useT } from '../lib/i18n'
import type { ModelInfo, ModelUsage } from '@shared/types'

export const modelFavKey = (m: Pick<ModelInfo, 'providerId' | 'id'>): string => `${m.providerId}:${m.id}`
export const usageOf = (usage: ModelUsage[], m: Pick<ModelInfo, 'providerId' | 'id'>): ModelUsage | undefined =>
  usage.find((u) => u.providerId === m.providerId && u.model === m.id)

type Better = 'high' | 'low'

interface Row {
  label: string
  /** Valor numérico para buscar el mejor; sin él la fila no marca a nadie. */
  value?: (m: ModelInfo, u?: ModelUsage) => number | undefined
  better?: Better
  show: (m: ModelInfo, u?: ModelUsage) => React.ReactNode
}

function yes(v?: boolean): React.ReactNode {
  if (v === true) return <Check size={13} className="text-ok inline" />
  if (v === false) return <Minus size={13} className="text-dim inline" />
  return <span className="text-dim">—</span>
}

export function ModelCompare({
  open,
  onClose,
  models,
  usage,
  providerName,
  favorites
}: {
  open: boolean
  onClose: () => void
  models: ModelInfo[]
  usage: ModelUsage[]
  providerName: (id: string) => string
  favorites: string[]
}): React.JSX.Element {
  const t = useT()
  const perRun = (u?: ModelUsage): number | undefined => (u && u.runs ? u.cost / u.runs : undefined)

  const rows: Row[] = [
    { label: t('Proveedor'), show: (m) => providerName(m.providerId) },
    { label: t('Contexto'), value: (m) => m.contextLength, better: 'high', show: (m) => (m.contextLength ? tokens(m.contextLength) : '—') },
    { label: t('Salida máxima'), value: (m) => m.maxOutput, better: 'high', show: (m) => (m.maxOutput ? tokens(m.maxOutput) : '—') },
    { label: t('$ / M entrada'), value: (m) => m.priceIn, better: 'low', show: (m) => price(m.priceIn) },
    { label: t('$ / M salida'), value: (m) => m.priceOut, better: 'low', show: (m) => price(m.priceOut) },
    { label: t('Calidad (AA)'), value: (m) => m.bench?.intelligence, better: 'high', show: (m) => m.bench?.intelligence ?? '—' },
    { label: t('Código (AA)'), value: (m) => m.bench?.coding, better: 'high', show: (m) => m.bench?.coding ?? '—' },
    { label: t('Agéntico (AA)'), value: (m) => m.bench?.agentic, better: 'high', show: (m) => m.bench?.agentic ?? '—' },
    { label: t('Razona'), show: (m) => yes(m.caps?.reasoning) },
    { label: t('Herramientas'), show: (m) => yes(m.caps?.tools) },
    { label: t('Salida estructurada'), show: (m) => yes(m.caps?.structured) },
    { label: t('Pesos abiertos'), show: (m) => yes(m.caps?.openWeights) },
    { label: t('Sabe hasta'), show: (m) => m.knowledge ?? '—' },
    { label: t('Tus ejecuciones'), value: (_m, u) => u?.runs, show: (_m, u) => u?.runs ?? 0 },
    { label: t('Tu latencia inicial'), value: (_m, u) => u?.avgTtft || undefined, better: 'low', show: (_m, u) => (u?.avgTtft ? ms(u.avgTtft) : '—') },
    { label: t('Tu velocidad'), value: (_m, u) => u?.avgTps || undefined, better: 'high', show: (_m, u) => (u?.avgTps ? tps(u.avgTps) : '—') },
    { label: t('Coste medio por ejecución'), value: (_m, u) => perRun(u), better: 'low', show: (_m, u) => (perRun(u) != null ? cost(perRun(u)!) : '—') },
    { label: t('Tus errores'), value: (_m, u) => (u?.runs ? u.errors / u.runs : undefined), better: 'low', show: (_m, u) => (u?.runs ? `${Math.round((u.errors / u.runs) * 100)} %` : '—') },
    { label: t('Tu Elo (Arena)'), value: (_m, u) => u?.elo, better: 'high', show: (_m, u) => (u?.elo ? `${u.elo} · ${u.wins}/${u.games}` : '—') }
  ]

  const best = (row: Row): number | undefined => {
    if (!row.value || !row.better) return undefined
    const vals = models.map((m) => row.value!(m, usageOf(usage, m))).filter((v): v is number => v != null)
    if (vals.length < 2) return undefined
    return row.better === 'high' ? Math.max(...vals) : Math.min(...vals)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Comparar modelos')}
      width="max-w-5xl"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line">
              <th className="text-left py-2 pr-3 font-medium text-dim w-[190px]" />
              {models.map((m) => (
                <th key={modelFavKey(m)} className="text-left py-2 px-2 font-medium align-bottom">
                  <div className="flex items-center gap-1.5">
                    {favorites.includes(modelFavKey(m)) ? <Star size={11} className="text-warn fill-current shrink-0" /> : null}
                    <span className="font-mono break-all">{m.id}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const top = best(row)
              return (
                <tr key={row.label} className="border-b border-line-soft">
                  <td className="py-1.5 pr-3 text-dim">{row.label}</td>
                  {models.map((m) => {
                    const u = usageOf(usage, m)
                    const v = row.value?.(m, u)
                    return (
                      <td key={modelFavKey(m)} className={cx('py-1.5 px-2 num', top != null && v === top ? 'text-ok' : 'text-muted')}>
                        {row.show(m, u)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-dim leading-relaxed mt-3">
        {t('Calidad, código y agéntico son los índices de Artificial Analysis que publica OpenRouter (0–100). Lo demás de abajo es tuyo: sale de tus ejecuciones y de los ganadores que marcas en la Arena.')}
      </p>
    </Modal>
  )
}
