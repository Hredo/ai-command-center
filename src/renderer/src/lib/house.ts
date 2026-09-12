/**
 * La Casa: el plano en planta, los sitios y el vaivén de los vecinos.
 *
 * Aquí no se pinta nada. Esto es lo otro: por dónde se puede andar, dónde
 * están las puertas, en qué punto exacto se cocina o se duerme, y cómo se va
 * uno de la cocina a la cancha sin atravesar tabiques. El dibujo vive en
 * `lib/pixelArt.ts` y lee estas mismas coordenadas.
 *
 * La vista es de tres cuartos, como la de los juegos de granja: se mira la
 * casa desde arriba y un poco de frente, así que de cada pared se ve la cara
 * y el suelo se extiende hacia abajo. Las habitaciones son rectángulos y se
 * comunican por huecos concretos, de modo que ir de una a otra es buscar el
 * camino por ese grafo de puertas y después andar en línea recta por dentro.
 *
 * Reglas de la casa:
 *
 * - Vive uno de cada IA que la aplicación detecta: cada agente de consola,
 *   cada modelo local y cada proveedor por API con llave.
 * - Si no tiene trabajo, descansa: sofá, cama, piscina, canasta, recreativa.
 * - Si le mandas faena, se levanta y hace algo de la casa.
 * - Si le mandas dos cosas a la vez, entra por la puerta otro vecino idéntico
 *   y se marcha en cuanto esa segunda tarea termina.
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
  // El exterior va en ele alrededor de la casa, y son dos piezas para que
  // dentro de cada una se pueda ir en línea recta sin cortar por la esquina.
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

/** En qué habitación cae un punto. */
export function roomAt(p: Pt): Room {
  for (const r of ROOMS) {
    if (p.x >= r.box.x && p.x <= r.box.x + r.box.w && p.y >= r.box.y && p.y <= r.box.y + r.box.h) return r
  }
  return roomById('jardin')
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
  /** Recorrido de `a` hasta `b`; al revés se da la vuelta. */
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

/** Justo fuera de la puerta de la calle: por aquí se llega y por aquí se va. */
export const DOOR: Pt = { x: 580, y: 420 }

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
}

export const WORK_SPOTS: Spot[] = [
  { id: 'w-fogones', room: 'cocina', place: 'la cocina', x: 72, y: 108, dir: 'arriba', activity: 'cocinar', work: true },
  { id: 'w-fregadero', room: 'cocina', place: 'el fregadero', x: 140, y: 108, dir: 'arriba', activity: 'fregar', work: true },
  { id: 'w-barrer', room: 'salon', place: 'el salón', x: 224, y: 232, dir: 'abajo', activity: 'barrer', work: true },
  { id: 'w-polvo', room: 'salon', place: 'la estantería', x: 336, y: 108, dir: 'arriba', activity: 'desempolvar', work: true },
  { id: 'w-mesa1', room: 'despacho', place: 'el despacho', x: 408, y: 110, dir: 'arriba', activity: 'teclear', work: true },
  { id: 'w-mesa2', room: 'despacho', place: 'el despacho', x: 456, y: 110, dir: 'arriba', activity: 'teclear', work: true },
  { id: 'w-mesa3', room: 'despacho', place: 'el despacho', x: 504, y: 110, dir: 'arriba', activity: 'teclear', work: true },
  { id: 'w-cama', room: 'dormitorio', place: 'el dormitorio', x: 134, y: 356, dir: 'izq', activity: 'hacer-cama', work: true },
  { id: 'w-recoger', room: 'juegos', place: 'la sala de juegos', x: 336, y: 446, dir: 'abajo', activity: 'recoger', work: true },
  { id: 'w-regar', room: 'jardin', place: 'el jardín', x: 628, y: 340, dir: 'izq', activity: 'regar', work: true },
  { id: 'w-piscina', room: 'jardin', place: 'la piscina', x: 564, y: 132, dir: 'der', activity: 'limpiar-piscina', work: true }
]

export const REST_SPOTS: Spot[] = [
  { id: 'r-sofa1', room: 'salon', place: 'el sofá', x: 240, y: 174, dir: 'abajo', activity: 'sofa', work: false },
  { id: 'r-sofa2', room: 'salon', place: 'el sofá', x: 274, y: 174, dir: 'abajo', activity: 'sofa', work: false },
  { id: 'r-cama', room: 'dormitorio', place: 'la cama', x: 76, y: 352, dir: 'abajo', activity: 'cama', work: false },
  { id: 'r-leer', room: 'dormitorio', place: 'la butaca', x: 152, y: 444, dir: 'abajo', activity: 'leer', work: false },
  { id: 'r-arcade', room: 'juegos', place: 'la recreativa', x: 226, y: 336, dir: 'arriba', activity: 'arcade', work: false },
  { id: 'r-futbolin', room: 'juegos', place: 'el futbolín', x: 296, y: 370, dir: 'abajo', activity: 'futbolin', work: false },
  { id: 'r-futbolin2', room: 'juegos', place: 'el futbolín', x: 296, y: 432, dir: 'arriba', activity: 'futbolin', work: false },
  { id: 'r-tumbona', room: 'jardin', place: 'la tumbona', x: 592, y: 274, dir: 'abajo', activity: 'tumbona', work: false },
  { id: 'r-flota1', room: 'jardin', place: 'la piscina', x: 618, y: 128, dir: 'abajo', activity: 'flotar', work: false },
  { id: 'r-flota2', room: 'jardin', place: 'la piscina', x: 700, y: 160, dir: 'abajo', activity: 'flotar', work: false },
  { id: 'r-canasta', room: 'patio', place: 'la cancha', x: 280, y: 584, dir: 'arriba', activity: 'canasta', work: false },
  { id: 'r-banquillo', room: 'patio', place: 'la cancha', x: 154, y: 600, dir: 'der', activity: 'canasta', work: false }
]

export const ALL_SPOTS = [...WORK_SPOTS, ...REST_SPOTS]

export function spotById(id: string | undefined): Spot | undefined {
  return id ? ALL_SPOTS.find((s) => s.id === id) : undefined
}

/* ------------------------------------------------------------------ *
 * Caminos                                                            *
 * ------------------------------------------------------------------ */

const VECINAS = new Map<string, { to: string; door: Door; dir: 1 | -1 }[]>()
for (const d of DOORS) {
  if (!VECINAS.has(d.a)) VECINAS.set(d.a, [])
  if (!VECINAS.has(d.b)) VECINAS.set(d.b, [])
  VECINAS.get(d.a)!.push({ to: d.b, door: d, dir: 1 })
  VECINAS.get(d.b)!.push({ to: d.a, door: d, dir: -1 })
}

/** La cadena de puertas más corta entre dos habitaciones. */
function roomPath(from: string, to: string): { door: Door; dir: 1 | -1 }[] | null {
  if (from === to) return []
  const visto = new Set([from])
  const cola: { room: string; via: { door: Door; dir: 1 | -1 }[] }[] = [{ room: from, via: [] }]
  while (cola.length) {
    const cur = cola.shift()!
    for (const n of VECINAS.get(cur.room) ?? []) {
      if (visto.has(n.to)) continue
      const via = [...cur.via, { door: n.door, dir: n.dir }]
      if (n.to === to) return via
      visto.add(n.to)
      cola.push({ room: n.to, via })
    }
  }
  return null
}

/**
 * El camino de un punto a otro: se cruzan las puertas que hagan falta y
 * dentro de cada habitación se va en línea recta, que para un rectángulo
 * vacío no hace falta más.
 */
export function routeTo(from: Pt, to: Pt): Pt[] {
  const a = roomAt(from)
  const b = roomAt(to)
  const via = roomPath(a.id, b.id)
  const out: Pt[] = []
  if (via) {
    for (const paso of via) {
      const pts = paso.dir === 1 ? paso.door.pts : [...paso.door.pts].reverse()
      for (const p of pts) out.push({ ...p })
    }
  }
  out.push({ ...to })
  return out
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
  state: DwellerState
  route: Pt[]
  spotId?: string
  activity: Activity
  /** 0 invisible, 1 del todo. */
  fade: number
  /** Apartado a un lado cuando dos comparten sitio. */
  shift: number
  doing: string
  /** Cuándo le toca cambiar de sitio de descanso. */
  wanderAt: number
  /** false mientras no se le haya dado su primer sitio. */
  placed: boolean
}

export interface HouseState {
  dwellers: Dweller[]
}

export function emptyHouse(): HouseState {
  return { dwellers: [] }
}

/** Píxeles del mundo por segundo. */
const SPEED = 54
const FADE_SPEED = 2.2

export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
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

/**
 * Ajusta la población a lo que hay de verdad y la mueve un rato.
 *
 * `residents` son los que viven aquí siempre; `jobs` las tareas en marcha. La
 * primera tarea de cada vecino la hace él; por cada tarea de más entra una
 * copia por la puerta, y esa copia se va cuando su tarea desaparece.
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
    // después —y toda copia— entra por la puerta de la calle.
    const yaEstaba = first && !clone
    dwellers.push({
      key,
      residentId,
      clone,
      x: DOOR.x + 26,
      y: DOOR.y,
      dir: 'izq',
      clock: (hash(key) % 1000) / 100,
      walked: 0,
      state: yaEstaba ? 'quieto' : 'entrando',
      route: [],
      activity: 'andar',
      fade: yaEstaba ? 1 : 0,
      shift: 0,
      doing: yaEstaba ? 'en casa' : 'llegando a casa',
      wanderAt: 14 + (hash(key) % 30),
      placed: !yaEstaba
    })
  }

  // Bajas: quien ya no pinta nada se va por la puerta.
  for (const d of dwellers) {
    if (alive.has(d.key) || d.state === 'saliendo') continue
    d.state = 'saliendo'
    d.spotId = undefined
    d.activity = 'andar'
    d.doing = 'se marcha'
    d.route = routeTo({ x: d.x, y: d.y }, { x: DOOR.x + 34, y: DOOR.y })
  }

  const spots = assignSpots(dwellers.filter((d) => d.state !== 'saliendo'), working)

  for (const d of dwellers) {
    d.clock += dt

    if (d.state === 'saliendo') {
      d.fade = Math.max(0, d.fade - dt * FADE_SPEED)
      advance(d, dt)
      continue
    }

    d.fade = Math.min(1, d.fade + dt * FADE_SPEED)

    const want = spots.get(d.key)
    if (want) {
      const destino = { x: want.spot.x + want.shift, y: want.spot.y }
      if (!d.placed) {
        d.placed = true
        d.x = destino.x
        d.y = destino.y
        d.spotId = want.spot.id
        d.shift = want.shift
        d.activity = want.spot.activity
        d.dir = want.spot.dir
        d.doing = doingText(want.spot.activity, want.spot.place)
      } else if (d.spotId !== want.spot.id || d.shift !== want.shift) {
        d.spotId = want.spot.id
        d.shift = want.shift
        if (Math.hypot(d.x - destino.x, d.y - destino.y) < 3) {
          d.route = []
          d.state = 'quieto'
          d.activity = want.spot.activity
          d.dir = want.spot.dir
          d.doing = doingText(want.spot.activity, want.spot.place)
        } else {
          d.route = routeTo({ x: d.x, y: d.y }, destino)
          if (d.state !== 'entrando') d.state = 'andando'
          d.activity = 'andar'
          d.doing = 'de camino a ' + want.spot.place
        }
      }
    }

    const iba = d.route.length > 0
    advance(d, dt)

    if (iba && d.route.length === 0) {
      const s = spotById(d.spotId)
      d.state = 'quieto'
      d.activity = s?.activity ?? 'andar'
      d.doing = s ? doingText(s.activity, s.place) : 'por ahí'
      if (s) d.dir = s.dir
    }

    // Los que descansan cambian de sitio de vez en cuando: una casa donde
    // nadie se mueve no parece una casa.
    if (d.state === 'quieto' && !working.has(d.key) && d.clock > d.wanderAt) {
      d.wanderAt = d.clock + 24 + (hash(d.key + Math.floor(d.clock)) % 36)
      const libres = REST_SPOTS.filter((s) => s.id !== d.spotId)
      const s = libres[hash(d.key + d.clock.toFixed(0)) % libres.length]
      if (s) {
        d.spotId = s.id
        d.shift = 0
        d.route = routeTo({ x: d.x, y: d.y }, { x: s.x, y: s.y })
        d.state = 'andando'
        d.activity = 'andar'
        d.doing = 'de camino a ' + s.place
      }
    }
  }

  return { dwellers: dwellers.filter((d) => d.state !== 'saliendo' || d.fade > 0) }
}

/** Un paso de andar por la ruta pendiente. */
function advance(d: Dweller, dt: number): void {
  let left = dt * SPEED
  while (left > 0 && d.route.length) {
    const next = d.route[0]
    const dx = next.x - d.x
    const dy = next.y - d.y
    const dist = Math.hypot(dx, dy)
    if (dist <= left || dist < 0.4) {
      d.x = next.x
      d.y = next.y
      d.walked += dist
      left -= dist
      d.route.shift()
    } else {
      d.x += (dx / dist) * left
      d.y += (dy / dist) * left
      d.walked += left
      d.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'der' : 'izq') : dy > 0 ? 'abajo' : 'arriba'
      left = 0
    }
  }
}
