/**
 * Archivos adjuntos al prompt.
 *
 * A un modelo por API hay que darle el contenido: no puede abrir nada. A un
 * agente de línea de comandos le basta la ruta, porque tiene sus propias
 * herramientas para leer y encima así no se infla el prompt. Por eso el mismo
 * adjunto se compone de dos maneras.
 */
import { dialog, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { paths } from './paths'
import type { Attachment, ChatMessage, ImageRef } from '@shared/types'

/** Por archivo y en total, para no reventar la ventana de contexto. */
const MAX_FILE_BYTES = 96 * 1024
const MAX_TOTAL_BYTES = 320 * 1024

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.node', '.mp3', '.mp4', '.mov', '.avi', '.wav', '.ogg',
  '.ttf', '.otf', '.woff', '.woff2', '.class', '.jar', '.pyc', '.wasm', '.db', '.sqlite'
])

/**
 * Imágenes que los modelos con visión aceptan tal cual (Anthropic, OpenAI,
 * Gemini y Ollama coinciden en estas cuatro). Van como imagen, no como ruta.
 */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
/** El tope más bajo de los proveedores (Anthropic: 5 MB por imagen). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Imágenes por petición, contando las del historial: las más recientes. */
const MAX_IMAGES = 8

export function imageMime(path: string): string | undefined {
  return IMAGE_MIME[extname(path).toLowerCase()]
}

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
  const mime = imageMime(path)
  if (mime) {
    const att: Attachment = { path, name: basename(path), bytes, text: false, image: true, mime }
    if (bytes > MAX_IMAGE_BYTES) att.skipped = `imagen de más de ${MAX_IMAGE_BYTES / 1024 / 1024} MB: se manda la ruta`
    return att
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
  // Sólo texto: las imágenes como imagen las mete `composeMessages`.
  return composeMessages([{ role: 'user', content: prompt, attachments }], { images: false })[0].content
}

/* ------------------------------------------------------------------ *
 * Imágenes                                                           *
 * ------------------------------------------------------------------ */

const PASTE_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }

/**
 * Guarda una imagen pegada desde el portapapeles en la carpeta de datos de la
 * app (no en el proyecto: no ensucia el repositorio) y la describe como
 * cualquier adjunto.
 */
export function savePastedImage(data: Uint8Array, mime: string): Attachment {
  const ext = PASTE_TYPES[mime]
  if (!ext) throw new Error('Sólo se pueden pegar imágenes PNG, JPEG, GIF o WebP')
  if (!data?.byteLength) throw new Error('La imagen está vacía')
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error(`La imagen pasa de ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
  const dir = join(paths.dir, 'pegados')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `pegada-${stamp}-${randomUUID().slice(0, 6)}${ext}`)
  writeFileSync(file, Buffer.from(data))
  return describeFile(file)
}

/** Miniatura para enseñarla en la interfaz, sin darle al renderer acceso al disco. */
export function imageThumb(path: string, size = 160): string | null {
  if (!imageMime(path)) return null
  try {
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const scale = Math.min(1, size / Math.max(width, height))
    return img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }).toDataURL()
  } catch {
    return null
  }
}

/** La imagen en base64, para meterla en la petición. */
export function readImage(ref: ImageRef): { mime: string; data: string } | null {
  try {
    return { mime: ref.mime, data: readFileSync(ref.path).toString('base64') }
  } catch {
    return null
  }
}

/**
 * Los mensajes listos para un modelo por API: cada mensaje del usuario con
 * sus adjuntos de texto dentro y sus imágenes como imágenes.
 *
 * Los del historial también: el modelo no guarda nada entre peticiones, y un
 * archivo adjunto en un turno anterior desaparecía en el siguiente. Hay un
 * presupuesto para todo, del mensaje más nuevo hacia atrás; lo que no cabe
 * se dice en el texto. Sin visión (`images: false`), la imagen va como ruta.
 */
export function composeMessages(messages: ChatMessage[], opts: { images: boolean }): ChatMessage[] {
  let imagesLeft = MAX_IMAGES
  let textLeft = MAX_TOTAL_BYTES
  const out: ChatMessage[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const atts = m.role === 'user' ? (m.attachments ?? []) : []
    if (!atts.length) {
      out.unshift({ role: m.role, content: m.content })
      continue
    }
    const images: ImageRef[] = []
    const notes: string[] = []
    const texts: Attachment[] = []
    for (const a of atts) {
      if (a.image && a.mime && !a.skipped) {
        if (!opts.images) notes.push(`Imagen adjunta (este modelo no acepta imágenes, sólo la ruta): ${a.path}`)
        else if (imagesLeft <= 0) notes.push(`Imagen adjunta omitida por haber muchas en la conversación: ${a.path}`)
        else {
          images.push({ path: a.path, mime: a.mime, name: a.name })
          imagesLeft--
        }
      } else if (a.text) texts.push(a)
      else notes.push(`Adjunto no textual, sólo la ruta: ${a.path} (${a.bytes} bytes)`)
    }
    const parts = texts.length ? textParts(texts, textLeft) : { parts: [], used: 0 }
    textLeft = Math.max(0, textLeft - parts.used)
    const all = [...parts.parts, ...notes]
    let text = all.length ? `${m.content}\n\n--- Adjuntos ---\n${all.join('\n\n')}\n` : m.content
    if (images.length) {
      const names = images.map((x) => x.name ?? x.path).join(', ')
      text += `\n\n(${images.length === 1 ? 'Va una imagen adjunta' : `Van ${images.length} imágenes adjuntas`}: ${names}.)`
    }
    out.unshift({ role: m.role, content: text, images: images.length ? images : undefined })
  }
  return out
}

/** El contenido de los adjuntos de texto, con lo que queda del presupuesto total. */
function textParts(attachments: Attachment[], budget: number): { parts: string[]; used: number } {
  let used = 0
  const parts: string[] = []
  for (const a of attachments) {
    if (used >= budget) {
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
    const room = Math.min(MAX_FILE_BYTES, budget - used)
    let note = ''
    if (body.length > room) {
      body = body.slice(0, room)
      note = `\n… recortado: se envían ${room} de ${a.bytes} bytes`
    }
    used += body.length
    parts.push(`Archivo: ${a.path}${note}\n\`\`\`${fence(a.path)}\n${body}\n\`\`\``)
  }
  return { parts, used }
}
