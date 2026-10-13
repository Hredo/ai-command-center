/**
 * La distribución del Panel: qué recuadros hay, en qué orden, de qué tamaño y
 * cuáles has escondido.
 *
 * La rejilla tiene 30 columnas: así caben a la vez cinco recuadros iguales (6),
 * tres (10), dos (15) y las proporciones 2/3 + 1/3 (20 + 10). El alto es libre,
 * en píxeles; sin alto, el recuadro mide lo que pide su contenido.
 *
 * Lo guardado se normaliza siempre contra la lista de recuadros que existen:
 * uno que ya no existe se descarta y uno nuevo (de una versión posterior)
 * aparece al final con su tamaño por omisión, sin tocar lo que ya ordenaste.
 */
import type { DashboardLayout, DashboardTile } from '@shared/types'

export const COLS = 30
export const MIN_W = 4
export const MIN_H = 90
export const SNAP_H = 10

export const DEFAULT_TILES: DashboardTile[] = [
  { id: 'runs', w: 6 },
  { id: 'spend', w: 6 },
  { id: 'tokens', w: 6 },
  { id: 'ttft', w: 6 },
  { id: 'speed', w: 6 },
  { id: 'quotas', w: 30 },
  { id: 'usage', w: 20 },
  { id: 'claude', w: 10 },
  { id: 'costChart', w: 20, h: 270 },
  { id: 'tokensChart', w: 10, h: 270 },
  { id: 'models', w: 20 },
  { id: 'recent', w: 10, h: 320 },
  { id: 'split', w: 30 },
  { id: 'providers', w: 20 },
  { id: 'local', w: 10 }
]

const clampW = (w: unknown): number => Math.min(COLS, Math.max(MIN_W, Math.round(Number(w) || COLS)))
const clampH = (h: unknown): number | undefined => {
  const n = Number(h)
  return Number.isFinite(n) && n > 0 ? Math.max(MIN_H, Math.round(n / SNAP_H) * SNAP_H) : undefined
}

export function normalizeLayout(saved?: DashboardLayout | null): DashboardLayout {
  const known = new Map(DEFAULT_TILES.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const tiles: DashboardTile[] = []
  for (const t of saved?.tiles ?? []) {
    if (!t || !known.has(t.id) || seen.has(t.id)) continue
    seen.add(t.id)
    const h = clampH(t.h)
    tiles.push(h ? { id: t.id, w: clampW(t.w), h } : { id: t.id, w: clampW(t.w) })
  }
  for (const t of DEFAULT_TILES) if (!seen.has(t.id)) tiles.push({ ...t })
  const hidden = [...new Set((saved?.hidden ?? []).filter((id) => known.has(id)))]
  return { tiles, hidden }
}

/** Pone `id` justo antes (o después) de `target`. */
export function moveTile(layout: DashboardLayout, id: string, target: string, after: boolean): DashboardLayout {
  if (id === target) return layout
  const tile = layout.tiles.find((t) => t.id === id)
  if (!tile) return layout
  const rest = layout.tiles.filter((t) => t.id !== id)
  const i = rest.findIndex((t) => t.id === target)
  if (i < 0) return layout
  rest.splice(after ? i + 1 : i, 0, tile)
  return { ...layout, tiles: rest }
}

export function resizeTile(layout: DashboardLayout, id: string, w: number, h: number | undefined): DashboardLayout {
  return {
    ...layout,
    tiles: layout.tiles.map((t) => {
      if (t.id !== id) return t
      const nh = clampH(h)
      return nh ? { id, w: clampW(w), h: nh } : { id, w: clampW(w) }
    })
  }
}

export function resetTileSize(layout: DashboardLayout, id: string): DashboardLayout {
  const d = DEFAULT_TILES.find((t) => t.id === id)
  return d ? { ...layout, tiles: layout.tiles.map((t) => (t.id === id ? { ...d } : t)) } : layout
}

export function setHidden(layout: DashboardLayout, id: string, hidden: boolean): DashboardLayout {
  const set = new Set(layout.hidden)
  if (hidden) set.add(id)
  else set.delete(id)
  return { ...layout, hidden: [...set] }
}

/**
 * El ancho que se pinta: con el Panel estrecho (la mesa partida, una ventana
 * pequeña) los recuadros pequeños pasan a media fila y los medianos a fila
 * entera, para que nada quede en una tira ilegible. Lo guardado no cambia.
 */
export function effectiveWidth(w: number, containerPx: number): number {
  if (containerPx >= 1100) return w
  if (containerPx < 720) return COLS
  return w < COLS / 2 ? COLS / 2 : COLS
}
