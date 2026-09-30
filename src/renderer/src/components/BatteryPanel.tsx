/**
 * Baterías de prompts en la Arena: casos con sus comprobaciones que se pasan
 * a todos los contendientes y dan una matriz de aprobados, al estilo de
 * promptfoo. Aquí se crean y se editan, se lanzan y se ven sus resultados.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListChecks, Play, Square, Plus, Pencil, Trash2, Check, X, Gavel } from 'lucide-react'
import { Button, Badge, Select, Input, Textarea, Modal, Field, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { cost, ms, relTime } from '../lib/format'
import { uid, useArena, stopArena, type Contender } from '../lib/engine'
import { runBattery, type BatteryProgress } from '../lib/battery'
import type { Battery, BatteryCheck, BatteryCheckKind, BatteryRun } from '@shared/types'

const KINDS: { id: BatteryCheckKind; label: string; placeholder?: string }[] = [
  { id: 'contains', label: 'Contiene', placeholder: 'texto' },
  { id: 'not_contains', label: 'No contiene', placeholder: 'texto' },
  { id: 'regex', label: 'Expresión regular', placeholder: '\\b4\\b o /hola/i' },
  { id: 'json', label: 'Es JSON válido' },
  { id: 'tests', label: 'Pasan las pruebas del repo' },
  { id: 'judge', label: 'Juez local', placeholder: 'rúbrica: qué tiene que cumplir' }
]

const emptyBattery = (): Battery => ({
  id: uid(),
  name: '',
  createdAt: Date.now(),
  cases: [{ id: uid(), prompt: '', checks: [{ id: uid(), kind: 'contains', value: '' }] }]
})

export function BatteryPanel({ names }: { names: (c: Contender) => string }): React.JSX.Element {
  const t = useT()
  const { config, models, reload, toast } = useStore()
  const arena = useArena()
  const batteries = useMemo(() => config?.batteries ?? [], [config?.batteries])
  const [selected, setSelected] = useState('')
  const [runs, setRuns] = useState<BatteryRun[]>([])
  const [runId, setRunId] = useState('')
  const [editing, setEditing] = useState<Battery | null>(null)
  const [progress, setProgress] = useState<BatteryProgress | null>(null)
  const stop = useRef(false)

  const battery = batteries.find((b) => b.id === selected)
  const judges = useMemo(() => models.filter((m) => m.providerId === 'ollama' && !/(embed|rerank)/i.test(m.id)), [models])

  useEffect(() => {
    if (!selected && batteries[0]) setSelected(batteries[0].id)
  }, [batteries, selected])

  const loadRuns = useCallback(async () => {
    if (!selected) return setRuns([])
    const r = await window.api.batteries.runs(selected)
    const list = r.ok && r.data ? r.data : []
    setRuns(list)
    setRunId((cur) => (list.some((x) => x.id === cur) ? cur : list[0]?.id ?? ''))
  }, [selected])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const run = runs.find((r) => r.id === runId)
  const needsJudge = battery?.cases.some((c) => c.checks.some((k) => k.kind === 'judge'))
  const usable = arena.contenders.filter((c) => (c.mode === 'api' ? c.providerId && c.model : c.cliAgentId))

  const launch = async (): Promise<void> => {
    if (!battery) return
    stop.current = false
    setProgress({ caseIndex: 0, total: battery.cases.length })
    try {
      const r = await runBattery(battery, { names, onProgress: setProgress, shouldStop: () => stop.current })
      await loadRuns()
      setRunId(r.id)
      toast('ok', t('Batería terminada: {ok} de {n} casillas aprobadas', { ok: r.cells.filter((c) => c.ok).length, n: r.cells.length }))
    } finally {
      setProgress(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    const r = await window.api.batteries.save({ ...editing, name: editing.name.trim() || t('Batería') })
    if (!r.ok) {
      toast('error', r.error ?? t('No se pudo guardar'))
      return
    }
    await reload()
    setSelected(editing.id)
    setEditing(null)
  }

  const remove = async (): Promise<void> => {
    if (!battery) return
    await window.api.batteries.remove(battery.id)
    await reload()
    setSelected('')
  }

  const patchCase = (i: number, patch: Partial<Battery['cases'][number]>): void =>
    setEditing((b) => (b ? { ...b, cases: b.cases.map((c, j) => (j === i ? { ...c, ...patch } : c)) } : b))
  const patchCheck = (i: number, k: number, patch: Partial<BatteryCheck>): void =>
    patchCase(i, { checks: editing!.cases[i].checks.map((c, j) => (j === k ? { ...c, ...patch } : c)) })

  const caseLabel = (caseId: string): string => {
    const i = battery?.cases.findIndex((c) => c.id === caseId) ?? -1
    const c = i >= 0 ? battery!.cases[i] : undefined
    return c ? `${i + 1}. ${c.prompt.replace(/\s+/g, ' ').slice(0, 70)}` : t('(caso borrado)')
  }
  const caseIds = run ? [...new Set(run.cells.map((c) => c.caseId))] : []

  return (
    <div className="border-b border-line bg-panel shrink-0 max-h-[60vh] overflow-y-auto" data-batteries>
      <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
        <ListChecks size={14} className="text-accent" />
        <span className="text-[12.5px] font-medium">{t('Baterías de prompts')}</span>
        <div className="w-60">
          <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="h-8 text-[12px]" aria-label={t('Batería')}>
            {!batteries.length ? <option value="">{t('Ninguna todavía')}</option> : null}
            {batteries.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {t('{n} casos', { n: b.cases.length })}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditing(emptyBattery())}>
          <Plus size={12} /> {t('Nueva')}
        </Button>
        {battery ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(structuredClone(battery))}>
              <Pencil size={12} /> {t('Editar')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove()} title={t('Borrar la batería (sus resultados se quedan)')}>
              <Trash2 size={12} />
            </Button>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {progress ? (
            <>
              <span className="text-[12px] text-muted num">{t('Caso {i} de {n}', { i: progress.caseIndex + 1, n: progress.total })}</span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  stop.current = true
                  stopArena()
                }}
              >
                <Square size={11} /> {t('Parar')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!battery || !usable.length || arena.running || (needsJudge && !battery?.judgeModel)}
              onClick={() => void launch()}
              title={needsJudge && !battery?.judgeModel ? t('Elige un juez en la batería') : t('Pasa cada caso a los contendientes de la Arena')}
            >
              <Play size={12} /> {t('Pasar la batería')}
            </Button>
          )}
        </div>
      </div>

      {battery ? (
        <div className="px-5 pb-4 space-y-2">
          {runs.length ? (
            <div className="flex items-center gap-2 text-[11.5px] text-dim">
              <span>{t('Resultado')}</span>
              <div className="w-72">
                <Select value={runId} onChange={(e) => setRunId(e.target.value)} className="h-7 text-[11.5px] py-0">
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {relTime(r.at)} · {r.contenders.map((c) => c.label).join(', ')}
                      {r.stopped ? ` · ${t('parada')}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              {run?.judgeModel ? (
                <span className="inline-flex items-center gap-1" title={t('Las notas del juez son su opinión, no una medida')}>
                  <Gavel size={11} /> {t('juez: {model}', { model: run.judgeModel })}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-dim">{t('Todavía no la has pasado. Pon los contendientes en la Arena y pulsa «Pasar la batería».')}</p>
          )}

          {run ? (
            <div className="border border-line rounded-lg overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[11px] text-dim text-left">
                    <th className="px-3 py-2 font-medium">{t('Caso')}</th>
                    {run.contenders.map((c) => (
                      <th key={c.key} className="px-2 py-2 font-medium text-center whitespace-nowrap">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {caseIds.map((caseId) => (
                    <tr key={caseId} className="border-t border-line-soft">
                      <td className="px-3 py-1.5 text-muted max-w-[360px] truncate" title={caseLabel(caseId)}>
                        {caseLabel(caseId)}
                      </td>
                      {run.contenders.map((c) => {
                        const cell = run.cells.find((x) => x.caseId === caseId && x.contender === c.key)
                        if (!cell) return <td key={c.key} className="px-2 py-1.5 text-center text-dim">—</td>
                        const passed = cell.checks.filter((x) => x.pass).length
                        const judge = cell.checks.find((x) => x.kind === 'judge' && x.score != null)
                        const why = [
                          cell.error ? `${t('Error')}: ${cell.error}` : '',
                          ...cell.checks.map((x) => `${x.pass ? '✓' : '✗'} ${t(KINDS.find((k) => k.id === x.kind)?.label ?? x.kind)}${x.score != null ? ` ${x.score}/10` : ''}${x.detail ? `: ${x.detail}` : ''}`)
                        ]
                          .filter(Boolean)
                          .join('\n')
                        return (
                          <td key={c.key} className="px-2 py-1.5 text-center" title={why} data-cell={`${caseId}:${c.key}`} data-ok={cell.ok ? '1' : '0'}>
                            <div className={cx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded num', cell.ok ? 'text-ok bg-[#0d2019]' : 'text-bad bg-[#241016]')}>
                              {cell.ok ? <Check size={11} /> : <X size={11} />} {passed}/{cell.checks.length}
                            </div>
                            <div className="text-[10px] text-dim num mt-0.5">
                              {judge ? `${t('juez')} ${judge.score} · ` : ''}
                              {cost(cell.cost)} · {ms(cell.ms)}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="border-t border-line text-[11.5px]">
                    <td className="px-3 py-2 text-dim">{t('Total')}</td>
                    {run.contenders.map((c) => {
                      const cells = run.cells.filter((x) => x.contender === c.key)
                      const ok = cells.filter((x) => x.ok).length
                      const pct = cells.length ? Math.round((ok / cells.length) * 100) : 0
                      return (
                        <td key={c.key} className="px-2 py-2 text-center num" data-total={c.key}>
                          <span className={pct === 100 ? 'text-ok' : pct >= 50 ? 'text-warn' : 'text-bad'}>
                            {ok}/{cells.length} · {pct} %
                          </span>
                          <div className="text-[10px] text-dim">
                            {cost(cells.reduce((s, x) => s + x.cost, 0))} · {ms(cells.length ? cells.reduce((s, x) => s + x.ms, 0) / cells.length : 0)}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing && batteries.some((b) => b.id === editing.id) ? t('Editar la batería') : t('Nueva batería')}
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" disabled={!editing?.cases.some((c) => c.prompt.trim())} onClick={() => void save()}>
              {t('Guardar')}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Nombre')}>
                <Input value={editing.name} placeholder={t('Por ejemplo: formato de respuestas')} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label={t('Juez local')} hint={t('Sólo para las comprobaciones de «Juez local». Su nota es su opinión.')}>
                <Select value={editing.judgeModel ?? ''} onChange={(e) => setEditing({ ...editing, judgeModel: e.target.value || undefined })}>
                  <option value="">{t('Sin juez')}</option>
                  {judges.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {editing.cases.map((c, i) => (
              <div key={c.id} className="border border-line rounded-lg p-3 space-y-2" data-case={i}>
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] uppercase tracking-wider text-dim">{t('Caso {n}', { n: i + 1 })}</span>
                  {editing.cases.length > 1 ? (
                    <button className="text-dim hover:text-bad" onClick={() => setEditing({ ...editing, cases: editing.cases.filter((_, j) => j !== i) })} title={t('Quitar el caso')}>
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>
                <Textarea rows={2} value={c.prompt} placeholder={t('El prompt')} onChange={(e) => patchCase(i, { prompt: e.target.value })} />
                {c.checks.map((k, j) => {
                  const kind = KINDS.find((x) => x.id === k.kind)!
                  return (
                    <div key={k.id} className="flex items-center gap-2" data-check={j}>
                      <div className="w-52 shrink-0">
                        <Select value={k.kind} className="h-8 text-[12px]" onChange={(e) => patchCheck(i, j, { kind: e.target.value as BatteryCheckKind })}>
                          {KINDS.map((x) => (
                            <option key={x.id} value={x.id}>
                              {t(x.label)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {kind.placeholder ? (
                        <Input value={k.value ?? ''} placeholder={t(kind.placeholder)} className="h-8 text-[12px] font-mono" onChange={(e) => patchCheck(i, j, { value: e.target.value })} />
                      ) : (
                        <span className="flex-1 text-[11.5px] text-dim">{k.kind === 'tests' ? t('Hace falta la Arena de código con su orden de pruebas') : ''}</span>
                      )}
                      {k.kind === 'judge' ? (
                        <div className="w-24 shrink-0" title={t('Nota mínima para aprobar')}>
                          <Input type="number" min={1} max={10} value={k.min ?? 6} className="h-8 text-[12px]" onChange={(e) => patchCheck(i, j, { min: Number(e.target.value) })} />
                        </div>
                      ) : null}
                      <button className="text-dim hover:text-bad shrink-0" onClick={() => patchCase(i, { checks: c.checks.filter((_, x) => x !== j) })} title={t('Quitar')}>
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
                <Button size="sm" variant="ghost" onClick={() => patchCase(i, { checks: [...c.checks, { id: uid(), kind: 'contains', value: '' }] })}>
                  <Plus size={11} /> {t('Comprobación')}
                </Button>
              </div>
            ))}
            <Button size="sm" onClick={() => setEditing({ ...editing, cases: [...editing.cases, { id: uid(), prompt: '', checks: [] }] })}>
              <Plus size={12} /> {t('Añadir caso')}
            </Button>
            {editing.cases.some((c) => c.checks.some((k) => k.kind === 'judge')) && !editing.judgeModel ? (
              <Badge tone="warn">{t('Hay comprobaciones de juez: elige un juez local')}</Badge>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
