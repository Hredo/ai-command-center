import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderGit2, FolderPlus, Code2, FolderOpen, TerminalSquare, GitBranch, Trash2,
  Play, Square, Bot, Sparkles, FileCode2, Package, KeyRound, Terminal, ChevronRight,
  MessagesSquare, Download, ArchiveRestore, Archive
} from 'lucide-react'
import { Panel, PanelHeader, Button, Badge, Empty, Field, Select, Textarea, Input, cx, Dot, Tabs, Modal } from '../components/ui'
import { TerminalView } from '../components/Terminal'
import { FilesPanel } from '../components/FilesPanel'
import { GitPanel } from '../components/GitPanel'
import { GitGraph } from '../components/GitGraph'
import { AgentActivity } from '../components/AgentActivity'
import { GithubPanel } from '../components/GithubPanel'
import { Metrics, LiveMetrics } from '../components/Stats'
import {
  AttachButton, AttachmentList, BranchPicker, ContextGauge, EffortPicker,
  FileWork, UsageLimitView, useGit
} from '../components/AgentPanel'
import { useStore } from '../lib/store'
import { bytes, cost, ms, relTime, uid, colorFor } from '../lib/format'
import {
  openTerm, sendTermCommand, useTerms, useSessions, useChat, newSession, openSession,
  sendCli, stopSession, patchSessionConfig, useRunsVersion
} from '../lib/engine'
import { PERMISSION_MODES, type Attachment, type Effort, type Project, type ProjectInfo, type RunRecord } from '@shared/types'
import { Pane } from '../components/Resizable'

import { useT } from '../lib/i18n'
type Tab = 'overview' | 'files' | 'git' | 'graph' | 'terminal' | 'agent' | 'settings'

/**
 * Salida del agente, tomada de la sesión que vive en el motor. Así se sigue
 * viendo aunque hayas cambiado de pantalla mientras trabajaba.
 */
/** Los CLIs que aceptan un nivel de esfuerzo; lo traduce el proceso principal. */
const EFFORT_CLIS = new Set(['claude', 'codex', 'aider'])

/** Los que admiten elegir modelo y modo de permisos desde aquí. */
const CLAUDE_LIKE = new Set(['claude'])

function AgentOutput({ sessionId }: { sessionId: string | null }): React.JSX.Element {
  const t = useT()
  const chat = useChat(sessionId)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const turns = chat?.turns ?? []

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [turns])

  return (
    <div
      ref={ref}
      onScroll={() => {
        const el = ref.current
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
      className="flex-1 min-h-0 overflow-y-auto bg-[#07080c] border border-line rounded-lg p-3 font-mono text-[12px] leading-[1.6]"
    >
      {turns.length === 0 ? (
        <span className="text-dim">{t('La salida del agente aparecerá aquí.')}</span>
      ) : (
        turns.map((turn) =>
          turn.role === 'user' ? (
            <div key={turn.id} className="text-accent whitespace-pre-wrap break-words mt-3 first:mt-0">
              ❯ {turn.content}
            </div>
          ) : (
            <div key={turn.id} className="mt-1.5">
              {/* Lo que va haciendo, igual que en la Consola. */}
              <div className="font-sans">
                <AgentActivity steps={turn.steps} running={turn.streaming} />
              </div>
              {turn.reasoning ? (
                <details className="mb-1.5">
                  <summary className="text-[11.5px] text-violet cursor-pointer">
                    {t('Razonamiento del agente')}
                  </summary>
                  <div className="mt-1 text-[11.5px] text-dim whitespace-pre-wrap border-l-2 border-[#37275c] pl-2.5">
                    {turn.reasoning}
                  </div>
                </details>
              ) : null}
              {turn.error ? (
                <div className="text-bad whitespace-pre-wrap break-words">{turn.error}</div>
              ) : (
                <div className="text-muted whitespace-pre-wrap break-words">
                  {turn.content || (turn.streaming ? '' : t('(sin salida)'))}
                  {turn.streaming ? <span className="caret" /> : null}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <ContextGauge
                  compact
                  used={turn.streaming ? turn.live?.contextUsed : turn.metrics?.contextUsed}
                  limit={turn.streaming ? turn.live?.contextLimit : turn.metrics?.contextLimit}
                />
                <UsageLimitView compact limit={turn.streaming ? turn.live?.usageLimit : turn.metrics?.usageLimit} />
              </div>
              <FileWork
                dense
                files={turn.files ?? turn.metrics?.filesChanged}
                touched={turn.touched ?? turn.metrics?.filesTouched}
              />
              {turn.streaming && turn.live ? (
                <LiveMetrics live={turn.live} />
              ) : turn.metrics ? (
                <Metrics m={turn.metrics} />
              ) : null}
            </div>
          )
        )
      )}
    </div>
  )
}

export default function Projects({ onNav }: { onNav?: (page: string) => void }): React.JSX.Element {
  const t = useT()
  const { config, reload, toast } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [scanning, setScanning] = useState(false)

  // Estado del agente CLI
  const [cliAgentId, setCliAgentId] = useState('')
  const [cliPrompt, setCliPrompt] = useState('')
  const [cliAttach, setCliAttach] = useState<Attachment[]>([])
  const [cliEffort, setCliEffort] = useState<Effort>('auto')
  const [cliModel, setCliModel] = useState('')
  const [cliPermission, setCliPermission] = useState('acceptEdits')
  const [showClosed, setShowClosed] = useState(false)
  const [showGithub, setShowGithub] = useState(false)
  const [projectRuns, setProjectRuns] = useState<RunRecord[]>([])
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)
  // Al terminar una ejecución se vuelven a pedir las del proyecto.
  const runsVersion = useRunsVersion()
  // Fichero que otra pestaña quiere abrir en el explorador.
  const [fileToOpen, setFileToOpen] = useState<{ path: string; at: number } | undefined>()

  const allProjects = config?.projects ?? []
  const projects = allProjects.filter((p) => Boolean(p.closed) === showClosed)
  const closedCount = allProjects.filter((p) => p.closed).length
  const project = allProjects.find((p) => p.id === selected) ?? null

  // Terminal y sesión de agente asociadas al proyecto. Las dos viven en el
  // motor: cambiar de proyecto o de pantalla no las cierra.
  const terms = useTerms()
  const sessions = useSessions()

  const projectTermId = useMemo(
    () => Object.values(terms).find((t) => t.info.projectId === project?.id)?.info.id ?? null,
    [terms, project?.id]
  )

  const cliSession = useMemo(
    () => sessions.find((s) => s.kind === 'cli' && s.projectId === project?.id && !s.archived) ?? null,
    [sessions, project?.id]
  )
  const cliChat = useChat(cliSession?.id ?? null)
  const cliRunning = Boolean(cliChat?.runningRunId)

  // Rama y estado del repositorio, para el selector y para saber si el agente
  // ha dejado el árbol sucio.
  const { info: git, reload: reloadGit } = useGit(project?.path)

  // Al abrir la pestaña de terminal se crea una para el proyecto si no había.
  // El cerrojo evita abrir dos por la carrera del render mientras openTerm
  // todavía no ha vuelto.
  const spawningTerm = useRef(false)
  const [termError, setTermError] = useState<string | null>(null)
  const openProjectTerm = useCallback(async (): Promise<string | null> => {
    if (!project || spawningTerm.current) return null
    spawningTerm.current = true
    setTermError(null)
    try {
      const { id, error } = await openTerm({
        cwd: project.path,
        projectId: project.id,
        title: project.name
      })
      if (!id) setTermError(error ?? t('motivo desconocido'))
      return id
    } finally {
      spawningTerm.current = false
    }
  }, [project])

  useEffect(() => {
    if (tab !== 'terminal' || !project || projectTermId || termError) return
    void openProjectTerm()
  }, [tab, project, projectTermId, termError, openProjectTerm])

  // Al entrar en la pestaña de agente se carga su conversación guardada.
  useEffect(() => {
    if (tab !== 'agent' || !cliSession) return
    void openSession(cliSession.id)
    if (cliSession.cliAgentId) setCliAgentId(cliSession.cliAgentId)
  }, [tab, cliSession])

  useEffect(() => {
    if (!selected && projects.length) setSelected(projects[0].id)
  }, [projects, selected])

  const scan = useCallback(async (path: string) => {
    setScanning(true)
    const r = await window.api.projects.scan(path)
    setScanning(false)
    if (r.ok && r.data) setInfo(r.data)
  }, [])

  useEffect(() => {
    if (project) {
      void scan(project.path)
      void window.api.runs.query({ projectId: project.id, limit: 30 }).then((r) => {
        if (r.ok && r.data) setProjectRuns(r.data.rows)
      })
    } else {
      setInfo(null)
    }
  }, [project, scan, runsVersion])

  const addProject = async (): Promise<void> => {
    const r = await window.api.projects.pick()
    if (!r.ok || !r.data) return
    const path = r.data
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
    const p: Project = {
      id: uid(),
      name,
      path,
      color: colorFor(name),
      createdAt: Date.now(),
      lastOpenedAt: Date.now()
    }
    const saved = await window.api.projects.save(p)
    if (saved.ok) {
      await reload()
      setSelected(p.id)
      toast('ok', `Proyecto "${name}" añadido`)
    }
  }

  const patchProject = async (patch: Partial<Project>): Promise<void> => {
    if (!project) return
    await window.api.projects.save({ ...project, ...patch })
    await reload()
  }

  const removeProject = async (p: Project): Promise<void> => {
    await window.api.projects.remove(p.id)
    await reload()
    setSelected(null)
    setConfirmDelete(null)
    toast('info', `"${p.name}" quitado de la lista (la carpeta sigue en disco)`)
  }

  /**
   * Lanza el agente en la sesión del proyecto. Si no había sesión se crea una,
   * de modo que la conversación queda guardada y se puede retomar —también
   * desde la Consola, donde aparece en la lista lateral.
   */
  /**
   * Manda un comando a una terminal de verdad. Lo usan el panel de git para
   * lo que no se puede hacer desde sus botones y el de GitHub para iniciar
   * sesión, que necesita hablar contigo y abrir el navegador.
   */
  const toTerminal = useCallback(
    async (command: string): Promise<void> => {
      if (project) {
        setTab('terminal')
        const id = projectTermId ?? (await openProjectTerm())
        if (id) sendTermCommand(id, command)
        return
      }
      // Sin proyecto abierto se usa una terminal suelta y se salta a ella.
      const { id, error } = await openTerm({ title: 'GitHub' })
      if (!id) {
        toast('error', error ?? t('no se pudo abrir una terminal'))
        return
      }
      sendTermCommand(id, command)
      setShowGithub(false)
      onNav?.('terminal')
    },
    [project, projectTermId, openProjectTerm, onNav, toast]
  )

  const registerCloned = useCallback(
    async (path: string, name: string) => {
      const p: Project = {
        id: uid(),
        name,
        path,
        color: colorFor(name),
        createdAt: Date.now()
      }
      const r = await window.api.projects.save(p)
      if (r.ok) {
        await reload()
        setSelected(p.id)
        setShowGithub(false)
        setShowClosed(false)
        setTab('overview')
      }
    },
    [reload]
  )

  const setClosed = async (p: Project, closed: boolean): Promise<void> => {
    await window.api.projects.save({ ...p, closed })
    await reload()
    if (closed && selected === p.id) setSelected(null)
    toast('ok', closed ? `${p.name} cerrado` : `${p.name} reabierto`)
  }

  const runCli = async (): Promise<void> => {
    if (!project || !cliAgentId || !cliPrompt.trim() || cliRunning) return

    let sessionId = cliSession?.id
    if (!sessionId) {
      sessionId = await newSession('cli', {
        projectId: project.id,
        cliAgentId,
        title: `Agente · ${project.name}`
      })
    } else if (cliSession?.cliAgentId !== cliAgentId) {
      patchSessionConfig(sessionId, { cliAgentId })
    }

    const prompt = cliPrompt.trim()
    setCliPrompt('')
    setCliAttach([])
    const agent = cliAgents.find((a) => a.id === cliAgentId)
    const run = await sendCli(sessionId, {
      prompt,
      agentId: cliAgentId,
      agentName: agent?.name,
      projectPath: project.path,
      projectId: project.id,
      projectName: project.name,
      effort: cliEffort,
      model: cliModel || undefined,
      permissionMode: cliPermission,
      attachments: cliAttach.length ? cliAttach : undefined
    })
    reloadGit()

    if (run) {
      if (run.status === 'error') toast('error', run.error ?? t('El agente falló'))
      else toast('ok', t('proj.agentDone', { name: run.agentName ?? t('El agente'), time: ms(run.totalMs) }))
    }
    void window.api.runs.query({ projectId: project.id, limit: 30 }).then((r) => {
      if (r.ok && r.data) setProjectRuns(r.data.rows)
    })
  }

  const cliAgents = config?.cliAgents ?? []
  const selectedCli = cliAgents.find((a) => a.id === cliAgentId)
  const spend = projectRuns.reduce((s, r) => s + r.costTotal, 0)

  return (
    <div className="h-full flex">
      {/* ------------------------------------------------ Lista */}
      <Pane paneKey="projects.list" side="right" className="border-r border-line bg-void flex flex-col">
        <div className="h-12 px-4 border-b border-line flex items-center justify-between shrink-0">
          <span className="font-medium text-[13px]">{t('Proyectos')}</span>
          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowGithub(true)}
              title={t('GitHub: sesión, repositorios y clonar')}
            >
              <Download size={15} />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void addProject()} title={t('Añadir carpeta')}>
              <FolderPlus size={15} />
            </Button>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-line flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowClosed(false)}
            className={cx(
              'px-2 py-1 rounded text-[11.5px] transition-colors',
              !showClosed ? 'bg-raised text-fg' : 'text-dim hover:text-muted'
            )}
          >
            {t('Abiertos')}
          </button>
          <button
            onClick={() => setShowClosed(true)}
            className={cx(
              'px-2 py-1 rounded text-[11.5px] transition-colors flex items-center gap-1',
              showClosed ? 'bg-raised text-fg' : 'text-dim hover:text-muted'
            )}
          >
            Cerrados
            {closedCount ? <span className="num text-dim">{closedCount}</span> : null}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1.5">
          {projects.length === 0 ? (
            <div className="px-4 py-6 text-[12.5px] text-dim text-center leading-relaxed">
              {t('Añade la carpeta de un proyecto para trabajar sobre él desde aquí.')}
            </div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                className={cx(
                  'group w-full px-3 py-2 flex items-center gap-2.5 transition-colors relative',
                  selected === p.id ? 'bg-raised' : 'hover:bg-[#12151f]'
                )}
              >
                {selected === p.id ? (
                  <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full" style={{ background: p.color }} />
                ) : null}
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                <button onClick={() => setSelected(p.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[12.5px]">{p.name}</div>
                  <div className="truncate text-[10.5px] text-dim">{p.path}</div>
                </button>
                <button
                  onClick={() => void setClosed(p, !p.closed)}
                  title={p.closed ? 'Reabrir' : t('Cerrar: se guarda pero sale de la lista')}
                  className="p-1 rounded text-dim opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-panel shrink-0 transition-opacity"
                >
                  {p.closed ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                </button>
              </div>
            ))
          )}
        </div>
      </Pane>

      {/* ------------------------------------------------ Detalle */}
      {!project ? (
        <div className="flex-1 flex items-center justify-center">
          <Empty
            icon={<FolderGit2 size={30} />}
            title={t('Sin proyecto seleccionado')}
            hint={t('Añade una carpeta y podrás abrirla en VS Code, lanzarle agentes y mandar prompts con su contexto ya cargado.')}
            action={
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={() => void addProject()}>
                  <FolderPlus size={14} /> {t('Añadir proyecto')}
                </Button>
                <Button onClick={() => setShowGithub(true)}>
                  <Download size={14} /> {t('Clonar de GitHub')}
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-5 py-3 border-b border-line shrink-0 bg-void">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-[17px] font-semibold tracking-tight truncate">{project.name}</h1>
                  {git?.repo ? (
                    <BranchPicker
                      path={project.path}
                      info={git}
                      onChanged={() => {
                        reloadGit()
                        void scan(project.path)
                        toast('ok', t('Rama cambiada'))
                      }}
                      onError={(m) => toast('error', m)}
                    />
                  ) : info?.gitBranch ? (
                    <Badge tone="accent">
                      <GitBranch size={10} /> {info.gitBranch}
                    </Badge>
                  ) : null}
                  {scanning ? <span className="text-[11px] text-dim">{t('escaneando…')}</span> : null}
                </div>
                <div className="text-[11.5px] text-dim truncate mt-0.5 font-mono">{project.path}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" onClick={() => void window.api.projects.openEditor(project.path)}>
                  <Code2 size={13} /> {t('VS Code')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void window.api.projects.openFolder(project.path)} title={t('Abrir carpeta')}>
                  <FolderOpen size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setTab('terminal')}
                  title={t('Terminal integrada en este proyecto')}
                >
                  <TerminalSquare size={14} />
                </Button>
              </div>
            </div>
            <div className="mt-3">
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'overview', label: 'Resumen' },
                  { id: 'files', label: 'Archivos' },
                  {
                    id: 'git',
                    label: 'Git',
                    count: git?.repo ? (git.dirty + git.staged + git.untracked || undefined) : undefined
                  },
                  { id: 'graph', label: t('Árbol') },
                  { id: 'terminal', label: 'Terminal' },
                  { id: 'agent', label: 'Agente', count: cliRunning ? 1 : undefined },
                  { id: 'settings', label: 'Ajustes' }
                ]}
              />
            </div>
          </div>

          {/* El contenedor no desplaza: cada pestaña gestiona su propio
              scroll, porque la terminal necesita quedarse pegada al final. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {/* ---------------------------------------- Resumen */}
            {tab === 'overview' ? (
              <div className="p-5 space-y-3 max-w-[1100px] flex-1 min-h-0 overflow-y-auto">
                <div className="grid grid-cols-4 gap-3">
                  <Panel className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">{t('Ficheros')}</div>
                    <div className="num text-[19px] font-semibold">{info?.fileCount ?? '—'}</div>
                    <div className="text-[11px] text-dim mt-1">{bytes(info?.sizeBytes)}</div>
                  </Panel>
                  <Panel className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">{t('Ejecuciones')}</div>
                    <div className="num text-[19px] font-semibold">{projectRuns.length}</div>
                    <div className="text-[11px] text-dim mt-1">{t('en este proyecto')}</div>
                  </Panel>
                  <Panel className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">{t('Gasto')}</div>
                    <div className="num text-[19px] font-semibold text-accent">{cost(spend)}</div>
                    <div className="text-[11px] text-dim mt-1">{t('acumulado')}</div>
                  </Panel>
                  <Panel className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">{t('Gestor')}</div>
                    <div className="text-[15px] font-semibold mt-1">{info?.packageManager ?? '—'}</div>
                    <div className="text-[11px] text-dim mt-1">{info?.languages[0] ?? t('sin detectar')}</div>
                  </Panel>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Panel>
                    <PanelHeader title={t('Detectado en el proyecto')} icon={<FileCode2 size={14} />} />
                    <div className="p-4 space-y-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">{t('Lenguajes')}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {info?.languages.length ? (
                            info.languages.map((l) => <Badge key={l}>{l}</Badge>)
                          ) : (
                            <span className="text-[12px] text-dim">—</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5 flex items-center gap-1.5">
                          <Package size={11} /> {t('Dependencias de IA')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {info?.aiDeps.length ? (
                            info.aiDeps.map((d) => (
                              <Badge key={d} tone="violet">
                                {d}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-[12px] text-dim">{t('Ninguna')}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5 flex items-center gap-1.5">
                          <KeyRound size={11} /> {t('Variables en .env')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {info?.envKeyNames.length ? (
                            info.envKeyNames.slice(0, 14).map((k) => (
                              <Badge key={k} tone={/KEY|TOKEN|SECRET/i.test(k) ? 'warn' : 'neutral'}>
                                {k}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-[12px] text-dim">{t('Sin fichero .env')}</span>
                          )}
                        </div>
                        {info?.envKeyNames.length ? (
                          <div className="text-[11px] text-dim mt-2">
                            Sólo se leen los nombres; los valores nunca salen del disco.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Panel>

                  <Panel className="flex flex-col">
                    <PanelHeader title={t('Actividad reciente')} icon={<Sparkles size={14} />} />
                    <div className="divide-y divide-[#171a26] max-h-[300px] overflow-y-auto">
                      {projectRuns.length === 0 ? (
                        <div className="px-4 py-6 text-[12.5px] text-dim text-center">
                          {t('Todavía no has lanzado nada sobre este proyecto.')}
                        </div>
                      ) : (
                        projectRuns.slice(0, 12).map((r) => (
                          <div key={r.id} className="px-4 py-2 flex items-center gap-2.5">
                            <Dot tone={r.status === 'ok' ? 'ok' : 'bad'} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12px]">{r.agentName ?? r.model}</div>
                              <div className="text-[10.5px] text-dim truncate">{r.prompt.slice(0, 60)}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="num text-[11px] text-muted">{cost(r.costTotal)}</div>
                              <div className="num text-[10.5px] text-dim">{relTime(r.createdAt)}</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Panel>
                </div>

                {info?.scripts && Object.keys(info.scripts).length ? (
                  <Panel>
                    <PanelHeader
                      title={t('Scripts disponibles')}
                      icon={<Terminal size={14} />}
                      right={<span className="text-[11px] text-dim">{t('pincha uno para ejecutarlo aquí dentro')}</span>}
                    />
                    <div className="p-4 flex flex-wrap gap-1.5">
                      {Object.entries(info.scripts).map(([k, v]) => (
                        <button
                          key={k}
                          title={`${v}\n\nSe ejecuta en la terminal integrada del proyecto`}
                          onClick={() => {
                            // Se lanza con el gestor que use el proyecto, en la
                            // terminal de la app: nada de ventanas fuera.
                            const pm = info.packageManager ?? 'pnpm'
                            const cmd = `${pm} run ${k}`
                            setTab('terminal')
                            if (projectTermId) {
                              sendTermCommand(projectTermId, cmd)
                            } else {
                              void openProjectTerm().then((id) => {
                                if (id) sendTermCommand(id, cmd)
                              })
                            }
                          }}
                          className="px-2 py-1 bg-raised border border-line rounded-md text-[11.5px] font-mono hover:border-[#2c3346] hover:text-accent transition-colors flex items-center gap-1.5"
                        >
                          <Play size={9} />
                          {k}
                        </button>
                      ))}
                    </div>
                  </Panel>
                ) : null}
              </div>
            ) : null}

            {/* ---------------------------------------- Archivos */}
            {tab === 'files' ? (
              <FilesPanel root={project.path} onToast={toast} openRequest={fileToOpen} />
            ) : null}

            {/* ---------------------------------------- Git */}
            {tab === 'git' ? (
              <GitPanel
                path={project.path}
                onToast={toast}
                onOpenTerminal={(c) => void toTerminal(c)}
                onOpenGraph={() => setTab('graph')}
              />
            ) : null}

            {/* ---------------------------------------- Árbol de commits */}
            {tab === 'graph' ? (
              <GitGraph
                path={project.path}
                info={git}
                onToast={toast}
                onOpenFile={(file) => {
                  setFileToOpen({ path: file, at: Date.now() })
                  setTab('files')
                }}
              />
            ) : null}

            {/* ---------------------------------------- Terminal */}
            {tab === 'terminal' ? (
              projectTermId ? (
                <TerminalView termId={projectTermId} />
              ) : termError ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="text-[12.5px] text-red-400">
                    {t('proj.shellFailed', { name: project.name })}
                  </div>
                  <div className="text-[11.5px] text-dim font-mono max-w-[560px] break-words">
                    {termError}
                  </div>
                  <button
                    onClick={() => void openProjectTerm()}
                    className="px-3 py-1.5 bg-raised border border-line rounded-md text-[12px] hover:border-[#2c3346] hover:text-accent transition-colors"
                  >
                    {t('Reintentar')}
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-[12.5px] text-dim">
                  {t('proj.shellOpening', { name: project.name })}
                </div>
              )
            ) : null}

            {/* ---------------------------------------- Agente */}
            {tab === 'agent' ? (
              <div className="p-5 flex-1 min-h-0 flex flex-col gap-3 max-w-[1100px]">
                {cliAgents.length === 0 ? (
                  <Panel>
                    <Empty
                      icon={<Bot size={28} />}
                      title={t('No hay agentes de línea de comandos dados de alta')}
                      hint={t('Ve a Agentes y pulsa «Importar los detectados»: la app busca claude, codex, aider y compañía en tu PATH.')}
                    />
                  </Panel>
                ) : (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="w-[240px]">
                        <Field label={t('Agente')}>
                          <Select value={cliAgentId} onChange={(e) => setCliAgentId(e.target.value)}>
                            <option value="">{t('Elegir…')}</option>
                            {cliAgents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <div className="flex-1">
                        <Field label={t('Instrucción')}>
                          <Input
                            value={cliPrompt}
                            onChange={(e) => setCliPrompt(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !cliRunning) void runCli()
                            }}
                            placeholder={t('Qué quieres que haga en este proyecto…')}
                          />
                        </Field>
                      </div>
                      {cliRunning ? (
                        <Button variant="danger" onClick={() => cliSession && stopSession(cliSession.id)}>
                          <Square size={13} /> {t('Parar')}
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() => void runCli()}
                          disabled={!cliAgentId || !cliPrompt.trim()}
                        >
                          <Play size={13} /> {t('Ejecutar')}
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <AttachButton
                        onAdd={(added) =>
                          setCliAttach((list) => {
                            const seen = new Set(list.map((a) => a.path))
                            return [...list, ...added.filter((a) => !seen.has(a.path))]
                          })
                        }
                      />
                      {selectedCli && CLAUDE_LIKE.has((selectedCli.command ?? '').toLowerCase()) ? (
                        <>
                          <span className="text-[11px] text-dim">{t('Modelo')}</span>
                          <select
                            value={cliModel}
                            onChange={(e) => setCliModel(e.target.value)}
                            className="bg-raised border border-line rounded-md px-1.5 py-1 text-[11px] outline-none"
                          >
                            <option value="">{t('por omisión')}</option>
                            <option value="fable">{t('Fable')}</option>
                            <option value="opus">{t('Opus')}</option>
                            <option value="sonnet">{t('Sonnet')}</option>
                            <option value="haiku">{t('Haiku')}</option>
                          </select>
                          <span className="text-[11px] text-dim">{t('Permisos')}</span>
                          <select
                            value={cliPermission}
                            onChange={(e) => setCliPermission(e.target.value)}
                            title={PERMISSION_MODES.find((m) => m.id === cliPermission)?.hint}
                            className="bg-raised border border-line rounded-md px-1.5 py-1 text-[11px] outline-none"
                          >
                            {PERMISSION_MODES.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : null}
                      <span className="text-[11px] text-dim">{t('Esfuerzo')}</span>
                      <EffortPicker
                        value={cliEffort}
                        supported={EFFORT_CLIS.has((selectedCli?.command ?? '').toLowerCase())}
                        hint={
                          EFFORT_CLIS.has((selectedCli?.command ?? '').toLowerCase())
                            ? t('Automático deja el agente con su ajuste por omisión')
                            : `${selectedCli?.command ?? t('este agente')} no tiene opción de esfuerzo`
                        }
                        onChange={setCliEffort}
                      />
                      <AttachmentList
                        items={cliAttach}
                        onRemove={(path) => setCliAttach((list) => list.filter((a) => a.path !== path))}
                      />
                    </div>

                    <div className="text-[11.5px] text-dim flex items-center gap-1.5 flex-wrap">
                      <ChevronRight size={12} />
                      {t('Trabaja en')} <span className="font-mono text-muted">{project.path}</span>
                      {cliSession ? (
                        <>
                          <span className="text-[#3a4255]">·</span>
                          <MessagesSquare size={11} />
                          {t('la conversación se guarda y se retoma desde la Consola')}
                        </>
                      ) : null}
                      {cliRunning ? (
                        <>
                          <span className="text-[#3a4255]">·</span>
                          <Dot tone="ok" pulse /> {t('sigue corriendo aunque cambies de pantalla')}
                        </>
                      ) : null}
                    </div>

                    <AgentOutput sessionId={cliSession?.id ?? null} />
                  </>
                )}
              </div>
            ) : null}

            {/* ---------------------------------------- Ajustes */}
            {tab === 'settings' ? (
              <div className="p-5 space-y-4 max-w-[620px]">
                <Field label={t('Nombre')}>
                  <Input value={project.name} onChange={(e) => void patchProject({ name: e.target.value })} />
                </Field>
                <Field label={t('Agente por defecto')} hint={t('Se preselecciona al abrir la consola con este proyecto')}>
                  <Select
                    value={project.defaultAgentId ?? ''}
                    onChange={(e) => void patchProject({ defaultAgentId: e.target.value || undefined })}
                  >
                    <option value="">{t('Ninguno')}</option>
                    <optgroup label={t('Por API')}>
                      {config?.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={t('Línea de comandos')}>
                      {cliAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </Field>
                <Field
                  label={t('Instrucciones del proyecto')}
                  hint={t('Se anteponen al prompt de sistema siempre que trabajes sobre este proyecto')}
                >
                  <Textarea
                    value={project.systemPrompt ?? ''}
                    onChange={(e) => void patchProject({ systemPrompt: e.target.value })}
                    rows={6}
                    placeholder={t('Convenciones, stack, cosas que el modelo debe saber siempre…')}
                    className="text-[12.5px]"
                  />
                </Field>
                <div className="pt-2 border-t border-line">
                  <Button variant="danger" onClick={() => setConfirmDelete(project)}>
                    <Trash2 size={13} /> {t('Quitar de la lista')}
                  </Button>
                  <div className="text-[11.5px] text-dim mt-2">
                    {t('Sólo se elimina de esta app. La carpeta y su contenido no se tocan.')}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={t('Quitar proyecto')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" onClick={() => confirmDelete && void removeProject(confirmDelete)}>
              {t('Quitar')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed">
          {t('proj.removeExplain', { name: confirmDelete?.name ?? '' })}{' '}
          <span className="font-mono text-muted">{confirmDelete?.path}</span>{' '}
          {t('permanece intacta en el disco.')}
        </p>
      </Modal>

      <Modal open={showGithub} onClose={() => setShowGithub(false)} title={t('GitHub')} width="max-w-3xl">
        <GithubPanel
          onToast={toast}
          onOpenTerminal={(c) => void toTerminal(c)}
          onCloned={(path, name) => void registerCloned(path, name)}
        />
      </Modal>
    </div>
  )
}
