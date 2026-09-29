/**
 * Revisar lo que hizo un turno: su diff, con comentarios en las líneas que
 * quieras. Al enviar, los comentarios van al agente como el siguiente turno de
 * la misma conversación, cada uno con su fichero, su línea y el código.
 *
 * Los borradores se guardan mientras la app está abierta: cerrar la ventana de
 * revisión sin querer no tira lo escrito.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDiff, MessageSquarePlus, RefreshCw, Send, Trash2, ChevronRight, AlertTriangle } from 'lucide-react'
import { Button, Modal, Badge, Textarea, cx } from './ui'
import { useT } from '../lib/i18n'
import { parseDiff, composeReview, type DiffFile, type DiffLine, type ReviewComment } from '../lib/diff'
import type { RunCheckpoint } from '@shared/types'

interface Draft {
  comments: ReviewComment[]
  general: string
}
const drafts = new Map<string, Draft>()

/** Cuántas líneas de un fichero se enseñan antes de pedir «ver todo». */
const PREVIEW_LINES = 400

const lineKey = (file: string, l: DiffLine): string => `${file}|${l.kind}|${l.oldNo ?? ''}|${l.newNo ?? ''}`

export function DiffReview({
  open,
  onClose,
  runId,
  checkpoint,
  untilRunId,
  disabled,
  onSend
}: {
  open: boolean
  onClose: () => void
  runId: string
  checkpoint: RunCheckpoint
  /** El turno siguiente con foto: así se ve sólo lo de este turno. */
  untilRunId?: string
  /** El agente está trabajando: se puede comentar, pero no enviar todavía. */
  disabled?: boolean
  onSend: (prompt: string) => void
}): React.JSX.Element {
  const t = useT()
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [meta, setMeta] = useState<{ until: 'next' | 'now'; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => drafts.get(runId) ?? { comments: [], general: '' })
  const [editing, setEditing] = useState<{ key: string; file: string; line: DiffLine; id?: string; text: string } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [full, setFull] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setError(null)
    const r = await window.api.checkpoints.diff(checkpoint.root, runId, untilRunId)
    if (!r.ok || !r.data) {
      setFiles([])
      setError(r.error ?? t('Este turno ya no tiene punto de control'))
      return
    }
    setMeta({ until: r.data.until, truncated: r.data.truncated })
    setFiles(parseDiff(r.data.diff))
  }, [checkpoint.root, runId, untilRunId, t])

  useEffect(() => {
    if (!open) return
    setFiles(null)
    setDraft(drafts.get(runId) ?? { comments: [], general: '' })
    void load()
  }, [open, runId, load])

  const save = (next: Draft): void => {
    setDraft(next)
    drafts.set(runId, next)
  }

  const byKey = useMemo(() => {
    const m = new Map<string, ReviewComment[]>()
    for (const c of draft.comments) {
      const k = lineKey(c.file, c.line)
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return m
  }, [draft.comments])

  // Comentarios cuyas líneas ya no salen en el diff (se refrescó y cambió): se enseñan arriba para que no se envíen a ciegas.
  const orphans = useMemo(() => {
    if (!files) return []
    const keys = new Set<string>()
    for (const f of files) for (const h of f.hunks) for (const l of h.lines) keys.add(lineKey(f.path, l))
    return draft.comments.filter((c) => !keys.has(lineKey(c.file, c.line)))
  }, [files, draft.comments])

  const commitEdit = (): void => {
    if (!editing) return
    const text = editing.text.trim()
    let comments = draft.comments
    if (editing.id) {
      comments = text
        ? comments.map((c) => (c.id === editing.id ? { ...c, text } : c))
        : comments.filter((c) => c.id !== editing.id)
    } else if (text) {
      comments = [...comments, { id: Math.random().toString(36).slice(2, 10), file: editing.file, line: editing.line, text }]
    }
    save({ ...draft, comments })
    setEditing(null)
  }

  const remove = (id: string): void => save({ ...draft, comments: draft.comments.filter((c) => c.id !== id) })

  const total = files?.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 })
  const canSend = !disabled && (draft.comments.length > 0 || draft.general.trim().length > 0)

  const send = (): void => {
    // Ordenados como aparecen: por fichero y por línea.
    const order = new Map<string, number>()
    let i = 0
    for (const f of files ?? []) for (const h of f.hunks) for (const l of h.lines) order.set(lineKey(f.path, l), i++)
    const sorted = [...draft.comments].sort(
      (a, b) => (order.get(lineKey(a.file, a.line)) ?? -1) - (order.get(lineKey(b.file, b.line)) ?? -1)
    )
    const prompt = composeReview(sorted, draft.general, {
      intro: t('He revisado los cambios que hiciste. Corrige lo que te indico en cada punto y deja el resto como está:'),
      line: (n) => t('línea {n}', { n }),
      deleted: (n) => t('línea {n} que borraste', { n }),
      general: t('Además:')
    })
    drafts.delete(runId)
    setDraft({ comments: [], general: '' })
    onSend(prompt)
  }

  const editor = (
    <div className="mx-2 my-1.5 bg-panel border border-accent/40 rounded-lg p-2 space-y-2 font-sans">
      <Textarea
        autoFocus
        rows={3}
        value={editing?.text ?? ''}
        placeholder={t('Qué hay que cambiar aquí…')}
        onChange={(e) => editing && setEditing({ ...editing, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(null)
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            commitEdit()
          }
        }}
        className="text-[12.5px]"
      />
      <div className="flex items-center gap-1.5 justify-end">
        <span className="text-[10.5px] text-dim mr-auto">{t('Ctrl + Enter para guardar')}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          {t('Cancelar')}
        </Button>
        <Button size="sm" variant="primary" onClick={commitEdit} disabled={!editing?.text.trim() && !editing?.id}>
          {t('Guardar comentario')}
        </Button>
      </div>
    </div>
  )

  const commentBox = (c: ReviewComment): React.JSX.Element =>
    editing?.id === c.id ? (
      <div key={c.id}>{editor}</div>
    ) : (
      <div key={c.id} className="mx-2 my-1.5 bg-[#0d1a20] border border-[#1c3a44] rounded-lg px-3 py-2 flex items-start gap-2 font-sans">
        <MessageSquarePlus size={12} className="text-accent shrink-0 mt-0.5" />
        <div className="text-[12.5px] whitespace-pre-wrap break-words flex-1 min-w-0">{c.text}</div>
        <button
          className="text-[11px] text-dim hover:text-muted"
          onClick={() => setEditing({ key: lineKey(c.file, c.line), file: c.file, line: c.line, id: c.id, text: c.text })}
        >
          {t('Editar')}
        </button>
        <button className="text-dim hover:text-bad" title={t('Quitar')} onClick={() => remove(c.id)}>
          <Trash2 size={12} />
        </button>
      </div>
    )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Revisar este turno')}
      width="max-w-5xl"
      footer={
        <>
          <span className="text-[11.5px] text-dim mr-auto">
            {draft.comments.length === 1
              ? t('1 comentario')
              : draft.comments.length
                ? t('{n} comentarios', { n: draft.comments.length })
                : t('Pulsa una línea para comentarla')}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t('Cerrar')}
          </Button>
          <Button
            variant="primary"
            disabled={!canSend}
            onClick={send}
            title={disabled ? t('El agente está trabajando: espera a que acabe para enviar') : undefined}
          >
            <Send size={13} /> {t('Enviar al agente')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[12px] text-muted flex-wrap">
          <FileDiff size={13} className="text-accent" />
          {files ? (
            <>
              <span>{t('{n} ficheros', { n: files.length })}</span>
              <span className="text-ok num">+{total?.added ?? 0}</span>
              <span className="text-bad num">−{total?.removed ?? 0}</span>
              <span className="text-dim">
                ·{' '}
                {meta?.until === 'next'
                  ? t('sólo lo que cambió en este turno')
                  : t('desde antes de este turno hasta ahora, con lo que no está confirmado')}
              </span>
            </>
          ) : (
            <span className="text-dim">{t('Leyendo el diff…')}</span>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} title={t('Volver a leer')}>
            <RefreshCw size={12} />
          </Button>
        </div>

        {error ? <div className="text-[12.5px] text-bad">{error}</div> : null}
        {meta?.truncated ? (
          <div className="flex items-center gap-2 text-[12px] text-warn">
            <AlertTriangle size={13} /> {t('El diff es enorme y se ha cortado: faltan los últimos ficheros.')}
          </div>
        ) : null}
        {files && !files.length && !error ? (
          <div className="text-[12.5px] text-dim">{t('No hay cambios: el repositorio está como antes del turno.')}</div>
        ) : null}

        {orphans.length ? (
          <div className="border border-[#5c4413] bg-[#1a1408] rounded-lg p-2 space-y-1">
            <div className="text-[11px] text-warn">{t('Comentarios sobre líneas que ya no están en el diff (se envían igual):')}</div>
            {orphans.map((c) => (
              <div key={c.id} className="text-[11.5px] text-muted flex items-center gap-2">
                <span className="font-mono truncate">
                  {c.file}:{c.line.newNo ?? c.line.oldNo}
                </span>
                <span className="truncate flex-1">{c.text}</span>
                <button className="text-dim hover:text-bad" title={t('Quitar')} onClick={() => remove(c.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {(files ?? []).map((f) => {
          const isCollapsed = collapsed.has(f.path)
          const lineCount = f.hunks.reduce((n, h) => n + h.lines.length + 1, 0)
          let shown = 0
          const limit = full.has(f.path) ? Infinity : PREVIEW_LINES
          return (
            <div key={f.path} className="border border-line rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 bg-raised text-left hover:bg-[#1a1d29]"
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s)
                    if (n.has(f.path)) n.delete(f.path)
                    else n.add(f.path)
                    return n
                  })
                }
              >
                <ChevronRight size={12} className={cx('text-dim transition-transform', !isCollapsed && 'rotate-90')} />
                <span className="font-mono text-[12px] truncate flex-1" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                  {f.oldPath ? `${f.oldPath} → ` : ''}
                  {f.path}
                </span>
                {f.status !== 'modified' ? (
                  <Badge tone={f.status === 'added' ? 'ok' : f.status === 'deleted' ? 'bad' : 'violet'}>
                    {f.status === 'added' ? t('nuevo') : f.status === 'deleted' ? t('borrado') : t('renombrado')}
                  </Badge>
                ) : null}
                {byKeyCount(byKey, f.path) ? <Badge tone="accent">{byKeyCount(byKey, f.path)}</Badge> : null}
                <span className="text-ok text-[11px] num">+{f.added}</span>
                <span className="text-bad text-[11px] num">−{f.removed}</span>
              </button>
              {isCollapsed ? null : f.binary ? (
                <div className="px-3 py-2 text-[12px] text-dim">{t('Fichero binario: no se puede comentar por líneas.')}</div>
              ) : (
                <div className="font-mono text-[11.5px] leading-[1.55] bg-[#07080c] overflow-x-auto">
                  {f.hunks.map((h, hi) => {
                    if (shown >= limit) return null
                    shown++
                    return (
                      <div key={hi}>
                        <div className="px-3 py-0.5 text-violet bg-[#110f1c] text-[11px]">{h.header}</div>
                        {h.lines.map((l) => {
                          if (shown >= limit) return null
                          shown++
                          const k = lineKey(f.path, l)
                          const here = byKey.get(k) ?? []
                          return (
                            <div key={k}>
                              <div
                                role="button"
                                tabIndex={-1}
                                title={t('Comentar esta línea')}
                                onClick={() => setEditing({ key: k, file: f.path, line: l, text: '' })}
                                className={cx(
                                  'group grid grid-cols-[42px_42px_14px_1fr] cursor-pointer hover:bg-[#12202a]',
                                  l.kind === 'add' && 'bg-[#0b1a12]',
                                  l.kind === 'del' && 'bg-[#1c0e12]',
                                  here.length > 0 && 'shadow-[inset_2px_0_0_var(--color-accent)]'
                                )}
                              >
                                <span className="text-right pr-2 text-dim select-none">{l.oldNo ?? ''}</span>
                                <span className="text-right pr-2 text-dim select-none">{l.newNo ?? ''}</span>
                                <span
                                  className={cx(
                                    'select-none',
                                    l.kind === 'add' ? 'text-ok' : l.kind === 'del' ? 'text-bad' : 'text-dim'
                                  )}
                                >
                                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                                </span>
                                <span
                                  className={cx(
                                    'whitespace-pre pr-3 relative',
                                    l.kind === 'add' ? 'text-[#b5f5c8]' : l.kind === 'del' ? 'text-[#f5b5bd]' : 'text-muted'
                                  )}
                                >
                                  {l.text || ' '}
                                  <MessageSquarePlus
                                    size={11}
                                    className="hidden group-hover:inline-block ml-2 text-accent align-[-1px]"
                                  />
                                </span>
                              </div>
                              {here.map(commentBox)}
                              {editing && !editing.id && editing.key === k ? editor : null}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {lineCount > limit ? (
                    <div className="px-3 py-2 font-sans">
                      <Button size="sm" variant="ghost" onClick={() => setFull((s) => new Set(s).add(f.path))}>
                        {t('Ver el fichero entero ({n} líneas)', { n: lineCount })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}

        {files && files.length ? (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Comentario general (opcional)')}</div>
            <Textarea
              rows={3}
              value={draft.general}
              onChange={(e) => save({ ...draft, general: e.target.value })}
              placeholder={t('Lo que no va sobre una línea concreta: el enfoque, lo que falta, pruebas…')}
              className="text-[12.5px]"
            />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function byKeyCount(m: Map<string, ReviewComment[]>, file: string): number {
  let n = 0
  for (const [k, list] of m) if (k.startsWith(file + '|')) n += list.length
  return n
}
