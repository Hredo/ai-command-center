/**
 * Navegación desde cualquier sitio.
 *
 * Las secciones las cambia el armazón (App.tsx), pero hay cosas fuera de él
 * que tienen que poder llevarte a otra: el relevo abre la conversación nueva en
 * la Consola, la paleta de comandos salta a cualquier sección y un aviso de
 * cupo lleva al Panel. En vez de pasar callbacks por medio árbol, se avisa por
 * aquí y el armazón escucha.
 */
export type PageId =
  | 'dashboard' | 'chat' | 'arena' | 'terminal' | 'tasks' | 'projects' | 'agents' | 'models' | 'house'
  | 'history' | 'settings'

export interface NavTarget {
  page: PageId
  /** Conversación de la Consola que hay que abrir. */
  sessionId?: string
  /** Proyecto que hay que seleccionar. */
  projectId?: string
  /** Pestaña interna de la sección, si tiene. */
  tab?: string
}

type Listener = (t: NavTarget) => void
const listeners = new Set<Listener>()
let last: NavTarget | null = null

export function navigate(target: PageId | NavTarget): void {
  const t = typeof target === 'string' ? { page: target } : target
  last = t
  for (const l of [...listeners]) l(t)
}

/**
 * La última navegación pedida. Una sección que se monta por primera vez justo
 * después (y por tanto no estaba escuchando) la lee al nacer.
 */
export function lastNavTarget(): NavTarget | null {
  return last
}

export function onNavigate(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
