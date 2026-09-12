/**
 * Archivos adjuntos al prompt.
 *
 * A un modelo por API hay que darle el contenido: no puede abrir nada. A un
 * agente de línea de comandos le basta la ruta, porque tiene sus propias
 * herramientas para leer y encima así no se infla el prompt. Por eso el mismo
 * adjunto se compone de dos maneras.
 */
import { dialog } from 'electron'
import { basename, extname } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import type { Attachment } from '@shared/types'

/** Por archivo y en total, para no reventar la ventana de contexto. */
const MAX_FILE_BYTES = 96 * 1024
const MAX_TOTAL_BYTES = 320 * 1024

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.node', '.mp3', '.mp4', '.mov', '.avi', '.wav', '.ogg',
  '.ttf', '.otf', '.woff', '.woff2', '.class', '.jar', '.pyc', '.wasm', '.db', '.sqlite'
])

function looksBinary(path: string): boolean {
  if (BINARY_EXT.has(extname(path).toLowerCase())) return true
  try {
    const fd = readFileSync(path, { encoding: null }).subarray(0, 4096)
    return fd.includes(0)
  } catch {
    return false
  }
}

export function describeFile(path: string): Attachment {
  let bytes = 0
  try {
    bytes = statSync(path).size
  } catch {
    return { path, name: basename(path), bytes: 0, text: false, skipped: 'no se pudo leer' }
  }
  const binary = looksBinary(path)
  const att: Attachment = { path, name: basename(path), bytes, text: !binary }
  if (binary) {
    att.skipped = 'binario: se manda la ruta, no el contenido'
    return att
  }
  if (bytes > MAX_FILE_BYTES) att.skipped = `pasa de ${Math.round(MAX_FILE_BYTES / 1024)} KB: se recorta`
  try {
    const buf = readFileSync(path, 'utf8')
    att.lines = buf.length ? buf.split('\n').length : 0
  } catch {
    att.text = false
    att.skipped = 'no se pudo leer'
  }
  return att
}

export async function pickAttachments(): Promise<Attachment[]> {
  const r = await dialog.showOpenDialog({
    title: 'Adjuntar archivos al prompt',
    properties: ['openFile', 'multiSelections'],
    buttonLabel: 'Adjuntar'
  })
  if (r.canceled) return []
  return r.filePaths.map(describeFile)
}

function fence(path: string): string {
  const ext = extname(path).toLowerCase().slice(1)
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json', md: 'md', py: 'python',
    rs: 'rust', go: 'go', java: 'java', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
    sh: 'bash', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql',
    html: 'html', css: 'css', scss: 'scss', vue: 'vue', svelte: 'svelte', astro: 'astro'
  }
  return map[ext] ?? ''
}

/**
 * Prompt final con los adjuntos.
 *
 * `mode` 'api' mete el contenido; 'cli' se queda en las rutas. Los recortes se
 * anuncian dentro del propio bloque para que el modelo sepa que no lo tiene
 * todo.
 */
export function composePrompt(prompt: string, attachments: Attachment[] | undefined, mode: 'api' | 'cli'): string {
  if (!attachments?.length) return prompt

  if (mode === 'cli') {
    const list = attachments.map((a) => `- ${a.path}`).join('\n')
    return `${prompt}\n\nArchivos adjuntos (ábrelos con tus herramientas):\n${list}\n`
  }

  let used = 0
  const parts: string[] = []
  for (const a of attachments) {
    if (!a.text) {
      parts.push(`Adjunto no textual, sólo la ruta: ${a.path} (${a.bytes} bytes)`)
      continue
    }
    if (used >= MAX_TOTAL_BYTES) {
      parts.push(`Adjunto omitido por tamaño total: ${a.path}`)
      continue
    }
    let body: string
    try {
      body = readFileSync(a.path, 'utf8')
    } catch (e: any) {
      parts.push(`No se pudo leer ${a.path}: ${e?.message ?? e}`)
      continue
    }
    const room = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - used)
    let note = ''
    if (body.length > room) {
      body = body.slice(0, room)
      note = `\n… recortado: se envían ${room} de ${a.bytes} bytes`
    }
    used += body.length
    parts.push(`Archivo: ${a.path}${note}\n\`\`\`${fence(a.path)}\n${body}\n\`\`\``)
  }

  return `${prompt}\n\n--- Adjuntos ---\n${parts.join('\n\n')}\n`
}
