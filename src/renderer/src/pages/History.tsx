import React, { useCallback, useEffect, useState } from 'react'
import {
  History as HistoryIcon, Search, Download, Trash2, X, Crown, Copy, Check, AlertTriangle
} from 'lucide-react'
import { Panel, Button, Badge, Empty, Input, Select, Modal, Dot } from '../components/ui'
import { Markdown } from '../components/Markdown'
import { useStore } from '../lib/store'
import { useRunsVersion } from '../lib/engine'
import { cost, tokens, ms, tps, dateTime, shortModel, colorFor } from '../lib/format'
import type { RunRecord } from '@shared/types'
import { Pane } from '../components/Resizable'

import { useT } from '../lib/i18n'
function Detail({ run, onClose, onDelete }: { run: RunRecord | null; onClose: () => void; onDelete: (id: string) => void }): React.JSX.Element | null {
  const t = useT()
  const [copied, setCopied] = useState(false)
  if (!run) return null

  const rows: [string, React.ReactNode][] = [
    ['Fecha', dateTime(run.createdAt)],
    ['Tipo', run.kind],
    ['Proveedor', run.providerId],
    ['Modelo', run.model],
    ['Agente', run.agentName ?? '—'],
    ['Proyecto', run.projectName ?? '—'],
    ['Estado', run.status],
    [t('Tokens entrada'), tokens(run.promptTokens)],
    [t('Tokens salida'), tokens(run.completionTokens)],
    [t('En caché'), run.cachedTokens ? tokens(run.cachedTokens) : '—'],
    ['Razonamiento', run.reasoningTokens ? tokens(run.reasoningTokens) : '—'],
    ['Primer token', ms(run.ttftMs)],
    ['Tiempo total', ms(run.totalMs)],
    ['Velocidad', tps(run.tokensPerSec)],
    ['Temperatura', run.temperature ?? '—'],
    ['Coste', `${cost(run.costTotal)}${run.costEstimated ? ' (estimado)' : ' (real)'}`]
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onMouseDown={onClose}>
      <Pane
        paneKey="history.detail"
        side="left"
        className="max-w-full bg-panel border-l border-line flex flex-col fade-up"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-5 border-b border-line flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorFor(run.model) }} />
            <span className="font-medium truncate">{shortModel(run.model)}</span>
            {run.winner ? (
              <Badge tone="warn">
                <Crown size={10} /> {t('ganador')}
              </Badge>
            ) : null}
            {run.status === 'error' ? <Badge tone="bad">error</Badge> : null}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(run.response)
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              }}
            >
              {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />} Copiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDelete(run.id)}>
              <Trash2 size={13} />
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X size={15} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-5 py-4 border-b border-line">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between text-[12px] gap-3">
                <span className="text-dim shrink-0">{k}</span>
                <span className="num text-muted truncate text-right">{v}</span>
              </div>
            ))}
          </div>

          {run.systemPrompt ? (
            <div className="px-5 py-4 border-b border-line">
              <div className="text-[11px] uppercase tracking-wider text-dim mb-2">{t('Prompt de sistema')}</div>
              <div className="text-[12px] text-muted whitespace-pre-wrap max-h-[180px] overflow-y-auto font-mono leading-relaxed">
                {run.systemPrompt}
              </div>
            </div>
          ) : null}

          <div className="px-5 py-4 border-b border-line">
            <div className="text-[11px] uppercase tracking-wider text-dim mb-2">Prompt</div>
            <div className="text-[12.5px] whitespace-pre-wrap leading-relaxed">{run.prompt}</div>
          </div>

          <div className="px-5 py-4">
            <div className="text-[11px] uppercase tracking-wider text-dim mb-2">{t('Respuesta')}</div>
            {run.error ? (
              <div className="bg-[#1a1015] border border-[#4a2029] rounded-lg px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle size={14} className="text-bad shrink-0 mt-0.5" />
                <span className="text-[12px] text-muted break-words">{run.error}</span>
              </div>
            ) : run.response ? (
              <Markdown>{run.response}</Markdown>
            ) : (
              <span className="text-dim text-[12.5px]">(vacía)</span>
            )}
          </div>
        </div>
      </Pane>
    </div>
  )
}

export default function History(): React.JSX.Element {
  const t = useT()
  const { toast, defs } = useStore()
  const [rows, setRows] = useState<RunRecord[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [providerId, setProviderId] = useState('')
  const [selected, setSelected] = useState<RunRecord | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const version = useRunsVersion()

  const load = useCallback(async () => {
    const r = await window.api.runs.query({
      search: search || undefined,
      kind: kind || undefined,
      status: status || undefined,
      providerId: providerId || undefined,
      limit: 400
    })
    if (r.ok && r.data) {
      setRows(r.data.rows)
      setTotal(r.data.total)
    }
  }, [search, kind, status, providerId])

  // Se recarga al escribir en el buscador y también cuando termina una
  // ejecución nueva, para no tener que volver a entrar en la pantalla.
  useEffect(() => {
    const t = setTimeout(() => void load(), 200)
    return () => clearTimeout(t)
  }, [load, version])

  const remove = async (id: string): Promise<void> => {
    await window.api.runs.remove(id)
    setSelected(null)
    await load()
    toast('info', t('Ejecución eliminada'))
  }

  const exportAs = async (format: 'json' | 'csv'): Promise<void> => {
    const r = await window.api.runs.export(format)
    if (r.ok && r.data) toast('ok', `${r.data.rows} ejecuciones exportadas`)
  }

  const providersInView = [...new Set(rows.map((r) => r.providerId))].sort()
  const sumCost = rows.reduce((s, r) => s + r.costTotal, 0)
  const sumTok = rows.reduce((s, r) => s + r.totalTokens, 0)

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 shrink-0">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight">{t('Histórico')}</h1>
            <p className="text-[12.5px] text-dim mt-0.5">
              {t('history.summary', { total, tokens: tokens(sumTok), cost: cost(sumCost) })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void exportAs('csv')}>
              <Download size={14} /> CSV
            </Button>
            <Button onClick={() => void exportAs('json')}>
              <Download size={14} /> JSON
            </Button>
            <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={total === 0}>
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-[400px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Buscar en prompts y respuestas…')}
              className="pl-8"
            />
          </div>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-[140px]">
            <option value="">{t('Todo tipo')}</option>
            <option value="chat">{t('Consola')}</option>
            <option value="arena">Arena</option>
            <option value="cli">{t('Agente CLI')}</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[130px]">
            <option value="">{t('Todo estado')}</option>
            <option value="ok">{t('Correctas')}</option>
            <option value="error">{t('Con error')}</option>
            <option value="aborted">{t('Canceladas')}</option>
          </Select>
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="w-[170px]">
            <option value="">{t('Todo proveedor')}</option>
            {providersInView.map((p) => (
              <option key={p} value={p}>
                {defs.find((d) => d.id === p)?.name ?? p}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 pb-5">
        <Panel className="h-full flex flex-col overflow-hidden">
          {rows.length === 0 ? (
            <Empty
              icon={<HistoryIcon size={30} />}
              title={total === 0 ? t('Sin ejecuciones todavía') : t('Nada coincide con el filtro')}
              hint={
                total === 0
                  ? t('Cada prompt que lances queda registrado aquí con sus métricas completas, listo para revisar o exportar.')
                  : t('Prueba a relajar la búsqueda o los filtros.')
              }
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-panel z-10">
                  <tr className="text-[10.5px] uppercase tracking-wider text-dim border-b border-line">
                    <th className="text-left font-medium py-2 pl-4 w-[120px]">{t('Fecha')}</th>
                    <th className="text-left font-medium w-[170px]">{t('Modelo')}</th>
                    <th className="text-left font-medium">Prompt</th>
                    <th className="text-left font-medium w-[90px]">{t('Origen')}</th>
                    <th className="text-right font-medium w-[100px]">Tokens</th>
                    <th className="text-right font-medium w-[70px]">TTFT</th>
                    <th className="text-right font-medium w-[78px]">Vel.</th>
                    <th className="text-right font-medium w-[70px]">{t('Tiempo')}</th>
                    <th className="text-right font-medium w-[80px] pr-4">{t('Coste')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="border-b border-line-soft hover:bg-[#12151f] cursor-pointer"
                    >
                      <td className="pl-4 py-2 num text-[11.5px] text-dim whitespace-nowrap">
                        {dateTime(r.createdAt)}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Dot tone={r.status === 'ok' ? 'ok' : r.status === 'error' ? 'bad' : 'warn'} />
                          <span className="truncate text-[12px]">{shortModel(r.model)}</span>
                          {r.winner ? <Crown size={11} className="text-warn shrink-0" /> : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="text-[12px] text-muted line-clamp-1">{r.prompt.slice(0, 120)}</span>
                      </td>
                      <td className="py-2">
                        <Badge tone={r.kind === 'arena' ? 'violet' : r.kind === 'cli' ? 'warn' : 'neutral'}>
                          {r.kind === 'chat' ? 'consola' : r.kind === 'arena' ? 'arena' : 'cli'}
                        </Badge>
                      </td>
                      <td className="num text-right text-[11.5px] text-muted whitespace-nowrap">
                        {tokens(r.promptTokens)}→{tokens(r.completionTokens)}
                      </td>
                      <td className="num text-right text-[11.5px] text-muted">{ms(r.ttftMs)}</td>
                      <td className="num text-right text-[11.5px] text-muted">
                        {r.tokensPerSec ? r.tokensPerSec.toFixed(0) : '—'}
                      </td>
                      <td className="num text-right text-[11.5px] text-muted">{ms(r.totalMs)}</td>
                      <td className="num text-right text-[11.5px] text-accent pr-4">{cost(r.costTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Detail run={selected} onClose={() => setSelected(null)} onDelete={(id) => void remove(id)} />

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('Borrar todo el histórico')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await window.api.runs.clear()
                setConfirmClear(false)
                await load()
                toast('info', t('Histórico vaciado'))
              }}
            >
              Borrar {total} ejecuciones
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed">
          {t('Se eliminarán las')} <strong>{total}</strong> {t('ejecuciones guardadas, con sus métricas y respuestas. Esto no se puede deshacer: si quieres conservarlas, expórtalas antes a CSV o JSON.')}
        </p>
      </Modal>
    </div>
  )
}
