/**
 * «Deshacer este turno»: devuelve el repositorio a como estaba antes de que
 * el agente empezara. Primero enseña qué ficheros vuelven y cuáles se borran;
 * al confirmar, main guarda una foto de cómo está ahora (por si te
 * arrepientes) y sólo entonces toca el árbol de trabajo.
 */
import React, { useState } from 'react'
import { RotateCcw, AlertTriangle, FileMinus, FileClock } from 'lucide-react'
import { Button, Modal, Badge } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import type { RunCheckpoint } from '@shared/types'

interface Preview {
  restore: string[]
  remove: string[]
  headMoved: boolean
}

export function UndoTurn({
  runId,
  checkpoint,
  undone,
  onUndone
}: {
  runId: string
  checkpoint: RunCheckpoint
  undone?: boolean
  /** true al deshacer, false al rehacer. */
  onUndone: (undone: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const show = async (): Promise<void> => {
    setOpen(true)
    setLoading(true)
    setPreview(null)
    const r = await window.api.checkpoints.preview(checkpoint.root, runId)
    setLoading(false)
    if (r.ok && r.data) setPreview(r.data)
    else {
      setOpen(false)
      toast('error', r.error ?? t('Este turno ya no tiene punto de control'))
    }
  }

  const undo = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.checkpoints.undo(checkpoint.root, runId)
    setBusy(false)
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo deshacer'))
      return
    }
    setOpen(false)
    onUndone(true)
    const safety = r.data.safetyId
    toast(
      'ok',
      t('Turno deshecho: {restored} ficheros restaurados y {removed} borrados.', {
        restored: r.data.restore.length,
        removed: r.data.remove.length
      }),
      safety
        ? {
            label: t('Rehacer'),
            // Se vuelve a la foto que se guardó justo antes de deshacer.
            run: () =>
              void window.api.checkpoints.undo(checkpoint.root, safety).then((back) => {
                if (back.ok) {
                  onUndone(false)
                  toast('ok', t('Todo vuelve a estar como antes de deshacer'))
                } else toast('error', back.error ?? t('No se pudo rehacer'))
              })
          }
        : undefined
    )
  }

  if (undone) {
    return (
      <Badge tone="neutral" title={t('Se deshizo este turno; lo de antes de deshacer quedó guardado')}>
        <RotateCcw size={10} /> {t('deshecho')}
      </Badge>
    )
  }

  const nothing = preview && !preview.restore.length && !preview.remove.length

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => void show()} title={t('Devolver el repositorio a como estaba antes de este turno')}>
        <RotateCcw size={12} /> {t('Deshacer este turno')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('Deshacer este turno')}
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" loading={busy} disabled={!preview || Boolean(nothing)} onClick={() => void undo()}>
              <RotateCcw size={13} /> {t('Deshacer')}
            </Button>
          </>
        }
      >
        {loading || !preview ? (
          <div className="text-[12.5px] text-dim">{t('Comparando con la foto de antes del turno…')}</div>
        ) : nothing ? (
          <div className="text-[12.5px] text-muted">{t('No hay nada que deshacer: el repositorio está como antes del turno.')}</div>
        ) : (
          <div className="space-y-3 text-[12.5px]">
            <p className="text-muted leading-relaxed">
              {t('Los ficheros vuelven a como estaban antes de que el agente empezara, incluido lo que tuvieras sin confirmar. Antes se guarda una foto de cómo está todo ahora, por si quieres volver.')}
            </p>
            {preview.restore.length ? (
              <div>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-dim mb-1">
                  <FileClock size={12} /> {t('Vuelven a como estaban ({n})', { n: preview.restore.length })}
                </div>
                <FileList files={preview.restore} />
              </div>
            ) : null}
            {preview.remove.length ? (
              <div>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-bad mb-1">
                  <FileMinus size={12} /> {t('Se borran: los creó el turno ({n})', { n: preview.remove.length })}
                </div>
                <FileList files={preview.remove} />
              </div>
            ) : null}
            {preview.headMoved ? (
              <div className="flex items-start gap-2 text-warn text-[12px] leading-relaxed">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {t('El agente hizo commits durante el turno. Esos commits no se tocan: los ficheros vuelven, pero la historia se queda como está.')}
              </div>
            ) : null}
            <p className="text-[11px] text-dim leading-relaxed">
              {t('Lo que esté en .gitignore no entra en la foto, así que no se restaura.')}
            </p>
          </div>
        )}
      </Modal>
    </>
  )
}

export function FileList({ files }: { files: string[] }): React.JSX.Element {
  return (
    <div className="max-h-[160px] overflow-y-auto bg-void border border-line rounded-lg px-2.5 py-1.5 font-mono text-[11.5px] text-muted">
      {files.map((f) => (
        <div key={f} className="truncate">
          {f}
        </div>
      ))}
    </div>
  )
}
