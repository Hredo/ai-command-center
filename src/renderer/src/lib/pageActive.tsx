/**
 * Si la sección que te rodea es la que se está viendo.
 *
 * La aplicación deja montadas todas las secciones que has visitado, para no
 * perder el scroll ni lo que tuvieras a medio escribir al cambiar de pestaña.
 * El precio de eso es que una sección oculta sigue siendo código vivo: sus
 * efectos corren, sus suscripciones se disparan y sus componentes se vuelven a
 * pintar aunque no haya nadie mirando.
 *
 * Esto lo cierra por arriba: el armazón dice quién está a la vista y cada
 * sección decide qué deja de hacer mientras no lo está. No es teórico —el
 * panel estaba recalculando sus dos gráficas cada vez que terminaba una
 * ejecución, con la pestaña de terminales delante.
 */
import React, { createContext, useContext, useEffect, useState } from 'react'

const Ctx = createContext(true)

export function PageActiveProvider({
  active,
  children
}: {
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return <Ctx.Provider value={active}>{children}</Ctx.Provider>
}

/** true si la sección que llama está a la vista ahora mismo. */
export function useIsPageActive(): boolean {
  return useContext(Ctx)
}

/**
 * Si la ventana está a la vista del sistema: ni minimizada ni en otro
 * escritorio. Se mira una sola vez, arriba del todo, y baja con el contexto;
 * que cada componente se suscriba por su cuenta a `visibilitychange` sólo
 * multiplicaría oyentes para responder todos lo mismo.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const onChange = (): void => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}
