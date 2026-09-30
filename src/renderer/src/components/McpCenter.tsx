/**
 * Centro de MCP: cada servidor frente a cada CLI (y los agentes por API de
 * esta app). Si un CLI no lo tiene, se copia desde otro: antes se enseña
 * exactamente qué se va a añadir y en qué fichero, qué variables de entorno
 * hacen falta y dónde queda la copia de seguridad. Los secretos no se ven ni
 * se copian: pasan a leerse de variables de entorno.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plug, Check, Copy, RefreshCw, AlertTriangle, Trash2, FlaskConical, Plus, KeyRound, FolderOpen } from 'lucide-react'
import { Button, Badge, Empty, Modal, Select, Input, Field, Toggle, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import type { McpClient, McpCopyPlan, McpDefinition, McpReport, McpServerRow } from '@shared/types'

const CLIENTS: { id: McpClient; name: string; command?: string }[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude' },
  { id: 'codex', name: 'Codex', command: 'codex' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini' },
  { id: 'copilot', name: 'Copilot CLI', command: 'copilot' },
  { id: 'app', name: 'Esta app' }
]

type Scope = 'personal' | 'project'

/** De qué definición se copia: una sin secretos en línea y, si puede ser, la de Claude Code. */
function sourceOf(row: McpServerRow): McpDefinition | undefined {
  const ok = row.definitions.filter((d) => !d.secretInline)
  return ok.find((d) => d.client === 'claude') ?? ok[0] ?? row.definitions[0]
}

export function McpCenter(): React.JSX.Element {
  const t = useT()
  const { toast, config } = useStore()
  const [scope, setScope] = useState<Scope>('personal')
  const [projectId, setProjectId] = useState('')
  const [report, setReport] = useState<McpReport | null>(null)
  const [copying, setCopying] = useState<{ row: McpServerRow; to: McpClient; plan: McpCopyPlan | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tested, setTested] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', target: '', env: '' })

  const project = config?.projects.find((p) => p.id === projectId)
  const projectPath = scope === 'project' ? project?.path : undefined

  const load = useCallback(async () => {
    if (scope === 'project' && !projectPath) {
      setReport({ files: [], servers: [] })
      return
    }
    const r = await window.api.mcp.list(projectPath)
    setReport(r.ok && r.data ? r.data : { files: [], servers: [] })
  }, [scope, projectPath])

  useEffect(() => {
    void load()
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  useEffect(() => {
    if (!projectId && config?.projects[0]) setProjectId(config.projects[0].id)
  }, [config?.projects, projectId])

  const installed = useMemo(
    () => new Set((config?.cliAgents ?? []).map((a) => a.command.toLowerCase().split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/, ''))),
    [config?.cliAgents]
  )
  const clients = CLIENTS.filter((c) => scope === 'personal' || c.id !== 'app')
  const rows = (report?.servers ?? []).filter((r) => r.scope === scope)
  const files = (report?.files ?? []).filter((f) => f.scope === scope)

  const openCopy = async (row: McpServerRow, to: McpClient): Promise<void> => {
    const src = sourceOf(row)
    if (!src) return
    setCopying({ row, to, plan: null })
    const r = await window.api.mcp.plan({ client: src.client, scope, name: row.name }, { client: to, scope }, projectPath)
    setCopying({ row, to, plan: r.ok && r.data ? r.data : { client: to, scope, file: '', snippet: '', needsEnv: [], warnings: [], error: r.error ?? '' } })
  }

  const doCopy = async (): Promise<void> => {
    if (!copying) return
    const src = sourceOf(copying.row)
    if (!src) return
    setBusy(true)
    const r = await window.api.mcp.copy({ client: src.client, scope, name: copying.row.name }, { client: copying.to, scope }, projectPath)
    setBusy(false)
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo copiar'))
      return
    }
    setCopying(null)
    toast(
      'ok',
      r.data.backup
        ? t('«{name}» añadido a {file}. Copia de seguridad en {backup}', { name: copying.row.name, file: r.data.file, backup: r.data.backup })
        : t('«{name}» añadido a {file}', { name: copying.row.name, file: r.data.file })
    )
    void load()
  }

  const test = async (name: string): Promise<void> => {
    setTested((x) => ({ ...x, [name]: t('Conectando…') }))
    const r = await window.api.mcp.test(name)
    setTested((x) => ({
      ...x,
      [name]: r.ok && r.data
        ? t('{n} herramientas: {list}', { n: r.data.tools.length, list: r.data.tools.map((x) => x.name).join(', ') || '—' })
        : t('No arranca: {error}', { error: r.error ?? '' })
    }))
  }

  const add = async (): Promise<void> => {
    const r = await window.api.mcp.add({
      name: form.name.trim(),
      target: form.target.trim(),
      envVars: form.env.split(',').map((v) => v.trim()).filter(Boolean)
    })
    if (!r.ok) {
      toast('error', r.error ?? t('No se pudo añadir'))
      return
    }
    setAdding(false)
    setForm({ name: '', target: '', env: '' })
    void load()
  }

  const cell = (row: McpServerRow, c: McpClient): React.ReactNode => {
    const def = row.definitions.find((d) => d.client === c)
    if (def && c === 'app') {
      return (
        <div className="flex items-center justify-center gap-1">
          <Toggle
            checked={def.enabled}
            onChange={(v) => void window.api.mcp.enable(row.name, v).then(() => load())}
          />
          <button className="text-dim hover:text-ink" title={t('Probar: conecta y lista sus herramientas')} onClick={() => void test(row.name)}>
            <FlaskConical size={12} />
          </button>
          <button
            className="text-dim hover:text-bad"
            title={t('Quitarlo de la app (los CLIs no se tocan)')}
            onClick={() => void window.api.mcp.remove(row.name).then(() => load())}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )
    }
    if (def) {
      return (
        <span className={cx('inline-flex', def.enabled ? 'text-ok' : 'text-dim')} title={`${def.file}${def.enabled ? '' : ' · ' + t('apagado')}`}>
          <Check size={14} />
        </span>
      )
    }
    return (
      <Button size="sm" variant="ghost" onClick={() => void openCopy(row, c)} title={t('Ver qué se añadiría y copiarlo')}>
        <Copy size={11} /> {t('Copiar')}
      </Button>
    )
  }

  if (!report) return <div className="text-[12px] text-dim">{t('Leyendo…')}</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <Plug size={13} className="text-accent" /> {t('Servidores MCP')}
          <span className="num text-[11px] text-dim">{rows.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40">
            <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="h-8 text-[12px]" aria-label={t('Ámbito')}>
              <option value="personal">{t('Personales')}</option>
              <option value="project">{t('De un proyecto')}</option>
            </Select>
          </div>
          {scope === 'project' ? (
            <div className="w-48">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 text-[12px]" aria-label={t('Proyecto')}>
                {(config?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)} title={t('Añadir a mano un servidor para los agentes por API')}>
              <Plus size={12} /> {t('Añadir a la app')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void load()} title={t('Volver a leer las configuraciones')}>
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>
      <p className="text-[11.5px] text-dim leading-relaxed">
        {scope === 'personal'
          ? t('Los que cada CLI carga en todos tus proyectos, y los que usan los agentes por API de esta app. Copiar sólo añade: nunca cambia ni borra uno que ya esté, y antes guarda una copia del fichero.')
          : t('Los del repositorio: .mcp.json (Claude Code y Copilot), .codex/config.toml, opencode.json y .gemini/settings.json.')}
      </p>

      {!rows.length ? (
        <Empty
          icon={<Plug size={28} />}
          title={t('Ningún servidor MCP')}
          hint={t('Cuando añadas uno en cualquier CLI (por ejemplo, claude mcp add) saldrá aquí y podrás llevarlo a los demás.')}
        />
      ) : (
        <div className="border border-line rounded-lg overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[11px] text-dim text-left">
                <th className="px-3 py-2 font-medium">{t('Servidor')}</th>
                {clients.map((c) => (
                  <th
                    key={c.id}
                    className={cx('px-2 py-2 font-medium text-center whitespace-nowrap', c.command && !installed.has(c.command) && 'opacity-50')}
                  >
                    {t(c.name)}
                    {c.command && !installed.has(c.command) ? <div className="text-[10px] font-normal">{t('no lo tienes')}</div> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const src = sourceOf(row)
                return (
                  <tr key={row.name} className="border-t border-line-soft align-top" data-mcp={row.name}>
                    <td className="px-3 py-2 min-w-[260px] max-w-[420px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] text-ink">{row.name}</span>
                        <Badge>{src?.transport}</Badge>
                        {row.differs ? (
                          <Badge tone="warn" title={t('No está definido igual en todos los sitios')}>
                            {t('distinto')}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-dim font-mono truncate mt-0.5" title={src?.summary}>
                        {src?.summary}
                      </div>
                      {src && (src.env.length || src.headers.length) ? (
                        <div className="flex gap-1 flex-wrap mt-1">
                          {[...src.env, ...src.headers].map((v) => (
                            <Badge key={v.key} tone={v.secret ? 'warn' : v.ref ? 'accent' : 'neutral'} title={v.secret ? t('Secreto escrito en la configuración: no se enseña ni se copia') : v.ref ? t('Sale de la variable de entorno {v}', { v: v.ref }) : v.value}>
                              {v.secret ? <KeyRound size={9} /> : null}
                              {v.key}
                              {v.ref && v.ref !== v.key ? ` ← ${v.ref}` : ''}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {src?.secretInline ? (
                        <div className="flex items-start gap-1 text-[11px] text-warn mt-1">
                          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                          {t('Lleva un secreto en la orden o la URL: no se copia hasta que lo pases a una variable de entorno.')}
                        </div>
                      ) : null}
                      {tested[row.name] ? <div className="text-[11px] text-muted mt-1 break-words">{tested[row.name]}</div> : null}
                    </td>
                    {clients.map((c) => (
                      <td key={c.id} className="px-2 py-2 text-center" data-client={c.id}>
                        {cell(row, c.id)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wider text-dim">{t('Ficheros')}</div>
        {files.map((f) => (
          <div key={f.client + f.file} className="flex items-center gap-2 text-[11px]">
            <span className="text-dim w-24 shrink-0">{t(CLIENTS.find((c) => c.id === f.client)?.name ?? f.client)}</span>
            <span className={cx('font-mono truncate', f.exists ? 'text-muted' : 'text-dim')} title={f.file}>
              {f.file}
            </span>
            {f.error ? <span className="text-bad shrink-0">{t(f.error)}</span> : !f.exists ? <span className="text-dim shrink-0">{t('no existe')}</span> : null}
            {f.exists && f.client !== 'app' ? (
              <button className="text-dim hover:text-ink shrink-0" onClick={() => void window.api.projects.openFolder(f.file.replace(/[\\/][^\\/]+$/, ''))} title={t('Abrir su carpeta')}>
                <FolderOpen size={11} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(copying)}
        onClose={() => setCopying(null)}
        title={t('Copiar «{name}» a {client}', {
          name: copying?.row.name ?? '',
          client: t(CLIENTS.find((c) => c.id === copying?.to)?.name ?? '')
        })}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCopying(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!copying?.plan || Boolean(copying.plan.error)} onClick={() => void doCopy()}>
              <Copy size={13} /> {t('Añadirlo')}
            </Button>
          </>
        }
      >
        {!copying?.plan ? (
          <div className="text-[12px] text-dim">{t('Preparando…')}</div>
        ) : copying.plan.error ? (
          <div className="flex items-start gap-2 text-[12.5px] text-bad">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{copying.plan.error}</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-[12px] text-muted">
              {t('Se añade a')} <span className="font-mono text-ink break-all">{copying.plan.file}</span>
            </div>
            <pre className="bg-void border border-line rounded-md p-3 text-[11.5px] font-mono whitespace-pre-wrap max-h-[280px] overflow-auto">{copying.plan.snippet}</pre>
            {copying.plan.needsEnv.length ? (
              <div className="text-[12px] text-muted">
                {t('Tienen que estar definidas estas variables de entorno:')}{' '}
                {copying.plan.needsEnv.map((v) => (
                  <Badge key={v} tone="accent" className="mr-1">
                    {v}
                  </Badge>
                ))}
              </div>
            ) : null}
            {copying.plan.warnings.map((w) => (
              <div key={w} className="flex items-start gap-1.5 text-[12px] text-warn">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span>{w}</span>
              </div>
            ))}
            <p className="text-[11px] text-dim">{t('Antes de escribir se guarda una copia del fichero en la carpeta de datos de la app (respaldos/mcp).')}</p>
          </div>
        )}
      </Modal>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={t('Añadir un servidor MCP a la app')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" disabled={!form.name.trim() || !form.target.trim()} onClick={() => void add()}>
              <Plus size={13} /> {t('Añadir')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('Nombre')}>
            <Input value={form.name} placeholder="github" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label={t('Orden o URL')} hint={t('Por ejemplo: npx -y @modelcontextprotocol/server-filesystem ~/datos, o https://…/mcp')}>
            <Input value={form.target} className="font-mono" onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} />
          </Field>
          <Field
            label={t('Variables de entorno que necesita')}
            hint={t('Sólo los nombres, separados por comas. El valor se lee de tu entorno al arrancarlo: aquí no se escribe ningún secreto.')}
          >
            <Input value={form.env} placeholder="GITHUB_TOKEN" className="font-mono" onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
