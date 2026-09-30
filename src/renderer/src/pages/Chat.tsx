/**
 * Consola: conversaciones con modelos por API y con agentes de línea de
 * comandos.
 *
 * El estado vive en el motor, así que una respuesta a medias sigue llegando
 * aunque te vayas al Panel y vuelvas. Cada conversación es una sesión que se
 * puede cerrar, reabrir o borrar, y mientras genera se ven sus métricas en
 * tiempo real.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Send, Square, Plus, Bot, FolderGit2, ChevronRight, Copy, Check,
  AlertTriangle, User, Sparkles, MessagesSquare, Trash2, X, Pin, PinOff, Archive,
  ArchiveRestore, Search, Pencil, Terminal as TerminalIcon, Cpu, GitBranch, FolderOpen, GitFork, RotateCcw,
  ArrowRightLeft, FileDiff, Lightbulb, RefreshCw
} from 'lucide-react'
import { Panel, PanelHeader, Button, Textarea, Input, Field, Select, Badge, Empty, cx, Dot, Modal, Toggle } from '../components/ui'
import { ModelPicker, type Pick } from '../components/ModelPicker'
import { Markdown } from '../components/Markdown'
import { AgentActivity } from '../components/AgentActivity'
import {
  OpencodeModelPicker, isOpencodeCommand, opencodeEffortHint, useOpencodeModels
} from '../components/OpencodeModelPicker'
import { Metrics, LiveMetrics } from '../components/Stats'
import {
  AttachButton, AttachmentList, BranchPicker, ContextGauge, EffortPicker,
  EFFORT_LABEL, FileWork, UsageLimitView, UsagePanel, useGit
} from '../components/AgentPanel'
import { useStore } from '../lib/store'
import { cost, tokens, shortModel, relTime } from '../lib/format'
import {
  useSessions, useChat, newSession, openSession, patchSessionConfig, archiveSession,
  unarchiveSession, deleteSession, sendTurn, stopSession, loadSessions, approveStep,
  useChatFocus, useQuotas, markTurnUndone, forkAt, planRewind, rewindAndSend, type Turn
} from '../lib/engine'
import { RewindModal } from '../components/RewindModal'
import { PromptTextarea, SavePromptButton } from '../components/PromptLibrary'
import { openSearch } from '../components/SearchModal'
import { UndoTurn } from '../components/UndoTurn'
import { WorktreeBox } from '../components/WorktreeBox'
import { DiffReview } from '../components/DiffReview'
import { pickRelayAgent } from '@shared/quotaPick'
import {
  API_PERMISSION_MODES, PERMISSION_MODES, type Attachment, type Effort, type StoredSession, type RunCheckpoint
} from '@shared/types'
import { Pane } from '../components/Resizable'
import { resumeCaps } from '@shared/cliCaps'
import { RelayModal, endedByLimit } from '../components/RelayModal'
import { Recommender } from '../components/Recommender'

import { useT } from '../lib/i18n'
import { withMod } from '../lib/platform'
function CopyBtn({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="text-dim hover:text-ink transition-colors"
      title={t('Copiar')}
    >
      {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Lista de sesiones                                                  *
 * ------------------------------------------------------------------ */

function SessionRow({
  session,
  active,
  running,
  onOpen,
  onRename,
  onArchive,
  onUnarchive,
  onDelete,
  onPin
}: {
  session: StoredSession
  active: boolean
  running: boolean
  onOpen: () => void
  onRename: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
  onPin: () => void
}): React.JSX.Element {
  const t = useT()
  const turns = session.turns?.filter((t) => t.role === 'assistant').length ?? 0
  const spent = (session.turns ?? []).reduce((s, t) => s + (t.metrics?.costTotal ?? 0), 0)

  return (
    <div
      className={cx(
        'group relative mx-1.5 rounded-lg transition-colors',
        active ? 'bg-raised' : 'hover:bg-[#12151f]'
      )}
    >
      <button onClick={onOpen} className="w-full text-left px-2.5 py-2">
        {active ? <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" /> : null}
        <div className="flex items-center gap-1.5 mb-0.5">
          {session.kind === 'cli' ? (
            <TerminalIcon size={11} className="text-warn shrink-0" />
          ) : (
            <MessagesSquare size={11} className={cx('shrink-0', active ? 'text-accent' : 'text-dim')} />
          )}
          {session.pinned ? <Pin size={9} className="text-violet shrink-0" /> : null}
          <span className={cx('text-[12px] truncate flex-1 min-w-0', active ? 'text-ink' : 'text-muted')}>
            {session.title}
          </span>
          {running ? <Dot tone="ok" pulse /> : null}
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-dim">
          <span>{relTime(session.updatedAt)}</span>
          {turns > 0 ? (
            <span className="num">{turns === 1 ? t('chat.turnOne') : t('chat.turns', { n: turns })}</span>
          ) : null}
          {spent > 0 ? <span className="num">{cost(spent)}</span> : null}
        </div>
      </button>

      <div className="absolute right-1 top-1 hidden group-hover:flex items-center gap-0.5 bg-panel/95 rounded-md px-0.5 py-0.5 border border-line">
        <button onClick={onPin} className="text-dim hover:text-violet p-0.5" title={session.pinned ? t('Quitar de fijadas') : 'Fijar arriba'}>
          {session.pinned ? <PinOff size={11} /> : <Pin size={11} />}
        </button>
        <button onClick={onRename} className="text-dim hover:text-ink p-0.5" title={t('Renombrar')}>
          <Pencil size={11} />
        </button>
        {session.archived ? (
          <button onClick={onUnarchive} className="text-dim hover:text-ok p-0.5" title={t('Reabrir')}>
            <ArchiveRestore size={11} />
          </button>
        ) : (
          <button onClick={onArchive} className="text-dim hover:text-warn p-0.5" title={t('Cerrar la sesión (se guarda)')}>
            <Archive size={11} />
          </button>
        )}
        <button onClick={onDelete} className="text-dim hover:text-bad p-0.5" title={t('Borrar del todo')}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Turno                                                              *
 * ------------------------------------------------------------------ */

/**
 * Los CLIs que aceptan un nivel de esfuerzo. La lista vive también en el
 * proceso principal, que es quien traduce el nivel a argumentos; aquí sólo se
 * usa para no ofrecer un mando que no va a ninguna parte.
 */
const EFFORT_CLIS = new Set(['claude', 'codex', 'aider'])

/** Los que dejan elegir modelo con una opción de verdad. */
const MODEL_CLIS = new Set(['claude', 'codex', 'opencode', 'gemini', 'qwen', 'aider'])

/** Alias de modelo que resuelve el propio CLI, así que no envejecen. */
const CLI_MODELS: Record<string, { id: string; label: string }[]> = {
  claude: [
    { id: 'fable', label: 'Fable · el más capaz' },
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet · equilibrado' },
    { id: 'haiku', label: 'Haiku · rápido y barato' }
  ]
}

/**
 * Si el agente sigue en su propia sesión entre turnos. Con eso recuerda lo que
 * hizo antes sin que haya que repetírselo; se puede bifurcar (seguir desde ahí
 * en una sesión nueva) o empezar de cero. Si su CLI no sabe retomar, se dice y
 * la conversación anterior le llega dentro del prompt.
 */
function CliContinuity({ session, command }: { session: StoredSession; command: string }): React.JSX.Element {
  const t = useT()
  const caps = resumeCaps(command)
  const on = session.cliContinue !== false
  const sid = session.cliSessionAgentId === session.cliAgentId ? session.cliSessionId : undefined
  return (
    <Field label={t('Continuidad')}>
      <Toggle
        checked={on}
        onChange={(v) => patchSessionConfig(session.id, { cliContinue: v })}
        label={t('Seguir en la misma sesión del agente')}
      />
      <p className="text-[11px] text-dim mt-1.5 leading-relaxed">
        {!on
          ? t('Cada turno empieza de cero: el agente no recuerda los anteriores.')
          : caps.byId
            ? sid
              ? t('Retoma la sesión {id}: recuerda lo que hizo en los turnos anteriores.', { id: sid.slice(0, 8) })
              : t('Al primer turno el agente abre su sesión; los siguientes la retoman.')
            : caps.byFolder
              ? t('{cmd} retoma la conversación que guarda en el proyecto.', { cmd: command })
              : t('{cmd} no sabe retomar su sesión: se le pasa la conversación anterior dentro del prompt.', { cmd: command })}
      </p>
      {on && sid ? (
        <div className="flex items-center gap-1.5 mt-2">
          {caps.fork ? (
            <Button
              size="sm"
              variant={session.cliForkNext ? 'primary' : 'ghost'}
              onClick={() => patchSessionConfig(session.id, { cliForkNext: !session.cliForkNext })}
              title={t('El próximo turno sigue desde aquí en una sesión nueva; la original queda como está')}
            >
              <GitFork size={12} /> {session.cliForkNext ? t('Bifurcará al enviar') : t('Bifurcar')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => patchSessionConfig(session.id, { cliSessionId: undefined, cliForkNext: false })}
            title={t('El próximo turno abre una sesión nueva del agente')}
          >
            <RotateCcw size={12} /> {t('Empezar de cero')}
          </Button>
        </div>
      ) : null}
    </Field>
  )
}

function TurnView({
  turn,
  isCli,
  sessionId,
  onReview,
  onAllow,
  onEdit,
  onRegenerate,
  onFork,
  highlight
}: {
  turn: Turn
  isCli: boolean
  sessionId: string
  /** Se llegó aquí desde la búsqueda. */
  highlight?: boolean
  /** Abrir la revisión del diff de este turno. */
  onReview?: () => void
  /** Claude Code: seguir dándole permiso sólo para lo que le faltó. */
  onAllow?: (rules: string[]) => void
  /** Mensaje tuyo: cambiarlo y volver a mandarlo desde ahí. */
  onEdit?: () => void
  /** Respuesta: volver a pedirla. */
  onRegenerate?: () => void
  /** Respuesta: seguir desde aquí en una conversación nueva. */
  onFork?: () => void
}): React.JSX.Element {
  const t = useT()
  // Lo que el agente quiso hacer y no pudo por falta de permiso. Lo que
  // rechazaste tú (agentes por API) no cuenta: eso ya lo decidiste.
  const denied = (turn.steps ?? []).filter((s) => s.denied && s.approval !== 'denied')
  const rules = [...new Set(denied.map((s) => s.rule).filter((r): r is string => Boolean(r)))]
  if (turn.role === 'user') {
    return (
      <div className={cx('group flex gap-3 justify-end rounded-xl transition-shadow duration-700', highlight && 'ring-1 ring-accent/60 ring-offset-4 ring-offset-void')} data-turn={turn.id}>
        <div className="max-w-[78%] flex flex-col items-end gap-1">
          <div className="bg-raised border border-line rounded-xl rounded-tr-sm px-3.5 py-2.5 space-y-2">
            <div className="whitespace-pre-wrap break-words text-[13px]">{turn.content}</div>
            <AttachmentList items={turn.attachments} readOnly />
          </div>
          {onEdit ? (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <Button size="sm" variant="ghost" onClick={onEdit} title={t('Cambiar este mensaje y volver a mandarlo desde aquí')} data-action="edit">
                <Pencil size={12} /> {t('Editar')}
              </Button>
              <CopyBtn text={turn.content} />
            </div>
          ) : null}
        </div>
        <div className="w-6 h-6 rounded-md bg-[#1e2231] flex items-center justify-center shrink-0 mt-0.5">
          <User size={13} className="text-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className={cx('flex gap-3 rounded-xl transition-shadow duration-700', highlight && 'ring-1 ring-accent/60 ring-offset-4 ring-offset-void')} data-turn={turn.id}>
      <div
        className={cx(
          'w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 border',
          isCli ? 'bg-[#2a1f08] border-[#5c4413]' : 'bg-[#082a31] border-[#12525f]'
        )}
      >
        {isCli ? <Cpu size={13} className="text-warn" /> : <Bot size={13} className="text-accent" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[11px] text-dim num">{shortModel(turn.model ?? '')}</span>
          {turn.streaming ? <Dot tone="ok" pulse /> : null}
          {turn.metrics?.effort ? (
            <Badge tone="violet" title={t('Esfuerzo de razonamiento pedido')}>
              {t('chat.effortBadge', { level: t(EFFORT_LABEL[turn.metrics.effort]).toLowerCase() })}
            </Badge>
          ) : null}
          {turn.metrics?.branch ? (
            <Badge tone="neutral" title={t('Rama en la que se ejecutó')}>
              <GitBranch size={10} /> {turn.metrics.branch}
            </Badge>
          ) : null}
          <ContextGauge
            compact
            used={turn.streaming ? turn.live?.contextUsed : turn.metrics?.contextUsed}
            limit={turn.streaming ? turn.live?.contextLimit : turn.metrics?.contextLimit}
          />
          <UsageLimitView compact limit={turn.streaming ? turn.live?.usageLimit : turn.metrics?.usageLimit} />
          <div className="ml-auto flex items-center gap-1">
            {/* Si el turno cambió ficheros y hay foto de antes, se puede deshacer entero. */}
            {onReview && !turn.streaming && !turn.metrics?.undone ? (
              <Button size="sm" variant="ghost" onClick={onReview} title={t('Ver el diff de este turno y comentar líneas para el agente')}>
                <FileDiff size={12} /> {t('Revisar')}
              </Button>
            ) : null}
            {!turn.streaming && turn.runId && turn.metrics?.checkpoint && turn.metrics.filesChanged?.length ? (
              <UndoTurn
                runId={turn.runId}
                checkpoint={turn.metrics.checkpoint}
                undone={turn.metrics.undone}
                onUndone={(v) => markTurnUndone(sessionId, turn.id, v)}
              />
            ) : null}
            {onRegenerate ? (
              <Button size="sm" variant="ghost" onClick={onRegenerate} title={t('Volver a pedir esta respuesta')} data-action="regenerate">
                <RefreshCw size={12} />
              </Button>
            ) : null}
            {onFork ? (
              <Button size="sm" variant="ghost" onClick={onFork} title={t('Seguir desde aquí en una conversación nueva; esta se queda como está')} data-action="fork">
                <GitFork size={12} />
              </Button>
            ) : null}
            {!turn.streaming && turn.content ? <CopyBtn text={turn.content} /> : null}
          </div>
        </div>

        {turn.error ? (
          <div className="bg-[#1a1015] border border-[#4a2029] rounded-xl px-3.5 py-3 flex items-start gap-2.5">
            <AlertTriangle size={15} className="text-bad shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-bad text-[12.5px] font-medium mb-0.5">{t('No se pudo completar')}</div>
              <div className="text-[12px] text-muted break-words whitespace-pre-wrap">{turn.error}</div>
            </div>
          </div>
        ) : (
          <div className="bg-panel border border-line rounded-xl rounded-tl-sm px-3.5 py-3">
            {turn.reasoning ? (
              <details className="mb-2.5 group">
                <summary className="text-[11.5px] text-violet cursor-pointer list-none flex items-center gap-1.5">
                  <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                  {t('Razonamiento interno')}
                </summary>
                <div className="mt-2 text-[12px] text-muted whitespace-pre-wrap border-l-2 border-[#37275c] pl-3">
                  {turn.reasoning}
                </div>
              </details>
            ) : null}

            {/* Lo que va haciendo: herramientas, archivos y pensamientos. */}
            <AgentActivity
              steps={turn.steps}
              running={turn.streaming}
              onApprove={turn.runId ? (stepId, allow) => approveStep(turn.runId!, stepId, allow) : undefined}
            />

            {turn.content ? (
              // Los agentes que hablan por eventos (Claude Code, OpenCode)
              // contestan en markdown; los que sueltan texto plano se dejan
              // tal cual, que ahí un markdown mal interpretado estorba.
              isCli && !turn.steps?.length ? (
                <pre className="font-mono text-[12px] whitespace-pre-wrap break-words leading-[1.55] text-muted m-0">
                  {turn.content}
                </pre>
              ) : (
                <Markdown>{turn.content}</Markdown>
              )
            ) : turn.streaming ? (
              <span className="caret text-dim text-[12.5px]">
                {turn.steps?.length ? t('trabajando') : t('generando')}
              </span>
            ) : (
              <span className="text-dim text-[12.5px]">({t('respuesta vacía')})</span>
            )}

            {/* Qué archivos ha tocado: se va actualizando mientras trabaja. */}
            <FileWork
              dense
              files={turn.files ?? turn.metrics?.filesChanged}
              touched={turn.touched ?? turn.metrics?.filesTouched}
            />

            {/* Lo que no pudo hacer por falta de permiso: suele ser por qué se quedó a medias. */}
            {!turn.streaming && denied.length ? (
              <div className="mt-2.5 bg-[#241a09] border border-[#4a3512] rounded-lg px-3 py-2.5 space-y-2" data-denied>
                <div className="flex items-center gap-1.5 text-[12px] text-warn font-medium">
                  <AlertTriangle size={13} /> {t('Le faltó permiso para:')}
                </div>
                <ul className="text-[11.5px] font-mono text-muted space-y-0.5 break-all">
                  {denied.map((s) => (
                    <li key={s.id}>{[s.tool, s.target].filter(Boolean).join(' ')}</li>
                  ))}
                </ul>
                {onAllow && rules.length ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" onClick={() => onAllow(rules)}>
                      <Check size={12} /> {t('Permitir eso y seguir')}
                    </Button>
                    <span className="text-[11px] text-dim">{t('Sólo eso, y sólo en el turno siguiente: tus permisos no cambian.')}</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-dim">{t('Cambia sus permisos en el panel de la derecha y vuelve a pedírselo.')}</p>
                )}
              </div>
            ) : null}

            {/* Métricas: en vivo mientras genera, definitivas al acabar. */}
            {turn.streaming && turn.live ? (
              <LiveMetrics live={turn.live} />
            ) : turn.metrics ? (
              <Metrics m={turn.metrics} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Página                                                             *
 * ------------------------------------------------------------------ */

export default function Chat(): React.JSX.Element {
  const t = useT()
  const { config, models, toast } = useStore()
  const sessions = useSessions()
  const [activeId, setActiveId] = useState<string | null>(null)
  const chat = useChat(activeId)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const [showArchived, setShowArchived] = useState(false)
  const [renaming, setRenaming] = useState<StoredSession | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<StoredSession | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [review, setReview] = useState<{ runId: string; checkpoint: RunCheckpoint; untilRunId?: string } | null>(null)
  const [rewind, setRewind] = useState<{ turnId: string; mode: 'edit' | 'regenerate' } | null>(null)

  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const session = chat?.session
  const turns = chat?.turns ?? []
  const running = Boolean(chat?.runningRunId)
  const isCli = session?.kind === 'cli'

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions.filter((s) => {
      if (Boolean(s.archived) !== showArchived) return false
      if (!q) return true
      return s.title.toLowerCase().includes(q) || (s.turns ?? []).some((t) => t.content.toLowerCase().includes(q))
    })
  }, [sessions, query, showArchived])

  // Otra parte de la app (el relevo, la paleta) pide abrir una conversación.
  const focusReq = useChatFocus()
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!focusReq) return
    setActiveId(focusReq.id)
    // Una cerrada se enseña en su lista: si no, no se ve cuál está abierta.
    setShowArchived(Boolean(sessionsRef.current.find((s) => s.id === focusReq.id)?.archived))
    void openSession(focusReq.id)
    stick.current = !focusReq.turnId
    setFlash(focusReq.turnId ?? null)
  }, [focusReq])

  // Ir a un mensaje (desde la búsqueda): se centra y se marca un momento.
  useEffect(() => {
    if (!flash) return
    const el = scroller.current?.querySelector(`[data-turn="${CSS.escape(flash)}"]`)
    if (!el) return
    stick.current = false
    el.scrollIntoView({ block: 'center' })
    const timer = window.setTimeout(() => setFlash(null), 2600)
    return () => window.clearTimeout(timer)
  }, [flash, turns])

  // Al entrar: se abre la última conversación viva, o se crea una.
  useEffect(() => {
    if (activeId) return
    const first = sessions.find((s) => !s.archived)
    if (first) {
      setActiveId(first.id)
      void openSession(first.id)
    } else if (sessions.length === 0) {
      void newSession('chat').then(setActiveId)
    }
  }, [sessions, activeId])

  // Autoscroll pegado al final salvo que hayas subido a leer.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  const open = useCallback(async (id: string) => {
    setActiveId(id)
    await openSession(id)
    stick.current = true
  }, [])

  const create = useCallback(
    async (kind: 'chat' | 'cli') => {
      const pickDefault = models.find((m) => m.local) ?? models[0]
      const id = await newSession(kind, {
        providerId: kind === 'chat' ? pickDefault?.providerId : undefined,
        model: kind === 'chat' ? pickDefault?.id : undefined,
        title: kind === 'cli' ? t('Sesión de agente') : t('Conversación nueva')
      })
      setActiveId(id)
      setShowArchived(false)
      stick.current = true
    },
    [models]
  )

  const pick: Pick | null = useMemo(
    () => (session?.providerId && session?.model ? { providerId: session.providerId, model: session.model } : null),
    [session?.providerId, session?.model]
  )

  const project = config?.projects.find((p) => p.id === session?.projectId)
  const apiAgent = config?.agents.find((a) => a.id === session?.agentId)
  const cliAgent = config?.cliAgents.find((a) => a.id === session?.cliAgentId)

  // Rama y estado del repositorio del proyecto de la sesión.
  // Con worktree, el agente trabaja allí: la carpeta, la rama y el estado de git son los suyos.
  const workPath = project ? (session?.worktreePath ?? project.path) : undefined
  const { info: git, reload: reloadGit } = useGit(workPath)

  // El esfuerzo se guarda en la sesión: al reabrirla sigue como lo dejaste.
  const effort: Effort = session?.effort ?? 'auto'
  // Un agente trabaja siempre como agente: en el proyecto o, sin él, en su
  // propia carpeta. Un modelo suelto lo hace si hay proyecto, salvo que lo apagues.
  const agentOn = !isCli && (Boolean(apiAgent) || (Boolean(project) && session?.agentMode !== false))
  // Sin proyecto, la carpeta donde trabaja: se enseña para poder abrirla.
  const [workspace, setWorkspace] = useState<string>()
  useEffect(() => {
    if (!agentOn || project) return
    void window.api.agents.workspace(apiAgent?.id).then((r) => setWorkspace(r.ok ? r.data : undefined))
  }, [agentOn, project, apiAgent?.id])
  // OpenCode deja elegir proveedor y modelo, y el esfuerzo depende del modelo.
  const isOc = Boolean(isCli && cliAgent && isOpencodeCommand(cliAgent.command))
  const oc = useOpencodeModels(isOc)
  const ocVariants = oc.models.find((m) => m.id === session?.cliModel)?.variants ?? []
  const effortSupported =
    !isCli || (cliAgent ? (isOc ? ocVariants.length > 0 : EFFORT_CLIS.has(cliAgent.command.toLowerCase())) : false)

  // Al cambiar de conversación los adjuntos no se arrastran.
  useEffect(() => {
    setAttachments([])
  }, [activeId])

  // Con `override` se manda ese texto en vez de lo escrito (la revisión de un
  // diff): lo que tengas a medias en la caja y sus adjuntos se quedan.
  const send = useCallback(async (override?: string) => {
    const text = override ?? input
    if (!text.trim() || !session || running || !config) return
    const files = override === undefined && attachments.length ? attachments : undefined
    const r = await sendTurn(session.id, text.trim(), config, {
      attachments: files,
      onStart: () => {
        stick.current = true
        if (override !== undefined) return
        setInput('')
        setAttachments([])
      }
    })
    if (r.error) {
      toast('error', t(r.error))
      return
    }
    if (r.run?.status === 'error') toast('error', r.run.error ?? (isCli ? t('El agente falló') : 'Error desconocido'))
    // Un agente puede haber cambiado de rama o dejado el árbol sucio.
    if (project) reloadGit()
  }, [input, session, running, isCli, project, config, toast, attachments, reloadGit, t])

  // Claude Code se quedó a medias por un permiso: seguir dándole sólo ese.
  const isClaudeCli =
    isCli && (cliAgent?.command ?? '').toLowerCase().split(/[\\/]/).pop()!.replace(/\.(cmd|exe)$/, '') === 'claude'
  const allowAndContinue = useCallback(
    (rules: string[]) => {
      if (!session || !config) return
      void sendTurn(session.id, t('Ya tienes permiso para lo que te faltaba. Sigue donde lo dejaste.'), config, {
        allowTools: rules,
        onStart: () => {
          stick.current = true
        }
      }).then((r) => {
        if (r.error) toast('error', t(r.error))
        reloadGit()
      })
    },
    [session, config, t, toast, reloadGit]
  )

  // Regenerar la última respuesta de un chat que no tocó archivos va directo;
  // si hay algo más que decidir (turnos detrás, archivos, un CLI), se pregunta.
  const regenerate = useCallback(
    (turnId: string) => {
      if (!session || !config) return
      const plan = planRewind(session.id, turnId)
      if (!plan) return
      if (plan.dropped > 2 || plan.checkpoints.length || plan.isCli) {
        setRewind({ turnId, mode: 'regenerate' })
        return
      }
      void rewindAndSend(session.id, turnId, plan.prompt, config, {
        onStart: () => {
          stick.current = true
        }
      }).then((r) => {
        if (r.error) toast('error', t(r.error))
        else if (r.run?.status === 'error') toast('error', r.run.error ?? t('No se pudo completar'))
      })
    },
    [session, config, toast, t]
  )

  const fork = useCallback(
    async (turnId: string) => {
      if (!session || !config) return
      const id = await forkAt(session.id, turnId, t('{title} (bifurcada)', { title: session.title }), config)
      if (!id) return
      setActiveId(id)
      setShowArchived(false)
      stick.current = true
      toast('ok', t('Conversación bifurcada: sigue desde aquí; la original se queda como estaba.'))
    },
    [session, config, toast, t]
  )

  // Un agente de API fija modelo, prompt de sistema y parámetros de golpe.
  const applyAgent = (agentId: string): void => {
    if (!session) return
    const a = config?.agents.find((x) => x.id === agentId)
    if (!a) {
      patchSessionConfig(session.id, { agentId: undefined })
      return
    }
    patchSessionConfig(session.id, {
      agentId: a.id,
      providerId: a.providerId,
      model: a.model,
      systemPrompt: a.systemPrompt,
      temperature: a.temperature,
      maxTokens: a.maxTokens,
      effort: a.effort ?? session.effort,
      permissionMode: a.permissionMode ?? session.permissionMode
    })
  }

  const [relayOpen, setRelayOpen] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const relaySource = useMemo(() => (session ? { kind: 'session' as const, id: session.id } : null), [session?.id])
  const lastAssistant = [...turns].reverse().find((x) => x.role === 'assistant')
  const limited = !running && Boolean(lastAssistant && endedByLimit(lastAssistant))

  // Si se ha quedado sin cupo, a quién pasárselo: al agente de consola con más
  // margen según los cupos de todas las IAs (nunca al mismo).
  const quotaReport = useQuotas()
  const relayPick = useMemo(() => {
    if (!limited || !quotaReport) return null
    const candidates = (config?.cliAgents ?? []).map((a) => ({ id: a.id, name: a.name, command: a.command }))
    return pickRelayAgent(quotaReport.quotas, candidates, { command: cliAgent?.command, agentId: cliAgent?.id })
  }, [limited, quotaReport, config?.cliAgents, cliAgent?.command, cliAgent?.id])

  const totalCost = turns.reduce((s, t) => s + (t.metrics?.costTotal ?? 0), 0)
  const totalTok = turns.reduce((s, t) => s + (t.metrics?.totalTokens ?? 0), 0)
  const liveTurn = turns.find((t) => t.streaming && t.live)

  // Contexto y límites: los del último turno que los informó. No se suman
  // entre turnos porque cada petición lleva la conversación entera dentro.
  const lastWithCtx = [...turns].reverse().find((t) => t.live?.contextUsed ?? t.metrics?.contextUsed)
  const contextUsed = lastWithCtx?.live?.contextUsed ?? lastWithCtx?.metrics?.contextUsed
  const lastWithLimit = [...turns].reverse().find((t) => t.live?.contextLimit ?? t.metrics?.contextLimit)
  const contextLimit = lastWithLimit?.live?.contextLimit ?? lastWithLimit?.metrics?.contextLimit
  const lastUsage = [...turns].reverse().find((t) => t.live?.usageLimit ?? t.metrics?.usageLimit)
  const lastLimit = lastUsage?.live?.usageLimit ?? lastUsage?.metrics?.usageLimit

  return (
    <div className="h-full flex">
      {/* ------------------------------------------------ Sesiones */}
      <Pane paneKey="chat.sessions" side="right" className="border-r border-line bg-void flex flex-col">
        <div className="px-2.5 pt-2.5 pb-2 space-y-2 shrink-0">
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" className="flex-1 justify-center" onClick={() => void create('chat')}>
              <Plus size={12} /> Chat
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void create('cli')}
              title={t('Sesión con un agente de línea de comandos')}
            >
              <TerminalIcon size={12} /> {t('Agente')}
            </Button>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) openSearch(query)
              }}
              title={t('Filtra la lista. Enter busca en todos los mensajes y en el histórico.')}
              placeholder={t('Buscar…')}
              className="w-full h-7 pl-7 pr-2 bg-raised border border-line rounded-md text-[12px] outline-none focus:border-[#2c3346] placeholder:text-[#3a4255]"
            />
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <button
              onClick={() => setShowArchived(false)}
              className={cx('px-2 h-6 rounded-md', !showArchived ? 'bg-raised text-ink' : 'text-dim hover:text-ink')}
            >
              {t('Abiertas')}
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={cx('px-2 h-6 rounded-md', showArchived ? 'bg-raised text-ink' : 'text-dim hover:text-ink')}
            >
              {t('Cerradas')}
              <span className="num ml-1 text-dim">{sessions.filter((s) => s.archived).length}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pb-2 space-y-0.5">
          {visible.length === 0 ? (
            <div className="px-3 py-6 text-[11.5px] text-dim text-center leading-relaxed">
              {showArchived ? t('No has cerrado ninguna sesión todavía.') : t('Ninguna conversación abierta.')}
            </div>
          ) : (
            visible.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === activeId}
                running={s.id === activeId && running}
                onOpen={() => void open(s.id)}
                onRename={() => {
                  setRenaming(s)
                  setRenameText(s.title)
                }}
                onArchive={() => {
                  void archiveSession(s.id).then(() => {
                    if (s.id === activeId) setActiveId(null)
                  })
                }}
                onUnarchive={() => void unarchiveSession(s.id)}
                onDelete={() => setConfirmDelete(s)}
                onPin={() => patchSessionConfig(s.id, { pinned: !s.pinned })}
              />
            ))
          )}
        </div>
      </Pane>

      {/* ------------------------------------------------ Conversación */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Cabecera en dos franjas: arriba lo fijo de la sesión y, debajo y
            sólo mientras genera, las métricas en vivo. Antes iba todo en una
            fila y al arrancar un agente las métricas empujaban hasta montarse
            encima del título, del proyecto y de la rama. */}
        <div className="border-b border-line shrink-0 bg-void">
          {/* Cuando falta sitio lo primero que cede es el título (se lee
              entero al pasar el ratón); proyecto y rama aguantan, y a la
              derecha los tokens se esconden y queda el coste. */}
          <div className="@container h-12 px-5 flex items-center gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {isCli ? <Cpu size={15} className="text-warn shrink-0" /> : <Sparkles size={15} className="text-accent shrink-0" />}
              <span className="font-medium truncate min-w-[48px] shrink-[20]" title={session?.title}>
                {session?.title ?? 'Consola'}
              </span>
              {agentOn ? (
                <Badge
                  tone="accent"
                  className="shrink-0"
                  title={t('Lee, busca y edita los archivos del proyecto con herramientas, y ejecuta comandos si le dejas.')}
                >
                  <Bot size={10} /> <span className="@max-[32rem]:hidden">{t('agente')}</span>
                </Badge>
              ) : null}
              {project ? (
                <Badge tone="violet" className="min-w-[64px] max-w-[180px] @max-[26rem]:hidden" title={project.path}>
                  <FolderGit2 size={10} className="shrink-0" />
                  <span className="truncate">{project.name}</span>
                </Badge>
              ) : null}
              <div className="shrink-0">
                <BranchPicker
                  path={project?.path}
                  info={git}
                  onChanged={() => {
                    reloadGit()
                    toast('ok', t('Rama cambiada'))
                  }}
                  onError={(m) => toast('error', m)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
              {totalTok > 0 ? (
                <span className="num text-[11.5px] text-dim" title={`${tokens(totalTok)} tokens · ${cost(totalCost)}`}>
                  <span className="@max-[44rem]:hidden">{tokens(totalTok)} tokens · </span>
                  {cost(totalCost)}
                </span>
              ) : null}
              <ContextGauge compact used={contextUsed} limit={contextLimit} />
              <UsageLimitView compact limit={lastLimit} />
              {session && turns.length > 0 && !running ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRelayOpen(true)}
                  title={t('Pasar este trabajo a otra IA con todo su contexto')}
                >
                  <ArrowRightLeft size={12} /> <span className="@max-[40rem]:hidden">{t('Relevo')}</span>
                </Button>
              ) : null}
            </div>
          </div>

          {/* Las métricas en vivo también aquí arriba: se ven aunque hayas
              subido a leer un mensaje anterior. */}
          {liveTurn?.live ? (
            <div className="h-7 px-5 border-t border-line-soft flex items-center gap-3 overflow-hidden">
              <span className="flex items-center gap-1.5 text-[11px] text-ok shrink-0">
                <Dot tone="ok" pulse /> {liveTurn.steps?.length ? t('trabajando') : t('generando')}
              </span>
              <LiveMetrics live={liveTurn.live} compact className="min-w-0" />
            </div>
          ) : null}
        </div>

        <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-5 py-5">
          <div className="max-w-[860px] mx-auto space-y-5">
            {turns.length === 0 ? (
              <Empty
                icon={isCli ? <Cpu size={30} /> : <Sparkles size={30} />}
                title={isCli ? t('Lanza un agente en un proyecto') : t('Lanza un prompt')}
                hint={
                  isCli
                    ? t('Elige el agente y el proyecto a la derecha. La app recoge sus tokens, su tiempo y su coste real cuando el agente los informa.')
                    : models.length === 0
                      ? t('Aún no hay modelos disponibles. Añade una API key en Ajustes o arranca Ollama; la app lo detecta solo.')
                      : withMod(t('Elige modelo a la derecha, escribe abajo y pulsa Ctrl+Enter. Verás sus métricas mientras responde.'))
                }
              />
            ) : null}
            {turns.map((t, i) => {
              const ck = t.metrics?.checkpoint
              // El diff de un turno llega hasta la foto del siguiente del mismo repositorio (o hasta ahora).
              const next = ck
                ? turns.slice(i + 1).find((n) => n.runId && n.metrics?.checkpoint?.root === ck.root)
                : undefined
              return (
                <TurnView
                  key={t.id}
                  turn={t}
                  isCli={isCli}
                  sessionId={session?.id ?? ''}
                  onReview={
                    ck && t.runId && t.metrics?.filesChanged?.length
                      ? () => setReview({ runId: t.runId!, checkpoint: ck, untilRunId: next?.runId })
                      : undefined
                  }
                  onAllow={i === turns.length - 1 && !running && isClaudeCli ? allowAndContinue : undefined}
                  onEdit={!running && t.role === 'user' ? () => setRewind({ turnId: t.id, mode: 'edit' }) : undefined}
                  onRegenerate={!running && t.role === 'assistant' && i > 0 ? () => regenerate(t.id) : undefined}
                  onFork={!running && t.role === 'assistant' && !t.streaming ? () => void fork(t.id) : undefined}
                  highlight={flash === t.id}
                />
              )
            })}
            {/* Si el último turno se cortó por un cupo o un límite, se ofrece
                seguir con otra IA sin tener que ir a buscarlo. */}
            {limited ? (
              <div className="rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 flex items-center gap-3">
                <AlertTriangle size={15} className="text-warn shrink-0" />
                <span className="text-[12.5px] flex-1 leading-relaxed">
                  {t('Parece que se ha agotado un cupo o un límite. Puedes seguir con otra IA sin perder lo hecho.')}
                  {relayPick ? (
                    <span className="block text-[11.5px] text-dim mt-0.5">
                      {relayPick.left != null && relayPick.where
                        ? t('Con más margen: {name} (le queda un {n} % en {where}).', {
                            name: relayPick.agent.name,
                            n: relayPick.left,
                            where: relayPick.where
                          })
                        : t('Con más margen: {name} (no tiene ningún cupo conocido agotado).', { name: relayPick.agent.name })}
                    </span>
                  ) : null}
                </span>
                <Button size="sm" variant="primary" onClick={() => setRelayOpen(true)}>
                  <ArrowRightLeft size={12} />{' '}
                  {relayPick ? t('Seguir con {name}', { name: relayPick.agent.name }) : t('Seguir con otra IA')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Entrada */}
        <div className="px-5 py-3.5 border-t border-line bg-void shrink-0">
          <div className="max-w-[860px] mx-auto">
            <div className="relative">
              <PromptTextarea
                value={input}
                onValue={setInput}
                context={{ project: project?.name, branch: git?.branch }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={
                  isCli
                    ? cliAgent
                      ? t('chat.instructionFor', { name: cliAgent.name })
                      : t('Elige un agente a la derecha…')
                    : pick
                      ? t('chat.promptFor', { model: shortModel(pick.model) })
                      : t('Elige un modelo primero…')
                }
                rows={3}
                className="pr-24 text-[13px] leading-relaxed"
                disabled={!session}
              />
              <div className="absolute right-2.5 bottom-2.5 flex items-center gap-2">
                {running ? (
                  <Button size="sm" variant="danger" onClick={() => session && stopSession(session.id)}>
                    <Square size={12} /> {t('Parar')}
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => void send()} disabled={!input.trim() || !session}>
                    <Send size={12} /> {t('Enviar')}
                  </Button>
                )}
              </div>
            </div>
            <AttachmentList
              items={attachments}
              onRemove={(path) => setAttachments((list) => list.filter((a) => a.path !== path))}
            />

            <div className="flex items-center justify-between gap-3 mt-1.5 text-[11px] text-dim flex-wrap">
              <div className="flex items-center gap-2">
                <AttachButton
                  onAdd={(added) =>
                    setAttachments((list) => {
                      const seen = new Set(list.map((a) => a.path))
                      return [...list, ...added.filter((a) => !seen.has(a.path))]
                    })
                  }
                />
                <SavePromptButton text={input} />
                <span className="text-dim">{t('Esfuerzo')}</span>
                <EffortPicker
                  value={effort}
                  supported={effortSupported}
                  hint={
                    isOc
                      ? opencodeEffortHint(session?.cliModel, ocVariants, t)
                      : effortSupported
                        ? t('Automático deja la petición como la manda el proveedor por omisión')
                        : t('chat.noEffort', { agent: cliAgent?.command ?? t('este agente') })
                  }
                  onChange={(e) => session && patchSessionConfig(session.id, { effort: e })}
                />
                {!isCli && session ? (
                  <button
                    className="inline-flex items-center gap-1 text-dim hover:text-accent transition-colors"
                    onClick={() => setRecommending(true)}
                    title={t('Qué modelo conviene para lo que estás escribiendo')}
                  >
                    <Lightbulb size={12} /> {t('¿Qué modelo?')}
                  </button>
                ) : null}
              </div>
              <span className="num">{t('common.chars', { n: input.length })}</span>
            </div>
            <div className="mt-1 text-[11px] text-dim">
              {withMod(t('Ctrl + Enter para enviar · / para la biblioteca de prompts · la respuesta sigue llegando si cambias de pantalla'))}
            </div>
          </div>
        </div>
      </div>

      {rewind && session ? (
        <RewindModal
          key={rewind.turnId + rewind.mode}
          sessionId={session.id}
          turnId={rewind.turnId}
          mode={rewind.mode}
          title={session.title}
          onClose={() => setRewind(null)}
          onStarted={(id) => {
            setRewind(null)
            stick.current = true
            if (id !== session.id) {
              setActiveId(id)
              setShowArchived(false)
            }
          }}
        />
      ) : null}

      <Modal open={recommending} onClose={() => setRecommending(false)} title={t('¿Qué modelo uso?')} width="max-w-4xl">
        {recommending && session ? (
          <Recommender
            compact
            initialText={input}
            projectId={session.projectId}
            onUse={(m) => {
              patchSessionConfig(session.id, { providerId: m.providerId, model: m.id, agentId: undefined })
              setRecommending(false)
              toast('ok', t('La conversación sigue con {model}', { model: shortModel(m.id) }))
            }}
          />
        ) : null}
      </Modal>

      <RelayModal
        source={relaySource}
        open={relayOpen}
        onClose={() => setRelayOpen(false)}
        suggestAgentId={relayPick?.agent.id}
      />

      {review ? (
        <DiffReview
          open
          onClose={() => setReview(null)}
          runId={review.runId}
          checkpoint={review.checkpoint}
          untilRunId={review.untilRunId}
          disabled={running}
          onSend={(prompt) => {
            setReview(null)
            void send(prompt)
          }}
        />
      ) : null}

      {/* ------------------------------------------------ Ajustes de la sesión */}
      <Pane paneKey="chat.detail" side="left" className="border-l border-line bg-void overflow-y-auto">
        {!session ? (
          <div className="p-4 text-[12px] text-dim">{t('Crea o abre una conversación.')}</div>
        ) : (
          <div className="p-4 space-y-4">
            {isCli ? (
              <>
              <Field label={t('Agente de línea de comandos')} hint={t('Se ejecuta dentro del proyecto elegido')}>
                <Select
                  value={session.cliAgentId ?? ''}
                  onChange={(e) =>
                    // El modelo de un agente no vale para otro.
                    patchSessionConfig(session.id, {
                      cliAgentId: e.target.value || undefined,
                      cliModel: undefined,
                      cliSessionId: undefined,
                      cliSessionAgentId: undefined,
                      cliForkNext: false
                    })
                  }
                >
                  <option value="">{t('Elige un agente…')}</option>
                  {(config?.cliAgents ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.command})
                    </option>
                  ))}
                </Select>
                {(config?.cliAgents ?? []).length === 0 ? (
                  <p className="text-[11.5px] text-warn mt-1.5 leading-relaxed">
                    {t('No tienes ninguno dado de alta. Ve a Agentes y pulsa «Importar los detectados».')}
                  </p>
                ) : null}
              </Field>

              {/* --------------------------- Modelo del agente de CLI */}
              {cliAgent ? (
                isOc ? (
                  <Field
                    label={t('Modelo')}
                    hint={t('De OpenCode Zen o de tu Ollama; los locales van siempre con su contexto máximo')}
                  >
                    <OpencodeModelPicker
                      value={session.cliModel}
                      onChange={(id) => patchSessionConfig(session.id, { cliModel: id })}
                      models={oc.models}
                      loading={oc.loading}
                      onRefresh={oc.refresh}
                    />
                  </Field>
                ) : MODEL_CLIS.has(cliAgent.command.toLowerCase()) ? (
                  <Field label={t('Modelo')} hint={t('chat.passedTo', { command: cliAgent.command })}>
                    {CLI_MODELS[cliAgent.command.toLowerCase()] ? (
                      <Select
                        value={session.cliModel ?? ''}
                        onChange={(e) =>
                          patchSessionConfig(session.id, { cliModel: e.target.value || undefined })
                        }
                      >
                        <option value="">{t('El que use por omisión')}</option>
                        {CLI_MODELS[cliAgent.command.toLowerCase()].map((m) => (
                          <option key={m.id} value={m.id}>
                            {t(m.label)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        value={session.cliModel ?? ''}
                        onChange={(e) =>
                          patchSessionConfig(session.id, { cliModel: e.target.value || undefined })
                        }
                        placeholder={t('por omisión')}
                        className="h-8 num text-[12.5px]"
                      />
                    )}
                  </Field>
                ) : (
                  <p className="text-[11px] text-dim leading-relaxed">
                    {cliAgent.command} no deja elegir el modelo desde la línea de comandos: usa el que tenga
                    configurado.
                  </p>
                )
              ) : null}

              {/* ------------------------ Seguir en la misma sesión */}
              {cliAgent ? <CliContinuity session={session} command={cliAgent.command} /> : null}

              {/* ----------------------------- Hasta dónde puede llegar */}
              {cliAgent && cliAgent.command.toLowerCase() === 'claude' ? (
                <Field label={t('Permisos')}>
                  <Select
                    value={session.permissionMode ?? 'acceptEdits'}
                    onChange={(e) => patchSessionConfig(session.id, { permissionMode: e.target.value })}
                  >
                    {PERMISSION_MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {t(m.label)}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[11px] text-dim mt-1.5 leading-relaxed">
                    {t(PERMISSION_MODES.find((m) => m.id === (session.permissionMode ?? 'acceptEdits'))?.hint ?? '')}
                  </p>
                </Field>
              ) : null}
              </>
            ) : (
              <>
                <Field label={t('Modelo')}>
                  <ModelPicker
                    value={pick}
                    onChange={(p) =>
                      patchSessionConfig(session.id, { providerId: p?.providerId, model: p?.model })
                    }
                  />
                </Field>

                <Field label={t('Agente')} hint={t('Trabaja siempre como agente: con herramientas y hasta acabar la tarea')}>
                  <Select value={session.agentId ?? ''} onChange={(e) => applyAgent(e.target.value)}>
                    <option value="">{t('Sin agente')}</option>
                    {(config?.agents ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}

            <Field
              label={t('Proyecto')}
              hint={project && !isCli ? t('Su estructura y su README entran en el contexto') : undefined}
            >
              <Select
                value={session.projectId ?? ''}
                onChange={(e) => patchSessionConfig(session.id, { projectId: e.target.value || undefined })}
              >
                <option value="">{t('Sin proyecto')}</option>
                {(config?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>

            {project && (isCli || agentOn) ? <WorktreeBox session={session} project={project} onChanged={reloadGit} /> : null}

            {/* Con proyecto, un modelo por API trabaja como agente: lee, busca y
                edita sus archivos. Se puede apagar para sólo conversar. */}
            {!isCli ? (
              project ? (
                <div className="border border-line rounded-lg p-3 space-y-2.5">
                  {apiAgent ? (
                    <div className="text-[12px] font-medium flex items-center gap-1.5">
                      <Bot size={12} className="text-accent" /> {t('Trabaja como agente')}
                    </div>
                  ) : (
                    <Toggle
                      checked={agentOn}
                      onChange={(v) => patchSessionConfig(session.id, { agentMode: v })}
                      label={t('Modo agente')}
                    />
                  )}
                  <p className="text-[11px] text-dim leading-relaxed">
                    {agentOn
                      ? t('Lee, busca y edita los archivos del proyecto con herramientas, y ejecuta comandos si le dejas.') +
                        ' ' +
                        t('Hace falta un modelo que admita herramientas (llamadas a funciones).')
                      : t('Sólo conversa: no puede abrir ni tocar los archivos del proyecto.')}
                  </p>
                  {agentOn ? (
                    <Field label={t('Permisos')}>
                      <Select
                        value={API_PERMISSION_MODES.find((m) => m.id === session.permissionMode)?.id ?? 'acceptEdits'}
                        onChange={(e) => patchSessionConfig(session.id, { permissionMode: e.target.value })}
                      >
                        {API_PERMISSION_MODES.map((m) => (
                          <option key={m.id} value={m.id}>
                            {t(m.label)}
                          </option>
                        ))}
                      </Select>
                      <p className="text-[11px] text-dim mt-1.5 leading-relaxed">
                        {t(
                          (API_PERMISSION_MODES.find((m) => m.id === session.permissionMode) ?? API_PERMISSION_MODES[0])
                            .hint
                        )}
                      </p>
                    </Field>
                  ) : null}
                  <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={session.includeContext ?? true}
                      onChange={(e) => patchSessionConfig(session.id, { includeContext: e.target.checked })}
                      className="accent-cyan-400"
                    />
                    {t('Adjuntar contexto del proyecto')}
                  </label>
                </div>
              ) : agentOn ? (
                <div className="border border-line rounded-lg p-3 space-y-2.5">
                  <div className="text-[12px] font-medium flex items-center gap-1.5">
                    <Bot size={12} className="text-accent" /> {t('Trabaja como agente')}
                  </div>
                  <p className="text-[11px] text-dim leading-relaxed">
                    {t('Sin proyecto trabaja en su propia carpeta: ahí crea, lee y edita archivos y ejecuta comandos.')}
                  </p>
                  {workspace ? (
                    <button
                      type="button"
                      onClick={() => void window.api.projects.openFolder(workspace)}
                      title={t('Abrir la carpeta')}
                      className="w-full flex items-center gap-1.5 text-[11px] font-mono text-muted hover:text-ink text-left"
                    >
                      <FolderOpen size={11} className="shrink-0" />
                      <span className="truncate">{workspace}</span>
                    </button>
                  ) : null}
                  <Field label={t('Permisos')}>
                    <Select
                      value={API_PERMISSION_MODES.find((m) => m.id === session.permissionMode)?.id ?? 'acceptEdits'}
                      onChange={(e) => patchSessionConfig(session.id, { permissionMode: e.target.value })}
                    >
                      {API_PERMISSION_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {t(m.label)}
                        </option>
                      ))}
                    </Select>
                    <p className="text-[11px] text-dim mt-1.5 leading-relaxed">
                      {t(
                        (API_PERMISSION_MODES.find((m) => m.id === session.permissionMode) ?? API_PERMISSION_MODES[0])
                          .hint
                      )}
                    </p>
                  </Field>
                </div>
              ) : (
                <p className="text-[11px] text-dim leading-relaxed">
                  {t('Elige un proyecto, o un agente, para que el modelo trabaje con herramientas.')}
                </p>
              )
            ) : null}

            {/* La temperatura y el máximo de tokens ya no se tocan desde aquí:
                cada sesión sale con lo de siempre y punto. El prompt de sistema
                sí se queda, que es lo único que se escribe a mano. */}
            {!isCli ? (
              <div className="border-t border-line pt-3">
                <Field label={t('Prompt de sistema')} hint={t('Instrucciones que van en todos los mensajes')}>
                  <Textarea
                    value={session.systemPrompt ?? ''}
                    onChange={(e) => patchSessionConfig(session.id, { systemPrompt: e.target.value })}
                    rows={5}
                    placeholder={t('Instrucciones permanentes para el modelo…')}
                    className="text-[12px] leading-relaxed"
                  />
                </Field>
              </div>
            ) : null}

            {/* Cuánto contexto llevas gastado y cuánto te queda del plan. */}
            <UsagePanel
              providerId={isCli ? (session.cliAgentId ? 'cli:' + session.cliAgentId : undefined) : pick?.providerId}
              model={isCli ? cliAgent?.name : pick?.model}
              contextUsed={contextUsed}
              contextLimit={contextLimit}
              usageLimit={lastLimit}
            />

            {turns.some((t) => t.metrics) ? (
              <Panel className="overflow-hidden">
                <PanelHeader title={t('Esta sesión')} />
                <div className="p-3 space-y-2 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-dim">{t('Turnos')}</span>
                    <span className="num">{turns.filter((t) => t.role === 'assistant').length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dim">Tokens</span>
                    <span className="num">{tokens(totalTok)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dim">{t('Coste')}</span>
                    <span className="num text-accent">{cost(totalCost)}</span>
                  </div>
                </div>
              </Panel>
            ) : null}

            <div className="border-t border-line pt-3 flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 justify-center"
                onClick={() => {
                  void archiveSession(session.id).then(() => setActiveId(null))
                }}
              >
                <Archive size={12} /> {t('Cerrar')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(session)}>
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
        )}
      </Pane>

      {/* Renombrar */}
      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title={t('Renombrar la sesión')}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (renaming && renameText.trim()) patchSessionConfig(renaming.id, { title: renameText.trim() })
                setRenaming(null)
              }}
            >
              {t('Guardar')}
            </Button>
          </>
        }
      >
        <Field label={t('Nombre')}>
          <Input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renaming && renameText.trim()) {
                patchSessionConfig(renaming.id, { title: renameText.trim() })
                setRenaming(null)
              }
            }}
          />
        </Field>
      </Modal>

      {/* Borrar */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={t('Borrar la sesión')}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (!target) return
                void deleteSession(target.id).then(() => {
                  if (target.id === activeId) setActiveId(null)
                  void loadSessions()
                  toast('ok', t('Sesión borrada'))
                })
              }}
            >
              <Trash2 size={13} /> {t('Borrar')}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted leading-relaxed">
          {t('chat.deleteExplain', { title: confirmDelete?.title ?? '' })}
        </p>
        <p className="text-[12.5px] text-dim leading-relaxed mt-2">
          {t('Si sólo quieres quitarla de en medio, ciérrala con')} <X size={11} className="inline" /> {t('y seguirá disponible en «Cerradas».')}
        </p>
      </Modal>
    </div>
  )
}
