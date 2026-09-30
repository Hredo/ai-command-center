/**
 * Pull requests y CI en el panel de git del proyecto.
 *
 * La PR de la rama en la que estás (con sus comprobaciones), las abiertas del
 * repositorio y las últimas ejecuciones de Actions de la rama. Se refresca
 * sola mientras la ves: cada minuto, y más a menudo si algo sigue en marcha.
 * Abrir una PR sube antes la rama si hace falta, y el título y la descripción
 * los puede escribir un modelo.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  GitPullRequest, Check, X, Clock, Loader2, RefreshCw, ExternalLink, ChevronRight, Sparkles, Workflow, CircleSlash, ShieldCheck
} from 'lucide-react'
import { AiReview } from './AiReview'
import { Badge, Button, Field, Input, Modal, Textarea, Toggle, cx } from './ui'
import { useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { useStore } from '../lib/store'
import { useIsPageActive } from '../lib/pageActive'
import { relTime, shortModel, cost } from '../lib/format'
import type { Pick } from './ModelPicker'
import type { PullCheck, PullSummary, PullsReport } from '@shared/types'

const open = (url: string): void => void window.api.app.openExternal(url)

function ChecksBadge({ checks }: { checks: PullSummary['checks'] }): React.JSX.Element | null {
  const t = useT()
  if (!checks.total) return <span className="text-[11px] text-dim">{t('sin CI')}</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] num" data-checks>
      {checks.fail ? (
        <span className="inline-flex items-center gap-0.5 text-bad">
          <X size={11} /> {checks.fail}
        </span>
      ) : null}
      {checks.pending ? (
        <span className="inline-flex items-center gap-0.5 text-warn">
          <Clock size={11} /> {checks.pending}
        </span>
      ) : null}
      {checks.pass ? (
        <span className="inline-flex items-center gap-0.5 text-ok">
          <Check size={11} /> {checks.pass}
        </span>
      ) : null}
    </span>
  )
}

function CheckIcon({ state }: { state: PullCheck['state'] | string }): React.JSX.Element {
  if (state === 'pass' || state === 'success') return <Check size={12} className="text-ok shrink-0" />
  if (state === 'fail' || state === 'failure' || state === 'timed_out' || state === 'startup_failure') return <X size={12} className="text-bad shrink-0" />
  if (state === 'skipped' || state === 'cancel' || state === 'cancelled' || state === 'neutral') return <CircleSlash size={12} className="text-dim shrink-0" />
  return <Clock size={12} className="text-warn shrink-0" />
}

function PullRow({ pr, path, expandable }: { pr: PullSummary; path: string; expandable?: boolean }): React.JSX.Element {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [checks, setChecks] = useState<PullCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!expanded) return
    let alive = true
    void window.api.git.pullChecks(path, pr.number).then((r) => {
      if (!alive) return
      if (r.ok && r.data) setChecks(r.data)
      else setError(r.error ?? t('No se pudieron leer las comprobaciones'))
    })
    return () => {
      alive = false
    }
  }, [expanded, path, pr.number, pr.checks.pending, pr.checks.fail, pr.checks.pass, t])

  return (
    <div data-pr={pr.number}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
        {expandable && pr.checks.total ? (
          <button onClick={() => setExpanded((v) => !v)} className="text-dim hover:text-ink" title={t('Ver las comprobaciones')}>
            <ChevronRight size={12} className={cx('transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : null}
        <span className="num text-dim shrink-0">#{pr.number}</span>
        <button onClick={() => open(pr.url)} className="truncate text-left hover:text-accent min-w-0" title={pr.url}>
          {pr.title}
        </button>
        {pr.draft ? <Badge tone="neutral">{t('borrador')}</Badge> : null}
        {pr.review === 'APPROVED' ? <Badge tone="ok">{t('aprobada')}</Badge> : pr.review === 'CHANGES_REQUESTED' ? <Badge tone="warn">{t('piden cambios')}</Badge> : null}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-dim font-mono truncate max-w-[180px]" title={`${pr.head} → ${pr.base}`}>
            {pr.head} → {pr.base}
          </span>
          <ChecksBadge checks={pr.checks} />
          {pr.updatedAt ? <span className="text-[11px] text-dim num">{relTime(pr.updatedAt)}</span> : null}
        </span>
      </div>
      {expanded ? (
        <div className="ml-8 mr-3 mb-2 border-l border-line pl-3 space-y-0.5" data-pr-checks>
          {error ? (
            <div className="text-[11.5px] text-bad">{error}</div>
          ) : !checks ? (
            <div className="text-[11.5px] text-dim">{t('Leyendo…')}</div>
          ) : (
            checks.map((c, i) => (
              <div key={c.name + i} className="flex items-center gap-2 text-[11.5px]">
                <CheckIcon state={c.state} />
                <span className="truncate">{c.workflow ? `${c.workflow} · ${c.name}` : c.name}</span>
                {c.url ? (
                  <button onClick={() => open(c.url!)} className="ml-auto text-dim hover:text-accent shrink-0" title={t('Abrir en GitHub')}>
                    <ExternalLink size={11} />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export function PullRequests({
  path,
  pick,
  version,
  onToast
}: {
  path: string
  /** Modelo que escribe la descripción (el mismo que los mensajes de commit). */
  pick: Pick | null
  /** Cambia al confirmar o subir: toca volver a mirar. */
  version?: string
  onToast?: (tone: 'ok' | 'error', msg: string) => void
}): React.JSX.Element {
  const t = useT()
  const { lang } = usePrefs()
  const { toast } = useStore()
  const active = useIsPageActive()
  const [report, setReport] = useState<PullsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<{ base: string; title: string; body: string; draft: boolean } | null>(null)
  const [busy, setBusy] = useState<'ai' | 'create' | null>(null)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await window.api.git.pulls(path)
    setLoading(false)
    if (r.ok && r.data) setReport(r.data)
    else setReport({ gh: 'ok', github: true, open: [], runs: [], error: r.error ?? t('No se pudo leer GitHub') })
  }, [path, t])

  useEffect(() => {
    void load()
  }, [load, version])

  // En vivo mientras lo ves: más a menudo si hay CI en marcha.
  useEffect(() => {
    if (!active || !report || report.gh !== 'ok' || !report.github) return
    const pending = (report.current?.checks.pending ?? 0) > 0 || report.runs.some((r) => r.status !== 'completed')
    const timer = window.setInterval(() => void load(), pending ? 20_000 : 60_000)
    return () => window.clearInterval(timer)
  }, [active, report, load])

  const describe = async (): Promise<void> => {
    if (!form || !pick) return
    setBusy('ai')
    const r = await window.api.git.describePull(path, form.base, pick, lang)
    setBusy(null)
    if (!r.ok || !r.data) {
      onToast?.('error', r.error ?? t('No se pudo escribir la descripción'))
      return
    }
    setForm({ ...form, title: r.data.title, body: r.data.body })
    setAiNote(t('Lo ha escrito {model} ({cost}). Revísalo antes de abrirla.', { model: shortModel(r.data.run.model), cost: cost(r.data.run.costTotal ?? 0) }))
  }

  const create = async (): Promise<void> => {
    if (!form) return
    setBusy('create')
    const r = await window.api.git.createPull(path, form)
    setBusy(null)
    if (!r.ok || !r.data) {
      onToast?.('error', r.error ?? t('No se pudo abrir la PR'))
      return
    }
    setForm(null)
    setAiNote(null)
    const url = r.data.url
    toast('ok', r.data.pushed ? t('Rama subida y PR abierta') : t('PR abierta'), { label: t('Ver en GitHub'), run: () => open(url) })
    void load()
  }

  const body = (): React.ReactNode => {
    if (!report) return <div className="px-3 py-3 text-[12px] text-dim">{t('Leyendo GitHub…')}</div>
    if (report.gh === 'missing')
      return <div className="px-3 py-3 text-[12px] text-dim">{t('Para ver y abrir pull requests hace falta GitHub CLI (gh). En el panel de GitHub de Proyectos está cómo instalarlo.')}</div>
    if (report.gh === 'noauth')
      return <div className="px-3 py-3 text-[12px] text-dim">{t('gh no tiene sesión. Inicia sesión desde el panel de GitHub de Proyectos: se autoriza en el navegador y la app nunca ve el token.')}</div>
    if (!report.github) return <div className="px-3 py-3 text-[12px] text-dim">{t('Este repositorio no tiene un remoto de GitHub.')}</div>
    if (report.error) return <div className="px-3 py-3 text-[12px] text-bad break-words">{report.error}</div>
    const onBase = report.branch === report.base
    return (
      <>
        <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-dim">{t('Esta rama')}</div>
        {report.current ? (
          <PullRow pr={report.current} path={path} expandable />
        ) : (
          <div className="px-3 py-1.5 flex items-center gap-2 text-[12px]" data-no-pr>
            <span className="text-dim">
              {onBase
                ? t('Estás en {base}: las PR salen de otra rama hacia ella.', { base: report.base ?? '' })
                : t('{branch} no tiene PR.', { branch: report.branch ?? '' })}
            </span>
            {!onBase && report.branch && report.branch !== 'HEAD' ? (
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => setForm({ base: report.base ?? 'main', title: '', body: '', draft: false })}
                data-open-pr
              >
                <GitPullRequest size={12} /> {t('Abrir una PR')}
              </Button>
            ) : null}
          </div>
        )}

        <div className="px-3 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-dim">
          {t('Abiertas')} <span className="num">{report.open.length}</span>
        </div>
        {report.open.length ? (
          <div className="divide-y divide-[#151a26]" data-open-prs>
            {report.open.map((pr) => (
              <PullRow key={pr.number} pr={pr} path={path} expandable />
            ))}
          </div>
        ) : (
          <div className="px-3 py-1.5 text-[12px] text-dim">{t('Ninguna abierta.')}</div>
        )}

        {report.runs.length ? (
          <>
            <div className="px-3 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-dim flex items-center gap-1.5">
              <Workflow size={11} /> {t('Actions en esta rama')}
            </div>
            <div className="pb-1" data-runs>
              {report.runs.slice(0, 6).map((r) => (
                <div key={r.id} className="px-3 py-1 flex items-center gap-2 text-[12px]">
                  {r.status === 'completed' ? <CheckIcon state={r.conclusion ?? ''} /> : <Loader2 size={12} className="text-warn animate-spin shrink-0" />}
                  <span className="text-dim shrink-0">{r.workflow}</span>
                  <button onClick={() => open(r.url)} className="truncate text-left hover:text-accent min-w-0" title={r.url}>
                    {r.title}
                  </button>
                  <span className="ml-auto text-[11px] text-dim num shrink-0">{relTime(r.createdAt)}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </>
    )
  }

  return (
    <div className="border border-line rounded-lg bg-panel" data-pulls>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line-soft">
        <GitPullRequest size={13} className="text-violet" />
        <span className="text-[12px] font-medium">{t('Pull requests y CI')}</span>
        <button onClick={() => void load()} className="ml-auto p-1 rounded text-dim hover:text-accent hover:bg-raised" title={t('Volver a mirar')}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {body()}

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={t('Abrir una pull request')}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" loading={busy === 'create'} disabled={!form?.title.trim() || !form?.base.trim() || Boolean(busy)} onClick={() => void create()} data-create-pr>
              <GitPullRequest size={13} /> {t('Abrir la PR')}
            </Button>
          </>
        }
      >
        {form && report ? (
          <div className="space-y-3" data-pr-form>
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <Field label={t('Hacia la rama')}>
                <Input value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} className="font-mono" />
              </Field>
              <Button onClick={() => void describe()} disabled={!pick || Boolean(busy)} title={pick ? shortModel(pick.model) : t('Elige un modelo en «Confirmar»')} data-ai-pr>
                {busy === 'ai' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t('Escribir con IA')}
              </Button>
            </div>
            <Field label={t('Título')}>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-pr-title />
            </Field>
            <Field label={t('Descripción')}>
              <Textarea rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="text-[12.5px]" data-pr-body />
            </Field>
            {aiNote ? (
              <div className="text-[11px] text-dim flex items-center gap-1.5">
                <Sparkles size={11} className="text-violet" /> {aiNote}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <Toggle checked={form.draft} onChange={(v) => setForm({ ...form, draft: v })} label={t('Como borrador')} />
              <Button size="sm" variant="ghost" className="ml-auto" disabled={!pick || !form.base.trim()} onClick={() => setReviewing(true)} data-ai-review-branch>
                <ShieldCheck size={12} /> {t('Revisar la rama con IA')}
              </Button>
            </div>
            {report.needsPush ? (
              <p className="text-[11.5px] text-warn leading-relaxed" data-needs-push>
                {report.upstream
                  ? t('{branch} tiene commits sin subir: antes se suben (git push).', { branch: report.branch ?? '' })
                  : t('{branch} no está en GitHub: antes se sube a origin (git push -u origin HEAD).', { branch: report.branch ?? '' })}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      {/* Encima del diálogo de la PR: al cerrarla se sigue donde estabas. */}
      <AiReview open={reviewing} onClose={() => setReviewing(false)} path={path} scope="branch" base={form?.base} pick={pick} />
    </div>
  )
}
