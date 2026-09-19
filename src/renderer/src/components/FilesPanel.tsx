/**
 * Explorador y editor de ficheros del proyecto.
 *
 * El árbol se abre por niveles: pedir la carpeta entera de golpe se atasca en
 * cuanto hay un node_modules, así que cada carpeta se lee cuando la abres y
 * las pesadas se marcan para que sepas dónde te metes.
 *
 * El editor guarda con Ctrl+S y avisa si el fichero ha cambiado en disco desde
 * que lo abriste: así no se pisa lo que haya hecho un agente por detrás.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, FileText, Save, RotateCcw, Trash2,
  FilePlus2, FolderPlus, ExternalLink, AlertTriangle, Loader2, RefreshCw, Search, X
} from 'lucide-react'
import { Badge, Button, cx, Empty, Modal, Input } from './ui'
import { CodeEditor } from './Code'
import { FileIcon } from './FileIcon'
import { Pane } from './Resizable'
import { bytes as fmtBytes, relTime } from '../lib/format'
import { langFromPath } from '../lib/highlight'
import type { DirEntry, FileContent } from '@shared/types'

import { useT } from '../lib/i18n'
import { perOs } from '../lib/platform'
/* ------------------------------------------------------------------ *
 * Árbol                                                              *
 * ------------------------------------------------------------------ */

interface NodeProps {
  entry: DirEntry
  depth: number
  selected: string | null
  onSelect: (e: DirEntry) => void
  openDirs: Set<string>
  toggleDir: (rel: string) => void
  cache: Record<string, DirEntry[]>
  loadDir: (rel: string) => void
  filter: string
  /** Marca de las carpetas que conviene no abrir a la ligera. */
  heavyLabel: string
}

const TreeNode = React.memo(function TreeNode(props: NodeProps): React.JSX.Element | null {
  const { entry, depth, selected, onSelect, openDirs, toggleDir, cache, loadDir, filter, heavyLabel } = props
  const open = openDirs.has(entry.rel)
  const children = cache[entry.rel]

  useEffect(() => {
    if (entry.dir && open && !children) loadDir(entry.rel)
  }, [entry.dir, entry.rel, open, children, loadDir])

  if (filter && !entry.dir && !entry.name.toLowerCase().includes(filter)) return null

  return (
    <>
      <button
        onClick={() => {
          if (entry.dir) toggleDir(entry.rel)
          else onSelect(entry)
        }}
        className={cx(
          'w-full flex items-center gap-1.5 pr-2 py-[3px] text-[12px] text-left rounded hover:bg-raised transition-colors',
          selected === entry.rel && 'bg-accent/10 text-accent'
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={entry.rel}
      >
        {entry.dir ? (
          <ChevronRight size={11} className={cx('shrink-0 text-dim transition-transform', open && 'rotate-90')} />
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        <FileIcon name={entry.name} dir={entry.dir} open={open} size={15} />
        <span className="truncate">{entry.name}</span>
        {entry.heavy ? <span className="ml-auto text-[10px] text-dim shrink-0">{heavyLabel}</span> : null}
      </button>

      {entry.dir && open
        ? (children ?? []).map((c) => (
            <TreeNode key={c.rel} {...props} entry={c} depth={depth + 1} />
          ))
        : null}
    </>
  )
})

/* ------------------------------------------------------------------ *
 * Panel                                                              *
 * ------------------------------------------------------------------ */

export function FilesPanel({
  root,
  onToast,
  openRequest
}: {
  root: string
  onToast?: (tone: 'ok' | 'error', msg: string) => void
  /**
   * Petición de abrir un fichero concreto desde otra pestaña (por ejemplo, un
   * fichero en conflicto desde el árbol). Lleva la hora para que pedir dos
   * veces el mismo cuente como dos peticiones.
   */
  openRequest?: { path: string; at: number }
}): React.JSX.Element {
  const [cache, setCache] = useState<Record<string, DirEntry[]>>({})
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const [file, setFile] = useState<FileContent | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState<{ dir: boolean } | null>(null)
  const [newName, setNewName] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const t = useT()

  const loadDir = useCallback(
    (rel: string) => {
      void window.api.files.list(root, rel).then((r) => {
        if (r.ok && r.data) setCache((c) => ({ ...c, [rel]: r.data as DirEntry[] }))
        else if (r.error) onToast?.('error', r.error)
      })
    },
    [root, onToast]
  )

  // Se releen las carpetas abiertas sin vaciar lo que ya hay: así el árbol no
  // parpadea cada vez que algo cambia en disco.
  const reload = useCallback(() => {
    loadDir('')
    for (const d of openDirs) loadDir(d)
  }, [loadDir, openDirs])

  useEffect(() => {
    setCache({})
    setOpenDirs(new Set())
    setSel(null)
    setFile(null)
    loadDir('')
  }, [root, loadDir])

  const toggleDir = useCallback(
    (rel: string) => {
      setOpenDirs((prev) => {
        const next = new Set(prev)
        if (next.has(rel)) next.delete(rel)
        else {
          next.add(rel)
          loadDir(rel)
        }
        return next
      })
    },
    [loadDir]
  )

  const openFile = useCallback(
    (entry: DirEntry) => {
      setSel(entry.rel)
      setLoading(true)
      setError(null)
      void window.api.files.read(root, entry.rel).then((r) => {
        setLoading(false)
        if (!r.ok || !r.data) {
          setFile(null)
          setError(r.error ?? t('files.noRead'))
          return
        }
        setFile(r.data)
        setDraft(r.data.text ?? '')
      })
    },
    [root, t]
  )

  // Abrir un fichero que pide otra pestaña: se despliegan las carpetas de su
  // camino y se selecciona.
  useEffect(() => {
    if (!openRequest?.path) return
    const parts = openRequest.path.split('/')
    const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
    if (dirs.length) {
      setOpenDirs((prev) => {
        const next = new Set(prev)
        for (const d of dirs) next.add(d)
        return next
      })
      for (const d of dirs) loadDir(d)
    }
    openFile({ name: parts[parts.length - 1], rel: openRequest.path, dir: false, modified: Date.now() })
  }, [openRequest, loadDir, openFile])

  const dirty = file?.text != null && draft !== file.text

  const save = useCallback(async () => {
    if (!file || !sel || file.binary || file.truncated) return
    setSaving(true)
    // Se comprueba la fecha antes de escribir: si alguien lo ha tocado por
    // detrás, mejor preguntar que perder su trabajo.
    const fresh = await window.api.files.read(root, sel)
    if (fresh.ok && fresh.data && fresh.data.modified !== file.modified) {
      setSaving(false)
      setError(t('files.conflict'))
      return
    }
    const r = await window.api.files.write(root, sel, draft)
    setSaving(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? t('files.noWrite'))
      return
    }
    setFile(r.data)
    setError(null)
    onToast?.('ok', t('files.saved', { path: sel }))
  }, [file, sel, draft, root, onToast, t])

  // Lo que cambia en disco se refleja solo: el vigilante del proceso
  // principal avisa y aquí se releen las carpetas abiertas. Si el fichero que
  // tienes delante cambió por fuera y no lo estabas editando, se recarga; si
  // lo estabas editando no se toca, que lo tuyo manda.
  const live = useRef({ reload, sel, file, dirty, root })
  live.current = { reload, sel, file, dirty, root }

  useEffect(() => {
    if (!root) return
    void window.api.git.watch(root)
    const off = window.api.git.onChanged((e) => {
      const now = live.current
      if (e.path !== now.root) return
      now.reload()
      if (!now.sel || now.dirty || !now.file || now.file.binary) return
      void window.api.files.read(now.root, now.sel).then((r) => {
        if (!r.ok || !r.data) return
        if (r.data.modified === live.current.file?.modified) return
        if (live.current.dirty || live.current.sel !== now.sel) return
        setFile(r.data)
        setDraft(r.data.text ?? '')
      })
    })
    return () => {
      off()
      void window.api.git.unwatch(root)
    }
  }, [root])

  // Se calcula una vez por idioma: si cambiara en cada render, el `memo` de
  // los nodos del árbol no serviría de nada y volveríamos a pintar cientos de
  // botones con cada tecla del filtro.
  const heavyLabel = useMemo(() => t('files.heavy'), [t])

  const rootEntries = cache[''] ?? []
  const selDir = sel ? sel.split('/').slice(0, -1).join('/') : ''

  const create = async (): Promise<void> => {
    if (!creating || !newName.trim()) return
    const rel = [selDir, newName.trim()].filter(Boolean).join('/')
    const r = await window.api.files.create(root, rel, creating.dir)
    setCreating(null)
    setNewName('')
    if (!r.ok) {
      onToast?.('error', r.error ?? t('files.noCreate'))
      return
    }
    loadDir(selDir)
    if (!creating.dir) openFile({ name: newName.trim(), rel, dir: false, modified: Date.now() })
  }

  const remove = async (): Promise<void> => {
    if (!confirmDel) return
    const r = await window.api.files.trash(root, confirmDel)
    setConfirmDel(null)
    if (!r.ok) {
      onToast?.('error', r.error ?? t('files.noDelete'))
      return
    }
    onToast?.('ok', t('files.trashed', { path: confirmDel }))
    if (sel === confirmDel) {
      setSel(null)
      setFile(null)
    }
    loadDir(confirmDel.split('/').slice(0, -1).join('/'))
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {/* ----------------------------------------------------- Árbol */}
      <Pane paneKey="files.tree" side="right" className="border-r border-line flex flex-col min-h-0">
        <div className="p-2 border-b border-line flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value.toLowerCase())}
              placeholder={t('files.filter')}
              className="w-full bg-void border border-line rounded pl-6 pr-2 py-1 text-[11.5px] outline-none focus:border-accent-dim"
            />
          </div>
          <button
            onClick={() => setCreating({ dir: false })}
            title={t('files.newFile')}
            className="p-1 rounded text-dim hover:text-accent hover:bg-raised"
          >
            <FilePlus2 size={13} />
          </button>
          <button
            onClick={() => setCreating({ dir: true })}
            title={t('files.newFolder')}
            className="p-1 rounded text-dim hover:text-accent hover:bg-raised"
          >
            <FolderPlus size={13} />
          </button>
          <button onClick={reload} title={t('common.reload')} className="p-1 rounded text-dim hover:text-accent hover:bg-raised">
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {rootEntries.length === 0 ? (
            <div className="px-3 py-4 text-[11.5px] text-dim">{t('files.reading')}</div>
          ) : (
            rootEntries.map((e) => (
              <TreeNode
                key={e.rel}
                entry={e}
                depth={0}
                selected={sel}
                onSelect={openFile}
                openDirs={openDirs}
                toggleDir={toggleDir}
                cache={cache}
                loadDir={loadDir}
                filter={filter}
                heavyLabel={heavyLabel}
              />
            ))
          )}
        </div>
      </Pane>

      {/* --------------------------------------------------- Editor */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {!sel ? (
          <Empty
            icon={<FileText size={28} />}
            title={t('files.pick')}
            hint={t('files.pick.hint')}
          />
        ) : (
          <>
            <div className="h-10 px-3 border-b border-line flex items-center gap-2 shrink-0">
              <span className="font-mono text-[12px] truncate">{sel}</span>
              {file ? (
                <span className="num text-[11px] text-dim shrink-0">
                  {fmtBytes(file.bytes)}
                  {file.lines ? ` · ${t('files.lines', { n: file.lines })}` : ''} · {relTime(file.modified)}
                </span>
              ) : null}
              {dirty ? <Badge tone="warn">{t('files.unsaved')}</Badge> : null}
              {file?.truncated ? <Badge tone="bad">{t('files.truncated')}</Badge> : null}
              {file?.eol === 'crlf' ? <Badge tone="neutral">CRLF</Badge> : null}

              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => void window.api.files.reveal(root, sel)}
                  title={t(perOs('files.reveal'))}
                  className="p-1.5 rounded text-dim hover:text-accent hover:bg-raised"
                >
                  <ExternalLink size={13} />
                </button>
                <button
                  onClick={() => setConfirmDel(sel)}
                  title={t(perOs('files.trash'))}
                  className="p-1.5 rounded text-dim hover:text-bad hover:bg-raised"
                >
                  <Trash2 size={13} />
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!dirty}
                  onClick={() => file?.text != null && setDraft(file.text)}
                >
                  <RotateCcw size={12} /> {t('common.undo')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!dirty || saving || Boolean(file?.truncated)}
                  onClick={() => void save()}
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {t('common.save')}
                </Button>
              </div>
            </div>

            {error ? (
              <div className="px-3 py-2 bg-bad/10 border-b border-bad/35 text-[11.5px] text-bad flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-dim hover:text-muted">
                  <X size={12} />
                </button>
              </div>
            ) : null}

            {loading ? (
              <div className="flex-1 flex items-center justify-center text-[12px] text-dim">{t('files.opening')}</div>
            ) : file?.binary ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
                <div className="text-[12.5px] text-muted">{t('files.binary', { size: fmtBytes(file.bytes) })}</div>
                <div className="text-[11.5px] text-dim">{t('files.binary.hint')}</div>
                <Button size="sm" onClick={() => void window.api.files.reveal(root, sel)}>
                  <ExternalLink size={12} /> {t(perOs('files.reveal'))}
                </Button>
              </div>
            ) : (
              <CodeEditor
                value={draft}
                onChange={setDraft}
                lang={langFromPath(sel)}
                readOnly={Boolean(file?.truncated)}
                onSave={() => void save()}
              />
            )}
          </>
        )}
      </div>

      <Modal
        open={Boolean(creating)}
        onClose={() => setCreating(null)}
        title={creating?.dir ? t('files.newFolder') : t('files.newFile')}
      >
        <div className="space-y-3">
          <div className="text-[11.5px] text-dim">
            {t('files.createIn')}{' '}
            <span className="font-mono text-muted">{selDir || t('files.rootFolder')}</span>
          </div>
          <Input
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
            placeholder={creating?.dir ? 'nombre-de-carpeta' : 'nombre.ts'}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" disabled={!newName.trim()} onClick={() => void create()}>
              {t('common.create')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} title={t(perOs('files.trash'))}>
        <div className="space-y-3">
          <div className="text-[12.5px]">{t('files.trashExplain', { path: confirmDel ?? '' })}</div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              <Trash2 size={12} /> {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
