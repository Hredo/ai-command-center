/**
 * Editar un mensaje o regenerar una respuesta.
 *
 * La conversación vuelve a ese mensaje y se manda de nuevo, con el texto que
 * dejes. Antes de hacerlo se dice qué se quita, y si los turnos quitados
 * cambiaron archivos se ofrece devolverlos a como estaban (lo mismo que
 * «Deshacer este turno», con su foto de seguridad). También se puede hacer en
 * una copia y dejar la conversación como está.
 */
import React, { useEffect, useState } from 'react'
import { AlertTriangle, FileClock, FileMinus, RefreshCw, Send } from 'lucide-react'
import { Button, Modal, Textarea, Toggle } from './ui'
import { FileList } from './UndoTurn'
import { planRewind, rewindAndSend, type RewindPlan } from '../lib/engine'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'

interface Preview {
  restore: string[]
  remove: string[]
  headMoved: boolean
}

export function RewindModal({
  sessionId,
  turnId,
  mode,
  title,
  onClose,
  onStarted
}: {
  sessionId: string
  turnId: string
  mode: 'edit' | 'regenerate'
  /** Título de la conversación, para nombrar la copia. */
  title: string
  onClose: () => void
  /** Ya se está mandando, en esta conversación o en la copia. */
  onStarted: (sessionId: string) => void
}): React.JSX.Element {
  const t = useT()
  const { config, toast } = useStore()
  const [plan] = useState<RewindPlan | null>(() => planRewind(sessionId, turnId))
  const [text, setText] = useState(plan?.prompt ?? '')
  const [undoFiles, setUndoFiles] = useState(false)
  const [inCopy, setInCopy] = useState(false)
  const [previews, setPreviews] = useState<Preview[] | null>(null)
  const [busy, setBusy] = useState(false)

  // Qué archivos volverían atrás, por repositorio.
  useEffect(() => {
    if (!plan?.checkpoints.length) return
    let alive = true
    void Promise.all(plan.checkpoints.map((c) => window.api.checkpoints.preview(c.root, c.runId))).then((rs) => {
      if (alive) setPreviews(rs.map((r) => (r.ok && r.data ? r.data : { restore: [], remove: [], headMoved: false })))
    })
    return () => {
      alive = false
    }
  }, [plan])

  const restore = (previews ?? []).flatMap((p) => p.restore)
  const remove = (previews ?? []).flatMap((p) => p.remove)
  const headMoved = (previews ?? []).some((p) => p.headMoved)
  const filesPending = Boolean(plan?.checkpoints.length) && previews === null
  const anyFiles = restore.length + remove.length > 0

  const go = async (): Promise<void> => {
    if (!plan || !config || !text.trim()) return
    setBusy(true)
    let started = false
    const r = await rewindAndSend(sessionId, turnId, text, config, {
      undoFiles: undoFiles && anyFiles,
      inCopy,
      copyTitle: t('{title} (copia)', { title }),
      onStart: (id) => {
        started = true
        onStarted(id)
      }
    })
    setBusy(false)
    if (!started) {
      toast('error', t(r.error ?? 'No se pudo completar'))
      return
    }
    if (r.error) toast('error', t(r.error))
    else if (r.run?.status === 'error') toast('error', r.run.error ?? t('No se pudo completar'))
  }

  const later = plan ? plan.dropped - 1 : 0

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'edit' ? t('Editar y reenviar') : t('Regenerar la respuesta')}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!plan || !text.trim() || filesPending} onClick={() => void go()} data-rewind-go>
            {mode === 'edit' ? <Send size={13} /> : <RefreshCw size={13} />} {mode === 'edit' ? t('Reenviar') : t('Regenerar')}
          </Button>
        </>
      }
    >
      {!plan ? (
        <div className="text-[12.5px] text-muted">{t('Ese mensaje ya no está en la conversación')}</div>
      ) : (
        <div className="space-y-3.5 text-[12.5px]" data-rewind>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
            className="text-[13px] leading-relaxed"
            autoFocus={mode === 'edit'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void go()
              }
            }}
          />
          {plan.attachments?.length ? (
            <p className="text-[11.5px] text-dim">{t('Se vuelve a mandar con sus {n} adjuntos.', { n: plan.attachments.length })}</p>
          ) : null}

          <p className="text-muted leading-relaxed" data-rewind-dropped={plan.dropped}>
            {inCopy
              ? t('Se hace en una conversación nueva con todo lo anterior a este mensaje. Esta se queda como está.')
              : later > 1
                ? t('Este mensaje y los {n} que vienen detrás salen de la conversación y se manda de nuevo.', { n: later })
                : later === 1
                  ? t('Este mensaje y la respuesta que le sigue salen de la conversación y se manda de nuevo.')
                  : t('Este mensaje sale de la conversación y se manda de nuevo.')}
          </p>

          {plan.isCli ? (
            <div className="flex items-start gap-2 text-[12px] text-dim leading-relaxed">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-warn" />
              {t('El agente de consola no puede volver atrás en su propia sesión: empieza una nueva y recibe la conversación hasta aquí dentro del prompt.')}
            </div>
          ) : null}

          {plan.checkpoints.length ? (
            <div className="rounded-lg border border-line bg-void/40 px-3 py-2.5 space-y-2.5" data-rewind-files>
              {filesPending ? (
                <div className="text-dim">{t('Comparando con la foto de antes del turno…')}</div>
              ) : anyFiles ? (
                <>
                  <Toggle
                    checked={undoFiles}
                    onChange={setUndoFiles}
                    label={t('Devolver también los archivos a como estaban antes de ese turno')}
                  />
                  <p className="text-[11.5px] text-dim leading-relaxed">
                    {t('Los turnos que se quitan cambiaron archivos. Si no lo marcas, los cambios se quedan en disco y la respuesta nueva parte de ellos. Si lo marcas, se deshace como con «Deshacer este turno», con una foto de antes por si quieres volver.')}
                  </p>
                  {undoFiles ? (
                    <div className="space-y-2">
                      {restore.length ? (
                        <div>
                          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-dim mb-1">
                            <FileClock size={12} /> {t('Vuelven a como estaban ({n})', { n: restore.length })}
                          </div>
                          <FileList files={restore} />
                        </div>
                      ) : null}
                      {remove.length ? (
                        <div>
                          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-bad mb-1">
                            <FileMinus size={12} /> {t('Se borran: los creó el turno ({n})', { n: remove.length })}
                          </div>
                          <FileList files={remove} />
                        </div>
                      ) : null}
                      {headMoved ? (
                        <div className="flex items-start gap-2 text-warn text-[12px] leading-relaxed">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                          {t('El agente hizo commits durante el turno. Esos commits no se tocan: los ficheros vuelven, pero la historia se queda como está.')}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-dim">{t('Los archivos ya están como antes de esos turnos.')}</div>
              )}
            </div>
          ) : null}

          <Toggle checked={inCopy} onChange={setInCopy} label={t('Hacerlo en una copia y conservar esta conversación')} />
        </div>
      )}
    </Modal>
  )
}
