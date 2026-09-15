import React, { useEffect, useState } from 'react'
import {
  Bot, Plus, Terminal, Radar, Trash2, Pencil, Check, Play
} from 'lucide-react'
import { Panel, PanelHeader, Button, Badge, Empty, Field, Input, Textarea, Select, Modal, cx, Dot, Tabs } from '../components/ui'
import { ModelPicker, type Pick } from '../components/ModelPicker'
import { EFFORT_LABEL, EffortPicker } from '../components/AgentPanel'
import { useStore } from '../lib/store'
import { uid, shortModel } from '../lib/format'
import { API_PERMISSION_MODES, type Agent, type CliAgent, type DetectedCli, type Effort } from '@shared/types'

import { useT } from '../lib/i18n'
const PALETTE = ['#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#60a5fa', '#f472b6', '#4ade80']

/**
 * Plantillas de agente.
 *
 * El nombre y el prompt se traducen juntos: si la interfaz esta en ingles y
 * eliges «Code reviewer», lo que quieres es un agente que trabaje en ingles,
 * no una etiqueta inglesa con instrucciones en espanol.
 */
const PRESETS: { name: string; system: string; temp: number }[] = [
  {
    name: 'Revisor de código',
    system: 'Eres un revisor de código exigente. Señala bugs reales, riesgos de seguridad y complejidad innecesaria. Sé concreto: fichero, línea y arreglo propuesto. Nada de elogios vacíos.',
    temp: 0.2
  },
  {
    name: 'Arquitecto',
    system: 'Diseñas sistemas. Ante cualquier propuesta, expón alternativas con sus compromisos, elige una y justifica por qué. Piensa en mantenimiento a dos años vista.',
    temp: 0.5
  },
  {
    name: 'Redactor técnico',
    system: 'Escribes documentación clara y breve en español. Frases cortas, ejemplos reales, cero relleno de marketing.',
    temp: 0.6
  },
  {
    name: 'Analista de datos',
    system: 'Analizas datos con rigor. Indica siempre el tamaño de muestra, la incertidumbre y qué no se puede concluir con los datos disponibles.',
    temp: 0.3
  }
]

function AgentEditor({
  open,
  onClose,
  initial,
  onSave
}: {
  open: boolean
  onClose: () => void
  initial: Agent | null
  onSave: (a: Agent) => void
}): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [pick, setPick] = useState<Pick | null>(null)
  const [system, setSystem] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(4096)
  const [color, setColor] = useState(PALETTE[0])
  const [effort, setEffort] = useState<Effort>('auto')
  const [permission, setPermission] = useState('acceptEdits')

  useEffect(() => {
    if (!open) return
    setEffort(initial?.effort ?? 'auto')
    setPermission(initial?.permissionMode ?? 'acceptEdits')
    if (initial) {
      setName(initial.name)
      setPick({ providerId: initial.providerId, model: initial.model })
      setSystem(initial.systemPrompt)
      setTemperature(initial.temperature)
      setMaxTokens(initial.maxTokens)
      setColor(initial.color)
    } else {
      setName('')
      setPick(null)
      setSystem('')
      setTemperature(0.7)
      setMaxTokens(4096)
      setColor(PALETTE[Math.floor(Math.random() * PALETTE.length)])
    }
  }, [open, initial])

  const save = (): void => {
    if (!name.trim() || !pick) return
    onSave({
      id: initial?.id ?? uid(),
      name: name.trim(),
      type: 'api',
      providerId: pick.providerId,
      model: pick.model,
      systemPrompt: system,
      temperature,
      maxTokens,
      color,
      effort,
      permissionMode: permission,
      createdAt: initial?.createdAt ?? Date.now()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t('Editar agente') : t('Nuevo agente')}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" onClick={save} disabled={!name.trim() || !pick}>
            <Check size={14} /> {t('Guardar')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label={t('Nombre')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Revisor de código')} />
            </Field>
          </div>
          <Field label={t('Color')}>
            <div className="flex gap-1.5 h-9 items-center">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cx(
                    'w-5 h-5 rounded-full transition-transform',
                    color === c ? 'ring-2 ring-offset-2 ring-offset-panel ring-white/40 scale-110' : ''
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>
        </div>

        <Field label={t('Modelo')}>
          <ModelPicker value={pick} onChange={setPick} />
        </Field>

        {/* Un agente trabaja siempre con herramientas: aquí se fija cuánto
            piensa y qué puede hacer sin preguntar. */}
        <p className="text-[11.5px] text-dim leading-relaxed">
          {t('Trabaja siempre como agente: lee, busca, edita y ejecuta comandos con herramientas hasta acabar la tarea. En un proyecto trabaja sobre sus archivos; sin proyecto, en su propia carpeta.')}
        </p>
        <div>
          <div className="text-[11.5px] uppercase tracking-wide text-dim mb-1.5 font-medium">{t('Esfuerzo')}</div>
          <EffortPicker
            value={effort}
            supported
            hint={t('Automático deja la petición como la manda el proveedor por omisión')}
            onChange={setEffort}
          />
        </div>
        <Field label={t('Permisos')}>
          <Select value={permission} onChange={(e) => setPermission(e.target.value)}>
            {API_PERMISSION_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-dim mt-1.5 leading-relaxed">
            {t((API_PERMISSION_MODES.find((m) => m.id === permission) ?? API_PERMISSION_MODES[0]).hint)}
          </p>
        </Field>

        {!initial ? (
          <div>
            <div className="text-[11.5px] uppercase tracking-wide text-dim mb-1.5 font-medium">
              {t('Plantillas rápidas')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setName(t(p.name))
                    setSystem(t(p.system))
                    setTemperature(p.temp)
                  }}
                  className="px-2.5 h-7 rounded-md bg-raised border border-line text-[12px] text-muted hover:text-ink hover:border-[#2c3245] transition-colors"
                >
                  {t(p.name)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <Field label={t('Prompt de sistema')}>
          <Textarea
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            rows={7}
            placeholder={t('Cómo debe comportarse este agente…')}
            className="text-[12.5px] leading-relaxed"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between text-[11.5px] mb-1.5">
              <span className="uppercase tracking-wide text-dim font-medium">{t('Temperatura')}</span>
              <span className="num text-muted">{temperature.toFixed(2)}</span>
            </div>
            <input
              type="range" min={0} max={2} step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </div>
          <Field label={t('Máx. tokens')}>
            <Input
              type="number" value={maxTokens} min={64} step={256}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="num"
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function CliEditor({
  open,
  onClose,
  initial,
  onSave
}: {
  open: boolean
  onClose: () => void
  initial: CliAgent | null
  onSave: (a: CliAgent) => void
}): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [parser, setParser] = useState<'claude-stream-json' | 'opencode-json' | 'plain'>('plain')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setCommand(initial?.command ?? '')
    setArgs((initial?.args ?? []).join(' '))
    setParser(initial?.parser ?? 'plain')
  }, [open, initial])

  const save = (): void => {
    if (!name.trim() || !command.trim()) return
    onSave({
      id: initial?.id ?? uid(),
      name: name.trim(),
      type: 'cli',
      command: command.trim(),
      args: args.split(/\s+/).filter(Boolean),
      parser,
      color: initial?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)],
      detected: initial?.detected,
      path: initial?.path,
      createdAt: initial?.createdAt ?? Date.now()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t('Editar agente CLI') : t('Nuevo agente CLI')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" onClick={save} disabled={!name.trim() || !command.trim()}>
            <Check size={14} /> {t('Guardar')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('Nombre')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Claude Code')} />
        </Field>
        <Field label={t('Comando')} hint={t('Tal cual lo escribirías en la terminal')}>
          <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="claude" className="font-mono" />
        </Field>
        <Field
          label={t('Argumentos')}
          hint={t('Usa {{prompt}} para insertar el prompt como argumento. Si lo omites, el prompt se envía por stdin (más seguro con textos largos).')}
        >
          <Input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="-p --output-format stream-json --verbose"
            className="font-mono text-[12.5px]"
          />
        </Field>
        <Field label={t('Lectura de la salida')} hint={t('stream-json extrae tokens y coste reales de Claude Code')}>
          <Select value={parser} onChange={(e) => setParser(e.target.value as any)}>
            <option value="plain">{t('Texto plano')}</option>
            <option value="claude-stream-json">Claude Code (stream-json)</option>
            <option value="opencode-json">OpenCode (--format json)</option>
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

export default function Agents(): React.JSX.Element {
  const t = useT()
  const { config, reload, toast, defs } = useStore()
  const [tab, setTab] = useState<'api' | 'cli'>('api')
  const [editing, setEditing] = useState<Agent | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [cliEditing, setCliEditing] = useState<CliAgent | null>(null)
  const [cliOpen, setCliOpen] = useState(false)
  const [detected, setDetected] = useState<DetectedCli[]>([])
  const [scanning, setScanning] = useState(false)

  const agents = config?.agents ?? []
  const cliAgents = config?.cliAgents ?? []

  const scan = async (): Promise<void> => {
    setScanning(true)
    const r = await window.api.detect.clis()
    setScanning(false)
    if (r.ok && r.data) setDetected(r.data)
  }

  useEffect(() => {
    void scan()
  }, [])

  const importDetected = async (): Promise<void> => {
    const r = await window.api.detect.importClis()
    await reload()
    if (r.ok && r.data) {
      toast(r.data.added > 0 ? 'ok' : 'info',
        r.data.added > 0
          ? t('agents.imported', { added: r.data.added, found: r.data.found })
          : t('agents.nothingNew', { found: r.data.found }))
    }
  }

  const saveAgent = async (a: Agent): Promise<void> => {
    await window.api.agents.save(a)
    await reload()
    setEditorOpen(false)
    toast('ok', `Agente "${a.name}" guardado`)
  }

  const saveCli = async (a: CliAgent): Promise<void> => {
    await window.api.agents.saveCli(a)
    await reload()
    setCliOpen(false)
    toast('ok', `Agente "${a.name}" guardado`)
  }

  const providerName = (id: string): string => defs.find((d) => d.id === id)?.name ?? id

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 max-w-[1300px] mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight">{t('Agentes')}</h1>
            <p className="text-[12.5px] text-dim mt-0.5">
              {t('Agentes que trabajan con herramientas, y los CLIs que ya tienes instalados')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'api', label: t('Por API'), count: agents.length },
                { id: 'cli', label: t('Línea de comandos'), count: cliAgents.length }
              ]}
            />
            {tab === 'api' ? (
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setEditorOpen(true)
                }}
              >
                <Plus size={14} /> {t('Nuevo')}
              </Button>
            ) : (
              <>
                <Button onClick={() => void importDetected()} loading={scanning}>
                  <Radar size={14} /> {t('Detectar instalados')}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setCliEditing(null)
                    setCliOpen(true)
                  }}
                >
                  <Plus size={14} /> {t('Nuevo')}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ Agentes de API */}
        {tab === 'api' ? (
          agents.length === 0 ? (
            <Panel>
              <Empty
                icon={<Bot size={30} />}
                title={t('Sin agentes todavía')}
                hint={t('Un agente es un modelo con sus instrucciones, su esfuerzo y sus permisos que trabaja con herramientas hasta acabar la tarea: en un proyecto, sobre sus archivos; sin proyecto, en su propia carpeta. Lo eliges en la Consola o en la pestaña Agente de un proyecto.')}
                action={
                  <Button
                    variant="primary"
                    onClick={() => {
                      setEditing(null)
                      setEditorOpen(true)
                    }}
                  >
                    <Plus size={14} /> {t('Crear el primero')}
                  </Button>
                }
              />
            </Panel>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {agents.map((a) => (
                <Panel key={a.id} className="p-4 group relative overflow-hidden">
                  <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: a.color }} />
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: a.color + '22', border: `1px solid ${a.color}44` }}
                      >
                        <Bot size={14} style={{ color: a.color }} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate text-[13.5px]">{a.name}</div>
                        <div className="text-[11px] text-dim truncate">
                          {providerName(a.providerId)} · {shortModel(a.model)}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => {
                          setEditing(a)
                          setEditorOpen(true)
                        }}
                        className="p-1.5 text-dim hover:text-ink rounded"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={async () => {
                          await window.api.agents.remove(a.id)
                          await reload()
                          toast('info', `"${a.name}" eliminado`)
                        }}
                        className="p-1.5 text-dim hover:text-bad rounded"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[12px] text-muted line-clamp-3 leading-relaxed min-h-[3.2em]">
                    {a.systemPrompt || <span className="text-dim">{t('Sin prompt de sistema')}</span>}
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    <Badge tone="accent">
                      <Bot size={10} /> {t('agente')}
                    </Badge>
                    <Badge>{t((API_PERMISSION_MODES.find((m) => m.id === a.permissionMode) ?? API_PERMISSION_MODES[0]).label)}</Badge>
                    {a.effort && a.effort !== 'auto' ? (
                      <Badge>
                        {t('Esfuerzo')}: {t(EFFORT_LABEL[a.effort])}
                      </Badge>
                    ) : null}
                    <Badge>temp {a.temperature}</Badge>
                  </div>
                </Panel>
              ))}
            </div>
          )
        ) : null}

        {/* ------------------------------------------------ Agentes CLI */}
        {tab === 'cli' ? (
          <div className="space-y-3">
            <Panel>
              <PanelHeader
                title={t('Detectados en tu PATH')}
                subtitle={`${detected.filter((d) => d.found).length} de ${detected.length} instalados en este equipo`}
                icon={<Radar size={14} />}
                right={
                  <Button size="sm" variant="ghost" onClick={() => void scan()} loading={scanning}>
                    {t('Reescanear')}
                  </Button>
                }
              />
              <div className="p-3 grid grid-cols-4 gap-2">
                {detected.map((d) => (
                  <div
                    key={d.id}
                    className={cx(
                      'px-3 py-2 rounded-lg border flex items-center gap-2.5',
                      d.found ? 'bg-raised border-line' : 'bg-transparent border-line-soft opacity-45'
                    )}
                  >
                    <Dot tone={d.found ? 'ok' : 'dim'} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] truncate">{d.name}</div>
                      <div className="text-[10.5px] text-dim truncate font-mono">
                        {d.found ? d.version || d.command : t('no instalado')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {cliAgents.length === 0 ? (
              <Panel>
                <Empty
                  icon={<Terminal size={30} />}
                  title={t('Ningún agente CLI dado de alta')}
                  hint={t('Pulsa «Detectar instalados» para añadir automáticamente los que ya tengas, o crea uno a mano con su comando y argumentos.')}
                />
              </Panel>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {cliAgents.map((a) => (
                  <Panel key={a.id} className="p-4 group relative overflow-hidden">
                    <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: a.color }} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: a.color + '22', border: `1px solid ${a.color}44` }}
                        >
                          <Terminal size={14} style={{ color: a.color }} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate text-[13.5px] flex items-center gap-2">
                            {a.name}
                            {a.detected ? <Badge tone="ok">{t('detectado')}</Badge> : null}
                          </div>
                          <div className="text-[11px] text-dim truncate font-mono">
                            {a.command} {a.args.join(' ')}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => {
                            setCliEditing(a)
                            setCliOpen(true)
                          }}
                          className="p-1.5 text-dim hover:text-ink rounded"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={async () => {
                            await window.api.agents.removeCli(a.id)
                            await reload()
                            toast('info', `"${a.name}" eliminado`)
                          }}
                          className="p-1.5 text-dim hover:text-bad rounded"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3">
                      <Badge tone={a.parser === 'plain' ? 'neutral' : 'accent'}>
                        {a.parser === 'plain' ? 'texto plano' : t('métricas reales')}
                      </Badge>
                      <Badge>
                        {a.args.some((x) => x.includes('{{prompt}}')) ? t('prompt como argumento') : t('prompt por stdin')}
                      </Badge>
                    </div>
                    <div className="text-[11.5px] text-dim mt-2.5 flex items-center gap-1.5">
                      <Play size={11} /> {t('Se lanza desde la ficha de cada proyecto')}
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <AgentEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initial={editing}
        onSave={(a) => void saveAgent(a)}
      />
      <CliEditor
        open={cliOpen}
        onClose={() => setCliOpen(false)}
        initial={cliEditing}
        onSave={(a) => void saveCli(a)}
      />
    </div>
  )
}
