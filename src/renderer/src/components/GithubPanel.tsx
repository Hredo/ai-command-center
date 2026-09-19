/**
 * GitHub dentro de la aplicación: sesión, tus repositorios y clonarlos.
 *
 * La sesión se inicia con el CLI oficial en la terminal integrada, donde se
 * abre el navegador y autorizas tú. La app no pide ni guarda tu contraseña ni
 * tu token en ningún momento: sólo pregunta a `gh` con qué cuenta está.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  FolderGit2 as Github2, LogIn, LogOut, RefreshCw, Search, Download, Lock, GitFork, Archive,
  Star, Loader2, ExternalLink, FolderOpen, Check, Terminal as TerminalIcon
} from 'lucide-react'
import { Badge, Button, Empty, Modal } from './ui'
import { relTime } from '../lib/format'
import type { GhRepo, GhStatus } from '@shared/types'

import { useT } from '../lib/i18n'
export function GithubPanel({
  onToast,
  onOpenTerminal,
  onCloned
}: {
  onToast?: (tone: 'ok' | 'error', msg: string) => void
  /** Manda un comando a la terminal integrada: ahí es donde se autoriza. */
  onOpenTerminal?: (command: string) => void
  /** Una carpeta recién clonada, para darla de alta como proyecto. */
  onCloned?: (path: string, name: string) => void
}): React.JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<GhStatus | null>(null)
  const [repos, setRepos] = useState<GhRepo[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [cloning, setCloning] = useState<string | null>(null)
  const [target, setTarget] = useState<GhRepo | null>(null)

  const check = useCallback(async (deep = false) => {
    const r = deep ? await window.api.github.refresh() : await window.api.github.status()
    setStatus(r.ok && r.data ? r.data : { installed: false, authed: false, hint: r.error })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const r = await window.api.github.repos(80, query.trim() || undefined)
    setLoading(false)
    setRepos(r.ok && r.data ? r.data : [])
  }, [query])

  useEffect(() => {
    void check()
  }, [check])

  useEffect(() => {
    if (status?.authed) void load()
  }, [status?.authed, load])

  const clone = async (): Promise<void> => {
    if (!target) return
    const picked = await window.api.projects.pick()
    if (!picked.ok || !picked.data) return
    const parent = picked.data
    setCloning(target.nameWithOwner)
    const r = await window.api.github.clone(target.nameWithOwner, parent)
    setCloning(null)
    setTarget(null)
    if (!r.ok || !r.data?.ok) {
      onToast?.('error', r.data?.detail ?? r.error ?? t('no se pudo clonar'))
      return
    }
    onToast?.('ok', 'Clonado en ' + r.data.path)
    if (r.data.path) onCloned?.(r.data.path, target.nameWithOwner.split('/')[1])
  }

  /* ------------------------------------------------ Sin CLI */
  if (status && !status.installed) {
    return (
      <Empty
        icon={<Github2 size={28} />}
        title={t('Falta GitHub CLI')}
        hint={t('La sesión de GitHub se hace con su herramienta oficial, para que la contraseña no pase por aquí. Se instala en un minuto.')}
        action={
          <div className="flex items-center gap-2">
            {status.installCommand ? (
              <Button size="sm" onClick={() => onOpenTerminal?.(status.installCommand!)}>
                <TerminalIcon size={12} /> {t('Instalarlo en la terminal')}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void window.api.app.openExternal('https://cli.github.com')}>
                <ExternalLink size={12} /> {t('Cómo instalarlo')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void check(true)}>
              <RefreshCw size={12} /> {t('Ya lo instalé')}
            </Button>
          </div>
        }
      />
    )
  }

  /* ------------------------------------------------ Sin sesión */
  if (status && !status.authed) {
    return (
      <Empty
        icon={<Github2 size={28} />}
        title={t('Sin sesión de GitHub')}
        hint={t('Se abre el navegador y autorizas tú. La aplicación no ve tu contraseña ni tu token: sólo le pregunta a gh con qué cuenta está.')}
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const cmd = await window.api.github.loginCommand()
                onOpenTerminal?.(cmd.data ?? 'gh auth login --web')
              }}
            >
              <LogIn size={12} /> {t('Iniciar sesión')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void check(true)}>
              <RefreshCw size={12} /> {t('Ya entré')}
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* ------------------------------------------- Cuenta */}
      <div className="flex items-center gap-2 flex-wrap">
        <Github2 size={15} className="text-muted" />
        {status?.login ? (
          <>
            <span className="text-[13px] font-medium">{status.login}</span>
            {status.name ? <span className="text-[11.5px] text-dim">{status.name}</span> : null}
            <Badge tone="ok">
              <Check size={10} /> {t('con sesión')}
            </Badge>
            {status.scopes ? (
              <span className="text-[11px] text-dim truncate max-w-[320px]" title={status.scopes}>
                permisos: {status.scopes}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-[12.5px] text-dim">{t('Comprobando…')}</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {status?.url ? (
            <Button size="sm" variant="ghost" onClick={() => void window.api.app.openExternal(status.url as string)}>
              <ExternalLink size={12} /> {t('Mi perfil')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void check(true)} title={t('Volver a comprobar')}>
            <RefreshCw size={12} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const cmd = await window.api.github.logoutCommand()
              onOpenTerminal?.(cmd.data ?? 'gh auth logout')
            }}
          >
            <LogOut size={12} /> {t('Salir')}
          </Button>
        </div>
      </div>

      {/* ------------------------------------------- Buscador */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load()
            }}
            placeholder={t('buscar entre tus repositorios…')}
            className="w-full bg-void border border-line rounded-md pl-7 pr-2 py-1.5 text-[12.5px] outline-none focus:border-[#2c3346]"
          />
        </div>
        <Button size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Buscar
        </Button>
      </div>

      {/* ------------------------------------------- Lista */}
      {repos.length === 0 ? (
        <div className="text-[12px] text-dim px-1 py-3">
          {loading ? t('Pidiendo la lista…') : t('No hay repositorios que mostrar.')}
        </div>
      ) : (
        <div className="border border-line rounded-lg divide-y divide-[#151a26] max-h-[440px] overflow-y-auto">
          {repos.map((r) => (
            <div key={r.nameWithOwner} className="px-3 py-2 flex items-start gap-2.5 hover:bg-raised transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12.5px] font-medium truncate">{r.nameWithOwner}</span>
                  {r.private ? (
                    <Badge tone="warn" title={t('privado')}>
                      <Lock size={9} />
                    </Badge>
                  ) : null}
                  {r.fork ? (
                    <Badge tone="neutral" title={t('es un fork')}>
                      <GitFork size={9} />
                    </Badge>
                  ) : null}
                  {r.archived ? (
                    <Badge tone="neutral" title={t('archivado')}>
                      <Archive size={9} />
                    </Badge>
                  ) : null}
                  {r.language ? <Badge tone="violet">{r.language}</Badge> : null}
                  {r.stars > 0 ? (
                    <span className="num text-[11px] text-dim flex items-center gap-0.5">
                      <Star size={9} /> {r.stars}
                    </span>
                  ) : null}
                </div>
                {r.description ? (
                  <div className="text-[11.5px] text-dim truncate mt-0.5">{r.description}</div>
                ) : null}
                <div className="text-[11px] text-dim mt-0.5 num">
                  {r.defaultBranch ? r.defaultBranch : '—'}
                  {r.updatedAt ? ` · ${relTime(r.updatedAt)}` : ''}
                  {r.sizeKb ? ` · ${(r.sizeKb / 1024).toFixed(1)} MB` : ''}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => void window.api.app.openExternal(r.url)}
                  title={t('Abrir en GitHub')}
                  className="p-1.5 rounded text-dim hover:text-accent hover:bg-panel"
                >
                  <ExternalLink size={13} />
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(cloning)}
                  onClick={() => setTarget(r)}
                  title={t('Clonar en una carpeta')}
                >
                  {cloning === r.nameWithOwner ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Download size={12} />
                  )}
                  Clonar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={Boolean(target)} onClose={() => setTarget(null)} title={t('Clonar repositorio')}>
        <div className="space-y-3">
          <div className="text-[12.5px]">
            <span className="font-mono text-accent">{target?.nameWithOwner}</span> {t('se clonará dentro de la carpeta que elijas, y queda dado de alta como proyecto.')}
          </div>
          {target?.sizeKb && target.sizeKb > 100_000 ? (
            <div className="text-[11.5px] text-warn">
              {t('gh.bigRepo', { mb: (target.sizeKb / 1024).toFixed(0) })}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" onClick={() => void clone()}>
              <FolderOpen size={12} /> {t('Elegir carpeta y clonar')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
