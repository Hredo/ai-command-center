/**
 * Personalización viva.
 *
 * Reúne en un sitio el idioma, la apariencia, las preferencias del editor y los
 * tamaños que el usuario ha arrastrado, y se encarga de tres cosas:
 *
 *  1. Aplicar el tema como variables CSS en el elemento raíz. Cambiar de tema
 *     no vuelve a montar ni un componente: sólo se reescriben variables, y el
 *     navegador repinta. Por eso hay tanta variable y tan poco `style=`.
 *  2. Responder al instante. Lo que se toca se ve en el mismo fotograma porque
 *     el estado vive aquí; lo que va a disco se manda agrupado un momento
 *     después, para no escribir un fichero por cada píxel de un arrastre.
 *  3. Sobrevivir a un arranque con la configuración a medias: si falta un
 *     campo, entra el de fábrica sin que nada se entere.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState
} from 'react'
import type { Appearance, EditorPrefs, Language, PaneSizes } from '@shared/types'
import { DEFAULT_APPEARANCE, DEFAULT_EDITOR, DEFAULT_PANES, PANE_LIMITS } from '@shared/defaults'
import { themeById, type Theme } from './themes'
import { useStore } from './store'

interface Prefs {
  lang: Language
  appearance: Appearance
  editor: EditorPrefs
  panes: PaneSizes
  /** Tema de la aplicación, ya resuelto. */
  theme: Theme
  /** Tema del que salen los colores del código: el suyo propio o el de la app. */
  codeTheme: Theme
  setLanguage: (l: Language) => void
  setAppearance: (patch: Partial<Appearance>) => void
  setEditor: (patch: Partial<EditorPrefs>) => void
  setPane: (key: string, px: number) => void
  resetPanes: () => void
  resetAppearance: () => void
  resetEditor: () => void
}

const Ctx = createContext<Prefs | null>(null)

export function usePrefs(): Prefs {
  const p = useContext(Ctx)
  if (!p) throw new Error('usePrefs fuera del proveedor')
  return p
}

/** Sólo las preferencias del editor: es lo único que necesita casi todo el código. */
export function useEditorPrefs(): EditorPrefs {
  return usePrefs().editor
}

/**
 * Ancho o alto de un panel arrastrable, con sus topes.
 * Devuelve el valor actual y el que hay que guardar al soltar.
 */
export function usePaneSize(key: string): {
  size: number
  min: number
  max: number
  set: (px: number) => void
  reset: () => void
} {
  const { panes, setPane } = usePrefs()
  const limits = PANE_LIMITS[key] ?? { min: 120, max: 900 }
  const fallback = DEFAULT_PANES[key] ?? 260
  const size = clamp(panes[key] ?? fallback, limits.min, limits.max)
  const set = useCallback((px: number) => setPane(key, clamp(px, limits.min, limits.max)), [key, setPane, limits.min, limits.max])
  const reset = useCallback(() => setPane(key, fallback), [key, setPane, fallback])
  return { size, min: limits.min, max: limits.max, set, reset }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/* ------------------------------------------------------------------ *
 * Traducción del tema a variables CSS                                *
 * ------------------------------------------------------------------ */

/**
 * La densidad se aplica moviendo una sola variable: la unidad de espacio.
 *
 * Es la que usa Tailwind para calcular *todos* los rellenos, márgenes, huecos y
 * altos de control (`px-3` es `calc(var(--spacing) * 3)`). Cambiarla encoge o
 * ensancha la interfaz entera de forma proporcionada, sin tener que tocar ni
 * una clase en ningún componente.
 */
const DENSITY: Record<Appearance['density'], string> = {
  compact: '0.215rem',
  cozy: '0.25rem',
  comfortable: '0.29rem'
}

/** Redondeo. Los nombres son los de la escala de Tailwind: `rounded-lg`, etc. */
const CORNERS: Record<
  Appearance['corners'],
  { xs: string; sm: string; md: string; lg: string; xl: string; xxl: string }
> = {
  sharp: { xs: '0px', sm: '0px', md: '1px', lg: '2px', xl: '3px', xxl: '4px' },
  soft: { xs: '3px', sm: '4px', md: '6px', lg: '8px', xl: '12px', xxl: '16px' },
  round: { xs: '5px', sm: '7px', md: '10px', lg: '14px', xl: '20px', xxl: '26px' }
}

/** Mezcla un color con negro o blanco. Sirve para derivar tonos del acento. */
function shade(hex: string, amount: number): string {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const to = amount < 0 ? 0 : 255
  const k = Math.abs(amount)
  const mix = (c: number): number => Math.round(c + (to - c) * k)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** `#rrggbb` → `r g b`, para poder escribir `rgb(var(--x) / 0.5)` en CSS. */
function rgbTriplet(hex: string): string {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim())
  if (!m) return '0 0 0'
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function applyTheme(root: HTMLElement, a: Appearance, theme: Theme, code: Theme, editor: EditorPrefs): void {
  const ui = theme.ui
  const accent = a.accent?.trim() || ui.accent
  const d = DENSITY[a.density] ?? DENSITY.cozy
  const c = CORNERS[a.corners] ?? CORNERS.soft

  const vars: Record<string, string> = {
    /* Armazón */
    '--color-void': ui.void,
    '--color-panel': ui.panel,
    '--color-raised': ui.raised,
    '--color-hover': ui.hover,
    '--color-line': ui.line,
    '--color-line-soft': ui.lineSoft,
    '--color-ink': ui.ink,
    '--color-muted': ui.muted,
    '--color-dim': ui.dim,
    '--color-accent': accent,
    '--color-accent-dim': a.accent?.trim() ? shade(accent, -0.45) : ui.accentDim,
    '--color-accent-soft': shade(accent, 0.25),
    '--color-violet': ui.violet,
    '--color-ok': ui.ok,
    '--color-warn': ui.warn,
    '--color-bad': ui.bad,
    '--rgb-accent': rgbTriplet(accent),
    '--rgb-ok': rgbTriplet(ui.ok),
    '--rgb-warn': rgbTriplet(ui.warn),
    '--rgb-bad': rgbTriplet(ui.bad),
    '--rgb-violet': rgbTriplet(ui.violet),
    '--rgb-panel': rgbTriplet(ui.panel),
    '--rgb-void': rgbTriplet(ui.void),

    /* Tipografía y densidad de la interfaz */
    '--font-sans': a.uiFont,
    '--ui-size': `${a.uiFontSize}px`,
    '--spacing': d,
    '--radius-xs': c.xs,
    '--radius-sm': c.sm,
    '--radius-md': c.md,
    '--radius-lg': c.lg,
    '--radius-xl': c.xl,
    '--radius-2xl': c.xxl,
    '--panel-alpha': String(a.panelOpacity),
    '--motion': a.animations ? '1' : '0',
    '--anim-fast': a.animations ? '0.12s' : '0s',
    '--anim-base': a.animations ? '0.18s' : '0s',
    '--scrollbar-size': a.slimScrollbars ? '8px' : '10px',
    // En claro la rejilla se pinta en negro, y en negro hace falta menos
    // opacidad para que se vea lo mismo.
    '--grid-alpha': a.backgroundGrid ? (theme.dark ? '0.018' : '0.05') : '0',

    /* Editor */
    '--font-mono': editor.fontFamily,
    '--code-size': `${editor.fontSize}px`,
    '--code-lh': String(editor.lineHeight),
    '--code-tracking': `${editor.letterSpacing}px`,
    '--code-tab': String(editor.tabSize),
    '--code-ligatures': editor.ligatures ? 'normal' : 'none',
    '--editor-bg': code.ui.editorBg,
    '--editor-active-line': code.ui.editorActiveLine,
    '--editor-selection': code.ui.editorSelection,
    '--editor-gutter': code.ui.editorGutter,

    /* Código */
    '--tok-com': code.tokens.com,
    '--tok-key': code.tokens.key,
    '--tok-str': code.tokens.str,
    '--tok-num': code.tokens.num,
    '--tok-fn': code.tokens.fn,
    '--tok-typ': code.tokens.typ,
    '--tok-lit': code.tokens.lit,
    '--tok-prop': code.tokens.prop,
    '--tok-tag': code.tokens.tag,
    '--tok-attr': code.tokens.attr,
    '--tok-op': code.tokens.op,
    '--tok-guide': editor.indentGuides ? code.ui.editorGuide : 'transparent'
  }

  code.brackets.forEach((color, i) => {
    vars[`--tok-br${i + 1}`] = editor.bracketPairColorization ? color : code.tokens.op
  })

  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)

  /* Interruptores que el CSS consulta con selectores de atributo. */
  root.dataset.theme = theme.id
  root.dataset.scheme = theme.dark ? 'dark' : 'light'
  root.dataset.motion = a.animations ? 'on' : 'off'
  root.dataset.grid = a.backgroundGrid ? 'on' : 'off'
  root.dataset.whitespace = editor.renderWhitespace ? 'on' : 'off'
  root.dataset.activeLine = editor.highlightActiveLine ? 'on' : 'off'
  root.dataset.cursor = editor.cursorStyle
  root.dataset.cursorBlink = editor.cursorBlink ? 'on' : 'off'
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
}

/* ------------------------------------------------------------------ *
 * Proveedor                                                          *
 * ------------------------------------------------------------------ */

/** Rellena los huecos de una configuración vieja sin pisar lo que ya hay. */
function merge<T extends object>(base: T, saved: Partial<T> | undefined): T {
  if (!saved) return { ...base }
  const out = { ...base }
  for (const k of Object.keys(base) as (keyof T)[]) {
    const v = saved[k]
    if (v !== undefined && v !== null) out[k] = v as T[keyof T]
  }
  return out
}

export function PrefsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { config } = useStore()

  const [lang, setLangState] = useState<Language>('es')
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE)
  const [editor, setEditorState] = useState<EditorPrefs>(DEFAULT_EDITOR)
  const [panes, setPanesState] = useState<PaneSizes>({})

  // La configuración llega del proceso principal un instante después de
  // arrancar. Se adopta una sola vez: a partir de ahí manda lo de aquí, que es
  // lo que el usuario está tocando, y lo de disco va por detrás.
  const adopted = useRef(false)
  useEffect(() => {
    if (adopted.current || !config?.settings) return
    adopted.current = true
    const s = config.settings
    setLangState(s.language === 'en' ? 'en' : 'es')
    setAppearanceState(merge(DEFAULT_APPEARANCE, s.appearance))
    setEditorState(merge(DEFAULT_EDITOR, s.editor))
    setPanesState({ ...(s.panes ?? {}) })
  }, [config])

  /* ------------------------------------------------------- Persistencia */

  // Un arrastre dispara decenas de cambios por segundo. Se acumulan y se
  // escriben juntos: el fichero se toca una vez, no sesenta.
  const pending = useRef<Record<string, unknown>>({})
  const timer = useRef<number | null>(null)

  const persist = useCallback((patch: Record<string, unknown>) => {
    Object.assign(pending.current, patch)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const body = pending.current
      pending.current = {}
      timer.current = null
      void window.api.config.settings(body as never)
    }, 400)
  }, [])

  // Si la ventana se cierra con un cambio a medio guardar, se manda ya.
  useEffect(() => {
    const flush = (): void => {
      if (!timer.current) return
      window.clearTimeout(timer.current)
      timer.current = null
      const body = pending.current
      pending.current = {}
      void window.api.config.settings(body as never)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  /* ------------------------------------------------------------ Cambios */

  const setLanguage = useCallback(
    (l: Language) => {
      setLangState(l)
      persist({ language: l })
    },
    [persist]
  )

  const setAppearance = useCallback(
    (patch: Partial<Appearance>) => {
      setAppearanceState((prev) => {
        const next = { ...prev, ...patch }
        persist({ appearance: next })
        return next
      })
    },
    [persist]
  )

  const setEditor = useCallback(
    (patch: Partial<EditorPrefs>) => {
      setEditorState((prev) => {
        const next = { ...prev, ...patch }
        persist({ editor: next })
        return next
      })
    },
    [persist]
  )

  const setPane = useCallback(
    (key: string, px: number) => {
      setPanesState((prev) => {
        if (prev[key] === px) return prev
        const next = { ...prev, [key]: px }
        persist({ panes: next })
        return next
      })
    },
    [persist]
  )

  const resetPanes = useCallback(() => {
    setPanesState({})
    persist({ panes: {} })
  }, [persist])

  const resetAppearance = useCallback(() => {
    setAppearanceState({ ...DEFAULT_APPEARANCE })
    persist({ appearance: { ...DEFAULT_APPEARANCE } })
  }, [persist])

  const resetEditor = useCallback(() => {
    setEditorState({ ...DEFAULT_EDITOR })
    persist({ editor: { ...DEFAULT_EDITOR } })
  }, [persist])

  /* -------------------------------------------------------- Aplicación */

  const theme = useMemo(() => themeById(appearance.theme), [appearance.theme])
  const codeTheme = useMemo(
    () => (editor.syntaxTheme ? themeById(editor.syntaxTheme) : theme),
    [editor.syntaxTheme, theme]
  )

  // En `useLayoutEffect` para que el tema esté puesto antes del primer pintado
  // y no se vea un parpadeo del tema anterior.
  useLayoutEffect(() => {
    applyTheme(document.documentElement, appearance, theme, codeTheme, editor)
  }, [appearance, theme, codeTheme, editor])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<Prefs>(
    () => ({
      lang, appearance, editor, panes, theme, codeTheme,
      setLanguage, setAppearance, setEditor, setPane, resetPanes, resetAppearance, resetEditor
    }),
    [
      lang, appearance, editor, panes, theme, codeTheme,
      setLanguage, setAppearance, setEditor, setPane, resetPanes, resetAppearance, resetEditor
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
