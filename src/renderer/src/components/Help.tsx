/**
 * La ayuda y el recorrido de bienvenida.
 *
 * La ayuda es la documentación entera de la app (lib/help.ts) en una ventana
 * con buscador: se abre con el botón «?» de la barra de arriba, con F1 o desde
 * la paleta. El recorrido se enseña solo la primera vez: señala, sobre la
 * propia interfaz, dónde está cada cosa, y deja elegir el aspecto. Se puede
 * repetir desde la ayuda.
 */
import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, Check, ExternalLink, FolderGit2, MessageSquare, Play, Search, UserCircle2, X } from 'lucide-react'
import { HELP_GROUPS, HELP_TOPICS, type HelpTopic } from '../lib/help'
import { fold } from '../lib/palette'
import { useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { useStore } from '../lib/store'
import { navigate, type PageId } from '../lib/nav'
import { IS_MAC, withMod } from '../lib/platform'
import { THEMES } from '../lib/themes'
import { Button, cx } from './ui'

const Markdown = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })))

/* ------------------------------------------------------------------ *
 * Estado: qué está abierto                                           *
 * ------------------------------------------------------------------ */

interface HelpState {
  /** El tema abierto en la ayuda, o null si está cerrada. */
  topic: string | null
  /** El paso del recorrido, o null si no está en marcha. */
  tour: number | null
}

let state: HelpState = { topic: null, tour: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<HelpState>): void => {
  state = { ...state, ...patch }
  for (const l of [...listeners]) l()
}
const useHelp = (): HelpState =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => state
  )

export function openHelp(topic = 'start'): void {
  set({ topic: HELP_TOPICS.some((t) => t.id === topic) ? topic : 'start', tour: null })
}

export function closeHelp(): void {
  set({ topic: null })
}

export function startTour(): void {
  set({ topic: null, tour: 0 })
}

function endTour(): void {
  set({ tour: null })
  // Hecho o saltado: no vuelve a salir solo.
  void window.api.config.settings({ tourDone: true })
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__accHelp = { openHelp, closeHelp, startTour, peek: () => state }
}

/** Un atajo escrito para este sistema: ⌘ en macOS, Mayús en vez de Shift. */
function keyLabel(keys: string, t: (s: string) => string): string {
  if (keys === 'Ctrl+Alt+Space') return IS_MAC ? '⌥ ' + t('Espacio') : `Ctrl+Alt+${t('Espacio')}`
  return withMod(keys).replace(/Shift/g, t('Mayús')).replace(/Enter/g, 'Enter')
}

/* ------------------------------------------------------------------ *
 * La ayuda                                                           *
 * ------------------------------------------------------------------ */

function TopicView({ topic, onGo }: { topic: HelpTopic; onGo: (page: PageId, tab?: string) => void }): React.JSX.Element {
  const t = useT()
  const { lang } = usePrefs()
  const Icon = topic.icon
  return (
    <article className="max-w-[680px]" data-help-topic={topic.id}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={17} className="text-accent" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[21px] font-semibold leading-tight">{topic.title[lang]}</h1>
          <p className="text-[13px] text-muted mt-1">{topic.summary[lang]}</p>
        </div>
      </div>

      <div className="mt-5 help-prose">
        <Suspense fallback={<p className="text-dim text-[12.5px]">…</p>}>
          <Markdown>{topic.body[lang]}</Markdown>
        </Suspense>
      </div>

      {topic.keys?.length ? (
        <div className="mt-5 border border-line rounded-xl overflow-hidden" data-help-keys>
          {topic.keys.map((k) => (
            <div key={k.keys} className="flex items-center gap-4 px-3.5 py-2 border-b border-line-soft last:border-0">
              <span className="num text-[11.5px] px-2 py-0.5 rounded-md bg-raised border border-line text-ink whitespace-nowrap min-w-[124px] text-center">
                {keyLabel(k.keys, t)}
              </span>
              <span className="text-[12.5px] text-muted">{k[lang]}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex items-center gap-2 flex-wrap">
        {topic.page ? (
          <Button variant="primary" size="sm" onClick={() => onGo(topic.page!, topic.tab)} data-help-go>
            <ExternalLink size={12} /> {t('Abrir {name}', { name: t(`nav.${topic.page}`) })}
          </Button>
        ) : null}
        {topic.id === 'about-help' || topic.id === 'start' ? (
          <Button size="sm" onClick={() => startTour()} data-help-tour>
            <Play size={12} /> {topic.id === 'start' ? t('Ver el recorrido de bienvenida') : t('Repetir el recorrido')}
          </Button>
        ) : null}
      </div>
    </article>
  )
}

export function HelpCenter(): React.JSX.Element | null {
  const t = useT()
  const { lang } = usePrefs()
  const { topic } = useHelp()
  const [query, setQuery] = useState('')

  // F1 la abre desde cualquier sitio; Esc la cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F1') {
        e.preventDefault()
        if (state.topic) closeHelp()
        else openHelp()
      } else if (e.key === 'Escape' && state.topic) {
        closeHelp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!topic) setQuery('')
  }, [topic])

  const found = useMemo(() => {
    const q = fold(query.trim())
    if (!q) return HELP_TOPICS
    const words = q.split(/\s+/)
    return HELP_TOPICS.filter((tp) => {
      const hay = fold(`${tp.title[lang]} ${tp.summary[lang]} ${tp.body[lang]} ${(tp.keys ?? []).map((k) => k[lang]).join(' ')}`)
      return words.every((w) => hay.includes(w))
    })
  }, [query, lang])

  if (!topic) return null
  const current = found.find((x) => x.id === topic) ?? found[0] ?? null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6 bg-black/60" onMouseDown={closeHelp} data-help>
      <div
        className="w-full max-w-[1020px] h-[min(760px,88vh)] bg-panel border border-line rounded-2xl shadow-2xl flex overflow-hidden fade-up"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Los temas */}
        <nav className="w-[264px] shrink-0 border-r border-line bg-void flex flex-col">
          <div className="px-4 pt-4 pb-3">
            <div className="display text-[15px] font-semibold">{t('Ayuda')}</div>
            <div className="relative mt-3">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Buscar en la ayuda…')}
                className="w-full h-8 pl-7 pr-2 bg-raised border border-line rounded-lg text-[12.5px] outline-none focus:border-accent/60"
                data-help-search
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pb-3">
            {found.length === 0 ? (
              <p className="px-4 text-[12px] text-dim leading-relaxed">{t('Nada con esas palabras. Prueba con otras.')}</p>
            ) : (
              HELP_GROUPS.map((g) => {
                const items = found.filter((x) => x.group === g.id)
                if (!items.length) return null
                return (
                  <div key={g.id} className="mb-2">
                    <div className="px-4 pt-2 pb-1 text-[10.5px] uppercase tracking-wider text-dim">{g.title[lang]}</div>
                    {items.map((x) => {
                      const Icon = x.icon
                      const on = current?.id === x.id
                      return (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => set({ topic: x.id })}
                          data-help-item={x.id}
                          className={cx(
                            'w-[calc(100%-16px)] mx-2 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 text-left transition-colors',
                            on ? 'bg-raised text-ink' : 'text-muted hover:text-ink hover:bg-hover'
                          )}
                        >
                          <Icon size={14} className={cx('shrink-0', on && 'text-accent')} />
                          <span className="text-[12.5px] leading-snug">{x.title[lang]}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        </nav>

        {/* El tema abierto */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-11 shrink-0 flex items-center justify-end px-3 gap-2">
            <span className="text-[11px] text-dim">{t('F1 abre y cierra la ayuda')}</span>
            <Button variant="ghost" size="icon" onClick={closeHelp} aria-label={t('Cerrar')}>
              <X size={15} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-8 pb-8" key={current?.id}>
            {current ? (
              <TopicView
                topic={current}
                onGo={(page, tab) => {
                  closeHelp()
                  navigate({ page, tab })
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * El recorrido de bienvenida                                         *
 * ------------------------------------------------------------------ */

interface TourStep {
  /** Lo que se señala; sin él, la tarjeta va en el centro. */
  target?: string
  /** Hacia dónde cae la tarjeta respecto a lo señalado. */
  side?: 'right' | 'below'
  title: string
  text: string
}

const STEPS: TourStep[] = [
  {
    title: 'Te damos la bienvenida',
    text: 'Aquí tienes juntas todas tus IAs: modelos por API, modelos locales y agentes como Claude Code, Codex u OpenCode. En un minuto ves dónde está cada cosa. Antes, elige cómo quieres verla.'
  },
  {
    target: '[data-sidebar]',
    side: 'right',
    title: 'Las secciones',
    text: 'Desde este menú se llega a todo: la Consola para hablar con una IA o lanzar un agente, Proyectos para tus carpetas, Tareas para ver qué tienen entre manos, el Panel para el gasto. Arrastra una sección sobre otra para cambiar el orden; con el botón derecho escondes las que no uses.'
  },
  {
    target: '[data-layout-menu]',
    side: 'below',
    title: 'Varias secciones a la vez',
    text: 'Este botón divide la ventana: la Consola junto a la Terminal, un proyecto con sus tareas debajo… También puedes arrastrar una sección del menú y soltarla donde quieras, o abrirla al lado con Ctrl+clic.'
  },
  {
    target: '[data-open-palette]',
    side: 'below',
    title: 'Ir a cualquier sitio',
    text: 'Escribe unas letras y salta a una sección, un proyecto, una conversación o un agente. Es la forma más rápida de moverte. «Buscar», a su lado, encuentra texto dentro de tus conversaciones.'
  },
  {
    target: '[data-status]',
    side: 'below',
    title: 'Lo que está pasando',
    text: 'Siempre a la vista: cuántas cosas hay en marcha, cuántos proveedores tienes listos y lo que llevas gastado este mes. Se mueve solo, también con lo que uses fuera de la app.'
  },
  {
    target: '[data-open-help]',
    side: 'below',
    title: 'La ayuda, siempre aquí',
    text: 'Todo lo que hace la app está explicado aquí, con buscador. Se abre con este botón o con F1, y desde ella puedes repetir este recorrido.'
  },
  {
    title: 'Listo. ¿Por dónde empiezas?',
    text: 'Lo primero suele ser conectar tus IAs. Después, añade un proyecto o abre una conversación.'
  }
]

const LOOKS = ['mesa', 'mesa-clara', 'command', 'github-dark']

function Looks(): React.JSX.Element {
  const t = useT()
  const { appearance, setAppearance, lang, setLanguage } = usePrefs()
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-4 gap-2" data-tour-looks>
        {LOOKS.map((id) => {
          const th = THEMES.find((x) => x.id === id)
          if (!th) return null
          const on = appearance.theme === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setAppearance({ theme: id, accent: '' })}
              data-look={id}
              className={cx('rounded-xl border p-1.5 text-left transition-colors', on ? 'border-accent' : 'border-line hover:border-dim')}
            >
              <div className="h-12 rounded-lg overflow-hidden flex" style={{ background: th.ui.void }}>
                <div className="w-1/4 h-full" style={{ background: th.ui.panel, borderRight: `1px solid ${th.ui.line}` }} />
                <div className="flex-1 p-1.5 space-y-1">
                  <div className="h-1.5 w-2/3 rounded-full" style={{ background: th.ui.ink, opacity: 0.85 }} />
                  <div className="h-1.5 w-1/2 rounded-full" style={{ background: th.ui.muted, opacity: 0.6 }} />
                  <div className="h-2 w-1/3 rounded-full" style={{ background: th.ui.accent }} />
                </div>
              </div>
              <div className="mt-1.5 px-0.5 flex items-center gap-1 text-[11.5px]">
                {on ? <Check size={11} className="text-accent" /> : null}
                <span className={on ? 'text-ink' : 'text-muted'}>{id === 'command' ? t('El de antes') : th.name}</span>
              </div>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        {t('Idioma')}
        {(['es', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLanguage(l)}
            className={cx('h-6 px-2 rounded-md border text-[11.5px]', lang === l ? 'border-accent text-accent' : 'border-line text-muted hover:text-ink')}
          >
            {l === 'es' ? 'Español' : 'English'}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-dim">{t('Hay más temas en Ajustes › Apariencia')}</span>
      </div>
    </div>
  )
}

export function Tour(): React.JSX.Element | null {
  const t = useT()
  const { config, info } = useStore()
  const { tour } = useHelp()
  const [box, setBox] = useState<DOMRect | null>(null)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })

  // Sólo la primera vez: en cuanto llega la configuración y no consta hecho.
  const offered = React.useRef(false)
  useEffect(() => {
    if (offered.current || !config?.settings || !info) return
    offered.current = true
    if (config.settings.tourDone || info.tour === false) return
    const timer = window.setTimeout(() => {
      if (state.tour === null && !state.topic) startTour()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [config, info])

  const step = tour != null ? STEPS[tour] : null

  const measure = useCallback(() => {
    setSize({ w: window.innerWidth, h: window.innerHeight })
    const el = step?.target ? document.querySelector(step.target) : null
    setBox(el ? el.getBoundingClientRect() : null)
  }, [step])

  useLayoutEffect(() => {
    if (tour == null) return
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [tour, measure])

  const go = useCallback((delta: number) => {
    if (state.tour == null) return
    const next = state.tour + delta
    if (next < 0) return
    if (next >= STEPS.length) endTour()
    else set({ tour: next })
  }, [])

  useEffect(() => {
    if (tour == null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') endTour()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tour, go])

  if (tour == null || !step) return null
  const first = tour === 0
  const last = tour === STEPS.length - 1
  const CARD = 380
  const pad = 6

  // La tarjeta, al lado de lo que señala y sin salirse de la ventana.
  let card: React.CSSProperties
  if (box) {
    if (step.side === 'right') {
      card = { left: Math.min(box.right + 16, size.w - CARD - 16), top: Math.max(16, Math.min(box.top + 24, size.h - 320)) }
    } else {
      card = { left: Math.max(16, Math.min(box.left + box.width / 2 - CARD / 2, size.w - CARD - 16)), top: Math.min(box.bottom + 14, size.h - 300) }
    }
  } else {
    card = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  }

  const finishTo = (page: PageId, tab?: string): void => {
    endTour()
    navigate({ page, tab })
  }

  return (
    <div className="fixed inset-0 z-[90]" data-tour data-tour-step={tour}>
      {/* El foco: lo señalado queda a la luz y el resto, en penumbra. */}
      {box ? (
        <div
          className="absolute rounded-xl border-2 border-accent pointer-events-none"
          style={{
            left: box.left - pad,
            top: box.top - pad,
            width: box.width + pad * 2,
            height: box.height + pad * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.62)',
            transition: 'left var(--anim-base) ease, top var(--anim-base) ease, width var(--anim-base) ease, height var(--anim-base) ease'
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      <div
        className={cx('absolute bg-panel border border-line rounded-2xl shadow-2xl p-5', first || last ? 'w-[520px]' : 'w-[380px]')}
        style={first || last ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } : card}
        role="dialog"
        aria-label={t(step.title)}
        data-tour-card
      >
        <div className="flex items-start gap-3">
          <h2 className="display text-[18px] font-semibold leading-snug flex-1">{t(step.title)}</h2>
          <button type="button" onClick={endTour} className="text-dim hover:text-ink shrink-0 mt-0.5" title={t('Saltar el recorrido')} data-tour-skip>
            <X size={15} />
          </button>
        </div>
        <p className="text-[13px] text-muted leading-relaxed mt-2">{withMod(t(step.text))}</p>

        {first ? <Looks /> : null}

        {last ? (
          <div className="mt-4 grid grid-cols-3 gap-2" data-tour-next>
            <button type="button" onClick={() => finishTo('settings', 'accounts')} className="rounded-xl border border-accent bg-accent/10 p-3 text-left hover:bg-accent/15" data-tour-go="accounts">
              <UserCircle2 size={16} className="text-accent" />
              <div className="text-[12.5px] font-medium mt-1.5">{t('Conectar mis IAs')}</div>
              <div className="text-[11px] text-dim leading-snug mt-0.5">{t('Iniciar sesión y poner claves')}</div>
            </button>
            <button type="button" onClick={() => finishTo('projects')} className="rounded-xl border border-line p-3 text-left hover:border-dim hover:bg-hover" data-tour-go="projects">
              <FolderGit2 size={16} className="text-muted" />
              <div className="text-[12.5px] font-medium mt-1.5">{t('Añadir un proyecto')}</div>
              <div className="text-[11px] text-dim leading-snug mt-0.5">{t('Una carpeta en la que trabajar')}</div>
            </button>
            <button type="button" onClick={() => finishTo('chat')} className="rounded-xl border border-line p-3 text-left hover:border-dim hover:bg-hover" data-tour-go="chat">
              <MessageSquare size={16} className="text-muted" />
              <div className="text-[12.5px] font-medium mt-1.5">{t('Abrir la Consola')}</div>
              <div className="text-[11px] text-dim leading-snug mt-0.5">{t('Hablar con un modelo o un agente')}</div>
            </button>
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-2">
          <div className="flex items-center gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={cx('h-1.5 rounded-full transition-all', i === tour ? 'w-5 bg-accent' : 'w-1.5 bg-line')} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {first ? (
              <Button variant="ghost" size="sm" onClick={endTour}>
                {t('Saltar')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => go(-1)} data-tour-back>
                <ArrowLeft size={12} /> {t('Atrás')}
              </Button>
            )}
            <Button variant={last ? 'outline' : 'primary'} size="sm" onClick={() => go(1)} data-tour-next-btn>
              {last ? t('Cerrar') : first ? t('Empezar') : t('Siguiente')} {last ? null : <ArrowRight size={12} />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
