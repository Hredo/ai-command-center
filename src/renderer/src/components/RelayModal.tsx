/**
 * Relevo: seguir con otra IA un trabajo que estaba haciendo otra.
 *
 * Se enseña lo que se le va a pasar —objetivo, tareas, últimos intercambios,
 * cambios del repositorio— y el prompt entero, editable, antes de lanzar nada.
 * Al lanzarlo se abre una conversación nueva en la Consola con el agente
 * elegido, en la misma carpeta, y a partir de ahí es una sesión normal.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, FolderGit2, GitBranch, ListChecks, AlertTriangle, FileDiff } from 'lucide-react'
import { Modal, Button, Field, Select, Textarea, Toggle, Badge, Spinner, cx } from './ui'
import { ModelPicker, type Pick } from './ModelPicker'
import { OpencodeModelPicker, isOpencodeCommand, useOpencodeModels } from './OpencodeModelPicker'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { newSession, sendCli, sendChat, focusChat, saveSessionNow } from '../lib/engine'
import type { RelayPackage, RelaySource, Project } from '@shared/types'

type Mode = 'cli' | 'api'

export function RelayModal({
  source,
  open,
  onClose,
  suggestAgentId
}: {
  source: RelaySource | null
  open: boolean
  onClose: () => void
  /** Agente de consola a proponer por delante (el que tiene más cupo, por ejemplo). */
  suggestAgentId?: string
}): React.JSX.Element | null {
  const t = useT()
  const { config, toast, reload } = useStore()
  const [pkg, setPkg] = useState<RelayPackage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('cli')
  const [agentId, setAgentId] = useState('')
  const [cliModel, setCliModel] = useState<string | undefined>()
  const [pick, setPick] = useState<Pick | null>(null)
  const [includeDiff, setIncludeDiff] = useState(true)
  const [note, setNote] = useState('')
  const [prompt, setPrompt] = useState('')
  const [edited, setEdited] = useState(false)
  const [launching, setLaunching] = useState(false)

  const cliAgents = config?.cliAgents ?? []
  const agent = cliAgents.find((a) => a.id === agentId)
  const isOc = Boolean(agent && isOpencodeCommand(agent.command))
  const oc = useOpencodeModels(open && isOc)

  // Al abrir: se arma el paquete desde lo que hay en disco.
  useEffect(() => {
    if (!open || !source) return
    setPkg(null)
    setError(null)
    setEdited(false)
    setNote('')
    setLoading(true)
    // Una conversación de la Consola se guarda con retardo: primero a disco.
    const ready = source.kind === 'session' ? saveSessionNow(source.id) : Promise.resolve()
    void ready
      .then(() => window.api.relay.build(source))
      .then((r) => {
        setLoading(false)
        if (r.ok && r.data) setPkg(r.data)
        else setError(r.error ?? t('No se pudo preparar el relevo'))
      })
  }, [open, source, t])

  // Quién lo sigue por omisión: el sugerido, o el primero que no sea el mismo.
  useEffect(() => {
    if (!open || agentId) return
    const from = (pkg?.fromAgent ?? '').toLowerCase()
    const first =
      cliAgents.find((a) => a.id === suggestAgentId) ??
      cliAgents.find((a) => !from.includes(a.name.toLowerCase()) && !from.includes(a.command.toLowerCase())) ??
      cliAgents[0]
    if (first) setAgentId(first.id)
    else setMode('api')
  }, [open, pkg, cliAgents, agentId, suggestAgentId])

  // El prompt se regenera mientras no lo hayas tocado a mano.
  useEffect(() => {
    if (!pkg || edited) return
    void window.api.relay.prompt(pkg, { includeDiff, note }).then((r) => {
      if (r.ok && typeof r.data === 'string') setPrompt(r.data)
    })
  }, [pkg, includeDiff, note, edited])

  const project = useMemo(
    () => (pkg?.projectId ? config?.projects.find((p) => p.id === pkg.projectId) : undefined),
    [pkg, config]
  )
  const folder = pkg?.projectPath?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()

  const canLaunch =
    Boolean(pkg && prompt.trim()) &&
    (mode === 'cli' ? Boolean(agent && pkg?.projectPath) : Boolean(pick))

  /** Sin proyecto dado de alta no se puede seguir la sesión desde la Consola: se da de alta. */
  const ensureProject = async (): Promise<Project | undefined> => {
    if (project) return project
    if (!pkg?.projectPath) return undefined
    const p: Project = {
      id: crypto.randomUUID(),
      name: folder || 'Proyecto',
      path: pkg.projectPath,
      color: '#60a5fa',
      createdAt: Date.now()
    }
    const r = await window.api.projects.save(p)
    if (!r.ok) return undefined
    await reload()
    return p
  }

  const launch = async (): Promise<void> => {
    if (!pkg || !canLaunch) return
    setLaunching(true)
    try {
      const proj = await ensureProject()
      const title = `${t('Relevo')} · ${pkg.label}`.slice(0, 120)
      if (mode === 'cli' && agent) {
        if (!proj) throw new Error(t('Un agente de línea de comandos necesita un proyecto donde trabajar'))
        const id = await newSession('cli', {
          title,
          cliAgentId: agent.id,
          cliModel: cliModel || undefined,
          projectId: proj.id
        })
        focusChat(id)
        onClose()
        void sendCli(id, {
          prompt,
          agentId: agent.id,
          agentName: agent.name,
          model: cliModel || undefined,
          projectPath: proj.path,
          projectId: proj.id,
          projectName: proj.name
        })
      } else if (pick) {
        const id = await newSession('chat', {
          title,
          providerId: pick.providerId,
          model: pick.model,
          projectId: proj?.id,
          agentMode: true
        })
        focusChat(id)
        onClose()
        void sendChat(id, {
          prompt,
          providerId: pick.providerId,
          model: pick.model,
          projectId: proj?.id,
          projectName: proj?.name,
          projectPath: proj?.path,
          agentMode: true,
          permissionMode: 'acceptEdits'
        })
      }
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setLaunching(false)
    }
  }

  if (!open) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Seguir con otra IA')}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canLaunch} loading={launching} onClick={() => void launch()}>
            <ArrowRightLeft size={13} />{' '}
            {mode === 'cli' && agent
              ? t('Seguir con {name}', { name: agent.name })
              : pick
                ? t('Seguir con {name}', { name: pick.model })
                : t('Seguir')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-dim text-[12.5px]">
          <Spinner size={14} /> {t('Leyendo la sesión y el repositorio…')}
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 text-[12.5px] text-bad">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      ) : pkg ? (
        <div className="space-y-4">
          {/* De dónde viene */}
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-dim">{t('Lo estaba haciendo')}</span>
            <Badge tone="warn">{pkg.fromAgent ?? t('otra IA')}</Badge>
            {pkg.projectPath ? (
              <Badge tone="violet" title={pkg.projectPath}>
                <FolderGit2 size={10} /> {pkg.projectName ?? folder}
              </Badge>
            ) : null}
            {pkg.branch ? (
              <Badge tone="neutral">
                <GitBranch size={10} /> {pkg.branch}
              </Badge>
            ) : null}
            {pkg.reason ? <Badge tone="bad">{pkg.reason}</Badge> : null}
          </div>

          <div className="grid grid-cols-3 gap-2 text-[11.5px]">
            <div className="rounded-lg border border-line px-3 py-2">
              <div className="text-dim flex items-center gap-1.5">
                <ListChecks size={12} /> {t('Tareas')}
              </div>
              <div className="num mt-0.5">
                {pkg.todos.length
                  ? t('{done} de {total} hechas', {
                      done: pkg.todos.filter((x) => x.done).length,
                      total: pkg.todos.length
                    })
                  : t('no llevaba lista')}
              </div>
            </div>
            <div className="rounded-lg border border-line px-3 py-2">
              <div className="text-dim flex items-center gap-1.5">
                <FileDiff size={12} /> {t('Sin confirmar')}
              </div>
              <div className="num mt-0.5">
                {pkg.gitStat
                  ? (pkg.gitStat.split('\n').pop() ?? '').trim()
                  : pkg.untracked.length
                    ? t('{n} ficheros nuevos', { n: pkg.untracked.length })
                    : t('nada')}
              </div>
            </div>
            <div className="rounded-lg border border-line px-3 py-2">
              <div className="text-dim">{t('Conversación')}</div>
              <div className="num mt-0.5">{t('últimos {n} mensajes', { n: pkg.exchanges.length })}</div>
            </div>
          </div>

          {!pkg.projectPath ? (
            <p className="text-[11.5px] text-warn leading-relaxed">
              {t('Esta sesión no dice en qué carpeta trabajaba: un agente de consola no puede seguirla, uno por API sí.')}
            </p>
          ) : !project ? (
            <p className="text-[11.5px] text-dim leading-relaxed">
              {t('{folder} no es uno de tus proyectos: se dará de alta al lanzarlo.', { folder: folder ?? '' })}
            </p>
          ) : null}

          {/* Quién lo sigue */}
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('Quién lo sigue')}>
              <div className="flex gap-1 mb-2">
                {(['cli', 'api'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cx(
                      'px-2.5 h-7 rounded-md text-[12px] border',
                      mode === m ? 'bg-raised border-line text-ink' : 'border-transparent text-dim hover:text-ink'
                    )}
                  >
                    {m === 'cli' ? t('Agente de consola') : t('Modelo por API')}
                  </button>
                ))}
              </div>
              {mode === 'cli' ? (
                <Select
                  value={agentId}
                  onChange={(e) => {
                    setAgentId(e.target.value)
                    setCliModel(undefined)
                  }}
                >
                  {cliAgents.length === 0 ? <option value="">{t('No tienes agentes de consola')}</option> : null}
                  {cliAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.command})
                    </option>
                  ))}
                </Select>
              ) : (
                <ModelPicker value={pick} onChange={setPick} />
              )}
            </Field>
            <Field label={t('Modelo')} hint={mode === 'api' ? t('Trabaja como agente: lee, edita y ejecuta en el proyecto') : undefined}>
              {mode === 'cli' && isOc ? (
                <OpencodeModelPicker
                  value={cliModel}
                  onChange={setCliModel}
                  models={oc.models}
                  loading={oc.loading}
                  onRefresh={oc.refresh}
                />
              ) : mode === 'cli' ? (
                <p className="text-[11.5px] text-dim leading-relaxed pt-1.5">
                  {t('El que tenga configurado; se puede cambiar después en la Consola.')}
                </p>
              ) : null}
            </Field>
          </div>

          <Field label={t('Qué quieres que haga ahora')} hint={t('Opcional: si lo dejas vacío, termina lo pendiente y dice qué ha hecho.')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-[12.5px]" />
          </Field>

          <Toggle
            checked={includeDiff}
            onChange={setIncludeDiff}
            label={
              pkg.diffTruncated
                ? t('Incluir el diff sin confirmar (recortado: es largo)')
                : t('Incluir el diff sin confirmar')
            }
          />

          <Field
            label={t('Lo que recibirá')}
            hint={edited ? t('Editado a mano: ya no se regenera.') : t('Se puede editar antes de lanzarlo.')}
          >
            <Textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setEdited(true)
              }}
              rows={12}
              className="font-mono text-[11.5px] leading-relaxed"
            />
          </Field>
        </div>
      ) : null}
    </Modal>
  )
}

/** De una ejecución del histórico, de dónde se puede sacar el relevo. */
export function relaySourceOf(run: {
  id: string
  cliSessionId?: string
  conversationId?: string
}): RelaySource | null {
  for (const kind of ['claude', 'codex', 'opencode', 'gemini'] as const) {
    if (run.id.startsWith(kind + '-') && run.cliSessionId) return { kind, id: run.cliSessionId }
  }
  if (run.conversationId) return { kind: 'session', id: run.conversationId }
  return null
}

/**
 * ¿El turno acabó porque se agotó un cupo o un límite? Es cuando más sentido
 * tiene ofrecer el relevo sin que haya que ir a buscarlo.
 */
export function endedByLimit(turn: {
  error?: string
  metrics?: { cliLimit?: { status: string }; status?: string }
  content?: string
}): boolean {
  if (turn.metrics?.cliLimit?.status === 'rejected') return true
  const text = `${turn.error ?? ''} ${turn.metrics?.status === 'error' ? turn.content ?? '' : ''}`
  return /usage limit|session limit|rate.?limit|quota|429|credit balance|insufficient|límite|cupo|saldo|exceeded|too many requests/i.test(
    text
  )
}
