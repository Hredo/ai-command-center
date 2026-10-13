/**
 * Ajustes › Cuentas: con qué has iniciado sesión y cómo entrar en lo que
 * falta, y el diálogo del código de GitHub.
 *
 * Cada sesión la abre y la guarda la herramienta oficial (gh, claude, codex,
 * gemini, opencode, copilot, qwen, cursor-agent, ollama, hf). La app sólo les
 * pregunta si hay sesión y con qué cuenta: no ve contraseñas ni tokens. Los
 * proveedores que sólo funcionan con clave de API están todos abajo, con el
 * enlace a su página de claves y dónde pegarla.
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  Bot, Check, Copy, ExternalLink, FolderGit2, GitBranch, KeyRound, Loader2, LogIn, LogOut, RefreshCw,
  Terminal as TerminalIcon, UserCircle2, X
} from 'lucide-react'
import { Badge, Button, Input, Modal, Panel, PanelHeader, cx } from './ui'
import { relTime } from '../lib/format'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store'
import { useIsPageActive } from '../lib/pageActive'
import {
  cancelGithubLogin, cancelOpenRouterLogin, refreshAccounts, runAccountCommand, startGithubLogin,
  startOpenRouterLogin, submitOpenRouterCode, useAccounts
} from '../lib/accounts'
import type { AccountStatus } from '@shared/types'

/** El diálogo con el código de un solo uso de GitHub. Va montado una vez, arriba del todo. */
export function GithubLoginModal(): React.JSX.Element | null {
  const t = useT()
  const { toast } = useStore()
  const { github, notice } = useAccounts()
  const [copied, setCopied] = useState(false)
  const told = useRef(notice?.n ?? 0)

  // Una sesión que se abre o se cierra (aquí o en una terminal) se dice una vez.
  useEffect(() => {
    if (!notice || notice.n === told.current) return
    told.current = notice.n
    toast('ok', t(notice.signedIn ? '{name}: sesión iniciada' : '{name}: sesión cerrada', { name: notice.name }))
  }, [notice, toast, t])

  useEffect(() => {
    if (!github) setCopied(false)
  }, [github])

  if (!github) return null
  const copy = async (): Promise<void> => {
    if (!github.code) return
    try {
      await navigator.clipboard.writeText(github.code)
      setCopied(true)
    } catch {
      /* se puede copiar a mano */
    }
  }

  return (
    <Modal open onClose={cancelGithubLogin} title={t('Iniciar sesión en GitHub')} width="max-w-md">
      <div className="space-y-4" data-github-login>
        {github.phase === 'starting' ? (
          <div className="flex items-center gap-2 text-[12.5px] text-muted py-4">
            <Loader2 size={14} className="animate-spin" /> {t('Pidiendo el código a GitHub…')}
          </div>
        ) : null}

        {github.phase === 'code' ? (
          <>
            <p className="text-[12.5px] text-muted leading-relaxed">
              {t('Copia este código, abre GitHub, pégalo y autoriza. En cuanto lo hagas, esta ventana se cierra sola.')}
            </p>
            <div className="flex items-center justify-center gap-3 py-2">
              <span className="num text-[30px] tracking-[0.12em] font-semibold select-all" data-github-code>
                {github.code}
              </span>
              <Button size="icon" variant="ghost" title={t('Copiar el código')} onClick={() => void copy()}>
                {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
              </Button>
            </div>
            <div className="flex justify-center">
              <Button
                variant="primary"
                data-github-open
                onClick={() => {
                  void copy()
                  if (github.url) void window.api.app.openExternal(github.url)
                }}
              >
                <ExternalLink size={13} /> {t('Copiar el código y abrir GitHub')}
              </Button>
            </div>
            <div className="flex items-center justify-center gap-2 text-[11.5px] text-dim">
              <Loader2 size={12} className="animate-spin" /> {t('Esperando a que autorices…')}
            </div>
            <p className="text-[11px] text-dim leading-relaxed text-center">
              {t('El código es de un solo uso y caduca en 15 minutos. El token lo recibe y lo guarda gh: la app no lo ve.')}
            </p>
          </>
        ) : null}

        {github.phase === 'error' ? (
          <>
            <p className="text-[12.5px] text-bad leading-relaxed" data-github-error>
              {t('No se pudo iniciar sesión:')} {github.error}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={cancelGithubLogin}>
                {t('Cerrar')}
              </Button>
              <Button variant="primary" onClick={() => void startGithubLogin()}>
                <RefreshCw size={12} /> {t('Reintentar')}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}

function StateBadge({ a }: { a: AccountStatus }): React.JSX.Element {
  const t = useT()
  if (!a.installed) return <Badge tone="neutral">{t('no instalado')}</Badge>
  if (a.signedIn === null) return <Badge tone="warn">{t('no dice si hay sesión')}</Badge>
  return a.signedIn ? (
    <Badge tone="ok">
      <Check size={10} /> {t('con sesión')}
    </Badge>
  ) : (
    <Badge tone="warn">{t('sin sesión')}</Badge>
  )
}

function AccountRow({ a, gitHelper, onSetupGit }: { a: AccountStatus; gitHelper?: boolean; onSetupGit?: () => void }): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const inTerminal = async (command: string): Promise<void> => {
    const error = await runAccountCommand(a, command)
    if (error) toast('error', t('No se pudo abrir la terminal:') + ' ' + error)
  }
  const Icon = a.kind === 'github' ? FolderGit2 : Bot
  return (
    <div className="px-4 py-3 border-b border-line-soft last:border-0 flex items-start gap-3" data-account={a.id} data-signed={String(a.signedIn)}>
      <div className="w-7 h-7 rounded-lg bg-raised border border-line flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={14} className={a.signedIn ? 'text-ok' : 'text-dim'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[13px]">{a.name}</span>
          <StateBadge a={a} />
          {a.plan ? <Badge tone="violet">{a.plan}</Badge> : null}
          {a.kind === 'github' && a.signedIn && gitHelper ? (
            <Badge tone="neutral" title={t('git push y git pull a github.com usan la sesión de gh')}>
              <GitBranch size={10} /> {t('git la usa')}
            </Badge>
          ) : null}
        </div>
        {a.who ? <div className="text-[12px] text-muted truncate mt-0.5" data-account-who>{a.who}</div> : null}
        {a.staleAt ? (
          <div className="text-[11px] text-dim mt-0.5" data-account-stale>
            {t('Esta vez no contestó: es lo que se supo {when}.', { when: relTime(a.staleAt) })}
          </div>
        ) : null}
        {a.detail && (a.installed || a.kind === 'github') ? (
          <div className="text-[11.5px] text-dim mt-0.5 leading-relaxed">{t(a.detail)}</div>
        ) : null}
        {a.installed && !a.signedIn && a.loginCommand && !a.inApp ? (
          <div className="num text-[11px] text-dim mt-0.5">{a.loginCommand}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        {!a.installed ? (
          a.installCommand ? (
            <Button size="sm" onClick={() => void inTerminal(a.installCommand!)}>
              <TerminalIcon size={12} /> {t('Instalarlo en la terminal')}
            </Button>
          ) : a.installUrl ? (
            <Button size="sm" variant="ghost" onClick={() => void window.api.app.openExternal(a.installUrl!)}>
              <ExternalLink size={12} /> {t('Cómo instalarlo')}
            </Button>
          ) : null
        ) : a.signedIn ? (
          <>
            {a.kind === 'github' && !gitHelper && onSetupGit ? (
              <Button
                size="sm"
                variant="ghost"
                data-github-setup-git
                title={t('Ejecuta «gh auth setup-git»: git push y git pull a github.com usarán esta sesión. Escribe en tu ~/.gitconfig.')}
                onClick={onSetupGit}
              >
                <GitBranch size={12} /> {t('Usarla también en git')}
              </Button>
            ) : null}
            {a.logoutCommand ? (
              <Button size="sm" variant="ghost" onClick={() => void inTerminal(a.logoutCommand!)}>
                <LogOut size={12} /> {t('Salir')}
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            data-account-login={a.id}
            onClick={() => (a.inApp ? void startGithubLogin() : a.loginCommand ? void inTerminal(a.loginCommand) : undefined)}
          >
            <LogIn size={12} /> {t('Iniciar sesión')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Un proveedor que sólo se usa con clave: dónde conseguirla y dónde pegarla. */
function KeyRow({
  id,
  name,
  url,
  source,
  envVar,
  onSaved
}: {
  id: string
  name: string
  url?: string
  source: 'stored' | 'env' | 'none'
  envVar?: string
  onSaved: () => void
}): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    const r = await window.api.providers.setKey(id, key.trim())
    if (r.ok) {
      setKey('')
      setEditing(false)
      onSaved()
      // Se prueba al momento: una clave mal copiada se dice ya, no al primer prompt.
      const test = await window.api.providers.test(id)
      if (test.ok && test.data) toast(test.data.ok ? 'ok' : 'error', `${name}: ${t(test.data.detail)}`)
      else toast('ok', t('prov.keySaved', { name }))
    } else toast('error', r.error ?? t('No se pudo guardar'))
    setBusy(false)
  }
  return (
    <div className="px-4 py-2 flex items-center gap-3 border-b border-line-soft last:border-0 text-[12.5px]" data-key-row={id}>
      <KeyRound size={13} className={source !== 'none' ? 'text-ok shrink-0' : 'text-dim shrink-0'} />
      <span className="w-40 shrink-0 truncate">{name}</span>
      {source === 'none' ? (
        <Badge tone="warn">{t('sin clave')}</Badge>
      ) : (
        <Badge tone="ok">
          <Check size={10} /> {source === 'env' ? envVar : t('key guardada')}
        </Badge>
      )}
      {editing ? (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Input
            type="password"
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('Pega la clave')}
            className="h-7 text-[11.5px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <Button size="sm" variant="primary" loading={busy} disabled={!key.trim()} onClick={() => void save()}>
            {t('Guardar')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <X size={12} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 ml-auto">
          {url ? (
            <Button size="sm" variant="ghost" onClick={() => void window.api.app.openExternal(url)}>
              <ExternalLink size={12} /> {t('Conseguir clave')}
            </Button>
          ) : null}
          <Button size="sm" variant={source === 'none' ? 'outline' : 'ghost'} onClick={() => setEditing(true)}>
            <LogIn size={12} /> {source === 'none' ? t('Pegar clave') : t('Cambiar')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function AccountsPanel({ onProviders }: { onProviders: () => void }): React.JSX.Element {
  const t = useT()
  const { status, defs, toast, reloadStatus, reloadModels } = useStore()
  const [orCode, setOrCode] = useState('')
  const [orSending, setOrSending] = useState(false)
  const { list, loading, openrouter, signedInTick } = useAccounts()
  const active = useIsPageActive()
  const [gitHelper, setGitHelper] = useState<boolean | undefined>(undefined)
  const or = status.find((p) => p.id === 'openrouter')

  const loadGit = (): void => {
    void window.api.accounts.githubGit().then((r) => setGitHelper(r.ok ? Boolean(r.data) : undefined))
  }

  // A la vista se pregunta de vez en cuando: una sesión abierta o cerrada desde
  // otra terminal se nota sin tocar nada.
  useEffect(() => {
    if (!active) return
    void refreshAccounts()
    loadGit()
    // Entrar o salir se nota al momento (main vigila sus ficheros); esto es por si acaso.
    const timer = setInterval(() => void refreshAccounts(), 60000)
    return () => clearInterval(timer)
  }, [active])

  useEffect(() => {
    if (signedInTick) loadGit()
  }, [signedInTick])

  const setupGit = async (): Promise<void> => {
    const r = await window.api.accounts.githubSetupGit()
    toast(r.ok && r.data?.ok ? 'ok' : 'error', t(r.data?.detail ?? r.error ?? 'gh auth setup-git falló'))
    loadGit()
  }

  const sendOrCode = async (): Promise<void> => {
    setOrSending(true)
    const r = await submitOpenRouterCode(orCode)
    setOrSending(false)
    if (r.ok) setOrCode('')
    else toast('error', t('No se pudo conectar con OpenRouter:') + ' ' + t(r.error ?? ''))
  }

  const connectOpenRouter = async (): Promise<void> => {
    const r = await startOpenRouterLogin()
    if (r.ok) {
      toast('ok', t('OpenRouter conectado: la clave ha quedado guardada'))
      await reloadStatus()
      await reloadModels()
    } else if (r.error && r.error !== 'cancelado') {
      toast('error', t('No se pudo conectar con OpenRouter:') + ' ' + r.error)
    }
  }

  return (
    <div className="space-y-4" data-accounts>
      <Panel>
        <PanelHeader
          title={t('Cuentas')}
          icon={<UserCircle2 size={14} />}
          subtitle={t('Cada sesión la abre y la guarda su herramienta oficial: la app no ve contraseñas ni tokens')}
          right={
            <Button variant="ghost" size="sm" onClick={() => void refreshAccounts()} loading={loading} data-accounts-refresh>
              <RefreshCw size={12} /> {t('Comprobar')}
            </Button>
          }
        />
        <div>
          {!list ? (
            <div className="px-4 py-6 text-[12.5px] text-dim flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> {t('Preguntando a cada herramienta…')}
            </div>
          ) : (
            list.map((a) => (
              <AccountRow key={a.id} a={a} gitHelper={a.kind === 'github' ? gitHelper : undefined} onSetupGit={() => void setupGit()} />
            ))
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={t('Proveedores por API')}
          icon={<KeyRound size={14} />}
          subtitle={t('OpenRouter deja iniciar sesión; el resto se usa con su clave')}
        />
        <div className="px-4 py-3 flex items-start gap-3 border-b border-line-soft" data-account="openrouter">
          <div className="w-7 h-7 rounded-lg bg-raised border border-line flex items-center justify-center shrink-0 mt-0.5">
            <KeyRound size={14} className={or && or.keySource !== 'none' ? 'text-ok' : 'text-dim'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-[13px]">OpenRouter</span>
              {or && or.keySource !== 'none' ? (
                <Badge tone="ok">
                  <Check size={10} /> {or.keySource === 'env' ? or.envVar : t('key guardada')}
                </Badge>
              ) : (
                <Badge tone="warn">{t('sin clave')}</Badge>
              )}
            </div>
            <div className="text-[11.5px] text-dim mt-0.5 leading-relaxed">
              {openrouter
                ? t('Esperando a que autorices en el navegador…')
                : t('Autorizas en openrouter.ai y te crea una clave para esta app, que se guarda cifrada aquí.')}
            </div>
            {openrouter?.url ? (
              <button
                className="text-[11.5px] text-accent hover:underline mt-1"
                onClick={() => void window.api.app.openExternal(openrouter.url!)}
              >
                {t('¿No se abrió el navegador? Ábrelo desde aquí')}
              </button>
            ) : null}
            {openrouter ? (
              <div className="mt-2 space-y-1" data-openrouter-code>
                <div className="text-[11px] text-dim leading-relaxed">
                  {t('¿Autorizaste y el navegador no volvió a la app? Copia la dirección que se quedó en su barra (empieza por http://localhost) y pégala aquí.')}
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={orCode}
                    onChange={(e) => setOrCode(e.target.value)}
                    placeholder="http://localhost:…/callback?code=…"
                    className="h-7 text-[11.5px] font-mono"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && orCode.trim()) void sendOrCode()
                    }}
                  />
                  <Button size="sm" disabled={!orCode.trim()} loading={orSending} onClick={() => void sendOrCode()}>
                    {t('Usar')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {openrouter ? (
              <Button size="sm" variant="ghost" onClick={cancelOpenRouterLogin}>
                <X size={12} /> {t('Cancelar')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant={or && or.keySource !== 'none' ? 'outline' : 'primary'}
                data-openrouter-login
                onClick={() => void connectOpenRouter()}
              >
                <LogIn size={12} /> {or && or.keySource !== 'none' ? t('Volver a conectar') : t('Iniciar sesión')}
              </Button>
            )}
          </div>
        </div>
        <div className="px-4 py-3 flex items-center gap-3 border-b border-line-soft">
          <p className="text-[11.5px] text-dim leading-relaxed flex-1">
            {t('Anthropic, OpenAI, Google y los demás no ofrecen inicio de sesión a aplicaciones de terceros: se entra con una clave de API. Tu plan de Claude o de ChatGPT se usa con Claude Code y Codex, arriba.')}
          </p>
          <Button size="sm" variant="ghost" onClick={onProviders}>
            <KeyRound size={12} /> {t('Todos los ajustes')}
          </Button>
        </div>
        {defs
          .filter((d) => !d.local && d.id !== 'openrouter')
          .map((d) => (
            <KeyRow
              key={d.id}
              id={d.id}
              name={d.name}
              url={d.docsUrl}
              source={status.find((x) => x.id === d.id)?.keySource ?? 'none'}
              envVar={status.find((x) => x.id === d.id)?.envVar}
              onSaved={() => void reloadStatus().then(() => reloadModels())}
            />
          ))}
      </Panel>
    </div>
  )
}
