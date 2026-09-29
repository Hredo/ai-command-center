/**
 * De una carpeta a uno de tus proyectos.
 *
 * Una ejecución sabe dónde corrió, pero no siempre a qué proyecto pertenece:
 * las sesiones de Claude Code que abres en una terminal sólo traen su carpeta,
 * y la Arena lanza agentes con una ruta suelta. Sin el id del proyecto no
 * cuentan en su gasto ni salen en su lista. Aquí se busca el proyecto dado de
 * alta que contiene esa carpeta —el más profundo, si hay varios anidados— para
 * que todo lo que se haga dentro de él se le apunte.
 */
import { resolve, sep } from 'node:path'
import { getConfig } from './config'
import type { Project } from '@shared/types'

function norm(p: string): string {
  let out = resolve(p)
  if (out.length > 1 && out.endsWith(sep)) out = out.slice(0, -1)
  // En Windows y en macOS el sistema de ficheros no distingue mayúsculas.
  return process.platform === 'linux' ? out : out.toLowerCase()
}

export function projectForPath(path: string | undefined | null): Project | undefined {
  if (!path || !path.trim()) return undefined
  let target: string
  try {
    target = norm(path)
  } catch {
    return undefined
  }
  let best: Project | undefined
  let bestLen = -1
  for (const p of getConfig().projects) {
    if (!p.path) continue
    const base = norm(p.path)
    const inside = target === base || target.startsWith(base + sep)
    if (inside && base.length > bestLen) {
      best = p
      bestLen = base.length
    }
  }
  return best
}
