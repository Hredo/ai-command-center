/**
 * Las instrucciones de un proyecto para los agentes: AGENTS.md, CLAUDE.md y
 * GEMINI.md. Se editan aquí y, si quieres, CLAUDE.md y GEMINI.md se guardan
 * como copia de AGENTS.md, para que todos los agentes sigan las mismas reglas
 * sin tener que acordarte de copiar a mano.
 *
 * Nunca se pisa lo que haya cambiado otro: si un agente tocó el fichero
 * mientras lo tenías abierto, guardar falla y te pide recargar.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Save, RefreshCw, Link2, Copy, AlertTriangle } from 'lucide-react'
import { Button, Badge, Textarea, Toggle, Modal, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { withMod } from '../lib/platform'
import type { InstructionFile, Project } from '@shared/types'

/** Quién lee cada fichero. */
const READERS: Record<string, string> = {
  'AGENTS.md': 'Codex, OpenCode, Copilot y los agentes por API de esta app',
  'CLAUDE.md': 'Claude Code (y los agentes por API de esta app)',
  'GEMINI.md': 'Gemini CLI'
}

const MIRRORABLE = ['CLAUDE.md', 'GEMINI.md']

export function InstructionsEditor({
  project,
  onPatch
}: {
  project: Project
  onPatch: (patch: Partial<Project>) => void
}): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [files, setFiles] = useState<InstructionFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState('AGENTS.md')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [mirrorAsk, setMirrorAsk] = useState<string | null>(null)
  const mirror = useMemo(() => project.instructionsMirror ?? [], [project.instructionsMirror])

  const load = useCallback(async () => {
    const r = await window.api.instructions.read(project.path)
    if (!r.ok || !r.data) {
      setError(r.error ?? t('No se pudieron leer'))
      setFiles([])
      return
    }
    setError(null)
    setFiles(r.data)
    setDrafts({})
  }, [project.path, t])

  useEffect(() => {
    void load()
  }, [load])

  const file = files?.find((f) => f.file === active)
  const agents = files?.find((f) => f.file === 'AGENTS.md')
  const mirrored = mirror.includes(active)
  const text = drafts[active] ?? file?.content ?? ''
  const dirty = Object.keys(drafts).some((k) => drafts[k] !== files?.find((f) => f.file === k)?.content)

  // Si no hay cambios a medias, lo que cambie fuera (un agente) se ve al volver a la ventana.
  useEffect(() => {
    if (dirty) return
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [dirty, load])

  const save = async (): Promise<void> => {
    if (!files) return
    const content = text
    const writes = [{ file: active, content, expectedMtime: file?.mtimeMs ?? null }]
    // Guardar AGENTS.md guarda también sus copias.
    if (active === 'AGENTS.md') {
      for (const m of mirror) {
        const f = files.find((x) => x.file === m)
        if (f && f.content !== content) writes.push({ file: m, content, expectedMtime: f.mtimeMs })
      }
    }
    setSaving(true)
    const r = await window.api.instructions.write(project.path, writes)
    setSaving(false)
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo guardar'))
      return
    }
    setFiles(r.data)
    setDrafts({})
    toast('ok', writes.length > 1 ? t('Guardado {file} y sus copias', { file: active }) : t('Guardado {file}', { file: active }))
  }

  /** Activa una copia: si ya es igual, sin más; si no, pregunta cuál manda. */
  const toggleMirror = (name: string, on: boolean): void => {
    if (!on) {
      onPatch({ instructionsMirror: mirror.filter((m) => m !== name) })
      return
    }
    const f = files?.find((x) => x.file === name)
    if (f?.exists && f.content !== (agents?.content ?? '')) {
      setMirrorAsk(name)
      return
    }
    void applyMirror(name, 'agents')
  }

  const applyMirror = async (name: string, from: 'agents' | 'other'): Promise<void> => {
    if (!files) return
    const f = files.find((x) => x.file === name)!
    const a = files.find((x) => x.file === 'AGENTS.md')!
    const writes =
      from === 'agents'
        ? a.exists || f.exists
          ? [{ file: name, content: a.content, expectedMtime: f.mtimeMs }]
          : []
        : [
            { file: 'AGENTS.md', content: f.content, expectedMtime: a.mtimeMs },
            // Las otras copias de AGENTS.md siguen siéndolo.
            ...mirror
              .filter((m) => m !== name)
              .map((m) => files.find((x) => x.file === m)!)
              .filter((x) => x && x.content !== f.content)
              .map((x) => ({ file: x.file, content: f.content, expectedMtime: x.mtimeMs }))
          ]
    if (writes.length) {
      const r = await window.api.instructions.write(project.path, writes)
      if (!r.ok || !r.data) {
        toast('error', r.error ?? t('No se pudo guardar'))
        return
      }
      setFiles(r.data)
      setDrafts({})
    }
    setMirrorAsk(null)
    onPatch({ instructionsMirror: [...new Set([...mirror, name])] })
    if (from === 'other') setActive('AGENTS.md')
  }

  /** CLAUDE.md que sólo dice @AGENTS.md: Claude Code lo sustituye por AGENTS.md al leerlo. */
  const pointClaude = async (): Promise<void> => {
    const f = files?.find((x) => x.file === 'CLAUDE.md')
    const r = await window.api.instructions.write(project.path, [
      { file: 'CLAUDE.md', content: '@AGENTS.md\n', expectedMtime: f?.mtimeMs ?? null }
    ])
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo guardar'))
      return
    }
    setFiles(r.data)
    setDrafts({})
    onPatch({ instructionsMirror: mirror.filter((m) => m !== 'CLAUDE.md') })
    toast('ok', t('CLAUDE.md apunta ahora a AGENTS.md'))
  }

  if (!files) return <div className="text-[12px] text-dim">{t('Leyendo…')}</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <FileText size={13} className="text-accent" /> {t('Instrucciones para los agentes')}
      </div>
      <p className="text-[11.5px] text-dim leading-relaxed">
        {t('Las reglas del proyecto que lee cada agente al empezar. Los agentes por API de esta app leen AGENTS.md y CLAUDE.md.')}
      </p>
      {error ? <div className="text-[12px] text-bad">{error}</div> : null}

      <div className="flex items-center gap-1 flex-wrap">
        {files.map((f) => {
          const changed = drafts[f.file] !== undefined && drafts[f.file] !== f.content
          const copy = mirror.includes(f.file)
          const out = copy && f.content !== (agents?.content ?? '')
          return (
            <button
              key={f.file}
              onClick={() => setActive(f.file)}
              className={cx(
                'h-7 px-2.5 rounded-md border text-[12px] font-mono flex items-center gap-1.5',
                active === f.file ? 'border-accent-dim bg-raised text-ink' : 'border-line text-muted hover:text-ink'
              )}
            >
              {f.file}
              {changed ? <span className="w-1.5 h-1.5 rounded-full bg-warn" title={t('Sin guardar')} /> : null}
              {!f.exists ? <span className="text-[10px] text-dim font-sans">{t('no existe')}</span> : null}
              {copy ? <span className={cx('text-[10px] font-sans', out ? 'text-warn' : 'text-dim')}>{out ? t('distinto') : t('copia')}</span> : null}
            </button>
          )
        })}
        <Button size="sm" variant="ghost" onClick={() => void load()} title={t('Volver a leerlos del disco')}>
          <RefreshCw size={12} />
        </Button>
      </div>

      <div className="text-[11px] text-dim">
        {t('Lo lee: {who}', { who: t(READERS[active] ?? '') })}
      </div>

      {mirrored ? (
        <div className="border border-line rounded-lg p-3 space-y-2">
          <p className="text-[12px] text-muted leading-relaxed">
            {t('{file} se guarda como copia de AGENTS.md: edita AGENTS.md y se actualiza solo.', { file: active })}
          </p>
          {file && file.content !== (agents?.content ?? '') ? (
            <div className="flex items-center gap-2 text-[12px] text-warn">
              <AlertTriangle size={12} />
              <span className="flex-1">{t('Ahora mismo no son iguales: alguien lo cambió fuera de la app.')}</span>
              <Button size="sm" onClick={() => void applyMirror(active, 'agents')}>
                <Copy size={12} /> {t('Igualar con AGENTS.md')}
              </Button>
            </div>
          ) : null}
          <pre className="max-h-[320px] overflow-auto bg-void border border-line rounded-md p-3 text-[11.5px] font-mono whitespace-pre-wrap text-muted">
            {file?.content || t('(vacío)')}
          </pre>
        </div>
      ) : (
        <>
          <Textarea
            rows={16}
            value={text}
            placeholder={
              active === 'AGENTS.md'
                ? t('Cómo se trabaja en este proyecto: comandos, estilo, qué no tocar…')
                : t('Vacío. Guarda para crearlo.')
            }
            className="font-mono text-[12px] leading-relaxed"
            spellCheck={false}
            onChange={(e) => setDrafts((d) => ({ ...d, [active]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void save()
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              disabled={drafts[active] === undefined || drafts[active] === file?.content}
              onClick={() => void save()}
              title={withMod('S')}
            >
              <Save size={12} /> {file?.exists ? t('Guardar') : t('Crear {file}', { file: active })}
            </Button>
            {drafts[active] !== undefined && drafts[active] !== file?.content ? (
              <Button size="sm" variant="ghost" onClick={() => setDrafts((d) => ({ ...d, [active]: file?.content ?? '' }))}>
                {t('Descartar')}
              </Button>
            ) : null}
            {active === 'AGENTS.md' && mirror.length ? (
              <span className="text-[11px] text-dim">{t('Al guardar se copia también a {files}', { files: mirror.join(', ') })}</span>
            ) : null}
          </div>
        </>
      )}

      <div className="pt-2 border-t border-line space-y-2">
        {MIRRORABLE.map((m) => (
          <div key={m} className="flex items-center gap-2">
            <Toggle checked={mirror.includes(m)} onChange={(v) => toggleMirror(m, v)} label={t('{file} igual que AGENTS.md', { file: m })} />
          </div>
        ))}
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => void pointClaude()} title={t('CLAUDE.md sólo dirá @AGENTS.md: Claude Code lo lee como si fuera AGENTS.md')}>
            <Link2 size={12} /> {t('Que CLAUDE.md apunte a AGENTS.md')}
          </Button>
          {files.find((f) => f.file === 'CLAUDE.md')?.content.trim() === '@AGENTS.md' ? (
            <Badge tone="accent">{t('CLAUDE.md ya apunta a AGENTS.md')}</Badge>
          ) : null}
        </div>
      </div>

      <Modal
        open={Boolean(mirrorAsk)}
        onClose={() => setMirrorAsk(null)}
        title={t('{file} no es igual que AGENTS.md', { file: mirrorAsk ?? '' })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMirrorAsk(null)}>
              {t('Cancelar')}
            </Button>
            <Button onClick={() => mirrorAsk && void applyMirror(mirrorAsk, 'other')}>
              {t('Quedarme con {file}', { file: mirrorAsk ?? '' })}
            </Button>
            <Button variant="primary" onClick={() => mirrorAsk && void applyMirror(mirrorAsk, 'agents')}>
              {t('Quedarme con AGENTS.md')}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted leading-relaxed">
          {t('Para que sean copia uno del otro tiene que ganar uno. El que pierde se sobrescribe: si no está en git, lo que tenía se pierde.')}
        </p>
      </Modal>
    </div>
  )
}
