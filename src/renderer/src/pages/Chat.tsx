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
  ArchiveRestore, Search, Pencil, Terminal as TerminalIcon, Cpu, GitBranch, FolderOpen
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
  unarchiveSession, deleteSession, sendChat, sendCli, stopSession, loadSessions, approveStep,
  type Turn
} from '../lib/engine'
import {
  API_PERMISSION_MODES, PERMISSION_MODES, type Attachment, type Effort, type StoredSession
} from '@shared/types'
import { Pane } from '../components/Resizable'

import { useT } from '../lib/i18n'
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

function TurnView({ turn, isCli }: { turn: Turn; isCli: boolean }): React.JSX.Element {
  const t = useT()
  if (turn.role === 'user') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="bg-raised border border-line rounded-xl rounded-tr-sm px-3.5 py-2.5 max-w-[78%] space-y-2">
          <div className="whitespace-pre-wrap break-words text-[13px]">{turn.content}</div>
          <AttachmentList items={turn.attachments} readOnly />
        </div>
        <div className="w-6 h-6 rounded-md bg-[#1e2231] flex items-center justify-center shrink-0 mt-0.5">
          <User size={13} className="text-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
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
          <div className="ml-auto">{!turn.streaming && turn.content ? <CopyBtn text={turn.content} /> : null}</div>
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
  const [showArchived, setShowArchived] = useState(false)
  const [renaming, setRenaming] = useState<StoredSession | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<StoredSession | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])

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
  const { info: git, reload: reloadGit } = useGit(project?.path)

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

  const send = useCallback(async () => {
    if (!input.trim() || !session || running) return
    const prompt = input.trim()

    if (isCli) {
      if (!session.cliAgentId) {
        toast('error', t('Elige un agente de línea de comandos en el panel de la derecha'))
        return
      }
      if (!project) {
        toast('error', t('Un agente de línea de comandos necesita un proyecto donde trabajar'))
        return
      }
      setInput('')
      setAttachments([])
      stick.current = true
      const run = await sendCli(session.id, {
        prompt,
        agentId: session.cliAgentId,
        agentName: cliAgent?.name,
        model: session.cliModel,
        permissionMode: session.permissionMode,
        projectPath: project.path,
        projectId: project.id,
        projectName: project.name,
        effort,
        attachments: attachments.length ? attachments : undefined
      })
      if (run?.status === 'error') toast('error', run.error ?? t('El agente falló'))
      // Un agente puede haber cambiado de rama o dejado el árbol sucio.
      reloadGit()
      return
    }

    if (!pick) {
      toast('error', t('Elige un modelo primero'))
      return
    }

    // El contexto del proyecto se adjunta al prompt de sistema.
    let sys = session.systemPrompt ?? ''
    if (project && session.includeContext) {
      const ctx = await window.api.projects.context(project.path, { tree: true, readme: true })
      if (ctx.ok && ctx.data) {
        sys = [sys, `Trabajas sobre este proyecto del usuario:\n\n${ctx.data}`].filter(Boolean).join('\n\n')
      }
      if (project.systemPrompt) sys = [project.systemPrompt, sys].filter(Boolean).join('\n\n')
    }

    setInput('')
    setAttachments([])
    stick.current = true
    const run = await sendChat(session.id, {
      prompt,
      providerId: pick.providerId,
      model: pick.model,
      systemPrompt: sys || undefined,
      temperature: session.temperature,
      maxTokens: session.maxTokens,
      agentId: apiAgent?.id,
      agentName: apiAgent?.name,
      projectId: project?.id,
      projectName: project?.name,
      projectPath: project?.path,
      effort,
      attachments: attachments.length ? attachments : undefined,
      agentMode: agentOn,
      permissionMode: agentOn ? (session.permissionMode ?? 'acceptEdits') : undefined
    })
    if (run?.status === 'error') toast('error', run.error ?? 'Error desconocido')
    if (project) reloadGit()
  }, [input, session, running, isCli, pick, project, apiAgent, cliAgent, toast, effort, attachments, reloadGit, agentOn])

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
                      : t('Elige modelo a la derecha, escribe abajo y pulsa Ctrl+Enter. Verás sus métricas mientras responde.')
                }
              />
            ) : null}
            {turns.map((t) => (
              <TurnView key={t.id} turn={t} isCli={isCli} />
            ))}
          </div>
        </div>

        {/* Entrada */}
        <div className="px-5 py-3.5 border-t border-line bg-void shrink-0">
          <div className="max-w-[860px] mx-auto">
            <div className="relative">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
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
              </div>
              <span className="num">{t('common.chars', { n: input.length })}</span>
            </div>
            <div className="mt-1 text-[11px] text-dim">
              {t('Ctrl + Enter para enviar · la respuesta sigue llegando si cambias de pantalla')}
            </div>
          </div>
        </div>
      </div>

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
                    patchSessionConfig(session.id, { cliAgentId: e.target.value || undefined, cliModel: undefined })
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
