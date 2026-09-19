/**
 * Git del proyecto: qué ha cambiado, preparar, confirmar, subir y bajar, el
 * histórico y una caja para cualquier otro comando.
 *
 * La caja no es una shell: el comando se parte en argumentos y se pasa a git
 * directamente, sin cmd ni PowerShell por medio, y el proceso principal sólo
 * acepta subcomandos de una lista. Los que pueden tirar trabajo (un `reset
 * --hard`, un `push --force`) piden confirmación antes de ejecutarse.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  GitCommit, GitBranch, ArrowUp, ArrowDown, RefreshCw, Plus, Minus, Loader2, Terminal as TerminalIcon,
  FileText, AlertTriangle, ChevronDown, Check, Archive, ArchiveRestore
} from 'lucide-react'
import { Badge, Button, cx, Empty, Modal, Textarea } from './ui'
import { relTime } from '../lib/format'
import { BranchPicker, useGit } from './AgentPanel'
import type { FileChange } from '@shared/types'

import { useT } from '../lib/i18n'
import { withMod } from '../lib/platform'
interface Commit {
  hash: string
  short: string
  subject: string
  author: string
  at: number
  refs?: string
}

interface CmdResult {
  ok: boolean
  out: string
  err: string
  command: string
  refused?: string
}

const STATUS_LABEL: Record<FileChange['status'], string> = {
  M: 'modificado',
  A: 'añadido',
  D: 'borrado',
  R: 'renombrado',
  '?': 'nuevo'
}

export function GitPanel({
  path,
  onToast,
  onOpenTerminal,
  onOpenGraph
}: {
  path: string
  onToast?: (tone: 'ok' | 'error', msg: string) => void
  /** Para lo que no se puede hacer desde aquí: se manda a la terminal. */
  onOpenTerminal?: (command: string) => void
  /** El histórico completo, con ramas y merges, vive en la pestaña del árbol. */
  onOpenGraph?: () => void
}): React.JSX.Element {
  const t = useT()
  // El estado y la lista de cambios llegan solos: el proceso principal vigila
  // la carpeta y avisa. Confirmar aquí o cometer desde una terminal de fuera
  // se ven igual y al momento.
  const { info, changes, state, reload: reloadGit } = useGit(path)
  const [log, setLog] = useState<Commit[]>([])
  const [diff, setDiff] = useState<{ file: string; text: string } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<CmdResult | null>(null)
  const [command, setCommand] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  const refresh = useCallback(() => {
    reloadGit()
    void window.api.git.log(path, 25).then((r) => setLog(r.ok && r.data ? (r.data as Commit[]) : []))
  }, [path, reloadGit])

  useEffect(refresh, [refresh, changes.length, info?.lastCommit?.hash])

  const runCommand = async (cmd: string, label = cmd): Promise<void> => {
    setBusy(label)
    const r = await window.api.git.run(path, cmd)
    setBusy(null)
    const res = (r.data as CmdResult) ?? { ok: false, out: '', err: r.error ?? '', command: 'git ' + cmd }
    setResult(res)
    if (res.refused) onToast?.('error', res.refused)
    else if (!res.ok) onToast?.('error', (res.err || t('git falló')).split('\n')[0])
    else onToast?.('ok', label + ' listo')
    refresh()
  }

  /** Antes de ejecutar se mira si el comando puede tirar trabajo. */
  const maybeRun = async (cmd: string, label = cmd): Promise<void> => {
    const risky = await window.api.git.isDestructive(cmd)
    if (risky.ok && risky.data) {
      setConfirm(cmd)
      return
    }
    await runCommand(cmd, label)
  }

  const stage = async (files: string[], on: boolean): Promise<void> => {
    setBusy(on ? 'preparando' : 'quitando')
    const r = await window.api.git.stage(path, files, on)
    setBusy(null)
    if (!r.ok || !(r.data as CmdResult)?.ok) {
      onToast?.('error', ((r.data as CmdResult)?.err || r.error || t('no se pudo')).split('\n')[0])
    }
    refresh()
  }

  const commit = async (): Promise<void> => {
    if (!message.trim()) return
    setBusy('confirmando')
    const r = await window.api.git.commit(path, message, true)
    setBusy(null)
    const res = r.data as CmdResult
    if (!r.ok || !res?.ok) {
      onToast?.('error', (res?.err || res?.refused || r.error || t('no se pudo confirmar')).split('\n')[0])
      setResult(res ?? null)
      return
    }
    setMessage('')
    setResult(res)
    onToast?.('ok', 'Confirmado')
    refresh()
  }

  /** Aparta lo que hay sin confirmar. Incluye lo que git todavía no sigue. */
  const stash = async (): Promise<void> => {
    setBusy('stash')
    const r = await window.api.git.op(path, 'stash', {})
    setBusy(null)
    if (!r.ok || !r.data?.ok) {
      onToast?.('error', (r.data?.refused || r.data?.err || r.error || t('no se pudo guardar')).split('\n')[0])
      return
    }
    onToast?.('ok', t('Apartado en el stash'))
    refresh()
  }

  const stashPop = async (): Promise<void> => {
    setBusy('stash')
    const r = await window.api.git.op(path, 'stash-pop', {})
    setBusy(null)
    if (!r.ok || !r.data?.ok) {
      onToast?.('error', (r.data?.refused || r.data?.err || r.error || t('no se pudo recuperar')).split('\n')[0])
      return
    }
    onToast?.('ok', t('Recuperado del stash'))
    refresh()
  }

  const openDiff = async (file: string): Promise<void> => {
    const r = await window.api.git.diff(path, file)
    setDiff({ file, text: r.ok && r.data ? r.data : t('(sin diferencias que mostrar)') })
  }

  if (!info) {
    return <div className="p-5 text-[12.5px] text-dim">{t('Leyendo el repositorio…')}</div>
  }

  if (!info.repo) {
    return (
      <div className="p-5">
        <Empty
          icon={<GitCommit size={28} />}
          title={t('Esta carpeta no es un repositorio de git')}
          hint={t('Puedes crear uno desde la terminal integrada con git init, y entonces este panel se llena solo.')}
          action={
            onOpenTerminal ? (
              <Button size="sm" onClick={() => onOpenTerminal('git init')}>
                <TerminalIcon size={12} /> {t('git init en la terminal')}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  const staged = changes.filter((c) => c.status !== '?')
  const untracked = changes.filter((c) => c.status === '?')

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 max-w-[1100px]">
      {/* --------------------------------------------- Cabecera */}
      <div className="flex items-center gap-2 flex-wrap">
        <BranchPicker
          path={path}
          info={info}
          onChanged={() => {
            refresh()
            onToast?.('ok', t('Rama cambiada'))
          }}
          onError={(m) => onToast?.('error', m)}
        />
        {info.upstream ? <Badge tone="neutral">sigue a {info.upstream}</Badge> : <Badge tone="warn">{t('sin remoto')}</Badge>}
        {info.lastCommit ? (
          <span className="text-[11.5px] text-dim truncate">
            último: <span className="font-mono text-muted">{info.lastCommit.hash}</span> {info.lastCommit.subject} ·{' '}
            {relTime(info.lastCommit.at)}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {onOpenGraph ? (
            <Button size="sm" variant="ghost" onClick={onOpenGraph} title={t('Ver el árbol de commits y ramas')}>
              <GitBranch size={12} /> {t('Árbol')}
            </Button>
          ) : null}
          {changes.length ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void stash()}
              disabled={Boolean(busy)}
              title={t('Aparta lo que tienes sin confirmar (git stash) y deja el árbol limpio')}
            >
              {busy === 'stash' ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />} Apartar
            </Button>
          ) : null}
          {state?.stashes ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void stashPop()}
              disabled={Boolean(busy)}
              title={`${state.stashes} cambio(s) apartados en el stash: se devuelven al árbol`}
            >
              <ArchiveRestore size={12} /> {t('Recuperar')}<span className="num">{state.stashes}</span>
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={refresh} title={t('Releer estado')}>
            <RefreshCw size={12} />
          </Button>
          <Button size="sm" onClick={() => void maybeRun('fetch --all --prune', 'fetch')} disabled={Boolean(busy)}>
            {busy === 'fetch' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Fetch
          </Button>
          <Button size="sm" onClick={() => void maybeRun('pull --ff-only', 'pull')} disabled={Boolean(busy)}>
            {busy === 'pull' ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />} Pull
            {info.behind ? <span className="num text-warn">{info.behind}</span> : null}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void maybeRun(info.upstream ? 'push' : 'push -u origin HEAD', 'push')}
            disabled={Boolean(busy)}
          >
            {busy === 'push' ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />} Push
            {info.ahead ? <span className="num text-ok">{info.ahead}</span> : null}
          </Button>
        </div>
      </div>

      {/* ------------------------------- Operación sin terminar */}
      {state && state.operation !== 'none' ? (
        <div className="px-3 py-2 rounded-lg bg-[#241a09] border border-[#4a3512] flex items-center gap-2.5">
          <AlertTriangle size={13} className="text-warn shrink-0" />
          <div className="text-[12px] text-warn min-w-0 flex-1">
            {state.detail ?? state.operation}
            {state.conflicts.length ? (
              <span className="text-dim"> · {t('git.conflictFiles', { n: state.conflicts.length })}</span>
            ) : null}
          </div>
          {onOpenGraph ? (
            <Button size="sm" onClick={onOpenGraph}>
              {t('Continuar o abortar')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* --------------------------------------------- Cambios */}
      <div className="border border-line rounded-lg bg-panel">
        <div className="px-3 py-2 border-b border-line flex items-center gap-2 text-[12px]">
          <span className="font-medium">{t('Cambios')}</span>
          <span className="num text-dim">
            {changes.length === 0 ? 'ninguno' : `${changes.length} fichero${changes.length === 1 ? '' : 's'}`}
          </span>
          {changes.length ? (
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => void stage(changes.map((c) => c.path), true)}>
                <Plus size={11} /> {t('Preparar todo')}
              </Button>
              {staged.length ? (
                <Button size="sm" variant="ghost" onClick={() => void stage(staged.map((c) => c.path), false)}>
                  <Minus size={11} /> {t('Quitar del índice')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {changes.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-dim">{t('El árbol está limpio.')}</div>
        ) : (
          <div className="divide-y divide-[#151a26]">
            {changes.map((c) => (
              <div key={c.path} className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
                <Badge tone={c.status === '?' ? 'warn' : c.status === 'D' ? 'bad' : 'accent'} title={t(STATUS_LABEL[c.status])}>
                  {c.status}
                </Badge>
                <button
                  onClick={() => void openDiff(c.path)}
                  className="font-mono truncate text-left flex-1 min-w-0 hover:text-accent"
                  title={`ver el diff de ${c.path}`}
                >
                  {c.path}
                </button>
                {c.binary ? (
                  <span className="text-dim shrink-0">{t('binario')}</span>
                ) : (
                  <span className="num shrink-0">
                    {c.added ? <span className="text-ok">+{c.added}</span> : null}
                    {c.added && c.removed ? ' ' : null}
                    {c.removed ? <span className="text-bad">-{c.removed}</span> : null}
                  </span>
                )}
                <button
                  onClick={() => void stage([c.path], true)}
                  title={t('Preparar este fichero')}
                  className="p-1 rounded text-dim hover:text-ok hover:bg-raised shrink-0"
                >
                  <Plus size={12} />
                </button>
              </div>
            ))}
            {untracked.length ? (
              <div className="px-3 py-1.5 text-[11px] text-dim">
                {t('git.untrackedNote', { n: untracked.length })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* --------------------------------------------- Confirmar */}
      <div className="border border-line rounded-lg bg-panel p-3 space-y-2">
        <div className="text-[12px] font-medium">{t('Confirmar')}</div>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void commit()
            }
          }}
          rows={2}
          placeholder={t('Qué has hecho…')}
          className="text-[12.5px]"
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-dim">
            Confirma todo lo que git ya sigue (equivale a git commit -a). {withMod('Ctrl + Enter')}.
          </span>
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            disabled={!message.trim() || Boolean(busy)}
            onClick={() => void commit()}
          >
            {busy === 'confirmando' ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />} Confirmar
          </Button>
        </div>
      </div>

      {/* --------------------------------------------- Comando libre */}
      <div className="border border-line rounded-lg bg-panel p-3 space-y-2">
        <div className="text-[12px] font-medium">{t('Comando de git')}</div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-dim">git</span>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && command.trim()) void maybeRun(command.trim())
            }}
            placeholder="log --oneline -20"
            className="flex-1 min-w-0 bg-void border border-line rounded px-2 py-1.5 font-mono text-[12px] outline-none focus:border-[#2c3346]"
          />
          <Button size="sm" disabled={!command.trim() || Boolean(busy)} onClick={() => void maybeRun(command.trim())}>
            {t('Ejecutar')}
          </Button>
        </div>
        {result ? (
          <div className="space-y-1">
            <div className="font-mono text-[11px] text-dim">{result.command}</div>
            {result.refused ? (
              <div className="text-[11.5px] text-warn flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>
                  {result.refused}
                  {onOpenTerminal ? (
                    <button
                      onClick={() => onOpenTerminal(result.command)}
                      className="ml-1.5 underline hover:text-accent"
                    >
                      {t('abrirlo en la terminal')}
                    </button>
                  ) : null}
                </span>
              </div>
            ) : null}
            {result.out || result.err ? (
              <pre className="bg-[#07080c] border border-line rounded p-2 font-mono text-[11.5px] whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto m-0">
                {result.out}
                {result.err ? <span className={result.ok ? 'text-dim' : 'text-bad'}>{result.err}</span> : null}
              </pre>
            ) : null}
          </div>
        ) : (
          <div className="text-[11px] text-dim">
            {t('Va directo a git, sin shell. Para lo interactivo o lo que no esté permitido aquí, usa la terminal integrada.')}
          </div>
        )}
      </div>

      {/* --------------------------------------------- Histórico */}
      <div className="border border-line rounded-lg bg-panel">
        <div className="flex items-center">
          <button
            onClick={() => setShowLog((v) => !v)}
            className="flex-1 min-w-0 px-3 py-2 flex items-center gap-2 text-[12px] hover:bg-raised rounded-lg"
          >
            <ChevronDown size={12} className={cx('text-dim transition-transform', !showLog && '-rotate-90')} />
            <span className="font-medium">{t('Últimos commits')}</span>
            <span className="num text-dim">{log.length}</span>
          </button>
          {onOpenGraph ? (
            <button onClick={onOpenGraph} className="px-3 py-2 text-[11.5px] text-dim hover:text-accent">
              {t('ver el árbol con sus ramas →')}
            </button>
          ) : null}
        </div>
        {showLog ? (
          <div className="divide-y divide-[#151a26]">
            {log.map((c) => (
              <div key={c.hash} className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
                <span className="font-mono text-accent shrink-0">{c.short}</span>
                <span className="truncate flex-1 min-w-0">{c.subject}</span>
                {c.refs ? <Badge tone="violet">{c.refs.split(',')[0].trim()}</Badge> : null}
                <span className="text-dim shrink-0">{c.author}</span>
                <span className="text-dim shrink-0 num">{relTime(c.at)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <Modal open={Boolean(diff)} onClose={() => setDiff(null)} title={diff?.file ?? ''} width="max-w-4xl">
        <pre className="bg-[#07080c] border border-line rounded p-3 font-mono text-[11.5px] leading-[1.5] whitespace-pre max-h-[60vh] overflow-auto m-0">
          {(diff?.text ?? '').split('\n').map((l, i) => (
            <div
              key={i}
              className={
                l.startsWith('+') && !l.startsWith('+++')
                  ? 'text-ok'
                  : l.startsWith('-') && !l.startsWith('---')
                    ? 'text-bad'
                    : l.startsWith('@@')
                      ? 'text-violet'
                      : 'text-muted'
              }
            >
              {l || ' '}
            </div>
          ))}
        </pre>
      </Modal>

      <Modal open={Boolean(confirm)} onClose={() => setConfirm(null)} title={t('Este comando puede tirar trabajo')}>
        <div className="space-y-3">
          <div className="font-mono text-[12.5px] bg-void border border-line rounded p-2">git {confirm}</div>
          <div className="text-[12px] text-muted">
            {t('Puede borrar cambios sin confirmar o reescribir lo que ya subiste. Si no era lo que querías, cancela.')}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const cmd = confirm as string
                setConfirm(null)
                void runCommand(cmd)
              }}
            >
              <Check size={12} /> {t('Ejecutarlo igual')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** Un fichero cambiado, para reutilizar el icono fuera de aquí. */
export { FileText as GitFileIcon }
