/**
 * Las tres pestañas de personalización: Apariencia, Editor y Seguridad.
 *
 * Van en su propio fichero porque Ajustes ya tenía bastante con los proveedores
 * y la detección, y porque aquí todo comparte la misma mecánica: se toca un
 * control, se ve al momento y se guarda solo un instante después.
 *
 * Ninguna de estas pantallas confirma nada ni tiene botón de aplicar. El tema
 * se cambia y ya está cambiado; el tamaño de la letra se mueve y la letra se
 * mueve. Si algo no gusta, el botón de volver a los valores de fábrica está al
 * final de cada bloque.
 */
import React, { useEffect, useState } from 'react'
import {
  Palette, Type, ShieldCheck, ShieldAlert, Check, RotateCcw, Languages, Ruler,
  Eye, Lock, Compass, FileLock2, GitBranch, FolderOpen, Layers, Gauge
} from 'lucide-react'
import { Panel, PanelHeader, Button, Field, Select, Toggle, Input, cx, Badge } from '../components/ui'
import { CodeEditor } from '../components/Code'
import { FileIcon } from '../components/FileIcon'
import { usePrefs } from '../lib/prefs'
import { useT, LANGUAGES } from '../lib/i18n'
import { THEMES, UI_FONTS, CODE_FONTS, ACCENTS } from '../lib/themes'
import { DEFAULT_PANES } from '@shared/defaults'
import { useStore } from '../lib/store'
import type { Appearance as AppearanceSettings, EditorPrefs } from '@shared/types'

/* ------------------------------------------------------------------ *
 * Piezas sueltas                                                     *
 * ------------------------------------------------------------------ */

/** Un control numérico con su barra y su cifra, que es como se entiende. */
function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-[11.5px] uppercase tracking-wide text-dim font-medium">{label}</span>
        <span className="num text-[12px] text-muted">
          {value}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)] cursor-pointer"
      />
      {hint ? <div className="text-[11.5px] text-dim mt-1">{hint}</div> : null}
    </label>
  )
}

/** Botonera de opciones excluyentes: más rápida de leer que un desplegable. */
function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wide text-dim mb-1.5 font-medium">{label}</div>
      <div className="flex items-center gap-1 p-1 bg-raised border border-line rounded-lg">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cx(
              'flex-1 px-2 h-7 rounded-md text-[12px] transition-colors',
              value === o.id ? 'bg-hover text-ink' : 'text-muted hover:text-ink'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <div className="text-[11.5px] text-dim mt-1.5">{hint}</div> : null}
    </div>
  )
}

/**
 * Muestra de un tema: los colores que lo distinguen, no un nombre a secas.
 * Es la diferencia entre elegir a ojo y elegir a ciegas.
 */
function ThemeCard({
  id,
  name,
  on,
  onPick
}: {
  id: string
  name: string
  on: boolean
  onPick: () => void
}): React.JSX.Element {
  const theme = THEMES.find((t) => t.id === id)!
  const { ui, tokens } = theme
  return (
    <button
      onClick={onPick}
      className={cx(
        'rounded-xl border overflow-hidden text-left transition-colors',
        on ? 'border-accent' : 'border-line hover:border-muted/40'
      )}
      style={{ background: ui.panel }}
    >
      <div className="px-2.5 pt-2.5 pb-2" style={{ background: ui.editorBg }}>
        <div className="flex gap-1 mb-1.5">
          <span className="h-1.5 w-6 rounded-full" style={{ background: tokens.key }} />
          <span className="h-1.5 w-9 rounded-full" style={{ background: tokens.str }} />
          <span className="h-1.5 w-4 rounded-full" style={{ background: tokens.num }} />
        </div>
        <div className="flex gap-1 mb-1.5 pl-3">
          <span className="h-1.5 w-8 rounded-full" style={{ background: tokens.fn }} />
          <span className="h-1.5 w-5 rounded-full" style={{ background: tokens.typ }} />
        </div>
        <div className="flex gap-1 pl-3">
          <span className="h-1.5 w-12 rounded-full" style={{ background: tokens.com }} />
        </div>
      </div>
      <div
        className="px-2.5 py-2 flex items-center justify-between gap-2 border-t"
        style={{ borderColor: ui.line }}
      >
        <span className="text-[11.5px] truncate" style={{ color: ui.ink }}>
          {name}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: ui.accent }} />
          {on ? <Check size={12} style={{ color: ui.accent }} /> : null}
        </span>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Apariencia                                                         *
 * ------------------------------------------------------------------ */

export function AppearanceTab(): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const { lang, appearance, panes, setLanguage, setAppearance, resetAppearance, resetPanes } = usePrefs()
  const a = appearance

  const set = <K extends keyof AppearanceSettings>(k: K, v: AppearanceSettings[K]): void =>
    setAppearance({ [k]: v } as Partial<AppearanceSettings>)

  // Sólo cuentan los paneles que el usuario ha movido de verdad, no los que
  // siguen en su tamaño de fábrica.
  const moved = Object.entries(panes).filter(([k, v]) => v !== DEFAULT_PANES[k]).length

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader title={t('appearance.language')} icon={<Languages size={14} />} subtitle={t('appearance.language.hint')} />
        <div className="p-4 grid grid-cols-2 gap-4">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              onClick={() => setLanguage(l.id)}
              className={cx(
                'px-3 py-2.5 rounded-lg border text-left transition-colors',
                lang === l.id ? 'border-accent bg-accent/10' : 'border-line bg-raised hover:bg-hover'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px]">{l.native}</span>
                {lang === l.id ? <Check size={13} className="text-accent" /> : null}
              </div>
              <div className="text-[11px] text-dim mt-0.5">{l.label}</div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={t('appearance.theme')} icon={<Palette size={14} />} subtitle={t('appearance.theme.hint')} />
        <div className="p-4 grid grid-cols-4 gap-2.5">
          {THEMES.map((th) => (
            <ThemeCard key={th.id} id={th.id} name={th.name} on={a.theme === th.id} onPick={() => set('theme', th.id)} />
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={t('appearance.accent')} icon={<Layers size={14} />} subtitle={t('appearance.accent.hint')} />
        <div className="p-4 flex items-center gap-2 flex-wrap">
          {ACCENTS.map((c) => (
            <button
              key={c.value || 'theme'}
              onClick={() => set('accent', c.value)}
              title={c.label}
              className={cx(
                'w-8 h-8 rounded-lg border flex items-center justify-center transition-colors',
                (a.accent ?? '') === c.value ? 'border-ink' : 'border-line hover:border-muted/50'
              )}
              style={c.value ? { background: c.value } : undefined}
            >
              {c.value ? null : <span className="text-[10px] text-dim">auto</span>}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-[11.5px] text-dim cursor-pointer">
            {t('appearance.accent.custom')}
            <input
              type="color"
              value={a.accent || '#22d3ee'}
              onChange={(e) => set('accent', e.target.value)}
              className="w-8 h-8 rounded-lg bg-transparent border border-line cursor-pointer"
            />
          </label>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={t('appearance.title')} icon={<Gauge size={14} />} subtitle={t('appearance.subtitle')} />
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('appearance.uiFont')}>
              <Select value={a.uiFont} onChange={(e) => set('uiFont', e.target.value)}>
                {UI_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Slider
              label={t('appearance.uiFontSize')}
              value={a.uiFontSize}
              min={11}
              max={17}
              step={0.5}
              unit="px"
              onChange={(v) => set('uiFontSize', v)}
            />
          </div>

          <Slider
            label={t('appearance.uiScale')}
            hint={t('appearance.uiFontSize.hint')}
            value={a.uiScale}
            min={70}
            max={160}
            step={5}
            unit="%"
            onChange={(v) => set('uiScale', v)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Choice
              label={t('appearance.density')}
              value={a.density}
              onChange={(v) => set('density', v)}
              options={[
                { id: 'compact', label: t('appearance.density.compact') },
                { id: 'cozy', label: t('appearance.density.cozy') },
                { id: 'comfortable', label: t('appearance.density.comfortable') }
              ]}
            />
            <Choice
              label={t('appearance.corners')}
              value={a.corners}
              onChange={(v) => set('corners', v)}
              options={[
                { id: 'sharp', label: t('appearance.corners.sharp') },
                { id: 'soft', label: t('appearance.corners.soft') },
                { id: 'round', label: t('appearance.corners.round') }
              ]}
            />
          </div>

          <Slider
            label={t('appearance.panelOpacity')}
            value={Math.round(a.panelOpacity * 100)}
            min={60}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => set('panelOpacity', v / 100)}
          />

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Toggle
              checked={a.animations}
              onChange={(v) => set('animations', v)}
              label={t('appearance.animations')}
            />
            <Toggle checked={a.backgroundGrid} onChange={(v) => set('backgroundGrid', v)} label={t('appearance.grid')} />
            <Toggle
              checked={a.slimScrollbars}
              onChange={(v) => set('slimScrollbars', v)}
              label={t('appearance.scrollbars')}
            />
          </div>
          <p className="text-[11.5px] text-dim leading-relaxed">{t('appearance.animations.hint')}</p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={t('appearance.panes')} icon={<Ruler size={14} />} subtitle={t('appearance.panes.hint')} />
        <div className="p-4 flex items-center justify-between gap-4">
          <span className="text-[12.5px] text-muted">{t('appearance.panes.count', { n: moved })}</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={moved === 0}
              onClick={() => {
                resetPanes()
                toast('ok', t('appearance.panes.reset'))
              }}
            >
              <RotateCcw size={12} /> {t('appearance.panes.reset')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                resetAppearance()
                toast('ok', t('appearance.resetDone'))
              }}
            >
              {t('appearance.reset')}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Editor                                                             *
 * ------------------------------------------------------------------ */

/** Un trozo de código con un poco de todo, para ver el efecto de cada ajuste. */
const SAMPLE = `// Con este trozo se ve el efecto de cada ajuste.
import { readFile } from 'node:fs/promises'

interface Cuenta {
  id: string
  saldo: number
  activa: boolean
}

export async function cargar(ruta: string): Promise<Cuenta[]> {
  const texto = await readFile(ruta, 'utf8')
  const filas = JSON.parse(texto) as Cuenta[]

  return filas
    .filter((c) => c.activa && c.saldo > 0)
    .map((c) => ({ ...c, saldo: Math.round(c.saldo * 100) / 100 }))
}
`

export function EditorTab(): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const { editor, setEditor, resetEditor } = usePrefs()
  const [sample, setSample] = useState(SAMPLE)
  const e = editor

  const set = <K extends keyof EditorPrefs>(k: K, v: EditorPrefs[K]): void =>
    setEditor({ [k]: v } as Partial<EditorPrefs>)

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader title={t('editor.title')} icon={<Type size={14} />} subtitle={t('editor.subtitle')} />
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('editor.font')}>
              <Select value={e.fontFamily} onChange={(ev) => set('fontFamily', ev.target.value)}>
                {CODE_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('editor.syntaxTheme')} hint={t('editor.syntaxTheme.hint')}>
              <Select value={e.syntaxTheme ?? ''} onChange={(ev) => set('syntaxTheme', ev.target.value)}>
                <option value="">{t('editor.sameAsApp')}</option>
                {THEMES.map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Slider label={t('editor.fontSize')} value={e.fontSize} min={9} max={22} step={0.5} unit="px" onChange={(v) => set('fontSize', v)} />
            <Slider label={t('editor.lineHeight')} value={e.lineHeight} min={1} max={2.4} step={0.05} onChange={(v) => set('lineHeight', v)} />
            <Slider
              label={t('editor.letterSpacing')}
              value={e.letterSpacing}
              min={-0.5}
              max={2}
              step={0.1}
              unit="px"
              onChange={(v) => set('letterSpacing', v)}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Slider label={t('editor.tabSize')} value={e.tabSize} min={1} max={8} onChange={(v) => set('tabSize', v)} />
            <Choice
              label={t('editor.lineNumbers')}
              value={e.lineNumbers}
              onChange={(v) => set('lineNumbers', v)}
              options={[
                { id: 'off', label: t('editor.lineNumbers.off') },
                { id: 'on', label: t('editor.lineNumbers.on') },
                { id: 'relative', label: t('editor.lineNumbers.relative') }
              ]}
            />
            <Choice
              label={t('editor.cursorStyle')}
              value={e.cursorStyle}
              onChange={(v) => set('cursorStyle', v)}
              options={[
                { id: 'line', label: t('editor.cursorStyle.line') },
                { id: 'block', label: t('editor.cursorStyle.block') },
                { id: 'underline', label: t('editor.cursorStyle.underline') }
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Choice
              label={t('editor.wordWrap')}
              value={e.wordWrap}
              onChange={(v) => set('wordWrap', v)}
              options={[
                { id: 'off', label: t('editor.wordWrap.off') },
                { id: 'on', label: t('editor.wordWrap.on') },
                { id: 'bounded', label: t('editor.wordWrap.bounded') }
              ]}
            />
            {e.wordWrap === 'bounded' ? (
              <Slider label={t('editor.wrapColumn')} value={e.wrapColumn} min={40} max={200} step={4} onChange={(v) => set('wrapColumn', v)} />
            ) : (
              <Field label={t('editor.ruler')} hint={t('editor.ruler.hint')}>
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={e.rulerColumn}
                  onChange={(ev) => set('rulerColumn', Math.max(0, Math.min(240, Number(ev.target.value) || 0)))}
                  className="num"
                />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1">
            <Toggle checked={e.insertSpaces} onChange={(v) => set('insertSpaces', v)} label={t('editor.insertSpaces')} />
            <Toggle checked={e.ligatures} onChange={(v) => set('ligatures', v)} label={t('editor.ligatures')} />
            <Toggle checked={e.indentGuides} onChange={(v) => set('indentGuides', v)} label={t('editor.indentGuides')} />
            <Toggle
              checked={e.bracketPairColorization}
              onChange={(v) => set('bracketPairColorization', v)}
              label={t('editor.brackets')}
            />
            <Toggle
              checked={e.highlightActiveLine}
              onChange={(v) => set('highlightActiveLine', v)}
              label={t('editor.activeLine')}
            />
            <Toggle checked={e.renderWhitespace} onChange={(v) => set('renderWhitespace', v)} label={t('editor.whitespace')} />
            <Toggle checked={e.minimap} onChange={(v) => set('minimap', v)} label={t('editor.minimap')} />
            <Toggle checked={e.cursorBlink} onChange={(v) => set('cursorBlink', v)} label={t('editor.cursorBlink')} />
            <Toggle
              checked={e.autoClosingBrackets}
              onChange={(v) => set('autoClosingBrackets', v)}
              label={t('editor.autoClose')}
            />
            <Toggle checked={e.autoIndent} onChange={(v) => set('autoIndent', v)} label={t('editor.autoIndent')} />
            <Toggle
              checked={e.scrollBeyondLastLine}
              onChange={(v) => set('scrollBeyondLastLine', v)}
              label={t('editor.scrollBeyond')}
            />
          </div>
          <p className="text-[11.5px] text-dim">{t('editor.ligatures.hint')}</p>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title={t('editor.preview')} icon={<Eye size={14} />} />
        {/* El ejemplo es el editor de verdad, no una foto suya: lo que se ve
            aquí es exactamente lo que se verá al abrir un fichero, y se puede
            escribir dentro para probar el tabulador o el cierre de comillas. */}
        <div className="h-[300px] flex">
          <CodeEditor value={sample} onChange={setSample} lang="ts" />
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            resetEditor()
            setSample(SAMPLE)
            toast('ok', t('editor.resetDone'))
          }}
        >
          <RotateCcw size={12} /> {t('editor.reset')}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Seguridad                                                          *
 * ------------------------------------------------------------------ */

interface Report {
  contextIsolation: boolean
  nodeIntegration: boolean
  sandboxedRenderer: boolean
  csp: boolean
  navigationLocked: boolean
  permissionsDenied: boolean
  encryptionAvailable: boolean
  packaged: boolean
  dataDir: string
}

function Row({
  ok,
  icon,
  title,
  detail
}: {
  ok: boolean
  icon: React.ReactNode
  title: string
  detail: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="px-4 py-3 border-b border-line-soft last:border-0 flex items-start gap-3">
      <span className={cx('mt-0.5 shrink-0', ok ? 'text-ok' : 'text-warn')}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{title}</span>
          <Badge tone={ok ? 'ok' : 'warn'}>{ok ? t('security.ok') : t('security.warn')}</Badge>
        </div>
        <div className="text-[11.5px] text-dim mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  )
}

export function SecurityTab(): React.JSX.Element {
  const t = useT()
  const [report, setReport] = useState<Report | null>(null)

  const load = (): void => {
    void window.api.app.security().then((r) => {
      if (r.ok && r.data) setReport(r.data)
    })
  }

  useEffect(load, [])

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          title={t('security.title')}
          subtitle={t('security.subtitle')}
          icon={<ShieldCheck size={14} />}
          right={
            <Button size="sm" onClick={load}>
              <RotateCcw size={12} /> {t('security.audit')}
            </Button>
          }
        />
        {!report ? (
          <div className="px-4 py-6 text-[12.5px] text-dim">{t('common.loading')}</div>
        ) : (
          <div>
            <Row
              ok={report.encryptionAvailable}
              icon={report.encryptionAvailable ? <Lock size={15} /> : <ShieldAlert size={15} />}
              title={t('security.keys')}
              detail={report.encryptionAvailable ? t('security.keys.encrypted') : t('security.keys.fallback')}
            />
            <Row
              ok={report.contextIsolation && !report.nodeIntegration && report.sandboxedRenderer}
              icon={<Layers size={15} />}
              title={t('security.sandbox')}
              detail={[
                `contextIsolation: ${report.contextIsolation ? 'on' : 'off'}`,
                `nodeIntegration: ${report.nodeIntegration ? 'on' : 'off'}`,
                `sandbox: ${report.sandboxedRenderer ? 'on' : 'off'}`
              ].join(' · ')}
            />
            <Row ok={report.csp} icon={<ShieldCheck size={15} />} title={t('security.csp')} detail={t('security.csp.on')} />
            <Row
              ok={report.navigationLocked}
              icon={<Compass size={15} />}
              title={t('security.nav')}
              detail={t('security.nav.on')}
            />
            <Row
              ok={report.permissionsDenied}
              icon={<Eye size={15} />}
              title={t('security.permissions')}
              detail={t('security.permissions.on')}
            />
            <Row ok icon={<FileLock2 size={15} />} title={t('security.files')} detail={t('security.files.on')} />
            <Row ok icon={<GitBranch size={15} />} title={t('security.git')} detail={t('security.git.on')} />
          </div>
        )}
      </Panel>

      {report ? (
        <Panel>
          <PanelHeader title={t('security.dataDir')} icon={<FolderOpen size={14} />} />
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-mono text-[11.5px] text-muted truncate">{report.dataDir}</div>
              <div className="text-[11px] text-dim mt-1 flex items-center gap-1.5">
                <FileIcon name="secrets.json" size={13} />
                {report.packaged ? t('aplicación instalada') : t('ejecutándose desde el código fuente')}
              </div>
            </div>
            <Button size="sm" onClick={() => void window.api.app.openDataDir()}>
              <FolderOpen size={13} /> {t('security.dataDir')}
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
