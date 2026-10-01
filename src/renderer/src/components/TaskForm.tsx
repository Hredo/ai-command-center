/**
 * Lanzar una tarea ya o dejarla programada, y la lista de las programadas.
 *
 * El formulario es el mismo para las dos cosas: proyecto, agente, permisos,
 * worktree y qué tiene que hacer. Con «Programar» se añade cuándo (cada día,
 * de lunes a viernes, cada semana o cada tantas horas) y se guarda en vez de
 * lanzarse. A su hora la lanza la app igual que una del tablero, y la tarjeta
 * aparece en las columnas como cualquier otra.
 */
import React, { useEffect, useMemo, useState, useRef } from 'react'
import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Dot, Field, Input, Modal, Select, Textarea, Toggle, cx } from './ui'
import { ModelPicker, type Pick as ModelPick } from './ModelPicker'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { relTime } from '../lib/format'
import { focusChat } from '../lib/engine'
import { launchTask, permissionModesFor } from '../lib/launchTask'
import { nextRun, DEFAULT_SCHEDULE_TIME } from '@shared/schedule'
import type { AppConfig, LoginItemStatus, ScheduleRepeat, ScheduledTask } from '@shared/types'

type Translate = (key: string, vars?: Record<string, string | number>) => string

const locale = (lang: string): string => (lang === 'en' ? 'en-GB' : 'es-ES')

function weekdayName(day: number, lang: string): string {
  // 2023-01-01 fue domingo: día 0.
  return new Date(2023, 0, 1 + day).toLocaleDateString(locale(lang), { weekday: 'long' })
}

/** «Cada día a las 03:00», «De lunes a viernes a las 07:30», «Cada 6 horas». */
export function cadence(s: Pick2, t: Translate, lang: string): string {
  const h = s.time || DEFAULT_SCHEDULE_TIME
  switch (s.repeat) {
    case 'hourly':
      return (s.everyHours ?? 1) === 1 ? t('Cada hora') : t('Cada {n} horas', { n: s.everyHours ?? 1 })
    case 'weekdays':
      return t('De lunes a viernes a las {h}', { h })
    case 'weekly':
      return t('Cada {day} a las {h}', { day: weekdayName(s.weekday ?? 1, lang), h })
    default:
      return t('Cada día a las {h}', { h })
  }
}
type Pick2 = Pick<ScheduledTask, 'repeat' | 'time' | 'weekday' | 'everyHours'>

/** «hoy a las 22:00», «mañana a las 03:00», «el lunes a las 03:00» o la fecha. */
export function whenLabel(ts: number, t: Translate, lang: string): string {
  const d = new Date(ts)
  const hm = d.toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000)
  if (diff === 0) return t('hoy a las {h}', { h: hm })
  if (diff === 1) return t('mañana a las {h}', { h: hm })
  if (diff > 1 && diff < 7) return t('el {day} a las {h}', { day: d.toLocaleDateString(locale(lang), { weekday: 'long' }), h: hm })
  return d.toLocaleString(locale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const REPEATS: { id: ScheduleRepeat; label: string }[] = [
  { id: 'daily', label: 'Cada día' },
  { id: 'weekdays', label: 'De lunes a viernes' },
  { id: 'weekly', label: 'Cada semana' },
  { id: 'hourly', label: 'Cada tantas horas' }
]

export function TaskForm({
  open,
  onClose,
  config,
  projectId,
  scheduling = false,
  editing
}: {
  open: boolean
  onClose: () => void
  config: AppConfig
  projectId: string
  /** Abrir ya en modo «programar». */
  scheduling?: boolean
  /** Una programada que se edita. */
  editing?: ScheduledTask | null
}): React.JSX.Element {
  const t = useT()
  const { lang } = usePrefs()
  const { toast, models } = useStore()
  const [project, setProject] = useState('')
  const [agent, setAgent] = useState('')
  const [pick, setPick] = useState<ModelPick | null>(null)
  const [permission, setPermission] = useState('acceptEdits')
  const [worktree, setWorktree] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [sched, setSched] = useState(false)
  const [name, setName] = useState('')
  const [repeat, setRepeat] = useState<ScheduleRepeat>('daily')
  const [time, setTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [weekday, setWeekday] = useState(1)
  const [everyHours, setEveryHours] = useState(6)
  const [catchUp, setCatchUp] = useState(true)

  // Al abrir: lo de la programada que se edita o, si no, el proyecto del
  // filtro (o el primero) con su agente por defecto. Sólo al abrir: la
  // configuración se recarga por detrás a menudo (un cupo, una sesión de fuera,
  // la mesa que se guarda) y volver a rellenar el formulario entonces borraba
  // el nombre y deshacía el proyecto y el agente que acababas de elegir.
  const filled = useRef(false)
  useEffect(() => {
    if (!open) {
      filled.current = false
      return
    }
    if (filled.current) return
    filled.current = true
    if (editing) {
      setProject(editing.projectId)
      setAgent(editing.agent)
      setPick(editing.pick ?? null)
      setPermission(editing.permissionMode ?? 'acceptEdits')
      setWorktree(editing.worktree)
      setPrompt(editing.prompt)
      setSched(true)
      setName(editing.name)
      setRepeat(editing.repeat)
      setTime(editing.time ?? DEFAULT_SCHEDULE_TIME)
      setWeekday(editing.weekday ?? 1)
      setEveryHours(editing.everyHours ?? 6)
      setCatchUp(editing.catchUp !== false)
      return
    }
    const p = config.projects.find((x) => x.id === projectId) ?? config.projects[0]
    setProject(p?.id ?? '')
    const def = p?.defaultAgentId
    const choice = config.cliAgents.some((a) => a.id === def)
      ? `cli:${def}`
      : config.agents.some((a) => a.id === def)
        ? `api:${def}`
        : config.cliAgents[0]
          ? `cli:${config.cliAgents[0].id}`
          : config.agents[0]
            ? `api:${config.agents[0].id}`
            : 'model'
    setAgent(choice)
    // Para «un modelo como agente», de partida uno local si hay.
    const m = models.find((x) => x.local) ?? models[0]
    setPick((cur) => cur ?? (m ? { providerId: m.providerId, model: m.id } : null))
    setSched(scheduling)
    setName('')
    // Abrir el formulario no debe pisar lo que estabas escribiendo si lo cierras y vuelves.
  }, [open, projectId, config, models, editing, scheduling])

  const cliAgent = agent.startsWith('cli:') ? config.cliAgents.find((a) => a.id === agent.slice(4)) : undefined
  const apiAgent = agent.startsWith('api:') ? config.agents.find((a) => a.id === agent.slice(4)) : undefined
  const modes = permissionModesFor(agent, config)
  // El permiso de partida es el del agente, si lo tiene.
  useEffect(() => {
    if (editing) return
    setPermission(cliAgent?.permissionMode ?? apiAgent?.permissionMode ?? 'acceptEdits')
  }, [cliAgent?.id, apiAgent?.id, cliAgent?.permissionMode, apiAgent?.permissionMode, editing])

  const p = config.projects.find((x) => x.id === project)
  const ready = Boolean(p && prompt.trim() && (cliAgent || apiAgent || (agent === 'model' && pick)))
  const next = useMemo(
    () => (sched ? nextRun({ repeat, time, weekday, everyHours }, Date.now()) : null),
    [sched, repeat, time, weekday, everyHours]
  )

  const submit = async (): Promise<void> => {
    if (!p || !ready) return
    const mode = modes?.some((m) => m.id === permission) ? permission : undefined
    if (sched) {
      setBusy(true)
      const task: ScheduledTask = {
        id: editing?.id ?? crypto.randomUUID(),
        name: name.trim(),
        enabled: editing?.enabled ?? true,
        projectId: p.id,
        agent,
        pick: agent === 'model' && pick ? pick : undefined,
        permissionMode: mode,
        worktree,
        prompt: prompt.trim(),
        repeat,
        time: repeat === 'hourly' ? undefined : time,
        weekday: repeat === 'weekly' ? weekday : undefined,
        everyHours: repeat === 'hourly' ? everyHours : undefined,
        catchUp,
        createdAt: editing?.createdAt ?? Date.now()
      }
      const r = await window.api.schedules.save(task)
      setBusy(false)
      if (!r.ok) {
        toast('error', t(r.error ?? 'No se pudo guardar'))
        return
      }
      toast('ok', next ? t('Programada. La próxima, {when}.', { when: whenLabel(next, t, lang) }) : t('Programada.'))
      setPrompt('')
      onClose()
      return
    }
    setBusy(true)
    const res = await launchTask({ projectId: p.id, agent, pick, permissionMode: mode, worktree, prompt }, config, t)
    setBusy(false)
    if (res.error) {
      toast('error', res.error)
      return
    }
    if (res.warning) toast('error', res.warning)
    setPrompt('')
    onClose()
    const r = await res.done
    if (r.error) toast('error', t(r.error))
    else if (r.run?.status === 'error') toast('error', r.run.error ?? t('El agente falló'))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('Tarea programada') : sched ? t('Programar una tarea') : t('Nueva tarea')}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button loading={busy} disabled={!ready} onClick={() => void submit()} data-task-submit>
            {sched ? <CalendarClock size={13} /> : <Plus size={13} />} {editing ? t('Guardar') : sched ? t('Programar') : t('Lanzar')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-task-form>
        {!config.projects.length ? (
          <p className="text-[12.5px] text-warn">{t('Añade antes un proyecto en Proyectos: una tarea trabaja sobre uno.')}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Proyecto')}>
            <Select value={project} onChange={(e) => setProject(e.target.value)}>
              {config.projects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Agente')}>
            <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
              {config.cliAgents.length ? (
                <optgroup label={t('Línea de comandos')}>
                  {config.cliAgents.map((a) => (
                    <option key={a.id} value={`cli:${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {config.agents.length ? (
                <optgroup label={t('Agentes por API')}>
                  {config.agents.map((a) => (
                    <option key={a.id} value={`api:${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value="model">{t('Un modelo por API, como agente')}</option>
            </Select>
          </Field>
        </div>
        {agent === 'model' ? (
          <Field label={t('Modelo')} hint={t('Hace falta un modelo que admita herramientas (llamadas a funciones).')}>
            <ModelPicker value={pick} onChange={setPick} />
          </Field>
        ) : null}
        {modes ? (
          <Field label={t('Permisos')} hint={t(modes.find((m) => m.id === permission)?.hint ?? modes[0].hint)}>
            <Select value={modes.some((m) => m.id === permission) ? permission : modes[0].id} onChange={(e) => setPermission(e.target.value)}>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(m.label)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="space-y-1.5">
          <Toggle checked={worktree} onChange={setWorktree} label={t('En un worktree aparte')} />
          <p className="text-[11px] text-dim leading-relaxed">
            {worktree
              ? t('Una carpeta y una rama propias (acc/…) al lado del repositorio: tu carpeta no se toca y puedes tener varios agentes a la vez.') +
                (p?.worktreeSetup ? ' ' + t('Al crearlo se ejecuta «{cmd}».', { cmd: p.worktreeSetup }) : '')
              : t('Trabaja directamente en la carpeta del proyecto.')}
          </p>
        </div>
        <Field label={t('Tarea')}>
          <Textarea
            rows={5}
            value={prompt}
            placeholder={t('Qué tiene que hacer el agente…')}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            data-task-prompt
          />
        </Field>

        {editing ? null : (
          <Toggle checked={sched} onChange={setSched} label={t('Programar: que se lance sola a su hora')} />
        )}
        {sched ? (
          <div className="rounded-xl border border-line bg-void/60 p-3 space-y-3" data-schedule-fields>
            <Field label={t('Nombre')} hint={t('Si lo dejas vacío, el principio de la tarea.')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Actualizar dependencias')} data-schedule-name />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Se repite')}>
                <Select value={repeat} onChange={(e) => setRepeat(e.target.value as ScheduleRepeat)} data-schedule-repeat>
                  {REPEATS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {t(r.label)}
                    </option>
                  ))}
                </Select>
              </Field>
              {repeat === 'hourly' ? (
                <Field label={t('Cada cuántas horas')}>
                  <Input type="number" min={1} max={168} value={everyHours} onChange={(e) => setEveryHours(Math.max(1, Number(e.target.value) || 1))} className="num" />
                </Field>
              ) : (
                <Field label={t('A las')}>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value || DEFAULT_SCHEDULE_TIME)} className="num" data-schedule-time />
                </Field>
              )}
            </div>
            {repeat === 'weekly' ? (
              <Field label={t('El día')}>
                <Select value={String(weekday)} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <option key={d} value={d}>
                      {weekdayName(d, lang)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Toggle checked={catchUp} onChange={setCatchUp} label={t('Si la app estaba cerrada a su hora, lanzarla al abrirla')} />
            <p className="text-[11.5px] text-dim leading-relaxed" data-form-next>
              {next ? t('La próxima, {when}.', { when: whenLabel(next, t, lang) }) : null}{' '}
              {t('Sólo corre con la app abierta; en la bandeja vale.')}
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/**
 * Las programadas, encima del tablero: cuándo toca cada una, cómo fue la
 * última vez (con enlace a su conversación) y los botones de siempre.
 */
export function SchedulesStrip({
  config,
  projectId,
  onEdit,
  onNew
}: {
  config: AppConfig
  projectId: string
  onEdit: (s: ScheduledTask) => void
  onNew: () => void
}): React.JSX.Element | null {
  const t = useT()
  const { lang } = usePrefs()
  const { toast } = useStore()
  const [login, setLogin] = useState<LoginItemStatus | null>(null)
  const all = (config.schedules ?? []).filter((s) => !projectId || s.projectId === projectId)

  useEffect(() => {
    void window.api.app.loginItem().then((r) => r.ok && r.data && setLogin(r.data))
  }, [])

  if (!all.length) return null
  const projectName = (id: string): string => config.projects.find((p) => p.id === id)?.name ?? t('proyecto borrado')
  const agentName = (s: ScheduledTask): string =>
    s.agent === 'model'
      ? (s.pick?.model ?? t('un modelo'))
      : s.agent.startsWith('cli:')
        ? (config.cliAgents.find((a) => a.id === s.agent.slice(4))?.name ?? t('agente borrado'))
        : (config.agents.find((a) => a.id === s.agent.slice(4))?.name ?? t('agente borrado'))

  const toggle = async (s: ScheduledTask, enabled: boolean): Promise<void> => {
    const r = await window.api.schedules.save({ ...s, enabled })
    if (!r.ok) toast('error', t(r.error ?? 'No se pudo guardar'))
  }
  const runNow = async (s: ScheduledTask): Promise<void> => {
    const r = await window.api.schedules.runNow(s.id)
    if (!r.ok) toast('error', t(r.error ?? 'No se pudo lanzar'))
  }
  const remove = async (s: ScheduledTask): Promise<void> => {
    await window.api.schedules.remove(s.id)
  }

  return (
    <div className="px-3 pt-3 shrink-0" data-schedules>
      <div className="rounded-xl border border-line bg-void/60">
        <div className="px-3 py-2 border-b border-line flex items-center gap-2 text-[12px]">
          <CalendarClock size={13} className="text-violet" />
          <span className="font-medium">{t('Programadas')}</span>
          <span className="num text-dim">{all.length}</span>
          <span className="text-dim truncate">
            · {t('sólo corren con la app abierta; en la bandeja vale')}
            {login?.supported && !login.enabled ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => void window.api.app.setLoginItem(true).then((r) => r.ok && r.data && setLogin(r.data))}
                >
                  {t('abrirla al iniciar sesión')}
                </button>
              </>
            ) : null}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onNew}>
            <Plus size={12} /> {t('Programar')}
          </Button>
        </div>
        <div className="max-h-[180px] overflow-y-auto divide-y divide-line-soft">
          {all.map((s) => {
            const next = s.enabled ? nextRun(s, s.lastRunAt ?? s.createdAt) : null
            const status = s.lastStatus
            return (
              <div key={s.id} className={cx('px-3 py-2 flex items-center gap-3 text-[12px]', !s.enabled && 'opacity-60')} data-schedule={s.id}>
                <Toggle checked={s.enabled} onChange={(v) => void toggle(s, v)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{s.name}</span>
                    <Badge tone="violet" className="shrink-0">
                      {projectName(s.projectId)}
                    </Badge>
                    <span className="text-dim truncate">{agentName(s)}</span>
                    {s.worktree ? <span className="text-dim shrink-0">· worktree</span> : null}
                  </div>
                  <div className="text-[11px] text-dim flex items-center gap-2 min-w-0">
                    <span data-schedule-cadence>{cadence(s, t, lang)}</span>
                    {next ? <span data-schedule-next>· {t('próxima {when}', { when: whenLabel(next, t, lang) })}</span> : null}
                    {s.lastRunAt ? (
                      <span className="flex items-center gap-1 min-w-0" data-schedule-status={status}>
                        ·{' '}
                        <Dot tone={status === 'ok' ? 'ok' : status === 'error' ? 'bad' : status === 'running' ? 'ok' : 'dim'} pulse={status === 'running'} />
                        {status === 'running'
                          ? t('en marcha')
                          : status === 'error'
                            ? t('falló {when}', { when: relTime(s.lastRunAt) })
                            : status === 'missed'
                              ? t('se la saltó {when} (la app estaba cerrada)', { when: relTime(s.lastRunAt) })
                              : t('bien {when}', { when: relTime(s.lastRunAt) })}
                        {status === 'error' && s.lastError ? <span className="truncate text-bad">: {s.lastError}</span> : null}
                      </span>
                    ) : null}
                    {s.lastSessionId ? (
                      <button type="button" className="text-accent hover:underline shrink-0" onClick={() => focusChat(s.lastSessionId!)}>
                        {t('ver la última')}
                      </button>
                    ) : null}
                  </div>
                </div>
                <Button variant="ghost" size="icon" title={t('Lanzar ahora')} onClick={() => void runNow(s)} disabled={status === 'running'} data-schedule-run>
                  <Play size={13} />
                </Button>
                <Button variant="ghost" size="icon" title={t('Editar')} onClick={() => onEdit(s)}>
                  <Pencil size={13} />
                </Button>
                <Button variant="ghost" size="icon" title={t('Borrar')} onClick={() => void remove(s)} data-schedule-remove>
                  <Trash2 size={13} />
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
