/**
 * Cupos de todas tus IAs: planes, saldos, límites de ritmo y presupuestos.
 *
 * Cada fila dice qué mide, cuánto llevas, cuándo se repone y de dónde sale el
 * dato (oficial, medido o tuyo). Sin tope conocido no hay barra ni
 * porcentaje: se enseña lo gastado y el ritmo, nunca un tope inventado. Lo
 * que no se puede saber desde aquí se dice al final, con enlace a su panel.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Gauge, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { Panel, PanelHeader, Button, Badge, cx } from './ui'
import { useQuotas, refreshQuotas } from '../lib/engine'
import { cost, tokens, relTime } from '../lib/format'
import { useT, type Translate } from '../lib/i18n'
import type { Quota } from '@shared/types'

/** Se repinta cada 30 s: las cuentas atrás y los «hace un momento» se mueven. */
function useMinuteTick(): void {
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])
}

function money(v: number, unit: Quota['unit']): string {
  if (unit === 'cny') return `¥${v.toFixed(v < 10 ? 2 : 0)}`
  return cost(v)
}

function amount(v: number, unit: Quota['unit']): string {
  if (unit === 'usd' || unit === 'cny') return money(v, unit)
  if (unit === 'tokens') return tokens(v)
  if (unit === 'percent') return `${Math.round(v)} %`
  return Math.round(v).toLocaleString()
}

export function duration(msLeft: number): string {
  const m = Math.max(0, Math.round(msLeft / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${m % 60} min`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

function when(at: number): string {
  const d = new Date(at)
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return hm
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}`
}

function toneOf(pct?: number): 'ok' | 'warn' | 'bad' | undefined {
  if (pct == null) return undefined
  return pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : 'ok'
}

const BAR: Record<'ok' | 'warn' | 'bad', string> = { ok: '#34d399', warn: '#fbbf24', bad: '#f87171' }

/** Lo que se ve a la derecha de la fila. */
function valueText(q: Quota, t: Translate): string {
  if (q.unit === 'percent') return q.usedPct != null ? `${Math.round(q.usedPct)} %` : '—'
  if (q.used != null && q.limit != null) return `${amount(q.used, q.unit)} / ${amount(q.limit, q.unit)}`
  if (q.remaining != null && q.used == null) return t('quedan {n}', { n: amount(q.remaining, q.unit) })
  if (q.used != null) return q.unit === 'requests' ? t('{n} peticiones', { n: amount(q.used, q.unit) }) : amount(q.used, q.unit)
  return '—'
}

function rateText(q: Quota): string | null {
  const r = q.projection?.ratePerHour
  if (!r) return null
  if (q.used == null) return `${r.toFixed(r < 10 ? 1 : 0)} %/h`
  if (q.unit === 'usd' || q.unit === 'cny') return `${money(r, q.unit)}/h`
  if (q.unit === 'tokens') return `${tokens(r)}/h`
  return `${r.toFixed(r < 10 ? 1 : 0)}/h`
}

/** Las explicaciones llegan como frases sueltas: se traduce cada una. */
export function howText(how: string, t: Translate): string {
  return how
    .split('\n')
    .filter(Boolean)
    .map((line) => t(line))
    .join(' ')
}

const ORIGIN: Record<Quota['origin'], { label: string; tone: 'ok' | 'accent' | 'violet' }> = {
  official: { label: 'Oficial', tone: 'ok' },
  measured: { label: 'Medido', tone: 'accent' },
  own: { label: 'Tuyo', tone: 'violet' }
}

function QuotaRow({ q }: { q: Quota }): React.JSX.Element {
  const t = useT()
  const now = Date.now()
  const tone = toneOf(q.usedPct)
  const o = ORIGIN[q.origin]
  const rate = rateText(q)
  const p = q.projection

  const bits: React.ReactNode[] = []
  if (q.resetsAt && q.resetsAt > now) bits.push(t('se repone en {at}', { at: duration(q.resetsAt - now) }))
  else if (q.windowMs && !q.resetsAt && q.kind === 'window') bits.push(t('ventana móvil'))
  if (p?.etaAt && p.hitsBeforeReset !== false) {
    bits.push(
      <span key="eta" className={p.hitsBeforeReset ? 'text-warn' : undefined}>
        {p.etaAt <= now ? t('en el tope') : t('a este ritmo, tope a las {at}', { at: when(p.etaAt) })}
      </span>
    )
  } else if (p?.etaAt && p.hitsBeforeReset === false) {
    bits.push(t('a este ritmo no llegas al tope antes de reponerse'))
  } else if (rate) {
    bits.push(t('ritmo: {r}', { r: rate }))
  }
  if (q.stale) bits.push(<span key="stale" className="text-warn">{t('dato de {ago}', { ago: relTime(q.updatedAt) })}</span>)

  return (
    <div className="space-y-1" title={howText(q.how, t)}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="flex-1 min-w-0 truncate">
          {q.target && q.providerKey === 'budget' ? <span className="text-muted">{q.target} · </span> : null}
          {t(q.label)}
        </span>
        <Badge tone={o.tone} className="shrink-0">{t(o.label)}</Badge>
        <span className={cx('num shrink-0 text-[11.5px]', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-muted')}>
          {valueText(q, t)}
        </span>
      </div>
      {q.usedPct != null ? (
        <div className="h-1.5 bg-[#1a1e2b] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(2, Math.min(100, q.usedPct))}%`, background: BAR[tone ?? 'ok'], opacity: q.stale ? 0.45 : 1 }}
          />
        </div>
      ) : null}
      {q.error ? <div className="text-[10.5px] text-bad truncate">{t(q.error)}</div> : null}
      {bits.length ? (
        <div className="text-[10.5px] text-dim flex flex-wrap gap-x-2">
          {bits.map((b, i) => (
            <span key={i}>{b}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function QuotasPanel({ onSettings }: { onSettings?: () => void }): React.JSX.Element {
  const t = useT()
  const report = useQuotas()
  const [busy, setBusy] = useState(false)
  useMinuteTick()

  const groups = useMemo(() => {
    const map = new Map<string, Quota[]>()
    for (const q of report?.quotas ?? []) {
      const key = q.provider
      map.set(key, [...(map.get(key) ?? []), q])
    }
    return [...map.entries()]
  }, [report])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    await refreshQuotas()
    setBusy(false)
  }

  return (
    <Panel>
      <PanelHeader
        title={t('Cupos de tus IAs')}
        subtitle={t('planes, saldos, límites y presupuestos de todas las IAs que usas')}
        icon={<Gauge size={14} />}
        right={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void refresh()} title={t('Volver a preguntar a todas las fuentes')}>
              <RefreshCw size={13} />
            </Button>
            {onSettings ? (
              <Button size="sm" variant="ghost" onClick={onSettings}>
                <SettingsIcon size={13} /> {t('Ajustes')}
              </Button>
            ) : null}
          </div>
        }
      />
      {!report ? (
        <div className="px-4 py-5 text-[12px] text-dim">{t('Leyendo los cupos…')}</div>
      ) : !groups.length && !report.gaps.length ? (
        <div className="px-4 py-5 text-[12px] text-dim leading-relaxed">
          {t('Todavía no hay ningún cupo que enseñar. Aparecen en cuanto usas Claude Code, Codex, Gemini CLI u OpenCode Go, pones una clave con saldo o creas un presupuesto.')}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {groups.length ? (
            <div className="grid grid-cols-3 gap-2">
              {groups.map(([provider, list]) => {
                const target = list[0].providerKey !== 'budget' ? list[0].target : undefined
                return (
                  <div key={provider} className="bg-raised border border-line rounded-lg px-3 py-2.5 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium truncate">{t(provider)}</span>
                      {target ? <span className="text-[10.5px] text-dim truncate">{t(target)}</span> : null}
                    </div>
                    {list.map((q) => (
                      <QuotaRow key={q.id} q={q} />
                    ))}
                  </div>
                )
              })}
            </div>
          ) : null}

          {report.gaps.length ? (
            <div className="border-t border-line pt-2.5 space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-dim">{t('Sin dato desde aquí')}</div>
              {report.gaps.map((g) => (
                <div key={g.provider} className="flex items-start gap-2 text-[11.5px]">
                  <span className="text-muted shrink-0">{t(g.provider)}</span>
                  <span className="text-dim flex-1 leading-relaxed">{t(g.why)}</span>
                  {g.url ? (
                    <button
                      className="text-accent hover:underline shrink-0 inline-flex items-center gap-1"
                      onClick={() => void window.api.app.openExternal(g.url!)}
                    >
                      {t('Abrir')} <ExternalLink size={11} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}
