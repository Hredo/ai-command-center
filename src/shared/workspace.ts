/**
 * La mesa de trabajo: qué secciones están a la vista y cómo se reparten el
 * espacio.
 *
 * Es un árbol. Una hoja es un panel con una sección; un nudo parte su hueco en
 * dos, en fila o en columna, con una proporción. Así salen dos columnas, una
 * columna partida en dos filas o una rejilla de cuatro, y cualquier panel se
 * puede volver a partir.
 *
 * Cada sección vive una sola vez (su conversación abierta, su terminal activa,
 * lo que tenías a medio escribir): por eso una sección sólo puede estar en un
 * panel. Pedir una que ya está a la vista lleva a su panel en vez de duplicarla.
 *
 * Todo aquí son funciones puras: reciben una mesa y devuelven otra.
 */

export type WorkspaceDir = 'row' | 'col'

export interface WorkspaceLeaf {
  kind: 'leaf'
  id: string
  page: string
}

export interface WorkspaceSplit {
  kind: 'split'
  id: string
  dir: WorkspaceDir
  /** Parte del hueco que se queda el primero, de 0 a 1. */
  ratio: number
  a: WorkspaceNode
  b: WorkspaceNode
}

export type WorkspaceNode = WorkspaceLeaf | WorkspaceSplit

export interface Workspace {
  root: WorkspaceNode
  /** El panel en el que se abre lo que elijas en el menú. */
  focus: string
}

/** Una distribución guardada con nombre. */
export interface SavedLayout {
  id: string
  name: string
  root: WorkspaceNode
}

export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

/** Más de cuatro paneles ya no caben en una pantalla normal. */
export const MAX_PANES = 4
const MIN_RATIO = 0.15
const MAX_RATIO = 0.85

let seq = 0
const uid = (p: string): string => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

export const leaf = (page: string, id = uid('p')): WorkspaceLeaf => ({ kind: 'leaf', id, page })
const split = (dir: WorkspaceDir, a: WorkspaceNode, b: WorkspaceNode, ratio = 0.5, id = uid('s')): WorkspaceSplit => ({
  kind: 'split',
  id,
  dir,
  ratio,
  a,
  b
})

export function singleWorkspace(page: string): Workspace {
  const l = leaf(page)
  return { root: l, focus: l.id }
}

export function leaves(node: WorkspaceNode): WorkspaceLeaf[] {
  return node.kind === 'leaf' ? [node] : [...leaves(node.a), ...leaves(node.b)]
}

export function leafOf(ws: Workspace, page: string): WorkspaceLeaf | undefined {
  return leaves(ws.root).find((l) => l.page === page)
}

export function focused(ws: Workspace): WorkspaceLeaf {
  const all = leaves(ws.root)
  return all.find((l) => l.id === ws.focus) ?? all[0]
}

function replace(node: WorkspaceNode, id: string, fn: (n: WorkspaceNode) => WorkspaceNode | null): WorkspaceNode | null {
  if (node.id === id) return fn(node)
  if (node.kind === 'leaf') return node
  const a = replace(node.a, id, fn)
  const b = replace(node.b, id, fn)
  // Un hijo que desaparece deja todo el hueco al otro.
  if (!a) return b
  if (!b) return a
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

const clampRatio = (r: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))

/** Parte un panel en dos y pone la sección nueva a la derecha o debajo. */
export function splitLeaf(ws: Workspace, leafId: string, dir: WorkspaceDir, page: string, before = false): Workspace {
  const all = leaves(ws.root)
  if (all.length >= MAX_PANES || all.some((l) => l.page === page) || !all.some((l) => l.id === leafId)) return ws
  const fresh = leaf(page)
  const root = replace(ws.root, leafId, (n) => (before ? split(dir, fresh, n) : split(dir, n, fresh)))
  return root ? { root, focus: fresh.id } : ws
}

/**
 * Abrir una sección: si ya está a la vista se va a su panel; si no, ocupa el
 * panel activo, o uno nuevo a su lado si se pide `beside`.
 */
export function openPage(ws: Workspace, page: string, beside?: WorkspaceDir): Workspace {
  const there = leafOf(ws, page)
  if (there) return there.id === ws.focus ? ws : { ...ws, focus: there.id }
  const target = focused(ws)
  if (beside && leaves(ws.root).length < MAX_PANES) return splitLeaf(ws, target.id, beside, page)
  const root = replace(ws.root, target.id, (n) => ({ ...(n as WorkspaceLeaf), page }))
  return root ? { root, focus: target.id } : ws
}

/** Cierra un panel; el de al lado se queda con su hueco. El último no se cierra. */
export function closeLeaf(ws: Workspace, leafId: string): Workspace {
  const all = leaves(ws.root)
  if (all.length <= 1 || !all.some((l) => l.id === leafId)) return ws
  const at = all.findIndex((l) => l.id === leafId)
  const root = replace(ws.root, leafId, () => null)
  if (!root) return ws
  const rest = leaves(root)
  const focus = ws.focus !== leafId && rest.some((l) => l.id === ws.focus) ? ws.focus : rest[Math.min(at, rest.length - 1)].id
  return { root, focus }
}

export function focusLeaf(ws: Workspace, leafId: string): Workspace {
  return ws.focus === leafId || !leaves(ws.root).some((l) => l.id === leafId) ? ws : { ...ws, focus: leafId }
}

/** El panel siguiente (o el anterior), dando la vuelta. */
export function cycleFocus(ws: Workspace, step = 1): Workspace {
  const all = leaves(ws.root)
  const at = Math.max(0, all.findIndex((l) => l.id === ws.focus))
  return { ...ws, focus: all[(at + step + all.length) % all.length].id }
}

export function setRatio(ws: Workspace, splitId: string, ratio: number): Workspace {
  const root = replace(ws.root, splitId, (n) => (n.kind === 'split' ? { ...n, ratio: clampRatio(ratio) } : n))
  return root && root !== ws.root ? { ...ws, root } : ws
}

/**
 * Soltar una sección sobre un panel. En el centro ocupa su sitio (y si venía de
 * otro panel, se intercambian); en un borde, lo parte por ese lado.
 */
export function dropPage(ws: Workspace, page: string, targetId: string, zone: DropZone): Workspace {
  const all = leaves(ws.root)
  const target = all.find((l) => l.id === targetId)
  if (!target) return ws
  const source = all.find((l) => l.page === page)
  if (source?.id === targetId) return focusLeaf(ws, targetId)

  if (zone === 'center') {
    let root: WorkspaceNode | null = ws.root
    if (source) root = replace(root, source.id, (n) => ({ ...(n as WorkspaceLeaf), page: target.page }))
    root = root && replace(root, targetId, (n) => ({ ...(n as WorkspaceLeaf), page }))
    return root ? { root, focus: targetId } : ws
  }

  // A un borde: la sección sale de donde estuviera y entra partiendo el destino.
  let base = ws
  if (source) {
    if (all.length <= 1) return ws
    base = closeLeaf(ws, source.id)
  } else if (all.length >= MAX_PANES) {
    return ws
  }
  const dir: WorkspaceDir = zone === 'left' || zone === 'right' ? 'row' : 'col'
  return splitLeaf(base, targetId, dir, page, zone === 'left' || zone === 'top')
}

/* ------------------------------------------------------------------ *
 * Dónde cae cada cosa                                                *
 * ------------------------------------------------------------------ */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  id: string
  dir: WorkspaceDir
  /** El hueco entero del nudo, para saber cuánto vale un píxel de arrastre. */
  area: Rect
  /** Dónde está la línea, en la misma escala de 0 a 1. */
  at: number
  ratio: number
}

/** El hueco de cada panel y cada línea de separación, en fracciones de 0 a 1. */
export function layout(node: WorkspaceNode, area: Rect = { x: 0, y: 0, w: 1, h: 1 }): { panes: Record<string, Rect>; dividers: Divider[] } {
  if (node.kind === 'leaf') return { panes: { [node.id]: area }, dividers: [] }
  const r = clampRatio(node.ratio)
  const first: Rect = node.dir === 'row' ? { ...area, w: area.w * r } : { ...area, h: area.h * r }
  const second: Rect =
    node.dir === 'row'
      ? { x: area.x + area.w * r, y: area.y, w: area.w * (1 - r), h: area.h }
      : { x: area.x, y: area.y + area.h * r, w: area.w, h: area.h * (1 - r) }
  const a = layout(node.a, first)
  const b = layout(node.b, second)
  return {
    panes: { ...a.panes, ...b.panes },
    dividers: [
      { id: node.id, dir: node.dir, area, at: node.dir === 'row' ? second.x : second.y, ratio: r },
      ...a.dividers,
      ...b.dividers
    ]
  }
}

/** En qué zona de un panel cae un punto (de 0 a 1 dentro del panel). */
export function zoneAt(fx: number, fy: number): DropZone {
  const edge = 0.26
  const dl = fx
  const dr = 1 - fx
  const dt = fy
  const db = 1 - fy
  const min = Math.min(dl, dr, dt, db)
  if (min > edge) return 'center'
  if (min === dl) return 'left'
  if (min === dr) return 'right'
  return min === dt ? 'top' : 'bottom'
}

/* ------------------------------------------------------------------ *
 * Distribuciones de partida                                          *
 * ------------------------------------------------------------------ */

export type PresetId = 'single' | 'columns' | 'rows' | 'side' | 'grid'

export const PRESETS: { id: PresetId; panes: number }[] = [
  { id: 'single', panes: 1 },
  { id: 'columns', panes: 2 },
  { id: 'rows', panes: 2 },
  { id: 'side', panes: 3 },
  { id: 'grid', panes: 4 }
]

/**
 * Pone una distribución de partida. Conserva lo que ya estaba a la vista, en
 * su orden, y completa con `fill` (lo último que usaste, o las secciones de
 * siempre).
 */
export function applyPreset(ws: Workspace, preset: PresetId, fill: string[]): Workspace {
  const want = PRESETS.find((p) => p.id === preset)?.panes ?? 1
  const current = leaves(ws.root)
  const first = focused(ws).page
  const pages = [first, ...current.map((l) => l.page).filter((p) => p !== first)]
  for (const p of fill) {
    if (pages.length >= want) break
    if (!pages.includes(p)) pages.push(p)
  }
  const ls = pages.slice(0, want).map((p) => leaf(p))
  if (ls.length < want) return ws
  let root: WorkspaceNode
  switch (preset) {
    case 'columns':
      root = split('row', ls[0], ls[1])
      break
    case 'rows':
      root = split('col', ls[0], ls[1])
      break
    case 'side':
      // Lo principal a la izquierda y dos de apoyo, uno encima del otro.
      root = split('row', ls[0], split('col', ls[1], ls[2]), 0.6)
      break
    case 'grid':
      root = split('row', split('col', ls[0], ls[2]), split('col', ls[1], ls[3]))
      break
    default:
      root = ls[0]
  }
  return { root, focus: ls[0].id }
}

/** La forma de una mesa, para reconocer a cuál de las de partida se parece. */
export function shapeOf(node: WorkspaceNode): string {
  return node.kind === 'leaf' ? 'p' : `${node.dir}(${shapeOf(node.a)},${shapeOf(node.b)})`
}

const SHAPES: Record<string, PresetId> = {
  p: 'single',
  'row(p,p)': 'columns',
  'col(p,p)': 'rows',
  'row(p,col(p,p))': 'side',
  'row(col(p,p),col(p,p))': 'grid'
}

export function presetOf(ws: Workspace): PresetId | null {
  return SHAPES[shapeOf(ws.root)] ?? null
}

/* ------------------------------------------------------------------ *
 * Lo que viene del disco                                             *
 * ------------------------------------------------------------------ */

function cleanNode(raw: any, valid: Set<string>, seen: Set<string>, depth = 0): WorkspaceNode | null {
  if (!raw || typeof raw !== 'object' || depth > 4) return null
  if (raw.kind === 'leaf') {
    const page = String(raw.page ?? '')
    if (!valid.has(page) || seen.has(page) || seen.size >= MAX_PANES) return null
    seen.add(page)
    return leaf(page, typeof raw.id === 'string' && raw.id ? raw.id : undefined)
  }
  if (raw.kind !== 'split') return null
  const a = cleanNode(raw.a, valid, seen, depth + 1)
  const b = cleanNode(raw.b, valid, seen, depth + 1)
  if (!a) return b
  if (!b) return a
  const ratio = typeof raw.ratio === 'number' && Number.isFinite(raw.ratio) ? clampRatio(raw.ratio) : 0.5
  return split(raw.dir === 'col' ? 'col' : 'row', a, b, ratio, typeof raw.id === 'string' && raw.id ? raw.id : undefined)
}

/** Una mesa guardada, saneada: sin secciones que ya no existen ni repetidas. */
export function cleanWorkspace(raw: unknown, validPages: string[], fallbackPage: string): Workspace {
  const r = raw as { root?: unknown; focus?: unknown } | null
  const root = cleanNode(r?.root, new Set(validPages), new Set())
  if (!root) return singleWorkspace(fallbackPage)
  const all = leaves(root)
  const focus = typeof r?.focus === 'string' && all.some((l) => l.id === r.focus) ? r.focus : all[0].id
  return { root, focus }
}

export function cleanLayouts(raw: unknown, validPages: string[]): SavedLayout[] {
  if (!Array.isArray(raw)) return []
  const out: SavedLayout[] = []
  for (const item of raw.slice(0, 12)) {
    const name = String(item?.name ?? '').trim().slice(0, 40)
    const root = cleanNode(item?.root, new Set(validPages), new Set())
    if (name && root) out.push({ id: typeof item.id === 'string' && item.id ? item.id : uid('l'), name, root })
  }
  return out
}
