/**
 * Revisión con IA antes de confirmar o de abrir la PR.
 *
 * Un modelo lee el diff y devuelve comentarios por fichero y línea; aquí se
 * ponen en su sitio dentro del diff, con su gravedad. Es una opinión, no una
 * prueba: se dice qué modelo la dio, cada comentario se puede descartar y lo
 * que quede se copia listo para pasárselo a un agente.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ShieldCheck, RefreshCw, Copy, X, AlertTriangle, Loader2 } from 'lucide-react'
import { Badge, Button, Modal, cx } from './ui'
import { useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { cost, shortModel } from '../lib/format'
import { composeReview, parseDiff, type DiffFile, type DiffLine } from '../lib/diff'
import type { Pick } from './ModelPicker'

type Severity = 'error' | 'warning' | 'info'
interface AiComment {
  file: string
  line?: number
  severity: Severity
  comment: string
}
interface Placed extends AiComment {
  id: number
  /** El fichero del diff al que va, si se encontró. */
  path?: string
  /** La línea del diff donde se enseña, si se encontró. */
  at?: DiffLine
}

const lineKey = (file: string, l: DiffLine): string => `${file}|${l.kind}|${l.oldNo ?? ''}|${l.newNo ?? ''}`

/** Cada comentario, en su fichero y en su línea (o en la más cercana de las que cambian). */
export function placeComments(files: DiffFile[], comments: AiComment[]): Placed[] {
  return comments.map((c, id) => {
    const f =
      files.find((x) => x.path === c.file) ??
      files.find((x) => x.path.endsWith('/' + c.file) || c.file.endsWith('/' + x.path))
    if (!f) return { ...c, id }
    if (c.line == null) return { ...c, id, path: f.path }
    let best: DiffLine | undefined
    let dist = Infinity
    for (const h of f.hunks)
      for (const l of h.lines) {
        if (l.newNo == null) continue
        const d = Math.abs(l.newNo - c.line)
        if (d < dist || (d === dist && l.kind === 'add')) {
          dist = d
          best = l
        }
      }
    return { ...c, id, path: f.path, at: dist <= 3 ? best : undefined }
  })
}

const TONE: Record<Severity, 'bad' | 'warn' | 'accent'> = { error: 'bad', warning: 'warn', info: 'accent' }

export function AiReview({
  open,
  onClose,
  path,
  scope,
  base,
  pick
}: {
  open: boolean
  onClose: () => void
  path: string
  /** `commit`: lo que vas a confirmar; `branch`: la rama contra `base`. */
  scope: 'commit' | 'branch'
  base?: string
  pick: Pick | null
}): React.JSX.Element {
  const t = useT()
  const { lang } = usePrefs()
  const [result, setResult] = useState<{ files: DiffFile[]; truncated: boolean; summary: string; comments: Placed[]; model: string; cost: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)

  const run = useCallback(async () => {
    if (!pick) {
      setError(t('Elige qué modelo revisa (el mismo que escribe los mensajes de commit).'))
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setDismissed(new Set())
    const r = await window.api.git.review(path, scope, base, pick, lang)
    setLoading(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? t('No se pudo revisar'))
      return
    }
    const files = parseDiff(r.data.diff)
    const comments = placeComments(files, r.data.comments)
    setResult({ files, truncated: r.data.truncated, summary: r.data.summary, comments, model: r.data.run.model, cost: r.data.run.costTotal ?? 0 })
    // Abiertos, los ficheros con algo que decir.
    setExpanded(new Set(comments.map((c) => c.path).filter((p): p is string => Boolean(p))))
  }, [pick, path, scope, base, lang, t])

  useEffect(() => {
    if (open) void run()
  }, [open, run])

  const live = useMemo(() => (result ? result.comments.filter((c) => !dismissed.has(c.id)) : []), [result, dismissed])
  const byLine = useMemo(() => {
    const m = new Map<string, Placed[]>()
    for (const c of live) if (c.path && c.at) m.set(lineKey(c.path, c.at), [...(m.get(lineKey(c.path, c.at)) ?? []), c])
    return m
  }, [live])
  const loose = live.filter((c) => !c.at)
  const count = (s: Severity): number => live.filter((c) => c.severity === s).length

  const label = (s: Severity): string => (s === 'error' ? t('Fallo') : s === 'warning' ? t('Riesgo') : t('Sugerencia'))

  const copy = async (): Promise<void> => {
    const onLines = live.filter((c) => c.at && c.path).map((c) => ({ id: String(c.id), file: c.path!, line: c.at!, text: `[${label(c.severity)}] ${c.comment}` }))
    const general = loose.map((c) => `- ${c.file}${c.line ? ':' + c.line : ''} [${label(c.severity)}] ${c.comment}`).join('\n')
    const text = composeReview(onLines, general, {
      intro: t('Una revisión de los cambios ha encontrado esto. Corrígelo donde tenga razón y deja el resto como está:'),
      line: (n) => t('línea {n}', { n }),
      deleted: (n) => t('línea {n} que borraste', { n }),
      general: t('Además:')
    })
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const commentBox = (c: Placed): React.JSX.Element => (
    <div key={c.id} className="mx-2 my-1.5 bg-panel border border-line rounded-lg px-3 py-2 flex items-start gap-2 font-sans" data-ai-comment={c.severity}>
      <Badge tone={TONE[c.severity]} className="shrink-0">
        {label(c.severity)}
      </Badge>
      <div className="text-[12.5px] whitespace-pre-wrap break-words flex-1 min-w-0">{c.comment}</div>
      <button className="text-dim hover:text-muted shrink-0" title={t('Descartar')} onClick={() => setDismissed((s) => new Set(s).add(c.id))}>
        <X size={12} />
      </button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={scope === 'commit' ? t('Revisión con IA de lo que vas a confirmar') : t('Revisión con IA de la rama')}
      width="max-w-5xl"
      footer={
        <>
          {result ? (
            <span className="text-[11.5px] text-dim mr-auto">
              {t('Lo ha revisado {model} ({cost}). Es su opinión: compruébalo.', { model: shortModel(result.model), cost: cost(result.cost) })}
            </span>
          ) : null}
          <Button variant="ghost" onClick={() => void run()} disabled={loading}>
            <RefreshCw size={12} /> {t('Volver a revisar')}
          </Button>
          <Button onClick={() => void copy()} disabled={!live.length}>
            <Copy size={12} /> {copied ? t('Copiado') : t('Copiar para un agente')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-ai-review>
        {loading ? (
          <div className="flex items-center gap-2 text-[12.5px] text-dim py-6 justify-center">
            <Loader2 size={14} className="animate-spin" /> {t('Revisando con {model}…', { model: pick ? shortModel(pick.model) : '' })}
          </div>
        ) : error ? (
          <div className="text-[12.5px] text-bad break-words">{error}</div>
        ) : result ? (
          <>
            <div className="flex items-start gap-2">
              <ShieldCheck size={15} className={cx('shrink-0 mt-0.5', count('error') ? 'text-bad' : count('warning') ? 'text-warn' : 'text-ok')} />
              <div className="min-w-0">
                <div className="text-[12.5px]" data-ai-summary>
                  {result.summary || (live.length ? t('Hay cosas que mirar.') : t('No ha encontrado problemas.'))}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11.5px] text-dim">
                  {count('error') ? (
                    <Badge tone="bad">{count('error') === 1 ? t('1 fallo') : t('{n} fallos', { n: count('error') })}</Badge>
                  ) : null}
                  {count('warning') ? (
                    <Badge tone="warn">{count('warning') === 1 ? t('1 riesgo') : t('{n} riesgos', { n: count('warning') })}</Badge>
                  ) : null}
                  {count('info') ? (
                    <Badge tone="accent">{count('info') === 1 ? t('1 sugerencia') : t('{n} sugerencias', { n: count('info') })}</Badge>
                  ) : null}
                  {result.truncated ? (
                    <span className="inline-flex items-center gap-1 text-warn">
                      <AlertTriangle size={11} /> {t('El diff era enorme: sólo se revisó el principio.')}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {loose.length ? (
              <div className="border border-line rounded-lg" data-ai-loose>
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-dim">{t('Sin línea concreta')}</div>
                {loose.map((c) => (
                  <div key={c.id}>
                    <div className="px-3 text-[11px] font-mono text-dim">
                      {c.file}
                      {c.line ? ':' + c.line : ''}
                    </div>
                    {commentBox(c)}
                  </div>
                ))}
              </div>
            ) : null}

            {result.files.map((f) => {
              const open = expanded.has(f.path)
              const here = live.filter((c) => c.path === f.path && c.at).length
              return (
                <div key={f.path} className="border border-line rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 bg-raised text-left hover:bg-[#1a1d29]"
                    onClick={() =>
                      setExpanded((s) => {
                        const n = new Set(s)
                        if (n.has(f.path)) n.delete(f.path)
                        else n.add(f.path)
                        return n
                      })
                    }
                  >
                    <ChevronRight size={12} className={cx('text-dim transition-transform', open && 'rotate-90')} />
                    <span className="font-mono text-[12px] truncate flex-1">{f.path}</span>
                    {here ? <Badge tone="accent">{here}</Badge> : null}
                    <span className="text-ok text-[11px] num">+{f.added}</span>
                    <span className="text-bad text-[11px] num">−{f.removed}</span>
                  </button>
                  {open && !f.binary ? (
                    <div className="font-mono text-[11.5px] leading-[1.55] bg-[#07080c] overflow-x-auto">
                      {f.hunks.map((h, hi) => (
                        <div key={hi}>
                          <div className="px-3 py-0.5 text-violet bg-[#110f1c] text-[11px]">{h.header}</div>
                          {h.lines.map((l) => {
                            const k = lineKey(f.path, l)
                            const cs = byLine.get(k) ?? []
                            return (
                              <div key={k}>
                                <div
                                  className={cx(
                                    'grid grid-cols-[42px_42px_14px_1fr]',
                                    l.kind === 'add' && 'bg-[#0b1a12]',
                                    l.kind === 'del' && 'bg-[#1c0e12]',
                                    cs.length > 0 && 'shadow-[inset_2px_0_0_var(--color-accent)]'
                                  )}
                                >
                                  <span className="text-right pr-2 text-dim select-none">{l.oldNo ?? ''}</span>
                                  <span className="text-right pr-2 text-dim select-none">{l.newNo ?? ''}</span>
                                  <span className={cx('select-none', l.kind === 'add' ? 'text-ok' : l.kind === 'del' ? 'text-bad' : 'text-dim')}>
                                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                                  </span>
                                  <span className={cx('whitespace-pre pr-3', l.kind === 'add' ? 'text-[#b5f5c8]' : l.kind === 'del' ? 'text-[#f5b5bd]' : 'text-muted')}>
                                    {l.text || ' '}
                                  </span>
                                </div>
                                {cs.map(commentBox)}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
