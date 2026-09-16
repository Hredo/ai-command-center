/**
 * El lienzo de La Casa.
 *
 * Se dibuja el mundo en pequeño —896 por 512 puntos— y se agranda por un
 * número entero, con el suavizado apagado: así los píxeles salen cuadrados y
 * limpios en vez de emborronados. El decorado fijo se pinta una sola vez en un
 * lienzo aparte y luego sólo se copia; encima van las cositas que parpadean,
 * los muebles y la gente, todo ordenado de arriba abajo para que quien está
 * más cerca tape a quien está más lejos.
 *
 * Los nombres se escriben al final, ya sin la escala de píxeles, para que se
 * lean nítidos como el resto de la aplicación.
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  ROOMS, WORLD, doingLabel, emptyHouse, stepHouse,
  type Dweller, type HouseState, type Job, type Resident
} from '../lib/house'
import { useT } from '../lib/i18n'
import { PROPS, drawAmbient, drawPerson, drawWorld, lookOf, type Look } from '../lib/pixelArt'

/** Fotogramas por segundo: con esto se mueve suave y no calienta el portátil. */
const FPS = 30

/**
 * Algunas faenas piden pintarse por encima del mueble aunque el mueble esté
 * más abajo: quien se sienta en el sofá va delante del sofá, no detrás.
 */
const SORT_BIAS: Record<string, number> = {
  sofa: 6,
  cama: 4,
  leer: 6,
  tumbona: 6,
  futbolin: 0,
  arcade: 0
}

export function HouseCanvas({
  residents,
  jobs,
  active,
  hovered,
  onHover,
  onState
}: {
  residents: Resident[]
  jobs: Job[]
  active: boolean
  hovered: string | null
  onHover: (id: string | null) => void
  onState: (st: HouseState) => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fondo = useRef<HTMLCanvasElement | null>(null)
  const st = useRef<HouseState>(emptyHouse())
  const tr = useT()
  const datos = useRef({ residents, jobs, hovered, tr, first: true })
  const [size, setSize] = useState({ w: WORLD.w, h: WORLD.h, s: 1 })

  datos.current.residents = residents
  datos.current.jobs = jobs
  datos.current.hovered = hovered
  // El bucle de dibujo vive fuera de React: lee el traductor de aquí.
  datos.current.tr = tr

  const looks = useRef(new Map<string, Look>())
  for (const r of residents) {
    if (!looks.current.has(r.id)) looks.current.set(r.id, lookOf(r.id, r.color, r.kind))
  }

  // Tamaño: se busca la mayor escala entera que quepa, para no emborronar.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const medir = (): void => {
      const dpr = window.devicePixelRatio || 1
      const dw = el.clientWidth * dpr
      const dh = el.clientHeight * dpr
      if (dw < 8 || dh < 8) return
      const s = Math.max(1, Math.floor(Math.min(dw / WORLD.w, dh / WORLD.h)))
      setSize({ w: WORLD.w * s, h: WORLD.h * s, s })
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    window.addEventListener('resize', medir)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [])

  // El decorado fijo, una sola vez.
  useEffect(() => {
    const bg = document.createElement('canvas')
    bg.width = WORLD.w
    bg.height = WORLD.h
    const c = bg.getContext('2d')
    if (c) drawWorld(c)
    fondo.current = bg
  }, [])

  useEffect(() => {
    if (!active) return
    const cv = canvas.current
    const c = cv?.getContext('2d')
    if (!cv || !c) return

    let raf = 0
    let last = performance.now()
    let acc = 0
    let aviso = 0

    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      acc += dt
      if (acc < 1 / FPS) return
      const paso = acc
      acc = 0

      st.current = stepHouse(st.current, paso, datos.current.residents, datos.current.jobs, datos.current.first)
      datos.current.first = false

      pintar(c, cv, st.current)

      // La lista de al lado no necesita treinta veces por segundo.
      aviso += paso
      if (aviso > 0.4) {
        aviso = 0
        onState(st.current)
      }
    }

    const pintar = (c2: CanvasRenderingContext2D, cv2: HTMLCanvasElement, estado: HouseState): void => {
      const s = cv2.width / WORLD.w
      c2.setTransform(1, 0, 0, 1, 0, 0)
      c2.imageSmoothingEnabled = false
      if (fondo.current) c2.drawImage(fondo.current, 0, 0, WORLD.w, WORLD.h, 0, 0, cv2.width, cv2.height)

      c2.setTransform(s, 0, 0, s, 0, 0)
      c2.imageSmoothingEnabled = false
      const t = performance.now() / 1000
      drawAmbient(c2, t)

      // Muebles y gente, mezclados y ordenados por su línea de apoyo: eso es
      // lo que hace que unos tapen a otros y la escena tenga fondo.
      const capas: { sort: number; draw: () => void }[] = []
      for (const p of PROPS) capas.push({ sort: p.sort, draw: () => p.draw(c2, t) })
      for (const d of estado.dwellers) {
        const look = looks.current.get(d.residentId)
        if (!look) continue
        const bias = SORT_BIAS[d.activity] ?? 0
        capas.push({ sort: d.y + bias, draw: () => drawPerson(c2, d, look, t) })
      }
      capas.sort((a, b) => a.sort - b.sort)
      for (const capa of capas) capa.draw()

      // Rótulos y nombres, ya sin la escala de píxeles, para que se lean bien.
      c2.setTransform(1, 0, 0, 1, 0, 0)
      // El tamaño va en píxeles del lienzo, que ya están multiplicados por la
      // escala: siete por la escala deja el nombre en unos diez puntos de
      // pantalla, que es lo que se lee bien sin taparlo todo.
      const fs = Math.max(12, Math.round(7 * s))

      c2.textAlign = 'left'
      c2.textBaseline = 'top'
      c2.font = `${Math.max(9, fs - 2)}px "Segoe UI", system-ui, sans-serif`
      c2.fillStyle = 'rgba(255,255,255,0.30)'
      for (const room of ROOMS) {
        if (room.outside) continue
        c2.fillText(datos.current.tr(room.name).toUpperCase(), (room.box.x + 7) * s, (room.box.y + 5) * s)
      }

      c2.font = `${fs}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`
      c2.textAlign = 'center'
      // Dos vecinos juntos —en el sofá, en el futbolín— tenían los nombres uno
      // encima de otro. Se ordenan y al que pise a otro se le baja un renglón.
      const puestos: { x: number; fila: number }[] = []
      for (const d of [...estado.dwellers].sort((a, b) => a.x - b.x)) {
        const r = datos.current.residents.find((x) => x.id === d.residentId)
        if (!r) continue
        const ancho = c2.measureText(r.name).width
        let fila = 0
        while (
          puestos.some(
            (q) => q.fila === fila && Math.abs(q.x - d.x * s) < ancho * 0.62 + 6
          )
        ) {
          fila++
        }
        puestos.push({ x: d.x * s, fila })

        const resaltado = datos.current.hovered === d.residentId
        c2.globalAlpha = Math.min(1, d.fade) * (resaltado ? 1 : 0.7)
        const px = d.x * s
        const py = (d.y + 4) * s + fila * (fs + 2)
        c2.lineWidth = Math.max(2, Math.round(s * 0.9))
        c2.strokeStyle = 'rgba(8,10,16,0.95)'
        c2.fillStyle = resaltado ? '#ffffff' : '#dfe5f0'
        c2.strokeText(r.name, px, py)
        c2.fillText(r.name, px, py)
        if (resaltado) {
          c2.font = `${Math.max(9, fs - 2)}px "Segoe UI", system-ui, sans-serif`
          c2.fillStyle = '#9fb0c8'
          const doing = doingLabel(d.doing, datos.current.tr)
          c2.strokeText(doing, px, py + fs + 2)
          c2.fillText(doing, px, py + fs + 2)
          c2.font = `${fs}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`
        }
      }
      c2.globalAlpha = 1
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, onState])

  // Pasar el ratón por encima resalta al vecino y dice qué está haciendo.
  const mover = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const cv = canvas.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * WORLD.w
    const my = ((e.clientY - r.top) / r.height) * WORLD.h
    let mejor: Dweller | null = null
    let dist = 22
    for (const d of st.current.dwellers) {
      const dx = Math.abs(d.x - mx)
      const dy = my - (d.y - 34)
      if (dx > 12 || dy < -6 || dy > 44) continue
      if (dx < dist) {
        dist = dx
        mejor = d
      }
    }
    onHover(mejor ? mejor.residentId : null)
  }

  return (
    <div ref={host} className="absolute inset-0 flex items-center justify-center">
      <canvas
        ref={canvas}
        width={size.w}
        height={size.h}
        onMouseMove={mover}
        onMouseLeave={() => onHover(null)}
        style={{
          width: size.w / (window.devicePixelRatio || 1),
          height: size.h / (window.devicePixelRatio || 1),
          imageRendering: 'pixelated'
        }}
      />
    </div>
  )
}

/** Un vecino suelto, quieto y de frente, para la lista de al lado. */
export function DollChip({ look, working }: { look: Look; working: boolean }): React.JSX.Element {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = cv.current?.getContext('2d')
    if (!c) return
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, 24 * 2, 40 * 2)
    c.setTransform(2, 0, 0, 2, 0, 0)
    c.imageSmoothingEnabled = false
    const falso: Dweller = {
      key: 'chip',
      residentId: 'chip',
      clone: false,
      x: 12,
      y: 38,
      dir: 'abajo',
      clock: 0,
      walked: 0,
      state: 'quieto',
      route: [],
      activity: working ? 'andar' : 'andar',
      fade: 1,
      shift: 0,
      doing: '',
      wanderAt: 0,
      placed: true
    }
    drawPerson(c, falso, look, 0)
  }, [look, working])
  return <canvas ref={cv} width={48} height={80} style={{ width: 24, height: 40, imageRendering: 'pixelated' }} />
}
