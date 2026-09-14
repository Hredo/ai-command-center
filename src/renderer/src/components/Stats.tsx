/**
 * Franjas de métricas. Dos variantes:
 *
 * - `Metrics`: los números definitivos de una ejecución terminada, con el uso
 *   real que ha informado el proveedor.
 * - `LiveMetrics`: lo que se puede saber mientras aún está generando. El
 *   tiempo y los caracteres son exactos; los tokens son una estimación
 *   (~4 caracteres por token) y se marcan como tal para no dar por real algo
 *   que no lo es. Al terminar, los reales sustituyen a la estimación.
 */
import React from 'react'
import { Coins, Timer, Zap, DollarSign, Hash, Gauge } from 'lucide-react'
import { Badge, cx } from './ui'
import { cost, tokens, ms, tps } from '../lib/format'
import { useTick, type LiveMetrics as Live } from '../lib/engine'
import type { TurnMetrics } from '@shared/types'

import { useT } from '../lib/i18n'
export function Metrics({ m, className }: { m: TurnMetrics; className?: string }): React.JSX.Element {
  const t = useT()
  const items = [
    {
      icon: Coins,
      label: `${tokens(m.promptTokens)} → ${tokens(m.completionTokens)}`,
      title: t('tokens de entrada → tokens de salida')
    },
    { icon: Timer, label: ms(m.ttftMs), title: t('tiempo hasta el primer token') },
    { icon: Zap, label: tps(m.tokensPerSec), title: t('velocidad de generación') },
    { icon: Gauge, label: ms(m.totalMs), title: t('tiempo total') },
    {
      icon: DollarSign,
      label: cost(m.costTotal) + (m.costEstimated ? '*' : ''),
      title: m.costEstimated
        ? t('coste estimado con los precios del catálogo')
        : t('coste informado por el proveedor')
    }
  ]

  return (
    <div className={cx('flex items-center gap-3 flex-wrap mt-2.5 pt-2.5 border-t border-line-soft', className)}>
      {items.map((it, i) => (
        <span key={i} title={it.title} className="flex items-center gap-1.5 text-[11px] text-dim">
          <it.icon size={11} />
          <span className="num">{it.label}</span>
        </span>
      ))}
      {m.cachedTokens ? <Badge tone="violet">{t('stats.cached', { n: tokens(m.cachedTokens) })}</Badge> : null}
      {m.reasoningTokens ? <Badge tone="accent">{t('stats.reasoning', { n: tokens(m.reasoningTokens) })}</Badge> : null}
      {m.status === 'aborted' ? <Badge tone="warn">{t('parado a medias')}</Badge> : null}
    </div>
  )
}

/** Métricas en vivo mientras el modelo o el agente está generando. */
export function LiveMetrics({
  live,
  compact,
  className
}: {
  live: Live
  compact?: boolean
  className?: string
}): React.JSX.Element {
  const t = useT()
  // El reloj del motor repinta esto cuatro veces por segundo.
  useTick()

  const elapsed = Date.now() - live.startedAt
  // La velocidad honesta excluye la espera inicial: se cuenta desde que
  // apareció el primer token, que es cuando de verdad empieza a generar.
  const genMs = live.ttftMs != null ? Math.max(1, elapsed - live.ttftMs) : 0
  const speed = genMs > 250 ? live.approxTokens / (genMs / 1000) : 0

  const items: { icon: React.ElementType; label: string; title: string; tone?: string }[] = [
    { icon: Gauge, label: ms(elapsed), title: t('tiempo transcurrido') },
    {
      icon: Timer,
      label: live.ttftMs != null ? ms(live.ttftMs) : t('esperando'),
      title: t('tiempo hasta el primer token'),
      tone: live.ttftMs == null ? 'text-warn' : undefined
    },
    {
      icon: Hash,
      label: `~${tokens(live.approxTokens)}`,
      title: t('tokens de salida estimados; los reales llegan al terminar')
    },
    {
      icon: Zap,
      label: speed > 0 ? `~${speed.toFixed(1)} t/s` : '—',
      title: t('velocidad estimada, medida desde el primer token')
    }
  ]

  return (
    <div
      className={cx(
        'flex items-center gap-3',
        // En la cabecera no se parte en dos renglones: se saldría de su franja
        // y taparía lo que hay debajo.
        compact ? 'flex-nowrap whitespace-nowrap' : 'flex-wrap mt-2.5 pt-2.5 border-t border-line-soft',
        className
      )}
    >
      {items.map((it, i) => (
        <span
          key={i}
          title={it.title}
          className={cx('flex items-center gap-1.5 text-[11px]', it.tone ?? 'text-dim')}
        >
          <it.icon size={11} />
          <span className="num">{it.label}</span>
        </span>
      ))}
      <span className="text-[10px] text-[#3a4255]" title={t('Los tokens y la velocidad son estimados hasta que termina')}>
        {t('en vivo')}
      </span>
    </div>
  )
}
