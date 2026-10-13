/**
 * La rejilla del Panel: cada recuadro donde y del tamaño que quieras.
 *
 * Con «Organizar» encendido cada recuadro enseña un asa para arrastrarlo (se
 * suelta encima de otro y se coloca antes o después según el lado; es con
 * eventos de puntero y no con el arrastre nativo de HTML, que en Linux se
 * queda a veces sin soltar), un botón
 * para esconderlo y un tirador en la esquina para cambiar ancho y alto. Igual
 * que los paneles redimensionables de la app, mientras arrastras el tirador no
 * se vuelve a pintar React: el tamaño se escribe en el estilo del recuadro y
 * se guarda al soltar. Doble clic en el tirador vuelve al tamaño por omisión.
 *
 * Con el teclado: en el asa, ← y → lo mueven; con Mayús, ← → cambian el ancho
 * y ↑ ↓ el alto.
 */
import React, { useEffect, useRef, useState } from 'react'
import { GripVertical, EyeOff, MoveDiagonal2 } from 'lucide-react'
import { cx } from './ui'
import { useT } from '../lib/i18n'
import {
  COLS, MIN_H, SNAP_H, effectiveWidth, moveTile, resetTileSize, resizeTile, setHidden
} from '../lib/dashboardLayout'
import type { DashboardLayout } from '@shared/types'

export interface TileDef {
  id: string
  title: string
  /** null: hoy no tiene nada que enseñar (sin datos); fuera de «Organizar» no ocupa sitio. */
  render: () => React.ReactNode | null
}

const GAP = 12

export function DashboardGrid({
  layout,
  tiles,
  editing,
  onChange
}: {
  layout: DashboardLayout
  tiles: TileDef[]
  editing: boolean
  onChange: (next: DashboardLayout) => void
}): React.JSX.Element {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1400)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const byId = new Map(tiles.map((d) => [d.id, d]))
  const unit = (width + GAP) / COLS

  /** Arrastrar por el asa: el recuadro bajo el puntero dice dónde se soltaría. */
  const startMove = (e: React.PointerEvent, id: string): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const y0 = e.clientY
    let moved = false
    let target: { id: string; after: boolean } | null = null
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      if (!moved) {
        moved = true
        setDragging(id)
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-tile]') as HTMLElement | null
      const over = under?.dataset['tile']
      if (!under || !over || over === id) {
        target = null
        setDrop(null)
        return
      }
      const r = under.getBoundingClientRect()
      const after = ev.clientX > r.left + r.width / 2
      if (target?.id !== over || target.after !== after) {
        target = { id: over, after }
        setDrop(target)
      }
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragging(null)
      setDrop(null)
      if (moved && target) onChange(moveTile(layout, id, target.id, target.after))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const startResize = (e: React.PointerEvent, id: string): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget as HTMLElement
    const el = handle.closest('[data-tile]') as HTMLElement | null
    if (!el) return
    handle.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    const label = el.querySelector('[data-size-label]') as HTMLElement | null
    let w = layout.tiles.find((x) => x.id === id)?.w ?? COLS
    let h = Math.round(rect.height)
    document.body.style.cursor = 'nwse-resize'
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent): void => {
      w = Math.min(COLS, Math.max(4, Math.round((ev.clientX - rect.left + GAP) / unit)))
      h = Math.max(MIN_H, Math.round((ev.clientY - rect.top) / SNAP_H) * SNAP_H)
      el.style.gridColumn = `span ${w} / span ${w}`
      el.style.height = `${h}px`
      el.dataset['fixed'] = ''
      if (label) label.textContent = `${w}/${COLS} · ${h} px`
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (label) label.textContent = ''
      onChange(resizeTile(layout, id, w, h))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const onGripKey = (e: React.KeyboardEvent, id: string, index: number, list: string[]): void => {
    const tile = layout.tiles.find((x) => x.id === id)
    if (!tile) return
    if (e.shiftKey) {
      const el = (e.currentTarget as HTMLElement).closest('[data-tile]') as HTMLElement | null
      const curH = tile.h ?? Math.round(el?.getBoundingClientRect().height ?? 200)
      if (e.key === 'ArrowLeft') onChange(resizeTile(layout, id, tile.w - 1, tile.h))
      else if (e.key === 'ArrowRight') onChange(resizeTile(layout, id, tile.w + 1, tile.h))
      else if (e.key === 'ArrowUp') onChange(resizeTile(layout, id, tile.w, curH - 20))
      else if (e.key === 'ArrowDown') onChange(resizeTile(layout, id, tile.w, curH + 20))
      else return
    } else if (e.key === 'ArrowLeft' && index > 0) onChange(moveTile(layout, id, list[index - 1], false))
    else if (e.key === 'ArrowRight' && index < list.length - 1) onChange(moveTile(layout, id, list[index + 1], true))
    else return
    e.preventDefault()
  }

  const visible = layout.tiles.filter((x) => !layout.hidden.includes(x.id) && byId.has(x.id))
  const rendered = visible
    .map((x) => ({ tile: x, node: byId.get(x.id)!.render() }))
    .filter((r) => editing || r.node != null)
  const order = rendered.map((r) => r.tile.id)

  return (
    <div
      ref={box}
      className="grid"
      style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gap: GAP }}
      data-dashboard-grid
      data-editing={editing ? '' : undefined}
    >
      {rendered.map(({ tile, node }, index) => {
        const def = byId.get(tile.id)!
        const w = editing ? tile.w : effectiveWidth(tile.w, width)
        const target = drop?.id === tile.id ? drop : null
        return (
          <div
            key={tile.id}
            data-tile={tile.id}
            data-fixed={tile.h ? '' : undefined}
            className={cx(
              'dash-tile relative min-w-0',
              editing && 'outline outline-1 outline-dashed outline-line rounded-xl',
              dragging === tile.id && 'opacity-40',
              target && (target.after ? 'dash-drop-after' : 'dash-drop-before')
            )}
            style={{ gridColumn: `span ${w} / span ${w}`, height: tile.h ? `${tile.h}px` : undefined }}
          >
            {node ?? (
              <div className="h-full min-h-[90px] bg-panel border border-line rounded-xl flex items-center justify-center text-[12px] text-dim px-3 text-center">
                {t('{title}: todavía sin datos', { title: t(def.title) })}
              </div>
            )}
            {editing ? (
              <>
                <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-0.5 bg-raised/95 border border-line rounded-lg px-1 py-0.5 shadow-lg">
                  <button
                    onPointerDown={(e) => startMove(e, tile.id)}
                    onKeyDown={(e) => onGripKey(e, tile.id, index, order)}
                    className="p-1 rounded text-dim hover:text-ink cursor-grab active:cursor-grabbing touch-none"
                    title={t('{title}: arrastra para moverlo · con el teclado: ← →, y con Mayús cambia el tamaño', { title: t(def.title) })}
                    aria-label={t('Mover {title}', { title: t(def.title) })}
                    data-tile-grip
                  >
                    <GripVertical size={13} />
                  </button>
                  <button
                    onClick={() => onChange(setHidden(layout, tile.id, true))}
                    className="p-1 rounded text-dim hover:text-bad"
                    title={t('Esconder este recuadro')}
                    data-tile-hide
                  >
                    <EyeOff size={13} />
                  </button>
                </div>
                <span data-size-label className="absolute bottom-2 right-8 z-20 num text-[11px] text-accent pointer-events-none" />
                <button
                  onPointerDown={(e) => startResize(e, tile.id)}
                  onDoubleClick={() => onChange(resetTileSize(layout, tile.id))}
                  className="absolute bottom-0.5 right-0.5 z-20 p-1 rounded-md bg-raised border border-line text-dim hover:text-accent cursor-nwse-resize touch-none"
                  title={t('Arrastra para cambiar ancho y alto · doble clic: tamaño por omisión')}
                  aria-label={t('Cambiar el tamaño de {title}', { title: t(def.title) })}
                  data-tile-resize
                >
                  <MoveDiagonal2 size={12} />
                </button>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
