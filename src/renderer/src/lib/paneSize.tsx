/**
 * El ancho del panel en el que vive una sección.
 *
 * Con la mesa partida, una sección ya no tiene la ventana entera: puede tocarle
 * un tercio. Cada una decide qué deja de enseñar cuando va justa (su lista
 * lateral, su panel de detalle) mirando este ancho, no el de la ventana.
 * Para lo que es sólo maquetación basta el CSS: el envoltorio de cada sección
 * es un contenedor (`@container`), así que valen las variantes `@md:`, `@3xl:`…
 */
import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'

const Ctx = createContext(1600)

/** Por debajo de esto una sección esconde su panel de detalle. */
export const NARROW = 900
/** Y por debajo de esto, también su lista lateral. */
export const TIGHT = 640

export function PaneSizeProvider({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1600)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Se redondea a tramos: arrastrar el tirador no vuelve a pintar la sección a cada píxel.
    const read = (w: number): void => setWidth((prev) => (Math.abs(prev - w) >= 24 || (w < NARROW) !== (prev < NARROW) || (w < TIGHT) !== (prev < TIGHT) ? w : prev))
    read(el.clientWidth || 1600)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) read(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className={className} data-w={width < TIGHT ? 'tight' : width < NARROW ? 'narrow' : 'wide'} {...rest}>
      <Ctx.Provider value={width}>{children}</Ctx.Provider>
    </div>
  )
}

/** El ancho del panel de esta sección, en píxeles. */
export function usePaneWidth(): number {
  return useContext(Ctx)
}

/** Va justa: toca esconder lo secundario. */
export function useNarrow(): { narrow: boolean; tight: boolean; width: number } {
  const width = useContext(Ctx)
  return { narrow: width < NARROW, tight: width < TIGHT, width }
}
