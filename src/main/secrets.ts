import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { paths } from './paths'
import { PROVIDERS } from './providers/catalog'
import type { KeySource } from '@shared/types'

type Store = Record<string, string>

function read(): Store {
  if (!existsSync(paths.secrets)) return {}
  try {
    return JSON.parse(readFileSync(paths.secrets, 'utf8'))
  } catch {
    return {}
  }
}

function write(s: Store): void {
  writeFileSync(paths.secrets, JSON.stringify(s, null, 2), 'utf8')
}

/**
 * ¿Hay cifrado de verdad? En Windows es DPAPI y en macOS el Llavero. En Linux
 * depende de que haya un llavero en la sesión (GNOME Keyring, KWallet): sin
 * él, Electron dice que cifra, pero lo hace con una clave fija que viene
 * dentro de Chromium, así que eso no se cuenta como cifrado.
 */
export function strongEncryption(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform !== 'linux') return true
  try {
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
  } catch {
    return false
  }
}

/**
 * Guarda la key cifrada con la API de credenciales del SO (DPAPI en Windows,
 * el Llavero en macOS, el llavero de la sesión en Linux). Si el cifrado no
 * está disponible cae a base64, que no es seguridad real pero evita dejar la
 * key en claro por accidente.
 */
export function setKey(providerId: string, key: string): void {
  const store = read()
  if (!key) {
    delete store[providerId]
  } else if (strongEncryption()) {
    store[providerId] = 'enc:' + safeStorage.encryptString(key).toString('base64')
  } else {
    store[providerId] = 'b64:' + Buffer.from(key, 'utf8').toString('base64')
  }
  write(store)
}

function decode(value: string): string {
  if (value.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  return value
}

export function getStoredKey(providerId: string): string {
  const v = read()[providerId]
  return v ? decode(v) : ''
}

/** Busca la key en el almacén y, si no está, en las variables de entorno. */
export function resolveKey(providerId: string): { key: string; source: KeySource; envVar?: string } {
  const stored = getStoredKey(providerId)
  if (stored) return { key: stored, source: 'stored' }
  const def = PROVIDERS.find((p) => p.id === providerId)
  for (const name of def?.envKeys ?? []) {
    const v = process.env[name]
    if (v && v.trim()) return { key: v.trim(), source: 'env', envVar: name }
  }
  return { key: '', source: 'none' }
}

export function listKeyStatus(): Record<string, KeySource> {
  const out: Record<string, KeySource> = {}
  for (const p of PROVIDERS) out[p.id] = resolveKey(p.id).source
  return out
}

export function mask(key: string): string {
  if (!key) return ''
  if (key.length <= 10) return key.slice(0, 2) + '****'
  return key.slice(0, 5) + '...' + key.slice(-4)
}
