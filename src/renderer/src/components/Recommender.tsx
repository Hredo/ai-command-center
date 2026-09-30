/**
 * Recomendador: escribe la tarea y te dice qué IA usar.
 *
 * Mientras escribes, unas reglas la clasifican al momento; cuando paras, un
 * modelo local de Ollama la vuelve a leer y afina (nada sale del equipo). Si
 * no te convence, tocas tú el tipo o la dificultad. Debajo, tres opciones con
 * su coste y su tiempo estimados, lo que tienes gratis en tu equipo y cuánto
 * te queda en tus suscripciones.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Cpu, Cloud, Wrench, Image as ImageIcon, Timer, DollarSign, Crown, Scale, Feather, Terminal, AlertTriangle } from 'lucide-react'
import { Button, Badge, Select, Textarea, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { cost, shortModel, colorFor, tokens } from '../lib/format'
import { useQuotas, useRunsVersion } from '../lib/engine'
import {
  classifyByRules, estimateTokens, recommend, TASK_CATEGORIES,
  type ModelPick, type SubscriptionPick, type TaskCategory, type TaskProfile
} from '../lib/recommend'
import type { ModelInfo, ModelUsage } from '@shared/types'

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  code: 'Código',
  agentic: 'Trabajo en un proyecto',
  reasoning: 'Razonamiento',
  writing: 'Redacción',
  design: 'Diseño',
  general: 'General'
}

const INDEX_LABEL: Record<ModelPick['indexName'], string> = {
  coding: 'código',
  agentic: 'agéntico',
  intelligence: 'inteligencia'
}

const DIFFICULTY_LABEL = ['', 'Trivial', 'Sencilla', 'Normal', 'Difícil', 'Muy difícil']

function seconds(s?: number): string {
  if (s == null) return ''
  if (s < 90) return `≈ ${Math.max(1, Math.round(s))} s`
  return `≈ ${Math.round(s / 60)} min`
}

export function Recommender({
  initialText = '',
  projectId,
  onUse,
  onUseAgent,
  compact
}: {
  initialText?: string
  /** Con proyecto la tarea cuenta como trabajo sobre él. */
  projectId?: string
  onUse: (m: ModelInfo, text: string, profile: TaskProfile) => void
  /** Usar una suscripción (agente de consola). Sin esto, no se ofrecen. */
  onUseAgent?: (agentId: string, text: string) => void
  compact?: boolean
}): React.JSX.Element {
  const t = useT()
  const { models, config, defs, reload } = useStore()
  const quotas = useQuotas()
  const version = useRunsVersion()
  const [text, setText] = useState(initialText)
  const [usage, setUsage] = useState<ModelUsage[]>([])
  const [market, setMarket] = useState<ModelInfo[]>([])
  const [local, setLocal] = useState<{ text: string; profile: Partial<TaskProfile>; model: string; ms: number } | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [classError, setClassError] = useState<string | null>(null)
  const [manual, setManual] = useState<{ category?: TaskCategory; difficulty?: number }>({})
  const seq = useRef(0)

  useEffect(() => {
    void window.api.runs.modelUsage().then((r) => r.ok && r.data && setUsage(r.data))
  }, [version])
  useEffect(() => {
    void window.api.models.catalog('', 5000).then((r) => r.ok && r.data && setMarket(r.data))
  }, [])

  // El clasificador: el que elegiste o, si no, el modelo local más pequeño.
  const localModels = useMemo(
    () =>
      models
        .filter((m) => m.providerId === 'ollama' && !/(embed|rerank)/i.test(m.id))
        .sort((a, b) => (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity)),
    [models]
  )
  const chosen = config?.settings.recommendClassifier ?? ''
  const classifier = chosen === 'rules' ? null : localModels.find((m) => m.id === chosen)?.id ?? localModels[0]?.id ?? null

  // Al parar de escribir, el modelo local la vuelve a leer.
  useEffect(() => {
    setManual({})
    if (!classifier || text.trim().length < 12) return
    const n = ++seq.current
    const timer = setTimeout(async () => {
      setClassifying(true)
      const r = await window.api.recommend.classify(text.trim(), classifier)
      if (n !== seq.current) return
      setClassifying(false)
      if (r.ok && r.data) {
        setClassError(null)
        setLocal({
          text,
          model: classifier,
          ms: r.data.ms,
          profile: {
            category: (TASK_CATEGORIES as string[]).includes(r.data.category) ? (r.data.category as TaskCategory) : 'general',
            difficulty: r.data.difficulty,
            needsTools: r.data.needsTools,
            needsVision: r.data.needsVision
          }
        })
      } else setClassError(r.error ?? t('No se pudo clasificar'))
    }, 900)
    return () => clearTimeout(timer)
  }, [text, classifier, t])

  const profile: TaskProfile = useMemo(() => {
    const rules = classifyByRules(text, { project: Boolean(projectId) })
    const fromLocal = local && local.text === text ? local.profile : null
    let p: TaskProfile = fromLocal
      ? {
          ...rules,
          ...fromLocal,
          // Con proyecto, es trabajo sobre él aunque el modelo local no lo vea.
          category: projectId ? 'agentic' : (fromLocal.category as TaskCategory),
          needsTools: Boolean(projectId) || Boolean(fromLocal.needsTools),
          source: 'local',
          classifier: local!.model
        }
      : rules
    if (manual.category || manual.difficulty) {
      p = { ...p, category: manual.category ?? p.category, difficulty: manual.difficulty ?? p.difficulty, source: 'manual' }
      p.needsTools = p.category === 'agentic' || (Boolean(projectId) && p.needsTools)
    }
    return { ...p, ...estimateTokens(text, p) }
  }, [text, projectId, local, manual])

  const rec = useMemo(
    () =>
      recommend(profile, models, usage, market, {
        cliAgents: onUseAgent ? config?.cliAgents : [],
        quotas: quotas?.quotas,
        localProviders: defs.filter((d) => d.local).map((d) => d.id)
      }),
    [profile, models, usage, market, config?.cliAgents, quotas, onUseAgent, defs]
  )

  const providerName = (id: string): string => defs.find((d) => d.id === id)?.name ?? id
  const empty = !text.trim()

  const card = (
    kind: 'sufficient' | 'balanced' | 'best',
    pick: ModelPick | undefined,
    Icon: React.ElementType,
    title: string,
    why: string
  ): React.JSX.Element => (
    <div className={cx('border rounded-xl p-3 flex flex-col gap-2 min-w-0', kind === 'sufficient' ? 'border-accent-dim bg-[#0b161b]' : 'border-line bg-raised')} data-pick={kind}>
      <div className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wider text-dim">
        <Icon size={12} className={kind === 'sufficient' ? 'text-accent' : kind === 'best' ? 'text-warn' : 'text-violet'} /> {t(title)}
      </div>
      {pick ? (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-1.5 h-5 rounded-full shrink-0" style={{ background: colorFor(pick.model.id) }} />
            <div className="min-w-0">
              <div className="font-mono text-[12.5px] truncate" title={pick.model.id}>
                {shortModel(pick.model.id)}
              </div>
              <div className="text-[11px] text-dim truncate">{providerName(pick.model.providerId)}</div>
            </div>
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11.5px] num">
            <span title={t('Índice de Artificial Analysis que publica OpenRouter')}>
              {t('Nivel')} <span className="text-ink">{pick.index ?? '—'}</span> <span className="text-dim">{t(INDEX_LABEL[pick.indexName])}</span>
            </span>
            <span className="inline-flex items-center gap-0.5" title={t('Estimado con el precio del catálogo')}>
              <DollarSign size={10} className="text-dim" />
              {pick.cost == null ? t('sin precio') : pick.cost === 0 ? t('gratis') : cost(pick.cost)}
            </span>
            <span className="inline-flex items-center gap-0.5" title={t('Con tu velocidad medida en este modelo')}>
              <Timer size={10} className="text-dim" />
              {pick.seconds == null ? <span className="text-dim">{t('sin medir')}</span> : seconds(pick.seconds)}
            </span>
            {pick.elo ? <span title={t('Tu Elo personal en la Arena')}>Elo {Math.round(pick.elo)}</span> : null}
          </div>
          <p className="text-[11px] text-dim leading-snug flex-1">{t(why)}</p>
          <Button size="sm" variant={kind === 'sufficient' ? 'primary' : 'ghost'} disabled={empty} onClick={() => onUse(pick.model, text, profile)}>
            {t('Usar')}
          </Button>
        </>
      ) : (
        <p className="text-[11.5px] text-dim">{t('Ninguno de tus modelos tiene puntuación pública para compararlo.')}</p>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      <Textarea
        rows={compact ? 3 : 4}
        value={text}
        placeholder={t('Describe la tarea: qué quieres que haga la IA…')}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
        <div className="w-48 shrink-0">
          <Select
            value={profile.category}
            onChange={(e) => setManual((m) => ({ ...m, category: e.target.value as TaskCategory }))}
            className="h-7 text-[11.5px] py-0"
            aria-label={t('Tipo de tarea')}
          >
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(CATEGORY_LABEL[c])}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-0.5" role="group" aria-label={t('Dificultad')}>
          {[1, 2, 3, 4, 5].map((d) => (
            <button
              key={d}
              onClick={() => setManual((m) => ({ ...m, difficulty: d }))}
              title={t(DIFFICULTY_LABEL[d])}
              className={cx('w-6 h-6 rounded-md border text-[11px] num', d <= profile.difficulty ? 'border-accent-dim bg-[#0b161b] text-accent' : 'border-line text-dim')}
            >
              {d}
            </button>
          ))}
          <span className="ml-1.5 text-muted">{t(DIFFICULTY_LABEL[profile.difficulty])}</span>
        </div>
        {profile.needsTools ? (
          <Badge tone="accent">
            <Wrench size={10} /> {t('con herramientas')}
          </Badge>
        ) : null}
        {profile.needsVision ? (
          <Badge>
            <ImageIcon size={10} /> {t('mira imágenes')}
          </Badge>
        ) : null}
        <span className="text-dim num" title={t('Estimación: el prompt y lo que suele gastar este tipo de tarea')}>
          {t('~{in} de entrada · ~{out} de salida', { in: tokens(profile.inTokens), out: tokens(profile.outTokens) })}
        </span>
        <span className="ml-auto text-dim flex items-center gap-1.5" data-classifier={profile.source}>
          {classifying ? <Sparkles size={11} className="animate-pulse text-accent" /> : null}
          {profile.source === 'local'
            ? t('Clasificada por {model} ({ms})', { model: profile.classifier ?? '', ms: seconds((local?.ms ?? 0) / 1000) })
            : profile.source === 'manual'
              ? t('Ajustada por ti')
              : classifier
                ? t('Por reglas; {model} la afina al dejar de escribir', { model: classifier })
                : t('Por reglas (sin modelo local)')}
        </span>
      </div>
      {classError ? <div className="text-[11px] text-warn">{classError}</div> : null}

      {!models.length ? (
        <p className="text-[12px] text-dim">{t('No tienes modelos disponibles: añade una clave en Ajustes o arranca Ollama.')}</p>
      ) : (
        <>
          {rec.belowBar ? (
            <div className="flex items-start gap-1.5 text-[12px] text-warn">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {t('Ninguno de tus modelos llega al nivel que pide esta tarea: te enseño el mejor que tienes.')}
            </div>
          ) : null}
          <div className={cx('grid gap-3', compact ? 'grid-cols-3' : 'grid-cols-1 md:grid-cols-3')}>
            {card('sufficient', rec.sufficient, Feather, 'Suficiente', rec.belowBar ? 'El mejor que tienes, aunque no llegue.' : 'El más barato que llega al nivel que pide la tarea.')}
            {card(
              'balanced',
              rec.balanced,
              Scale,
              'Equilibrada',
              rec.balanced && rec.balanced.model === rec.sufficient?.model
                ? 'Coincide con la suficiente: subir de nivel no sale a cuenta para esta tarea.'
                : 'Más nivel sólo si sale a cuenta: cada vez que dobla el precio, gana al menos 10 puntos.'
            )}
            {card('best', rec.best, Crown, 'Máxima', 'El de más nivel de los que tienes, cueste lo que cueste.')}
          </div>

          {rec.local ? (
            <div className="flex items-center gap-2 text-[12px] border border-line rounded-lg px-3 py-2" data-pick="local">
              <Cpu size={13} className="text-ok shrink-0" />
              <span className="min-w-0 flex-1">
                {t('Gratis en tu equipo:')} <span className="font-mono">{rec.local.model.id}</span>{' '}
                <span className="text-dim">
                  {t('sin puntuación pública')}
                  {rec.local.elo ? ` · Elo ${Math.round(rec.local.elo)}` : ''}
                  {rec.local.seconds != null ? ` · ${seconds(rec.local.seconds)}` : ''}
                </span>
              </span>
              <Button size="sm" variant="ghost" disabled={empty} onClick={() => onUse(rec.local!.model, text, profile)}>
                {t('Usar')}
              </Button>
            </div>
          ) : null}

          {rec.subscriptions.length ? (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-dim">{t('Con tus suscripciones')}</div>
              {rec.subscriptions.map((s: SubscriptionPick) => (
                <div key={s.agent.id} className="flex items-center gap-2 text-[12px]" data-sub={s.agent.id}>
                  <Terminal size={12} className="text-warn shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {s.agent.name}{' '}
                    <span className="text-dim">
                      {s.leftPct != null
                        ? t('te queda un {n} % de {what}', { n: s.leftPct, what: t(s.quota?.label ?? '') })
                        : t('sin cupo conocido')}
                    </span>
                  </span>
                  {onUseAgent ? (
                    <Button size="sm" variant="ghost" disabled={empty || s.leftPct === 0} onClick={() => onUseAgent(s.agent.id, text)}>
                      {t('Usar')}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="text-[11px] text-dim space-y-0.5">
            {rec.threshold != null ? (
              <div>
                <Cloud size={10} className="inline mr-1" />
                {t('Nivel mínimo para esta dificultad: {n} ({index}), según el mercado entero.', {
                  n: rec.threshold,
                  index: t(INDEX_LABEL[rec.sufficient?.indexName ?? 'intelligence'])
                })}
              </div>
            ) : null}
            {rec.unrated ? <div>{t('{n} de tus modelos no tienen puntuación pública y no entran en la comparación.', { n: rec.unrated })}</div> : null}
            {rec.excluded.tools ? <div>{t('{n} se quedan fuera porque no usan herramientas.', { n: rec.excluded.tools })}</div> : null}
            {rec.excluded.vision ? <div>{t('{n} se quedan fuera porque no ven imágenes.', { n: rec.excluded.vision })}</div> : null}
            {rec.excluded.context ? <div>{t('{n} se quedan fuera por ventana de contexto.', { n: rec.excluded.context })}</div> : null}
          </div>
        </>
      )}

      {!compact ? (
        <div className="flex items-center gap-2 text-[11.5px] text-dim pt-1">
          <span>{t('Clasificador')}</span>
          <div className="w-56">
            <Select
              value={chosen}
              className="h-7 text-[11.5px] py-0"
              onChange={(e) => void window.api.config.settings({ recommendClassifier: e.target.value }).then(() => reload())}
            >
              <option value="">{t('El modelo local más pequeño')}</option>
              {localModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
              <option value="rules">{t('Sólo reglas, sin modelo')}</option>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  )
}
