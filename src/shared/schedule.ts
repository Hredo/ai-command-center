/**
 * Cuándo toca una tarea programada. Lo usan el programador (main) y la
 * pantalla de Tareas, que enseña la próxima hora: tienen que decir lo mismo.
 */
import type { ScheduledTask } from './types'

type When = Pick<ScheduledTask, 'repeat' | 'time' | 'weekday' | 'everyHours'>

export const DEFAULT_SCHEDULE_TIME = '03:00'

/** «07:30» → [7, 30]; lo que no se entienda, a la hora por omisión. */
export function parseTime(time: string | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '').trim())
  const h = m ? Number(m[1]) : NaN
  const min = m ? Number(m[2]) : NaN
  if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return [h, min]
  const [dh, dm] = DEFAULT_SCHEDULE_TIME.split(':').map(Number)
  return [dh, dm]
}

/**
 * La primera vez que toca estrictamente después de `after` (hora local; los
 * cambios de hora no la mueven). Por horas cuenta desde `after`, que es la
 * última vez que corrió (o cuando se creó).
 */
export function nextRun(s: When, after: number): number | null {
  if (s.repeat === 'hourly') {
    const h = Math.min(168, Math.max(1, Math.round(Number(s.everyHours) || 1)))
    return after + h * 3600_000
  }
  const [hh, mm] = parseTime(s.time)
  const d = new Date(after)
  d.setHours(hh, mm, 0, 0)
  if (d.getTime() <= after) {
    d.setDate(d.getDate() + 1)
    d.setHours(hh, mm, 0, 0)
  }
  const weekday = Math.min(6, Math.max(0, Math.round(Number(s.weekday ?? 1))))
  for (let i = 0; i < 8; i++) {
    const day = d.getDay()
    const ok =
      s.repeat === 'daily' ||
      (s.repeat === 'weekdays' && day >= 1 && day <= 5) ||
      (s.repeat === 'weekly' && day === weekday)
    if (ok) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(hh, mm, 0, 0)
  }
  return null
}
