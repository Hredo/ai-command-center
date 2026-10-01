import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react'
import {
  Boxes, Radar, CheckCircle2, XCircle, Info, X, Activity, PanelLeftClose, PanelLeftOpen, Search, Compass,
  Columns2, Rows2, EyeOff, Eye, RotateCcw, CornerDownRight, CircleHelp
} from 'lucide-react'
import { StoreProvider, useStore } from './lib/store'
import { PrefsProvider, usePrefs, usePaneSize } from './lib/prefs'
import { I18nProvider, useT } from './lib/i18n'
import { PageActiveProvider, useDocumentVisible } from './lib/pageActive'
import { GithubLoginModal } from './components/AccountsPanel'
import { EngineProvider, useBusyCount, useInFlight, useRunsVersion, useAttentionCount } from './lib/engine'
import { cx } from './components/ui'
import { Pane } from './components/Resizable'
import { cost } from './lib/format'
import { TITLEBAR_HEIGHT, TRAFFIC_LIGHTS_WIDTH } from '@shared/defaults'
import { IS_MAC, modKey, withMod } from './lib/platform'
import { navigate, onNavigate, type PageId } from './lib/nav'
import { SearchModal, openSearch } from './components/SearchModal'
import { CommandPalette, openPalette } from './components/CommandPalette'
import { SECTIONS } from './lib/sections'
import { focused, layout, leaves, MAX_PANES } from '@shared/workspace'
import {
  adoptWorkspace, closePane, cyclePane, focusPane, openSection, peekWorkspace, resetNav, setDrag, setNav, splitPane,
  useWorkspace, visibleSections
} from './lib/workspace'
import { PaneSizeProvider } from './lib/paneSize'
import { LayoutMenu, WorkbenchChrome, PANE_HEADER, pct } from './components/Workbench'
import { HelpCenter, Tour, openHelp } from './components/Help'
import { updateAvailable, useUpdate } from './lib/updates'
import { launchTask } from './lib/launchTask'
/**
 * Cada sección se descarga la primera vez que se entra en ella.
 *
 * No es una manía: las gráficas del panel, el emulador de terminal y el
 * renderizador de markdown pesan juntos más que todo el resto de la aplicación,
 * y hasta ahora se cargaban al arrancar aunque abrieras la app para mirar una
 * cosa y cerrarla. Partido así, lo que se ejecuta al abrir es el armazón; el
 * resto entra cuando hace falta y se queda.
 *
 * El panel no: es lo primero que se ve, y cargarlo aparte sólo añadiría un
 * parpadeo en el único sitio donde se nota.
 */
import Dashboard from './pages/Dashboard'

const Chat = lazy(() => import('./pages/Chat'))
const Arena = lazy(() => import('./pages/Arena'))
const Terminals = lazy(() => import('./pages/Terminals'))
const Tasks = lazy(() => import('./pages/Tasks'))
const Projects = lazy(() => import('./pages/Projects'))
const Agents = lazy(() => import('./pages/Agents'))
const Models = lazy(() => import('./pages/Models'))
const HistoryPage = lazy(() => import('./pages/History'))
const House = lazy(() => import('./pages/House'))
const SettingsPage = lazy(() => import('./pages/Settings'))

/** Lo que se ve el instante que tarda una sección en llegar. */
function PageLoading(): React.JSX.Element {
  return (
    <div className="h-full flex items-center justify-center">
      <span className="w-5 h-5 rounded-full border-2 border-line border-t-accent animate-spin" />
    </div>
  )
}

export type { PageId }

/** Por debajo de este ancho el menú se queda sólo con los iconos. */
const ICONS_ONLY = 112

/**
 * La barra de título y los botones de la ventana.
 *
 * Los botones los pinta el sistema, no la aplicación, así que hay que
 * mantenerlos de acuerdo con el tema y con la escala a mano: si no, quedan
 * blancos sobre un panel claro o a media altura al ampliar la interfaz. En
 * macOS son los semáforos, que no cambian de color: sólo se recentran.
 */
function useWindowChrome(): void {
  const { theme, appearance } = usePrefs()

  useEffect(() => {
    const zoom = Math.min(2, Math.max(0.5, appearance.uiScale / 100))
    void window.api.app.setChrome({
      zoom,
      background: theme.ui.void,
      symbol: theme.ui.muted
    })
  }, [theme.ui.void, theme.ui.muted, appearance.uiScale])
}

/** Estado global visible siempre: proveedores vivos, gasto y tareas en marcha. */
function TitleBar(): React.JSX.Element {
  const { status, models, info } = useStore()
  const { appearance } = usePrefs()
  const t = useT()
  // Los botones del sistema no crecen con el zoom: su hueco tampoco.
  const zoom = Math.min(2, Math.max(0.5, appearance.uiScale / 100))
  const busy = useBusyCount()
  const version = useRunsVersion()
  const update = useUpdate()
  const [spend, setSpend] = useState(0)
  // Lo que está generando ahora mismo, estimado: el gasto del mes se mueve
  // mientras trabaja y no sólo al terminar.
  const inflight = useInFlight()

  // El gasto se relee al terminar cada ejecución; el reloj queda de red por
  // si algo se ejecuta fuera de esta ventana.
  useEffect(() => {
    const load = (): void => {
      void window.api.runs.overview(30).then((r) => {
        if (r.ok && r.data) setSpend(r.data.costMonth)
      })
    }
    load()
    const t = window.setInterval(load, 60_000)
    return () => window.clearInterval(t)
  }, [version])

  const active = status.filter((s) => (s.local ? s.reachable : s.keySource !== 'none')).length
  const total = busy.chats + busy.arena + busy.terms

  return (
    <div
      className="drag shrink-0 flex items-center justify-between px-3 border-b border-line bg-void select-none"
      style={{ height: TITLEBAR_HEIGHT, paddingLeft: IS_MAC ? Math.round(TRAFFIC_LIGHTS_WIDTH / zoom) : undefined }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-[18px] h-[18px] rounded-[5px] bg-gradient-to-br from-accent to-violet shrink-0" />
        <span className="display text-[13px] font-semibold">AI Command Center</span>
        <span className="num text-[10.5px] text-dim opacity-70">v{info?.version ?? '0.1.0'}</span>
        {updateAvailable(update) ? (
          <button
            type="button"
            onClick={() => navigate({ page: 'settings', tab: 'prefs' })}
            className="no-drag num text-[10.5px] px-1.5 h-5 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
            title={t('Hay una versión nueva: v{v}', { v: update?.latest ?? '' })}
            data-update-chip
          >
            {t('v{v} disponible', { v: update?.latest ?? '' })}
          </button>
        ) : null}
      </div>
      <div
        className="flex items-center gap-4 text-[11.5px]"
        style={{ paddingRight: IS_MAC ? 0 : Math.round(140 / zoom) }}
      >
        <button
          type="button"
          onClick={() => openPalette()}
          className="no-drag flex items-center gap-1.5 h-6 px-2 rounded-md border border-line text-dim hover:text-ink hover:border-dim/60 transition-colors"
          title={withMod(t('Ir a una sección, un proyecto, una conversación, un agente o un script (Ctrl+K)'))}
          data-open-palette
        >
          <Compass size={12} /> {t('Ir a…')}
          <span className="num text-[10px] opacity-70">{withMod('Ctrl+K')}</span>
        </button>
        <button
          type="button"
          onClick={() => openSearch()}
          className="no-drag flex items-center gap-1.5 h-6 px-2 rounded-md border border-line text-dim hover:text-ink hover:border-dim/60 transition-colors"
          title={withMod(t('Buscar en conversaciones e histórico (Ctrl+Mayús+F)'))}
          data-open-search
        >
          <Search size={12} /> {t('Buscar')}
        </button>
        <LayoutMenu />
        <div className="flex items-center gap-4" data-status>
        {total > 0 ? (
          <span
            className="flex items-center gap-1.5 text-ok"
            title={t('title.busy', { chats: busy.chats, arena: busy.arena, terms: busy.terms })}
          >
            <Activity size={12} className="animate-pulse" />
            <span className="num">{total}</span> {t('common.running')}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 text-dim">
          <Radar size={12} className={active > 0 ? 'text-ok' : 'text-dim'} />
          <span className="num">{active}</span> {t('common.active')}
        </span>
        <span className="flex items-center gap-1.5 text-dim">
          <Boxes size={12} />
          <span className="num">{models.length}</span> {t('common.models')}
        </span>
        <span
          className="flex items-center gap-1.5 text-dim"
          title={inflight.count ? t('Incluye lo que se está generando ahora, estimado') : undefined}
        >
          {t('common.month')}{' '}
          <span className={cx('num', inflight.count ? 'text-ok' : 'text-muted')}>{cost(spend + inflight.cost)}</span>
        </span>
        </div>
        <button
          type="button"
          onClick={() => openHelp()}
          className="no-drag w-6 h-6 rounded-md border border-line text-dim hover:text-ink hover:border-accent/40 flex items-center justify-center transition-colors"
          title={t('Ayuda: todo lo que hace la app, explicado (F1)')}
          data-open-help
        >
          <CircleHelp size={13} />
        </button>
      </div>
    </div>
  )
}

/** Un menú de opciones junto al puntero (clic derecho en el menú lateral). */
function ContextMenu({
  at,
  items,
  onClose
}: {
  at: { x: number; y: number }
  items: ({ label: string; icon?: React.ElementType; run: () => void; disabled?: boolean } | null)[]
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-[70]" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        className="fixed z-[71] min-w-[210px] bg-raised border border-line rounded-xl shadow-2xl py-1 fade-up"
        style={{ left: Math.min(at.x, window.innerWidth - 230), top: Math.min(at.y, window.innerHeight - items.length * 32 - 16) }}
        data-context-menu
      >
        {items.map((it, i) =>
          it ? (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              onClick={() => {
                it.run()
                onClose()
              }}
              className="w-full h-8 px-3 flex items-center gap-2.5 text-left text-[12.5px] text-muted hover:text-ink hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {it.icon ? <it.icon size={14} /> : <span className="w-[14px]" />}
              {it.label}
            </button>
          ) : (
            <div key={`sep-${i}`} className="h-px bg-line my-1" />
          )
        )}
      </div>
    </>
  )
}

/**
 * El menú lateral. Un clic abre la sección en el panel activo; Ctrl+clic (o el
 * botón central) la abre al lado; arrastrándola se suelta donde quieras de la
 * mesa, o sobre otra del menú para cambiar el orden. Con el botón derecho se
 * esconde lo que no uses.
 */
function Sidebar(): React.JSX.Element {
  const t = useT()
  const ws = useWorkspace()
  const busy = useBusyCount()
  // Tareas no cuenta lo que corre (eso ya lo dicen las demás): cuenta lo que espera algo de ti.
  const attention = useAttentionCount()
  const { size, set, reset } = usePaneSize('nav.width')
  const icons = size < ICONS_ONLY
  const [menu, setMenu] = useState<{ x: number; y: number; id: PageId | null } | null>(null)
  const [over, setOver] = useState<PageId | null>(null)

  const sections = visibleSections(ws)
  const current = focused(ws.ws).page
  const shown = new Set(leaves(ws.ws.root).map((l) => l.page))
  const full = shown.size >= MAX_PANES
  // Con tu propio orden los separadores de grupo ya no dicen nada.
  const custom = ws.navOrder.some((id, i) => id !== SECTIONS[i]?.id) || ws.navHidden.length > 0

  const badge: Partial<Record<PageId, number>> = {
    chat: busy.chats,
    arena: busy.arena,
    terminal: busy.terms,
    tasks: attention
  }

  const moveBefore = (dragged: PageId, target: PageId): void => {
    if (dragged === target) return
    const order = ws.navOrder.filter((p) => p !== dragged)
    order.splice(order.indexOf(target), 0, dragged)
    setNav(order, ws.navHidden)
  }

  return (
    <Pane
      paneKey="nav.width"
      side="right"
      className="border-r border-line bg-void flex flex-col py-2"
    >
      <div
        className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden"
        data-sidebar
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, id: null })
        }}
      >
        {sections.map((item, i) => {
          const prev = sections[i - 1]
          const Icon = item.icon
          const on = current === item.id
          const visible = !on && shown.has(item.id)
          const count = badge[item.id] ?? 0
          const label = t(`nav.${item.id}`)
          return (
            <React.Fragment key={item.id}>
              {!custom && prev && prev.group !== item.group ? <div className="h-px bg-line-soft mx-3 my-2 shrink-0" /> : null}
              <button
                draggable
                data-nav={item.id}
                data-nav-state={on ? 'focus' : visible ? 'shown' : undefined}
                onClick={(e) => openSection(item.id, e.ctrlKey || e.metaKey ? 'row' : undefined)}
                onAuxClick={(e) => {
                  if (e.button === 1) openSection(item.id, 'row')
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ x: e.clientX, y: e.clientY, id: item.id })
                }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', item.id)
                  setDrag(item.id)
                }}
                onDragEnd={() => {
                  setDrag(null)
                  setOver(null)
                }}
                onDragOver={(e) => {
                  if (!ws.drag || ws.drag === item.id) return
                  e.preventDefault()
                  setOver(item.id)
                }}
                onDragLeave={() => setOver((o) => (o === item.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault()
                  if (ws.drag) moveBefore(ws.drag, item.id)
                  setDrag(null)
                  setOver(null)
                }}
                title={icons ? label : undefined}
                className={cx(
                  'mx-2 h-8 px-2.5 rounded-lg flex items-center gap-2.5 transition-colors relative shrink-0',
                  icons && 'justify-center px-0',
                  on ? 'bg-raised text-ink' : visible ? 'text-ink hover:bg-hover' : 'text-muted hover:text-ink hover:bg-hover',
                  over === item.id && 'shadow-[inset_0_2px_0_0_var(--color-accent)]'
                )}
              >
                {on ? <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" /> : null}
                {visible ? <span className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full bg-dim" /> : null}
                <Icon size={15} className={on ? 'text-accent' : ''} />
                {icons ? null : <span className="text-[12.5px] truncate">{label}</span>}
                {count > 0 ? (
                  <span
                    className={cx(
                      'min-w-[16px] h-[16px] px-1 rounded-full num text-[10px] flex items-center justify-center border',
                      item.id === 'tasks' ? 'bg-warn/15 border-warn/40 text-warn' : 'bg-ok/15 border-ok/40 text-ok',
                      icons ? 'absolute top-0.5 right-1' : 'ml-auto'
                    )}
                    title={item.id === 'tasks' ? t('Tareas que necesitan tu respuesta') : t('nav.busyHere')}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            </React.Fragment>
          )
        })}
      </div>

      <button
        onClick={() => (icons ? reset() : set(56))}
        title={icons ? t('nav.expand') : t('nav.collapse')}
        className="mt-1 mx-2 h-8 rounded-lg flex items-center justify-center gap-2 text-dim hover:text-ink hover:bg-hover transition-colors shrink-0"
      >
        {icons ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
      </button>

      {menu ? (
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={
            menu.id
              ? [
                  { label: t('Abrir aquí'), icon: CornerDownRight, run: () => openSection(menu.id!) },
                  { label: t('Abrir a la derecha'), icon: Columns2, disabled: full || shown.has(menu.id), run: () => openSection(menu.id!, 'row') },
                  { label: t('Abrir abajo'), icon: Rows2, disabled: full || shown.has(menu.id), run: () => openSection(menu.id!, 'col') },
                  null,
                  {
                    label: t('Esconder del menú'),
                    icon: EyeOff,
                    disabled: menu.id === 'settings',
                    run: () => setNav(ws.navOrder, [...ws.navHidden, menu.id!])
                  },
                  ...(custom ? [{ label: t('Dejar el menú como venía'), icon: RotateCcw, run: () => resetNav() }] : [])
                ]
              : [
                  ...ws.navHidden.map((id) => ({
                    label: t('Mostrar {name}', { name: t(`nav.${id}`) }),
                    icon: Eye,
                    run: () => setNav(ws.navOrder, ws.navHidden.filter((x) => x !== id))
                  })),
                  ...(ws.navHidden.length ? [null] : []),
                  { label: t('Dejar el menú como venía'), icon: RotateCcw, disabled: !custom, run: () => resetNav() }
                ]
          }
        />
      ) : null}
    </Pane>
  )
}

function Toasts(): React.JSX.Element {
  const { toasts, dismiss } = useStore()
  const t = useT()
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[380px]">
      {toasts.map((item) => {
        const Icon = item.kind === 'ok' ? CheckCircle2 : item.kind === 'error' ? XCircle : Info
        const color = item.kind === 'ok' ? 'text-ok' : item.kind === 'error' ? 'text-bad' : 'text-accent'
        return (
          <div
            key={item.id}
            className="bg-raised border border-line rounded-xl px-3.5 py-3 flex items-start gap-2.5 shadow-2xl fade-up"
          >
            <Icon size={15} className={cx('mt-0.5 shrink-0', color)} />
            <div className="flex-1 min-w-0">
              <span className="block text-[12.5px] leading-relaxed break-words">{item.text}</span>
              {item.action ? (
                <button
                  className="mt-1.5 text-[12px] text-accent hover:underline"
                  onClick={() => {
                    item.action!.run()
                    dismiss(item.id)
                  }}
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>
            <button onClick={() => dismiss(item.id)} className="text-dim hover:text-ink shrink-0" aria-label={t('common.close')}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Los avisos de cupo también se enseñan dentro de la app, con un botón: al
 * agotarse uno, «Seguir con…» abre la Consola con el agente que más margen
 * tiene; si no, lleva al Panel, donde están todos los cupos.
 */
function useQuotaAlerts(): void {
  const { toast } = useStore()
  const t = useT()
  useEffect(
    () =>
      window.api.quotas.onAlert((a) => {
        const who = `${t(a.provider)} · ${t(a.label)}`
        if (a.level >= 100) {
          const s = a.suggestion
          const text = s
            ? t('Sin cupo: {who}. Puedes seguir con {agent}: {reason}.', {
                who,
                agent: s.agentName,
                reason:
                  s.left != null && s.where
                    ? t('le queda un {n} % en {where}', { n: s.left, where: s.where })
                    : t('no tiene ningún cupo conocido agotado')
              })
            : t('Sin cupo: {who}.', { who })
          toast('error', text, {
            label: a.suggestion ? t('Seguir con {name}', { name: a.suggestion.agentName }) : t('Ver cupos'),
            run: () => navigate(a.suggestion ? { page: 'chat' } : { page: 'dashboard' })
          })
          return
        }
        toast(a.level >= 95 ? 'error' : 'info', t('{pct} % gastado: {who}', { pct: Math.round(a.usedPct), who }), {
          label: t('Ver cupos'),
          run: () => navigate('dashboard')
        })
      }),
    [toast, t]
  )
}

/** Una versión nueva se anuncia una vez por sesión, con un botón a Ajustes. */
function useUpdateToast(): void {
  const { toast } = useStore()
  const t = useT()
  const update = useUpdate()
  const told = React.useRef<string | null>(null)
  useEffect(() => {
    if (!updateAvailable(update) || !update?.latest || told.current === update.latest) return
    told.current = update.latest
    toast('info', t('Hay una versión nueva: v{v}', { v: update.latest }), {
      label: t('Ver'),
      run: () => navigate({ page: 'settings', tab: 'prefs' })
    })
  }, [update, toast, t])
}

/**
 * Las tareas programadas: main avisa cuando le toca a una y aquí se lanza
 * como una del tablero. Después se le cuenta en qué conversación va y cómo
 * acabó, que es lo que enseña la lista de programadas.
 */
function useScheduleRunner(): void {
  const { config, toast } = useStore()
  const t = useT()
  const cfg = React.useRef(config)
  cfg.current = config
  useEffect(
    () =>
      window.api.schedules.onRun((r) => {
        void (async () => {
          const c = cfg.current
          if (!c) {
            await window.api.schedules.finished(r.runId, false, t('La configuración todavía no estaba cargada'))
            return
          }
          const res = await launchTask({ ...r.task, title: r.task.name }, c, t)
          if (res.sessionId) await window.api.schedules.started(r.runId, res.sessionId)
          if (res.error) {
            await window.api.schedules.finished(r.runId, false, res.error)
            toast('error', t('La tarea programada «{name}» no se pudo lanzar: {error}', { name: r.task.name, error: res.error }))
            return
          }
          if (res.warning) toast('error', res.warning)
          toast('info', t('Tarea programada en marcha: {name}', { name: r.task.name }), {
            label: t('Ver'),
            run: () => navigate('tasks')
          })
          const done = await res.done
          const failed = done.error ?? (done.run?.status === 'error' ? (done.run.error ?? t('El agente falló')) : undefined)
          await window.api.schedules.finished(r.runId, !failed, failed)
        })()
      }),
    [t, toast]
  )
}

function Shell(): React.JSX.Element {
  const windowVisible = useDocumentVisible()
  const { config } = useStore()
  const ws = useWorkspace()
  const host = useRef<HTMLDivElement>(null)
  useWindowChrome()
  useQuotaAlerts()
  useUpdateToast()
  useScheduleRunner()

  // La mesa que dejaste la última vez llega con la configuración.
  useEffect(() => adoptWorkspace(config?.settings), [config])

  // Lo que hay en marcha llega al icono de la bandeja, que además pregunta
  // antes de salir si algo se iba a cortar.
  const busy = useBusyCount()
  useEffect(() => {
    void window.api.app.setBusy({ chats: busy.chats, arena: busy.arena, terms: busy.terms })
  }, [busy.chats, busy.arena, busy.terms])

  // Dónde cae cada sección que está a la vista.
  const all = leaves(ws.ws.root)
  const many = all.length > 1
  const header = many ? PANE_HEADER : 0
  const slots = useMemo(() => {
    const { panes } = layout(ws.ws.root)
    return new Map(leaves(ws.ws.root).map((l) => [l.page as PageId, { id: l.id, rect: panes[l.id] }]))
  }, [ws.ws.root])

  // Una página se monta la primera vez que se enseña y a partir de ahí se
  // queda montada, sólo oculta. Así no se pierde el scroll, ni la pestaña
  // activa de la terminal, ni lo que hubiera a medio escribir.
  const [visited, setVisited] = useState<Set<PageId>>(() => new Set<PageId>(['dashboard']))
  useEffect(() => {
    setVisited((v) => {
      let next = v
      for (const page of slots.keys()) if (!next.has(page)) next = new Set(next).add(page)
      return next
    })
  }, [slots])

  // Cualquier parte de la app puede pedir ir a una sección (el relevo, la
  // paleta de comandos, un aviso de cupo): se abre en el panel activo, o se
  // va a su panel si ya está a la vista.
  useEffect(() => onNavigate((t) => openSection(t.page)), [])

  // Atajos: Ctrl+1..9 abre la sección de ese puesto del menú (Cmd en macOS),
  // Ctrl+, Ajustes, Ctrl+\ parte el panel a la derecha (con Mayús, abajo),
  // Ctrl+Mayús+W lo cierra y F6 pasa al siguiente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F6' && !e.altKey && !modKey(e)) {
        e.preventDefault()
        cyclePane(e.shiftKey ? -1 : 1)
        return
      }
      if (!modKey(e) || e.altKey) return
      if (e.code === 'Backslash' || e.key === '\\' || e.key === '|') {
        e.preventDefault()
        splitPane(e.shiftKey ? 'col' : 'row')
        return
      }
      if (e.shiftKey) {
        if (e.key.toLowerCase() === 'w') {
          e.preventDefault()
          closePane()
        }
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        openSection('settings')
        return
      }
      const order = visibleSections(peekWorkspace())
      const n = Number(e.key)
      if (n >= 1 && n <= Math.min(9, order.length)) {
        e.preventDefault()
        openSection(order[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pages = useMemo(
    () => [
      { id: 'dashboard' as PageId, node: <Dashboard onNav={openSection} /> },
      { id: 'chat' as PageId, node: <Chat /> },
      { id: 'arena' as PageId, node: <Arena /> },
      { id: 'terminal' as PageId, node: <Terminals /> },
      { id: 'tasks' as PageId, node: <Tasks /> },
      { id: 'projects' as PageId, node: <Projects onNav={(p) => openSection(p as PageId)} /> },
      { id: 'agents' as PageId, node: <Agents /> },
      { id: 'models' as PageId, node: <Models /> },
      { id: 'house' as PageId, node: <House /> },
      { id: 'history' as PageId, node: <HistoryPage /> },
      { id: 'settings' as PageId, node: <SettingsPage /> }
    ],
    []
  )

  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main ref={host} className="flex-1 min-w-0 overflow-hidden grid-bg relative" data-workbench data-panes={all.length}>
          {pages.map((p) => {
            const slot = slots.get(p.id)
            if (!slot && !visited.has(p.id)) return null
            const r = slot?.rect
            return (
              // Cada sección es una capa que se coloca en el hueco de su panel:
              // cambiar la distribución no la vuelve a montar. `content-visibility`
              // le dice al navegador que no calcule ni pinte las que están ocultas.
              <PaneSizeProvider
                key={p.id}
                className="absolute @container overflow-hidden"
                data-page={p.id}
                data-pane-focus={many && slot?.id === ws.ws.focus ? '' : undefined}
                hidden={!slot}
                style={
                  r
                    ? { left: pct(r.x), top: `calc(${pct(r.y)} + ${header}px)`, width: pct(r.w), height: `calc(${pct(r.h)} - ${header}px)` }
                    : { inset: 0, contentVisibility: 'hidden' }
                }
                onPointerDownCapture={slot ? () => focusPane(slot.id) : undefined}
              >
                <PageActiveProvider active={Boolean(slot) && windowVisible}>
                  <Suspense fallback={<PageLoading />}>{p.node}</Suspense>
                </PageActiveProvider>
              </PaneSizeProvider>
            )
          })}
          <WorkbenchChrome host={host} />
        </main>
      </div>
      <Toasts />
      <SearchModal />
      <CommandPalette />
      <GithubLoginModal />
      <HelpCenter />
      <Tour />
    </div>
  )
}

/** El idioma vive en las preferencias, así que el proveedor lo lee de ahí. */
function Localized({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { lang } = usePrefs()
  return <I18nProvider lang={lang}>{children}</I18nProvider>
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <PrefsProvider>
        <Localized>
          <EngineProvider>
            <Shell />
          </EngineProvider>
        </Localized>
      </PrefsProvider>
    </StoreProvider>
  )
}
