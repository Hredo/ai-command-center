/**
 * Arena: el mismo prompt contra varios contendientes a la vez.
 *
 * Un contendiente puede ser un modelo por API o un agente de línea de
 * comandos. Los dos acaban en el mismo histórico con el mismo arenaId, así que
 * se comparan en la misma tabla: tokens, primer token, velocidad y coste.
 * El estado vive en el motor, así que la comparativa sigue aunque cambies de
 * pantalla.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  Swords, Play, Square, Plus, X, Trophy, Timer, Zap, DollarSign, Crown,
  AlertTriangle, RotateCcw, ChevronDown, History as HistoryIcon, Cpu, Bot, FolderGit2
} from 'lucide-react'
import { Button, Textarea, Badge, cx, Dot, Meter, Select } from '../components/ui'
import { ModelPicker } from '../components/ModelPicker'
import { Markdown } from '../components/Markdown'
import { LiveMetrics } from '../components/Stats'
import { useStore } from '../lib/store'
import { cost, tokens, ms, tps, shortModel, colorFor, relTime } from '../lib/format'
import {
  useArena, setArena, setContenders, emptyContender, launchArena, stopArena, useRunsVersion,
  type Contender
} from '../lib/engine'
import type { RunRecord } from '@shared/types'
import { SharedWidthHandle } from '../components/Resizable'
import { usePaneSize } from '../lib/prefs'

import { useT } from '../lib/i18n'
/** Marca el mejor valor de cada métrica entre los contendientes. */
function best(runs: (RunRecord | undefined)[], field: keyof RunRecord, dir: 'min' | 'max'): number | null {
  const vals = runs.map((r) => (r ? Number(r[field] ?? NaN) : NaN)).filter((v) => !Number.isNaN(v) && v > 0)
  if (!vals.length) return null
  return dir === 'min' ? Math.min(...vals) : Math.max(...vals)
}


export default function Arena(): React.JSX.Element {
  const t = useT()
  const { models, config, toast } = useStore()
  const { size: columnWidth } = usePaneSize('arena.column')
  const state = useArena()
  const [sessions, setSessions] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [showSystem, setShowSystem] = useState(false)

  const cliAgents = config?.cliAgents ?? []
  const projects = config?.projects ?? []

  // Dos contendientes por defecto, con modelos distintos.
  useEffect(() => {
    if (state.contenders.length > 0) return
    const picks = models.slice(0, 2)
    setContenders(() => [0, 1].map((i) => ({
      ...emptyContender('api'),
      providerId: picks[i]?.providerId,
      model: picks[i]?.id
    })))
  }, [models, state.contenders.length])

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

  // Al acabar una comparativa se refresca el listado de guardadas.
  useEffect(() => {
    if (!state.running) void loadSessions()
  }, [state.running, loadSessions])

  const launch = async (): Promise<void> => {
    if (!state.prompt.trim()) return
    const usable = state.contenders.some((c) => (c.mode === 'api' ? c.providerId && c.model : c.cliAgentId))
    if (!usable) {
      toast('error', t('Elige al menos un modelo o un agente'))
      return
    }
    // Un agente de línea de comandos sin proyecto trabaja en tu carpeta de
    // usuario; conviene avisarlo antes de que escriba ficheros donde no toca.
    const looseCli = state.contenders.find((c) => c.mode === 'cli' && c.cliAgentId && !c.projectPath)
    if (looseCli) toast('info', t('Algún agente va sin proyecto: se ejecutará en tu carpeta de usuario'))

    await launchArena()
    toast('ok', t('Comparativa terminada'))
  }

  const setWinner = async (runId: string): Promise<void> => {
    for (const c of state.contenders) {
      if (!c.run) continue
      await window.api.runs.update(c.run.id, { winner: c.run.id === runId })
    }
    setContenders((cs) => cs.map((c) => (c.run ? { ...c, run: { ...c.run, winner: c.run.id === runId } } : c)))
    toast('ok', t('Ganador guardado en el histórico'))
  }

  const loadSession = (s: any): void => {
    setArena({
      prompt: s.prompt,
      arenaId: s.arenaId,
      contenders: s.runs.map((r: RunRecord) => ({
        ...emptyContender(r.providerId.startsWith('cli:') ? 'cli' : 'api'),
        providerId: r.providerId.startsWith('cli:') ? undefined : r.providerId,
        model: r.providerId.startsWith('cli:') ? undefined : r.model,
        cliAgentId: r.agentId,
        runId: r.id,
        content: r.response,
        run: r,
        streaming: false,
        error: r.status === 'error' ? r.error : undefined
      }))
    })
    setShowHistory(false)
  }

  const runs = state.contenders.map((c) => c.run)
  const bestTtft = best(runs, 'ttftMs', 'min')
  const bestTps = best(runs, 'tokensPerSec', 'max')
  const bestCost = best(runs, 'costTotal', 'min')
  const bestTime = best(runs, 'totalMs', 'min')
  const maxCost = Math.max(...runs.map((r) => r?.costTotal ?? 0), 0.000001)
  const maxTps = Math.max(...runs.map((r) => r?.tokensPerSec ?? 0), 1)
  const hasResults = runs.some(Boolean)

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 px-5 border-b border-line flex items-center justify-between gap-3 shrink-0 bg-void">
        <div className="flex items-center gap-2.5">
          <Swords size={15} className="text-violet" />
          <span className="font-medium">Arena</span>
          <span className="text-[12px] text-dim">{t('mismo prompt, modelos y agentes, decisiones con datos')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowHistory((s) => !s)}>
            <HistoryIcon size={13} /> Comparativas ({sessions.length})
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
                    {relTime(s.createdAt)} · {s.runs.length} contendientes ·{' '}
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
        <Textarea
          value={state.prompt}
          onChange={(e) => setArena({ prompt: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void launch()
            }
          }}
          rows={3}
          placeholder={t('El prompt que recibirán todos. Ctrl+Enter para lanzar…')}
          className="text-[13px] leading-relaxed"
        />
        <div className="flex items-center justify-between mt-2">
          <button
            onClick={() => setShowSystem((s) => !s)}
            className="flex items-center gap-1.5 text-[11.5px] text-dim hover:text-muted"
          >
            <ChevronDown size={12} className={cx('transition-transform', !showSystem && '-rotate-90')} />
            {t('Prompt de sistema común')}
          </button>
          <span className="num text-[11px] text-dim">{state.prompt.length} caracteres</span>
        </div>
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
                  {state.contenders.length > 1 ? (
                    <button
                      onClick={() => setContenders((cs) => cs.filter((_, j) => j !== i))}
                      className="text-dim hover:text-bad transition-colors shrink-0 p-1 ml-auto"
                      title={t('Quitar')}
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
                  <div className="space-y-1.5">
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
                    <Select
                      value={c.projectPath ?? ''}
                      onChange={(e) => patch({ projectPath: e.target.value || undefined })}
                      className="h-8 text-[12px]"
                    >
                      <option value="">Sin proyecto (tu carpeta de usuario)</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.path}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                {/* Métricas: en vivo mientras corre, definitivas al acabar */}
                <div className="min-h-[18px] text-[11px]">
                  {c.streaming && c.live ? (
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

              <div className="flex-1 overflow-y-auto p-3.5">
                {c.error ? (
                  <div className="bg-[#1a1015] border border-[#4a2029] rounded-lg px-3 py-2.5 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-bad shrink-0 mt-0.5" />
                    <span className="text-[12px] text-muted break-words whitespace-pre-wrap">{c.error}</span>
                  </div>
                ) : c.content ? (
                  c.mode === 'cli' ? (
                    <pre className="font-mono text-[11.5px] whitespace-pre-wrap break-words leading-[1.55] text-muted m-0">
                      {c.content}
                    </pre>
                  ) : (
                    <Markdown>{c.content}</Markdown>
                  )
                ) : c.streaming ? (
                  <span className="caret text-dim text-[12.5px]">{t('esperando')}</span>
                ) : (
                  <div className="text-dim text-[12.5px] text-center pt-8">
                    {c.mode === 'cli'
                      ? c.cliAgentId ? t('Sin resultado todavía') : t('Elige un agente')
                      : c.model ? t('Sin resultado todavía') : t('Elige un modelo')}
                  </div>
                )}
              </div>

              {r && !c.streaming ? (
                <div className="p-2.5 border-t border-line shrink-0">
                  <Button
                    size="sm"
                    variant={r.winner ? 'primary' : 'outline'}
                    className="w-full justify-center"
                    onClick={() => void setWinner(r.id)}
                  >
                    <Trophy size={12} /> {r.winner ? t('Es el ganador') : t('Marcar ganador')}
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}

        {state.contenders.length < 4 ? (
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
          <div className="px-5 py-2.5 flex items-center justify-between">
            <span className="text-[11.5px] uppercase tracking-wider text-dim font-medium">
              Comparativa · {state.contenders.filter((c) => c.run).length} resultados
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setContenders((cs) => cs.map((c) => ({ ...c, content: '', run: undefined, error: undefined })))
                setArena({ arenaId: undefined })
              }}
            >
              <RotateCcw size={12} /> {t('Limpiar')}
            </Button>
          </div>
          <table className="w-full px-5">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-dim">
                <th className="text-left font-medium pl-5 py-1.5">{t('Contendiente')}</th>
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
            * coste estimado con los precios del catálogo. Los agentes de línea de comandos sólo
            informan del coste real cuando su herramienta lo publica (Claude Code sí).
          </p>
        </div>
      ) : null}
    </div>
  )
}
