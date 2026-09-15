import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

let root: string | null = null

/** Carpeta de datos de la app; se crea al vuelo la primera vez. */
export function dataDir(): string {
  if (!root) {
    root = join(app.getPath('userData'), 'data')
    mkdirSync(root, { recursive: true })
  }
  return root
}

/**
 * Carpeta donde trabaja un agente cuando no hay proyecto elegido. Un agente
 * siempre trabaja con herramientas, y éstas necesitan una raíz de la que no
 * salir: ésta es la suya. Se crea al vuelo.
 */
export function agentWorkspace(id?: string): string {
  const dir = join(dataDir(), 'espacios', (id || 'consola').replace(/[^\w.-]/g, '_'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export const paths = {
  get config() { return join(dataDir(), 'config.json') },
  get secrets() { return join(dataDir(), 'secrets.json') },
  get runs() { return join(dataDir(), 'runs.jsonl') },
  get modelCache() { return join(dataDir(), 'models-cache.json') },
  get sessions() { return join(dataDir(), 'sessions.json') },
  get dir() { return dataDir() }
}
