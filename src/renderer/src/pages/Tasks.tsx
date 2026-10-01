/**
 * Tareas: todo lo que tienen entre manos tus agentes, en un tablero.
 *
 * Cuatro columnas: en marcha, necesita tu respuesta, para revisar y hecho.
 * Cada tarjeta es una conversación de la Consola (o la Arena de código) con
 * su agente, su rama o worktree, lo que lleva gastado y las líneas que ha
 * cambiado. Todo se lee del motor, así que se mueve solo mientras trabajan.
 *
 * Desde aquí se contesta sin abrir la conversación: dar o negar un permiso,
 * responder a lo que pregunta, revisar el diff entero de la tarea y devolverle
 * comentarios, o darla por hecha. «Nueva tarea» lanza un agente sobre un
 * proyecto, por defecto en su propio worktree.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  SquareKanban, Plus, Square, Check, X, FileDiff, MessageSquareReply, FolderGit2, GitBranch, Swords,
  RotateCcw, Archive, Cpu, Bot, AlertTriangle, Loader2, ExternalLink, TerminalSquare, CalendarClock
} from 'lucide-react'
import { Button, Badge, Select, Textarea, Empty, cx } from '../components/ui'
import { DiffReview } from '../components/DiffReview'
import { TaskForm, SchedulesStrip } from '../components/TaskForm'
import { alwaysLabel } from '../components/AgentActivity'
import { samePath } from '../components/WorktreeBox'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { cost, ms, relTime, shortModel, colorFor } from '../lib/format'
import { navigate } from '../lib/nav'
import {
  useSessions, useOpenChats, useArena, useTick, useRunsVersion, useTerminalAttention, sendTurn,
  setTaskDone, stopSession, stopArena, approveStep, focusChat, archiveSession
} from '../lib/engine'
import { buildTasks, TASK_COLUMNS, type TaskCard, type TaskColumn } from '../lib/tasks'
import type { AppConfig, ScheduledTask, WorktreeInfo } from '@shared/types'
import { withMod } from '../lib/platform'

const COLUMN: Record<TaskColumn, { title: string; hint: string; tone: string }> = {
  running: { title: 'En marcha', hint: 'Trabajando ahora', tone: 'text-ok' },
  attention: { title: 'Necesita tu respuesta', hint: 'Un permiso, un fallo o una pregunta', tone: 'text-warn' },
  review: { title: 'Para revisar', hint: 'Acabaron: mira lo que hicieron', tone: 'text-accent' },
  done: { title: 'Hecho', hint: 'Las que diste por buenas', tone: 'text-dim' }
}

const PERIODS = [
  { id: '7', label: 'Últimos 7 días', days: 7 },
  { id: '30', label: 'Últimos 30 días', days: 30 },
  { id: 'all', label: 'Todo', days: 0 }
] as const

/** Hecho se acorta: lo viejo sigue en la Consola. */
const DONE_LIMIT = 40

/** Qué hace ahora: la herramienta y sobre qué, o que está pensando. */
function stepLabel(step: TaskCard['current'], t: (k: string) => string): string {
  if (!step) return t('Empezando…')
  if (step.kind === 'thinking') return t('Pensando')
  return [step.tool, step.target].filter(Boolean).join(' ') || t('Trabajando')
}

/** Los worktrees de los proyectos que tienen tareas en uno, para ver si llevan cambios o commits. */
function useWorktrees(paths: string[], version: number): WorktreeInfo[] {
  const [list, setList] = useState<WorktreeInfo[]>([])
  const key = paths.join('\n')
  useEffect(() => {
    let alive = true
    if (!key) {
      setList([])
      return
    }
    void Promise.all(key.split('\n').map((p) => window.api.worktrees.list(p))).then((rs) => {
      if (alive) setList(rs.flatMap((r) => (r.ok && r.data ? r.data : [])))
    })
    return () => {
      alive = false
    }
  }, [key, version])
  return list
}

function Clock({ since }: { since?: number }): React.JSX.Element | null {
  useTick()
  if (!since) return null
  return <span className="num text-[10.5px] text-dim shrink-0">{ms(Date.now() - since)}</span>
}

function Card({
  card,
  config,
  worktree,
  onReview
}: {
  card: TaskCard
  config: AppConfig
  worktree?: WorktreeInfo
  onReview: (c: TaskCard) => void
}): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  const project =
    config.projects.find((p) => p.id === card.projectId) ??
    (card.cwd ? config.projects.find((p) => samePath(p.path, card.cwd!)) : undefined)
  const cliAgent = config.cliAgents.find((a) => a.id === card.cliAgentId)
  const apiAgent = config.agents.find((a) => a.id === card.agentId)
  const isArena = card.kind === 'arena'
  const agentName = isArena
    ? t('Arena de código')
    : cliAgent?.name ?? apiAgent?.name ?? (card.model ? shortModel(card.model) : t('Sin agente'))
  const color = isArena ? '#a78bfa' : cliAgent?.color ?? apiAgent?.color ?? (card.model ? colorFor(card.model) : '#2a3145')
  const branch = worktree?.branch ?? card.branch

  const open = (): void => {
    if (isArena) navigate('arena')
    else focusChat(card.id)
  }

  const send = async (): Promise<void> => {
    const text = reply.trim()
    if (!text) return
    setSending(true)
    const r = await sendTurn(card.id, text, config, {
      onStart: () => {
        setReply('')
        setReplying(false)
      }
    })
    setSending(false)
    if (r.error) toast('error', t(r.error))
    else if (r.run?.status === 'error') toast('error', r.run.error ?? t('El agente falló'))
  }

  const stop = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (isArena) stopArena()
    else stopSession(card.id)
  }

  // Claude Code en una terminal: no se le contesta desde aquí (está en su
  // ventana), pero se ve que espera, dónde y qué pide.
  if (card.kind === 'terminal') {
    return (
      <div className="bg-raised border border-line rounded-lg p-2.5 space-y-2" data-task={card.id}>
        <div className="flex items-start gap-2 min-w-0">
          <span className="w-1 self-stretch rounded-full shrink-0 bg-warn" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] leading-snug truncate">{project?.name ?? card.title}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-dim mt-0.5 min-w-0">
              <TerminalSquare size={10} className="shrink-0" />
              <span className="truncate">{t('Claude Code en una terminal')}</span>
            </div>
          </div>
        </div>
        {card.cwd ? (
          <div className="text-[10.5px] text-dim font-mono truncate" title={card.cwd}>
            {card.cwd}
          </div>
        ) : null}
        {card.reason ? (
          <div className="flex items-start gap-1.5 text-[11.5px] leading-snug text-warn">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{t(card.reason.text, card.reason.args)}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <span className="text-[10.5px] text-dim num">{relTime(card.updatedAt)}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => card.terminalId && void window.api.attention.dismiss(card.terminalId)}
            title={t('Quitar el aviso: se quita solo cuando Claude sigue trabajando')}
          >
            <X size={12} /> {t('Descartar')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="bg-raised border border-line rounded-lg p-2.5 space-y-2 cursor-pointer hover:border-accent-dim transition-colors"
      onClick={open}
      data-task={card.id}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] leading-snug line-clamp-2 break-words">{card.title}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-dim mt-0.5 min-w-0">
            {isArena ? <Swords size={10} className="shrink-0" /> : cliAgent ? <Cpu size={10} className="shrink-0" /> : <Bot size={10} className="shrink-0" />}
            <span className="truncate">
              {agentName}
              {card.model && (cliAgent || apiAgent) ? ` · ${shortModel(card.model)}` : ''}
              {project ? ` · ${project.name}` : ''}
            </span>
          </div>
        </div>
      </div>

      {branch || card.worktreePath ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {card.worktreePath ? (
            <Badge tone="accent" title={card.worktreePath}>
              <FolderGit2 size={10} /> {t('worktree')}
            </Badge>
          ) : null}
          {branch ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted font-mono min-w-0 max-w-full">
              <GitBranch size={10} className="shrink-0" /> <span className="truncate">{branch}</span>
            </span>
          ) : null}
          {worktree?.dirty ? <Badge tone="warn">{t('{n} sin confirmar', { n: worktree.dirty })}</Badge> : null}
          {worktree?.ahead ? <Badge>{t('{n} commits por delante', { n: worktree.ahead })}</Badge> : null}
        </div>
      ) : null}

      {card.column === 'running' ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted min-w-0">
          <Loader2 size={11} className="animate-spin text-ok shrink-0" />
          <span className="truncate font-mono flex-1">{isArena ? t('Los contendientes trabajan') : stepLabel(card.current, t)}</span>
          <Clock since={card.startedAt} />
        </div>
      ) : null}

      {card.reason ? (
        <div className={cx('flex items-start gap-1.5 text-[11.5px] leading-snug', card.column === 'attention' ? 'text-warn' : 'text-muted')}>
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{t(card.reason.text, card.reason.args)}</span>
        </div>
      ) : null}

      {card.pending ? (
        <div className="bg-void border border-line rounded-md px-2 py-1.5 text-[11px] font-mono text-muted break-all">
          {[card.pending.step.tool, card.pending.step.target].filter(Boolean).join(' ')}
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-[10.5px] text-dim num">
        <span title={card.costEstimated ? t('Estimado con el precio del catálogo') : undefined}>
          {cost(card.cost)}
          {card.costEstimated ? '*' : ''}
        </span>
        {card.files ? (
          <span>
            <span className="text-ok">+{card.added}</span> <span className="text-bad">−{card.removed}</span>{' '}
            {t(card.files === 1 ? '1 fichero' : '{n} ficheros', { n: card.files })}
          </span>
        ) : null}
        <span className="ml-auto">{relTime(card.doneAt ?? card.updatedAt)}</span>
      </div>

      {replying ? (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <Textarea
            autoFocus
            rows={3}
            value={reply}
            placeholder={t('Tu respuesta al agente…')}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void send()
              }
              if (e.key === 'Escape') setReplying(false)
            }}
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              {t('Cancelar')}
            </Button>
            <Button size="sm" loading={sending} disabled={!reply.trim()} onClick={() => void send()} title={withMod('Enter')}>
              {t('Enviar')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {card.pending ? (
            <>
              <Button size="sm" onClick={() => approveStep(card.pending!.runId, card.pending!.step.id, true)}>
                <Check size={12} /> {t('Permitir')}
              </Button>
              {card.pending.step.always ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => approveStep(card.pending!.runId, card.pending!.step.id, true, true)}
                  title={card.pending.step.always.what}
                >
                  {alwaysLabel(card.pending.step.always, t)}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => approveStep(card.pending!.runId, card.pending!.step.id, false)}>
                <X size={12} /> {t('Rechazar')}
              </Button>
            </>
          ) : null}
          {card.column === 'running' || card.pending ? (
            <Button size="sm" variant="ghost" onClick={stop} title={t('Detener')}>
              <Square size={11} />
            </Button>
          ) : null}
          {!isArena && (card.column === 'attention' || card.column === 'review') && !card.pending ? (
            <Button size="sm" variant="ghost" onClick={() => setReplying(true)}>
              <MessageSquareReply size={12} /> {t('Responder')}
            </Button>
          ) : null}
          {!isArena && card.review && card.column !== 'running' ? (
            <Button size="sm" variant="ghost" onClick={() => onReview(card)} title={t('Todo lo que ha cambiado la tarea, con comentarios para el agente')}>
              <FileDiff size={12} /> {t('Revisar')}
            </Button>
          ) : null}
          {!isArena && (card.column === 'attention' || card.column === 'review') && !card.pending ? (
            <Button size="sm" variant="ghost" onClick={() => void setTaskDone(card.id, true)} title={t('Darla por hecha')}>
              <Check size={12} /> {t('Hecha')}
            </Button>
          ) : null}
          {card.column === 'done' && !isArena ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => void setTaskDone(card.id, false)} title={t('Devolverla a «Para revisar»')}>
                <RotateCcw size={12} /> {t('Reabrir')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void archiveSession(card.id)} title={t('Cerrar la conversación: sigue guardada en la Consola')}>
                <Archive size={12} />
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={open} title={isArena ? t('Abrir en la Arena') : t('Abrir en la Consola')}>
            <ExternalLink size={12} />
          </Button>
        </div>
      )}
    </div>
  )
}

/** Qué agente lanza la tarea: «cli:<id>», «api:<id>» o «model» (un modelo por API como agente). */
type AgentChoice = string

export default function Tasks(): React.JSX.Element {
  const t = useT()
  const { config, toast } = useStore()
  const list = useSessions()
  const chats = useOpenChats()
  const arena = useArena()
  const version = useRunsVersion()
  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState<string>('7')
  const [creating, setCreating] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  const [reviewing, setReviewing] = useState<TaskCard | null>(null)

  const terminal = useTerminalAttention()
  // Las de la terminal entran al filtro de proyecto por su carpeta.
  const all = useMemo(
    () =>
      buildTasks(list, chats, arena, terminal).map((c) =>
        c.kind === 'terminal' && c.cwd && !c.projectId
          ? { ...c, projectId: config?.projects.find((p) => samePath(p.path, c.cwd!))?.id }
          : c
      ),
    [list, chats, arena, terminal, config?.projects]
  )

  const days = PERIODS.find((p) => p.id === period)?.days ?? 0
  const columns = useMemo(() => {
    const cutoff = days ? Date.now() - days * 86_400_000 : 0
    const by: Record<TaskColumn, TaskCard[]> = { running: [], attention: [], review: [], done: [] }
    for (const c of all) {
      if (projectId && c.projectId !== projectId) continue
      // Lo que está en marcha o espera algo de ti sale siempre; lo demás, según la fecha.
      if ((c.column === 'review' || c.column === 'done') && (c.doneAt ?? c.updatedAt) < cutoff) continue
      by[c.column].push(c)
    }
    by.running.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    by.attention.sort((a, b) => b.updatedAt - a.updatedAt)
    by.review.sort((a, b) => b.updatedAt - a.updatedAt)
    by.done.sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt))
    by.done = by.done.slice(0, DONE_LIMIT)
    return by
  }, [all, projectId, days])

  // Los worktrees de los proyectos con tareas en uno: si llevan cambios o commits.
  const wtProjects = useMemo(() => {
    const paths = new Set<string>()
    for (const c of all) {
      if (!c.worktreePath) continue
      const p = config?.projects.find((x) => x.id === c.projectId)
      if (p) paths.add(p.path)
    }
    return [...paths].sort()
  }, [all, config?.projects])
  const running = columns.running.length
  const worktrees = useWorktrees(wtProjects, version + running)
  const worktreeOf = (c: TaskCard): WorktreeInfo | undefined =>
    c.worktreePath ? worktrees.find((w) => samePath(w.path, c.worktreePath!)) : undefined

  const total = TASK_COLUMNS.reduce((n, k) => n + columns[k].length, 0)
  const reviewChat = reviewing ? chats[reviewing.id] : undefined

  if (!config) return <div className="h-full" />

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 px-5 border-b border-line flex items-center justify-between gap-3 shrink-0 bg-void">
        <div className="flex items-center gap-2.5 min-w-0">
          <SquareKanban size={15} className="text-accent" />
          <span className="font-medium">{t('Tareas')}</span>
          <span className="text-[12px] text-dim truncate">{t('lo que tienen entre manos tus agentes, de un vistazo')}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* El Select ocupa todo el ancho que le den: la caja fija el suyo. */}
          <div className="w-44 shrink-0">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 text-[12px]" aria-label={t('Proyecto')}>
              <option value="">{t('Todos los proyectos')}</option>
              {config.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40 shrink-0">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-8 text-[12px]" aria-label={t('Periodo')}>
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.label)}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setScheduling(true)} data-open-schedule>
            <CalendarClock size={13} /> {t('Programar')}
          </Button>
          <Button size="sm" className="shrink-0" onClick={() => setCreating(true)}>
            <Plus size={13} /> {t('Nueva tarea')}
          </Button>
        </div>
      </div>

      <SchedulesStrip config={config} projectId={projectId} onEdit={setEditing} onNew={() => setScheduling(true)} />

      {total === 0 && !all.length ? (
        <Empty
          icon={<SquareKanban size={40} />}
          title={t('Sin tareas todavía')}
          hint={t('Una tarea es un agente trabajando sobre un proyecto: lánzala aquí o desde la Consola y la verás pasar por las columnas sola.')}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus size={13} /> {t('Nueva tarea')}
            </Button>
          }
        />
      ) : (
        <div className="flex-1 min-h-0 flex gap-3 p-3 overflow-x-auto">
          {TASK_COLUMNS.map((k) => (
            <div key={k} className="flex-1 min-w-[250px] flex flex-col min-h-0 bg-void/60 border border-line rounded-xl" data-column={k}>
              <div className="px-3 py-2.5 border-b border-line shrink-0">
                <div className="flex items-center gap-2">
                  <span className={cx('text-[12.5px] font-medium', COLUMN[k].tone)}>{t(COLUMN[k].title)}</span>
                  <span className="num text-[11px] text-dim">{columns[k].length}</span>
                </div>
                <div className="text-[10.5px] text-dim mt-0.5">{t(COLUMN[k].hint)}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columns[k].length ? (
                  columns[k].map((c) => (
                    <Card key={c.id} card={c} config={config} worktree={worktreeOf(c)} onReview={setReviewing} />
                  ))
                ) : (
                  <div className="text-[11.5px] text-dim text-center py-6">{t('Nada')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskForm open={creating} onClose={() => setCreating(false)} config={config} projectId={projectId} />
      <TaskForm open={scheduling} onClose={() => setScheduling(false)} config={config} projectId={projectId} scheduling />
      <TaskForm open={Boolean(editing)} onClose={() => setEditing(null)} config={config} projectId={projectId} editing={editing} />

      {reviewing?.review ? (
        <DiffReview
          open
          onClose={() => setReviewing(null)}
          runId={reviewing.review.runId}
          checkpoint={reviewing.review.checkpoint}
          disabled={Boolean(reviewChat?.runningRunId)}
          title={t('Todo lo que ha cambiado la tarea')}
          onSend={(text) => {
            const id = reviewing.id
            setReviewing(null)
            void sendTurn(id, text, config).then((r) => {
              if (r.error) toast('error', t(r.error))
            })
          }}
        />
      ) : null}
    </div>
  )
}
