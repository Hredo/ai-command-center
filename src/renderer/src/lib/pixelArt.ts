/**
 * El dibujo de La Casa, píxel a píxel.
 *
 * Todo se pinta en un lienzo pequeño —768 por 640 puntos— y después se
 * agranda por un número entero con el suavizado apagado. Ese es el truco de
 * los juegos de píxeles: si se agranda por 3, cada punto del dibujo son nueve
 * píxeles de pantalla cuadrados y limpios; si se agrandara por 2,7 saldría
 * todo borroso. Por eso aquí nada tiene decimales.
 *
 * La vista es de tres cuartos: de cada pared se ve la cara de frente y el
 * suelo se va hacia abajo. La profundidad sale de tres cosas: las paredes
 * tienen altura, los muebles tienen frente y sombra, y los vecinos se pintan
 * ordenados por su posición, de modo que quien está más abajo tapa a quien
 * está más arriba.
 *
 * Los vecinos son adultos: cabeza de un tercio del alto y piernas largas, no
 * cabezones de dibujo infantil.
 */
import {
  DOORS, HOOP, HOUSE, POOL, POSTURE, ROOMS, WALL_H, WORLD,
  hash, roomById, waterDepth,
  type Dir, type Dweller, type Pt, type Rect
} from './house'

type Ctx = CanvasRenderingContext2D

/** Un rectángulo de puntos, siempre en enteros. */
function R(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  if (w <= 0 || h <= 0) return
  c.fillStyle = col
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

/* ------------------------------------------------------------------ *
 * Paleta                                                             *
 * ------------------------------------------------------------------ */

const C = {
  fuera: '#16202b',
  hierba: '#3f6f4a',
  hierba2: '#38653f',
  hierba3: '#476f4b',
  tierra: '#7d6242',
  camino: '#9a8564',
  camino2: '#8a7556',
  agua: '#3f9fc4',
  agua2: '#2f86ae',
  aguaLuz: '#7fd3ea',
  bordillo: '#c9cfd6',
  bordillo2: '#a3abb5',
  pista: '#5a6472',
  pista2: '#4e5866',
  linea: '#cdd6e4',
  muro: '#5b4334',
  muroLuz: '#6d5140',
  muroSombra: '#43301f',
  suelo: '#9a7146',
  sueloRaya: '#85603a',
  sueloClaro: '#a97d4e',
  azulejo: '#b6ac9a',
  azulejo2: '#a1978a',
  sombra: 'rgba(12,14,22,0.34)',
  negro: '#1a1420',
  madera: '#7d5936',
  madera2: '#66462a',
  maderaLuz: '#96694198',
  metal: '#b3bcc9',
  metal2: '#8d96a4',
  blanco: '#eef2f8',
  hueso: '#d8d2c4'
}

/** Papel pintado de cada habitación: base, franja y moldura. */
const PAPEL: Record<string, [string, string, string]> = {
  cocina: ['#96775c', '#a98a6d', '#6c523d'],
  salon: ['#8a6a80', '#9d7c93', '#63465c'],
  despacho: ['#5d7894', '#6f8aa6', '#3f5570'],
  dormitorio: ['#75689c', '#8779ae', '#4f4471'],
  juegos: ['#5e7d88', '#70909b', '#405a64'],
  recibidor: ['#7b7059', '#8d8269', '#564d3b']
}

/* ------------------------------------------------------------------ *
 * Suelos y paredes                                                   *
 * ------------------------------------------------------------------ */

function tablas(c: Ctx, r: Rect): void {
  R(c, r.x, r.y, r.w, r.h, C.suelo)
  for (let y = r.y; y < r.y + r.h; y += 8) {
    R(c, r.x, y, r.w, 1, C.sueloRaya)
    // Juntas alternas, para que no parezca papel pintado.
    const off = ((y / 8) % 2) * 24
    for (let x = r.x + off; x < r.x + r.w; x += 48) R(c, x, y, 1, 8, C.sueloRaya)
  }
  // Un poco de luz junto a la pared.
  R(c, r.x, r.y, r.w, 2, C.sueloClaro)
}

function baldosas(c: Ctx, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y += 8) {
    for (let x = r.x; x < r.x + r.w; x += 8) {
      const par = ((x / 8 + y / 8) | 0) % 2 === 0
      R(c, x, y, 8, 8, par ? C.azulejo : C.azulejo2)
    }
  }
}

function pared(c: Ctx, id: string, box: Rect): void {
  const [base, franja, molde] = PAPEL[id] ?? PAPEL.recibidor
  R(c, box.x, box.y, box.w, WALL_H, base)
  // Moldura de arriba y raya de media altura.
  R(c, box.x, box.y, box.w, 3, molde)
  R(c, box.x, box.y + 3, box.w, 1, franja)
  R(c, box.x, box.y + WALL_H - 8, box.w, 2, franja)
  // Rodapié.
  R(c, box.x, box.y + WALL_H - 6, box.w, 6, molde)
  R(c, box.x, box.y + WALL_H - 6, box.w, 1, franja)
  // Sombra que proyecta la pared sobre el suelo: esto es lo que da el relieve.
  R(c, box.x, box.y + WALL_H, box.w, 3, 'rgba(20,16,28,0.30)')
  R(c, box.x, box.y + WALL_H + 3, box.w, 2, 'rgba(20,16,28,0.16)')
}

function ventana(c: Ctx, x: number, y: number): void {
  R(c, x - 1, y - 1, 28, 22, C.muroSombra)
  R(c, x, y, 26, 20, '#2b4668')
  R(c, x + 1, y + 1, 24, 9, '#3d6390')
  R(c, x + 12, y, 2, 20, C.hueso)
  R(c, x, y + 9, 26, 2, C.hueso)
  R(c, x - 2, y + 19, 30, 3, C.hueso)
}

/* ------------------------------------------------------------------ *
 * Muebles pegados a la pared (se pintan en el fondo)                 *
 * ------------------------------------------------------------------ */

function cocinaMuebles(c: Ctx, box: Rect): void {
  const suelo = box.y + WALL_H

  // alacenas colgadas
  R(c, box.x + 12, box.y + 10, 56, 24, C.madera)
  R(c, box.x + 12, box.y + 10, 56, 3, C.maderaLuz)
  R(c, box.x + 39, box.y + 10, 2, 24, C.madera2)
  R(c, box.x + 34, box.y + 24, 3, 3, C.hueso)
  R(c, box.x + 43, box.y + 24, 3, 3, C.hueso)
  // campana
  R(c, box.x + 22, box.y + 34, 36, 6, C.metal2)
  R(c, box.x + 26, box.y + 30, 28, 4, C.metal)

  // encimera
  R(c, box.x + 8, suelo - 12, 120, 24, C.madera)
  R(c, box.x + 8, suelo - 12, 120, 4, C.metal)
  R(c, box.x + 8, suelo + 10, 120, 2, C.muroSombra)
  for (let x = box.x + 30; x < box.x + 126; x += 28) R(c, x, suelo - 6, 1, 16, C.madera2)
  // fogones
  R(c, box.x + 26, suelo - 11, 26, 3, '#2a2530')
  // Los fuegos se pintan apagados: sólo arden si alguien cocina.
  R(c, box.x + 28, suelo - 11, 8, 2, '#3a3440')
  R(c, box.x + 42, suelo - 11, 8, 2, '#3a3440')
  // fregadero
  R(c, box.x + 92, suelo - 11, 24, 3, C.metal2)
  R(c, box.x + 102, suelo - 18, 2, 7, C.metal)
  R(c, box.x + 102, suelo - 18, 7, 2, C.metal)

  // nevera
  R(c, box.x + 132, box.y + 14, 24, 62, C.metal)
  R(c, box.x + 132, box.y + 14, 24, 3, C.blanco)
  R(c, box.x + 132, box.y + 40, 24, 2, C.metal2)
  R(c, box.x + 150, box.y + 30, 2, 8, C.metal2)
  R(c, box.x + 150, box.y + 46, 2, 8, C.metal2)
  R(c, box.x + 136, box.y + 20, 6, 5, '#f0c860')
  R(c, box.x + 132, box.y + 76, 24, 3, C.sombra)
}

function salonMuebles(c: Ctx, box: Rect): void {
  const suelo = box.y + WALL_H

  // televisión colgada
  R(c, box.x + 14, box.y + 12, 46, 28, '#20222c')
  R(c, box.x + 17, box.y + 15, 40, 22, '#2e5a86')
  R(c, box.x + 19, box.y + 17, 16, 8, '#4a86bd')
  R(c, box.x + 32, box.y + 40, 10, 4, '#20222c')

  // estantería
  R(c, box.x + 112, box.y + 8, 48, 32 + WALL_H - 40, C.madera)
  R(c, box.x + 112, box.y + 8, 48, 3, C.maderaLuz)
  for (const y of [box.y + 24, box.y + 40]) R(c, box.x + 114, y, 44, 2, C.madera2)
  const libros = ['#c4574f', '#4f86c4', '#d8a94a', '#61b071', '#b06fc4']
  for (let i = 0; i < 7; i++) {
    R(c, box.x + 117 + i * 6, box.y + 12, 4, 12, libros[i % libros.length])
  }
  for (let i = 0; i < 5; i++) {
    R(c, box.x + 119 + i * 7, box.y + 28, 5, 12, libros[(i + 2) % libros.length])
  }
  R(c, box.x + 112, suelo, 48, 3, C.sombra)

  // alfombra bajo la mesita
  R(c, box.x + 24, suelo + 86, 88, 48, '#7b4a55')
  R(c, box.x + 28, suelo + 90, 80, 40, '#8c5661')
  R(c, box.x + 38, suelo + 98, 60, 24, '#7b4a55')
}

function despachoMuebles(c: Ctx, box: Rect): void {
  for (let i = 0; i < 3; i++) {
    const x = box.x + 24 + i * 48
    // monitor colgado de la pared
    R(c, x, box.y + 12, 28, 20, '#20222c')
    R(c, x + 2, box.y + 14, 24, 15, '#2f5f8f')
    R(c, x + 4, box.y + 16, 9, 5, '#63a2d8')
    R(c, x + 11, box.y + 32, 6, 4, '#20222c')
    R(c, x + 5, box.y + 36, 18, 3, C.sombra)
  }
  // corcho con notas
  R(c, box.x + 150, box.y + 10, 20, 26, '#8a6a4a')
  R(c, box.x + 152, box.y + 12, 16, 22, '#a2805c')
  R(c, box.x + 154, box.y + 15, 5, 5, '#f0d99a')
  R(c, box.x + 161, box.y + 22, 5, 5, '#9fd0ef')
  // alfombra en medio, que si no la habitación parece un almacén
  const suelo = box.y + WALL_H
  R(c, box.x + 30, suelo + 88, 104, 56, '#41577a')
  R(c, box.x + 34, suelo + 92, 96, 48, '#4b638a')
  R(c, box.x + 46, suelo + 102, 72, 28, '#41577a')
}

/** Las mesas del despacho: van delante, porque uno se sienta detrás. */
function mesasDespacho(c: Ctx): void {
  const box = roomById('despacho').box
  for (let i = 0; i < 3; i++) {
    const x = box.x + 24 + i * 48
    R(c, x - 6, 106, 40, 10, C.madera)
    R(c, x - 6, 106, 40, 3, C.maderaLuz)
    R(c, x - 4, 116, 5, 10, C.madera2)
    R(c, x + 27, 116, 5, 10, C.madera2)
    R(c, x + 4, 102, 22, 5, '#3b4250')
    R(c, x + 28, 103, 5, 4, '#3b4250')
    R(c, x - 6, 126, 40, 3, C.sombra)
  }
}

function dormitorioMuebles(c: Ctx, box: Rect): void {
  // armario contra la pared
  R(c, box.x + 106, box.y + 6, 44, 42, C.madera)
  R(c, box.x + 106, box.y + 6, 44, 3, C.maderaLuz)
  R(c, box.x + 127, box.y + 8, 2, 40, C.madera2)
  R(c, box.x + 122, box.y + 26, 3, 6, C.hueso)
  R(c, box.x + 131, box.y + 26, 3, 6, C.hueso)
  // cuadro
  R(c, box.x + 20, box.y + 12, 26, 20, '#6b5236')
  R(c, box.x + 22, box.y + 14, 22, 16, '#4a7f9e')
  R(c, box.x + 24, box.y + 22, 18, 8, '#6aa06b')
}

function juegosMuebles(c: Ctx, box: Rect): void {
  const suelo = box.y + WALL_H
  // diana
  R(c, box.x + 122, box.y + 12, 22, 22, '#2f3a46')
  R(c, box.x + 126, box.y + 16, 14, 14, '#d8d2c4')
  R(c, box.x + 130, box.y + 20, 6, 6, '#c4574f')
  // alfombra de juegos, pegada a la pared de la derecha
  R(c, box.x + 108, suelo + 76, 56, 66, '#3c5f6b')
  R(c, box.x + 112, suelo + 80, 48, 58, '#456d7a')
  // trastos por recoger encima
  R(c, box.x + 120, suelo + 96, 10, 10, '#d8873f')
  R(c, box.x + 136, suelo + 110, 8, 8, '#4f86c4')
  R(c, box.x + 124, suelo + 120, 12, 6, '#d8a94a')
}

function recibidorMuebles(c: Ctx, box: Rect): void {
  const suelo = box.y + WALL_H
  // perchero
  R(c, box.x + 16, box.y + 16, 3, 30, C.madera2)
  R(c, box.x + 10, box.y + 16, 15, 3, C.madera2)
  R(c, box.x + 20, box.y + 22, 8, 14, '#4f86c4')
  R(c, box.x + 8, box.y + 22, 8, 12, '#c4574f')
  // espejo
  R(c, box.x + 60, box.y + 10, 20, 28, '#8a6a4a')
  R(c, box.x + 62, box.y + 12, 16, 24, '#9db4c9')
  // felpudo delante de la puerta
  R(c, box.x + 132, suelo + 96, 34, 18, '#6b5a3c')
  R(c, box.x + 135, suelo + 99, 28, 12, '#7d6a48')
}

/* ------------------------------------------------------------------ *
 * El fondo entero                                                    *
 * ------------------------------------------------------------------ */

function hierba(c: Ctx): void {
  R(c, 0, 0, WORLD.w, WORLD.h, C.fuera)
  // El jardín rodea la casa en ele: franja derecha y franja de abajo.
  const trozos: Rect[] = [
    { x: HOUSE.x + HOUSE.w, y: 0, w: WORLD.w - (HOUSE.x + HOUSE.w), h: WORLD.h },
    { x: 0, y: HOUSE.y + HOUSE.h, w: WORLD.w, h: WORLD.h - (HOUSE.y + HOUSE.h) },
    { x: 0, y: 0, w: WORLD.w, h: HOUSE.y }
  ]
  for (const g of trozos) {
    R(c, g.x, g.y, g.w, g.h, C.hierba)
    for (let y = g.y; y < g.y + g.h; y += 8) {
      for (let x = g.x; x < g.x + g.w; x += 8) {
        if ((hash(x + ':' + y) & 7) === 0) R(c, x, y, 8, 8, C.hierba2)
        else if ((hash(y + '.' + x) & 15) === 0) R(c, x + 2, y + 3, 3, 2, C.hierba3)
      }
    }
  }
  // Tierra pegada a las paredes de fuera.
  R(c, HOUSE.x + HOUSE.w + 6, HOUSE.y - 6, 6, HOUSE.h + 12, C.tierra)
  R(c, HOUSE.x - 6, HOUSE.y + HOUSE.h + 6, HOUSE.w + 12, 6, C.tierra)

  // Cuatro flores y alguna piedra, que la hierba pelada cansa.
  const flores = ['#e8799b', '#f0d96b', '#dfe5f0', '#c48ce0']
  for (const g of trozos) {
    for (let y = g.y + 4; y < g.y + g.h - 4; y += 24) {
      for (let x = g.x + 4; x < g.x + g.w - 4; x += 24) {
        const h = hash(x + '/' + y)
        if ((h & 15) === 0) {
          R(c, x, y, 2, 3, '#2f5e3f')
          R(c, x - 1, y - 2, 4, 3, flores[(h >> 4) % flores.length])
        } else if ((h & 31) === 3) {
          R(c, x, y, 4, 3, '#6f7a86')
          R(c, x, y, 4, 1, '#8c95a0')
        }
      }
    }
  }
}

const COURT = { x: 96, y: 496, w: 374, h: 130 }

function piscina(c: Ctx): void {
  const p = POOL
  R(c, p.x - 12, p.y - 12, p.w + 24, p.h + 24, C.bordillo2)
  R(c, p.x - 12, p.y - 12, p.w + 24, 4, C.bordillo)
  R(c, p.x - 8, p.y - 8, p.w + 16, p.h + 16, C.bordillo)
  R(c, p.x, p.y, p.w, p.h, C.agua2)
  R(c, p.x + 4, p.y + 4, p.w - 8, p.h - 8, C.agua)
  R(c, p.x + 4, p.y + 4, p.w - 8, 3, C.aguaLuz)
  // escalerilla
  R(c, p.x + 18, p.y - 6, 3, 12, C.metal)
  R(c, p.x + 32, p.y - 6, 3, 12, C.metal)
  R(c, p.x + 18, p.y - 6, 17, 3, C.metal)
  // flotador olvidado en el borde
  R(c, p.x + p.w + 2, p.y + 70, 12, 12, '#e0899f')
  R(c, p.x + p.w + 5, p.y + 73, 6, 6, C.bordillo)
}

function cancha(c: Ctx): void {
  const q = COURT
  R(c, q.x, q.y, q.w, q.h, C.pista2)
  R(c, q.x + 3, q.y + 3, q.w - 6, q.h - 6, C.pista)
  R(c, q.x + 8, q.y + 8, q.w - 16, 2, C.linea)
  R(c, q.x + 8, q.y + q.h - 12, q.w - 16, 2, C.linea)
  R(c, q.x + 8, q.y + 8, 2, q.h - 20, C.linea)
  R(c, q.x + q.w - 10, q.y + 8, 2, q.h - 20, C.linea)
  // zona de tiro bajo la canasta
  R(c, q.x + 152, q.y + 8, 2, 44, C.linea)
  R(c, q.x + 216, q.y + 8, 2, 44, C.linea)
  R(c, q.x + 152, q.y + 52, 66, 2, C.linea)
}

function caminoPuerta(c: Ctx): void {
  const baldosa = (x: number, y: number): void => {
    R(c, x, y, 8, 8, ((x / 8 + y / 8) | 0) % 2 ? C.camino : C.camino2)
  }
  for (let y = 404; y < 440; y += 8) for (let x = 544; x < 672; x += 8) baldosa(x, y)
  for (let y = 440; y < 520; y += 8) for (let x = 624; x < 672; x += 8) baldosa(x, y)
  for (let y = 512; y < 544; y += 8) for (let x = 470; x < 672; x += 8) baldosa(x, y)
  // y hacia la derecha, a la calle: por ahí llega quien viene de visita
  for (let y = 404; y < 440; y += 8) for (let x = 672; x < WORLD.w; x += 8) baldosa(x, y)
}

function valla(c: Ctx): void {
  const poste = (x: number, y: number): void => {
    R(c, x, y, 4, 16, C.madera)
    R(c, x, y, 4, 2, C.maderaLuz)
  }
  for (let x = 552; x < WORLD.w - 6; x += 16) poste(x, 10)
  R(c, 548, 14, WORLD.w - 552, 3, C.madera2)
  R(c, 548, 21, WORLD.w - 552, 3, C.madera2)
  for (let x = 8; x < WORLD.w - 6; x += 16) poste(x, WORLD.h - 22)
  R(c, 4, WORLD.h - 18, WORLD.w - 8, 3, C.madera2)
  R(c, 4, WORLD.h - 11, WORLD.w - 8, 3, C.madera2)
}

/** El decorado fijo, que se pinta una vez y luego sólo se copia. */
export function drawWorld(c: Ctx): void {
  c.imageSmoothingEnabled = false
  hierba(c)
  valla(c)
  caminoPuerta(c)
  piscina(c)
  cancha(c)

  // el bloque de la casa, con su muro exterior
  R(c, HOUSE.x - 8, HOUSE.y - 8, HOUSE.w + 16, HOUSE.h + 16, C.muroSombra)
  R(c, HOUSE.x - 6, HOUSE.y - 6, HOUSE.w + 12, HOUSE.h + 12, C.muro)
  R(c, HOUSE.x - 6, HOUSE.y - 6, HOUSE.w + 12, 3, C.muroLuz)

  for (const room of ROOMS) {
    if (room.outside) continue
    const b = room.box
    // suelo
    if (room.id === 'cocina') baldosas(c, { x: b.x, y: b.y + WALL_H, w: b.w, h: b.h - WALL_H })
    else tablas(c, { x: b.x, y: b.y + WALL_H, w: b.w, h: b.h - WALL_H })
    pared(c, room.id, b)
  }

  // ventanas en las paredes de arriba
  ventana(c, 232, 44)
  ventana(c, 420, 42)
  ventana(c, 60, 266)
  ventana(c, 424, 268)

  // muebles pegados a la pared
  cocinaMuebles(c, roomById('cocina').box)
  salonMuebles(c, roomById('salon').box)
  despachoMuebles(c, roomById('despacho').box)
  dormitorioMuebles(c, roomById('dormitorio').box)
  juegosMuebles(c, roomById('juegos').box)
  recibidorMuebles(c, roomById('recibidor').box)

  // tabiques verticales entre habitaciones, con su hueco de paso
  for (const x of [192, 368]) {
    for (const y0 of [32, 256]) {
      R(c, x - 4, y0, 8, 224, C.muro)
      R(c, x - 4, y0, 8, 3, C.muroLuz)
    }
  }
  for (const d of DOORS) {
    if (d.pts.length === 1 && d.a !== 'recibidor') {
      const p = d.pts[0]
      R(c, p.x - 5, p.y - 22, 10, 44, C.suelo)
      R(c, p.x - 5, p.y - 22, 10, 3, C.muroSombra)
      R(c, p.x - 5, p.y + 19, 10, 3, C.muroSombra)
    }
  }

  // huecos en las paredes horizontales
  for (const d of DOORS) {
    if (d.pts.length !== 2) continue
    const destino = roomById(d.b)
    // Fuera no hay paredes que agujerear: se pasa por la hierba.
    if (destino.outside) continue
    const x = d.pts[0].x
    const b = destino.box
    R(c, x - 20, b.y, 40, WALL_H, '#241c26')
    R(c, x - 20, b.y, 40, 4, C.muroSombra)
    R(c, x - 18, b.y + 4, 36, WALL_H - 10, '#2e2433')
    R(c, x - 20, b.y + WALL_H - 6, 40, 6, C.suelo)
    R(c, x - 22, b.y, 3, WALL_H, C.muro)
    R(c, x + 19, b.y, 3, WALL_H, C.muro)
  }

  // La puerta de la calle no va aquí: se abre y se cierra, así que es un mueble más.

  // rótulo de la entrada sobre el camino
  R(c, 556, 446, 44, 2, C.madera2)
}

/* ------------------------------------------------------------------ *
 * Muebles que se mezclan con la gente                                *
 * ------------------------------------------------------------------ */

/** Lo que hace falta saber para pintar lo que se mueve: la hora y quién usa qué. */
export interface Scene {
  /** Segundos, para lo que se mueve solo. */
  t: number
  /** Sitios en los que hay alguien ya acomodado. */
  busy: Set<string>
  /** La puerta de la calle, de 0 cerrada a 1 abierta. */
  door: number
}

export interface Prop {
  /** Por dónde se ordena con los vecinos. */
  sort: number
  draw: (c: Ctx, s: Scene) => void
}

function sofa(c: Ctx): void {
  const x = 216
  const y = 146
  R(c, x, y, 84, 14, '#9d4a5c')
  R(c, x, y, 84, 3, '#b65a6d')
  R(c, x, y + 14, 84, 18, '#b65a6d')
  R(c, x, y + 30, 84, 4, '#7e3a49')
  R(c, x - 6, y + 4, 8, 28, '#8c4152')
  R(c, x + 82, y + 4, 8, 28, '#8c4152')
  R(c, x + 20, y + 16, 2, 14, '#9d4a5c')
  R(c, x + 58, y + 16, 2, 14, '#9d4a5c')
  R(c, x - 6, y + 32, 96, 3, C.sombra)
}

function mesita(c: Ctx): void {
  R(c, 234, 196, 44, 16, C.madera)
  R(c, 234, 196, 44, 3, C.maderaLuz)
  R(c, 236, 212, 4, 5, C.madera2)
  R(c, 272, 212, 4, 5, C.madera2)
  R(c, 248, 190, 10, 7, '#6aa06b')
  R(c, 234, 216, 44, 3, C.sombra)
}

function cama(c: Ctx): void {
  const x = 50
  const y = 312
  R(c, x, y, 56, 84, C.madera2)
  R(c, x + 2, y + 2, 52, 80, '#c9c2b2')
  R(c, x + 6, y + 6, 44, 20, C.blanco)
  R(c, x + 2, y + 30, 52, 52, '#5f7fb5')
  R(c, x + 2, y + 30, 52, 3, '#7b9acd')
  R(c, x + 2, y + 60, 52, 2, '#4e6b9b')
  R(c, x, y + 82, 56, 4, C.madera2)
  R(c, x, y + 86, 56, 3, C.sombra)
}

function mesilla(c: Ctx): void {
  R(c, 112, 318, 20, 22, C.madera)
  R(c, 112, 318, 20, 3, C.maderaLuz)
  R(c, 116, 328, 12, 3, C.madera2)
  R(c, 116, 310, 12, 8, '#f0d99a')
  R(c, 112, 340, 20, 3, C.sombra)
}

function butaca(c: Ctx): void {
  R(c, 136, 420, 34, 12, '#6f5a8c')
  R(c, 136, 430, 34, 18, '#81699f')
  R(c, 132, 424, 6, 22, '#5e4b78')
  R(c, 168, 424, 6, 22, '#5e4b78')
  R(c, 132, 448, 42, 3, C.sombra)
}

function recreativa(c: Ctx, s: Scene): void {
  const x = 208
  const y = 266
  const t = s.t
  R(c, x, y, 34, 56, '#42356a')
  R(c, x, y, 34, 3, '#5a4a8c')
  R(c, x + 4, y + 6, 26, 20, '#161a2a')
  if (s.busy.has('r-arcade')) {
    // Partida en marcha: la nave se mueve, los marcianos bajan y hay disparos.
    R(c, x + 6, y + 8, 22, 16, '#1d2f5c')
    const nave = x + 8 + Math.round((Math.sin(t * 2.3) + 1) * 7)
    R(c, nave, y + 20, 5, 3, '#e8d36b')
    const baja = Math.floor(t * 1.5) % 5
    for (let i = 0; i < 3; i++) R(c, x + 9 + i * 7, y + 10 + baja, 4, 3, '#e06a7f')
    if (Math.floor(t * 6) % 3 === 0) R(c, nave + 2, y + 13 + (Math.floor(t * 12) % 6), 1, 2, '#f4f7ff')
  } else {
    // Sola, la máquina enseña su demo y el rótulo parpadea despacio.
    R(c, x + 6, y + 8, 22, 16, '#2b4a86')
    R(c, x + 8, y + 12, 5, 4, '#e8d36b')
    R(c, x + 18, y + 16, 6, 4, '#e06a7f')
    if (Math.floor(t * 0.8) % 2) R(c, x + 9, y + 21, 16, 2, '#9fd0ef')
  }
  R(c, x + 8, y + 32, 18, 4, '#5a4a8c')
  R(c, x + 11, y + 28, 3, 5, '#d8d2c4')
  R(c, x + 20, y + 30, 4, 3, '#e06a7f')
  R(c, x, y + 56, 34, 4, C.sombra)
}

function futbolin(c: Ctx, s: Scene): void {
  const x = 268
  const y = 384
  // Sólo se mueve si hay alguien jugando.
  const juegan = s.busy.has('r-futbolin') || s.busy.has('r-futbolin2')
  R(c, x, y, 56, 36, '#3f7a55')
  R(c, x + 2, y + 2, 52, 32, '#4a8f64')
  R(c, x + 2, y + 17, 52, 2, '#3f7a55')
  R(c, x, y, 56, 3, '#5aa87a')
  if (juegan) {
    const bx = x + 26 + Math.round(Math.sin(s.t * 1.9) * 20)
    const by = y + 16 + Math.round(Math.sin(s.t * 3.1 + 1) * 11)
    R(c, bx, by, 3, 3, '#f4f7ff')
  }
  for (let i = 0; i < 4; i++) {
    const bx = x + 8 + i * 13
    const vaiven = juegan ? Math.round(Math.sin(s.t * 5 + i * 1.7) * 3) : 0
    R(c, bx, y - 4, 2, 44, C.metal2)
    R(c, bx - 2, y + 6 + (i % 2) * 16 + vaiven, 6, 6, i % 2 ? '#4f86c4' : '#d8873f')
  }
  R(c, x, y + 36, 56, 3, C.sombra)
}

/**
 * La puerta de la calle. Gira hacia dentro sobre la bisagra de arriba, y con
 * ella abierta se ve el umbral y entra algo de luz al recibidor.
 */
function puertaCalle(c: Ctx, s: Scene): void {
  const x = HOUSE.x + HOUSE.w - 6
  const o = s.door
  if (o < 0.04) {
    R(c, x, 394, 12, 52, C.madera2)
    R(c, x + 2, 398, 8, 44, C.madera)
    R(c, x + 5, 418, 3, 4, '#f0c860')
    return
  }
  R(c, x, 394, 12, 52, C.madera2)
  R(c, x + 2, 398, 8, 44, C.camino)
  R(c, x + 2, 398, 8, 2, C.camino2)
  c.fillStyle = `rgba(255,236,190,${(0.13 * o).toFixed(3)})`
  c.fillRect(x - 34, 400, 36, 40)
  const ang = o * 1.35
  const hx = x + 5
  const hy = 399
  for (let i = 0; i <= 42; i++) {
    const px = hx - Math.sin(ang) * i
    const py = hy + Math.cos(ang) * i
    R(c, px - 2, py - 1, 4, 3, C.madera)
    R(c, px - 2, py - 2, 4, 1, C.maderaLuz)
    if (i === 34) R(c, px - 1, py - 1, 2, 2, '#f0c860')
  }
}

function tumbona(c: Ctx): void {
  R(c, 566, 244, 46, 10, '#c9cfd6')
  R(c, 566, 252, 46, 28, '#e0899f')
  R(c, 566, 252, 46, 3, '#ee9cb1')
  R(c, 566, 280, 46, 3, C.sombra)
  // sombrilla
  R(c, 622, 226, 3, 56, C.madera2)
  R(c, 600, 222, 46, 6, '#d8873f')
  R(c, 606, 218, 34, 5, '#e89a55')
  R(c, 616, 280, 14, 3, C.sombra)
}

function arbol(c: Ctx, x: number, y: number): void {
  R(c, x - 16, y - 2, 36, 7, C.sombra)
  R(c, x - 5, y - 40, 11, 42, C.madera2)
  R(c, x - 5, y - 40, 3, 42, '#7d5936')
  R(c, x - 30, y - 92, 60, 56, '#2d5b3d')
  R(c, x - 36, y - 76, 72, 34, '#336647')
  R(c, x - 24, y - 104, 48, 20, '#3b7853')
  R(c, x - 20, y - 94, 16, 10, '#4b9067')
  R(c, x + 6, y - 70, 12, 8, '#285036')
  R(c, x - 30, y - 58, 10, 8, '#285036')
}

/** Una de las tres macetas del jardín; cada una se ordena por su base, que quien riega pasa entre ellas. */
function maceta(c: Ctx, i: number): void {
  const x = 566 + i * 22
  const y = 322 + (i % 2) * 12
  R(c, x, y, 14, 12, '#a5613f')
  R(c, x - 1, y, 16, 3, '#bd7550')
  R(c, x + 3, y - 10, 8, 10, '#4a8f5f')
  R(c, x + 1, y - 6, 12, 4, '#3f7d52')
  if (i !== 1) R(c, x + 5, y - 14, 4, 4, '#e07a9b')
  R(c, x, y + 12, 14, 3, C.sombra)
}

function canasta(c: Ctx): void {
  const x = 280
  R(c, x - 2, 524, 5, 30, C.metal2)
  R(c, x - 18, 500, 36, 26, C.blanco)
  R(c, x - 18, 500, 36, 2, C.hueso)
  R(c, x - 9, 510, 18, 12, '#d8873f')
  R(c, x - 11, 524, 22, 3, '#e8793f')
  R(c, x - 10, 527, 20, 8, 'rgba(238,242,248,0.55)')
  R(c, x - 9, 552, 20, 3, C.sombra)
}


function mesaCocina(c: Ctx): void {
  const x = 76
  const y = 186
  R(c, x, y, 56, 30, C.madera)
  R(c, x, y, 56, 4, C.maderaLuz)
  R(c, x + 2, y + 30, 5, 6, C.madera2)
  R(c, x + 49, y + 30, 5, 6, C.madera2)
  R(c, x + 18, y + 10, 20, 10, C.hueso)
  R(c, x + 24, y + 13, 8, 4, '#c4574f')
  // sillas a los lados
  R(c, x - 14, y + 6, 12, 16, '#8a6a4a')
  R(c, x - 14, y + 6, 12, 3, '#a2805c')
  R(c, x + 58, y + 6, 12, 16, '#8a6a4a')
  R(c, x + 58, y + 6, 12, 3, '#a2805c')
  R(c, x - 2, y + 36, 60, 3, C.sombra)
}

function plantaSuelo(c: Ctx, x: number, y: number): void {
  R(c, x - 7, y - 12, 14, 12, '#a5613f')
  R(c, x - 8, y - 12, 16, 3, '#bd7550')
  R(c, x - 3, y - 26, 6, 14, '#3f7d52')
  R(c, x - 10, y - 24, 10, 6, '#4a8f5f')
  R(c, x + 1, y - 30, 10, 7, '#4a8f5f')
  R(c, x - 8, y - 34, 8, 6, '#559b69')
  R(c, x - 7, y, 16, 3, C.sombra)
}

function archivador(c: Ctx): void {
  R(c, 522, 186, 22, 34, C.metal2)
  R(c, 522, 186, 22, 3, C.metal)
  R(c, 524, 196, 18, 2, '#6d7684')
  R(c, 524, 208, 18, 2, '#6d7684')
  R(c, 522, 220, 22, 3, C.sombra)
}

function consola(c: Ctx): void {
  R(c, 392, 336, 40, 16, C.madera)
  R(c, 392, 336, 40, 3, C.maderaLuz)
  R(c, 394, 352, 4, 8, C.madera2)
  R(c, 426, 352, 4, 8, C.madera2)
  R(c, 402, 328, 12, 8, '#f0d99a')
  R(c, 392, 360, 40, 3, C.sombra)
}

/** Los muebles que se ordenan con la gente, con su línea de apoyo. */
export const PROPS: Prop[] = [
  { sort: 174, draw: sofa },
  { sort: 222, draw: mesaCocina },
  { sort: 226, draw: archivador },
  { sort: 126, draw: mesasDespacho },
  { sort: 362, draw: consola },
  { sort: 240, draw: (c) => plantaSuelo(c, 352, 240) },
  { sort: 232, draw: (c) => plantaSuelo(c, 392, 232) },
  { sort: 462, draw: (c) => plantaSuelo(c, 520, 462) },
  { sort: 214, draw: mesita },
  { sort: 350, draw: cama },
  { sort: 338, draw: mesilla },
  { sort: 446, draw: butaca },
  { sort: 324, draw: recreativa },
  { sort: 420, draw: futbolin },
  { sort: 258, draw: tumbona },
  { sort: 334, draw: (c) => maceta(c, 0) },
  { sort: 346, draw: (c) => maceta(c, 1) },
  { sort: 334, draw: (c) => maceta(c, 2) },
  { sort: 554, draw: canasta },
  { sort: 400, draw: puertaCalle },
  { sort: 404, draw: (c) => arbol(c, 726, 404) },
  { sort: 604, draw: (c) => arbol(c, 60, 604) },
  { sort: 604, draw: (c) => arbol(c, 700, 604) }
]

/* ------------------------------------------------------------------ *
 * Lo que se mueve por su cuenta                                      *
 * ------------------------------------------------------------------ */

/**
 * Agua, fuego, pantallas: lo que se mueve encima del fondo. Cada aparato va
 * con quien lo usa: el fuego arde si alguien cocina, la tele se enciende con
 * gente en el sofá y cada pantalla del despacho, con quien se sienta delante.
 */
export function drawAmbient(c: Ctx, s: Scene): void {
  const t = s.t

  // olas de la piscina
  const p = POOL
  for (let i = 0; i < 5; i++) {
    const y = p.y + 14 + i * 18
    const off = Math.round(Math.sin(t * 1.2 + i) * 6)
    R(c, p.x + 12 + off, y, 22, 2, C.aguaLuz)
    R(c, p.x + 96 - off, y + 6, 26, 2, C.aguaLuz)
  }

  // fogones y grifo
  const k = roomById('cocina').box
  const suelo = k.y + WALL_H
  if (s.busy.has('w-fogones')) {
    const fuego = Math.sin(t * 9) > 0.2 ? '#ffab4d' : '#ff7a2e'
    R(c, k.x + 28, suelo - 11, 8, 2, fuego)
    if (Math.sin(t * 13) > 0.5) R(c, k.x + 30, suelo - 12, 3, 1, '#ffd27a')
  }
  if (s.busy.has('w-fregadero')) {
    // el chorro, cayendo del grifo a la pila
    for (let i = 0; i < 4; i++) {
      if ((Math.floor(t * 10) + i) % 4 !== 0) R(c, k.x + 107, suelo - 16 + i * 2, 1, 2, C.aguaLuz)
    }
    R(c, k.x + 96, suelo - 10, 16, 1, 'rgba(159,214,239,0.55)')
  }

  // televisión
  const sb = roomById('salon').box
  if (s.busy.has('r-sofa1') || s.busy.has('r-sofa2')) {
    const tv = ['#2e5a86', '#3a6fa0', '#28496d', '#3d6f5a'][Math.floor(t * 1.3) % 4]
    R(c, sb.x + 17, sb.y + 15, 40, 22, tv)
    R(c, sb.x + 19, sb.y + 17, 16, 8, shade(tv, 0.25))
    R(c, sb.x + 38 + Math.round(Math.sin(t * 2) * 6), sb.y + 27, 6, 6, shade(tv, -0.3))
  } else {
    // apagada: negra, con el reflejo de la ventana
    R(c, sb.x + 17, sb.y + 15, 40, 22, '#191f2b')
    R(c, sb.x + 20, sb.y + 17, 9, 2, '#283244')
    R(c, sb.x + 20, sb.y + 19, 4, 2, '#283244')
  }

  // pantallas del despacho
  const o = roomById('despacho').box
  const tinta = ['#8fd3a0', '#9fd0ef', '#e8d36b', '#e0899f', '#c3cde6']
  for (let i = 0; i < 3; i++) {
    const x = o.x + 24 + i * 48
    if (s.busy.has('w-mesa' + (i + 1))) {
      // código que va bajando, con su cursor
      R(c, x + 2, o.y + 14, 24, 15, '#1c2738')
      const avance = Math.floor(t * 2.5 + i * 7)
      for (let j = 0; j < 4; j++) {
        const h = hash(i + ':' + (avance + j))
        R(c, x + 4 + (h % 3) * 2, o.y + 16 + j * 3, 6 + (h % 13), 1, tinta[(h >> 4) % tinta.length])
      }
      if (Math.floor(t * 2) % 2) R(c, x + 4, o.y + 26, 2, 2, '#f4f7ff')
    } else {
      // en reposo: negra y con el piloto naranja
      R(c, x + 2, o.y + 14, 24, 15, '#161c26')
      R(c, x + 3, o.y + 15, 6, 1, '#222b3a')
      R(c, x + 24, o.y + 29, 2, 1, '#e8a23a')
    }
  }
}

/* ------------------------------------------------------------------ *
 * Los vecinos                                                        *
 * ------------------------------------------------------------------ */

export interface Look {
  /** Camiseta. */
  shirt: string
  shirtDark: string
  /** Pantalón. */
  pants: string
  skin: string
  skinDark: string
  hair: string
  /** 0 corto, 1 con raya, 2 recogido, 3 con gorra, 4 calvo. */
  hairStyle: number
  /** Complemento propio de su familia. */
  badge: 'auriculares' | 'gafas' | 'gorra' | 'ninguno'
}

const PIELES = [
  ['#f0c9a4', '#d3a37c'],
  ['#dfae83', '#bd8a60'],
  ['#c08a5e', '#9d6b44'],
  ['#96603c', '#764828'],
  ['#6b4228', '#50301b']
]
const PELOS = ['#3a2a20', '#6b4426', '#151318', '#a8763c', '#8d8d97', '#7a3f3f']

export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const r = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)
    return Math.max(0, Math.min(255, Math.round(r)))
  })
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/**
 * La pinta sale de la clave, así que un mismo vecino tiene siempre el mismo
 * aspecto y su copia es idéntica sin guardar nada. El complemento lo manda su
 * familia: gorra los de consola, auriculares los locales, gafas los de fuera.
 */
export function lookOf(id: string, color: string, kind: 'cli' | 'local' | 'remote'): Look {
  const h = hash(id)
  const piel = PIELES[h % PIELES.length]
  return {
    shirt: color,
    shirtDark: shade(color, -0.32),
    pants: shade(color, -0.62),
    skin: piel[0],
    skinDark: piel[1],
    hair: PELOS[(h >> 5) % PELOS.length],
    hairStyle: (h >> 9) % 5,
    badge: kind === 'cli' ? 'gorra' : kind === 'local' ? 'auriculares' : 'gafas'
  }
}

/** Cómo se coloca el cuerpo según lo que esté haciendo. */
interface Pose {
  /** 0 de pie, 1 sentado, 2 tumbado, 4 agachado. */
  mode: 0 | 1 | 2 | 4
  /** Cuánto lleva de esa postura: 0 aún de pie, 1 del todo. */
  k: number
  dir: Dir
  /** Hacia dónde mira la cabeza, que no siempre es hacia donde mira el cuerpo. */
  head: Dir
  /** Fotograma del paso, de 0 a 3; -1 si no anda. */
  frame: number
  /** Cadera arriba (negativo) o abajo (positivo), en puntos. */
  bob: number
  /** Pies en el aire, para el salto del tiro. */
  jump: number
  /** El pecho que sube al tomar aire. */
  breath: number
  /** Cuánto levanta cada mano, en puntos. */
  armL: number
  armR: number
  prop?: (c: Ctx, x: number, y: number, dir: Dir, t: number) => void
  bubble?: 'zzz' | 'vapor' | 'nota' | 'chispa'
  /** El balón: dónde está en el suelo y a qué altura va. */
  ball?: { x: number; gy: number; h: number }
}

/** Puntos andados por fotograma: cuatro fotogramas son dos pasos. */
const STRIDE = 5

const suave = (k: number): number => k * k * (3 - 2 * k)
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u

function poseFor(d: Dweller): Pose {
  const anda = d.route.length > 0 && d.speed > 3 && !d.rising
  const p: Pose = {
    mode: 0,
    k: 0,
    dir: d.dir,
    head: d.clock < d.glanceUntil ? d.glanceDir : d.dir,
    frame: anda ? Math.floor(d.walked / STRIDE) % 4 : -1,
    bob: 0,
    jump: 0,
    breath: 0,
    armL: 0,
    armR: 0
  }
  // Cada uno lleva su propio reloj: así nadie hace los gestos a la vez que otro.
  const clk = d.clock
  const osc = (hz: number): number => Math.sin(clk * hz * Math.PI * 2)

  // Al andar, la cadera sube cuando una pierna pasa junto a la otra; parado,
  // lo único que se mueve es el pecho al respirar, cada uno a su ritmo.
  if (anda) p.bob = p.frame % 2 ? -1 : 0
  else p.breath = (clk + (hash(d.key) % 40) / 10) % 3.8 < 1.5 ? 1 : 0

  const postura = POSTURE[d.activity]
  if (postura) {
    p.mode = postura === 'sentado' ? 1 : 2
    p.k = suave(d.settle)
  }
  // En cada punto de una faena que se hace andando, el gesto va por la pausa.
  const pausa = clk - d.pauseAt
  const enFaena = !anda && !d.patrolling

  switch (d.activity) {
    case 'andar':
      return p
    case 'cocinar':
      if (d.patrolIdx === 0) {
        // en la encimera, picando
        p.armR = enFaena ? 3 + Math.round(Math.abs(osc(3)) * 3) : 2
        p.armL = 2
        p.prop = cuchillo
      } else {
        p.armR = enFaena ? 4 + Math.round(osc(1.3) * 1.5) : 3
        // y de vez en cuando, la vuelta a lo que hay en la sartén
        if (enFaena && clk % 6 < 0.45) p.armR = 8
        p.prop = sarten
        if (enFaena) p.bubble = 'vapor'
      }
      return p
    case 'fregar':
      p.armR = 3 + Math.round(osc(2.4) * 2)
      p.armL = 3 - Math.round(osc(2.4) * 2)
      p.bubble = 'vapor'
      return p
    case 'barrer':
      p.armR = enFaena ? 2 + Math.round(osc(1.1) * 2) : 2
      p.armL = 1
      p.prop = escoba
      return p
    case 'desempolvar':
      p.armR = enFaena ? 7 + Math.round(osc(2.2) * 3) : 2
      p.prop = plumero
      return p
    case 'regar':
      p.armR = enFaena ? 5 : 1
      p.prop = enFaena ? regando : regadera
      return p
    case 'teclear':
      if (p.k > 0.9) {
        p.armL = 1 + Math.round(osc(5))
        p.armR = 1 - Math.round(osc(5))
        if (clk % 7 < 2) p.bubble = 'chispa'
      }
      return p
    case 'hacer-cama':
      if (enFaena) {
        p.armL = 5 + Math.round(osc(0.9) * 3)
        p.armR = 5 + Math.round(osc(0.9) * 3)
        p.bob = Math.round(osc(0.9))
      } else {
        p.armL = 3
        p.armR = 3
      }
      p.prop = sabana
      return p
    case 'recoger': {
      // Se agacha a por el juguete, se levanta y lo lleva a la caja.
      const baja = !enFaena ? 0 : pausa < 0.3 ? pausa / 0.3 : pausa < 1.2 ? 1 : pausa < 1.5 ? 1 - (pausa - 1.2) / 0.3 : 0
      if (baja > 0) {
        p.mode = 4
        p.k = suave(baja)
        p.armL = -2
        p.armR = -2
      } else {
        p.armL = 3
        p.armR = 3
        p.prop = caja
      }
      return p
    }
    case 'limpiar-piscina':
      p.armR = enFaena ? 2 + Math.round(osc(0.45) * 2) : 2
      p.armL = 2
      p.prop = red
      return p
    case 'sofa':
      if (p.k > 0.9) {
        if (clk % 11 < 3.5) p.bubble = 'nota'
        // alguna carcajada
        if (clk % 17 < 0.7) p.bob = osc(5) > 0 ? -1 : 0
      }
      return p
    case 'leer':
      p.armL = 2
      p.armR = 2
      if (p.k > 0.6) p.prop = libro
      return p
    case 'cama':
      if (p.k > 0.95) p.bubble = 'zzz'
      return p
    case 'tumbona':
      return p
    case 'arcade':
      p.armL = 3 + Math.round(osc(3.2) * 2)
      p.armR = 3 - Math.round(Math.abs(osc(4.1)) * 2)
      // cuando pasa de pantalla, los brazos arriba
      if (clk % 9 < 0.5) {
        p.armL = 8
        p.armR = 8
      }
      return p
    case 'futbolin':
      p.armL = 3 + Math.round(osc(2.6))
      p.armR = 3 - Math.round(osc(2.6))
      p.bob = osc(1.3) > 0.6 ? 1 : 0
      return p
    case 'flotar':
      p.armL = 3 + Math.round(osc(0.9) * 2)
      p.armR = 3 - Math.round(osc(0.9) * 2)
      return p
    case 'canasta':
      jugada(p, d, anda || d.patrolling || d.settle < 1)
      return p
  }
  return p
}

/**
 * Una jugada en la cancha: bota, recoge el balón, salta y tira; el balón
 * dibuja su parábola hasta el aro, cae por la red y vuelve botando hacia quien
 * tiró. El balón va en coordenadas de suelo más altura, para que su sombra se
 * quede abajo mientras vuela.
 */
function jugada(p: Pose, d: Dweller, soloBotar: boolean): void {
  const s = d.dir === 'izq' ? -1 : 1
  const mano = { x: d.x + 8 * s, gy: d.y }
  const botar = (): void => {
    const h = 2 + 13 * Math.abs(Math.cos(d.clock * Math.PI * 2.2))
    p.ball = { x: mano.x, gy: mano.gy, h }
    p.armR = Math.round((h / 15) * 3)
  }
  if (soloBotar) return botar()
  const f = d.clock - d.pauseAt
  if (f < 1.3) return botar()
  if (f < 1.6) {
    p.bob = 1
    p.armL = 5
    p.armR = 5
    p.ball = { x: d.x + 2 * s, gy: d.y, h: 21 }
    return
  }
  if (f < 1.85) {
    p.jump = 3
    p.armL = 10
    p.armR = 10
    p.ball = { x: d.x + s, gy: d.y, h: 36 }
    return
  }
  const aro = HOOP.h + 3
  if (f < 2.65) {
    const u = (f - 1.85) / 0.8
    p.jump = u < 0.25 ? 2 : 0
    p.armL = Math.round(10 - 6 * u)
    p.armR = p.armL
    p.ball = { x: lerp(d.x + s, HOOP.x, u), gy: lerp(d.y, HOOP.gy, u), h: lerp(36, aro, u) + 26 * 4 * u * (1 - u) }
    return
  }
  if (f < 2.95) {
    const v = (f - 2.65) / 0.3
    p.ball = { x: HOOP.x, gy: HOOP.gy, h: aro * (1 - v * v) }
    return
  }
  if (f < 3.75) {
    const v = (f - 2.95) / 0.8
    p.armR = v > 0.7 ? 4 : 0
    p.ball = {
      x: lerp(HOOP.x, mano.x, v),
      gy: lerp(HOOP.gy, mano.gy, v),
      h: Math.abs(Math.sin(v * Math.PI * 2)) * 10 * (1 - v) + v * v * 12
    }
    return
  }
  botar()
}

/* ---- trastos ---- */

/** Como R, pero admite anchos negativos: los trastos se dan la vuelta según hacia dónde mira. */
function RN(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  if (w < 0) {
    x += w
    w = -w
  }
  R(c, x, y, w, h, col)
}

function sarten(c: Ctx, x: number, y: number, dir: Dir): void {
  const s = dir === 'izq' ? -1 : 1
  RN(c, x, y + 1, 7 * s, 2, '#4a5262')
  RN(c, x + 6 * s, y - 2, 10 * s, 7, '#33394a')
  RN(c, x + 7 * s, y - 1, 8 * s, 3, '#454d60')
}
function cuchillo(c: Ctx, x: number, y: number, dir: Dir): void {
  const s = dir === 'izq' ? -1 : 1
  RN(c, x, y + 1, 3 * s, 2, C.madera2)
  RN(c, x + 3 * s, y + 1, 6 * s, 1, C.metal)
}
function escoba(c: Ctx, x: number, y: number, dir: Dir, t: number): void {
  const s = dir === 'izq' ? -1 : 1
  // el cepillo va y viene por el suelo
  const va = Math.round(Math.sin(t * 1.1 * Math.PI * 2) * 3)
  R(c, x, y - 4, 2, 18, '#a5763f')
  R(c, x - 2 + s + va, y + 14, 7, 6, '#d8a94a')
  R(c, x - 2 + s + va, y + 14, 7, 2, '#e8bd62')
  if (Math.abs(va) === 3) R(c, x + 6 * s + va, y + 18, 2, 1, 'rgba(210,190,150,0.6)')
}
function plumero(c: Ctx, x: number, y: number): void {
  R(c, x, y - 2, 2, 9, '#a5763f')
  R(c, x - 3, y - 9, 8, 8, '#e08fb4')
  R(c, x - 1, y - 11, 5, 3, '#efa8c6')
}
function regadera(c: Ctx, x: number, y: number, dir: Dir): void {
  const s = dir === 'izq' ? -1 : 1
  RN(c, x - 3 * s, y - 1, 10 * s, 9, '#6a9fc9')
  RN(c, x - 3 * s, y - 1, 10 * s, 2, '#87b9de')
  RN(c, x + 6 * s, y, 6 * s, 3, '#5a8ab2')
}
/** La regadera inclinada, con el agua cayendo a la maceta. */
function regando(c: Ctx, x: number, y: number, dir: Dir, t: number): void {
  const s = dir === 'izq' ? -1 : 1
  RN(c, x - 3 * s, y - 3, 10 * s, 8, '#6a9fc9')
  RN(c, x - 3 * s, y - 3, 10 * s, 2, '#87b9de')
  RN(c, x + 6 * s, y + 2, 6 * s, 3, '#5a8ab2')
  for (let i = 0; i < 4; i++) {
    const cae = (t * 26 + i * 5) % 18
    R(c, x + 12 * s + (i % 2) * s, y + 5 + cae, 1, 2, '#9fd6ef')
  }
}
function red(c: Ctx, x: number, y: number, dir: Dir, t: number): void {
  const s = dir === 'izq' ? -1 : 1
  // la red se pasea por el agua, adelante y atrás
  const va = Math.round(Math.sin(t * 0.45 * Math.PI * 2) * 4)
  RN(c, x, y, (22 + va) * s, 2, '#b3bcc9')
  RN(c, x + (20 + va) * s, y - 5, 10 * s, 3, '#9aa3b2')
  RN(c, x + (20 + va) * s, y - 2, 10 * s, 5, 'rgba(210,220,235,0.5)')
}
function libro(c: Ctx, x: number, y: number, _dir: Dir, t: number): void {
  R(c, x - 6, y - 2, 12, 9, '#c4574f')
  R(c, x - 6, y - 2, 12, 2, '#d86f66')
  R(c, x - 1, y - 2, 2, 9, '#e8e2d4')
  // pasa página cada tanto
  const hoja = t % 7
  if (hoja < 0.45) R(c, x - 1 - Math.round((hoja / 0.45) * 5), y - 3, 5, 8, '#f4f0e4')
}
function caja(c: Ctx, x: number, y: number): void {
  R(c, x - 9, y - 4, 16, 12, '#b98b56')
  R(c, x - 9, y - 4, 16, 3, '#cfa06a')
  R(c, x - 2, y - 4, 2, 12, '#95693c')
}
function sabana(c: Ctx, x: number, y: number): void {
  R(c, x - 12, y - 2, 22, 10, '#e4e9f5')
  R(c, x - 12, y - 2, 22, 2, '#f4f7ff')
  R(c, x - 12, y + 6, 22, 2, '#c3cde6')
}
/** El balón, con su sombra en el suelo cuando va por el aire. */
function balon(c: Ctx, b: { x: number; gy: number; h: number }): void {
  const bx = Math.round(b.x)
  const by = Math.round(b.gy - b.h)
  if (b.h > 1.5) R(c, bx - 2, Math.round(b.gy) - 1, 5, 2, C.sombra)
  R(c, bx - 3, by - 3, 6, 6, '#d8783f')
  R(c, bx - 2, by - 3, 3, 1, '#ec9a5c')
  R(c, bx, by - 3, 1, 6, '#a8532a')
  R(c, bx - 3, by, 6, 1, '#a8532a')
}

/* ---- globitos ---- */

function bubble(c: Ctx, x: number, y: number, kind: NonNullable<Pose['bubble']>, t: number): void {
  const f = Math.floor(t * 1.6) % 3
  if (kind === 'zzz') {
    for (let i = 0; i < 3; i++) {
      const s = 2 + i
      R(c, x + 3 + i * 4, y - 4 - i * 5 - (i === f ? 1 : 0), s, s, '#9fb8e8')
    }
    return
  }
  if (kind === 'vapor') {
    for (let i = 0; i < 3; i++) {
      const o = (Math.floor(t * 4) + i) % 3
      R(c, x + i * 3 - 2, y - 6 - o * 4, 3, 3, 'rgba(226,238,250,0.55)')
    }
    return
  }
  if (kind === 'nota') {
    R(c, x + 3, y - 8, 2, 7, '#b79aef')
    R(c, x + 1, y - 2, 4, 3, '#b79aef')
    R(c, x + 5, y - 9, 4, 2, '#b79aef')
    return
  }
  const s = f === 0 ? 3 : 4
  R(c, x + 2, y - 8, s, s, '#f0d96b')
}

/* ---- el cuerpo ---- */

const H_HEAD = 10
const H_BODY = 11
const H_LEG = 11

function pelo(c: Ctx, x: number, y: number, look: Look, dir: Dir): void {
  const { hair, hairStyle } = look
  // y es la coronilla; la cabeza mide 10 de alto y 10 de ancho
  R(c, x - 5, y, 10, 3, hair)
  if (dir === 'arriba') {
    R(c, x - 5, y, 10, 8, hair)
  } else {
    R(c, x - 5, y, 10, 2, hair)
    if (hairStyle === 0) R(c, x - 5, y + 2, 10, 1, hair)
    if (hairStyle === 1) {
      R(c, x - 5, y + 2, 4, 2, hair)
      R(c, x + 2, y + 2, 3, 1, hair)
    }
    if (hairStyle === 2) {
      R(c, x - 5, y + 2, 10, 1, hair)
      R(c, x - 7, y + 3, 2, 6, hair)
      R(c, x + 5, y + 3, 2, 6, hair)
    }
    if (hairStyle === 3) {
      R(c, x - 6, y - 1, 12, 3, look.shirtDark)
      R(c, x - 6, y + 2, 5, 2, look.shirtDark)
    }
    if (hairStyle === 4) R(c, x - 5, y, 10, 2, look.skinDark)
  }
  // patillas
  if (dir !== 'arriba' && hairStyle !== 4) {
    R(c, x - 5, y + 2, 1, 4, hair)
    R(c, x + 4, y + 2, 1, 4, hair)
  }
}

function cara(c: Ctx, x: number, y: number, look: Look, dir: Dir, cerrado: boolean): void {
  if (dir === 'arriba') return
  const ojo = '#2a2230'
  if (dir === 'abajo') {
    if (cerrado) {
      R(c, x - 4, y + 5, 3, 1, ojo)
      R(c, x + 2, y + 5, 3, 1, ojo)
    } else {
      R(c, x - 4, y + 4, 2, 2, ojo)
      R(c, x + 3, y + 4, 2, 2, ojo)
    }
    R(c, x - 1, y + 7, 3, 1, look.skinDark)
    if (look.badge === 'gafas') {
      R(c, x - 5, y + 3, 4, 4, '#2f3648')
      R(c, x + 2, y + 3, 4, 4, '#2f3648')
      R(c, x - 5, y + 4, 4, 2, '#8fb4d8')
      R(c, x + 2, y + 4, 4, 2, '#8fb4d8')
      R(c, x - 1, y + 4, 2, 1, '#2f3648')
    }
  } else {
    const s = dir === 'izq' ? -1 : 1
    const ex = dir === 'izq' ? x - 4 : x + 2
    if (cerrado) R(c, ex, y + 5, 2, 1, ojo)
    else R(c, ex, y + 4, 2, 2, ojo)
    R(c, x + 4 * s, y + 4, 1, 3, look.skinDark)
    if (look.badge === 'gafas') R(c, ex - (s > 0 ? 0 : 1), y + 3, 4, 3, '#2f3648')
  }
  if (look.badge === 'auriculares') {
    R(c, x - 7, y + 1, 2, 6, '#3b4250')
    R(c, x + 5, y + 1, 2, 6, '#3b4250')
    R(c, x - 6, y - 2, 12, 2, '#3b4250')
  }
}

/** Un brazo visto de frente: la manga baja del hombro y la mano sube según el gesto. */
function brazo(c: Ctx, ax: number, armTop: number, hy: number, look: Look): void {
  const top = Math.min(armTop, hy)
  R(c, ax, top, 3, Math.max(3, armTop + 7 - top), look.shirt)
  R(c, ax, hy, 3, 3, look.skin)
}

/**
 * Un brazo visto de lado. El hombro está en medio del cuerpo; al andar la mano
 * va adelante y atrás, y al levantarla se adelanta, como cuando se coge algo.
 * Devuelve dónde queda la mano.
 */
function brazoLado(c: Ctx, x: number, armTop: number, s: number, raise: number, sw: number, manga: string, piel: string): Pt {
  const hx = x - 1 + s * (sw + Math.min(5, Math.max(0, raise)))
  const hy = armTop + 7 - raise
  R(c, x - 1, armTop, 3, 4, manga)
  R(c, Math.round((x - 1 + hx) / 2), Math.round((armTop + 2 + hy) / 2), 3, 4, manga)
  R(c, hx, hy, 3, 3, piel)
  return { x: hx, y: hy }
}

/** Ondas que se abren en el agua alrededor de quien se baña. */
function ondas(c: Ctx, x: number, y: number, clk: number): void {
  for (let i = 0; i < 2; i++) {
    const u = (clk * 0.6 + i * 0.5) % 1
    const r = 7 + u * 12
    c.fillStyle = `rgba(210,240,250,${(0.45 * (1 - u)).toFixed(3)})`
    for (let a = 0; a < 22; a++) {
      const ang = (a / 22) * Math.PI * 2
      const px = Math.round(x + Math.cos(ang) * r)
      const py = Math.round(y + 1 + Math.sin(ang) * r * 0.4)
      // la parte de atrás de la onda no se pinta encima del cuerpo
      if (py < y + 1 && Math.abs(px - x) < 7) continue
      c.fillRect(px, py, 1, 1)
    }
  }
}

/**
 * Un vecino, con los pies en (x, y).
 *
 * De pie mide 32 puntos: 10 de cabeza, 11 de tronco y 11 de piernas. Esa
 * proporción —cabeza más o menos un tercio— es la que hace que se lea como
 * una persona adulta y no como un muñeco de niño.
 *
 * De frente y de espaldas se ven las dos piernas y los dos brazos; de lado,
 * una pierna delante de la otra al andar, la de atrás más oscura, y un solo
 * brazo que se balancea.
 */
export function drawPerson(c: Ctx, d: Dweller, look: Look, t: number): void {
  const p = poseFor(d)
  const x = Math.round(d.x)
  const y = Math.round(d.y)

  if (p.mode === 2 && p.k > 0.5) {
    tumbado(c, x, y, look, d.activity === 'cama', d.clock)
    if (p.bubble) bubble(c, x + 12, y - 14, p.bubble, t)
    return
  }
  // Para tumbarse, primero se sienta en el borde.
  const mode = p.mode === 2 ? 1 : p.mode
  const k = p.mode === 2 ? Math.min(1, p.k * 2) : p.k

  // En el agua el cuerpo baja hasta el fondo y por encima se pinta la superficie.
  const agua = waterDepth(d.x, d.y)
  const yb = y + Math.round(agua * 12) - p.jump

  // La sombra se queda en el suelo aunque salte, y se encoge un poco.
  if (!agua) R(c, x - 6 + (p.jump ? 1 : 0), y - 2, p.jump ? 10 : 12, 3, C.sombra)

  const lado = p.dir === 'izq' || p.dir === 'der'
  const s = p.dir === 'izq' ? -1 : 1

  // Sentarse y agacharse se notan en que las piernas se van acortando.
  const objetivo = mode === 1 ? 5 : mode === 4 ? 6 : H_LEG
  const largo = Math.round(lerp(H_LEG, objetivo, k)) - p.bob
  const legTop = yb - largo
  const tronco = mode === 4 ? H_BODY - Math.round(3 * k) : H_BODY
  const bodyTop = legTop - tronco - p.breath
  const headTop = bodyTop - H_HEAD
  const zapato = '#3a2f28'

  // piernas
  if (mode === 1 && k > 0.6) {
    // rodillas hacia el que mira
    R(c, x - 6, legTop - 1, 12, 6, look.pants)
    R(c, x - 6, legTop - 1, 12, 2, shade(look.pants, 0.18))
    R(c, x - 6, yb - 3, 5, 3, zapato)
    R(c, x + 2, yb - 3, 5, 3, zapato)
  } else if (mode === 4 && k > 0.5) {
    R(c, x - 5, legTop, 4, largo, look.pants)
    R(c, x + 2, legTop, 4, largo, look.pants)
    R(c, x - 6, yb - 2, 5, 2, zapato)
    R(c, x + 2, yb - 2, 5, 2, zapato)
  } else if (!lado) {
    // De frente, el pie que va atrás se ve más arriba.
    const alza = p.frame < 0 ? [0, 0] : [[0, 2], [0, 1], [2, 0], [1, 0]][p.frame]
    R(c, x - 4, legTop, 3, largo - alza[0], look.pants)
    R(c, x + 1, legTop, 3, largo - alza[1], look.pants)
    R(c, x - 5, yb - 2 - alza[0], 4, 2, zapato)
    R(c, x + 1, yb - 2 - alza[1], 4, 2, zapato)
  } else {
    const abre = p.frame === 0 ? 2 : p.frame === 2 ? -2 : 0
    const piernas = [
      { dx: p.frame < 0 ? -s : -abre * s, alza: p.frame === 1 ? 1 : 0, col: shade(look.pants, -0.22) },
      { dx: abre * s, alza: p.frame === 3 ? 1 : 0, col: look.pants }
    ]
    for (const pi of piernas) {
      const lx = x - 1 + pi.dx
      R(c, lx, legTop, 3, largo - pi.alza, pi.col)
      R(c, lx + (s > 0 ? 0 : -1), yb - 2 - pi.alza, 4, 2, zapato)
    }
  }

  const armTop = bodyTop + 2
  const vaiven = p.frame < 0 ? 0 : [1, 0, -1, 0][p.frame]
  let mano: Pt

  // de lado, el brazo de atrás asoma por detrás del cuerpo
  if (lado) brazoLado(c, x, armTop, s, p.armL, p.armL ? 0 : -vaiven * 2, shade(look.shirt, -0.4), look.skinDark)

  // tronco
  const ancho = lado ? 8 : 10
  const tx = x - ancho / 2
  const alto = legTop - bodyTop
  R(c, tx, bodyTop, ancho, alto, look.shirt)
  R(c, tx, bodyTop, ancho, 2, shade(look.shirt, 0.16))
  R(c, tx, legTop - 2, ancho, 2, look.shirtDark)
  if (p.dir === 'abajo') R(c, x - 1, bodyTop + 3, 2, alto - 5, look.shirtDark)
  if (lado) R(c, s > 0 ? tx : tx + ancho - 1, bodyTop + 2, 1, alto - 3, look.shirtDark)

  // brazos
  if (lado) {
    // la manga, un poco más oscura que la camiseta para que se lea encima del cuerpo
    mano = brazoLado(c, x, armTop, s, p.armR, p.armR ? 0 : vaiven * 2, shade(look.shirt, -0.16), look.skin)
    mano = { x: mano.x + (s > 0 ? 2 : 0), y: mano.y + 1 }
  } else {
    // al andar, cada mano va con la pierna contraria
    const ly = armTop + 7 - p.armL + (p.armL ? 0 : vaiven)
    const ry = armTop + 7 - p.armR - (p.armR ? 0 : vaiven)
    brazo(c, x - 8, armTop, ly, look)
    brazo(c, x + 5, armTop, ry, look)
    mano = { x: x + 7, y: ry + 1 }
  }

  // cuello y cabeza
  R(c, x - 2, headTop + H_HEAD - 1, 4, 2, look.skinDark)
  R(c, x - 5, headTop + 2, 10, H_HEAD - 2, look.skin)
  R(c, x + 3, headTop + 2, 2, H_HEAD - 2, look.skinDark)
  pelo(c, x, headTop, look, p.head)
  cara(c, x, headTop, look, p.head, d.activity === 'cama' || (d.clock * 1.7 + hash(d.key)) % 5 < 0.12)

  // El agua tapa lo que queda por debajo de la superficie.
  if (agua > 0) {
    const sup = y - 3
    R(c, x - 9, sup, 18, yb - sup + 2, 'rgba(63,159,196,0.88)')
    R(c, x - 8 + Math.round(Math.sin(d.clock * 3)), sup, 16, 1, C.aguaLuz)
    if (agua > 0.6) ondas(c, x, sup, d.clock)
  }

  // El trasto va en la mano de delante, así que va después del brazo.
  if (p.prop) p.prop(c, mano.x, mano.y, p.dir, d.clock)
  if (p.ball) balon(c, p.ball)
  if (p.bubble) bubble(c, x + 5, headTop, p.bubble, t)
}

/** Tumbado: en la cama o en la tumbona, con la cabeza a la izquierda. */
function tumbado(c: Ctx, x: number, y: number, look: Look, enCama: boolean, clk: number): void {
  const w = 32
  const izq = x - w / 2
  // la manta sube y baja con la respiración, despacio
  const aire = clk % 4.2 < 1.8 ? 1 : 0
  R(c, izq, y - 13 - aire, w, 13 + aire, enCama ? '#5f7fb5' : look.shirt)
  R(c, izq, y - 13 - aire, w, 2, enCama ? '#7b9acd' : shade(look.shirt, 0.16))
  R(c, izq + 6, y - 6, w - 12, 1, enCama ? '#4e6b9b' : look.shirtDark)

  // cabeza asomando, de perfil
  const hx = izq - 9
  R(c, hx, y - 14, 10, 10, look.skin)
  R(c, hx, y - 14, 10, 3, look.hair)
  R(c, hx, y - 14, 3, 8, look.hair)
  R(c, hx + 5, y - 9, 3, 1, '#2a2230')
  R(c, hx + 8, y - 7, 2, 2, look.skinDark)
  if (look.badge === 'gafas' && !enCama) R(c, hx + 4, y - 10, 5, 3, '#2f3648')

  if (!enCama) {
    // pies asomando, y el vaso, que de vez en cuando se lleva a la boca
    R(c, x + w / 2, y - 9, 5, 6, look.skin)
    const bebe = clk % 14 < 1.4
    const vx = bebe ? hx + 11 : x + 2
    const vy = bebe ? y - 17 : y - 21
    R(c, vx, vy, 6, 8, '#f0c860')
    R(c, vx, vy, 6, 2, '#fff0c4')
    if (bebe) R(c, hx + 9, y - 10, 3, 3, look.skin)
  } else {
    // almohada
    R(c, hx - 4, y - 15, 6, 12, '#e4e9f5')
  }
}
