/**
 * Paleta de comandos (Ctrl+K): ir a cualquier sitio o lanzar algo sin ratón.
 *
 * Reúne las secciones, los proyectos y sus pestañas, las conversaciones de la
 * Consola, los agentes (abre una conversación nueva con él) y los scripts del
 * package.json de cada proyecto (se lanzan en la terminal del proyecto).
 * Filtra mientras escribes, sin distinguir tildes, y marca lo que encaja.
 *
 * Dentro de una terminal Ctrl+K es de la shell (en bash borra hasta el final
 * de la línea): ahí no se abre; queda el botón de la barra de arriba.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, Compass, FileText, FolderGit2, FolderOpen, GitBranch, MessageSquarePlus, MessagesSquare, Network, Play,
  Search, Settings2, SquareTerminal, TerminalSquare, Workflow
} from 'lucide-react'
import { cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { relTime } from '../lib/format'
import { focusChat, newSession, useSessions } from '../lib/engine'
import { navigate } from '../lib/nav'
import { modKey, withMod } from '../lib/platform'
import { SECTIONS, sectionShortcut } from '../lib/sections'
import { matchPalette } from '../lib/palette'
import { openSearch } from './SearchModal'
import type { ProjectScripts } from '@shared/types'

type Listener = () => void
const listeners = new Set<Listener>()

/** Abre la paleta desde cualquier sitio. */
export function openPalette(): void {
  for (const l of [...listeners]) l()
}

type Group = 'recent' | 'actions' | 'pages' | 'projects' | 'sessions' | 'agents' | 'scripts'

const GROUP_LABEL: Record<Group, string> = {
  recent: 'Recientes',
  actions: 'Acciones',
  pages: 'Secciones',
  projects: 'Proyectos',
  sessions: 'Conversaciones',
  agents: 'Agentes',
  scripts: 'Scripts'
}

interface Item {
  id: string
  group: Group
  /** Lo que se busca y se marca. */
  label: string
  /** Texto gris al lado: la ruta, el modelo, cuándo se usó. */
  detail?: string
  /** Se buscan también, pero no se enseñan (la ruta entera, el comando). */
  keywords?: string
  icon: React.ElementType
  tone?: string
  shortcut?: string
  /** Sólo sale al buscar: sin texto la lista sería eterna. */
  searchOnly?: boolean
  /** Puntos extra al ordenar (lo reciente, lo que más se usa). */
  boost?: number
  run: () => void
}

/** Lo último que elegiste en la paleta, mientras la app sigue abierta. */
const recent: string[] = []
const remember = (id: string): void => {
  const i = recent.indexOf(id)
  if (i >= 0) recent.splice(i, 1)
  recent.unshift(id)
  recent.length = Math.min(recent.length, 20)
}

const PROJECT_TABS: { id: string; label: string; icon: React.ElementType }[] = [
  { id: 'files', label: 'Archivos', icon: FolderOpen },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'graph', label: 'Árbol', icon: Network },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'agent', label: 'Agente', icon: Bot },
  { id: 'instructions', label: 'Instrucciones', icon: FileText },
  { id: 'settings', label: 'Ajustes', icon: Settings2 }
]

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }): React.JSX.Element {
  if (!ranges.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a > at) parts.push(text.slice(at, a))
    parts.push(
      <mark key={a} className="bg-transparent text-accent font-medium">
        {text.slice(a, b)}
      </mark>
    )
    at = b
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

export function CommandPalette(): React.JSX.Element | null {
  const t = useT()
  const { config, models } = useStore()
  const sessions = useSessions()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [scripts, setScripts] = useState<ProjectScripts>({})
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const l: Listener = () => {
      setQuery('')
      setActive(0)
      setOpen(true)
      requestAnimationFrame(() => input.current?.focus())
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  // Ctrl+K desde cualquier sitio salvo una terminal; otra vez, la cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!modKey(e) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return
      const el = document.activeElement
      if (el instanceof HTMLElement && el.closest('.xterm')) return
      e.preventDefault()
      if (open) setOpen(false)
      else openPalette()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const projects = useMemo(
    () =>
      (config?.projects ?? [])
        .filter((p) => !p.closed)
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt)),
    [config?.projects]
  )

  // Los scripts se leen al abrir: un package.json puede haber cambiado.
  useEffect(() => {
    if (!open || !projects.length) return
    let alive = true
    void window.api.projects.scripts(projects.map((p) => p.path)).then((r) => {
      if (alive && r.ok && r.data) setScripts(r.data)
    })
    return () => {
      alive = false
    }
  }, [open, projects])

  const items = useMemo<Item[]>(() => {
    if (!open) return []
    const out: Item[] = []
    const projectName = new Map(projects.map((p) => [p.id, p.name]))

    out.push({
      id: 'action:new-chat',
      group: 'actions',
      label: t('Conversación nueva'),
      keywords: 'chat consola nueva new conversation',
      icon: MessageSquarePlus,
      tone: 'text-accent',
      boost: 6,
      run: () => {
        const pick = models.find((m) => m.local) ?? models[0]
        void newSession('chat', { providerId: pick?.providerId, model: pick?.id, title: t('Conversación nueva') }).then((id) => focusChat(id))
      }
    })
    out.push({
      id: 'action:new-cli',
      group: 'actions',
      label: t('Sesión de agente nueva'),
      keywords: 'cli claude code opencode codex agente terminal',
      icon: TerminalSquare,
      tone: 'text-warn',
      boost: 4,
      run: () => void newSession('cli', { title: t('Sesión de agente') }).then((id) => focusChat(id))
    })
    out.push({
      id: 'action:search',
      group: 'actions',
      label: t('Buscar en todo'),
      detail: t('conversaciones e histórico'),
      keywords: 'buscar search historico mensajes',
      icon: Search,
      shortcut: 'Ctrl+Shift+F',
      boost: 3,
      run: () => openSearch()
    })

    for (const s of SECTIONS) {
      out.push({
        id: `page:${s.id}`,
        group: 'pages',
        label: t(`nav.${s.id}`),
        keywords: s.id,
        icon: s.icon,
        shortcut: sectionShortcut(s.id),
        boost: 8,
        run: () => navigate(s.id)
      })
    }

    projects.forEach((p, i) => {
      out.push({
        id: `project:${p.id}`,
        group: 'projects',
        label: p.name,
        detail: p.path,
        keywords: `${p.path} ${(p.tags ?? []).join(' ')} proyecto project`,
        icon: FolderGit2,
        tone: 'text-violet',
        boost: Math.max(0, 6 - i),
        run: () => navigate({ page: 'projects', projectId: p.id })
      })
      for (const tab of PROJECT_TABS) {
        out.push({
          id: `project:${p.id}:${tab.id}`,
          group: 'projects',
          label: `${p.name} › ${t(tab.label)}`,
          detail: p.path,
          keywords: `${tab.id} proyecto project`,
          icon: tab.icon,
          tone: 'text-violet',
          searchOnly: true,
          run: () => navigate({ page: 'projects', projectId: p.id, tab: tab.id })
        })
      }
      const pkg = scripts[p.path]
      if (pkg) {
        for (const [name, body] of Object.entries(pkg.scripts)) {
          const command = `${pkg.packageManager} run ${name}`
          out.push({
            id: `script:${p.id}:${name}`,
            group: 'scripts',
            label: `${p.name} › ${name}`,
            detail: command,
            keywords: `${body} script run ejecutar`,
            icon: Play,
            tone: 'text-ok',
            searchOnly: true,
            run: () => navigate({ page: 'projects', projectId: p.id, command })
          })
        }
      }
    })

    const bySession = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 300)
    bySession.forEach((s, i) => {
      const where = s.projectId ? projectName.get(s.projectId) : undefined
      out.push({
        id: `session:${s.id}`,
        group: 'sessions',
        label: s.title || t('Conversación nueva'),
        detail: [where, s.archived ? t('cerrada') : null, relTime(s.updatedAt)].filter(Boolean).join(' · '),
        keywords: [s.model, where, s.kind === 'cli' ? 'cli agente' : 'chat'].filter(Boolean).join(' '),
        icon: s.kind === 'cli' ? TerminalSquare : MessagesSquare,
        tone: s.kind === 'cli' ? 'text-warn' : 'text-accent',
        searchOnly: Boolean(s.archived),
        boost: Math.max(0, 8 - i) - (s.archived ? 6 : 0),
        run: () => focusChat(s.id)
      })
    })

    for (const a of config?.agents ?? []) {
      out.push({
        id: `agent:${a.id}`,
        group: 'agents',
        label: a.name,
        detail: t('conversación nueva · {model}', { model: a.model }),
        keywords: `${a.model} ${a.providerId} agente agent`,
        icon: Bot,
        tone: 'text-ok',
        boost: 2,
        run: () =>
          void newSession('chat', {
            agentId: a.id,
            providerId: a.providerId,
            model: a.model,
            effort: a.effort,
            title: a.name
          }).then((id) => focusChat(id))
      })
    }
    for (const a of config?.cliAgents ?? []) {
      out.push({
        id: `cli:${a.id}`,
        group: 'agents',
        label: a.name,
        detail: t('sesión nueva · {command}', { command: a.command }),
        keywords: `${a.command} ${a.model ?? ''} cli agente agent`,
        icon: Workflow,
        tone: 'text-warn',
        boost: 2,
        run: () =>
          void newSession('cli', { cliAgentId: a.id, cliModel: a.model, title: a.name }).then((id) => focusChat(id))
      })
    }
    return out
  }, [open, projects, scripts, sessions, config?.agents, config?.cliAgents, models, t])

  const q = query.trim()

  // Sin texto: lo último que elegiste y un poco de cada cosa, por grupos. Con
  // texto: todo lo que encaja, de mejor a peor.
  const shown = useMemo(() => {
    if (!q) {
      const byId = new Map(items.map((it) => [it.id, it]))
      const rec = recent.map((id) => byId.get(id)).filter((x): x is Item => Boolean(x)).slice(0, 4)
      const seen = new Set(rec.map((r) => r.id))
      const take = (g: Group, n: number): Item[] =>
        items.filter((it) => it.group === g && !it.searchOnly && !seen.has(it.id)).slice(0, n)
      return [
        ...rec.map((it) => ({ item: { ...it, group: 'recent' as Group }, ranges: [] as [number, number][] })),
        ...[...take('actions', 3), ...take('sessions', 5), ...take('projects', 6), ...take('agents', 6), ...take('pages', 11)].map(
          (item) => ({ item, ranges: [] as [number, number][] })
        )
      ]
    }
    const scored: { item: Item; ranges: [number, number][]; score: number }[] = []
    for (const item of items) {
      const m = matchPalette(q, item.label, `${item.detail ?? ''} ${item.keywords ?? ''}`)
      if (!m) continue
      const r = recent.indexOf(item.id)
      scored.push({ item, ranges: m.ranges, score: m.score + (item.boost ?? 0) + (r >= 0 ? 20 - r : 0) })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 60)
  }, [items, q])

  // Buscar lo escrito en los mensajes siempre queda al final.
  const rows = useMemo(() => {
    if (!q) return shown
    const search: Item = {
      id: 'action:search-text',
      group: 'actions',
      label: t('Buscar «{q}» en conversaciones e histórico', { q }),
      icon: Search,
      run: () => openSearch(q)
    }
    return [...shown, { item: search, ranges: [] as [number, number][] }]
  }, [shown, q, t])

  useEffect(() => {
    setActive(0)
  }, [q])

  useEffect(() => {
    list.current?.querySelector(`[data-palette-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (item: Item): void => {
    remember(item.id)
    setOpen(false)
    item.run()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-6 bg-black/50" onMouseDown={() => setOpen(false)}>
      <div
        className="w-full max-w-xl bg-panel border border-line rounded-2xl shadow-2xl fade-up flex flex-col max-h-[70vh] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        data-palette
      >
        <div className="relative border-b border-line shrink-0">
          <Compass size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => (rows.length ? (a + 1) % rows.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const row = rows[active]
                if (row) choose(row.item)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            placeholder={t('Ir a una sección, un proyecto, una conversación, un agente o un script…')}
            className="w-full h-12 pl-10 pr-4 bg-transparent text-[14px] outline-none placeholder:text-dim"
            data-palette-input
          />
        </div>

        <div ref={list} className="flex-1 overflow-y-auto p-1.5" data-palette-results>
          {rows.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-dim">{t('Nada encaja.')}</div>
          ) : (
            rows.map(({ item, ranges }, i) => {
              const Icon = item.icon
              const header = !q && (i === 0 || rows[i - 1].item.group !== item.group)
              return (
                <React.Fragment key={`${item.group}:${item.id}`}>
                  {header ? (
                    <div className="px-2.5 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-dim">{t(GROUP_LABEL[item.group])}</div>
                  ) : null}
                  <button
                    type="button"
                    data-palette-item={item.id}
                    data-palette-index={i}
                    data-active={i === active ? '' : undefined}
                    onClick={() => choose(item)}
                    onMouseMove={() => i !== active && setActive(i)}
                    className={cx(
                      'w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-left',
                      i === active ? 'bg-raised text-ink' : 'text-muted'
                    )}
                  >
                    <Icon size={14} className={cx('shrink-0', item.tone ?? 'text-dim')} />
                    <span className="text-[13px] truncate min-w-0 shrink">
                      <Marked text={item.label} ranges={ranges} />
                    </span>
                    {item.detail ? <span className="text-[11.5px] text-dim truncate min-w-0 flex-1">{item.detail}</span> : <span className="flex-1" />}
                    {q && item.group !== 'actions' ? (
                      <span className="text-[10.5px] text-dim shrink-0">{t(GROUP_LABEL[item.group])}</span>
                    ) : null}
                    {item.shortcut ? (
                      <span className="num text-[10.5px] text-dim border border-line rounded px-1 shrink-0">{withMod(item.shortcut)}</span>
                    ) : null}
                  </button>
                </React.Fragment>
              )
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-line text-[11px] text-dim flex items-center justify-between shrink-0">
          <span>{t('↑↓ elegir · Enter abrir · Esc cerrar')}</span>
          <span>{withMod(t('Ctrl+K desde cualquier sitio'))}</span>
        </div>
      </div>
    </div>
  )
}
