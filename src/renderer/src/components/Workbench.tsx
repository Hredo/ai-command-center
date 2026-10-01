/**
 * Lo que se ve de la mesa de trabajo: la cabecera de cada panel, los tiradores
 * que reparten el espacio, las zonas donde soltar una sección y el menú de
 * distribuciones de la barra de título.
 *
 * Las secciones no se mueven de sitio en el árbol de React cuando cambia la
 * distribución: cada una es una capa que se coloca en el hueco de su panel.
 * Por eso partir, cerrar o arrastrar no vuelve a montar nada ni pierde lo que
 * tuvieras a medio escribir.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Columns2, GripVertical, Rows2, Save, Trash2, X } from 'lucide-react'
import {
  layout, leaves, zoneAt, MAX_PANES, PRESETS, presetOf,
  type Divider, type DropZone, type PresetId, type Rect, type WorkspaceNode
} from '@shared/workspace'
import {
  applyLayout, closePane, cyclePane, dropSection, focusPane, openSection, removeLayout, resizeSplit, saveLayout,
  applyPresetLayout, setDrag, splitPane, useWorkspace, visibleSections
} from '../lib/workspace'
import { SECTIONS } from '../lib/sections'
import { useT } from '../lib/i18n'
import { withMod } from '../lib/platform'
import type { PageId } from '../lib/nav'
import { cx } from './ui'

/** Alto de la cabecera de un panel, cuando hay más de uno. */
export const PANE_HEADER = 30

export const pct = (n: number): string => `${(n * 100).toFixed(4)}%`

/* ------------------------------------------------------------------ *
 * El dibujo de una distribución                                      *
 * ------------------------------------------------------------------ */

/**
 * Una distribución en miniatura, dibujada con sus proporciones de verdad. La
 * usan el botón de la barra de título (enseña la mesa de ahora) y la lista de
 * las de partida y las guardadas.
 */
export function LayoutGlyph({
  root,
  focus,
  size = 18,
  className
}: {
  root: WorkspaceNode
  focus?: string
  size?: number
  className?: string
}): React.JSX.Element {
  const W = 20
  const H = 15
  const { panes } = layout(root)
  return (
    <svg width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
      {Object.entries(panes).map(([id, r]) => (
        <rect
          key={id}
          x={r.x * W + 0.9}
          y={r.y * H + 0.9}
          width={Math.max(0.5, r.w * W - 1.8)}
          height={Math.max(0.5, r.h * H - 1.8)}
          rx={1.4}
          fill={id === focus ? 'currentColor' : 'none'}
          fillOpacity={id === focus ? 0.9 : 0}
          stroke="currentColor"
          strokeWidth={1.1}
        />
      ))}
    </svg>
  )
}

const leafN = (id: string): WorkspaceNode => ({ kind: 'leaf', id, page: id })
const splitN = (dir: 'row' | 'col', a: WorkspaceNode, b: WorkspaceNode, ratio = 0.5): WorkspaceNode => ({
  kind: 'split',
  id: `${dir}-${a.id}-${b.id}`,
  dir,
  ratio,
  a,
  b
})

/** El dibujo de cada distribución de partida. */
const PRESET_SHAPE: Record<PresetId, WorkspaceNode> = {
  single: leafN('a'),
  columns: splitN('row', leafN('a'), leafN('b')),
  rows: splitN('col', leafN('a'), leafN('b')),
  side: splitN('row', leafN('a'), splitN('col', leafN('b'), leafN('c')), 0.6),
  grid: splitN('row', splitN('col', leafN('a'), leafN('c')), splitN('col', leafN('b'), leafN('d')))
}

const PRESET_LABEL: Record<PresetId, string> = {
  single: 'Una sola sección',
  columns: 'Dos columnas',
  rows: 'Dos filas',
  side: 'Una principal y dos de apoyo',
  grid: 'Cuatro a la vez'
}

/* ------------------------------------------------------------------ *
 * Menú de distribuciones (barra de título)                           *
 * ------------------------------------------------------------------ */

export function LayoutMenu(): React.JSX.Element {
  const t = useT()
  const s = useWorkspace()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const count = leaves(s.ws.root).length
  const current = presetOf(s.ws)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const row = 'w-full h-8 px-2.5 rounded-lg flex items-center gap-2.5 text-left text-[12.5px] text-muted hover:text-ink hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent'
  const key = 'ml-auto num text-[10.5px] text-dim'

  return (
    <div className="relative no-drag">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'flex items-center gap-1.5 h-6 px-2 rounded-md border transition-colors',
          open || count > 1 ? 'border-accent/50 text-accent' : 'border-line text-dim hover:text-ink hover:border-accent/40'
        )}
        title={t('Distribución: abre varias secciones a la vez y reparte el espacio')}
        data-layout-menu
      >
        <LayoutGlyph root={s.ws.root} focus={count > 1 ? s.ws.focus : undefined} size={17} />
        <ChevronDown size={11} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1.5 z-50 w-[300px] bg-raised border border-line rounded-xl shadow-2xl p-2 fade-up text-ink"
            data-layout-popover
          >
            <div className="px-1.5 pt-1 pb-1.5 text-[10.5px] uppercase tracking-wider text-dim">{t('Distribución')}</div>
            <div className="grid grid-cols-5 gap-1 px-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={t(PRESET_LABEL[p.id])}
                  data-preset={p.id}
                  onClick={() => applyPresetLayout(p.id)}
                  className={cx(
                    'h-11 rounded-lg border flex items-center justify-center transition-colors',
                    current === p.id ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-ink hover:border-accent/40'
                  )}
                >
                  <LayoutGlyph root={PRESET_SHAPE[p.id]} size={26} />
                </button>
              ))}
            </div>

            <div className="h-px bg-line my-2" />
            <button type="button" className={row} disabled={count >= MAX_PANES} onClick={() => splitPane('row')} data-split="row">
              <Columns2 size={14} /> {t('Dividir a la derecha')}
              <span className={key}>{withMod('Ctrl+\\')}</span>
            </button>
            <button type="button" className={row} disabled={count >= MAX_PANES} onClick={() => splitPane('col')} data-split="col">
              <Rows2 size={14} /> {t('Dividir abajo')}
              <span className={key}>{withMod('Ctrl+Mayús+\\')}</span>
            </button>
            <button type="button" className={row} disabled={count <= 1} onClick={() => closePane()} data-close-pane>
              <X size={14} /> {t('Cerrar este panel')}
              <span className={key}>{withMod('Ctrl+Mayús+W')}</span>
            </button>
            <button type="button" className={row} disabled={count <= 1} onClick={() => cyclePane()}>
              <span className="w-[14px]" /> {t('Pasar al panel siguiente')}
              <span className={key}>F6</span>
            </button>

            <div className="h-px bg-line my-2" />
            <div className="px-1.5 pb-1.5 text-[10.5px] uppercase tracking-wider text-dim">{t('Tus distribuciones')}</div>
            {s.layouts.length === 0 ? (
              <p className="px-1.5 pb-1.5 text-[11.5px] text-dim leading-relaxed">
                {t('Coloca los paneles a tu gusto y guárdalos con un nombre para volver a ellos.')}
              </p>
            ) : (
              s.layouts.map((l) => (
                <div key={l.id} className="flex items-center gap-1 group" data-saved-layout={l.name}>
                  <button
                    type="button"
                    className={row}
                    onClick={() => {
                      applyLayout(l.id)
                      setOpen(false)
                    }}
                  >
                    <LayoutGlyph root={l.root} size={18} />
                    <span className="truncate">{l.name}</span>
                    <span className="ml-auto text-[10.5px] text-dim truncate max-w-[110px]">
                      {leaves(l.root).map((x) => t(`nav.${x.page}`)).join(' · ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    title={t('Borrar')}
                    onClick={() => removeLayout(l.id)}
                    className="shrink-0 w-7 h-7 rounded-md text-dim hover:text-bad hover:bg-hover flex items-center justify-center opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
            <form
              className="flex items-center gap-1.5 px-1 pt-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (saveLayout(name)) setName('')
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('Nombre para la de ahora…')}
                className="flex-1 min-w-0 h-7 px-2 bg-void border border-line rounded-md text-[12px] outline-none focus:border-accent/60"
                data-layout-name
              />
              <button
                type="submit"
                disabled={!name.trim()}
                className="h-7 px-2 rounded-md border border-line text-[12px] text-muted hover:text-ink hover:border-accent/40 disabled:opacity-40 flex items-center gap-1.5"
                data-layout-save
              >
                <Save size={12} /> {t('Guardar')}
              </button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Cabecera de un panel                                               *
 * ------------------------------------------------------------------ */

function PaneHeader({ id, page, rect, on, full }: { id: string; page: PageId; rect: Rect; on: boolean; full: boolean }): React.JSX.Element {
  const t = useT()
  const s = useWorkspace()
  const [pick, setPick] = useState(false)
  const section = SECTIONS.find((x) => x.id === page)
  const Icon = section?.icon
  const shown = new Set(leaves(s.ws.root).map((l) => l.page))
  const btn = 'w-6 h-6 rounded-md flex items-center justify-center text-dim hover:text-ink hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div
      className={cx(
        'absolute flex items-center gap-1 pl-1.5 pr-1 border-b border-line bg-void select-none',
        on ? 'text-ink' : 'text-muted'
      )}
      style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: PANE_HEADER }}
      onPointerDown={() => focusPane(id)}
      data-pane-header={page}
      data-focused={on || undefined}
    >
      {on ? <span className="absolute left-0 right-0 top-0 h-[2px] bg-accent" /> : null}
      <span
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', page)
          setDrag(page)
        }}
        onDragEnd={() => setDrag(null)}
        className="w-4 h-6 flex items-center justify-center text-dim hover:text-ink cursor-grab active:cursor-grabbing"
        title={t('Arrastra para llevar esta sección a otro panel')}
      >
        <GripVertical size={12} />
      </span>
      <div className="relative min-w-0">
        <button
          type="button"
          onClick={() => setPick((v) => !v)}
          className="h-6 pl-1 pr-1.5 rounded-md flex items-center gap-1.5 hover:bg-hover min-w-0"
          title={t('Cambiar la sección de este panel')}
          data-pane-pick={page}
        >
          {Icon ? <Icon size={13} className={on ? 'text-accent' : ''} /> : null}
          <span className="text-[12px] font-medium truncate">{t(`nav.${page}`)}</span>
          <ChevronDown size={11} className="text-dim shrink-0" />
        </button>
        {pick ? (
          <>
            <div className="fixed inset-0 z-40" onPointerDown={(e) => { e.stopPropagation(); setPick(false) }} />
            <div className="absolute left-0 top-full mt-1 z-50 w-[200px] bg-raised border border-line rounded-xl shadow-2xl py-1 fade-up">
              {visibleSections(s).map((sec) => {
                const SIcon = sec.icon
                const here = sec.id === page
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      focusPane(id)
                      openSection(sec.id)
                      setPick(false)
                    }}
                    className={cx(
                      'w-full h-8 px-3 flex items-center gap-2.5 text-left text-[12.5px] hover:bg-hover',
                      here ? 'text-accent' : 'text-muted hover:text-ink'
                    )}
                  >
                    <SIcon size={14} />
                    <span className="truncate">{t(`nav.${sec.id}`)}</span>
                    {!here && shown.has(sec.id) ? <span className="ml-auto text-[10.5px] text-dim">{t('a la vista')}</span> : null}
                  </button>
                )
              })}
            </div>
          </>
        ) : null}
      </div>
      <div className="ml-auto flex items-center">
        <button type="button" className={btn} disabled={full} title={t('Dividir a la derecha')} onClick={() => splitPane('row', id)} data-pane-split="row">
          <Columns2 size={13} />
        </button>
        <button type="button" className={btn} disabled={full} title={t('Dividir abajo')} onClick={() => splitPane('col', id)} data-pane-split="col">
          <Rows2 size={13} />
        </button>
        <button type="button" className={btn} title={t('Cerrar este panel')} onClick={() => closePane(id)} data-pane-close>
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tirador entre dos paneles                                          *
 * ------------------------------------------------------------------ */

function SplitHandle({ d, host }: { d: Divider; host: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const t = useT()
  const dragging = useRef(false)
  const row = d.dir === 'row'

  const ratioAt = useCallback(
    (e: PointerEvent | React.PointerEvent): number | null => {
      const box = host.current?.getBoundingClientRect()
      if (!box) return null
      return row
        ? (e.clientX - box.left - d.area.x * box.width) / (d.area.w * box.width)
        : (e.clientY - box.top - d.area.y * box.height) / (d.area.h * box.height)
    },
    [host, row, d.area.x, d.area.y, d.area.w, d.area.h]
  )

  return (
    <div
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-label={t('Repartir el espacio entre los dos paneles')}
      tabIndex={0}
      data-split-handle={d.id}
      className={cx('absolute z-20 group outline-none', row ? 'cursor-col-resize' : 'cursor-row-resize')}
      style={
        row
          ? { left: `calc(${pct(d.at)} - 3px)`, top: pct(d.area.y), width: 7, height: pct(d.area.h) }
          : { left: pct(d.area.x), top: `calc(${pct(d.at)} - 3px)`, width: pct(d.area.w), height: 7 }
      }
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.style.cursor = row ? 'col-resize' : 'row-resize'
        document.body.style.userSelect = 'none'
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const r = ratioAt(e)
        if (r != null) resizeSplit(d.id, r, false)
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        const r = ratioAt(e)
        resizeSplit(d.id, r ?? d.ratio, true)
      }}
      onDoubleClick={() => resizeSplit(d.id, 0.5, true)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.08 : 0.02
        const less = row ? 'ArrowLeft' : 'ArrowUp'
        const more = row ? 'ArrowRight' : 'ArrowDown'
        if (e.key === less) resizeSplit(d.id, d.ratio - step, true)
        else if (e.key === more) resizeSplit(d.id, d.ratio + step, true)
        else return
        e.preventDefault()
      }}
      title={t('Arrastra para repartir el espacio; doble clic lo iguala')}
    >
      <span
        className={cx(
          'absolute bg-line group-hover:bg-accent group-focus-visible:bg-accent transition-colors',
          row ? 'left-[3px] top-0 bottom-0 w-px group-hover:w-[2px]' : 'top-[3px] left-0 right-0 h-px group-hover:h-[2px]'
        )}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Dónde soltar                                                       *
 * ------------------------------------------------------------------ */

const ZONE_BOX: Record<DropZone, React.CSSProperties> = {
  center: { inset: 6 },
  left: { left: 6, top: 6, bottom: 6, width: 'calc(50% - 9px)' },
  right: { right: 6, top: 6, bottom: 6, width: 'calc(50% - 9px)' },
  top: { left: 6, right: 6, top: 6, height: 'calc(50% - 9px)' },
  bottom: { left: 6, right: 6, bottom: 6, height: 'calc(50% - 9px)' }
}

const ZONE_TEXT: Record<DropZone, string> = {
  center: 'Abrir aquí',
  left: 'Abrir a la izquierda',
  right: 'Abrir a la derecha',
  top: 'Abrir arriba',
  bottom: 'Abrir abajo'
}

function DropLayer({ panes, drag }: { panes: Record<string, Rect>; drag: PageId }): React.JSX.Element {
  const t = useT()
  const s = useWorkspace()
  const [over, setOver] = useState<{ id: string; zone: DropZone } | null>(null)
  const all = leaves(s.ws.root)
  const source = all.find((l) => l.page === drag)
  // Partir sólo cabe si queda sitio, o si la sección ya ocupa un panel (se mueve).
  const canSplit = Boolean(source ? all.length > 1 : all.length < MAX_PANES)

  const zoneOf = (e: React.DragEvent, id: string): DropZone => {
    const box = e.currentTarget.getBoundingClientRect()
    const z = zoneAt((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height)
    if (z === 'center') return z
    if (!canSplit || source?.id === id) return 'center'
    return z
  }

  return (
    <div className="absolute inset-0 z-30" data-drop-layer>
      {Object.entries(panes).map(([id, r]) => {
        const here = over?.id === id ? over.zone : null
        return (
          <div
            key={id}
            className="absolute"
            style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
            data-drop-pane={all.find((l) => l.id === id)?.page}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const zone = zoneOf(e, id)
              setOver((prev) => (prev?.id === id && prev.zone === zone ? prev : { id, zone }))
            }}
            onDragLeave={() => setOver((prev) => (prev?.id === id ? null : prev))}
            onDrop={(e) => {
              e.preventDefault()
              dropSection(drag, id, zoneOf(e, id))
              setOver(null)
            }}
          >
            {here ? (
              <div
                className="absolute rounded-xl border-2 border-accent bg-accent/15 flex items-center justify-center pointer-events-none"
                style={ZONE_BOX[here]}
              >
                <span className="px-2.5 py-1 rounded-md bg-void/80 text-[12px] text-accent">{t(ZONE_TEXT[here])}</span>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * La capa de la mesa: cabeceras, tiradores y zonas de soltar         *
 * ------------------------------------------------------------------ */

export function WorkbenchChrome({ host }: { host: React.RefObject<HTMLDivElement | null> }): React.JSX.Element | null {
  const s = useWorkspace()
  const all = leaves(s.ws.root)
  const { panes, dividers } = layout(s.ws.root)
  const many = all.length > 1
  return (
    <>
      {many
        ? all.map((l) => (
            <PaneHeader key={l.id} id={l.id} page={l.page as PageId} rect={panes[l.id]} on={l.id === s.ws.focus} full={all.length >= MAX_PANES} />
          ))
        : null}
      {dividers.map((d) => (
        <SplitHandle key={d.id} d={d} host={host} />
      ))}
      {s.drag ? <DropLayer panes={panes} drag={s.drag} /> : null}
    </>
  )
}
