/**
 * A qué ritmo se gasta cada cupo y cuándo llegaría al tope.
 *
 * Con varias lecturas del mismo cupo dentro de la misma ventana se usa la
 * pendiente de la última hora, que es el ritmo de ahora. Si todavía no hay
 * bastantes, y se sabe cuándo empezó la ventana, se usa la media desde el
 * principio. Sin tope no hay hora de llegada: sólo el ritmo.
 *
 * El ritmo va en la unidad de `used` si el cupo la tiene y, si no, en puntos
 * de porcentaje por hora.
 */
import type { Quota } from '@shared/types'

interface Sample {
  t: number
  v: number
}

const HOUR = 3600_000
const MIN_SPAN = 10 * 60_000
const samples = new Map<string, { win: string; list: Sample[] }>()

function valueOf(q: Quota): number | undefined {
  return q.used ?? q.usedPct
}

function ceiling(q: Quota): number | undefined {
  if (q.used != null) return q.limit
  return q.usedPct != null ? 100 : undefined
}

/** Guarda la lectura y devuelve el cupo con su proyección. */
export function project(q: Quota, now = Date.now()): Quota {
  const v = valueOf(q)
  if (v == null || q.stale || q.error) return q
  // Un saldo sin tope (DeepSeek, Kimi) no se proyecta: no hay «hasta dónde».
  if (q.kind === 'balance' && ceiling(q) == null) return q

  const win = q.resetsAt ? String(Math.round(q.resetsAt / 60_000)) : 'móvil'
  let entry = samples.get(q.id)
  if (!entry || entry.win !== win) {
    entry = { win, list: [] }
    samples.set(q.id, entry)
  }
  const list = entry.list
  const last = list[list.length - 1]
  // Si baja sin cambiar de ventana (ventana móvil, un saldo que recargas) el
  // ritmo de antes ya no vale.
  if (last && v < last.v) list.length = 0
  if (!last || v !== last.v || now - last.t > 5 * 60_000) list.push({ t: now, v })
  while (list.length > 2 && now - list[0].t > 6 * HOUR) list.shift()
  if (list.length > 400) list.splice(0, list.length - 400)

  let rate: number | undefined
  const recent = list.filter((s) => now - s.t <= HOUR)
  const pick = recent.length >= 2 ? recent : list
  if (pick.length >= 2) {
    const a = pick[0]
    const b = pick[pick.length - 1]
    if (b.t - a.t >= MIN_SPAN) rate = ((b.v - a.v) / (b.t - a.t)) * HOUR
  }
  if (rate == null && q.windowMs && q.resetsAt) {
    const start = q.resetsAt - q.windowMs
    if (now - start >= MIN_SPAN && now < q.resetsAt) rate = (v / (now - start)) * HOUR
  }
  if (rate == null || rate <= 0) return q

  const top = ceiling(q)
  let etaAt: number | undefined
  if (top != null && top > v) etaAt = now + ((top - v) / rate) * HOUR
  else if (top != null) etaAt = now
  return {
    ...q,
    projection: {
      ratePerHour: rate,
      etaAt,
      hitsBeforeReset: etaAt != null && q.resetsAt ? etaAt < q.resetsAt : undefined
    }
  }
}

/** Para las pruebas. */
export function resetSamples(): void {
  samples.clear()
}
