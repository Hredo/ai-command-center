/**
 * Worktrees de un proyecto: cómo se preparan los nuevos y los que hay.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { FolderGit2, FolderOpen, Trash2, RefreshCw } from 'lucide-react'
import { Button, Badge, Field, Input, Modal } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { relTime } from '../lib/format'
import type { Project, WorktreeInfo } from '@shared/types'

export function ProjectWorktrees({
  project,
  onPatch
}: {
  project: Project
  onPatch: (patch: Partial<Project>) => void
}): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [list, setList] = useState<WorktreeInfo[] | null>(null)
  const [confirm, setConfirm] = useState<WorktreeInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await window.api.worktrees.list(project.path)
    setList(r.ok && r.data ? r.data.filter((w) => !w.main) : [])
  }, [project.path])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (w: WorktreeInfo): Promise<void> => {
    setBusy(true)
    const r = await window.api.worktrees.remove(w.path, { force: Boolean(w.dirty), deleteBranch: true })
    setBusy(false)
    setConfirm(null)
    if (!r.ok) toast('error', r.error ?? t('No se pudo quitar el worktree'))
    void load()
  }

  return (
    <div className="pt-2 border-t border-line space-y-3">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <FolderGit2 size={13} className="text-accent" /> {t('Worktrees')}
      </div>
      <Field
        label={t('Preparación de cada worktree nuevo')}
        hint={t('Se ejecuta dentro del worktree al crearlo, con tu shell. Vacío: nada.')}
      >
        <Input
          defaultValue={project.worktreeSetup ?? ''}
          placeholder="pnpm install"
          className="font-mono"
          onBlur={(e) => onPatch({ worktreeSetup: e.target.value.trim() || undefined })}
        />
      </Field>
      <Field
        label={t('Ficheros sin seguir que se copian')}
        hint={t('Separados por comas, relativos al proyecto. Lo típico: el .env, que no está en git.')}
      >
        <Input
          defaultValue={(project.worktreeCopy ?? []).join(', ')}
          placeholder=".env, .env.local"
          className="font-mono"
          onBlur={(e) => {
            const files = e.target.value
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean)
            onPatch({ worktreeCopy: files.length ? files : undefined })
          }}
        />
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-dim">{t('Los que hay')}</span>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            <RefreshCw size={12} />
          </Button>
        </div>
        {list === null ? (
          <div className="text-[12px] text-dim">{t('Leyendo…')}</div>
        ) : !list.length ? (
          <div className="text-[12px] text-dim">{t('Ninguno. Se crean desde la Consola con «Trabajar en un worktree aparte».')}</div>
        ) : (
          list.map((w) => (
            <div key={w.path} className="bg-raised border border-line rounded-lg px-3 py-2 flex items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] truncate">{w.label ?? w.branch ?? w.path}</div>
                <div className="text-[10.5px] text-dim truncate font-mono" title={w.path}>
                  {w.branch} · {w.path}
                </div>
                <div className="flex gap-1.5 pt-1 flex-wrap">
                  {w.dirty ? <Badge tone="warn">{t('{n} sin confirmar', { n: w.dirty })}</Badge> : null}
                  {w.ahead ? <Badge tone="accent">{t('{n} commits por delante', { n: w.ahead })}</Badge> : null}
                  {w.createdAt ? <span className="text-[10.5px] text-dim">{relTime(w.createdAt)}</span> : null}
                  {w.prunable ? <Badge tone="bad">{t('su carpeta ya no está')}</Badge> : null}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void window.api.projects.openFolder(w.path)} title={t('Abrir')}>
                <FolderOpen size={12} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(w)} title={t('Quitar')}>
                <Trash2 size={12} />
              </Button>
            </div>
          ))
        )}
      </div>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={t('Quitar el worktree')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => confirm && void remove(confirm)}>
              <Trash2 size={13} /> {confirm?.dirty ? t('Quitar y perder los cambios') : t('Quitar')}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted leading-relaxed">
          {t('Se borran la carpeta {path} y su rama {branch}. La carpeta del proyecto no se toca.', {
            path: confirm?.path ?? '',
            branch: confirm?.branch ?? ''
          })}
          {confirm?.dirty ? ' ' + t('Tiene {n} ficheros sin confirmar que se perderán.', { n: confirm.dirty }) : ''}
        </p>
      </Modal>
    </div>
  )
}
