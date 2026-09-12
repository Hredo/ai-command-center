/**
 * Paneles que se pueden agrandar y encoger con el ratón.
 *
 * La regla de la casa: mientras arrastras no se vuelve a pintar React ni una
 * vez. El ancho se escribe directamente en el estilo del elemento y el valor
 * definitivo se guarda al soltar. Con un árbol de ficheros grande al lado, la
 * diferencia entre eso y llamar a `setState` en cada `mousemove` es la
 * diferencia entre un arrastre limpio y uno a tirones.
 *
 * Cada panel se identifica por una clave (`files.tree`, `chat.detail`…) que es
 * la que se guarda en la configuración, así que el tamaño sigue ahí la próxima
 * vez que abras la aplicación.
 */
import React, { useCallback, useEffect, useRef } from 'react'
import { usePaneSize } from '../lib/prefs'
import { cx } from './ui'

import { useT } from '../lib/i18n'
type Side = 'left' | 'right' | 'top' | 'bottom'

/** Cuánto se mueve con las flechas del teclado. */
const STEP = 16
const STEP_BIG = 64

/* ------------------------------------------------------------------ *
 * Tirador                                                            *
 * ------------------------------------------------------------------ */

function Handle({
  side,
  onDrag,
  onCommit,
  onReset,
  label
}: {
  side: Side
  /** Devuelve el tamaño que corresponde a esta posición del puntero. */
  onDrag: (e: PointerEvent) => void
  onCommit: () => void
  onReset: () => void
  label: string
}): React.JSX.Element {
  const vertical = side === 'left' || side === 'right'
  const dragging = useRef(false)

  const down = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      dragging.current = true
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      // Mientras se arrastra no queremos que el cursor cambie al pasar por
      // encima de un botón ni que se seleccione texto por debajo.
      document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [vertical]
  )

  const move = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      onDrag(e.nativeEvent)
    },
    [onDrag]
  )

  const up = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* el puntero ya se había soltado solo */
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onCommit()
    },
    [onCommit]
  )

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? STEP_BIG : STEP
        const dec = vertical ? 'ArrowLeft' : 'ArrowUp'
        const inc = vertical ? 'ArrowRight' : 'ArrowDown'
        if (e.key === dec || e.key === inc) {
          e.preventDefault()
          onDrag({ __delta: e.key === inc ? step : -step } as unknown as PointerEvent)
          onCommit()
        } else if (e.key === 'Home') {
          e.preventDefault()
          onReset()
        }
      }}
      className={cx(
        'absolute z-20 group',
        // La zona sensible es más ancha que la línea que se ve: acertar con el
        // ratón en dos píxeles es incómodo.
        vertical ? 'top-0 bottom-0 w-[7px] cursor-col-resize' : 'left-0 right-0 h-[7px] cursor-row-resize',
        side === 'right' && '-right-[3px]',
        side === 'left' && '-left-[3px]',
        side === 'bottom' && '-bottom-[3px]',
        side === 'top' && '-top-[3px]'
      )}
    >
      <span
        className={cx(
          'absolute bg-accent opacity-0 group-hover:opacity-70 group-focus-visible:opacity-100 transition-opacity',
          vertical ? 'top-0 bottom-0 left-[3px] w-[1.5px]' : 'left-0 right-0 top-[3px] h-[1.5px]'
        )}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Panel                                                              *
 * ------------------------------------------------------------------ */

export function Pane({
  paneKey,
  side,
  className,
  style,
  children,
  ...rest
}: {
  /** Clave con la que se guarda el tamaño. Ver DEFAULT_PANES. */
  paneKey: string
  /** Borde por el que se arrastra: el que da al contenido de al lado. */
  side: Side
  children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const t = useT()
  const { size, min, max, set, reset } = usePaneSize(paneKey)
  const ref = useRef<HTMLDivElement>(null)
  const live = useRef(size)
  const vertical = side === 'left' || side === 'right'

  // Si el tamaño cambia por fuera (ajustes, otro dispositivo, reinicio) el
  // elemento se pone al día; durante un arrastre esto no corre.
  useEffect(() => {
    live.current = size
    const el = ref.current
    if (el) el.style[vertical ? 'width' : 'height'] = `${size}px`
  }, [size, vertical])

  const onDrag = useCallback(
    (e: PointerEvent & { __delta?: number }) => {
      const el = ref.current
      if (!el) return
      let next: number
      if (typeof e.__delta === 'number') {
        next = live.current + e.__delta
      } else {
        const box = el.getBoundingClientRect()
        // El tamaño se mide desde el borde fijo hasta el puntero, no por
        // incrementos: así no se acumula error si el puntero se sale.
        next =
          side === 'right' ? e.clientX - box.left
            : side === 'left' ? box.right - e.clientX
            : side === 'bottom' ? e.clientY - box.top
            : box.bottom - e.clientY
      }
      next = Math.round(Math.min(max, Math.max(min, next)))
      live.current = next
      el.style[vertical ? 'width' : 'height'] = `${next}px`
    },
    [side, min, max, vertical]
  )

  const commit = useCallback(() => set(live.current), [set])

  return (
    <div
      {...rest}
      ref={ref}
      style={{ [vertical ? 'width' : 'height']: size, ...style }}
      className={cx('relative shrink-0', className)}
    >
      {children}
      <Handle side={side} onDrag={onDrag} onCommit={commit} onReset={reset} label={t('pane.resize')} />
    </div>
  )
}

/**
 * Columnas que reparten el espacio sobrante, como las de la Arena. Ahí no hay
 * un ancho fijo que arrastrar: lo que se ajusta es el ancho *mínimo* de todas,
 * que es lo que decide cuántas caben antes de que aparezca la barra. El tirador
 * va entre columna y columna y mueve ese mínimo compartido.
 */
export function SharedWidthHandle({ paneKey }: { paneKey: string }): React.JSX.Element {
  const t = useT()
  const { size, min, max, set, reset } = usePaneSize(paneKey)
  const live = useRef(size)
  const anchor = useRef<number | null>(null)

  useEffect(() => {
    live.current = size
  }, [size])

  const onDrag = useCallback(
    (e: PointerEvent & { __delta?: number }) => {
      if (typeof e.__delta === 'number') {
        live.current = Math.min(max, Math.max(min, live.current + e.__delta))
      } else {
        if (anchor.current == null) anchor.current = e.clientX
        live.current = Math.round(Math.min(max, Math.max(min, size + (e.clientX - anchor.current))))
      }
      set(live.current)
    },
    [max, min, set, size]
  )

  return (
    <Handle
      side="right"
      onDrag={onDrag}
      onCommit={() => {
        anchor.current = null
        set(live.current)
      }}
      onReset={() => {
        anchor.current = null
        reset()
      }}
      label={t('pane.resize')}
    />
  )
}
