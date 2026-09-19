import React, { useCallback, useEffect, useState } from 'react'
import {
  Radar, KeyRound, Cpu, Cloud, Check, X, ExternalLink, FolderOpen,
  ShieldCheck, Terminal, Pencil, RefreshCw, HardDrive, Info, Bell, TerminalSquare
} from 'lucide-react'
import { OllamaPanel } from '../components/OllamaPanel'
import { Panel, PanelHeader, Button, Badge, Input, Field, Select, Toggle, cx, Dot, Tabs, Empty } from '../components/ui'
import { AppearanceTab, EditorTab, SecurityTab } from './Appearance'
import { useStore } from '../lib/store'
import { relTime } from '../lib/format'
import type { DetectionResult, ProviderStatus } from '@shared/types'

import { useT } from '../lib/i18n'
import { IS_LINUX, IS_MAC, perOs } from '../lib/platform'
function ProviderRow({
  p,
  onChanged
}: {
  p: ProviderStatus
  onChanged: () => void
}): React.JSX.Element {
  const t = useT()
  const { defs, toast } = useStore()
  const def = defs.find((d) => d.id === p.id)
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [preview, setPreview] = useState('')
  const [baseUrl, setBaseUrl] = useState(p.baseUrl)
  const [editingUrl, setEditingUrl] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; detail: string; ms: number } | null>(null)

  useEffect(() => {
    if (p.keySource === 'stored') {
      void window.api.providers.keyPreview(p.id).then((r) => {
        if (r.ok && r.data) setPreview(r.data)
      })
    }
  }, [p.id, p.keySource])

  const saveKey = async (): Promise<void> => {
    const r = await window.api.providers.setKey(p.id, key.trim())
    if (r.ok) {
      setEditing(false)
      setKey('')
      toast(
        'ok',
        key.trim() ? t('prov.keySaved', { name: p.name }) : t('prov.keyRemoved', { name: p.name })
      )
      onChanged()
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    const r = await window.api.providers.test(p.id)
    setTesting(false)
    if (r.ok && r.data) {
      setResult(r.data)
      toast(r.data.ok ? 'ok' : 'error', `${p.name}: ${r.data.detail}`)
    }
  }

  const saveUrl = async (): Promise<void> => {
    await window.api.providers.setBaseUrl(p.id, baseUrl.trim())
    setEditingUrl(false)
    toast('ok', t('Endpoint actualizado'))
    onChanged()
  }

  const ready = p.local ? p.reachable : p.keySource !== 'none'

  return (
    <div className={cx('px-4 py-3 border-b border-line-soft last:border-0', !ready && 'opacity-70')}>
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-raised border border-line flex items-center justify-center shrink-0">
          {p.local ? <Cpu size={14} className={ready ? 'text-ok' : 'text-dim'} /> : <Cloud size={14} className={ready ? 'text-accent' : 'text-dim'} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13px]">{p.name}</span>
            {p.local ? <Badge tone="ok">local</Badge> : null}
            {p.keySource === 'env' ? <Badge tone="violet">{p.envVar}</Badge> : null}
            {p.keySource === 'stored' ? <Badge tone="accent">{t('key guardada')}</Badge> : null}
            {result ? (
              <Badge tone={result.ok ? 'ok' : 'bad'}>
                {result.ok ? `${result.ms}ms` : 'falla'}
              </Badge>
            ) : null}
          </div>
          <div className="text-[11.5px] text-dim truncate mt-0.5 font-mono">
            {p.baseUrl || t('sin endpoint configurado')}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {p.keySource === 'stored' && !editing ? (
            <span className="num text-[11.5px] text-dim mr-1">{preview}</span>
          ) : null}
          {def?.docsUrl ? (
            <Button
              size="icon"
              variant="ghost"
              title={t('Obtener API key')}
              onClick={() => void window.api.app.openExternal(def.docsUrl!)}
            >
              <ExternalLink size={13} />
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" title={t('Cambiar endpoint')} onClick={() => setEditingUrl((v) => !v)}>
            <Pencil size={13} />
          </Button>
          {!p.local ? (
            <Button size="sm" variant={p.keySource === 'none' ? 'primary' : 'outline'} onClick={() => setEditing((v) => !v)}>
              <KeyRound size={12} /> {p.keySource === 'none' ? t('Añadir key') : 'Cambiar'}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void test()} loading={testing} disabled={!ready}>
            {t('Probar')}
          </Button>
          <Dot tone={ready ? 'ok' : 'dim'} />
        </div>
      </div>

      {editing ? (
        <div className="flex items-center gap-2 mt-2.5 pl-10">
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
            placeholder={`Pega aquí tu API key de ${p.name}…`}
            className="font-mono text-[12.5px]"
            autoFocus
          />
          <Button variant="primary" size="sm" onClick={() => void saveKey()}>
            <Check size={13} /> {t('Guardar')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false)
              setKey('')
            }}
          >
            <X size={13} />
          </Button>
        </div>
      ) : null}

      {editingUrl ? (
        <div className="flex items-center gap-2 mt-2.5 pl-10">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveUrl()}
            placeholder="https://…"
            className="font-mono text-[12.5px]"
          />
          <Button variant="primary" size="sm" onClick={() => void saveUrl()}>
            <Check size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingUrl(false)}>
            <X size={13} />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default function Settings(): React.JSX.Element {
  const { config, status, info, reload, reloadStatus, reloadModels } = useStore()
  const t = useT()
  const [tab, setTab] =
    useState<'providers' | 'local' | 'detection' | 'appearance' | 'editor' | 'security' | 'prefs'>('providers')
  const [shells, setShells] = useState<{ shells: { path: string; label: string }[]; current: string } | null>(null)
  const [det, setDet] = useState<DetectionResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [filter, setFilter] = useState<'all' | 'ready' | 'local'>('all')

  const scan = useCallback(async () => {
    setScanning(true)
    const r = await window.api.detect.all()
    setScanning(false)
    if (r.ok && r.data) setDet(r.data)
    await reloadStatus()
  }, [reloadStatus])

  // El escaneo del equipo cuesta unos segundos y toca disco: se lanza una sola
  // vez, al abrir Ajustes, no cada vez que se cambia de pestaña.
  useEffect(() => {
    void scan()
  }, [scan])

  useEffect(() => {
    void window.api.term.shells().then((r) => {
      if (r.ok && r.data) setShells(r.data)
    })
  }, [])

  const onProviderChanged = async (): Promise<void> => {
    await reloadStatus()
    await reloadModels()
  }

  const setSetting = async (patch: any): Promise<void> => {
    await window.api.config.settings(patch)
    await reload()
  }

  const shown = status.filter((p) => {
    if (filter === 'ready') return p.local ? p.reachable : p.keySource !== 'none'
    if (filter === 'local') return p.local
    return true
  })

  const s = config?.settings

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 max-w-[1080px] mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight">{t('settings.title')}</h1>
            <p className="text-[12.5px] text-dim mt-0.5">{t('settings.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'providers', label: t('settings.tab.providers'), count: status.length },
                { id: 'local', label: t('settings.tab.local') },
                { id: 'detection', label: t('settings.tab.detection') },
                { id: 'appearance', label: t('settings.tab.appearance') },
                { id: 'editor', label: t('settings.tab.editor') },
                { id: 'security', label: t('settings.tab.security') },
                { id: 'prefs', label: t('settings.tab.prefs') }
              ]}
            />
            {tab === 'providers' || tab === 'detection' ? (
              <Button onClick={() => void scan()} loading={scanning}>
                <Radar size={14} /> {t('settings.rescan')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* ------------------------------------------------ Proveedores */}
        {tab === 'providers' ? (
          <>
            <Panel className="px-4 py-3 flex items-center gap-2.5">
              <ShieldCheck size={15} className="text-ok shrink-0" />
              <span className="text-[12.5px] text-muted">
                {t(perOs('security.keys.encrypted'))}
              </span>
            </Panel>

            <Panel>
              <PanelHeader
                title={t('Proveedores')}
                subtitle={t('prov.readyOf', {
                  ready: status.filter((p) => (p.local ? p.reachable : p.keySource !== 'none')).length,
                  total: status.length
                })}
                icon={<Cloud size={14} />}
                right={
                  <Tabs
                    value={filter}
                    onChange={setFilter}
                    items={[
                      { id: 'all', label: 'Todos' },
                      { id: 'ready', label: 'Listos' },
                      { id: 'local', label: 'Locales' }
                    ]}
                  />
                }
              />
              <div>
                {shown.map((p) => (
                  <ProviderRow key={p.id} p={p} onChanged={() => void onProviderChanged()} />
                ))}
              </div>
            </Panel>
          </>
        ) : null}

        {/* ------------------------------------------------ Local */}
        {tab === 'local' ? <OllamaPanel /> : null}

        {/* --------------------------------- Apariencia, editor y seguridad */}
        {tab === 'appearance' ? <AppearanceTab /> : null}
        {tab === 'editor' ? <EditorTab /> : null}
        {tab === 'security' ? <SecurityTab /> : null}

        {/* ------------------------------------------------ Detección */}

        {tab === 'detection' ? (
          !det ? (
            <Panel>
              <Empty icon={<Radar size={30} />} title={t('Escaneando el equipo…')} />
            </Panel>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Panel>
                  <PanelHeader
                    title={t('Motores locales')}
                    subtitle={`${det.localServers.filter((s) => s.up).length} encendidos`}
                    icon={<Cpu size={14} />}
                  />
                  <div className="p-3 space-y-1.5">
                    {det.localServers.map((sv) => (
                      <div key={sv.id} className="flex items-center gap-2.5 px-1 py-1">
                        <Dot tone={sv.up ? 'ok' : 'dim'} pulse={sv.up} />
                        <span className={cx('text-[12.5px] flex-1', !sv.up && 'text-dim')}>{sv.name}</span>
                        <span className="num text-[11px] text-dim font-mono truncate max-w-[150px]">{sv.url}</span>
                        {sv.up ? <Badge tone="ok">{sv.models.length} modelos</Badge> : null}
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel>
                  <PanelHeader
                    title={t('Claves en el entorno')}
                    subtitle={`${det.envKeys.length} variables detectadas`}
                    icon={<KeyRound size={14} />}
                  />
                  <div className="p-3 space-y-1.5">
                    {det.envKeys.length === 0 ? (
                      <div className="text-[12.5px] text-dim px-1 py-2 leading-relaxed">
                        {t('No hay variables de entorno con API keys. Puedes añadirlas en la pestaña Proveedores.')}
                      </div>
                    ) : (
                      det.envKeys.map((k) => (
                        <div key={k.name} className="flex items-center gap-2.5 px-1 py-1">
                          <Dot tone="ok" />
                          <span className="text-[12px] font-mono flex-1 truncate">{k.name}</span>
                          <span className="num text-[11px] text-dim">{k.masked}</span>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
              </div>

              <Panel>
                <PanelHeader
                  title={t('Agentes de línea de comandos')}
                  subtitle={`${det.clis.filter((c) => c.found).length} instalados en tu PATH`}
                  icon={<Terminal size={14} />}
                />
                <div className="p-3 grid grid-cols-3 gap-2">
                  {det.clis.map((c) => (
                    <div
                      key={c.id}
                      className={cx(
                        'px-3 py-2 rounded-lg border flex items-center gap-2.5',
                        c.found ? 'bg-raised border-line' : 'border-line-soft opacity-45'
                      )}
                    >
                      <Dot tone={c.found ? 'ok' : 'dim'} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] truncate">{c.name}</div>
                        <div className="text-[10.5px] text-dim truncate font-mono">
                          {c.found ? c.version || c.path : t('no encontrado')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel>
                <PanelHeader
                  title={t('Configuraciones encontradas')}
                  subtitle={t('carpetas de herramientas de IA en tu perfil')}
                  icon={<FolderOpen size={14} />}
                />
                <div className="p-3 grid grid-cols-3 gap-2">
                  {det.configDirs.map((d) => (
                    <div
                      key={d.path}
                      className={cx(
                        'px-3 py-2 rounded-lg border flex items-center gap-2.5',
                        d.exists ? 'bg-raised border-line' : 'border-line-soft opacity-40'
                      )}
                    >
                      <Dot tone={d.exists ? 'ok' : 'dim'} />
                      <span className="text-[12px] truncate">{d.name}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <div className="text-[11.5px] text-dim text-center">
                {t('detect.lastScan', { when: relTime(det.scannedAt) })}
              </div>
            </div>
          )
        ) : null}

        {/* ------------------------------------------------ Preferencias */}
        {tab === 'prefs' && s ? (
          <div className="space-y-3">
            <Panel>
              <PanelHeader
                title={t('Notificaciones del sistema')}
                icon={<Bell size={14} />}
                subtitle={t('Avisos del sistema cuando termina algo que tarda')}
              />
              <div className="p-4 space-y-3">
                <Toggle
                  checked={s.notifyOnFinish}
                  onChange={(v) => void setSetting({ notifyOnFinish: v })}
                  label={t('Avisar cuando termine una tarea')}
                />
                <Toggle
                  checked={s.notifyOnlyWhenUnfocused}
                  onChange={(v) => void setSetting({ notifyOnlyWhenUnfocused: v })}
                  label={t('Sólo si la ventana no está en primer plano')}
                />
                <p className="text-[11.5px] text-dim leading-relaxed">
                  {t('Se avisa de prompts y agentes al acabar, de comparativas completas, de descargas de modelos, y de comandos de terminal que hayan tardado más de doce segundos. Pulsar el aviso trae la ventana al frente.')}
                </p>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={t('Terminal integrada')} icon={<TerminalSquare size={14} />} />
              <div className="p-4 space-y-3">
                <Field label={t('Shell')} hint={t('Se usa en las terminales nuevas; las abiertas no cambian')}>
                  <Select
                    value={s.shellPath ?? shells?.current ?? ''}
                    onChange={(e) => void setSetting({ shellPath: e.target.value || undefined })}
                  >
                    {(shells?.shells ?? []).map((sh) => (
                      <option key={sh.path} value={sh.path}>
                        {sh.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('Sondeo de motores locales')}
                  hint={t('Cada cuántos segundos se comprueba si Ollama y compañía están encendidos. 0 lo desactiva.')}
                >
                  <Input
                    type="number" min={0} max={120} step={1}
                    defaultValue={s.localPollSeconds}
                    onBlur={(e) => void setSetting({ localPollSeconds: Number(e.target.value) })}
                    className="num"
                  />
                </Field>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={t('Herramientas externas')} icon={<Terminal size={14} />} />
              <div className="p-4 grid grid-cols-2 gap-4">
                <Field label="Editor" hint={t('Comando para «Abrir en VS Code» desde un proyecto')}>
                  <Input
                    defaultValue={s.editorCommand}
                    onBlur={(e) => void setSetting({ editorCommand: e.target.value })}
                    placeholder="code"
                    className="font-mono"
                  />
                </Field>
                <Field
                  label={t('Terminal externa')}
                  hint={
                    IS_MAC
                      ? t('El nombre de la aplicación: Terminal, iTerm, Warp, Ghostty…')
                      : IS_LINUX
                        ? t('Vacía: la del escritorio (x-terminal-emulator, GNOME, KDE…)')
                        : t('Sólo si alguna vez quieres abrir una fuera de la app')
                  }
                >
                  <Input
                    defaultValue={s.terminalCommand}
                    onBlur={(e) => void setSetting({ terminalCommand: e.target.value })}
                    placeholder={IS_MAC ? 'Terminal' : IS_LINUX ? t('automática') : 'wt'}
                    className="font-mono"
                  />
                </Field>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={t('Costes')} icon={<HardDrive size={14} />} />
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <Field label={t('Moneda')}>
                    <Select
                      value={s.currency}
                      onChange={(e) => void setSetting({ currency: e.target.value })}
                    >
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                    </Select>
                  </Field>
                  <Field label={t('Cambio USD → EUR')}>
                    <Input
                      type="number" step={0.01} defaultValue={s.eurRate}
                      onBlur={(e) => void setSetting({ eurRate: Number(e.target.value) })}
                      className="num"
                    />
                  </Field>
                  <Field label={t('Presupuesto mensual (USD)')} hint={t('Sólo informativo')}>
                    <Input
                      type="number" step={1} defaultValue={s.monthlyBudget ?? ''}
                      onBlur={(e) => void setSetting({ monthlyBudget: Number(e.target.value) || undefined })}
                      className="num"
                      placeholder="—"
                    />
                  </Field>
                </div>
                <Toggle
                  checked={s.autoRefreshCatalog}
                  onChange={(v) => void setSetting({ autoRefreshCatalog: v })}
                  label={t('Actualizar el catálogo de modelos y precios al arrancar')}
                />
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={t('Datos y aplicación')} icon={<Info size={14} />} />
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
                  {[
                    [t('Versión'), info?.version],
                    ['Electron', info?.electron],
                    ['Node', info?.node],
                    [t('Proveedores en catálogo'), info?.providerCount]
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between gap-3">
                      <span className="text-dim">{k}</span>
                      <span className="num text-muted">{String(v ?? '—')}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-line flex items-center gap-2">
                  <Button size="sm" onClick={() => void window.api.app.openDataDir()}>
                    <FolderOpen size={13} /> {t('Abrir carpeta de datos')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void reloadModels()}>
                    <RefreshCw size={13} /> {t('Recargar modelos')}
                  </Button>
                </div>
                <div className="text-[11.5px] text-dim font-mono truncate">{info?.dataDir}</div>
              </div>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  )
}
