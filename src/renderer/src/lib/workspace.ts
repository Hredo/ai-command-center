/**
 * La mesa de trabajo, en la ventana: qué paneles hay, cuál manda y cómo tienes
 * el menú. El árbol y sus operaciones están en shared/workspace.ts; aquí vive
 * el estado, lo que se guarda y lo que recuerda la sesión (lo último usado).
 *
 * Va fuera de React porque lo tocan el menú lateral, la barra de título, los
 * atajos, la paleta y cualquier `navigate()`, y porque arrastrar un tirador
 * cambia la proporción muchas veces por segundo.
 */
import { useSyncExternalStore } from 'react'
import {
  applyPreset, cleanLayouts, cleanWorkspace, closeLeaf, cycleFocus, dropPage, focusLeaf, focused, leafOf, leaves,
  openPage, setRatio, singleWorkspace, splitLeaf, MAX_PANES,
  type DropZone, type PresetId, type SavedLayout, type Workspace, type WorkspaceDir, type WorkspaceNode
} from '@shared/workspace'
import { SECTIONS } from './sections'
import type { PageId } from './nav'
import type { Settings } from '@shared/types'

const ALL: PageId[] = SECTIONS.map((s) => s.id)
/** Con qué se completa una distribución cuando no hay nada más reciente. */
const USEFUL: PageId[] = ['chat', 'terminal', 'projects', 'tasks', 'dashboard', 'history', 'models', 'agents', 'arena']

interface State {
  ws: Workspace
  layouts: SavedLayout[]
  /** El orden del menú lateral y lo que has escondido de él. */
  navOrder: PageId[]
  navHidden: PageId[]
  /** Lo último que has tenido delante, lo más reciente primero. */
  recent: PageId[]
  /** La sección que se está arrastrando ahora, si hay alguna. */
  drag: PageId | null
}

let state: State = {
  ws: singleWorkspace('dashboard'),
  layouts: [],
  navOrder: ALL,
  navHidden: [],
  recent: ['dashboard'],
  drag: null
}
const listeners = new Set<() => void>()
let adopted = false
let saveTimer: number | null = null

function emit(): void {
  for (const l of [...listeners]) l()
}

function persist(): void {
  if (!adopted) return
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    const patch: Partial<Settings> = {
      workspace: state.ws,
      layouts: state.layouts,
      nav: { order: state.navOrder, hidden: state.navHidden }
    }
    void window.api.config.settings(patch)
  }, 400)
}

function set(patch: Partial<State>, save = true): void {
  const prev = state
  state = { ...state, ...patch }
  if (patch.ws && patch.ws !== prev.ws) {
    const page = focused(state.ws).page as PageId
    if (state.recent[0] !== page) state.recent = [page, ...state.recent.filter((p) => p !== page)].slice(0, 12)
  }
  emit()
  if (save && (patch.ws || patch.layouts || patch.navOrder || patch.navHidden)) persist()
}

export function useWorkspace(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => state
  )
}

export const peekWorkspace = (): State => state

/** Lo guardado llega con la configuración: se adopta una vez. */
export function adoptWorkspace(s: Settings | undefined): void {
  if (adopted || !s) return
  adopted = true
  const order = (s.nav?.order ?? []).filter((p): p is PageId => ALL.includes(p as PageId))
  const navOrder = [...order, ...ALL.filter((p) => !order.includes(p))]
  const navHidden = (s.nav?.hidden ?? []).filter((p): p is PageId => ALL.includes(p as PageId) && p !== 'settings')
  // Si ya has ido a algún sitio antes de que llegue la configuración, manda eso.
  const moved = leaves(state.ws.root).length > 1 || focused(state.ws).page !== 'dashboard'
  const ws = moved ? state.ws : cleanWorkspace(s.workspace, ALL, 'dashboard')
  state = {
    ...state,
    ws,
    layouts: cleanLayouts(s.layouts, ALL),
    navOrder,
    navHidden,
    recent: [focused(ws).page as PageId, ...leaves(ws.root).map((l) => l.page as PageId)].filter((p, i, a) => a.indexOf(p) === i)
  }
  emit()
}

/** La sección que entra al partir un panel: lo último que usaste y no está a la vista. */
export function nextPage(): PageId | null {
  const shown = new Set(leaves(state.ws.root).map((l) => l.page))
  const hidden = new Set(state.navHidden)
  return (
    [...state.recent, ...USEFUL, ...ALL].find((p) => !shown.has(p) && !hidden.has(p)) ??
    ALL.find((p) => !shown.has(p)) ??
    null
  )
}

export function openSection(page: PageId, beside?: WorkspaceDir): void {
  set({ ws: openPage(state.ws, page, beside) })
}

export function splitPane(dir: WorkspaceDir, leafId?: string, page?: PageId): boolean {
  const p = page ?? nextPage()
  if (!p || leaves(state.ws.root).length >= MAX_PANES) return false
  const there = leafOf(state.ws, p)
  if (there) {
    set({ ws: focusLeaf(state.ws, there.id) })
    return true
  }
  set({ ws: splitLeaf(state.ws, leafId ?? state.ws.focus, dir, p) })
  return true
}

export function closePane(leafId?: string): void {
  set({ ws: closeLeaf(state.ws, leafId ?? state.ws.focus) })
}

export function focusPane(leafId: string): void {
  const ws = focusLeaf(state.ws, leafId)
  if (ws !== state.ws) set({ ws })
}

export function cyclePane(step = 1): void {
  set({ ws: cycleFocus(state.ws, step) })
}

/** Mientras se arrastra el tirador no se guarda; al soltar, sí. */
export function resizeSplit(splitId: string, ratio: number, commit: boolean): void {
  const ws = setRatio(state.ws, splitId, ratio)
  if (ws !== state.ws) set({ ws }, commit)
  else if (commit) persist()
}

export function dropSection(page: PageId, leafId: string, zone: DropZone): void {
  set({ ws: dropPage(state.ws, page, leafId, zone), drag: null })
}

export function setDrag(page: PageId | null): void {
  if (state.drag !== page) set({ drag: page }, false)
}

export function applyPresetLayout(preset: PresetId): void {
  set({ ws: applyPreset(state.ws, preset, [...state.recent, ...USEFUL].filter((p) => !state.navHidden.includes(p))) })
}

/** Guarda la mesa de ahora con un nombre. */
export function saveLayout(name: string): SavedLayout | null {
  const clean = name.trim().slice(0, 40)
  if (!clean) return null
  const saved: SavedLayout = { id: `l${Date.now().toString(36)}`, name: clean, root: state.ws.root }
  set({ layouts: [...state.layouts.filter((l) => l.name !== clean), saved].slice(-12) })
  return saved
}

export function applyLayout(id: string): void {
  const l = state.layouts.find((x) => x.id === id)
  if (!l) return
  // Con ids nuevos: la guardada no se toca aunque luego muevas los tiradores.
  const copy = cleanWorkspace({ root: JSON.parse(JSON.stringify(l.root)) }, ALL, 'dashboard')
  const fresh = (n: WorkspaceNode): WorkspaceNode =>
    n.kind === 'leaf' ? { ...n, id: `p${Math.random().toString(36).slice(2, 9)}` } : { ...n, id: `s${Math.random().toString(36).slice(2, 9)}`, a: fresh(n.a), b: fresh(n.b) }
  const root = fresh(copy.root)
  set({ ws: { root, focus: leaves(root)[0].id } })
}

export function removeLayout(id: string): void {
  set({ layouts: state.layouts.filter((l) => l.id !== id) })
}

/** El menú lateral: el orden de las secciones y las escondidas (Ajustes no se esconde). */
export function setNav(order: PageId[], hidden: PageId[]): void {
  const o = order.filter((p) => ALL.includes(p))
  set({
    navOrder: [...o, ...ALL.filter((p) => !o.includes(p))],
    navHidden: hidden.filter((p) => ALL.includes(p) && p !== 'settings')
  })
}

export function resetNav(): void {
  set({ navOrder: ALL, navHidden: [] })
}

/** Las secciones del menú, en tu orden y sin las escondidas. */
export function visibleSections(s: State): typeof SECTIONS {
  return s.navOrder
    .filter((id) => !s.navHidden.includes(id))
    .map((id) => SECTIONS.find((x) => x.id === id)!)
    .filter(Boolean)
}

/** El atajo de una sección: Ctrl+1..9 según su puesto en tu menú, y Ctrl+, Ajustes. */
export function shortcutOf(id: PageId): string | undefined {
  if (id === 'settings') return 'Ctrl+,'
  const i = visibleSections(state).findIndex((x) => x.id === id)
  return i >= 0 && i < 9 ? `Ctrl+${i + 1}` : undefined
}

/**
 * Como el motor: accesible en window.__accWorkspace para conducir la mesa
 * desde las pruebas y desde las herramientas de desarrollo.
 */
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__accWorkspace = {
    peek: peekWorkspace, openSection, splitPane, closePane, focusPane, cyclePane, resizeSplit, dropSection, setDrag,
    applyPresetLayout, saveLayout, applyLayout, removeLayout, setNav, resetNav, nextPage
  }
}
