/**
 * Lo que el agente va haciendo, paso a paso.
 *
 * Un agente puede tirarse minutos leyendo, buscando y editando sin decir una
 * palabra. Sin esto la pantalla se queda en blanco y parece que se ha colgado;
 * con esto se ve cada herramienta según la lanza, sobre qué archivo, cuánto ha
 * tardado y cuántas líneas ha tocado.
 *
 * Mientras trabaja la lista está abierta y la última fila late. Al terminar
 * se pliega en una línea de resumen, que es lo que uno quiere ver cuando
 * vuelve a leer la conversación.
 *
 * Un agente por API puede pedir permiso antes de ejecutar un comando o de
 * tocar un archivo: esa fila se queda esperando con sus dos botones, y la
 * lista no se deja plegar mientras haya algo pendiente.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  Eye, Pencil, FilePlus2, TerminalSquare, Search, Globe, Bot, ListTodo, Wrench,
  Sparkles, Info, ChevronRight, Check, X, Loader2, Ban, Hand
} from 'lucide-react'
import { Button, cx } from './ui'
import { ms as fmtMs } from '../lib/format'
import type { AgentStep } from '@shared/types'

import { useT } from '../lib/i18n'
/* ------------------------------------------------------------------ *
 * Aspecto por herramienta                                            *
 * ------------------------------------------------------------------ */

interface Look {
  icon: React.ReactNode
  color: string
  /** Verbo en español, para que la fila se lea como una frase. */
  verb: string
}

const RUN_TOOL = /^(bash|shell|powershell|run|exec|terminal)/

function lookOf(step: AgentStep): Look {
  if (step.kind === 'thinking') return { icon: <Sparkles size={11} />, color: 'text-violet', verb: 'Pensando' }
  if (step.kind === 'note') return { icon: <Info size={11} />, color: 'text-dim', verb: '' }

  const t = (step.tool ?? '').toLowerCase()
  if (/^(read|view|open|cat)/.test(t)) return { icon: <Eye size={11} />, color: 'text-accent', verb: 'Lee' }
  if (/^(write|create)/.test(t)) return { icon: <FilePlus2 size={11} />, color: 'text-ok', verb: 'Escribe' }
  if (/^(edit|multiedit|notebookedit|apply|patch|str_replace)/.test(t))
    return { icon: <Pencil size={11} />, color: 'text-warn', verb: 'Edita' }
  if (RUN_TOOL.test(t)) return { icon: <TerminalSquare size={11} />, color: 'text-muted', verb: 'Ejecuta' }
  if (/^(grep|glob|search|find|list|ls)/.test(t))
    return { icon: <Search size={11} />, color: 'text-accent', verb: 'Busca' }
  if (/^(web|fetch|url)/.test(t)) return { icon: <Globe size={11} />, color: 'text-violet', verb: 'Consulta' }
  if (/^(task|agent)/.test(t)) return { icon: <Bot size={11} />, color: 'text-violet', verb: 'Delega' }
  if (/^todo/.test(t)) return { icon: <ListTodo size={11} />, color: 'text-dim', verb: 'Apunta' }
  return { icon: <Wrench size={11} />, color: 'text-muted', verb: 'Usa' }
}

function isPending(step: AgentStep): boolean {
  return step.approval === 'pending' && step.status === 'running'
}

/* ------------------------------------------------------------------ *
 * Una fila                                                           *
 * ------------------------------------------------------------------ */

function Row({
  step,
  live,
  onApprove
}: {
  step: AgentStep
  live: boolean
  onApprove?: (stepId: string, allow: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const look = lookOf(step)
  const pending = isPending(step)
  const hasDetail = Boolean(step.detail && step.detail.length > 0)
  const long = (step.detail?.length ?? 0) > 90 || step.kind === 'thinking' || (step.detail ?? '').includes('\n')

  return (
    <div className="group">
      <button
        onClick={() => hasDetail && long && setOpen((v) => !v)}
        disabled={!hasDetail || !long}
        className={cx(
          'w-full flex items-center gap-2 px-2 py-[3px] rounded text-left text-[11.5px] transition-colors',
          hasDetail && long ? 'hover:bg-raised cursor-pointer' : 'cursor-default'
        )}
      >
        {hasDetail && long ? (
          <ChevronRight size={10} className={cx('shrink-0 text-dim transition-transform', open && 'rotate-90')} />
        ) : (
          <span className="w-[10px] shrink-0" />
        )}

        <span className={cx('shrink-0', pending ? 'text-warn' : look.color)}>
          {pending ? (
            <Hand size={11} />
          ) : step.status === 'running' ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            look.icon
          )}
        </span>

        {step.kind === 'tool' ? (
          <>
            <span className={cx('shrink-0 font-medium', look.color)}>{step.tool}</span>
            {step.target ? (
              <span className="font-mono text-muted truncate min-w-0 flex-1">{step.target}</span>
            ) : (
              <span className="flex-1" />
            )}
          </>
        ) : (
          <span
            className={cx(
              'min-w-0 flex-1 truncate',
              step.kind === 'thinking' ? 'text-violet italic' : 'text-dim'
            )}
          >
            {step.kind === 'thinking' ? (
              <>
                <span className="not-italic mr-1.5">{look.verb}</span>
                {(step.detail ?? '').replace(/\s+/g, ' ').trim()}
              </>
            ) : (
              step.detail
            )}
          </span>
        )}

        {/* Lo que costó: líneas tocadas, duración y cómo acabó. */}
        <span className="shrink-0 flex items-center gap-1.5 num text-[11px]">
          {step.added ? <span className="text-ok">+{step.added}</span> : null}
          {step.removed ? <span className="text-bad">-{step.removed}</span> : null}
          {step.durationMs && step.durationMs > 400 ? (
            <span className="text-dim">{fmtMs(step.durationMs)}</span>
          ) : null}
          {step.denied ? (
            <Ban size={11} className="text-warn" />
          ) : step.status === 'error' ? (
            <X size={11} className="text-bad" />
          ) : step.status === 'ok' && step.kind === 'tool' ? (
            <Check size={11} className={cx('text-ok', live ? '' : 'opacity-45')} />
          ) : null}
        </span>
      </button>

      {pending ? (
        <div className="ml-[26px] mr-2 mb-1.5 mt-0.5 px-2.5 py-2 rounded border border-[#4a3512] bg-[#1a1409] flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] text-warn">
            {RUN_TOOL.test((step.tool ?? '').toLowerCase())
              ? t('Quiere ejecutar este comando en el proyecto.')
              : t('Quiere modificar este archivo.')}
          </span>
          {onApprove ? (
            <span className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="primary" onClick={() => onApprove(step.id, true)}>
                <Check size={12} /> {t('Permitir')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => onApprove(step.id, false)}>
                <X size={12} /> {t('Rechazar')}
              </Button>
            </span>
          ) : (
            <span className="ml-auto text-[11px] text-dim">{t('esperando permiso')}</span>
          )}
        </div>
      ) : null}

      {open && hasDetail ? (
        <div
          className={cx(
            'ml-[26px] mr-2 mb-1 px-2.5 py-1.5 rounded border text-[11.5px] whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto',
            step.kind === 'thinking'
              ? 'bg-[#120e1f] border-[#2a1f4a] text-muted'
              : 'bg-void border-line font-mono text-muted'
          )}
        >
          {step.detail}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * La lista                                                           *
 * ------------------------------------------------------------------ */

export function AgentActivity({
  steps,
  running,
  onApprove
}: {
  steps?: AgentStep[]
  /** Mientras corre se queda abierta sola. */
  running?: boolean
  /** Contesta a una petición de permiso. Sin esto no se pintan los botones. */
  onApprove?: (stepId: string, allow: boolean) => void
}): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(Boolean(running))
  // Al arrancar una ejecución se abre; al terminar se pliega, que es como se
  // lee mejor una conversación vieja.
  useEffect(() => {
    setOpen(Boolean(running))
  }, [running])

  const totals = useMemo(() => {
    const list = steps ?? []
    const tools = list.filter((s) => s.kind === 'tool')
    const added = tools.reduce((n, s) => n + (s.added ?? 0), 0)
    const removed = tools.reduce((n, s) => n + (s.removed ?? 0), 0)
    const files = new Set(
      tools.filter((s) => (s.added ?? 0) + (s.removed ?? 0) > 0 && s.target).map((s) => s.target as string)
    )
    return {
      tools: tools.length,
      thinking: list.filter((s) => s.kind === 'thinking').length,
      running: tools.filter((s) => s.status === 'running').length,
      errors: tools.filter((s) => s.status === 'error' && !s.denied).length,
      pending: running ? tools.filter(isPending).length : 0,
      added,
      removed,
      files: files.size
    }
  }, [steps, running])

  if (!steps?.length) return null
  const last = steps[steps.length - 1]
  // Lo que espera permiso no se puede quedar escondido en una lista plegada.
  const shown = open || totals.pending > 0

  return (
    <div className="rounded-lg border border-line bg-void mb-2.5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[11.5px] hover:bg-raised transition-colors"
      >
        <ChevronRight size={11} className={cx('shrink-0 text-dim transition-transform', shown && 'rotate-90')} />
        {running ? (
          <Loader2 size={11} className="shrink-0 text-accent animate-spin" />
        ) : (
          <Wrench size={11} className="shrink-0 text-dim" />
        )}
        <span className="text-muted shrink-0">
          {totals.tools} {totals.tools === 1 ? t('acción') : 'acciones'}
        </span>
        {totals.thinking ? <span className="text-violet shrink-0">{totals.thinking} pensando</span> : null}
        {totals.added ? <span className="num text-ok shrink-0">+{totals.added}</span> : null}
        {totals.removed ? <span className="num text-bad shrink-0">-{totals.removed}</span> : null}
        {totals.files ? (
          <span className="text-dim shrink-0">
            en {totals.files} archivo{totals.files === 1 ? '' : 's'}
          </span>
        ) : null}
        {totals.errors ? <span className="text-bad shrink-0">{t('activity.errors', { n: totals.errors })}</span> : null}
        {totals.pending ? <span className="text-warn shrink-0">{t('espera tu permiso')}</span> : null}

        {/* Plegada y corriendo: al menos se ve qué está haciendo ahora. */}
        {!shown && running && last ? (
          <span className="ml-auto min-w-0 truncate text-dim">
            {last.kind === 'tool' ? `${last.tool} ${last.target ?? ''}` : 'pensando…'}
          </span>
        ) : null}
      </button>

      {shown ? (
        <div className="pb-1 border-t border-line pt-1">
          {steps.map((s) => (
            <Row key={s.id} step={s} live={Boolean(running)} onApprove={running ? onApprove : undefined} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
