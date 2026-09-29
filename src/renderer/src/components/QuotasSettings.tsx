/**
 * Ajustes de cupos y presupuestos.
 *
 * Todo lo que toca algo fuera de la app viene apagado y se enciende aquí: el
 * statusLine de Claude Code (escribe en su settings.json, con copia) y la
 * consulta de Copilot con tu sesión de gh. Las claves de administrador son
 * opcionales y sólo sirven para leer el gasto de la organización.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Bell, Gauge, KeyRound, Plus, Trash2, Wallet, Activity } from 'lucide-react'
import { Panel, PanelHeader, Button, Badge, Field, Input, Select, Toggle, cx } from './ui'
import { useStore } from '../lib/store'
import { useQuotas } from '../lib/engine'
import { baseCommand } from '@shared/cliCaps'
import { cost, relTime } from '../lib/format'
import { useT } from '../lib/i18n'
import type { Budget, GeminiPlan, KeySource, QuotaSettings } from '@shared/types'

interface StatusLineInfo {
  installed: boolean
  chained: boolean
  foreign: boolean
  lastAt?: number
  shell: 'sh' | 'powershell'
  settingsPath: string
  untouched?: string
}

type Admin = Record<'anthropic' | 'openai', { source: KeySource; masked: string }>

const GEMINI_PLANS: { id: GeminiPlan; label: string }[] = [
  { id: 'auto', label: 'Automático (según cómo entras)' },
  { id: 'free', label: 'Gratuito con cuenta de Google (1.000 al día)' },
  { id: 'pro', label: 'Google AI Pro (1.500 al día)' },
  { id: 'ultra', label: 'Google AI Ultra (2.000 al día)' },
  { id: 'standard', label: 'Code Assist Standard (1.500 al día)' },
  { id: 'enterprise', label: 'Code Assist Enterprise (2.000 al día)' },
  { id: 'none', label: 'No lo uso' }
]

function AdminKeyRow({
  which,
  name,
  status,
  onSaved
}: {
  which: 'anthropic' | 'openai'
  name: string
  status?: { source: KeySource; masked: string }
  onSaved: (s: { source: KeySource; masked: string }) => void
}): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [value, setValue] = useState('')
  const save = async (key: string): Promise<void> => {
    const r = await window.api.quotas.setAdminKey(which, key)
    if (r.ok && r.data) {
      onSaved(r.data)
      setValue('')
      toast('ok', key ? t('Clave de administrador guardada') : t('Clave de administrador borrada'))
    } else toast('error', r.error ?? t('No se pudo guardar'))
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] w-24 shrink-0">{name}</span>
      <Input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          status?.source === 'stored'
            ? status.masked
            : status?.source === 'env'
              ? t('en el entorno ({env})', { env: which === 'anthropic' ? 'ANTHROPIC_ADMIN_KEY' : 'OPENAI_ADMIN_KEY' })
              : t('opcional')
        }
        className="font-mono flex-1"
        autoComplete="off"
      />
      <Button size="sm" disabled={!value.trim()} onClick={() => void save(value.trim())}>
        {t('Guardar')}
      </Button>
      {status?.source === 'stored' ? (
        <Button size="sm" variant="ghost" onClick={() => void save('')} title={t('Borrar')}>
          <Trash2 size={13} />
        </Button>
      ) : null}
    </div>
  )
}

export function QuotasSettings(): React.JSX.Element | null {
  const t = useT()
  const { config, status, reload, toast } = useStore()
  const report = useQuotas()
  const [sl, setSl] = useState<StatusLineInfo | null>(null)
  const [slBusy, setSlBusy] = useState(false)
  const [admin, setAdmin] = useState<Admin | null>(null)

  useEffect(() => {
    void window.api.quotas.statusLine().then((r) => r.ok && r.data && setSl(r.data))
    void window.api.quotas.adminKeys().then((r) => r.ok && r.data && setAdmin(r.data))
  }, [])

  const s = config?.settings
  const q: QuotaSettings = s?.quotas ?? {}
  const budgets: Budget[] = s?.budgets ?? []

  const setQuotas = async (patch: Partial<QuotaSettings>): Promise<void> => {
    await window.api.config.settings({ quotas: { ...q, ...patch } })
    await reload()
  }
  const setBudgets = async (next: Budget[]): Promise<void> => {
    await window.api.config.settings({ budgets: next })
    await reload()
  }

  const toggleStatusLine = async (on: boolean): Promise<void> => {
    setSlBusy(true)
    const r = on ? await window.api.quotas.installStatusLine() : await window.api.quotas.uninstallStatusLine()
    setSlBusy(false)
    if (r.ok && r.data) {
      setSl(r.data)
      if (r.data.untouched) toast('info', t(r.data.untouched))
      else toast('ok', on ? t('Lectura del plan de Claude activada') : t('Lectura del plan de Claude desactivada'))
    } else toast('error', r.error ?? t('No se pudo cambiar'))
    await reload()
  }

  // Sobre qué se puede poner un presupuesto.
  const targets = useMemo(() => {
    const cfg = config
    const providers = status.filter((p) => !p.local).map((p) => ({ id: p.id, name: p.name }))
    const seen = new Set<string>()
    const tools: { id: string; name: string }[] = []
    for (const a of cfg?.cliAgents ?? []) {
      const c = baseCommand(a.command)
      if (seen.has(c)) continue
      seen.add(c)
      tools.push({ id: 'cli:' + c, name: `${a.name} (${c})` })
    }
    return {
      provider: [...providers, ...tools],
      project: (cfg?.projects ?? []).map((p) => ({ id: p.id, name: p.name })),
      agent: [...(cfg?.agents ?? []), ...(cfg?.cliAgents ?? [])].map((a) => ({ id: a.id, name: a.name }))
    }
  }, [config, status])

  if (!s) return null

  const spent = (b: Budget): number | undefined => report?.quotas.find((x) => x.id === `budget.${b.id}`)?.used
  const patchBudget = (id: string, patch: Partial<Budget>): void => {
    void setBudgets(budgets.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  return (
    <div className="space-y-3">
      {/* ---------------------------------------------- Claude: statusLine */}
      <Panel>
        <PanelHeader
          title={t('Porcentaje oficial del plan de Claude')}
          subtitle={t('lo que Claude Code enseña en su barra de estado')}
          icon={<Gauge size={14} />}
          right={
            sl?.installed ? <Badge tone="ok">{t('Activo')}</Badge> : <Badge>{t('Apagado')}</Badge>
          }
        />
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-muted leading-relaxed">
            {t('Claude no publica el tope de tu plan por ningún otro sitio. Si lo activas, la app pone en Claude Code una barra de estado suya que guarda el porcentaje de la ventana de 5 h y de la semana, y después ejecuta la barra que ya tuvieras con la misma entrada: la tuya se sigue viendo igual.')}
          </p>
          <ul className="text-[11.5px] text-dim leading-relaxed list-disc pl-4 space-y-0.5">
            <li>{t('Escribe en tu settings.json de Claude Code; antes guarda una copia en la carpeta de datos de la app.')}</li>
            <li>{t('Al desactivarlo se deja como estaba. Si lo has cambiado después, no se toca.')}</li>
            <li>{t('El dato sólo llega mientras tienes abierta una sesión interactiva de Claude Code.')}</li>
          </ul>
          <Toggle
            checked={Boolean(sl?.installed)}
            onChange={(v) => void toggleStatusLine(v)}
            label={slBusy ? t('Aplicando…') : t('Leer el porcentaje del plan de Claude')}
          />
          {sl ? (
            <div className="text-[11px] text-dim space-y-0.5">
              <div className="font-mono truncate">{sl.settingsPath}</div>
              {sl.installed && sl.chained ? <div>{t('Tu barra de estado anterior se sigue ejecutando detrás.')}</div> : null}
              {!sl.installed && sl.foreign ? <div>{t('Ya tienes una barra de estado: al activarlo se encadena, no se pierde.')}</div> : null}
              {sl.installed ? (
                <div>{sl.lastAt ? t('Último dato: {ago}', { ago: relTime(sl.lastAt) }) : t('Todavía no ha llegado ningún dato.')}</div>
              ) : null}
              {sl.shell === 'powershell' ? <div>{t('No hay Git Bash: la barra se ejecuta con PowerShell.')}</div> : null}
            </div>
          ) : null}
        </div>
      </Panel>

      {/* ---------------------------------------------------- Fuentes */}
      <Panel>
        <PanelHeader title={t('Fuentes de cupo')} subtitle={t('de dónde sale cada dato')} icon={<Activity size={14} />} />
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('Plan de Gemini CLI')} hint={t('De él sale el tope diario de peticiones que publica Google')}>
              <Select value={q.geminiPlan ?? 'auto'} onChange={(e) => void setQuotas({ geminiPlan: e.target.value as GeminiPlan })}>
                {GEMINI_PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(p.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('Plan Go de OpenCode')} hint={t('Mide su gasto contra 12 $ cada 5 h, 30 $ a la semana y 60 $ al mes')}>
              <Select
                value={q.opencodeGo === true ? 'on' : q.opencodeGo === false ? 'off' : 'auto'}
                onChange={(e) => void setQuotas({ opencodeGo: e.target.value === 'on' ? true : e.target.value === 'off' ? false : undefined })}
              >
                <option value="auto">{t('Automático (si hay uso del plan Go)')}</option>
                <option value="on">{t('Lo tengo')}</option>
                <option value="off">{t('No lo tengo')}</option>
              </Select>
            </Field>
          </div>
          <Toggle
            checked={q.copilot === true}
            onChange={(v) => void setQuotas({ copilot: v })}
            label={t('Preguntar a GitHub por el cupo de Copilot')}
          />
          <p className="text-[11.5px] text-dim leading-relaxed -mt-2 pl-1">
            {t('Lo consulta gh con tu sesión (la app no ve el token). Usa una ruta interna de GitHub, la misma que la extensión de Copilot: si cambia, se dirá que no hay dato.')}
          </p>
          <Toggle
            checked={q.balances !== false}
            onChange={(v) => void setQuotas({ balances: v })}
            label={t('Consultar el saldo de las claves (OpenRouter, DeepSeek, Kimi)')}
          />
          <p className="text-[11.5px] text-dim leading-relaxed -mt-2 pl-1">
            {t('Cada clave va sólo a su proveedor, como mucho cada diez minutos.')}
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------- Avisos */}
      <Panel>
        <PanelHeader title={t('Avisos de cupo')} subtitle={t('para cualquier cupo o presupuesto con tope conocido')} icon={<Bell size={14} />} />
        <div className="p-4 grid grid-cols-2 gap-4 items-end">
          <Toggle
            checked={q.alerts !== false}
            onChange={(v) => void setQuotas({ alerts: v })}
            label={t('Avisar al cruzar los umbrales y al agotarse')}
          />
          <Field label={t('Umbrales (%)')} hint={t('Separados por comas. Al 100 % siempre se avisa.')}>
            <Input
              defaultValue={(q.thresholds ?? [50, 80, 95]).join(', ')}
              onBlur={(e) => {
                const list = e.target.value
                  .split(/[,;\s]+/)
                  .map(Number)
                  .filter((n) => n > 0 && n < 100)
                void setQuotas({ thresholds: list.length ? [...new Set(list)].sort((a, b) => a - b) : undefined })
              }}
              className="num"
            />
          </Field>
        </div>
      </Panel>

      {/* ---------------------------------------------------- Presupuestos */}
      <Panel>
        <PanelHeader
          title={t('Presupuestos')}
          subtitle={t('avisan al 50, 80 y 95 % y, si quieres, frenan al llegar al tope')}
          icon={<Wallet size={14} />}
          right={
            <Button
              size="sm"
              onClick={() =>
                void setBudgets([
                  ...budgets,
                  { id: crypto.randomUUID(), scope: 'total', period: 'month', limitUsd: 20 }
                ])
              }
            >
              <Plus size={13} /> {t('Añadir')}
            </Button>
          }
        />
        <div className="p-4 space-y-3">
          <p className="text-[11.5px] text-dim leading-relaxed">
            {t('Por omisión sólo cuenta el dinero que pagas por uso: las llamadas a API desde la app y lo que OpenCode cobra de Zen o de tus claves. Lo de los planes de suscripción (Claude, ChatGPT, Gemini, Copilot) es lo que costaría a precio de API; márcalo si quieres sumarlo. Los periodos son de calendario en tu hora: el día desde las 00:00, la semana desde el lunes y el mes desde el día 1.')}
          </p>
          {!budgets.length ? (
            <div className="text-[12px] text-dim">{t('No tienes ningún presupuesto.')}</div>
          ) : null}
          {budgets.map((b) => {
            const used = spent(b)
            const pct = used != null && b.limitUsd > 0 ? (used / b.limitUsd) * 100 : undefined
            const list = b.scope === 'total' ? [] : targets[b.scope]
            return (
              <div key={b.id} className="border border-line rounded-lg p-3 space-y-2.5 bg-raised">
                <div className="grid grid-cols-[1.2fr_0.9fr_1.4fr_0.9fr_0.8fr_auto] gap-2 items-end">
                  <Field label={t('Nombre')}>
                    <Input
                      defaultValue={b.label ?? ''}
                      placeholder={t('opcional')}
                      onBlur={(e) => patchBudget(b.id, { label: e.target.value.trim() || undefined })}
                    />
                  </Field>
                  <Field label={t('Sobre')}>
                    <Select
                      value={b.scope}
                      onChange={(e) => patchBudget(b.id, { scope: e.target.value as Budget['scope'], target: undefined })}
                    >
                      <option value="total">{t('Todo')}</option>
                      <option value="provider">{t('Proveedor')}</option>
                      <option value="project">{t('Proyecto')}</option>
                      <option value="agent">{t('Agente')}</option>
                    </Select>
                  </Field>
                  <Field label={t('Cuál')}>
                    <Select
                      value={b.target ?? ''}
                      disabled={b.scope === 'total'}
                      onChange={(e) => patchBudget(b.id, { target: e.target.value || undefined })}
                    >
                      <option value="">{b.scope === 'total' ? '—' : t('Elige…')}</option>
                      {list.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('Periodo')}>
                    <Select value={b.period} onChange={(e) => patchBudget(b.id, { period: e.target.value as Budget['period'] })}>
                      <option value="day">{t('Día')}</option>
                      <option value="week">{t('Semana')}</option>
                      <option value="month">{t('Mes')}</option>
                    </Select>
                  </Field>
                  <Field label={t('Tope (USD)')}>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={b.limitUsd}
                      onBlur={(e) => patchBudget(b.id, { limitUsd: Math.max(0, Number(e.target.value) || 0) })}
                      className="num"
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('Borrar')}
                    onClick={() => void setBudgets(budgets.filter((x) => x.id !== b.id))}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <Toggle
                    checked={b.hard === true}
                    onChange={(v) => patchBudget(b.id, { hard: v || undefined })}
                    label={t('Frenar al llegar al tope')}
                  />
                  <Toggle
                    checked={b.includeEstimated === true}
                    onChange={(v) => patchBudget(b.id, { includeEstimated: v || undefined })}
                    label={t('Contar también lo estimado de los planes')}
                  />
                  <span className={cx('num text-[11.5px] ml-auto', pct != null && pct >= 95 ? 'text-bad' : pct != null && pct >= 80 ? 'text-warn' : 'text-muted')}>
                    {used != null ? t('{used} de {limit} en este periodo', { used: cost(used), limit: cost(b.limitUsd) }) : '—'}
                  </span>
                </div>
                {b.scope !== 'total' && !b.target ? (
                  <div className="text-[11px] text-warn">{t('Elige sobre qué es: sin eso no cuenta nada.')}</div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Panel>

      {/* ------------------------------------------- Claves de administrador */}
      <Panel>
        <PanelHeader
          title={t('Claves de administrador')}
          subtitle={t('opcionales: el gasto del mes de tu organización en Anthropic y OpenAI')}
          icon={<KeyRound size={14} />}
        />
        <div className="p-4 space-y-2.5">
          <p className="text-[11.5px] text-dim leading-relaxed">
            {t('Ninguno de los dos publica por API tu saldo de créditos; con una clave de administrador se lee el informe de costes de la organización. Se guardan cifradas como las demás y sólo se usan para eso, contra la dirección oficial de cada uno.')}
          </p>
          <AdminKeyRow which="anthropic" name="Anthropic" status={admin?.anthropic} onSaved={(v) => setAdmin((a) => (a ? { ...a, anthropic: v } : a))} />
          <AdminKeyRow which="openai" name="OpenAI" status={admin?.openai} onSaved={(v) => setAdmin((a) => (a ? { ...a, openai: v } : a))} />
        </div>
      </Panel>
    </div>
  )
}
