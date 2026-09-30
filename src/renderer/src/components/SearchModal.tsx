/**
 * Buscar en todo: los mensajes de las conversaciones de la Consola (también
 * las cerradas) y el histórico de ejecuciones, con filtros.
 *
 * Se abre con Ctrl+Mayús+F desde cualquier sitio, con el botón de la barra de
 * arriba o pulsando Enter en el buscador de la Consola. Al elegir un
 * resultado te lleva al mensaje dentro de su conversación o a la ejecución en
 * el Histórico.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { History as HistoryIcon, MessagesSquare, Search, Terminal as TerminalIcon, User, Bot } from 'lucide-react'
import { Badge, Modal, Select, Toggle, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { relTime, shortModel } from '../lib/format'
import { focusChat } from '../lib/engine'
import { navigate } from '../lib/nav'
import { withMod } from '../lib/platform'
import type { SearchHit, SearchResult } from '@shared/types'

type Listener = (text?: string) => void
const listeners = new Set<Listener>()

/** Abre el buscador desde cualquier sitio, con un texto ya escrito si se quiere. */
export function openSearch(text?: string): void {
  for (const l of [...listeners]) l(text)
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a < at) continue
    if (a > at) parts.push(text.slice(at, a))
    parts.push(
      <mark key={a} className="bg-accent/25 text-ink rounded-[2px] px-[1px]">
        {text.slice(a, b)}
      </mark>
    )
    at = b
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

const PERIODS: { id: string; label: string; days?: number }[] = [
  { id: '', label: 'Siempre' },
  { id: '7', label: 'Últimos 7 días', days: 7 },
  { id: '30', label: 'Últimos 30 días', days: 30 },
  { id: '90', label: 'Últimos 90 días', days: 90 }
]

export function SearchModal(): React.JSX.Element | null {
  const t = useT()
  const { config } = useStore()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [scope, setScope] = useState<'all' | 'sessions' | 'runs'>('all')
  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState('')
  const [archived, setArchived] = useState(true)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const l: Listener = (q) => {
      if (q != null) setText(q)
      setOpen(true)
      requestAnimationFrame(() => input.current?.select())
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  // Ctrl+Mayús+F desde cualquier sección.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Se busca mientras escribes, con un respiro para no lanzar una por tecla.
  useEffect(() => {
    if (!open) return
    const q = text.trim()
    if (q.length < 2) {
      setResult(null)
      return
    }
    let alive = true
    setLoading(true)
    const days = PERIODS.find((p) => p.id === period)?.days
    const timer = window.setTimeout(() => {
      void window.api.search
        .query({ text: q, scope, projectId: projectId || undefined, from: days ? Date.now() - days * 86_400_000 : undefined, archived })
        .then((r) => {
          if (!alive) return
          setLoading(false)
          setResult(r.ok && r.data ? r.data : { hits: [], total: 0, tookMs: 0, truncated: false })
          setActive(0)
        })
    }, 180)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, text, scope, projectId, period, archived])

  const projects = config?.projects ?? []
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const hits = result?.hits ?? []

  const go = (h: SearchHit): void => {
    setOpen(false)
    if (h.kind === 'turn' && h.sessionId) focusChat(h.sessionId, h.turnId)
    else if (h.runId) navigate({ page: 'history', runId: h.runId })
  }

  useEffect(() => {
    list.current?.querySelector(`[data-hit-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const roleLabel = (h: SearchHit): string =>
    h.kind === 'turn' ? (h.role === 'user' ? t('Tú') : t('Respuesta')) : h.field === 'prompt' ? t('Prompt') : t('Respuesta')

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t('Buscar en todo')} width="max-w-3xl">
      <div className="space-y-3" data-search>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            ref={input}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, Math.max(0, hits.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter' && hits[active]) {
                e.preventDefault()
                go(hits[active])
              }
            }}
            placeholder={t('Palabras que estén en el mensaje, o "una frase exacta"')}
            className="w-full h-10 pl-9 pr-3 bg-void border border-line rounded-lg text-[13.5px] outline-none focus:border-accent-dim placeholder:text-dim"
            data-search-input
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <div className="flex items-center rounded-md border border-line overflow-hidden">
            {(
              [
                ['all', t('Todo')],
                ['sessions', t('Conversaciones')],
                ['runs', t('Histórico')]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setScope(id)}
                className={cx('px-2.5 h-7', scope === id ? 'bg-raised text-ink' : 'text-dim hover:text-ink')}
                data-scope={id}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="w-[180px]">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-7 text-[12px]">
              <option value="">{t('Todos los proyectos')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[150px]">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-7 text-[12px]">
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.label)}
                </option>
              ))}
            </Select>
          </div>
          {scope !== 'runs' ? <Toggle checked={archived} onChange={setArchived} label={t('Incluir las cerradas')} /> : null}
        </div>

        <div ref={list} className="max-h-[52vh] overflow-y-auto -mx-1 px-1 space-y-1" data-search-results>
          {text.trim().length < 2 ? (
            <div className="py-8 text-center text-[12.5px] text-dim leading-relaxed">
              {t('Busca en los mensajes de todas tus conversaciones y en el histórico. Sin distinguir mayúsculas ni tildes.')}
            </div>
          ) : !result && loading ? (
            <div className="py-8 text-center text-[12.5px] text-dim">{t('Buscando…')}</div>
          ) : hits.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-dim">{t('Nada encaja con esa búsqueda.')}</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                type="button"
                data-hit={h.kind}
                data-hit-index={i}
                onClick={() => go(h)}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  'w-full text-left rounded-lg px-3 py-2 border',
                  i === active ? 'bg-raised border-line' : 'border-transparent hover:bg-raised/60'
                )}
              >
                <div className="flex items-center gap-2 text-[11.5px] mb-0.5 min-w-0">
                  {h.kind === 'run' ? (
                    <HistoryIcon size={12} className="text-violet shrink-0" />
                  ) : h.sessionKind === 'cli' ? (
                    <TerminalIcon size={12} className="text-warn shrink-0" />
                  ) : (
                    <MessagesSquare size={12} className="text-accent shrink-0" />
                  )}
                  <span className="font-medium text-ink truncate min-w-0">{h.kind === 'run' ? shortModel(h.title) : h.title}</span>
                  <span className="flex items-center gap-1 text-dim shrink-0">
                    {h.role === 'user' || h.field === 'prompt' ? <User size={10} /> : <Bot size={10} />}
                    {roleLabel(h)}
                  </span>
                  {h.projectId || h.projectName ? (
                    <Badge tone="violet" className="shrink-0 max-w-[160px]">
                      <span className="truncate">{projectName.get(h.projectId ?? '') ?? h.projectName}</span>
                    </Badge>
                  ) : null}
                  {h.archived ? <Badge tone="neutral">{t('cerrada')}</Badge> : null}
                  <span className="ml-auto text-dim num shrink-0">{relTime(h.at)}</span>
                </div>
                <div className="text-[12.5px] text-muted leading-relaxed break-words line-clamp-3" data-snippet>
                  <Highlighted text={h.snippet} ranges={h.ranges} />
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-dim">
          <span>
            {result && text.trim().length >= 2
              ? result.truncated
                ? t('{n} resultados (se enseñan los {shown} más relevantes) · {ms} ms', { n: result.total, shown: hits.length, ms: result.tookMs })
                : t('{n} resultados · {ms} ms', { n: result.total, ms: result.tookMs })
              : ''}
          </span>
          <span>{withMod(t('↑↓ elegir · Enter abrir · Ctrl+Mayús+F desde cualquier sitio'))}</span>
        </div>
      </div>
    </Modal>
  )
}
