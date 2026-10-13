/**
 * Enrutador: escribes el prompt y Laya decide con qué lanzarlo.
 *
 * Al dejar de escribir, Laya (en tu equipo) lee el prompt; con lo que dice y
 * las reglas sale el perfil de la tarea y, de ahí, el modelo, el esfuerzo y el
 * proveedor entre lo que tienes: claves de API, CLIs con sesión y cupo, y
 * modelos locales. «Lanzar» abre la conversación con eso y le manda el prompt.
 * Debajo van las alternativas y lo que contestó Laya, para que se vea por qué.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Route, Sparkles, Cpu, Cloud, Terminal, Rocket, Download, Loader2, Trash2, X, AlertTriangle, Gauge, Wrench, Image as ImageIcon
} from 'lucide-react'
import { Button, Badge, Select, Textarea, Meter, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { bytes, cost, shortModel, colorFor } from '../lib/format'
import { useQuotas, useRunsVersion, newSession, sendTurn, focusChat } from '../lib/engine'
import { useAccounts, refreshAccounts } from '../lib/accounts'
import { useLaya, installLaya, cancelLayaInstall, removeLaya } from '../lib/laya'
import { decideRoute, mixProfile, type RouteDecision, type RouteOption } from '../lib/router'
import type { Effort, LayaClassification, ModelInfo, ModelUsage } from '@shared/types'

const CATEGORY_LABEL: Record<string, string> = {
  code: 'Código',
  agentic: 'Trabajo en un proyecto',
  reasoning: 'Razonamiento',
  writing: 'Redacción',
  design: 'Diseño',
  general: 'General'
}
const DIFFICULTY_LABEL = ['', 'Trivial', 'Sencilla', 'Normal', 'Difícil', 'Muy difícil']
const EFFORT_LABEL: Record<Effort, string> = {
  auto: 'el suyo',
  minimal: 'Mínimo',
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  max: 'Máximo'
}
const LAYA_ROWS: [string, string][] = [
  ['code', 'Código'],
  ['agentic', 'Proyecto entero'],
  ['reasoning', 'Razonar'],
  ['writing', 'Texto'],
  ['design', 'Diseño visual'],
  ['trivial', 'Trivial'],
  ['expert', 'Muy difícil'],
  ['tools', 'Tocar archivos'],
  ['vision', 'Mirar imágenes'],
  ['think', 'Pensar con calma']
]

/* ------------------------------------------------------------------ *
 * Instalar Laya                                                      *
 * ------------------------------------------------------------------ */

export function LayaSetup({ compact }: { compact?: boolean }): React.JSX.Element | null {
  const t = useT()
  const { toast } = useStore()
  const { status, progress } = useLaya()
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (!status) return null
  const busy = status.state === 'installing'

  const install = async (): Promise<void> => {
    const r = await installLaya()
    if (r.ok) toast('ok', t('Laya está listo: ya decide en tu equipo'))
    else if (r.error && r.error !== 'cancelado') toast('error', t('No se pudo instalar Laya:') + ' ' + t(r.error))
  }

  if (status.state === 'ready') {
    if (compact) return null
    return (
      <div className="flex items-center gap-2 text-[11.5px] text-dim flex-wrap" data-laya="ready">
        <Cpu size={12} className="text-ok" />
        <span>
          {t('Laya {v} en tu equipo', { v: status.version })} · {status.repo.split('/')[1]}@{status.revision.slice(0, 7)}
          {status.diskBytes ? ` · ${bytes(status.diskBytes)}` : ''}
          {status.python ? ` · Python ${status.python}` : ''}
        </span>
        {confirmRemove ? (
          <>
            <span className="text-warn">{t('¿Quitarlo? Se borran el entorno y el modelo.')}</span>
            <Button size="sm" variant="ghost" onClick={() => void removeLaya().then(() => setConfirmRemove(false))}>
              {t('Sí, quitar')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              {t('No')}
            </Button>
          </>
        ) : (
          <button className="inline-flex items-center gap-1 hover:text-bad" onClick={() => setConfirmRemove(true)}>
            <Trash2 size={11} /> {t('Quitar')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="border border-line rounded-xl p-3 space-y-2 bg-raised" data-laya={status.state}>
      <div className="flex items-start gap-2.5">
        <Route size={15} className="text-accent shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
          <div className="font-medium text-[12.5px]">{t('Laya decide por ti, en tu equipo')}</div>
          <div className="text-dim">
            {t(
              'Un modelo de decisiones (Apache-2.0) que lee el prompt y dice qué tipo de tarea es, cuánto cuesta y si hay que tocar archivos. Se instala aparte: un entorno de Python con PyTorch sólo CPU y el modelo multilingüe (unos 1,5 GB en total). No abre ningún puerto y, descargado, funciona sin red.'
            )}
          </div>
          {busy && progress ? (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1.5 text-muted">
                <Loader2 size={12} className="animate-spin" /> {t(progress.detail ?? '', progress.vars)}
                {progress.pct != null ? <span className="num ml-1">{progress.pct} %</span> : null}
              </div>
              {progress.pct != null ? <Meter value={progress.pct} max={100} /> : null}
            </div>
          ) : null}
          {!busy && (progress?.error || status.error) ? (
            <div className="mt-1.5 text-warn flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span className="break-words">{progress?.error ?? status.error}</span>
            </div>
          ) : null}
        </div>
        {busy ? (
          <Button size="sm" variant="ghost" onClick={cancelLayaInstall}>
            <X size={12} /> {t('Cancelar')}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void install()} data-laya-install>
            <Download size={12} /> {t('Instalar Laya')}
          </Button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * El enrutador                                                       *
 * ------------------------------------------------------------------ */

function optionIcon(o: RouteOption): React.ElementType {
  return o.kind === 'cli' ? Terminal : o.kind === 'local' ? Cpu : Cloud
}

function optionCost(o: RouteOption, t: ReturnType<typeof useT>): string {
  if (o.kind === 'local') return t('gratis')
  if (o.kind === 'cli') return o.quotaLeftPct != null ? t('de tu plan ({n} % libre)', { n: o.quotaLeftPct }) : t('de tu plan')
  return o.cost == null ? t('sin precio') : cost(o.cost)
}

export function AutoRouter({
  initialText = '',
  projectId: fixedProject,
  onLaunched
}: {
  initialText?: string
  /** Proyecto fijo (desde una conversación); sin él se elige aquí. */
  projectId?: string
  onLaunched?: (sessionId: string) => void
}): React.JSX.Element {
  const t = useT()
  const { models, config, defs, toast } = useStore()
  const quotas = useQuotas()
  const version = useRunsVersion()
  const { list: accounts } = useAccounts()
  const { status } = useLaya()
  const [text, setText] = useState(initialText)
  const [projectId, setProjectId] = useState(fixedProject ?? '')
  const [usage, setUsage] = useState<ModelUsage[]>([])
  const [market, setMarket] = useState<ModelInfo[]>([])
  const [laya, setLaya] = useState<{ text: string; c: LayaClassification } | null>(null)
  const [reading, setReading] = useState(false)
  const [layaError, setLayaError] = useState<string | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const seq = useRef(0)
  const ready = status?.state === 'ready'

  useEffect(() => {
    void window.api.runs.modelUsage().then((r) => r.ok && r.data && setUsage(r.data))
  }, [version])
  useEffect(() => {
    void window.api.models.catalog('', 5000).then((r) => r.ok && r.data && setMarket(r.data))
    if (!accounts) void refreshAccounts()
  }, [])
  // Se carga el modelo en cuanto abres el enrutador, no al primer prompt.
  useEffect(() => {
    if (ready) void window.api.laya.warm()
  }, [ready])

  // Al dejar de escribir, Laya lee el prompt.
  useEffect(() => {
    if (!ready || text.trim().length < 6) return
    const n = ++seq.current
    const timer = setTimeout(async () => {
      setReading(true)
      const r = await window.api.laya.classify(text.trim())
      if (n !== seq.current) return
      setReading(false)
      if (r.ok && r.data) {
        setLayaError(null)
        setLaya({ text, c: r.data })
      } else setLayaError(r.error ?? t('Laya no contestó'))
    }, 700)
    return () => clearTimeout(timer)
  }, [text, ready, t])

  const project = projectId || undefined
  const decision: RouteDecision | null = useMemo(() => {
    if (!text.trim()) return null
    const c = laya && laya.text === text ? laya.c : null
    const profile = mixProfile(text, c, { project: Boolean(project) })
    const signedIn: Record<string, boolean | null> = {}
    for (const a of accounts ?? []) signedIn[a.id] = a.installed ? a.signedIn : false
    return decideRoute(profile, {
      models,
      market,
      usage,
      cliAgents: config?.cliAgents ?? [],
      signedIn,
      quotas: quotas?.quotas ?? [],
      localProviders: defs.filter((d) => d.local).map((d) => d.id),
      providerName: (id) => defs.find((d) => d.id === id)?.name ?? id
    })
  }, [text, laya, project, accounts, models, market, usage, config?.cliAgents, quotas, defs])

  const launch = async (o: RouteOption, effort: Effort): Promise<void> => {
    if (!config || !decision) return
    const prompt = text.trim()
    if (!prompt) return
    setLaunching(o.key)
    try {
      const title = prompt.replace(/\s+/g, ' ').slice(0, 54)
      const id =
        o.kind === 'cli'
          ? await newSession('cli', { title, cliAgentId: o.cliAgentId, cliModel: o.cliModel, effort, projectId: project })
          : await newSession('chat', {
              title,
              providerId: o.providerId,
              model: o.model,
              effort,
              projectId: project,
              ...(project ? { agentMode: true, maxTokens: 8192 } : {})
            })
      focusChat(id)
      onLaunched?.(id)
      const r = await sendTurn(id, prompt, config)
      if (r.error) toast('error', t(r.error))
    } finally {
      setLaunching(null)
    }
  }

  const p = decision?.profile
  const pick = decision?.pick

  return (
    <div className="space-y-3" data-router>
      <LayaSetup compact={Boolean(fixedProject)} />

      <Textarea
        rows={4}
        value={text}
        placeholder={t('Escribe el prompt: Laya decide modelo, esfuerzo y proveedor…')}
        onChange={(e) => setText(e.target.value)}
        data-router-input
      />

      {fixedProject ? null : (
        <div className="flex items-center gap-2 text-[12px] flex-wrap">
          <span className="text-dim">{t('Proyecto')}</span>
          <div className="w-56">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 text-[12px]">
              <option value="">{t('Ninguno: sólo conversar')}</option>
              {(config?.projects ?? []).map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </Select>
          </div>
          <span className="text-[11px] text-dim">{t('Con proyecto, la tarea se hace sobre sus archivos.')}</span>
        </div>
      )}

      {p ? (
        <div className="flex items-center gap-2 flex-wrap text-[11.5px]" data-router-profile={p.source}>
          <Badge tone="accent">{t(CATEGORY_LABEL[p.category] ?? p.category)}</Badge>
          <Badge>{t(DIFFICULTY_LABEL[p.difficulty])}</Badge>
          {p.needsTools ? (
            <Badge tone="accent">
              <Wrench size={10} /> {t('con herramientas')}
            </Badge>
          ) : null}
          {p.needsVision ? (
            <Badge>
              <ImageIcon size={10} /> {t('mira imágenes')}
            </Badge>
          ) : null}
          <span className="ml-auto text-dim flex items-center gap-1.5">
            {reading ? <Sparkles size={11} className="animate-pulse text-accent" /> : null}
            {p.source === 'laya'
              ? t('Laya + reglas · Laya contestó en {ms} ms', { ms: Math.round(p.laya?.ms ?? 0) })
              : ready
                ? t('Por reglas; Laya lo afina al dejar de escribir')
                : t('Sólo reglas: instala Laya para que decida él')}
          </span>
        </div>
      ) : null}
      {layaError ? <div className="text-[11px] text-warn">{layaError}</div> : null}

      {decision ? (
        pick ? (
          <div className="border border-accent-dim bg-accent/5 rounded-xl p-3.5 space-y-2.5" data-router-pick={pick.key}>
            <div className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wider text-dim">
              <Route size={12} className="text-accent" /> {t('Decisión')}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="w-1.5 h-9 rounded-full shrink-0" style={{ background: colorFor(pick.label) }} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[14px] truncate" title={pick.label}>
                  {pick.kind === 'cli' ? pick.label || t('su modelo por omisión') : shortModel(pick.label)}
                </div>
                <div className="text-[12px] text-muted flex items-center gap-1.5 flex-wrap">
                  {React.createElement(optionIcon(pick), { size: 12, className: 'text-dim' })}
                  {pick.via}
                  <span className="text-dim">·</span>
                  <Gauge size={12} className="text-dim" /> {t('esfuerzo {e}', { e: t(EFFORT_LABEL[decision.effort]) })}
                  <span className="text-dim">·</span>
                  <span className="num">{optionCost(pick, t)}</span>
                  {pick.level != null ? (
                    <>
                      <span className="text-dim">·</span>
                      <span className="num">{t('nivel {n}', { n: pick.level })}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <Button variant="primary" onClick={() => void launch(pick, decision.effort)} loading={launching === pick.key} data-router-launch>
                <Rocket size={13} /> {t('Lanzar')}
              </Button>
            </div>
            <ul className="text-[11.5px] text-dim space-y-0.5 list-disc pl-4">
              {decision.why.map((w) => (
                <li key={w.key}>{t(w.key, w.vars?.['what'] ? { ...w.vars, what: t(String(w.vars['what'])) } : w.vars)}</li>
              ))}
              <li>
                {t('Esfuerzo {e}: {why}.', {
                  e: t(EFFORT_LABEL[decision.effort]).toLowerCase(),
                  why: t(decision.effortWhy.key, decision.effortWhy.vars)
                })}
              </li>
            </ul>
          </div>
        ) : (
          <div className="text-[12px] text-warn flex items-center gap-1.5">
            <AlertTriangle size={12} />
            {t('No hay nada con qué lanzarlo: pon una clave de API, inicia sesión en un CLI o arranca Ollama.')}
          </div>
        )
      ) : null}

      {decision?.alternatives.length ? (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-dim">{t('También valdrían')}</div>
          {decision.alternatives.map((o) => (
            <div key={o.key} className="flex items-center gap-2 text-[12px]" data-router-alt={o.key}>
              {React.createElement(optionIcon(o), { size: 12, className: 'text-dim shrink-0' })}
              <span className="font-mono truncate min-w-0">{o.kind === 'cli' ? o.label || t('su modelo por omisión') : shortModel(o.label)}</span>
              <span className="text-dim truncate">{o.via}</span>
              <span className="num text-dim ml-auto shrink-0">{optionCost(o, t)}</span>
              <Button size="sm" variant="ghost" loading={launching === o.key} onClick={() => void launch(o, o.supportsEffort ? decision.effort : 'auto')}>
                {t('Lanzar')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {p?.laya ? (
        <details className="text-[11.5px]">
          <summary className="cursor-pointer text-dim hover:text-muted">{t('Lo que contestó Laya')}</summary>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
            {LAYA_ROWS.map(([k, label]) => {
              const v = p.laya!.yes[k] ?? 0
              return (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-muted">{t(label)}</span>
                  <Meter value={v} max={1} color={v > 0.5 ? 'var(--color-accent)' : undefined} />
                  <span className={cx('num w-9 text-right shrink-0', v > 0.5 ? 'text-ink' : 'text-dim')}>{Math.round(v * 100)} %</span>
                </div>
              )
            })}
          </div>
          <p className="text-dim mt-2 leading-relaxed">
            {t(
              'Medido con 70 tareas etiquetadas a mano: el tipo lo acierta en la mitad de los casos nuevos y la dificultad, a un punto, en 9 de cada 10. Por eso se junta con las reglas y puedes lanzar cualquier alternativa.'
            )}
          </p>
        </details>
      ) : null}
    </div>
  )
}
