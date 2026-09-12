/**
 * Código en pantalla: sólo lectura y editable.
 *
 * El editor es un textarea transparente encima de una capa con el mismo texto
 * coloreado. Es la forma barata de tener colores sin meter un editor entero
 * dentro de la aplicación: el textarea sigue siendo un textarea (deshacer,
 * selección, teclado del sistema, corrector, accesibilidad) y lo único que se
 * ve es la capa de abajo.
 *
 * Lo delicado es que las dos capas midan exactamente igual. De eso se encarga
 * la hoja de estilos, que saca tipografía, tamaño, interlineado y espaciado de
 * las mismas variables para las dos; aquí sólo se sincroniza el desplazamiento
 * y se añade lo que un textarea no sabe hacer solo: números de línea, línea
 * activa, regla, minimapa y las manías de teclado que uno espera de un editor.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { highlightBlock, indentUnit, langFromPath, type Lang } from '../lib/highlight'
import { useEditorPrefs, usePrefs } from '../lib/prefs'
import { cx } from './ui'

/** A partir de aquí colorear cuesta más de lo que aporta. */
const MAX_PAINT = 400_000

/** Y a partir de aquí ni se intenta dibujar el minimapa. */
const MAX_MINIMAP_LINES = 60_000

/* ------------------------------------------------------------------ *
 * Minimapa                                                           *
 * ------------------------------------------------------------------ */

/**
 * La silueta del fichero, dibujada en un lienzo.
 *
 * No se pintan las letras: a esa escala no se leerían igual. Lo que se dibuja
 * es lo que de verdad se reconoce de un vistazo —dónde empieza cada línea y
 * cuánto ocupa— más un tono distinto para los comentarios, que es lo que
 * permite localizar el bloque que buscas sin leer nada.
 */
function Minimap({
  value,
  width,
  onJump,
  scrollTop,
  viewHeight,
  contentHeight
}: {
  value: string
  width: number
  onJump: (ratio: number) => void
  scrollTop: number
  viewHeight: number
  contentHeight: number
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const { codeTheme } = usePrefs()

  useEffect(() => {
    const el = canvas.current
    const wrap = box.current
    if (!el || !wrap) return

    const w = wrap.clientWidth
    const h = wrap.clientHeight
    if (w <= 0 || h <= 0) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    el.width = Math.round(w * dpr)
    el.height = Math.round(h * dpr)
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const lines = value.split('\n', MAX_MINIMAP_LINES)
    const rowH = Math.max(1, Math.min(3, h / Math.max(lines.length, 1)))
    const charW = Math.max(0.6, (w - 4) / 110)

    for (let i = 0; i < lines.length; i++) {
      const y = i * rowH
      if (y > h) break
      const line = lines[i]
      const trimmed = line.trimStart()
      if (!trimmed) continue
      const indent = line.length - trimmed.length
      const comment = /^(\/\/|#|\*|\/\*|--|<!--)/.test(trimmed)
      ctx.fillStyle = comment ? codeTheme.tokens.com : codeTheme.ui.ink
      ctx.globalAlpha = comment ? 0.4 : 0.62
      const x = 2 + indent * charW
      const len = Math.min(trimmed.length, 110 - indent) * charW
      if (len > 0) ctx.fillRect(x, y, len, Math.max(1, rowH - 0.4))
    }
  }, [value, width, codeTheme])

  const ratioOf = (e: React.PointerEvent): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  }

  const viewTop = contentHeight > 0 ? (scrollTop / contentHeight) * 100 : 0
  const viewPct = contentHeight > 0 ? Math.min(100, (viewHeight / contentHeight) * 100) : 100

  return (
    <div
      ref={box}
      className="code-minimap shrink-0"
      style={{ width }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onJump(ratioOf(e))
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) onJump(ratioOf(e))
      }}
    >
      <canvas ref={canvas} />
      <div className="view" style={{ top: `${viewTop}%`, height: `${viewPct}%` }} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Editable                                                           *
 * ------------------------------------------------------------------ */

/** Parejas que se cierran solas al escribir la de apertura. */
const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  "'": "'",
  '"': '"',
  '`': '`'
}

export function CodeEditor({
  value,
  onChange,
  path,
  lang,
  readOnly,
  onSave,
  areaRef
}: {
  value: string
  onChange: (next: string) => void
  /** Para deducir el lenguaje cuando no se pasa a mano. */
  path?: string
  lang?: Lang
  readOnly?: boolean
  onSave?: () => void
  areaRef?: React.MutableRefObject<HTMLTextAreaElement | null>
}): React.JSX.Element {
  const prefs = useEditorPrefs()
  const area = useRef<HTMLTextAreaElement | null>(null)
  const layer = useRef<HTMLPreElement | null>(null)
  const gutter = useRef<HTMLDivElement | null>(null)
  const activeLine = useRef<HTMLDivElement | null>(null)

  /** Sólo lo que necesitan los adornos: fila del cursor y desplazamiento. */
  const [caretLine, setCaretLine] = useState(0)
  const [scroll, setScroll] = useState({ top: 0, view: 0, content: 0 })

  const language = lang ?? langFromPath(path ?? '')

  // Si el fichero ya viene sangrado, se respeta su unidad; si está vacío o no
  // se sabe, manda la preferencia. Pintar guías de dos en un fichero de cuatro
  // queda peor que no pintarlas.
  const fileUnit = useMemo(() => indentUnit(value), [value])
  const unit = value.trim() ? fileUnit : prefs.tabSize

  const html = useMemo(
    () =>
      value.length > MAX_PAINT
        ? null
        : highlightBlock(value + '\n', language, {
            unit,
            guides: prefs.indentGuides,
            brackets: prefs.bracketPairColorization,
            whitespace: prefs.renderWhitespace,
            tabWidth: prefs.tabSize
          }),
    [
      value, language, unit,
      prefs.indentGuides, prefs.bracketPairColorization, prefs.renderWhitespace, prefs.tabSize
    ]
  )

  const lines = useMemo(() => (value ? value.split('\n').length : 1), [value])

  /* ------------------------------------------------------- Sincronismo */

  // El textarea es el que desplaza; la capa pintada, los números, la franja de
  // la línea activa y el minimapa lo siguen. Todo esto se escribe en el DOM sin
  // pasar por React: en un fichero grande, un `setState` por fotograma de rueda
  // se nota, y un `style.transform` no.
  const sync = useCallback(() => {
    const el = area.current
    if (!el) return
    if (layer.current) {
      layer.current.scrollTop = el.scrollTop
      layer.current.scrollLeft = el.scrollLeft
    }
    if (gutter.current) gutter.current.scrollTop = el.scrollTop
    if (activeLine.current) {
      // El alto de línea se calcula, no se mide: `scrollHeight` cambia con el
      // relleno de abajo y con el ajuste de línea, y la franja se despegaba del
      // cursor justo cuando más se nota, al final del fichero. Los 8 píxeles
      // son el relleno superior que la hoja de estilos da a las dos capas.
      const lh = prefs.fontSize * prefs.lineHeight
      activeLine.current.style.transform = `translateY(${8 + caretLine * lh - el.scrollTop}px)`
    }
  }, [caretLine, prefs.fontSize, prefs.lineHeight])

  const onScroll = useCallback(() => {
    sync()
    const el = area.current
    if (!el) return
    // El minimapa sí necesita estado: su marco de posición es un elemento de
    // React. Se actualiza por fotograma, no por evento de desplazamiento.
    if (prefs.minimap) {
      setScroll({ top: el.scrollTop, view: el.clientHeight, content: el.scrollHeight })
    }
  }, [sync, prefs.minimap])

  // Al cambiar de fichero el textarea vuelve arriba, y con él las otras capas.
  useEffect(() => {
    sync()
    const el = area.current
    if (el && prefs.minimap) {
      setScroll({ top: el.scrollTop, view: el.clientHeight, content: el.scrollHeight })
    }
  }, [value, sync, prefs.minimap])

  useEffect(() => {
    if (areaRef) areaRef.current = area.current
  }, [areaRef])

  /** En qué línea está el cursor: lo usan la franja activa y los números. */
  const trackCaret = useCallback(() => {
    const el = area.current
    if (!el) return
    let n = 0
    const upto = el.value.slice(0, el.selectionStart)
    for (let i = 0; i < upto.length; i++) if (upto.charCodeAt(i) === 10) n++
    setCaretLine(n)
  }, [])

  /* ---------------------------------------------------------- Teclado */

  /** Sustituye un trozo del texto dejando el cursor donde toca. */
  const replace = useCallback(
    (el: HTMLTextAreaElement, from: number, to: number, text: string, caret: number) => {
      onChange(el.value.slice(0, from) + text + el.value.slice(to))
      requestAnimationFrame(() => {
        el.setSelectionRange(caret, caret)
        trackCaret()
      })
    },
    [onChange, trackCaret]
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave?.()
      return
    }
    if (readOnly) return

    const el = e.currentTarget
    const { selectionStart: a, selectionEnd: b } = el
    const pad = prefs.insertSpaces ? ' '.repeat(prefs.tabSize) : '\t'

    /* --------------------------------------------------------- Tabular */
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!e.shiftKey && a === b) {
        replace(el, a, b, pad, a + pad.length)
        return
      }
      // Con selección (o con Mayúsculas) se mueve el bloque entero.
      const from = value.lastIndexOf('\n', a - 1) + 1
      const to = value.indexOf('\n', b) === -1 ? value.length : value.indexOf('\n', b)
      const block = value.slice(from, to)
      const moved = e.shiftKey
        ? block.split('\n').map((l) => l.replace(new RegExp(`^( {1,${prefs.tabSize}}|\t)`), '')).join('\n')
        : block.split('\n').map((l) => pad + l).join('\n')
      onChange(value.slice(0, from) + moved + value.slice(to))
      requestAnimationFrame(() => el.setSelectionRange(from, from + moved.length))
      return
    }

    /* ------------------------------------------------- Sangría al saltar */
    if (e.key === 'Enter' && prefs.autoIndent && a === b) {
      const from = value.lastIndexOf('\n', a - 1) + 1
      const indent = /^[ \t]*/.exec(value.slice(from, a))![0]
      // Detrás de una llave, un corchete o dos puntos se entra un nivel más.
      const before = value.slice(from, a).trimEnd()
      const deeper = /[{[(:]$/.test(before) ? pad : ''
      const insert = '\n' + indent + deeper
      e.preventDefault()
      replace(el, a, b, insert, a + insert.length)
      return
    }

    /* -------------------------------------------------- Cerrar parejas */
    if (prefs.autoClosingBrackets && PAIRS[e.key]) {
      const close = PAIRS[e.key]
      const next = value[b] ?? ''
      // Con algo seleccionado, la pareja envuelve la selección.
      if (a !== b) {
        e.preventDefault()
        const inner = value.slice(a, b)
        onChange(value.slice(0, a) + e.key + inner + close + value.slice(b))
        requestAnimationFrame(() => el.setSelectionRange(a + 1, b + 1))
        return
      }
      // Y suelto, sólo si lo que viene detrás es un hueco: así escribir una
      // comilla en mitad de una palabra no la parte en dos.
      if (!next || /[\s)\]},;]/.test(next)) {
        e.preventDefault()
        replace(el, a, b, e.key + close, a + 1)
        return
      }
    }

    /* ----------------------------- Escribir el cierre que ya está puesto */
    if (prefs.autoClosingBrackets && a === b && Object.values(PAIRS).includes(e.key) && value[a] === e.key) {
      e.preventDefault()
      el.setSelectionRange(a + 1, a + 1)
      trackCaret()
      return
    }

    /* ------------------------------- Borrar una pareja vacía de un golpe */
    if (prefs.autoClosingBrackets && e.key === 'Backspace' && a === b && a > 0) {
      const open = value[a - 1]
      if (PAIRS[open] && value[a] === PAIRS[open]) {
        e.preventDefault()
        replace(el, a - 1, a + 1, '', a - 1)
      }
    }
  }

  /* ------------------------------------------------------------ Pintado */

  const showGutter = prefs.lineNumbers !== 'off'
  const gutterWidth = Math.max(44, 22 + String(lines).length * 8)
  const minimapWidth = 88

  const numbers = useMemo(() => {
    if (!showGutter) return null
    const total = Math.min(lines, 20000)
    const out: React.JSX.Element[] = []
    for (let i = 0; i < total; i++) {
      const on = i === caretLine
      // En modo relativo el número es la distancia al cursor, como en Vim:
      // sirve para saltar `12k` sin contar líneas con el dedo.
      const label = prefs.lineNumbers === 'relative' && !on ? Math.abs(i - caretLine) : i + 1
      out.push(
        <div key={i} className={on ? 'on' : undefined}>
          {label}
        </div>
      )
    }
    return out
  }, [showGutter, lines, caretLine, prefs.lineNumbers])

  return (
    <div className="flex-1 min-h-0 flex">
      {showGutter ? (
        <div
          ref={gutter}
          // La columna de números no desplaza por su cuenta, así que la rueda
          // que caiga encima se le pasa al textarea, que es el que manda.
          onWheel={(e) => {
            const el = area.current
            if (!el) return
            el.scrollTop += e.deltaY
            el.scrollLeft += e.deltaX
            onScroll()
          }}
          className="code-gutter shrink-0 overflow-hidden bg-void border-r border-line"
          style={{ width: gutterWidth }}
        >
          {numbers}
        </div>
      ) : null}

      <div className="code-wrap" data-wrap={prefs.wordWrap} style={{ '--wrap-col': prefs.wrapColumn } as React.CSSProperties}>
        {/* Con ajuste de línea una línea lógica ocupa varias filas, así que la
            franja señalaría la fila equivocada: mejor no pintarla. */}
        {prefs.highlightActiveLine && !readOnly && prefs.wordWrap === 'off' ? (
          <div ref={activeLine} className="code-active-line" aria-hidden />
        ) : null}

        {prefs.rulerColumn > 0 && prefs.wordWrap === 'off' ? (
          <div className="code-ruler" style={{ left: `calc(12px + ${prefs.rulerColumn}ch)` }} aria-hidden />
        ) : null}

        {html == null ? null : (
          <pre
            ref={layer}
            className="code-layer"
            aria-hidden
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        <textarea
          ref={area}
          className={cx('code-input', prefs.scrollBeyondLastLine && 'pb-[40vh]')}
          style={html == null ? { color: 'var(--color-ink)' } : undefined}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          wrap={prefs.wordWrap === 'off' ? 'off' : 'soft'}
          onScroll={onScroll}
          onChange={(e) => {
            onChange(e.target.value)
            trackCaret()
          }}
          onKeyUp={trackCaret}
          onClick={trackCaret}
          onSelect={trackCaret}
          onKeyDown={onKeyDown}
        />
      </div>

      {prefs.minimap && lines <= MAX_MINIMAP_LINES ? (
        <Minimap
          value={value}
          width={minimapWidth}
          scrollTop={scroll.top}
          viewHeight={scroll.view}
          contentHeight={scroll.content}
          onJump={(ratio) => {
            const el = area.current
            if (!el) return
            el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
            onScroll()
          }}
        />
      ) : null}
    </div>
  )
}
