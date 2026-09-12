/**
 * Las piezas que rodean a un agente mientras trabaja: dónde está (rama),
 * cuánto contexto le queda, qué límites tiene, qué archivos toca y con cuánto
 * esfuerzo. Se usan igual en la Consola y en la pestaña de agente de un
 * proyecto, así que viven aquí y no dentro de una página.
 *
 * Norma de la casa: si un dato no llega, no se dibuja. Un porcentaje inventado
 * es peor que un hueco.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  GitBranch, Paperclip, X, FileText, FilePlus2, FileMinus2, FileQuestion,
  Eye, Pencil, TerminalSquare, Search, Gauge, ChevronDown, Check, Plus, Loader2
} from 'lucide-react'
import { Badge, Button, cx, Meter } from './ui'
import { tokens, cost, bytes as fmtBytes } from '../lib/format'
import {
  EFFORTS, type Attachment, type ClaudeUsage, type Effort, type FileChange, type FileTouch,
  type GitInfo, type GitOpState, type UsageLimit, type UsageSnapshot
} from '@shared/types'
import { useT, type Translate } from '../lib/i18n'

/**
 * Etiquetas del nivel de esfuerzo.
 *
 * Se quedan en texto plano porque esto es una constante de modulo y ahi no hay
 * hooks: quien las pinta las pasa por t() en su sitio.
 */
export const EFFORT_LABEL: Record<Effort, string> = {
  auto: 'Automático',
  minimal: 'Mínimo',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  max: 'Máximo'
}

/* ------------------------------------------------------------------ *
 * Contexto                                                           *
 * ------------------------------------------------------------------ */

export function ContextGauge({
  used,
  limit,
  compact
}: {
  used?: number
  limit?: number
  compact?: boolean
}): React.JSX.Element | null {
  const t = useT()
  if (!used && !limit) return null
  const pctUsed = used != null && limit ? Math.min(100, (used / limit) * 100) : null
  const tone = pctUsed == null ? '#3b82f6' : pctUsed > 90 ? '#f0505f' : pctUsed > 70 ? '#f0b429' : '#22d3ee'

  if (compact) {
    return (
      <Badge
        tone={pctUsed != null && pctUsed > 90 ? 'bad' : pctUsed != null && pctUsed > 70 ? 'warn' : 'neutral'}
        title={
          limit
            ? t('ctx.used', { used: used ?? 0, limit })
            : t('el modelo no publica su ventana de contexto')
        }
      >
        <Gauge size={10} />
        {tokens(used ?? 0)}
        {limit ? ` / ${tokens(limit)}` : ''}
        {pctUsed != null ? ` · ${pctUsed.toFixed(0)}%` : ''}
      </Badge>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-dim flex items-center gap-1">
          <Gauge size={11} /> {t('Contexto')}
        </span>
        <span className="num text-muted">
          {tokens(used ?? 0)}
          {limit ? ` / ${tokens(limit)}` : ''}
          {pctUsed != null ? ` · ${pctUsed.toFixed(0)}%` : ''}
        </span>
      </div>
      {limit ? (
        <Meter value={used ?? 0} max={limit} color={tone} />
      ) : (
        <div className="text-[10.5px] text-dim">
          {t('este modelo no publica su ventana: se muestra sólo lo consumido')}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Límite de uso                                                      *
 * ------------------------------------------------------------------ */

function untilText(at: number | undefined, t: Translate): string | null {
  if (!at) return null
  const s = Math.round((at - Date.now()) / 1000)
  if (s <= 0) return t('ya')
  if (s < 60) return t('until.seconds', { n: s })
  if (s < 3600) return t('until.minutes', { n: Math.round(s / 60) })
  return t('until.hours', { n: (s / 3600).toFixed(1) })
}

export function UsageLimitView({
  limit,
  compact
}: {
  limit?: UsageLimit
  compact?: boolean
}): React.JSX.Element | null {
  // Arriba del todo: debajo hay un retorno temprano y un hook no puede quedar
  // detras de un `return`.
  const t = useT()
  if (!limit) return null

  const parts: string[] = []
  if (limit.requestsRemaining != null) {
    const of = limit.requestsLimit ? '/' + limit.requestsLimit : ''
    parts.push(`${limit.requestsRemaining}${of} ` + t('peticiones'))
  }
  if (limit.tokensRemaining != null) {
    const of = limit.tokensLimit ? '/' + tokens(limit.tokensLimit) : ''
    parts.push(`${tokens(limit.tokensRemaining)}${of} tokens`)
  }
  if (limit.inputTokensRemaining != null) {
    parts.push(`${tokens(limit.inputTokensRemaining)} ` + t('de entrada'))
  }
  if (limit.outputTokensRemaining != null) {
    parts.push(`${tokens(limit.outputTokensRemaining)} ` + t('de salida'))
  }
  if (!parts.length && limit.retryAfterSeconds != null) {
    parts.push(t('usage.retryIn', { n: limit.retryAfterSeconds }))
  }
  if (!parts.length) return null

  const reset = untilText(limit.resetAt, t)
  const low =
    (limit.requestsLimit && limit.requestsRemaining != null && limit.requestsRemaining / limit.requestsLimit < 0.15) ||
    (limit.tokensLimit && limit.tokensRemaining != null && limit.tokensRemaining / limit.tokensLimit < 0.15)

  if (compact) {
    return (
      <Badge tone={low ? 'warn' : 'neutral'} title={t('usage.limitOf', { source: limit.source })}>
        {parts[0]}
        {reset ? ' · ' + t('usage.resetsShort', { at: reset }) : ''}
      </Badge>
    )
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] text-dim">{t('usage.limitOf', { source: limit.source })}</div>
      <div className={cx('text-[11.5px] num', low ? 'text-warn' : 'text-muted')}>
        {t('usage.left', { parts: parts.join(' · ') })}
        {reset ? t('usage.resets', { at: reset }) : ''}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Consumo                                                            *
 * ------------------------------------------------------------------ */

/** Lo último que dijo cada proveedor sobre tus límites, en vivo. */
export function useUsage(): UsageSnapshot[] {
  const [all, setAll] = useState<UsageSnapshot[]>([])
  useEffect(() => {
    void window.api.usage.list().then((r) => {
      if (r.ok && r.data) setAll(r.data)
    })
    return window.api.usage.onUpdated(setAll)
  }, [])
  return all
}

/**
 * Uso de Claude Code en esta máquina: la app, las terminales y la app de
 * Claude, todo junto, que es como lo cuenta el plan. Se relee solo cuando el
 * vigilante encuentra sesiones nuevas.
 */
export function useClaudeUsage(): ClaudeUsage | null {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.api.usage.claude().then((r) => {
        if (alive && r.ok && r.data) setUsage(r.data)
      })
    }
    load()
    const off = window.api.usage.onClaudeUpdated(load)
    // Red de seguridad: la ventana de 5 h avanza aunque no pase nada nuevo.
    const t = window.setInterval(load, 60_000)
    return () => {
      alive = false
      off()
      window.clearInterval(t)
    }
  }, [])

  return usage
}

/** Un reloj de segundo en segundo, sólo mientras haya algo que contar. */
function useTick(active: boolean): void {
  const [, force] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [active])
}

function countdown(at: number): string {
  const s = Math.max(0, Math.round((at - Date.now()) / 1000))
  if (s <= 0) return 'ya'
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const h = Math.floor(s / 3600)
  return `${h} h ${Math.round((s - h * 3600) / 60)} min`
}

function clockAt(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Cuánto hace. Recibe `t` en vez de pedirlo: esto no es un componente, y un
 * hook aquí dentro funcionaría de milagro hasta el día que alguien llame a
 * esta función dentro de un `if`.
 */
function ago(at: number | undefined, t: Translate): string | null {
  if (!at) return null
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return t('hace un momento')
  if (s < 3600) return t('ago.minutes', { n: Math.round(s / 60) })
  return t('ago.hours', { n: (s / 3600).toFixed(1) })
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 text-[11.5px]">
      <span className="text-dim">{label}</span>
      <span className={cx('num', tone ?? 'text-muted')}>{value}</span>
    </div>
  )
}

/**
 * Las ventanas del plan de Claude: la corta, de cinco horas, y la de la
 * semana. Se cuentan sumando lo que ha pasado por esta máquina, incluidas las
 * sesiones que arrancas en una terminal.
 *
 * El tope del plan no lo publica Claude Code —sólo dice cuándo se reinicia la
 * cuenta—, así que aquí no hay porcentaje ni barra: hay gasto real y hora de
 * reinicio. Inventar el resto sería peor que no ponerlo.
 */
export function ClaudeWindows({ usage }: { usage: ClaudeUsage }): React.JSX.Element | null {
  const t = useT()
  useTick(Boolean(usage.fiveHour.resetsAt))
  const { fiveHour, weekly } = usage
  if (!fiveHour.messages && !weekly.messages) return null

  const from = new Date(fiveHour.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="border-t border-line pt-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-dim">{t('Plan de Claude')}</span>
        {usage.limit?.status && usage.limit.status !== 'allowed' ? (
          <Badge tone="warn">{usage.limit.status}</Badge>
        ) : null}
      </div>

      <div className="space-y-1">
        <Line
          label={usage.exact ? `ventana de 5 h (desde las ${from})` : t('últimas 5 h')}
          value={`${tokens(fiveHour.tokens)} · ${cost(fiveHour.cost)}`}
        />
        <div className="flex items-center justify-between text-[10.5px] text-dim">
          <span>
            {fiveHour.messages} mensaje{fiveHour.messages === 1 ? '' : 's'} en {fiveHour.sessions} sesion
            {fiveHour.sessions === 1 ? '' : 'es'}
            {fiveHour.cached ? ' · ' + t('usage.reread', { n: tokens(fiveHour.cached) }) : ''}
          </span>
          {fiveHour.resetsAt ? <span className="num">{t('usage.restartsIn', { at: countdown(fiveHour.resetsAt) })}</span> : null}
        </div>
      </div>

      <div className="space-y-1 pt-0.5">
        <Line label={t('últimos 7 días')} value={`${tokens(weekly.tokens)} · ${cost(weekly.cost)}`} />
        <div className="text-[10.5px] text-dim">
          {t('usage.weekly', { messages: weekly.messages, sessions: weekly.sessions })}
          {weekly.cached ? ' · ' + t('usage.reread', { n: tokens(weekly.cached) }) : ''} ·{' '}
          {t('incluye lo que lanzas en la terminal')}
        </div>
      </div>

      {!usage.exact ? (
        <div className="text-[10.5px] text-dim leading-relaxed">
          Claude Code sólo dice cuándo se reinicia la ventana cuando contesta; hasta entonces se cuentan las
          últimas cinco horas. El tope del plan no lo publica, así que no se pinta ningún porcentaje.
        </div>
      ) : null}

      <div className="text-[10.5px] text-dim leading-relaxed">
        El dinero es lo que valdría a precio de API: con plan de pago no lo pagas, sirve para comparar.
        {weekly.unpriced || fiveHour.unpriced
          ? ' ' + t('Hay mensajes de un modelo sin precio publicado, así que su parte no está sumada.')
          : ''}
      </div>
    </div>
  )
}

/**
 * Cuánto llevas gastado y cuánto te queda.
 *
 * Tres cosas distintas que la gente mezcla: la ventana de contexto (cuánto
 * cabe en esta conversación), el límite de uso del proveedor (cuántas
 * peticiones o tokens te quedan antes de que te corte) y cuándo se repone.
 * Aquí van separadas, y lo que el proveedor no manda no se dibuja: no hay
 * barras a medias ni porcentajes inventados.
 */
export function UsagePanel({
  providerId,
  model,
  contextUsed,
  contextLimit,
  usageLimit,
  estimated,
  title = 'Consumo'
}: {
  /** Proveedor de la sesión; para los agentes de CLI, 'cli:' + su id. */
  providerId?: string
  model?: string
  contextUsed?: number
  contextLimit?: number
  usageLimit?: UsageLimit
  /** El contexto es una estimación de la conversación, no un dato del proveedor. */
  estimated?: boolean
  title?: string
}): React.JSX.Element | null {
  const t = useT()
  const snapshots = useUsage()
  const snap = providerId ? snapshots.find((s) => s.providerId === providerId) : undefined
  // Las ventanas del plan sólo las publica Claude Code.
  const claudeUsage = useClaudeUsage()
  const isClaude = Boolean(providerId?.startsWith('cli:') && /claude/i.test(providerId))
  const claude = isClaude ? claudeUsage : null

  // Lo de la sesión manda; lo guardado rellena los huecos.
  const limit = usageLimit ?? snap?.limit
  const limitAt = usageLimit ? Date.now() : snap?.limitAt
  const used = contextUsed ?? snap?.contextUsed
  const window_ = contextLimit ?? snap?.contextLimit

  useTick(Boolean(limit?.resetAt))

  const pct = used != null && window_ ? Math.min(100, (used / window_) * 100) : null
  const tone = pct == null ? '#3b82f6' : pct > 90 ? '#f0505f' : pct > 70 ? '#f0b429' : '#22d3ee'

  const reqPct =
    limit?.requestsLimit && limit.requestsRemaining != null
      ? (limit.requestsRemaining / limit.requestsLimit) * 100
      : null
  const tokPct =
    limit?.tokensLimit && limit.tokensRemaining != null ? (limit.tokensRemaining / limit.tokensLimit) * 100 : null
  const low = (reqPct != null && reqPct < 15) || (tokPct != null && tokPct < 15)

  return (
    <div className="border border-line rounded-lg bg-panel">
      <div className="px-3 py-2 border-b border-line flex items-center gap-2">
        <Gauge size={12} className="text-dim" />
        <span className="text-[11.5px] font-medium">{title}</span>
        {model ? <span className="num text-[10.5px] text-dim truncate">{model}</span> : null}
      </div>

      <div className="p-3 space-y-3">
        {/* ------------------------------------------- Contexto */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-dim">Contexto{estimated && used != null ? ' (estimado)' : ''}</span>
            <span className="num text-muted">
              {used != null ? tokens(used) : '—'}
              {window_ ? ` / ${tokens(window_)}` : ''}
              {pct != null ? ` · ${pct.toFixed(0)}%` : ''}
            </span>
          </div>
          {window_ && used != null ? (
            <>
              <Meter value={used} max={window_} color={tone} />
              <div className="text-[10.5px] text-dim">
                {t('ctx.fits', { n: tokens(Math.max(0, window_ - used)) })}
              </div>
            </>
          ) : (
            <div className="text-[10.5px] text-dim leading-relaxed">
              {used == null
                ? t('sale en cuanto lances la primera petición')
                : t('este modelo no publica su ventana: sólo se puede enseñar lo consumido')}
            </div>
          )}
        </div>

        {/* ------------------------------ Plan de Claude: 5 h y semana */}
        {claude ? <ClaudeWindows usage={claude} /> : null}

        {/* --------------------------------------- Límite de uso */}
        <div className="border-t border-line pt-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] text-dim">{t('Límite de uso')}</span>
            {limit ? <span className="text-[10.5px] text-dim">{ago(limitAt, t) ?? ''}</span> : null}
          </div>

          {!limit ? (
            <div className="text-[10.5px] text-dim leading-relaxed">
              {!providerId
                ? t('elige un modelo o un agente y aquí saldrá lo que te queda.')
                : providerId.startsWith('cli:')
                  ? t('un agente de línea de comandos no publica cuánto te queda de su plan: eso sólo lo sabe su web.')
                  : t('este proveedor no manda sus límites en las cabeceras, así que no hay nada que enseñar sin inventarlo.')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {limit.requestsRemaining != null ? (
                <>
                  <Line
                    label={t('peticiones')}
                    value={`${limit.requestsRemaining}${limit.requestsLimit ? ' / ' + limit.requestsLimit : ''}`}
                    tone={reqPct != null && reqPct < 15 ? 'text-warn' : undefined}
                  />
                  {limit.requestsLimit ? (
                    <Meter
                      value={limit.requestsRemaining}
                      max={limit.requestsLimit}
                      color={reqPct != null && reqPct < 15 ? '#f0505f' : '#22d3ee'}
                    />
                  ) : null}
                </>
              ) : null}

              {limit.tokensRemaining != null ? (
                <>
                  <Line
                    label="tokens"
                    value={`${tokens(limit.tokensRemaining)}${limit.tokensLimit ? ' / ' + tokens(limit.tokensLimit) : ''}`}
                    tone={tokPct != null && tokPct < 15 ? 'text-warn' : undefined}
                  />
                  {limit.tokensLimit ? (
                    <Meter
                      value={limit.tokensRemaining}
                      max={limit.tokensLimit}
                      color={tokPct != null && tokPct < 15 ? '#f0505f' : '#22d3ee'}
                    />
                  ) : null}
                </>
              ) : null}

              {limit.inputTokensRemaining != null ? (
                <Line label={t('de entrada')} value={tokens(limit.inputTokensRemaining)} />
              ) : null}
              {limit.outputTokensRemaining != null ? (
                <Line label={t('de salida')} value={tokens(limit.outputTokensRemaining)} />
              ) : null}

              {limit.resetAt ? (
                <div className={cx('text-[11px] pt-0.5', low ? 'text-warn' : 'text-muted')}>
                  {t('se repone en')} <span className="num">{countdown(limit.resetAt)}</span>
                  <span className="text-dim"> (a las {clockAt(limit.resetAt)})</span>
                </div>
              ) : limit.retryAfterSeconds != null ? (
                <div className="text-[11px] text-warn">
                  {t('te ha cortado: reintenta en')} <span className="num">{limit.retryAfterSeconds} s</span>
                </div>
              ) : null}

              <div className="text-[10.5px] text-dim">{t('usage.accordingTo', { source: limit.source })}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * El consumo de todos los proveedores que han contestado desde que abriste la
 * aplicación, en una tabla. Sirve para el Panel: de un vistazo, con quién te
 * estás quedando sin cuota.
 */
export function UsageRows(): React.JSX.Element {
  const t = useT()
  const rows = useUsage()
  useTick(rows.some((r) => r.limit?.resetAt))

  if (!rows.length) {
    return (
      <div className="px-4 py-3 text-[11.5px] text-dim leading-relaxed">
        {t('Aún no has lanzado nada en esta sesión. Los límites salen de las cabeceras de cada respuesta, así que aparecen aquí en cuanto un proveedor conteste.')}
      </div>
    )
  }

  return (
    <div className="divide-y divide-[#151a26]">
      {rows.map((s) => {
        const pctCtx = s.contextUsed != null && s.contextLimit ? (s.contextUsed / s.contextLimit) * 100 : null
        const reqPct =
          s.limit?.requestsLimit && s.limit.requestsRemaining != null
            ? (s.limit.requestsRemaining / s.limit.requestsLimit) * 100
            : null
        const tokPct =
          s.limit?.tokensLimit && s.limit.tokensRemaining != null
            ? (s.limit.tokensRemaining / s.limit.tokensLimit) * 100
            : null
        const low = (reqPct != null && reqPct < 15) || (tokPct != null && tokPct < 15)

        return (
          <div key={s.providerId} className="px-4 py-2.5 flex items-center gap-3 text-[12px]">
            <div className="min-w-0 w-[150px]">
              <div className="truncate">{s.providerName ?? s.providerId}</div>
              {s.model ? <div className="num text-[10.5px] text-dim truncate">{s.model}</div> : null}
            </div>

            <div className="w-[150px] shrink-0">
              {pctCtx != null ? (
                <>
                  <div className="text-[10.5px] text-dim mb-0.5">
                    {t('contexto')} <span className="num">{pctCtx.toFixed(0)}%</span>
                  </div>
                  <Meter
                    value={s.contextUsed ?? 0}
                    max={s.contextLimit ?? 1}
                    color={pctCtx > 90 ? '#f0505f' : pctCtx > 70 ? '#f0b429' : '#22d3ee'}
                  />
                </>
              ) : (
                <span className="text-[10.5px] text-dim">{t('sin ventana conocida')}</span>
              )}
            </div>

            <div className="flex-1 min-w-0 num text-[11.5px]">
              {s.limit ? (
                <span className={low ? 'text-warn' : 'text-muted'}>
                  {s.limit.requestsRemaining != null
                    ? `${s.limit.requestsRemaining}${s.limit.requestsLimit ? '/' + s.limit.requestsLimit : ''} peticiones`
                    : ''}
                  {s.limit.requestsRemaining != null && s.limit.tokensRemaining != null ? ' · ' : ''}
                  {s.limit.tokensRemaining != null
                    ? `${tokens(s.limit.tokensRemaining)}${s.limit.tokensLimit ? '/' + tokens(s.limit.tokensLimit) : ''} tokens`
                    : ''}
                </span>
              ) : (
                <span className="text-dim text-[11px]">{t('no publica sus límites')}</span>
              )}
            </div>

            <div className="shrink-0 text-right">
              {s.limit?.resetAt ? (
                <>
                  <div className="num text-[11.5px] text-muted">{countdown(s.limit.resetAt)}</div>
                  <div className="text-[10px] text-dim">{t('para reponerse')}</div>
                </>
              ) : (
                <div className="text-[10.5px] text-dim">{ago(s.at, t)}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Archivos                                                           *
 * ------------------------------------------------------------------ */

const STATUS_ICON: Record<FileChange['status'], React.ReactNode> = {
  M: <FileText size={11} className="text-accent" />,
  A: <FilePlus2 size={11} className="text-ok" />,
  D: <FileMinus2 size={11} className="text-bad" />,
  R: <FileText size={11} className="text-violet" />,
  '?': <FileQuestion size={11} className="text-warn" />
}

const STATUS_TEXT: Record<FileChange['status'], string> = {
  M: 'modificado',
  A: 'añadido',
  D: 'borrado',
  R: 'renombrado',
  '?': 'nuevo, sin seguimiento'
}

const TOUCH_ICON: Record<FileTouch['kind'], React.ReactNode> = {
  read: <Eye size={10} />,
  edit: <Pencil size={10} />,
  write: <FilePlus2 size={10} />,
  run: <TerminalSquare size={10} />,
  search: <Search size={10} />
}

const TOUCH_TEXT: Record<FileTouch['kind'], string> = {
  read: 'leído',
  edit: 'editado',
  write: 'escrito',
  run: 'ejecutado',
  search: 'buscado'
}

/**
 * Los archivos que cambiaron de verdad (medido con git) y los que el agente
 * dice haber abierto. Son cosas distintas y se muestran por separado: leer no
 * es tocar.
 */
export function FileWork({
  files,
  touched,
  onOpen,
  dense
}: {
  files?: FileChange[]
  touched?: FileTouch[]
  onOpen?: (path: string) => void
  dense?: boolean
}): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(!dense)
  if (!files?.length && !touched?.length) return null

  const added = files?.reduce((n, f) => n + f.added, 0) ?? 0
  const removed = files?.reduce((n, f) => n + f.removed, 0) ?? 0
  const onlyRead = (touched ?? []).filter((t) => t.kind === 'read' || t.kind === 'search')

  return (
    <div className={cx('rounded-lg border border-line bg-void', dense ? 'mt-2.5' : '')}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[11.5px] hover:bg-raised transition-colors rounded-lg"
      >
        <ChevronDown size={12} className={cx('transition-transform text-dim', !open && '-rotate-90')} />
        <span className="text-muted">
          {files?.length ? `${files.length} archivo${files.length === 1 ? '' : 's'} cambiado${files.length === 1 ? '' : 's'}` : 'sin cambios en disco'}
        </span>
        {added ? <span className="num text-ok">+{added}</span> : null}
        {removed ? <span className="num text-bad">-{removed}</span> : null}
        {onlyRead.length ? (
          <span className="text-dim ml-auto">
            {t('files.onlyRead', { n: onlyRead.length })}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="px-2.5 pb-2 space-y-1">
          {files?.map((f) => (
            <div key={f.path} className="flex items-center gap-2 text-[11.5px]">
              <span title={t(STATUS_TEXT[f.status])} className="shrink-0">
                {STATUS_ICON[f.status]}
              </span>
              <button
                onClick={() => onOpen?.(f.path)}
                disabled={!onOpen}
                className={cx('font-mono truncate text-left min-w-0 flex-1', onOpen ? 'hover:text-accent' : 'cursor-default')}
                title={f.path}
              >
                {f.path}
              </button>
              {f.binary ? (
                <span className="text-dim shrink-0">{t('binario')}</span>
              ) : (
                <span className="num shrink-0">
                  {f.added ? <span className="text-ok">+{f.added}</span> : null}
                  {f.added && f.removed ? ' ' : null}
                  {f.removed ? <span className="text-bad">-{f.removed}</span> : null}
                </span>
              )}
            </div>
          ))}

          {touched?.length ? (
            <div className="pt-1.5 border-t border-line space-y-1">
              <div className="text-[10.5px] text-dim">{t('Lo que el agente dice haber tocado')}</div>
              <div className="flex flex-wrap gap-1">
                {touched.slice(0, 40).map((touch) => (
                  <Badge
                    key={touch.kind + touch.path}
                    tone={touch.kind === 'read' || touch.kind === 'search' ? 'neutral' : 'accent'}
                    title={t('touch.times', {
                      what: t(TOUCH_TEXT[touch.kind]),
                      n: touch.count
                    })}
                  >
                    {TOUCH_ICON[touch.kind]}
                    <span className="font-mono max-w-[220px] truncate">{touch.path}</span>
                    {touch.count > 1 ? <span className="num text-dim">{touch.count}</span> : null}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Esfuerzo                                                           *
 * ------------------------------------------------------------------ */

export function EffortPicker({
  value,
  onChange,
  supported = true,
  hint
}: {
  value: Effort
  onChange: (e: Effort) => void
  /** false cuando el agente elegido no tiene forma de recibirlo. */
  supported?: boolean
  hint?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex items-center gap-1" title={supported ? hint : hint ?? t('este agente no expone el esfuerzo')}>
      {EFFORTS.map((e) => (
        <button
          key={e}
          onClick={() => onChange(e)}
          disabled={!supported && e !== 'auto'}
          className={cx(
            'px-1.5 py-0.5 rounded text-[10.5px] border transition-colors',
            value === e
              ? 'bg-[#082a31] text-accent border-[#12525f]'
              : 'bg-raised text-dim border-line hover:text-muted',
            !supported && e !== 'auto' && 'opacity-35 cursor-not-allowed'
          )}
        >
          {EFFORT_LABEL[e]}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Ramas                                                              *
 * ------------------------------------------------------------------ */

/**
 * Estado de git de una carpeta, en vivo.
 *
 * El proceso principal vigila la carpeta y avisa cuando algo se mueve, venga
 * de la aplicación o de una terminal de fuera: por eso ya no hace falta pulsar
 * «releer» después de cometer. El botón sigue estando, y lo único que hace es
 * pedir una lectura ya, sin esperar al siguiente repaso.
 */
export function useGit(path?: string): {
  info: GitInfo | null
  changes: FileChange[]
  state: GitOpState | null
  reload: () => void
} {
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [changes, setChanges] = useState<FileChange[]>([])
  const [state, setState] = useState<GitOpState | null>(null)

  useEffect(() => {
    if (!path) {
      setInfo(null)
      setChanges([])
      setState(null)
      return
    }
    // Al empezar a vigilar llega una lectura completa, así que no hace falta
    // pedir el estado por separado.
    void window.api.git.watch(path)
    const off = window.api.git.onChanged((e) => {
      if (e.path !== path) return
      setInfo(e.info)
      setChanges(e.changes)
      setState(e.state)
    })
    return () => {
      off()
      void window.api.git.unwatch(path)
    }
  }, [path])

  const reload = useCallback(() => {
    if (path) void window.api.git.poke(path)
  }, [path])

  return { info, changes, state, reload }
}

export function BranchPicker({
  path,
  info,
  onChanged,
  onError
}: {
  path?: string
  info: GitInfo | null
  onChanged?: () => void
  onError?: (msg: string) => void
}): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState('')
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!path || !info?.repo) return null

  const go = async (branch: string, create = false): Promise<void> => {
    setBusy(true)
    const r = await window.api.git.checkout(path, branch, create)
    setBusy(false)
    setOpen(false)
    setCreating('')
    if (!r.ok || !r.data?.ok) {
      // git ya se niega solo si el cambio perdería trabajo: se enseña su
      // motivo tal cual en vez de forzar nada.
      onError?.(r.data?.detail ?? r.error ?? t('no se pudo cambiar de rama'))
      return
    }
    onChanged?.()
  }

  const label = info.detached ? `HEAD ${info.head ?? ''}` : (info.branch ?? '—')
  const remotesToShow = info.remoteBranches.filter((r) => {
    const short = r.split('/').slice(1).join('/')
    return short && !info.localBranches.includes(short)
  })

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-raised border border-line text-[11.5px] hover:border-[#2c3346] hover:text-accent transition-colors max-w-[240px]"
        title={
          info.upstream
            ? `sigue a ${info.upstream}${info.ahead ? `, ${info.ahead} por delante` : ''}${info.behind ? `, ${info.behind} por detrás` : ''}`
            : t('sin rama remota asociada')
        }
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <GitBranch size={11} className="text-violet" />}
        <span className="truncate font-mono">{label}</span>
        {info.dirty + info.staged + info.untracked > 0 ? (
          <span
            className="num text-warn"
            title={t('git.counts', {
              staged: info.staged,
              dirty: info.dirty,
              untracked: info.untracked
            })}
          >
            {info.dirty + info.staged + info.untracked}
          </span>
        ) : null}
        {info.ahead ? <span className="num text-ok">↑{info.ahead}</span> : null}
        {info.behind ? <span className="num text-warn">↓{info.behind}</span> : null}
        <ChevronDown size={11} className="text-dim shrink-0" />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-[300px] max-h-[340px] overflow-y-auto bg-panel border border-line rounded-lg shadow-xl p-1.5">
          <div className="px-1.5 py-1 text-[10.5px] text-dim uppercase tracking-wide">{t('Ramas locales')}</div>
          {info.localBranches.map((b) => (
            <button
              key={b}
              onClick={() => void go(b)}
              className="w-full px-1.5 py-1 flex items-center gap-2 text-[12px] rounded hover:bg-raised text-left"
            >
              {b === info.branch ? <Check size={11} className="text-ok shrink-0" /> : <span className="w-[11px]" />}
              <span className="font-mono truncate">{b}</span>
            </button>
          ))}

          {remotesToShow.length ? (
            <>
              <div className="px-1.5 py-1 mt-1 text-[10.5px] text-dim uppercase tracking-wide">{t('Remotas')}</div>
              {remotesToShow.map((b) => (
                <button
                  key={b}
                  onClick={() => void go(b.split('/').slice(1).join('/'))}
                  className="w-full px-1.5 py-1 flex items-center gap-2 text-[12px] rounded hover:bg-raised text-left"
                  title={`crea una rama local que siga a ${b}`}
                >
                  <span className="w-[11px]" />
                  <span className="font-mono truncate text-muted">{b}</span>
                </button>
              ))}
            </>
          ) : null}

          <div className="mt-1.5 pt-1.5 border-t border-line flex items-center gap-1.5">
            <input
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && creating.trim()) void go(creating.trim(), true)
              }}
              placeholder={t('rama nueva desde aquí…')}
              className="flex-1 min-w-0 bg-void border border-line rounded px-2 py-1 text-[11.5px] font-mono outline-none focus:border-[#2c3346]"
            />
            <Button size="sm" variant="ghost" disabled={!creating.trim()} onClick={() => void go(creating.trim(), true)}>
              <Plus size={11} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Adjuntos                                                           *
 * ------------------------------------------------------------------ */

export function AttachButton({ onAdd }: { onAdd: (a: Attachment[]) => void }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={async () => {
        setBusy(true)
        const r = await window.api.attach.pick()
        setBusy(false)
        if (r.ok && r.data?.length) onAdd(r.data)
      }}
      disabled={busy}
      title={t('Adjuntar archivos al prompt')}
      className="p-1.5 rounded-md text-dim hover:text-accent hover:bg-raised transition-colors"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
    </button>
  )
}

export function AttachmentList({
  items,
  onRemove,
  readOnly
}: {
  items?: Attachment[]
  onRemove?: (path: string) => void
  readOnly?: boolean
}): React.JSX.Element | null {
  if (!items?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a) => (
        <span
          key={a.path}
          title={`${a.path}${a.skipped ? ' · ' + a.skipped : ''}`}
          className={cx(
            'inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded border text-[11px]',
            a.skipped ? 'bg-[#241a09] border-[#4a3512] text-warn' : 'bg-raised border-line text-muted'
          )}
        >
          <Paperclip size={10} />
          <span className="font-mono max-w-[220px] truncate">{a.name}</span>
          <span className="num text-dim">{fmtBytes(a.bytes)}</span>
          {a.lines ? <span className="num text-dim">{a.lines} l.</span> : null}
          {!readOnly && onRemove ? (
            <button onClick={() => onRemove(a.path)} className="text-dim hover:text-bad">
              <X size={11} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}
