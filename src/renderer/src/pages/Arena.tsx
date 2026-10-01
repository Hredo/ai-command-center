/**
 * Arena: el mismo prompt contra varios contendientes a la vez.
 *
 * Un contendiente puede ser un modelo por API o un agente de línea de
 * comandos. Los dos acaban en el mismo histórico con el mismo arenaId, así que
 * se comparan en la misma tabla: tokens, primer token, velocidad y coste.
 * El estado vive en el motor, así que la comparativa sigue aunque cambies de
 * pantalla.
 *
 * Con un proyecto elegido es la Arena de código: cada contendiente trabaja en
 * su propio worktree (los de API, como agentes), se pasan las pruebas en cada
 * uno y se fusiona el que gane. Así varios agentes pueden hacer la misma tarea
 * a la vez sin pisarse ni tocar tu carpeta.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  Swords, Play, Square, Plus, X, Trophy, Timer, Zap, DollarSign, Crown,
  AlertTriangle, RotateCcw, ChevronDown, History as HistoryIcon, Cpu, Bot, FolderGit2, Medal,
  GitBranch, GitMerge, FileDiff, FlaskConical, Trash2, Save, ListChecks
} from 'lucide-react'
import { Button, Textarea, Badge, cx, Dot, Meter, Select, Input, Modal, Toggle } from '../components/ui'
import { ModelPicker } from '../components/ModelPicker'
import { Markdown } from '../components/Markdown'
import { LiveMetrics } from '../components/Stats'
import { AgentActivity } from '../components/AgentActivity'
import { DiffReview } from '../components/DiffReview'
import { BatteryPanel } from '../components/BatteryPanel'
import { PromptTextarea, SavePromptButton } from '../components/PromptLibrary'
import { samePath } from '../components/WorktreeBox'
import { useStore } from '../lib/store'
import { cost, tokens, ms, tps, shortModel, colorFor, relTime } from '../lib/format'
import {
  useArena, setArena, setContenders, emptyContender, launchArena, stopArena, useRunsVersion, approveStep,
  type Contender
} from '../lib/engine'
import type { EloRow, RunRecord } from '@shared/types'
import { SharedWidthHandle } from '../components/Resizable'
import { usePaneSize } from '../lib/prefs'

import { useT } from '../lib/i18n'
import { withMod } from '../lib/platform'

/** Cuántos contendientes caben en una comparativa. */
const MAX_CONTENDERS = 8

/** Hasta dónde llegan sin preguntar en la Arena de código (lo que entienden los dos tipos de agente). */
const ARENA_MODES = [
  { id: 'acceptEdits', label: 'Edita solo' },
  { id: 'plan', label: 'Sólo plan' },
  { id: 'bypassPermissions', label: 'Sin límites' }
] as const

/** Marca el mejor valor de cada métrica entre los contendientes. */
function best(runs: (RunRecord | undefined)[], field: keyof RunRecord, dir: 'min' | 'max'): number | null {
  const vals = runs.map((r) => (r ? Number(r[field] ?? NaN) : NaN)).filter((v) => !Number.isNaN(v) && v > 0)
  if (!vals.length) return null
  return dir === 'min' ? Math.min(...vals) : Math.max(...vals)
}

/** Los contendientes por defecto se guardan como «api:proveedor:modelo» o «cli:agente». */
function fromDefault(s: string): Contender | null {
  if (s.startsWith('cli:') && s.length > 4) return { ...emptyContender('cli'), cliAgentId: s.slice(4) }
  if (s.startsWith('api:')) {
    const rest = s.slice(4)
    const at = rest.indexOf(':')
    if (at > 0) return { ...emptyContender('api'), providerId: rest.slice(0, at), model: rest.slice(at + 1) }
  }
  return null
}

function toDefault(c: Contender): string | null {
  if (c.mode === 'cli') return c.cliAgentId ? `cli:${c.cliAgentId}` : null
  return c.providerId && c.model ? `api:${c.providerId}:${c.model}` : null
}

/** Líneas añadidas y quitadas de lo que cambió un contendiente. */
function changes(r?: RunRecord): { files: number; added: number; removed: number } | null {
  if (!r?.filesChanged) return null
  return r.filesChanged.reduce(
    (a, f) => ({ files: a.files + 1, added: a.added + f.added, removed: a.removed + f.removed }),
    { files: 0, added: 0, removed: 0 }
  )
}

export default function Arena(): React.JSX.Element {
  const t = useT()
  const { models, config, toast, reload } = useStore()
  const { size: columnWidth } = usePaneSize('arena.column')
  const state = useArena()
  const [sessions, setSessions] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [showRank, setShowRank] = useState(false)
  const [showBatteries, setShowBatteries] = useState(false)
  const [elo, setElo] = useState<EloRow[]>([])
  const [showSystem, setShowSystem] = useState(false)
  const [viewDiff, setViewDiff] = useState<Contender | null>(null)
  const [merging, setMerging] = useState<Contender | null>(null)
  const [mergeMsg, setMergeMsg] = useState('')
  const [cleanup, setCleanup] = useState(true)
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)

  const cliAgents = config?.cliAgents ?? []
  const projects = config?.projects ?? []
  const codeMode = Boolean(state.project)

  // Al abrir: los contendientes que guardaste como predeterminados o, si no
  // hay, dos modelos distintos.
  useEffect(() => {
    if (state.contenders.length > 0 || !config) return
    const saved = (config.settings.arenaDefaults ?? [])
      .map(fromDefault)
      .filter((c): c is Contender => Boolean(c))
      .filter((c) => c.mode === 'api' || cliAgents.some((a) => a.id === c.cliAgentId))
      .slice(0, MAX_CONTENDERS)
    if (saved.length) {
      setContenders(() => saved)
      return
    }
    const picks = models.slice(0, 2)
    if (!picks.length) return
    setContenders(() => [0, 1].map((i) => ({
      ...emptyContender('api'),
      providerId: picks[i]?.providerId,
      model: picks[i]?.id
    })))
  }, [models, config, cliAgents, state.contenders.length])

  const loadSessions = useCallback(async () => {
    const r = await window.api.runs.arena()
    if (r.ok && r.data) setSessions(r.data.slice(0, 25))
  }, [])

  // Se relee con cada cambio del histórico: una comparativa votada o borrada
  // desde otra pantalla se ve aquí sin tocar nada.
  const runsVersion = useRunsVersion()
  useEffect(() => {
    void loadSessions()
  }, [loadSessions, runsVersion])

  // La clasificación sale de los ganadores que marcas: cambia al votar.
  useEffect(() => {
    if (!showRank) return
    void window.api.runs.elo().then((r) => r.ok && r.data && setElo(r.data))
  }, [showRank, runsVersion])

  // Al acabar una comparativa se refresca el listado de guardadas.
  useEffect(() => {
    if (!state.running) void loadSessions()
  }, [state.running, loadSessions])

  const nameOf = (c: Contender): string =>
    c.mode === 'cli'
      ? (cliAgents.find((a) => a.id === c.cliAgentId)?.name ?? c.cliAgentId ?? 'agente')
      : shortModel(c.model ?? '')

  const launch = async (): Promise<void> => {
    if (!state.prompt.trim()) return
    const usable = state.contenders.some((c) => (c.mode === 'api' ? c.providerId && c.model : c.cliAgentId))
    if (!usable) {
      toast('error', t('Elige al menos un modelo o un agente'))
      return
    }
    // Un agente de línea de comandos sin proyecto trabaja en tu carpeta de
    // usuario; conviene avisarlo antes de que escriba ficheros donde no toca.
    if (!codeMode && state.contenders.some((c) => c.mode === 'cli' && c.cliAgentId)) {
      toast('info', t('Sin proyecto, los agentes de línea de comandos trabajan en tu carpeta de usuario'))
    }
    const names: Record<string, string> = {}
    for (const c of state.contenders) names[c.key] = nameOf(c)
    await launchArena(names)
    toast('ok', t('Comparativa terminada'))
  }

  const setWinner = async (runId: string): Promise<void> => {
    for (const c of state.contenders) {
      if (!c.run) continue
      await window.api.runs.update(c.run.id, { winner: c.run.id === runId })
    }
    setContenders((cs) => cs.map((c) => (c.run ? { ...c, run: { ...c.run, winner: c.run.id === runId } } : c)))
  }

  const loadSession = (s: any): void => {
    const roots = new Set(projects.map((p) => p.path.replace(/[\\/]+$/, '').toLowerCase()))
    setArena({
      prompt: s.prompt,
      arenaId: s.arenaId,
      contenders: s.runs.map((r: RunRecord) => {
        // Si trabajó en un worktree (su punto de control no está en la carpeta
        // de ningún proyecto), se puede volver a mirar su diff mientras exista.
        const root = r.checkpoint?.root
        const inWorktree = root && !roots.has(root.replace(/[\\/]+$/, '').toLowerCase())
        return {
          ...emptyContender(r.providerId.startsWith('cli:') ? 'cli' : 'api'),
          providerId: r.providerId.startsWith('cli:') ? undefined : r.providerId,
          model: r.providerId.startsWith('cli:') ? undefined : r.model,
          cliAgentId: r.agentId,
          runId: r.id,
          content: r.response,
          run: r,
          steps: r.steps,
          worktreePath: inWorktree ? root : undefined,
          streaming: false,
          error: r.status === 'error' ? r.error : undefined
        }
      })
    })
    setShowHistory(false)
    // Los worktrees de una comparativa vieja pueden haberse quitado ya: sin
    // carpeta no hay diff que ver ni nada que fusionar.
    for (const r of s.runs as RunRecord[]) {
      const root = r.checkpoint?.root
      if (!root || roots.has(root.replace(/[\\/]+$/, '').toLowerCase())) continue
      void window.api.worktrees.list(root).then((l) => {
        const alive = l.ok && l.data?.some((w) => !w.main && samePath(w.path, root))
        if (!alive) setContenders((cs) => cs.map((c) => (c.runId === r.id ? { ...c, worktreePath: undefined } : c)))
      })
    }
  }

  const pickProject = (id: string): void => {
    const p = projects.find((x) => x.id === id)
    setArena({
      project: p ? { id: p.id, name: p.name, path: p.path } : undefined,
      testCommand: p?.testCommand ?? ''
    })
  }

  // La orden de pruebas se recuerda en el proyecto.
  const saveTestCommand = async (value: string): Promise<void> => {
    const p = projects.find((x) => x.id === state.project?.id)
    if (!p || (p.testCommand ?? '') === value.trim()) return
    await window.api.projects.save({ ...p, testCommand: value.trim() || undefined })
    await reload()
  }

  const saveDefaults = async (): Promise<void> => {
    const list = state.contenders.map(toDefault).filter((x): x is string => Boolean(x))
    const r = await window.api.config.settings({ arenaDefaults: list })
    if (r.ok) {
      await reload()
      toast('ok', t('Estos {n} contendientes saldrán al abrir la Arena', { n: list.length }))
    } else toast('error', r.error ?? t('No se pudo guardar'))
  }

  const openMerge = (c: Contender): void => {
    const first = state.prompt.trim().split('\n')[0].slice(0, 60)
    setMergeMsg(`Arena: ${first}`)
    setCleanup(true)
    setMerging(c)
  }

  const pending = state.contenders.filter((c) => c.worktreePath && !c.outcome && !c.streaming && !c.phase)

  const removeWorktrees = async (list: Contender[], outcome: 'removed'): Promise<number> => {
    let n = 0
    for (const c of list) {
      const r = await window.api.worktrees.remove(c.worktreePath!, { force: true, deleteBranch: true })
      if (r.ok) {
        n++
        setContenders((cs) => cs.map((x) => (x.key === c.key ? { ...x, outcome } : x)))
      }
    }
    return n
  }

  const merge = async (): Promise<void> => {
    const c = merging
    if (!c?.worktreePath) return
    setBusy(true)
    if (c.run) await setWinner(c.run.id)
    const r = await window.api.worktrees.merge(c.worktreePath, { message: mergeMsg.trim() || undefined })
    if (!r.ok || !r.data) {
      setBusy(false)
      toast('error', r.error ?? t('No se pudo fusionar'))
      return
    }
    if (!r.data.ok) {
      setBusy(false)
      setMerging(null)
      toast(
        'error',
        r.data.conflicts?.length
          ? t('La fusión tiene conflictos en {n} ficheros: resuélvelos en la pestaña Git del proyecto.', { n: r.data.conflicts.length })
          : r.data.output
      )
      return
    }
    setContenders((cs) => cs.map((x) => (x.key === c.key ? { ...x, outcome: 'merged' } : x)))
    if (cleanup) {
      // El ganador ya está en tu rama: su worktree y su rama sobran, igual que los de los demás.
      await window.api.worktrees.remove(c.worktreePath, { force: true, deleteBranch: true })
      await removeWorktrees(pending.filter((x) => x.key !== c.key), 'removed')
    }
    setBusy(false)
    setMerging(null)
    toast('ok', t('{name} fusionado en tu rama de {project}', { name: nameOf(c), project: state.project?.name ?? '' }))
  }

  const discard = async (): Promise<void> => {
    setBusy(true)
    const n = await removeWorktrees(pending, 'removed')
    setBusy(false)
    setDiscarding(false)
    toast('ok', t('{n} worktrees quitados', { n }))
  }

  const runs = state.contenders.map((c) => c.run)
  const bestTtft = best(runs, 'ttftMs', 'min')
  const bestTps = best(runs, 'tokensPerSec', 'max')
  const bestCost = best(runs, 'costTotal', 'min')
  const bestTime = best(runs, 'totalMs', 'min')
  const maxCost = Math.max(...runs.map((r) => r?.costTotal ?? 0), 0.000001)
  const maxTps = Math.max(...runs.map((r) => r?.tokensPerSec ?? 0), 1)
  const hasResults = runs.some(Boolean)
  const anyCode = state.contenders.some((c) => c.worktreePath)

  return (
    <div className="h-full flex flex-col">
      <div className="min-h-12 px-5 py-1.5 border-b border-line flex items-center justify-between gap-x-3 gap-y-1.5 flex-wrap shrink-0 bg-void">
        <div className="flex items-center gap-2.5 shrink-0 max-w-full">
          <Swords size={15} className="text-violet shrink-0" />
          <span className="font-medium shrink-0">Arena</span>
          <span className="text-[12px] text-dim truncate @max-[64rem]:hidden">
            {codeMode
              ? t('la misma tarea, cada uno en su worktree: compara y fusiona el mejor')
              : t('mismo prompt, modelos y agentes, decisiones con datos')}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap max-w-full">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void saveDefaults()}
            disabled={state.running}
            title={t('Guardar estos contendientes para que salgan al abrir la Arena')}
          >
            <Save size={13} /> {t('Predeterminados')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowBatteries((s) => !s)}>
            <ListChecks size={13} /> {t('Baterías')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowRank((s) => !s)}>
            <Medal size={13} /> {t('Tu clasificación')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowHistory((s) => !s)}>
            <HistoryIcon size={13} /> {t('arena.history', { n: sessions.length })}
          </Button>
          {state.running ? (
            <Button size="sm" variant="danger" onClick={stopArena}>
              <Square size={12} /> {t('Parar todo')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void launch()} disabled={!state.prompt.trim()}>
              <Play size={12} /> {t('Lanzar')}
            </Button>
          )}
        </div>
      </div>

      {showBatteries ? <BatteryPanel names={nameOf} /> : null}

      {showRank ? (
        <div className="border-b border-line bg-panel max-h-[240px] overflow-y-auto shrink-0">
          {elo.length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-dim leading-relaxed">
              {t('Todavía no hay clasificación: sale de los ganadores que marcas en cada comparativa.')}
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-dim border-b border-line">
                  <th className="text-left font-medium py-1.5 pl-5 w-10">#</th>
                  <th className="text-left font-medium">{t('Contendiente')}</th>
                  <th className="text-right font-medium w-20">Elo</th>
                  <th className="text-right font-medium w-28 pr-5">{t('Ganados')}</th>
                </tr>
              </thead>
              <tbody>
                {elo.map((e, i) => (
                  <tr key={e.key} className="border-b border-line-soft last:border-0">
                    <td className="py-1.5 pl-5 num text-dim">{i + 1}</td>
                    <td className="truncate">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorFor(e.model) }} />
                        <span className="truncate">{e.providerId.startsWith('cli:') ? e.label : shortModel(e.model)}</span>
                        <span className="text-[11px] text-dim truncate">{e.providerId}</span>
                      </span>
                    </td>
                    <td className={cx('num text-right', i === 0 ? 'text-warn' : 'text-muted')}>{e.elo}</td>
                    <td className="num text-right text-muted pr-5">
                      {e.wins} / {e.games}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="px-5 py-2 text-[11px] text-dim border-t border-line-soft">
            {t('Elo por parejas: en cada comparativa con ganador, el ganador le gana a cada uno de los demás. Se empieza en 1500.')}
          </div>
        </div>
      ) : null}

      {showHistory ? (
        <div className="border-b border-line bg-panel max-h-[220px] overflow-y-auto shrink-0">
          {sessions.length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-dim">{t('Todavía no has guardado ninguna comparativa.')}</div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.arenaId}
                onClick={() => loadSession(s)}
                className="w-full px-5 py-2.5 flex items-center gap-3 hover:bg-hover text-left border-b border-line-soft last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[12.5px]">{s.prompt.slice(0, 110)}</div>
                  <div className="text-[11px] text-dim">
                    {relTime(s.createdAt)} · {t('{n} contendientes', { n: s.runs.length })} ·{' '}
                    {s.runs.map((r: RunRecord) => shortModel(r.model)).join(' vs ')}
                  </div>
                </div>
                {s.runs.some((r: RunRecord) => r.winner) ? (
                  <Badge tone="warn">
                    <Crown size={10} /> {shortModel(s.runs.find((r: RunRecord) => r.winner)!.model)}
                  </Badge>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------ Prompt */}
      <div className="px-5 py-3.5 border-b border-line shrink-0 bg-void">
        <PromptTextarea
          value={state.prompt}
          onValue={(v) => setArena({ prompt: v })}
          placement="below"
          context={{ project: state.project?.name }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void launch()
            }
          }}
          rows={3}
          placeholder={withMod(
            codeMode
              ? t('La tarea que harán todos en el proyecto. Ctrl+Enter para lanzar…')
              : t('El prompt que recibirán todos. Ctrl+Enter para lanzar…')
          )}
          className="text-[13px] leading-relaxed"
        />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[11px] mr-1">
            <SavePromptButton text={state.prompt} />
          </span>
          <FolderGit2 size={13} className={codeMode ? 'text-accent' : 'text-dim'} />
          <div className="w-[230px] shrink-0">
            <Select
              value={state.project?.id ?? ''}
              onChange={(e) => pickProject(e.target.value)}
              className="h-8 text-[12px]"
              disabled={state.running}
              title={t('Con proyecto, cada contendiente trabaja en su propio worktree')}
            >
              <option value="">{t('Sin proyecto: sólo respuestas')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          {codeMode ? (
            <>
              <div className="w-[260px] shrink-0">
                <Input
                  value={state.testCommand ?? ''}
                  onChange={(e) => setArena({ testCommand: e.target.value })}
                  onBlur={(e) => void saveTestCommand(e.target.value)}
                  placeholder={t('Orden de pruebas (opcional): pnpm test')}
                  className="h-8 text-[12px] font-mono"
                  disabled={state.running}
                  title={t('Se ejecuta en el worktree de cada uno al acabar. Se recuerda en el proyecto.')}
                />
              </div>
              <div className="w-[150px] shrink-0">
                <Select
                  value={state.permissionMode ?? 'acceptEdits'}
                  onChange={(e) => setArena({ permissionMode: e.target.value })}
                  className="h-8 text-[12px]"
                  disabled={state.running}
                  title={t('Hasta dónde llegan sin preguntar. Los de API piden aquí permiso para los comandos.')}
                >
                  {ARENA_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {t(m.label)}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : null}
          <button
            onClick={() => setShowSystem((s) => !s)}
            className="flex items-center gap-1.5 text-[11.5px] text-dim hover:text-muted ml-1"
          >
            <ChevronDown size={12} className={cx('transition-transform', !showSystem && '-rotate-90')} />
            {t('Prompt de sistema común')}
          </button>
          <span className="num text-[11px] text-dim ml-auto">{t('common.chars', { n: state.prompt.length })}</span>
        </div>
        {codeMode ? (
          <p className="text-[11px] text-dim mt-1.5 leading-relaxed">
            {t('Arena de código: cada contendiente trabaja en su propio worktree de {name} (rama acc/arena-…) y los de API lo hacen como agentes. Tu carpeta no se toca. Al acabar se comparan cambios y pruebas, y fusionas el que quieras.', {
              name: state.project?.name ?? ''
            })}
          </p>
        ) : null}
        {showSystem ? (
          <>
            <Textarea
              value={state.system}
              onChange={(e) => setArena({ system: e.target.value })}
              rows={2}
              placeholder={t('Instrucciones idénticas para todos los contendientes…')}
              className="mt-2 text-[12px]"
            />
            <p className="text-[11px] text-dim mt-1.5">
              {t('A los agentes de línea de comandos se les pone por delante del prompt: no tienen un canal aparte para instrucciones permanentes.')}
            </p>
          </>
        ) : null}
      </div>

      {/* ------------------------------------------------ Columnas */}
      <div className="flex-1 min-h-0 flex overflow-x-auto">
        {state.contenders.map((c, i) => {
          const r = c.run
          const cliAgent = cliAgents.find((a) => a.id === c.cliAgentId)
          const patch = (p: Partial<Contender>): void =>
            setContenders((cs) => cs.map((x, j) => (j === i ? { ...x, ...p } : x)))
          const ch = changes(r)

          return (
            <div
              key={c.key}
              className="flex-1 border-r border-line flex flex-col last:border-r-0 relative"
              style={{ minWidth: columnWidth }}
            >
              {/* El tirador mueve el ancho mínimo de *todas* las columnas: es
                  lo que decide cuántas caben antes de que la fila empiece a
                  desplazarse. En la última no pinta nada, que no tiene vecina. */}
              {i < state.contenders.length - 1 ? <SharedWidthHandle paneKey="arena.column" /> : null}
              <div className="p-2.5 border-b border-line shrink-0 space-y-2 bg-void">
                {/* Modo: API o línea de comandos */}
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-6 rounded-full shrink-0"
                    style={{
                      background: c.mode === 'cli'
                        ? (cliAgent?.color ?? '#f59e0b')
                        : c.model ? colorFor(c.model) : '#2a3145'
                    }}
                  />
                  <div className="flex rounded-md border border-line overflow-hidden shrink-0">
                    <button
                      onClick={() => patch({ mode: 'api', cliAgentId: undefined })}
                      className={cx(
                        'px-2 h-7 text-[11px] flex items-center gap-1',
                        c.mode === 'api' ? 'bg-raised text-ink' : 'text-dim hover:text-ink'
                      )}
                      title={t('Modelo por API')}
                    >
                      <Bot size={11} /> API
                    </button>
                    <button
                      onClick={() => patch({ mode: 'cli', providerId: undefined, model: undefined })}
                      className={cx(
                        'px-2 h-7 text-[11px] flex items-center gap-1 border-l border-line',
                        c.mode === 'cli' ? 'bg-raised text-ink' : 'text-dim hover:text-ink'
                      )}
                      title={t('Agente de línea de comandos')}
                    >
                      <Cpu size={11} /> CLI
                    </button>
                  </div>
                  {codeMode && c.mode === 'api' ? (
                    <Badge tone="violet" title={t('En la Arena de código los modelos por API trabajan como agentes, con herramientas')}>
                      {t('agente')}
                    </Badge>
                  ) : null}
                  {state.contenders.length > 1 ? (
                    <button
                      onClick={() => setContenders((cs) => cs.filter((_, j) => j !== i))}
                      className="text-dim hover:text-bad transition-colors shrink-0 p-1 ml-auto"
                      title={t('Quitar')}
                      disabled={state.running}
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </div>

                {c.mode === 'api' ? (
                  <ModelPicker
                    value={c.providerId && c.model ? { providerId: c.providerId, model: c.model } : null}
                    onChange={(p) => patch({ providerId: p?.providerId, model: p?.model })}
                    compact
                  />
                ) : (
                  <Select
                    value={c.cliAgentId ?? ''}
                    onChange={(e) => patch({ cliAgentId: e.target.value || undefined })}
                    className="h-8 text-[12px]"
                  >
                    <option value="">{t('Elige un agente…')}</option>
                    {cliAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                )}

                {c.worktreeBranch ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-dim min-w-0" title={c.worktreePath}>
                    <GitBranch size={10} className="shrink-0" />
                    <span className="font-mono truncate">{c.worktreeBranch}</span>
                    {c.outcome === 'merged' ? (
                      <Badge tone="ok">{t('fusionado')}</Badge>
                    ) : c.outcome === 'removed' ? (
                      <Badge>{t('quitado')}</Badge>
                    ) : null}
                  </div>
                ) : null}

                {/* Métricas: en vivo mientras corre, definitivas al acabar */}
                <div className="min-h-[18px] text-[11px]">
                  {c.phase === 'worktree' ? (
                    <span className="flex items-center gap-1.5 text-accent">
                      <Dot tone="ok" pulse /> {t('preparando su worktree…')}
                    </span>
                  ) : c.streaming && c.live ? (
                    <LiveMetrics live={c.live} compact />
                  ) : r ? (
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cx('num flex items-center gap-1', r.ttftMs === bestTtft ? 'text-ok' : 'text-dim')}
                        title={t('tiempo hasta el primer token')}
                      >
                        <Timer size={10} /> {ms(r.ttftMs)}
                      </span>
                      <span
                        className={cx('num flex items-center gap-1', r.tokensPerSec === bestTps ? 'text-ok' : 'text-dim')}
                        title={t('velocidad')}
                      >
                        <Zap size={10} /> {tps(r.tokensPerSec)}
                      </span>
                      <span
                        className={cx('num flex items-center gap-1', r.costTotal === bestCost ? 'text-ok' : 'text-dim')}
                        title={t('coste')}
                      >
                        <DollarSign size={10} /> {cost(r.costTotal)}
                      </span>
                      {r.winner ? (
                        <Badge tone="warn" className="ml-auto">
                          <Crown size={10} /> {t('ganador')}
                        </Badge>
                      ) : null}
                    </div>
                  ) : c.streaming ? (
                    <span className="flex items-center gap-1.5 text-ok">
                      <Dot tone="ok" pulse /> {t('arrancando…')}
                    </span>
                  ) : (
                    <span className="text-dim">{t('en espera')}</span>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
                {c.setup && !c.setup.ok ? (
                  <div className="text-[11.5px] text-warn flex items-start gap-1.5" title={c.setup.output}>
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    {t('La preparación de su worktree falló ({cmd}): puede trabajar a medias.', { cmd: c.setup.command })}
                  </div>
                ) : null}
                <AgentActivity
                  steps={c.steps}
                  running={c.streaming}
                  onApprove={c.runId && c.mode === 'api' ? (stepId, allow) => approveStep(c.runId!, stepId, allow) : undefined}
                />
                {c.error ? (
                  <div className="bg-bad/10 border border-bad/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-bad shrink-0 mt-0.5" />
                    <span className="text-[12px] text-muted break-words whitespace-pre-wrap">{c.error}</span>
                  </div>
                ) : c.content ? (
                  c.mode === 'cli' && !c.steps?.length ? (
                    <pre className="font-mono text-[11.5px] whitespace-pre-wrap break-words leading-[1.55] text-muted m-0">
                      {c.content}
                    </pre>
                  ) : (
                    <Markdown>{c.content}</Markdown>
                  )
                ) : c.streaming ? (
                  <span className="caret text-dim text-[12.5px]">{t('esperando')}</span>
                ) : c.phase ? null : (
                  <div className="text-dim text-[12.5px] text-center pt-8">
                    {c.mode === 'cli'
                      ? c.cliAgentId ? t('Sin resultado todavía') : t('Elige un agente')
                      : c.model ? t('Sin resultado todavía') : t('Elige un modelo')}
                  </div>
                )}
              </div>

              {/* Lo que dejó en su worktree: cambios, pruebas y qué hacer con ello. */}
              {c.worktreePath && (r || c.phase === 'tests') && !c.streaming ? (
                <div className="px-2.5 pt-2.5 border-t border-line shrink-0 space-y-2">
                  <div className="flex items-center gap-2 text-[11.5px] flex-wrap">
                    {ch ? (
                      <span className="text-muted">
                        {t('{n} ficheros', { n: ch.files })} <span className="text-ok num">+{ch.added}</span>{' '}
                        <span className="text-bad num">−{ch.removed}</span>
                      </span>
                    ) : (
                      <span className="text-dim">{t('sin cambios')}</span>
                    )}
                    {c.phase === 'tests' ? (
                      <span className="flex items-center gap-1 text-accent">
                        <FlaskConical size={11} /> {t('pasando las pruebas…')}
                      </span>
                    ) : c.tests ? (
                      <Badge tone={c.tests.ok ? 'ok' : 'bad'} title={c.tests.output.slice(-2000)}>
                        <FlaskConical size={10} /> {c.tests.ok ? t('pruebas: pasan') : t('pruebas: fallan')} · {ms(c.tests.ms)}
                      </Badge>
                    ) : null}
                  </div>
                  {!c.outcome && c.phase !== 'tests' ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setViewDiff(c)} disabled={!c.run?.checkpoint}>
                        <FileDiff size={12} /> {t('Ver diff')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        onClick={() => openMerge(c)}
                        disabled={state.running}
                        title={t('Fusionar sus cambios en tu rama y quitar los worktrees')}
                      >
                        <GitMerge size={12} /> {t('Fusionar este')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {r && !c.streaming ? (
                <div className="p-2.5 shrink-0">
                  <Button
                    size="sm"
                    variant={r.winner ? 'primary' : 'outline'}
                    className="w-full justify-center"
                    onClick={() => void setWinner(r.id).then(() => toast('ok', t('Ganador guardado en el histórico')))}
                  >
                    <Trophy size={12} /> {r.winner ? t('Es el ganador') : t('Marcar ganador')}
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}

        {state.contenders.length < MAX_CONTENDERS && !state.running ? (
          <button
            onClick={() => setContenders((cs) => [...cs, emptyContender('api')])}
            className="w-12 shrink-0 flex items-center justify-center text-dim hover:text-accent hover:bg-hover transition-colors border-l border-line"
            title={t('Añadir contendiente')}
          >
            <Plus size={18} />
          </button>
        ) : null}
      </div>

      {/* ------------------------------------------------ Tabla comparativa */}
      {hasResults ? (
        <div className="border-t border-line shrink-0 bg-void max-h-[236px] overflow-y-auto">
          <div className="px-5 py-2.5 flex items-center justify-between gap-2">
            <span className="text-[11.5px] uppercase tracking-wider text-dim font-medium">
              {t('arena.results', { n: state.contenders.filter((c) => c.run).length })}
            </span>
            <div className="flex items-center gap-1.5">
              {pending.length ? (
                <Button size="sm" variant="ghost" onClick={() => setDiscarding(true)} disabled={state.running}>
                  <Trash2 size={12} /> {t('Quitar los worktrees ({n})', { n: pending.length })}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={state.running}
                onClick={() => {
                  setContenders((cs) =>
                    cs.map((c) => ({
                      ...c,
                      content: '',
                      run: undefined,
                      error: undefined,
                      steps: undefined,
                      tests: undefined,
                      setup: undefined,
                      worktreePath: undefined,
                      worktreeBranch: undefined,
                      outcome: undefined
                    }))
                  )
                  setArena({ arenaId: undefined })
                }}
                title={pending.length ? t('Los worktrees que queden siguen en Proyectos › Ajustes') : undefined}
              >
                <RotateCcw size={12} /> {t('Limpiar')}
              </Button>
            </div>
          </div>
          <table className="w-full px-5">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-dim">
                <th className="text-left font-medium pl-5 py-1.5">{t('Contendiente')}</th>
                {anyCode ? <th className="text-right font-medium w-[110px]">{t('Cambios')}</th> : null}
                {anyCode ? <th className="text-left font-medium w-[110px] pl-4">{t('Pruebas')}</th> : null}
                <th className="text-right font-medium w-[110px]">Tokens</th>
                <th className="text-right font-medium w-[80px]">{t('1er token')}</th>
                <th className="text-left font-medium w-[150px] pl-4">{t('Velocidad')}</th>
                <th className="text-right font-medium w-[80px]">Total</th>
                <th className="text-left font-medium w-[150px] pl-4 pr-5">{t('Coste')}</th>
              </tr>
            </thead>
            <tbody>
              {state.contenders
                .filter((c) => c.run)
                .map((c) => {
                  const r = c.run!
                  const isCli = r.providerId.startsWith('cli:')
                  const ch = changes(r)
                  return (
                    <tr key={c.key} className="border-t border-line-soft">
                      <td className="pl-5 py-2">
                        <div className="flex items-center gap-2">
                          {isCli ? (
                            <Cpu size={11} className="text-warn shrink-0" />
                          ) : (
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: colorFor(r.model) }}
                            />
                          )}
                          <span className="text-[12.5px] truncate">{shortModel(r.model)}</span>
                          {r.winner ? <Crown size={12} className="text-warn shrink-0" /> : null}
                          {r.status === 'error' ? <Badge tone="bad">error</Badge> : null}
                          {r.projectName ? (
                            <span className="text-[10.5px] text-dim flex items-center gap-1">
                              <FolderGit2 size={9} /> {r.projectName}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      {anyCode ? (
                        <td className="num text-right text-[12px]">
                          {ch ? (
                            <>
                              <span className="text-ok">+{ch.added}</span> <span className="text-bad">−{ch.removed}</span>
                            </>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>
                      ) : null}
                      {anyCode ? (
                        <td className="pl-4 text-[12px]">
                          {c.tests ? (
                            <span className={c.tests.ok ? 'text-ok' : 'text-bad'}>{c.tests.ok ? t('pasan') : t('fallan')}</span>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>
                      ) : null}
                      <td className="num text-right text-[12px] text-muted">
                        {tokens(r.promptTokens)} → {tokens(r.completionTokens)}
                      </td>
                      <td className={cx('num text-right text-[12px]', r.ttftMs === bestTtft ? 'text-ok' : 'text-muted')}>
                        {ms(r.ttftMs)}
                      </td>
                      <td className="pl-4">
                        <div className="flex items-center gap-2">
                          <Meter value={r.tokensPerSec ?? 0} max={maxTps} color="#34d399" />
                          <span
                            className={cx(
                              'num text-[11.5px] w-16 text-right shrink-0',
                              r.tokensPerSec === bestTps ? 'text-ok' : 'text-muted'
                            )}
                          >
                            {tps(r.tokensPerSec)}
                          </span>
                        </div>
                      </td>
                      <td className={cx('num text-right text-[12px]', r.totalMs === bestTime ? 'text-ok' : 'text-muted')}>
                        {ms(r.totalMs)}
                      </td>
                      <td className="pl-4 pr-5">
                        <div className="flex items-center gap-2">
                          <Meter value={r.costTotal} max={maxCost} color="#22d3ee" />
                          <span
                            className={cx(
                              'num text-[11.5px] w-14 text-right shrink-0',
                              r.costTotal === bestCost ? 'text-ok' : 'text-muted'
                            )}
                          >
                            {cost(r.costTotal)}
                            {r.costEstimated ? '*' : ''}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          <p className="px-5 pb-2.5 pt-1 text-[10.5px] text-dim">
            *{' '}
            {t(
              'coste estimado con los precios del catálogo. Los agentes de línea de comandos sólo informan del coste real cuando su herramienta lo publica (Claude Code sí).'
            )}
          </p>
        </div>
      ) : null}

      {viewDiff?.runId && viewDiff.run?.checkpoint ? (
        <DiffReview
          open
          readOnly
          title={t('Lo que hizo {name}', { name: nameOf(viewDiff) })}
          onClose={() => setViewDiff(null)}
          runId={viewDiff.runId}
          checkpoint={viewDiff.run.checkpoint}
        />
      ) : null}

      <Modal
        open={Boolean(merging)}
        onClose={() => setMerging(null)}
        title={t('Fusionar {name}', { name: merging ? nameOf(merging) : '' })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMerging(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void merge()}>
              <GitMerge size={13} /> {t('Fusionar')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12.5px]">
          <p className="text-muted leading-relaxed">
            {t('Lo pendiente de su worktree se confirma con este mensaje y la rama {branch} se fusiona (merge --no-ff) en la rama en la que estás en {project}. Queda marcado como ganador.', {
              branch: merging?.worktreeBranch ?? '',
              project: state.project?.name ?? ''
            })}
          </p>
          <Input value={mergeMsg} onChange={(e) => setMergeMsg(e.target.value)} placeholder={t('Mensaje del commit')} />
          <Toggle
            checked={cleanup}
            onChange={setCleanup}
            label={t('Después, quitar los worktrees y las ramas de todos los contendientes')}
          />
          <p className="text-[11px] text-dim">
            {t('Si hay conflictos, la fusión se para, no se quita nada y se resuelven en la pestaña Git del proyecto.')}
          </p>
        </div>
      </Modal>

      <Modal
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={t('Quitar los worktrees de la Arena')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiscarding(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void discard()}>
              <Trash2 size={13} /> {t('Quitar y perder sus cambios')}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted leading-relaxed">
          {t('Se borran las carpetas y las ramas de {n} contendientes, con lo que hicieron. Tu carpeta no se toca. Los resultados y las métricas se quedan en el histórico.', {
            n: pending.length
          })}
        </p>
      </Modal>
    </div>
  )
}
