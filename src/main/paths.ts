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

export const paths = {
  get config() { return join(dataDir(), 'config.json') },
  get secrets() { return join(dataDir(), 'secrets.json') },
  get runs() { return join(dataDir(), 'runs.jsonl') },
  get modelCache() { return join(dataDir(), 'models-cache.json') },
  get sessions() { return join(dataDir(), 'sessions.json') },
  get dir() { return dataDir() }
}
