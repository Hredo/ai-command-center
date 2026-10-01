/**
 * El worktree de una conversación: crearlo, ver cómo va, fusionarlo en tu
 * rama o quitarlo. Mientras la conversación tiene uno, cada turno del agente
 * trabaja allí y no en la carpeta del proyecto.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { GitBranch, FolderOpen, GitMerge, Trash2, FolderGit2, AlertTriangle } from 'lucide-react'
import { Button, Modal, Input, Badge, Toggle } from './ui'
import { useStore } from '../lib/store'
import { patchSessionConfig } from '../lib/engine'
import { useT } from '../lib/i18n'
import type { Project, StoredSession, WorktreeInfo } from '@shared/types'

export function samePath(a: string, b: string): boolean {
  const n = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/$/, '')
  return /^[a-z]:/i.test(a) ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b)
}

export function WorktreeBox({
  session,
  project,
  onChanged
}: {
  session: StoredSession
  project: Project
  onChanged?: () => void
}): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [info, setInfo] = useState<WorktreeInfo | null>(null)
  const [busy, setBusy] = useState<'create' | 'merge' | 'remove' | null>(null)
  const [merging, setMerging] = useState(false)
  const [message, setMessage] = useState('')
  const [removing, setRemoving] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(true)

  const load = useCallback(async () => {
    if (!session.worktreePath) {
      setInfo(null)
      return
    }
    const r = await window.api.worktrees.list(project.path)
    const found = r.ok ? r.data?.find((w) => samePath(w.path, session.worktreePath!)) : undefined
    setInfo(found ?? null)
  }, [project.path, session.worktreePath])

  useEffect(() => {
    void load()
  }, [load, session.turns.length])

  const create = async (): Promise<void> => {
    setBusy('create')
    const label = session.title && session.turns.length ? session.title : t('tarea')
    const r = await window.api.worktrees.create(project.path, { label, projectId: project.id, sessionId: session.id })
    setBusy(null)
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo crear el worktree'))
      return
    }
    // La sesión propia del agente es de la otra carpeta: el siguiente turno
    // empieza allí con la conversación dentro del prompt.
    patchSessionConfig(session.id, { worktreePath: r.data.path, cliSessionId: undefined })
    setInfo(r.data)
    onChanged?.()
    if (r.data.setup && !r.data.setup.ok) {
      toast('error', t('El worktree está creado, pero su preparación falló: {cmd}', { cmd: r.data.setup.command }))
    } else toast('ok', t('Worktree listo en la rama {branch}', { branch: r.data.branch ?? '' }))
  }

  const merge = async (): Promise<void> => {
    if (!info) return
    setBusy('merge')
    const r = await window.api.worktrees.merge(info.path, { message: message.trim() || undefined })
    setBusy(null)
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo fusionar'))
      return
    }
    setMerging(false)
    onChanged?.()
    void load()
    if (r.data.ok) toast('ok', t('Fusionado en tu rama. El worktree sigue ahí por si hay más.'))
    else
      toast(
        'error',
        r.data.conflicts?.length
          ? t('La fusión tiene conflictos en {n} ficheros: resuélvelos en la pestaña Git del proyecto.', { n: r.data.conflicts.length })
          : r.data.output
      )
  }

  const remove = async (force: boolean): Promise<void> => {
    if (!info) return
    setBusy('remove')
    const r = await window.api.worktrees.remove(info.path, { force, deleteBranch })
    setBusy(null)
    if (!r.ok) {
      toast('error', r.error ?? t('No se pudo quitar el worktree'))
      return
    }
    setRemoving(false)
    patchSessionConfig(session.id, { worktreePath: undefined, cliSessionId: undefined })
    setInfo(null)
    onChanged?.()
    toast('ok', t('Worktree quitado: la conversación vuelve a la carpeta del proyecto'))
  }

  if (!session.worktreePath) {
    return (
      <div className="border border-line rounded-lg p-3 space-y-2">
        <Button size="sm" loading={busy === 'create'} onClick={() => void create()}>
          <FolderGit2 size={13} /> {t('Trabajar en un worktree aparte')}
        </Button>
        <p className="text-[11px] text-dim leading-relaxed">
          {t('Una carpeta y una rama propias (acc/…) al lado del repositorio: tu carpeta no se toca y puedes tener varios agentes a la vez.')}
          {project.worktreeSetup ? ' ' + t('Al crearlo se ejecuta «{cmd}».', { cmd: project.worktreeSetup }) : ''}
        </p>
      </div>
    )
  }

  return (
    <div className="border border-accent/30 bg-accent/5 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] font-medium">
        <FolderGit2 size={13} className="text-accent" /> {t('En un worktree aparte')}
      </div>
      {info ? (
        <>
          <div className="text-[11px] text-dim space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <GitBranch size={11} /> <span className="font-mono text-muted truncate">{info.branch}</span>
            </div>
            <div className="font-mono truncate" title={info.path}>
              {info.path}
            </div>
            <div className="flex gap-1.5 pt-0.5 flex-wrap">
              {info.dirty ? <Badge tone="warn">{t('{n} sin confirmar', { n: info.dirty })}</Badge> : null}
              {info.ahead ? <Badge tone="accent">{t('{n} commits por delante', { n: info.ahead })}</Badge> : null}
              {!info.dirty && !info.ahead ? <Badge>{t('sin cambios')}</Badge> : null}
              {info.setup ? (
                <Badge tone={info.setup.ok ? 'ok' : 'bad'} title={info.setup.output}>
                  {info.setup.ok ? t('preparado') : t('preparación fallida')}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => void window.api.projects.openFolder(info.path)}>
              <FolderOpen size={12} /> {t('Abrir')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!info.dirty && !info.ahead}
              onClick={() => {
                setMessage(session.title ?? '')
                setMerging(true)
              }}
            >
              <GitMerge size={12} /> {t('Fusionar')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
              <Trash2 size={12} /> {t('Quitar')}
            </Button>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-warn leading-relaxed">
          {t('El worktree ya no existe. Quítalo de la conversación para volver a la carpeta del proyecto.')}
          <div className="pt-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => patchSessionConfig(session.id, { worktreePath: undefined, cliSessionId: undefined })}
            >
              {t('Volver a la carpeta del proyecto')}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={merging}
        onClose={() => setMerging(false)}
        title={t('Fusionar el worktree')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMerging(false)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="primary"
              loading={busy === 'merge'}
              disabled={Boolean(info?.dirty) && !message.trim()}
              onClick={() => void merge()}
            >
              <GitMerge size={13} /> {t('Fusionar')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12.5px]">
          <p className="text-muted leading-relaxed">
            {t('La rama {branch} se fusiona (merge --no-ff) en la rama en la que estás en la carpeta del proyecto.', {
              branch: info?.branch ?? ''
            })}
          </p>
          {info?.dirty ? (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-dim mb-1">
                {t('Antes se confirma lo pendiente con este mensaje')}
              </div>
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('Mensaje del commit')} />
            </div>
          ) : null}
          <p className="text-[11px] text-dim">
            {t('Si hay conflictos, la fusión se para y se resuelven en la pestaña Git del proyecto.')}
          </p>
        </div>
      </Modal>

      <Modal
        open={removing}
        onClose={() => setRemoving(false)}
        title={t('Quitar el worktree')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" loading={busy === 'remove'} onClick={() => void remove(Boolean(info?.dirty))}>
              <Trash2 size={13} /> {info?.dirty ? t('Quitar y perder los cambios') : t('Quitar')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12.5px]">
          <p className="text-muted leading-relaxed">{t('Se borra la carpeta del worktree. La carpeta del proyecto no se toca.')}</p>
          {info?.dirty ? (
            <div className="flex items-start gap-2 text-warn leading-relaxed">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              {t('Tiene {n} ficheros sin confirmar que se perderán. Si quieres conservarlos, fusiónalo antes.', { n: info.dirty })}
            </div>
          ) : null}
          <Toggle
            checked={deleteBranch}
            onChange={setDeleteBranch}
            label={t('Borrar también la rama {branch}', { branch: info?.branch ?? '' })}
          />
        </div>
      </Modal>
    </div>
  )
}
