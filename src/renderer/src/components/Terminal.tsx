/**
 * Terminal integrada.
 *
 * Con consola de verdad detrás (ConPTY en Windows, un pseudoterminal en macOS
 * y Linux) se usa xterm.js: es un emulador completo, así que las aplicaciones
 * de pantalla completa —opencode, vim, los agentes en modo interactivo— se
 * dibujan y responden igual que en Windows Terminal o en Terminal.app. El
 * teclado va tal cual a la consola, incluido Ctrl+C.
 *
 * Si el módulo nativo del PTY no cargara, la app cae al motor por tuberías y
 * esta vista pinta la salida en bloques al estilo de Warp: cada comando con su
 * código de salida y su duración. Es menos capaz pero deja la app usable.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import {
  TerminalSquare, Play, Square, Trash2, Copy, Check, RotateCw, ChevronRight,
  ChevronDown, CornerDownLeft, FolderOpen, AlertCircle, Info
} from 'lucide-react'
import { Button, Badge, cx, Dot } from './ui'
import { parseAnsi, stripAnsi } from '../lib/ansi'
import { ms } from '../lib/format'
import {
  sendTermCommand, interruptTerm, clearTerm, writeTerm, resizeTerm, useTerm, useTick,
  onTermData, termScrollback, type TermBlock, type TermSegment
} from '../lib/engine'
import { useT } from '../lib/i18n'
import { IS_MAC } from '../lib/platform'

/** Líneas que se muestran antes de plegar la salida de un bloque. */
const COLLAPSE_AFTER = 220

/** Paleta del emulador, a juego con el tema de la app. */
const THEME = {
  background: '#07080c',
  foreground: '#e7eaf2',
  cursor: '#22d3ee',
  cursorAccent: '#07080c',
  selectionBackground: '#22d3ee33',
  black: '#1e2231',
  red: '#fb7185',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#c3cad9',
  brightBlack: '#5c6478',
  brightRed: '#fda4af',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff'
}

function CopyButton({ text, title = 'Copiar' }: { text: string; title?: string }): React.JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="text-dim hover:text-ink transition-colors p-0.5"
      title={title}
    >
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Vista con emulador (PTY)                                           *
 * ------------------------------------------------------------------ */

function XtermView({ termId }: { termId: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return

    const term = new XTerm({
      theme: THEME,
      fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 8000,
      allowProposedApi: true,
      // La app ya captura Ctrl+1..9 para navegar; el resto va a la consola.
      macOptionIsMeta: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(
      new WebLinksAddon((_e, uri) => {
        void window.api.app.openExternal(uri)
      })
    )
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    /**
     * Ctrl+C con texto seleccionado copia; sin selección es una interrupción
     * de verdad, que es lo que uno espera en una terminal. Ctrl+V pega.
     * Devolver false le dice a xterm que no mande la tecla a la consola.
     */
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      // En macOS copiar y pegar son Cmd+C y Cmd+V, que llegan por el menú
      // Edición y xterm ya los entiende; Ctrl+C y Ctrl+V van siempre a la
      // consola, como en Terminal.app.
      if (IS_MAC) return true
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
        const sel = term.getSelection()
        if (sel) {
          void navigator.clipboard.writeText(sel)
          term.clearSelection()
          return false
        }
        return true
      }
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') {
        void navigator.clipboard.readText().then((text) => {
          if (text) writeTerm(termId, text)
        })
        return false
      }
      // Ctrl+Mayús+C copia siempre, como en Windows Terminal.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        const sel = term.getSelection()
        if (sel) void navigator.clipboard.writeText(sel)
        return false
      }
      return true
    })

    // Al volver a la pestaña el emulador es nuevo: se repinta lo que había.
    const back = termScrollback(termId)
    if (back) term.write(back)

    const offData = onTermData(termId, (f) => {
      if (f.type === 'clear') term.clear()
      else term.write(f.data)
    })

    // Lo que se teclea va crudo a la consola.
    const keyDisposable = term.onData((data) => writeTerm(termId, data))

    const applyFit = (): void => {
      try {
        fit.fit()
        resizeTerm(termId, term.cols, term.rows)
      } catch {
        // El panel puede estar oculto: se reintentará al volver a mostrarse.
      }
    }

    // El panel cambia de tamaño al redimensionar la ventana y al plegar
    // barras laterales, así que se observa el contenedor y no window.
    // El contenedor observado cambia de tamaño al redimensionar la ventana,
    // al plegar barras y también al pasar de oculto (0 px) a visible: eso
    // último es justo lo que hace falta al volver a esta pestaña.
    const ro = new ResizeObserver(() => applyFit())
    ro.observe(el)
    applyFit()
    setTimeout(applyFit, 120)
    // Si esta terminal nace escondida —la abriste estando en otra pestaña— no
    // se le roba el foco a lo que estés mirando.
    if (el.offsetParent !== null) term.focus()

    return () => {
      ro.disconnect()
      offData()
      keyDisposable.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [termId])

  // Al mostrarse otra vez, el emulador recupera el foco y se reajusta: viniendo
  // de `display:none` xterm cree que mide cero y pinta una sola columna.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      try {
        fitRef.current?.fit()
        const t = termRef.current
        if (t) resizeTerm(termId, t.cols, t.rows)
        t?.focus()
      } catch {
        /* todavía sin tamaño: el observador de tamaño lo recogerá */
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [termId])

  return <div ref={host} className="h-full w-full" />
}

/* ------------------------------------------------------------------ *
 * Vista por bloques (respaldo por tuberías)                          *
 * ------------------------------------------------------------------ */

function Output({ segments }: { segments: TermSegment[] }): React.JSX.Element {
  const nodes = useMemo(() => {
    const out: React.ReactNode[] = []
    let key = 0
    for (const seg of segments) {
      for (const span of parseAnsi(seg.text)) {
        const color = span.color ?? (seg.kind === 'err' ? '#fda4af' : undefined)
        out.push(
          <span
            key={key++}
            style={{
              color,
              fontWeight: span.bold ? 600 : undefined,
              opacity: span.dim ? 0.6 : undefined,
              fontStyle: span.italic ? 'italic' : undefined,
              textDecoration: span.underline ? 'underline' : undefined
            }}
          >
            {span.text}
          </span>
        )
      }
    }
    return out
  }, [segments])

  return <>{nodes}</>
}

function Block({ block, onRerun }: { block: TermBlock; onRerun: (cmd: string) => void }): React.JSX.Element {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const [expandLong, setExpandLong] = useState(false)
  useTick()

  const plain = useMemo(() => stripAnsi(block.segments.map((s) => s.text).join('')), [block.segments])
  const lineCount = useMemo(() => (plain ? plain.split('\n').length : 0), [plain])
  const tooLong = lineCount > COLLAPSE_AFTER && !expandLong

  const segments = useMemo(() => {
    if (!tooLong) return block.segments
    const joined = block.segments.map((s) => s.text).join('')
    const lines = joined.split('\n')
    return [{ kind: 'out' as const, text: lines.slice(-COLLAPSE_AFTER).join('\n') }]
  }, [block.segments, tooLong])

  const elapsed = block.running ? Date.now() - block.startedAt : block.durationMs

  if (block.system) {
    return (
      <div className="px-4 py-2 border-l-2 border-[#4a3a14] bg-[#14110a] font-mono text-[12px] whitespace-pre-wrap break-words leading-[1.55]">
        <Output segments={block.segments} />
      </div>
    )
  }

  const failed = block.ok === false

  return (
    <div className="border-b border-line-soft last:border-b-0">
      <div
        className={cx(
          'group px-4 py-2 flex items-start gap-2 cursor-pointer select-none',
          failed ? 'bg-[#150d10]' : 'bg-[#0c0e15]',
          'hover:bg-[#12151f]'
        )}
        onClick={() => setCollapsed((c) => !c)}
      >
        <button className="text-dim hover:text-ink mt-[3px] shrink-0" title={collapsed ? 'Desplegar' : 'Plegar'}>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span className={cx('font-mono text-[12px] shrink-0 mt-[1px]', failed ? 'text-bad' : 'text-accent')}>❯</span>
        <span className="font-mono text-[12.5px] flex-1 min-w-0 break-words whitespace-pre-wrap text-ink">
          {block.command}
        </span>

        <div className="flex items-center gap-2 shrink-0 pt-[1px]">
          {block.running ? (
            <span className="flex items-center gap-1.5 text-[11px] text-ok">
              <Dot tone="ok" pulse />
              <span className="num">{ms(elapsed)}</span>
            </span>
          ) : (
            <>
              {elapsed != null ? <span className="num text-[11px] text-dim">{ms(elapsed)}</span> : null}
              {failed ? <Badge tone="bad">{t('term.exitCode', { code: block.exitCode ?? '?' })}</Badge> : <Check size={12} className="text-ok" />}
            </>
          )}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <CopyButton text={block.command} title={t('Copiar el comando')} />
            {plain ? <CopyButton text={plain} title={t('Copiar la salida')} /> : null}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRerun(block.command)
              }}
              className="text-dim hover:text-accent transition-colors p-0.5"
              title={t('Volver a lanzarlo')}
            >
              <RotateCw size={12} />
            </button>
          </div>
        </div>
      </div>

      {!collapsed && (plain || block.running) ? (
        <div className="px-4 py-2 font-mono text-[12px] whitespace-pre-wrap break-words leading-[1.55] text-muted">
          {tooLong ? (
            <button onClick={() => setExpandLong(true)} className="mb-2 text-[11px] text-accent hover:underline block">
              {t('term.showingLast', { n: COLLAPSE_AFTER, total: lineCount })}
            </button>
          ) : null}
          <Output segments={segments} />
          {block.running ? <span className="caret" /> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Entrada de comandos del modo respaldo, con historial. */
function PipeInput({ termId, busy, alive, history }: {
  termId: string
  busy: boolean
  alive: boolean
  history: string[]
}): React.JSX.Element {
  const t = useT()
  const [input, setInput] = useState('')
  const [histIndex, setHistIndex] = useState<number | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = (): void => {
    if (!input.trim()) return
    sendTermCommand(termId, input)
    setInput('')
    setHistIndex(null)
  }

  return (
    <div className="px-3 py-2.5 flex items-end gap-2">
      <span className="font-mono text-[13px] pb-[3px] shrink-0 text-accent">❯</span>
      <textarea
        ref={ref}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
            e.preventDefault()
            if (busy) interruptTerm(termId)
            else setInput('')
            return
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
            return
          }
          if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault()
            clearTerm(termId)
            return
          }
          if (e.key === 'ArrowUp' && !input.includes('\n')) {
            e.preventDefault()
            if (!history.length) return
            const next = histIndex === null ? history.length - 1 : Math.max(0, histIndex - 1)
            setHistIndex(next)
            setInput(history[next])
            return
          }
          if (e.key === 'ArrowDown' && histIndex !== null) {
            e.preventDefault()
            const next = histIndex + 1
            if (next >= history.length) {
              setHistIndex(null)
              setInput('')
            } else {
              setHistIndex(next)
              setInput(history[next])
            }
          }
        }}
        rows={Math.min(6, input.split('\n').length)}
        spellCheck={false}
        disabled={!alive}
        placeholder={alive ? t('Comando…') : t('La shell se ha cerrado. Abre otra terminal.')}
        className="flex-1 min-w-0 bg-transparent border-0 outline-none resize-none font-mono text-[12.5px] leading-[1.5] text-ink placeholder:text-[#3a4255] py-0.5"
      />
      <div className="shrink-0 flex items-center gap-1.5 pb-0.5">
        {!alive ? <AlertCircle size={13} className="text-bad" /> : null}
        <span className="text-[10.5px] text-[#3a4255] flex items-center gap-1">
          <CornerDownLeft size={10} /> {t('Intro')}
        </span>
        <Button size="sm" variant="ghost" onClick={submit} disabled={!input.trim() || !alive}>
          <Play size={11} />
        </Button>
      </div>
    </div>
  )
}

function PipeView({ termId }: { termId: string }): React.JSX.Element {
  const t = useT()
  const state = useTerm(termId)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const blocks = state?.blocks ?? []
  const busy = state?.busy ?? false

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [blocks, busy])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  if (!state) return <div />

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-2 shrink-0 bg-[#14110a] border-b border-[#4a3a14] flex items-start gap-2 text-[11.5px] leading-relaxed">
        <Info size={13} className="text-warn shrink-0 mt-0.5" />
        <span className="text-muted">
          Modo reducido: no se pudo cargar la consola nativa, así que sólo funcionan los comandos
          que escriben de corrido. Las aplicaciones de pantalla completa no se dibujarán.
          {state.info.backendReason ? (
            <span className="text-dim"> ({state.info.backendReason})</span>
          ) : null}
        </span>
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto">
        {blocks.length === 0 ? (
          <div className="px-4 py-6 text-[12.5px] text-dim font-mono leading-relaxed">
            <div className="flex items-center gap-2 mb-2 text-muted">
              <FolderOpen size={13} /> {state.info.cwd}
            </div>
            {state.ready ? t('Escribe un comando y pulsa Intro.') : <span className="caret">{t('arrancando')}</span>}
          </div>
        ) : (
          blocks.map((b) => <Block key={b.id} block={b} onRerun={(cmd) => sendTermCommand(termId, cmd)} />)
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-void">
        {busy ? (
          <div className="px-3 py-1.5 flex items-center gap-2.5 border-b border-line-soft text-[11px]">
            <Dot tone="ok" pulse />
            <span className="text-muted">{t('Un comando está en marcha.')}</span>
            <button
              onClick={() => interruptTerm(termId)}
              className="ml-auto flex items-center gap-1 text-bad hover:underline"
            >
              <Square size={10} /> cortar (Ctrl+C)
            </button>
          </div>
        ) : null}
        <PipeInput termId={termId} busy={busy} alive={state.info.alive} history={state.history} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Vista pública                                                      *
 * ------------------------------------------------------------------ */

export interface TerminalViewProps {
  termId: string
  /** Cabecera compacta, para cuando ya hay pestañas encima. */
  compact?: boolean
  className?: string
}

export function TerminalView({ termId, compact, className }: TerminalViewProps): React.JSX.Element {
  const t = useT()
  const state = useTerm(termId)
  useTick()

  if (!state) {
    return (
      <div className={cx('h-full flex items-center justify-center text-[12.5px] text-dim', className)}>
        {t('Esta terminal ya no existe.')}
      </div>
    )
  }

  const isPty = state.info.backend === 'pty'
  const last = state.lastExit

  return (
    <div className={cx('h-full flex flex-col min-h-0 bg-[#07080c]', className)}>
      {!compact ? (
        <div className="h-9 px-3 shrink-0 border-b border-line flex items-center gap-2.5 bg-void">
          <TerminalSquare size={13} className="text-accent shrink-0" />
          <span className="text-[12px] text-muted shrink-0">{state.info.shellLabel}</span>
          <span className="num text-[11px] text-dim truncate flex-1 min-w-0" title={state.info.cwd}>
            {state.info.cwd}
          </span>
          {state.busy ? <Badge tone="ok">{t('ejecutando')}</Badge> : null}
          {!state.info.alive ? <Badge tone="bad">{t('cerrada')}</Badge> : null}
          <button
            onClick={() => clearTerm(termId)}
            className="text-dim hover:text-ink p-1"
            title={t('Limpiar la pantalla')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative">
        {isPty ? <XtermView termId={termId} /> : <PipeView termId={termId} />}
      </div>

      {/* Franja de estado: sólo en modo consola, donde no hay bloques. */}
      {isPty ? (
        <div className="h-7 shrink-0 border-t border-line bg-void px-3 flex items-center gap-3 text-[11px]">
          {state.busy ? (
            <>
              <span className="flex items-center gap-1.5 text-ok">
                <Dot tone="ok" pulse /> {t('ejecutando')}
              </span>
              <button
                onClick={() => interruptTerm(termId)}
                className="flex items-center gap-1 text-dim hover:text-bad"
                title={t('Manda un Ctrl+C de verdad a la consola')}
              >
                <Square size={9} /> {t('cortar')}
              </button>
            </>
          ) : last ? (
            <span className={cx('flex items-center gap-1.5', last.code === 0 ? 'text-dim' : 'text-bad')}>
              {last.code === 0 ? <Check size={11} className="text-ok" /> : <AlertCircle size={11} />}
              {t('term.lastCommand')} <span className="num">{last.code}</span>
              {last.durationMs != null ? (
                <>
                  {' · '}
                  <span className="num">{ms(last.durationMs)}</span>
                </>
              ) : null}
            </span>
          ) : (
            <span className="text-dim">{t('consola lista')}</span>
          )}

          {!state.info.alive ? <span className="text-bad">{t('la shell se ha cerrado')}</span> : null}
          <span className="ml-auto num text-[#3a4255] truncate max-w-[45%]" title={state.info.cwd}>
            {state.info.cwd}
          </span>
        </div>
      ) : null}
    </div>
  )
}
