import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react'
import {
  LayoutDashboard, MessageSquare, Swords, FolderGit2, Bot, Boxes, History, Settings2,
  Radar, CheckCircle2, XCircle, Info, X, TerminalSquare, Activity, Home, PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'
import { StoreProvider, useStore } from './lib/store'
import { PrefsProvider, usePrefs, usePaneSize } from './lib/prefs'
import { I18nProvider, useT } from './lib/i18n'
import { PageActiveProvider, useDocumentVisible } from './lib/pageActive'
import { EngineProvider, useBusyCount, useInFlight, useRunsVersion } from './lib/engine'
import { cx } from './components/ui'
import { Pane } from './components/Resizable'
import { cost } from './lib/format'
import { TITLEBAR_HEIGHT } from '@shared/defaults'
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

export type PageId =
  | 'dashboard' | 'chat' | 'arena' | 'terminal' | 'projects' | 'agents' | 'models' | 'house'
  | 'history' | 'settings'

const NAV: { id: PageId; icon: React.ElementType; group: number }[] = [
  { id: 'dashboard', icon: LayoutDashboard, group: 0 },
  { id: 'chat', icon: MessageSquare, group: 0 },
  { id: 'arena', icon: Swords, group: 0 },
  { id: 'terminal', icon: TerminalSquare, group: 0 },
  { id: 'projects', icon: FolderGit2, group: 1 },
  { id: 'agents', icon: Bot, group: 1 },
  { id: 'models', icon: Boxes, group: 1 },
  { id: 'house', icon: Home, group: 1 },
  { id: 'history', icon: History, group: 2 },
  { id: 'settings', icon: Settings2, group: 2 }
]

/** Por debajo de este ancho el menú se queda sólo con los iconos. */
const ICONS_ONLY = 112

/**
 * La barra de título y los botones de Windows.
 *
 * Los botones los pinta el sistema, no la aplicación, así que hay que
 * mantenerlos de acuerdo con el tema y con la escala a mano: si no, quedan
 * blancos sobre un panel claro o a media altura al ampliar la interfaz.
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
  const t = useT()
  const busy = useBusyCount()
  const version = useRunsVersion()
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
      style={{ height: TITLEBAR_HEIGHT }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-[18px] h-[18px] rounded-[5px] bg-gradient-to-br from-accent to-violet shrink-0" />
        <span className="text-[12.5px] font-medium tracking-tight">AI Command Center</span>
        <span className="num text-[10.5px] text-dim opacity-70">v{info?.version ?? '0.1.0'}</span>
      </div>
      <div className="flex items-center gap-4 text-[11.5px] pr-[140px]">
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
    </div>
  )
}

function Sidebar({ page, onNav }: { page: PageId; onNav: (p: PageId) => void }): React.JSX.Element {
  const t = useT()
  const busy = useBusyCount()
  const { size, set, reset } = usePaneSize('nav.width')
  const icons = size < ICONS_ONLY

  const badge: Partial<Record<PageId, number>> = {
    chat: busy.chats,
    arena: busy.arena,
    terminal: busy.terms
  }

  return (
    <Pane paneKey="nav.width" side="right" className="border-r border-line bg-void flex flex-col py-2">
      {NAV.map((item, i) => {
        const prev = NAV[i - 1]
        const Icon = item.icon
        const on = page === item.id
        const count = badge[item.id] ?? 0
        const label = t(`nav.${item.id}`)
        return (
          <React.Fragment key={item.id}>
            {prev && prev.group !== item.group ? <div className="h-px bg-line-soft mx-3 my-2" /> : null}
            <button
              onClick={() => onNav(item.id)}
              title={icons ? label : undefined}
              className={cx(
                'mx-2 h-8 px-2.5 rounded-lg flex items-center gap-2.5 transition-colors relative',
                icons && 'justify-center px-0',
                on ? 'bg-raised text-ink' : 'text-muted hover:text-ink hover:bg-hover'
              )}
            >
              {on ? <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" /> : null}
              <Icon size={15} className={on ? 'text-accent' : ''} />
              {icons ? null : <span className="text-[12.5px] truncate">{label}</span>}
              {count > 0 ? (
                <span
                  className={cx(
                    'min-w-[16px] h-[16px] px-1 rounded-full bg-ok/15 border border-ok/40 text-ok num text-[10px] flex items-center justify-center',
                    icons ? 'absolute top-0.5 right-1' : 'ml-auto'
                  )}
                  title={t('nav.busyHere')}
                >
                  {count}
                </span>
              ) : null}
            </button>
          </React.Fragment>
        )
      })}

      <button
        onClick={() => (icons ? reset() : set(56))}
        title={icons ? t('nav.expand') : t('nav.collapse')}
        className="mt-auto mx-2 h-8 rounded-lg flex items-center justify-center gap-2 text-dim hover:text-ink hover:bg-hover transition-colors"
      >
        {icons ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
      </button>
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
            <span className="flex-1 text-[12.5px] leading-relaxed break-words">{item.text}</span>
            <button onClick={() => dismiss(item.id)} className="text-dim hover:text-ink shrink-0" aria-label={t('common.close')}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Shell(): React.JSX.Element {
  const [page, setPage] = useState<PageId>('dashboard')
  const windowVisible = useDocumentVisible()
  useWindowChrome()

  // Una página se monta la primera vez que se visita y a partir de ahí se
  // queda montada, sólo oculta. Así no se pierde el scroll, ni la pestaña
  // activa de la terminal, ni lo que hubiera a medio escribir.
  const [visited, setVisited] = useState<Set<PageId>>(() => new Set<PageId>(['dashboard']))

  const nav = useCallback((p: PageId): void => {
    setPage(p)
    setVisited((v) => (v.has(p) ? v : new Set(v).add(p)))
  }, [])

  // Atajos: Ctrl+1..9 salta de sección.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= NAV.length) {
        e.preventDefault()
        nav(NAV[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav])

  const pages = useMemo(
    () => [
      { id: 'dashboard' as PageId, node: <Dashboard onNav={nav} /> },
      { id: 'chat' as PageId, node: <Chat /> },
      { id: 'arena' as PageId, node: <Arena /> },
      { id: 'terminal' as PageId, node: <Terminals /> },
      { id: 'projects' as PageId, node: <Projects onNav={(p) => nav(p as PageId)} /> },
      { id: 'agents' as PageId, node: <Agents /> },
      { id: 'models' as PageId, node: <Models /> },
      { id: 'house' as PageId, node: <House /> },
      { id: 'history' as PageId, node: <HistoryPage /> },
      { id: 'settings' as PageId, node: <SettingsPage /> }
    ],
    [nav]
  )

  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar page={page} onNav={nav} />
        <main className="flex-1 min-w-0 overflow-hidden grid-bg relative">
          {pages.map((p) =>
            visited.has(p.id) ? (
              // `content-visibility` le dice al navegador que no calcule el
              // diseño ni pinte lo que está oculto. Con diez páginas montadas a
              // la vez —que es el precio de no perder el estado al cambiar de
              // pestaña— eso es la diferencia entre un repintado y diez.
              <div
                key={p.id}
                className="absolute inset-0"
                hidden={page !== p.id}
                style={page === p.id ? undefined : { contentVisibility: 'hidden' }}
              >
                <PageActiveProvider active={page === p.id && windowVisible}>
                  <Suspense fallback={<PageLoading />}>{p.node}</Suspense>
                </PageActiveProvider>
              </div>
            ) : null
          )}
        </main>
      </div>
      <Toasts />
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
