/**
 * La Casa: el plano en planta, los sitios y el vaivén de los vecinos.
 *
 * Aquí no se pinta nada. Esto es lo otro: por dónde se puede andar, dónde
 * están las puertas y los muebles, en qué punto exacto se cocina o se duerme,
 * y cómo se va uno de la cocina a la cancha sin atravesar tabiques ni pasar
 * por encima del sofá. El dibujo vive en `lib/pixelArt.ts` y lee estas mismas
 * coordenadas.
 *
 * La vista es de tres cuartos, como la de los juegos de granja: se mira la
 * casa desde arriba y un poco de frente, así que de cada pared se ve la cara
 * y el suelo se extiende hacia abajo.
 *
 * Para andar, el suelo se parte en una cuadrícula de 4 puntos: son pisables
 * los suelos de las habitaciones, los huecos de las puertas y el exterior,
 * menos la planta de cada mueble con un margen. El camino se busca con A* y
 * luego se estira, quitando los puntos por los que no hace falta pasar, para
 * que se ande en rectas largas y no en escalera.
 *
 * Reglas de la casa:
 *
 * - Vive uno de cada IA que la aplicación detecta: cada agente de consola,
 *   cada modelo local y cada proveedor por API con llave.
 * - Si no tiene trabajo, descansa: sofá, cama, piscina, canasta, recreativa.
 * - Si le mandas faena, se levanta y hace algo de la casa.
 * - Si le mandas dos cosas a la vez, llega por la calle otro vecino idéntico,
 *   entra por la puerta y se marcha por donde vino en cuanto esa segunda tarea
 *   termina.
 */

/** Tamaño del mundo en píxeles de dibujo, antes de agrandarlo en pantalla. */
export const WORLD = { w: 768, h: 640 }

/** Alto de la cara de pared que se ve encima del suelo de cada habitación. */
export const WALL_H = 48
/** Grosor de los tabiques. */
export const WALL_W = 16

export type Dir = 'abajo' | 'arriba' | 'izq' | 'der'

export interface Pt {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/* ------------------------------------------------------------------ *
 * Habitaciones                                                       *
 * ------------------------------------------------------------------ */

export interface Room {
  id: string
  name: string
  /** Todo el hueco de la habitación, pared de arriba incluida. */
  box: Rect
  /** Por dónde se puede pisar. */
  floor: Rect
  /** Está fuera: sin techo ni papel pintado. */
  outside?: boolean
}

const cuarto = (id: string, name: string, x: number, y: number, w: number, h: number): Room => ({
  id,
  name,
  box: { x, y, w, h },
  floor: { x: x + 10, y: y + WALL_H + 6, w: w - 20, h: h - WALL_H - 16 }
})

export const ROOMS: Room[] = [
  cuarto('cocina', 'Cocina', 32, 32, 160, 224),
  cuarto('salon', 'Salón', 192, 32, 176, 224),
  cuarto('despacho', 'Despacho', 368, 32, 176, 224),
  cuarto('dormitorio', 'Dormitorio', 32, 256, 160, 224),
  cuarto('juegos', 'Sala de juegos', 192, 256, 176, 224),
  cuarto('recibidor', 'Recibidor', 368, 256, 176, 224),
  {
    id: 'jardin',
    name: 'Jardín',
    box: { x: 544, y: 0, w: 224, h: 480 },
    floor: { x: 552, y: 40, w: 208, h: 428 },
    outside: true
  },
  {
    id: 'patio',
    name: 'La cancha',
    box: { x: 0, y: 480, w: 768, h: 160 },
    floor: { x: 24, y: 492, w: 720, h: 132 },
    outside: true
  }
]

export const HOUSE: Rect = { x: 32, y: 32, w: 512, h: 448 }

export function roomById(id: string): Room {
  return ROOMS.find((r) => r.id === id) ?? ROOMS[0]
}

/* ------------------------------------------------------------------ *
 * Puertas                                                            *
 * ------------------------------------------------------------------ */

/**
 * Una puerta son dos habitaciones y los puntos por los que se pasa de una a
 * otra. Entre habitaciones de arriba y de abajo hacen falta dos puntos, porque
 * en medio está la franja de pared que se ve de frente.
 */
export interface Door {
  a: string
  b: string
  /** Recorrido de `a` hasta `b`. */
  pts: Pt[]
  /** Dónde pintar el hueco. */
  gap: Rect
}

/** Hueco en un tabique vertical: se cruza por un punto. */
const puertaV = (a: string, b: string, x: number, y: number): Door => ({
  a,
  b,
  pts: [{ x, y }],
  gap: { x: x - WALL_W / 2, y: y - 26, w: WALL_W, h: 52 }
})

/** Hueco en una pared horizontal: se entra por arriba y se sale por abajo. */
const puertaH = (a: string, b: string, x: number, yArriba: number, yAbajo: number): Door => ({
  a,
  b,
  pts: [
    { x, y: yArriba },
    { x, y: yAbajo }
  ],
  gap: { x: x - 22, y: yArriba, w: 44, h: yAbajo - yArriba }
})

export const DOORS: Door[] = [
  puertaV('cocina', 'salon', 192, 176),
  puertaV('salon', 'despacho', 368, 176),
  puertaV('dormitorio', 'juegos', 192, 402),
  puertaV('juegos', 'recibidor', 368, 402),
  puertaH('cocina', 'dormitorio', 104, 244, 316),
  puertaH('salon', 'juegos', 268, 244, 316),
  puertaH('despacho', 'recibidor', 470, 244, 316),
  // La puerta de la calle, en la pared derecha del recibidor.
  puertaV('recibidor', 'jardin', 552, 420),
  // De la franja de la derecha a la de abajo, por la esquina del jardín.
  puertaH('jardin', 'patio', 648, 458, 508)
]

/** El umbral de la puerta de la calle: al acercarse alguien, se abre. */
export const FRONT_DOOR: Pt = { x: 546, y: 420 }

/**
 * Por aquí se llega y por aquí se va: el camino del jardín sigue hacia la
 * derecha y sale del dibujo. Quien viene aparece andando por él, no de la nada.
 */
export const STREET: Pt = { x: 792, y: 420 }

/** El agua de la piscina, sin el bordillo. */
export const POOL: Rect = { x: 580, y: 76, w: 160, h: 116 }

/** Aro de la canasta: dónde está en el suelo y a qué altura queda. */
export const HOOP = { x: 280, gy: 552, h: 28 }

/**
 * Cuánto cubre el agua a quien está en (x, y): 0 en el borde, 1 ya con el
 * agua por el pecho, a diez puntos de la orilla.
 */
export function waterDepth(x: number, y: number): number {
  const p = POOL
  if (x <= p.x || x >= p.x + p.w || y <= p.y || y >= p.y + p.h) return 0
  const orilla = Math.min(x - p.x, p.x + p.w - x, y - p.y, p.y + p.h - y)
  return Math.min(1, orilla / 10)
}

/* ------------------------------------------------------------------ *
 * Sitios                                                             *
 * ------------------------------------------------------------------ */

export type Activity =
  // faena
  | 'cocinar'
  | 'fregar'
  | 'barrer'
  | 'desempolvar'
  | 'regar'
  | 'teclear'
  | 'hacer-cama'
  | 'recoger'
  | 'limpiar-piscina'
  // descanso
  | 'sofa'
  | 'cama'
  | 'arcade'
  | 'futbolin'
  | 'flotar'
  | 'canasta'
  | 'tumbona'
  | 'leer'
  // de paso
  | 'andar'

export interface PatrolPt {
  x: number
  y: number
  dir: Dir
}

export interface Spot {
  id: string
  room: string
  /** Cómo se dice en cristiano: "la cocina", "el sofá". */
  place: string
  x: number
  y: number
  dir: Dir
  activity: Activity
  /** true si es sitio de faena. */
  work: boolean
  /**
   * Desde dónde se entra cuando el sitio está encima de un mueble o en el
   * agua: el borde del sofá, el lado de la cama, la escalerilla.
   */
  from?: Pt
  /**
   * Las faenas que se hacen moviéndose —barrer, regar, recoger— van de punto
   * en punto, paran un rato en cada uno y siguen.
   */
  patrol?: PatrolPt[]
}

export const WORK_SPOTS: Spot[] = [
  {
    id: 'w-fogones', room: 'cocina', place: 'la cocina', x: 72, y: 108, dir: 'arriba', activity: 'cocinar', work: true,
    patrol: [{ x: 52, y: 106, dir: 'arriba' }, { x: 72, y: 108, dir: 'arriba' }]
  },
  { id: 'w-fregadero', room: 'cocina', place: 'el fregadero', x: 140, y: 108, dir: 'arriba', activity: 'fregar', work: true },
  {
    id: 'w-barrer', room: 'salon', place: 'el salón', x: 224, y: 232, dir: 'abajo', activity: 'barrer', work: true,
    patrol: [
      { x: 262, y: 228, dir: 'der' },
      { x: 306, y: 232, dir: 'der' },
      { x: 264, y: 236, dir: 'izq' },
      { x: 220, y: 230, dir: 'izq' }
    ]
  },
  {
    id: 'w-polvo', room: 'salon', place: 'la estantería', x: 336, y: 108, dir: 'arriba', activity: 'desempolvar', work: true,
    patrol: [{ x: 318, y: 100, dir: 'arriba' }, { x: 344, y: 102, dir: 'arriba' }]
  },
  { id: 'w-mesa1', room: 'despacho', place: 'el despacho', x: 408, y: 110, dir: 'arriba', activity: 'teclear', work: true, from: { x: 408, y: 97 } },
  { id: 'w-mesa2', room: 'despacho', place: 'el despacho', x: 456, y: 110, dir: 'arriba', activity: 'teclear', work: true, from: { x: 456, y: 97 } },
  { id: 'w-mesa3', room: 'despacho', place: 'el despacho', x: 504, y: 110, dir: 'arriba', activity: 'teclear', work: true, from: { x: 504, y: 97 } },
  {
    id: 'w-cama', room: 'dormitorio', place: 'el dormitorio', x: 134, y: 356, dir: 'izq', activity: 'hacer-cama', work: true,
    patrol: [
      { x: 116, y: 372, dir: 'izq' },
      { x: 80, y: 412, dir: 'arriba' },
      { x: 116, y: 390, dir: 'izq' }
    ]
  },
  {
    id: 'w-recoger', room: 'juegos', place: 'la sala de juegos', x: 336, y: 446, dir: 'abajo', activity: 'recoger', work: true,
    patrol: [
      { x: 342, y: 408, dir: 'izq' },
      { x: 348, y: 432, dir: 'izq' },
      { x: 326, y: 446, dir: 'arriba' }
    ]
  },
  {
    id: 'w-regar', room: 'jardin', place: 'el jardín', x: 628, y: 340, dir: 'izq', activity: 'regar', work: true,
    patrol: [
      { x: 612, y: 354, dir: 'izq' },
      { x: 592, y: 314, dir: 'izq' },
      { x: 628, y: 340, dir: 'izq' }
    ]
  },
  {
    id: 'w-piscina', room: 'jardin', place: 'la piscina', x: 564, y: 132, dir: 'der', activity: 'limpiar-piscina', work: true,
    patrol: [{ x: 564, y: 100, dir: 'der' }, { x: 564, y: 170, dir: 'der' }]
  }
]

/** La escalerilla de la piscina: se entra y se sale por aquí. */
const ESCALERILLA: Pt = { x: 606, y: 69 }

export const REST_SPOTS: Spot[] = [
  { id: 'r-sofa1', room: 'salon', place: 'el sofá', x: 240, y: 174, dir: 'abajo', activity: 'sofa', work: false, from: { x: 240, y: 190 } },
  { id: 'r-sofa2', room: 'salon', place: 'el sofá', x: 274, y: 174, dir: 'abajo', activity: 'sofa', work: false, from: { x: 274, y: 190 } },
  { id: 'r-cama', room: 'dormitorio', place: 'la cama', x: 76, y: 352, dir: 'abajo', activity: 'cama', work: false, from: { x: 116, y: 366 } },
  { id: 'r-leer', room: 'dormitorio', place: 'la butaca', x: 152, y: 444, dir: 'abajo', activity: 'leer', work: false, from: { x: 152, y: 458 } },
  { id: 'r-arcade', room: 'juegos', place: 'la recreativa', x: 226, y: 336, dir: 'arriba', activity: 'arcade', work: false },
  { id: 'r-futbolin', room: 'juegos', place: 'el futbolín', x: 296, y: 370, dir: 'abajo', activity: 'futbolin', work: false },
  { id: 'r-futbolin2', room: 'juegos', place: 'el futbolín', x: 296, y: 432, dir: 'arriba', activity: 'futbolin', work: false },
  { id: 'r-tumbona', room: 'jardin', place: 'la tumbona', x: 592, y: 274, dir: 'abajo', activity: 'tumbona', work: false, from: { x: 590, y: 292 } },
  { id: 'r-flota1', room: 'jardin', place: 'la piscina', x: 618, y: 128, dir: 'abajo', activity: 'flotar', work: false, from: ESCALERILLA },
  { id: 'r-flota2', room: 'jardin', place: 'la piscina', x: 700, y: 160, dir: 'abajo', activity: 'flotar', work: false, from: ESCALERILLA },
  {
    id: 'r-canasta', room: 'patio', place: 'la cancha', x: 280, y: 584, dir: 'arriba', activity: 'canasta', work: false,
    patrol: [
      { x: 244, y: 590, dir: 'arriba' },
      { x: 318, y: 588, dir: 'arriba' },
      { x: 280, y: 600, dir: 'arriba' }
    ]
  },
  {
    id: 'r-banquillo', room: 'patio', place: 'la cancha', x: 154, y: 600, dir: 'der', activity: 'canasta', work: false,
    patrol: [
      { x: 188, y: 570, dir: 'der' },
      { x: 150, y: 560, dir: 'der' }
    ]
  }
]

export const ALL_SPOTS = [...WORK_SPOTS, ...REST_SPOTS]

export function spotById(id: string | undefined): Spot | undefined {
  return id ? ALL_SPOTS.find((s) => s.id === id) : undefined
}

/**
 * Lo que se hace en otra postura. Para empezar hay que sentarse o tumbarse,
 * y para irse, levantarse primero: nadie sale andando desde la cama.
 */
export const POSTURE: Partial<Record<Activity, 'sentado' | 'tumbado'>> = {
  sofa: 'sentado',
  leer: 'sentado',
  teclear: 'sentado',
  cama: 'tumbado',
  tumbona: 'tumbado'
}

/* ------------------------------------------------------------------ *
 * Por dónde se puede pisar                                           *
 * ------------------------------------------------------------------ */

/** Lado de cada casilla de la cuadrícula, en puntos. */
const CELL = 4
/** La cuadrícula pasa del borde derecho: la calle sigue fuera del dibujo. */
const COLS = 204
const ROWS = WORLD.h / CELL
/** Margen alrededor de cada mueble: los pies no rozan las patas. */
const CLEAR = 3

/** Lo pisable: suelos, huecos de puerta y el exterior. */
const WALK: Rect[] = [
  ...ROOMS.filter((r) => !r.outside).map((r) => r.floor),
  ...DOORS.map((d) =>
    d.pts.length === 1
      ? { x: d.pts[0].x - 14, y: d.pts[0].y - 18, w: 28, h: 36 }
      : { x: d.pts[0].x - 14, y: d.pts[0].y - 6, w: 28, h: d.pts[1].y - d.pts[0].y + 8 }
  ),
  // el jardín, la esquina de abajo y la cancha
  { x: 556, y: 36, w: 206, h: 460 },
  { x: 20, y: 492, w: 742, h: 124 },
  // la calle
  { x: 740, y: 406, w: 76, h: 28 }
]

/**
 * La planta de cada mueble: lo que ocupa en el suelo, no lo que se ve. Como
 * la vista es de tres cuartos, de un armario se ve el frente y la planta es
 * sólo la franja de abajo; de una cama, que es baja, casi todo.
 */
const OBSTACLES: Rect[] = [
  // cocina: encimera, nevera, mesa con sus sillas
  { x: 40, y: 80, w: 120, h: 14 },
  { x: 164, y: 80, w: 24, h: 31 },
  { x: 62, y: 194, w: 84, h: 30 },
  // salón: sofá, mesita, planta
  { x: 210, y: 150, w: 96, h: 32 },
  { x: 234, y: 198, w: 44, h: 22 },
  { x: 344, y: 230, w: 16, h: 12 },
  // despacho: mesas, archivador, planta
  { x: 388, y: 108, w: 36, h: 20 },
  { x: 436, y: 108, w: 36, h: 20 },
  { x: 484, y: 108, w: 36, h: 20 },
  { x: 522, y: 200, w: 22, h: 24 },
  { x: 384, y: 222, w: 16, h: 12 },
  // dormitorio: cama, mesilla, butaca
  { x: 50, y: 312, w: 56, h: 88 },
  { x: 112, y: 320, w: 20, h: 23 },
  { x: 132, y: 422, w: 42, h: 28 },
  // sala de juegos: recreativa y futbolín
  { x: 208, y: 306, w: 34, h: 20 },
  { x: 266, y: 380, w: 60, h: 42 },
  // recibidor: consola y planta
  { x: 392, y: 338, w: 40, h: 24 },
  { x: 512, y: 452, w: 16, h: 12 },
  // fuera: el agua, el flotador, la tumbona y su sombrilla, las macetas
  POOL,
  { x: 742, y: 146, w: 12, h: 12 },
  { x: 566, y: 250, w: 46, h: 33 },
  { x: 620, y: 274, w: 8, h: 8 },
  { x: 566, y: 324, w: 14, h: 12 },
  { x: 588, y: 336, w: 14, h: 12 },
  { x: 610, y: 324, w: 14, h: 12 },
  // troncos de los árboles y el poste de la canasta
  { x: 716, y: 396, w: 20, h: 10 },
  { x: 50, y: 596, w: 20, h: 10 },
  { x: 690, y: 596, w: 20, h: 10 },
  { x: 274, y: 546, w: 12, h: 10 }
]

const dentro = (r: Rect, x: number, y: number, m = 0): boolean =>
  x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m

/** 1 si la casilla se puede pisar. Se calcula una vez al cargar. */
const PASO = new Uint8Array(COLS * ROWS)
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = c * CELL + CELL / 2
    const y = r * CELL + CELL / 2
    PASO[r * COLS + c] = WALK.some((w) => dentro(w, x, y)) && !OBSTACLES.some((o) => dentro(o, x, y, CLEAR)) ? 1 : 0
  }
}

const celda = (p: Pt): number => {
  const c = Math.floor(p.x / CELL)
  const r = Math.floor(p.y / CELL)
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return -1
  return r * COLS + c
}
const centro = (i: number): Pt => ({ x: (i % COLS) * CELL + CELL / 2, y: Math.floor(i / COLS) * CELL + CELL / 2 })

export function walkable(p: Pt): boolean {
  const i = celda(p)
  return i >= 0 && PASO[i] === 1
}

/** La casilla pisable más cercana a un punto que no lo es. */
function nearestWalkable(p: Pt): Pt {
  const c0 = Math.floor(p.x / CELL)
  const r0 = Math.floor(p.y / CELL)
  let mejor: Pt | null = null
  let dist = Infinity
  for (let rad = 1; rad < 24 && !mejor; rad++) {
    for (let r = r0 - rad; r <= r0 + rad; r++) {
      for (let c = c0 - rad; c <= c0 + rad; c++) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS || !PASO[r * COLS + c]) continue
        const q = centro(r * COLS + c)
        const d = Math.hypot(q.x - p.x, q.y - p.y)
        if (d < dist) {
          dist = d
          mejor = q
        }
      }
    }
  }
  return mejor ?? p
}

/** ¿Se puede ir en línea recta sin pisar muebles ni rozar a nadie parado? */
function clearLine(a: Pt, b: Pt, crowd: Pt[]): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2)
  for (let i = 1; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }
    if (!walkable(p)) return false
    for (const q of crowd) if (Math.abs(q.x - p.x) < 7 && Math.abs(q.y - p.y) < 5) return false
  }
  return true
}

// Memoria de A*, reutilizada entre búsquedas para no reservarla cada vez.
const G = new Float32Array(COLS * ROWS)
const DESDE = new Int32Array(COLS * ROWS)
const VISTO = new Uint32Array(COLS * ROWS)
const CERRADO = new Uint32Array(COLS * ROWS)
let vuelta = 0

const VECINOS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
]

/**
 * El camino más corto de `a` a `b` sobre la cuadrícula, ya estirado. Quien
 * está quieto por medio cuenta como un estorbo que se rodea si se puede. No
 * incluye `a`; acaba exactamente en `b`.
 */
function findPath(a: Pt, b: Pt, crowd: Pt[]): Pt[] | null {
  const ia = celda(a)
  const ib = celda(b)
  if (ia < 0 || ib < 0 || !PASO[ia] || !PASO[ib]) return null
  if (ia === ib) return [{ ...b }]

  // Los que están parados suben el coste de su casilla y las de alrededor.
  const estorbo = new Set<number>()
  for (const q of crowd) {
    for (let dy = -8; dy <= 8; dy += CELL) {
      for (let dx = -8; dx <= 8; dx += CELL) {
        const i = celda({ x: q.x + dx, y: q.y + dy })
        if (i >= 0) estorbo.add(i)
      }
    }
  }

  vuelta++
  const bx = ib % COLS
  const by = Math.floor(ib / COLS)
  const h = (i: number): number => {
    const dx = Math.abs((i % COLS) - bx)
    const dy = Math.abs(Math.floor(i / COLS) - by)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }

  // Montículo binario de [f, índice].
  const heap: number[][] = []
  const push = (f: number, i: number): void => {
    heap.push([f, i])
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (heap[p][0] <= heap[k][0]) break
      ;[heap[p], heap[k]] = [heap[k], heap[p]]
      k = p
    }
  }
  const pop = (): number => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k], heap[m]]
        k = m
      }
    }
    return top[1]
  }

  G[ia] = 0
  VISTO[ia] = vuelta
  DESDE[ia] = -1
  push(h(ia), ia)
  let found = false
  while (heap.length) {
    const cur = pop()
    if (CERRADO[cur] === vuelta) continue
    CERRADO[cur] = vuelta
    if (cur === ib) {
      found = true
      break
    }
    const cc = cur % COLS
    const cr = Math.floor(cur / COLS)
    for (const [dx, dy, coste] of VECINOS) {
      const nc = cc + dx
      const nr = cr + dy
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue
      const ni = nr * COLS + nc
      if (!PASO[ni] || CERRADO[ni] === vuelta) continue
      // En diagonal no se corta por la esquina de un mueble.
      if (dx && dy && (!PASO[cr * COLS + nc] || !PASO[nr * COLS + cc])) continue
      const g = G[cur] + coste + (estorbo.has(ni) ? 3 : 0)
      if (VISTO[ni] === vuelta && g >= G[ni]) continue
      VISTO[ni] = vuelta
      G[ni] = g
      DESDE[ni] = cur
      push(g + h(ni), ni)
    }
  }
  if (!found) return null

  const celdas: Pt[] = []
  for (let i = ib; i !== -1; i = DESDE[i]) celdas.push(centro(i))
  celdas.reverse()
  celdas[0] = { ...a }
  celdas[celdas.length - 1] = { ...b }

  // Estirar: de cada punto se salta al más lejano que se vea en línea recta.
  const out: Pt[] = []
  let ancla = celdas[0]
  for (let i = 1; i < celdas.length - 1; i++) {
    if (!clearLine(ancla, celdas[i + 1], crowd)) {
      out.push(celdas[i])
      ancla = celdas[i]
    }
  }
  out.push(celdas[celdas.length - 1])
  return out
}

const mas = (p: Pt, shift: number): Pt => ({ x: p.x + shift, y: p.y })

/**
 * El camino completo de una tarea a otra. Del sitio que se deja se sale por
 * donde se entró (la escalerilla, el borde del sofá) y al sitio nuevo se llega
 * por su entrada. Si el sitio es para sentarse o tumbarse, el camino acaba en
 * la entrada y lo último —sentarse, meterse en la cama— lo hace la postura.
 */
function planRoute(
  from: Pt,
  left: { spot: Spot; shift: number } | undefined,
  to: Pt,
  target: Spot | undefined,
  shift: number,
  crowd: Pt[]
): Pt[] {
  const out: Pt[] = []
  let start = from
  if (left?.spot.from) {
    const f = mas(left.spot.from, left.shift)
    // Del agua a la escalerilla se va andando; de la silla, levantándose.
    if (!POSTURE[left.spot.activity]) out.push(f)
    start = f
  }
  if (!walkable(start)) {
    // Del agua se sale por la escalerilla, no trepando por el bordillo.
    const n = dentro(POOL, start.x, start.y) ? { ...ESCALERILLA } : nearestWalkable(start)
    out.push(n)
    start = n
  }

  let end = to
  const tail: Pt[] = []
  if (target?.from) {
    end = mas(target.from, shift)
    if (!POSTURE[target.activity]) tail.push(to)
  } else if (!walkable(to)) {
    end = nearestWalkable(to)
    tail.push(to)
  }
  if (!walkable(end)) {
    const n = nearestWalkable(end)
    tail.unshift(end)
    end = n
  }

  const cerca = (q: Pt): boolean => Math.hypot(q.x - to.x, q.y - to.y) < 12 || Math.hypot(q.x - from.x, q.y - from.y) < 10
  const mid = findPath(start, end, crowd.filter((q) => !cerca(q))) ?? [end]
  return [...out, ...mid, ...tail]
}

/* ------------------------------------------------------------------ *
 * Quién vive aquí                                                    *
 * ------------------------------------------------------------------ */

export type ResidentKind = 'cli' | 'local' | 'remote'

export interface Resident {
  /** Clave estable; también decide la pinta del vecino. */
  id: string
  name: string
  kind: ResidentKind
  color: string
  detail?: string
}

/** Una tarea en marcha, ya atribuida a su vecino. */
export interface Job {
  id: string
  residentId: string
  /** De dónde sale: la consola, la arena, un proyecto. */
  where: string
  /** El modelo concreto, cuando no es el del propio vecino. */
  label?: string
}

/* ------------------------------------------------------------------ *
 * Los vecinos y su vaivén                                            *
 * ------------------------------------------------------------------ */

export type DwellerState = 'entrando' | 'andando' | 'quieto' | 'saliendo'

export interface Dweller {
  key: string
  residentId: string
  /** true si es una copia que ha venido sólo a hacer una tarea. */
  clone: boolean
  x: number
  y: number
  dir: Dir
  /** Reloj propio, en segundos: mueve su animación. */
  clock: number
  /** Distancia andada, para el paso de la caminata. */
  walked: number
  /** Velocidad de ahora, en puntos por segundo: arranca y frena poco a poco. */
  speed: number
  /** La de ir a gusto, que cada uno tiene la suya. */
  cruise: number
  state: DwellerState
  route: Pt[]
  /** El sitio que le toca. */
  spotId?: string
  /** El sitio en el que está de verdad, y su apartado; vacío mientras anda. */
  at?: string
  atShift: number
  activity: Activity
  /** Apartado a un lado cuando dos comparten sitio. */
  shift: number
  /** 0 de pie, 1 ya del todo sentado, tumbado o metido en la faena. */
  settle: number
  /** Levantándose antes de echar a andar. */
  rising: boolean
  /** El trozo de camino es de la propia faena: de maceta en maceta. */
  patrolling: boolean
  patrolIdx: number
  /** Cuándo paró en el punto de faena y cuánto se queda. */
  pauseAt: number
  pauseFor: number
  /** Hacia dónde gira la cabeza un momento, y hasta cuándo. */
  glanceDir: Dir
  glanceUntil: number
  glanceAt: number
  /** Tiempo parado con camino por delante: si se atasca, sigue igualmente. */
  stuck: number
  ghostUntil: number
  doing: string
  /** Cuándo le toca cambiar de sitio de descanso. */
  wanderAt: number
  /** false mientras no se le haya dado su primer sitio. */
  placed: boolean
}

export interface HouseState {
  dwellers: Dweller[]
  /** Cuánto está abierta la puerta de la calle: 0 cerrada, 1 abierta. */
  door: number
}

export function emptyHouse(): HouseState {
  return { dwellers: [], door: 0 }
}

/** Aceleración y frenada, en puntos por segundo al cuadrado. */
const ACCEL = 130
const DECEL = 150
/** Al hacer la faena se va despacio: de la maceta a la de al lado no se corre. */
const PATROL_SPEED = 24
/** Lo que se tarda en sentarse, en tumbarse y en levantarse. */
const SIT = 0.45
const LIE = 0.9
const RISE = 0.4
/** Una jugada entera en la cancha: botar, tirar, que caiga y volver a por ella. */
export const SHOT = 4.2

export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** Un vecino recién llegado, con todo a cero salvo lo que se le pase. */
export function makeDweller(key: string, over: Partial<Dweller> = {}): Dweller {
  const h = hash(key)
  return {
    key,
    residentId: key,
    clone: false,
    x: STREET.x,
    y: STREET.y,
    dir: 'izq',
    clock: (h % 1000) / 100,
    walked: 0,
    speed: 0,
    cruise: 44 + (h % 16),
    state: 'entrando',
    route: [],
    atShift: 0,
    activity: 'andar',
    shift: 0,
    settle: 0,
    rising: false,
    patrolling: false,
    patrolIdx: -1,
    pauseAt: 0,
    pauseFor: 0,
    glanceDir: 'izq',
    glanceUntil: 0,
    glanceAt: 6 + (h % 9),
    stuck: 0,
    ghostUntil: 0,
    doing: 'llegando a casa',
    wanderAt: 14 + (h % 30),
    placed: true,
    ...over
  }
}

/** Frase corta de lo que hace, para el letrero y el listado. */
export function doingText(a: Activity, place: string): string {
  switch (a) {
    case 'cocinar': return 'cocinando'
    case 'fregar': return 'fregando los platos'
    case 'barrer': return 'barriendo ' + place
    case 'desempolvar': return 'quitando el polvo'
    case 'regar': return 'regando las plantas'
    case 'teclear': return 'trabajando en el despacho'
    case 'hacer-cama': return 'haciendo la cama'
    case 'recoger': return 'recogiendo el desorden'
    case 'limpiar-piscina': return 'limpiando la piscina'
    case 'sofa': return 'en el sofá'
    case 'cama': return 'echando una cabezada'
    case 'arcade': return 'en la máquina recreativa'
    case 'futbolin': return 'echando un futbolín'
    case 'flotar': return 'dándose un baño'
    case 'canasta': return 'tirando a canasta'
    case 'tumbona': return 'en la tumbona'
    case 'leer': return 'leyendo en la butaca'
    case 'andar': return 'de camino'
  }
}

/**
 * Lo que hace, en el idioma de la interfaz.
 *
 * La simulación guarda la frase en español, que es también la clave del
 * diccionario; sólo dos frases llevan el sitio dentro y se traducen por partes.
 */
export function doingLabel(doing: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const via = /^de camino a (.+)$/.exec(doing)
  if (via) return t('house.onTheWay', { place: t(via[1]) })
  const sweep = /^barriendo (.+)$/.exec(doing)
  if (sweep) return t('house.sweeping', { place: t(sweep[1]) })
  return t(doing)
}

/** Reparto estable: a cada vecino su sitio, sin que dos se peguen por uno. */
function assignSpots(dwellers: Dweller[], working: Set<string>): Map<string, { spot: Spot; shift: number }> {
  const out = new Map<string, { spot: Spot; shift: number }>()
  const used = new Map<string, number>()

  // Primero los que ya tenían sitio: así nadie se levanta del sofá porque
  // haya entrado otro por la puerta.
  const orden = [...dwellers].sort((a, b) => (a.spotId ? 0 : 1) - (b.spotId ? 0 : 1))

  for (const d of orden) {
    const quiere = working.has(d.key)
    const pool = quiere ? WORK_SPOTS : REST_SPOTS
    const tenia = spotById(d.spotId)

    let spot: Spot | undefined
    if (tenia && tenia.work === quiere && !used.has(tenia.id)) spot = tenia
    if (!spot) spot = pool.find((s) => !used.has(s.id))
    if (!spot) spot = pool[hash(d.key) % pool.length]

    const n = used.get(spot.id) ?? 0
    used.set(spot.id, n + 1)
    out.set(d.key, { spot, shift: n === 0 ? 0 : n % 2 === 1 ? 18 * Math.ceil(n / 2) : -18 * (n / 2) })
  }
  return out
}

/** Los que están parados, que para los demás son un estorbo que rodear. */
const parados = (all: Dweller[], yo: Dweller): Pt[] =>
  all.filter((o) => o !== yo && o.state === 'quieto' && !o.route.length).map((o) => ({ x: o.x, y: o.y }))

/** Poner rumbo a un sitio: levantarse si hace falta y buscar el camino. */
function trip(d: Dweller, to: Pt, target: Spot | undefined, shift: number, all: Dweller[]): void {
  const left = spotById(d.at)
  d.route = planRoute(
    { x: d.x, y: d.y },
    left ? { spot: left, shift: d.atShift } : undefined,
    to,
    target,
    shift,
    parados(all, d)
  )
  d.patrolling = false
  if (left && POSTURE[left.activity] && d.settle > 0) {
    d.rising = true
  } else {
    d.rising = false
    d.at = undefined
    d.activity = 'andar'
  }
}

/** En un sitio para sentarse, el cuerpo va de la entrada al asiento según se sienta. */
function seat(d: Dweller, s: Spot, shift: number): void {
  if (!s.from) return
  const k = s.activity === 'cama' || s.activity === 'tumbona' ? Math.min(1, d.settle / 0.6) : d.settle
  const e = k * k * (3 - 2 * k)
  d.x = s.from.x + shift + (s.x - s.from.x) * e
  d.y = s.from.y + (s.y - s.from.y) * e
}

/** Cuánto se queda en cada punto de su faena. */
function pauseLen(d: Dweller, a: Activity): number {
  if (a === 'canasta') return SHOT
  const r = (hash(d.key + ':' + d.patrolIdx + ':' + Math.floor(d.clock)) % 100) / 100
  return 2.4 + r * 2.2
}

/**
 * Ajusta la población a lo que hay de verdad y la mueve un rato.
 *
 * `residents` son los que viven aquí siempre; `jobs` las tareas en marcha. La
 * primera tarea de cada vecino la hace él; por cada tarea de más llega una
 * copia por la calle, y esa copia se va cuando su tarea desaparece.
 */
export function stepHouse(
  st: HouseState,
  dt: number,
  residents: Resident[],
  jobs: Job[],
  first: boolean
): HouseState {
  const alive = new Set<string>()
  const working = new Set<string>()

  const byResident = new Map<string, Job[]>()
  for (const j of jobs) {
    if (!residents.some((r) => r.id === j.residentId)) continue
    const list = byResident.get(j.residentId) ?? []
    list.push(j)
    byResident.set(j.residentId, list)
  }

  for (const r of residents) {
    alive.add(r.id)
    const list = byResident.get(r.id) ?? []
    if (list.length) working.add(r.id)
    for (const extra of list.slice(1)) {
      const key = r.id + '#' + extra.id
      alive.add(key)
      working.add(key)
    }
  }

  const dwellers = [...st.dwellers]

  // Altas.
  for (const key of alive) {
    if (dwellers.some((d) => d.key === key)) continue
    const clone = key.includes('#')
    const residentId = clone ? key.slice(0, key.indexOf('#')) : key
    // Los de toda la vida ya están dentro al abrir la pantalla; el que llega
    // después —y toda copia— viene andando por la calle.
    const yaEstaba = first && !clone
    // Si llegan varios a la vez, vienen en fila y no uno encima de otro.
    const enCalle = dwellers.filter((d) => d.state === 'entrando' && d.x > WORLD.w - 30).length
    dwellers.push(
      makeDweller(key, {
        residentId,
        clone,
        x: STREET.x + enCalle * 16,
        state: yaEstaba ? 'quieto' : 'entrando',
        doing: yaEstaba ? 'en casa' : 'llegando a casa',
        placed: !yaEstaba
      })
    )
  }

  // Bajas: quien ya no pinta nada se va por donde vino.
  for (const d of dwellers) {
    if (alive.has(d.key) || d.state === 'saliendo') continue
    d.state = 'saliendo'
    d.spotId = undefined
    d.doing = 'se marcha'
    trip(d, STREET, undefined, 0, dwellers)
  }

  const spots = assignSpots(dwellers.filter((d) => d.state !== 'saliendo'), working)

  for (const d of dwellers) {
    d.clock += dt

    if (d.state === 'saliendo') {
      move(d, dt, dwellers)
      continue
    }

    const want = spots.get(d.key)
    if (want) {
      const destino = { x: want.spot.x + want.shift, y: want.spot.y }
      if (!d.placed) {
        d.placed = true
        d.x = destino.x
        d.y = destino.y
        d.spotId = d.at = want.spot.id
        d.shift = d.atShift = want.shift
        d.activity = want.spot.activity
        d.dir = want.spot.dir
        d.settle = 1
        d.state = 'quieto'
        d.doing = doingText(want.spot.activity, want.spot.place)
        d.patrolIdx = -1
        d.pauseAt = d.clock
        d.pauseFor = pauseLen(d, want.spot.activity)
      } else if (d.spotId !== want.spot.id || d.shift !== want.shift) {
        d.spotId = want.spot.id
        d.shift = want.shift
        if (d.at === want.spot.id && d.atShift === want.shift) {
          // Ya estaba ahí (o levantándose de ahí): se queda como está.
          d.route = []
          d.rising = false
          d.patrolling = false
          d.state = 'quieto'
          d.doing = doingText(want.spot.activity, want.spot.place)
        } else {
          trip(d, destino, want.spot, want.shift, dwellers)
          if (d.state !== 'entrando') d.state = 'andando'
          d.doing = 'de camino a ' + want.spot.place
        }
      }
    }

    const iba = d.route.length > 0
    move(d, dt, dwellers)
    if (iba && !d.route.length) arrive(d)
    if (d.state === 'quieto') idle(d, dt, working.has(d.key), dwellers)
  }

  // La puerta se abre al acercarse alguien que va de paso, y se cierra sola.
  const cerca = dwellers.some(
    (d) => d.route.length > 0 && Math.abs(d.x - FRONT_DOOR.x) < 28 && Math.abs(d.y - FRONT_DOOR.y) < 22
  )
  const door = Math.max(0, Math.min(1, st.door + (cerca ? dt * 4 : -dt * 1.5)))

  return { dwellers: dwellers.filter((d) => d.state !== 'saliendo' || d.route.length > 0), door }
}

/** Ha llegado al final del camino. */
function arrive(d: Dweller): void {
  d.speed = 0
  if (d.state === 'saliendo') return
  const s = spotById(d.spotId)
  if (d.patrolling) {
    d.patrolling = false
    const p = s?.patrol?.[d.patrolIdx]
    if (p) d.dir = p.dir
    d.pauseAt = d.clock
    d.pauseFor = pauseLen(d, d.activity)
    return
  }
  d.state = 'quieto'
  if (!s) {
    d.doing = 'por ahí'
    return
  }
  d.at = s.id
  d.atShift = d.shift
  d.activity = s.activity
  d.dir = s.dir
  d.settle = 0
  d.doing = doingText(s.activity, s.place)
  d.patrolIdx = -1
  d.pauseAt = d.clock
  d.pauseFor = pauseLen(d, s.activity)
}

/** Lo que hace el que está en su sitio: acomodarse, moverse por la faena, mirar. */
function idle(d: Dweller, dt: number, trabaja: boolean, all: Dweller[]): void {
  const s = spotById(d.at)
  if (!d.route.length) {
    const lento = s && POSTURE[s.activity] === 'tumbado'
    d.settle = Math.min(1, d.settle + dt / (lento ? LIE : SIT))
  }
  if (!s) return

  if (POSTURE[s.activity]) seat(d, s, d.atShift)

  // En el agua no se está quieto: se deja llevar despacio alrededor de su sitio.
  if (s.activity === 'flotar' && !d.route.length) {
    const h = hash(d.key) % 628
    const tx = s.x + d.atShift + Math.sin(d.clock * 0.19 + h) * 10 * d.settle
    const ty = s.y + Math.sin(d.clock * 0.13 + h * 1.7) * 6 * d.settle
    d.x += (tx - d.x) * Math.min(1, dt * 1.5)
    d.y += (ty - d.y) * Math.min(1, dt * 1.5)
  }

  // Las faenas que se hacen de un sitio a otro.
  if (s.patrol && !d.route.length && d.clock - d.pauseAt > d.pauseFor) {
    d.patrolIdx = (d.patrolIdx + 1) % s.patrol.length
    const p = s.patrol[d.patrolIdx]
    const destino = { x: p.x + d.atShift, y: p.y }
    d.route = findPath({ x: d.x, y: d.y }, walkable(destino) ? destino : nearestWalkable(destino), []) ?? [destino]
    d.patrolling = true
  }

  // Sentado o de pie sin hacer nada, de vez en cuando se gira a mirar.
  if (!d.route.length && (s.activity === 'sofa' || s.activity === 'leer' || s.activity === 'arcade' || s.activity === 'futbolin' || s.activity === 'tumbona') && d.clock > d.glanceAt) {
    const h = hash(d.key + Math.floor(d.clock))
    d.glanceDir = h % 2 ? 'izq' : 'der'
    d.glanceUntil = d.clock + 1 + (h % 10) / 10
    d.glanceAt = d.clock + 6 + (h % 11)
  }

  // Los que descansan cambian de sitio de vez en cuando: una casa donde
  // nadie se mueve no parece una casa.
  if (!trabaja && !d.patrolling && !d.route.length && d.clock > d.wanderAt) {
    d.wanderAt = d.clock + 24 + (hash(d.key + Math.floor(d.clock)) % 36)
    const libres = REST_SPOTS.filter((x) => x.id !== d.spotId)
    const s2 = libres[hash(d.key + d.clock.toFixed(0)) % libres.length]
    if (s2) {
      d.spotId = s2.id
      d.shift = 0
      trip(d, { x: s2.x, y: s2.y }, s2, 0, all)
      d.state = 'andando'
      d.doing = 'de camino a ' + s2.place
    }
  }
}

/** Largo de lo que queda de camino. */
function remaining(d: Dweller): number {
  let total = 0
  let px = d.x
  let py = d.y
  for (const p of d.route) {
    total += Math.hypot(p.x - px, p.y - py)
    px = p.x
    py = p.y
  }
  return total
}

/** Cara hacia la que anda, sin parpadear cuando va en diagonal. */
function facing(d: Dweller, dx: number, dy: number): void {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  const deLado = d.dir === 'izq' || d.dir === 'der'
  const horizontal = deLado ? ay <= ax * 1.3 : ax > ay * 1.3
  d.dir = horizontal ? (dx > 0 ? 'der' : 'izq') : dy > 0 ? 'abajo' : 'arriba'
}

/**
 * Quien va delante estorba: si va hacia el mismo lado se le sigue a su paso;
 * si viene de frente, cada uno se aparta a su derecha; si está parado, se le
 * rodea. Devuelve la velocidad máxima que deja.
 */
function giveWay(d: Dweller, all: Dweller[], hx: number, hy: number, cruise: number, dt: number): number {
  if (d.clock < d.ghostUntil) return cruise
  let limite = cruise
  for (const o of all) {
    if (o === d) continue
    const rx = o.x - d.x
    const ry = o.y - d.y
    const dist = Math.hypot(rx, ry)
    if (dist > 15 || dist < 0.01) continue
    const along = (rx * hx + ry * hy) / dist
    if (along < 0.55) continue

    const anda = o.route.length > 0 && o.speed > 3
    let apartarse = 0
    if (!anda) {
      // Parado en medio: se le rodea por el lado que quede libre.
      apartarse = hx * ry - hy * rx > 0 ? -1 : 1
      limite = Math.min(limite, dist < 9 ? cruise * 0.35 : cruise * 0.7)
    } else {
      const o0 = o.route[0]
      const ol = Math.hypot(o0.x - o.x, o0.y - o.y) || 1
      const mismo = ((o0.x - o.x) * hx + (o0.y - o.y) * hy) / ol
      if (mismo > 0.4) {
        limite = Math.min(limite, dist < 11 ? o.speed * 0.9 : cruise)
      } else {
        apartarse = 1
        if (mismo > -0.4 && hash(d.key) < hash(o.key)) limite = Math.min(limite, cruise * 0.2)
        else limite = Math.min(limite, cruise * 0.6)
      }
    }
    if (apartarse) {
      // La derecha de quien anda hacia (hx, hy), con la y hacia abajo.
      const nx = -hy * apartarse
      const ny = hx * apartarse
      const q = { x: d.x + nx * 20 * dt, y: d.y + ny * 20 * dt }
      if (walkable(q) && clearLine(q, d.route[0], [])) {
        d.x = q.x
        d.y = q.y
      }
    }
  }
  return limite
}

/** Un paso por el camino pendiente, arrancando y frenando como una persona. */
function move(d: Dweller, dt: number, all: Dweller[]): void {
  if (!d.route.length) {
    d.speed = 0
    return
  }

  if (d.rising) {
    const s = spotById(d.at)
    d.settle = Math.max(0, d.settle - dt / RISE)
    if (s) seat(d, s, d.atShift)
    if (d.settle > 0) return
    d.rising = false
    d.at = undefined
    d.activity = 'andar'
  }

  const prisa = d.state === 'entrando' || d.state === 'saliendo' ? 1.2 : 1
  const cruise = d.patrolling ? PATROL_SPEED : d.cruise * prisa
  const next = d.route[0]
  const hl = Math.hypot(next.x - d.x, next.y - d.y) || 1
  const hx = (next.x - d.x) / hl
  const hy = (next.y - d.y) / hl

  // Frena a tiempo para pararse justo en el sitio, sin pasarse ni arrastrarse.
  let want = Math.min(cruise, Math.sqrt(2 * DECEL * remaining(d)) + 8)
  want = Math.min(want, giveWay(d, all, hx, hy, cruise, dt))
  d.speed += Math.max(-DECEL * dt, Math.min(ACCEL * dt, want - d.speed))

  if (d.speed < 4) {
    d.stuck += dt
    if (d.stuck > 1.6) {
      d.ghostUntil = d.clock + 1.2
      d.stuck = 0
    }
  } else {
    d.stuck = 0
  }

  let left = d.speed * dt
  while (left > 0 && d.route.length) {
    const p = d.route[0]
    const dx = p.x - d.x
    const dy = p.y - d.y
    const dist = Math.hypot(dx, dy)
    // En las esquinas se recorta un poco, como hace cualquiera al girar,
    // salvo que el atajo roce una pared o un mueble.
    if (d.route.length > 1 && dist < 3 && clearLine({ x: d.x, y: d.y }, d.route[1], [])) {
      d.route.shift()
      continue
    }
    if (dist <= left) {
      d.x = p.x
      d.y = p.y
      d.walked += dist
      left -= dist
      d.route.shift()
    } else {
      d.x += (dx / dist) * left
      d.y += (dy / dist) * left
      d.walked += left
      facing(d, dx, dy)
      left = 0
    }
  }
}

/** Los sitios en los que hay alguien ya acomodado: para encender la tele o el fuego. */
export function busySpots(st: HouseState): Set<string> {
  const out = new Set<string>()
  for (const d of st.dwellers) {
    if (d.at && !d.rising && d.settle > 0.5) out.add(d.at)
  }
  return out
}
