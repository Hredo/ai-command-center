/**
 * Un mensaje con imágenes, en el formato de cada dialecto.
 *
 * Sin imágenes el contenido sigue siendo texto: así se manda igual que antes y
 * los servidores compatibles que no entienden partes no se enteran.
 */
import { readImage } from '../attach'
import { modelCapabilities } from '../ollama'
import { modelModalities } from './models'
import type { ChatMessage, ProviderDef } from '@shared/types'

function loaded(m: ChatMessage): { mime: string; data: string }[] {
  return (m.images ?? []).map(readImage).filter((x): x is { mime: string; data: string } => Boolean(x))
}

/** Anthropic: las imágenes delante del texto, como recomienda su guía. */
export function anthropicContent(m: ChatMessage): unknown {
  const imgs = loaded(m)
  if (!imgs.length) return m.content
  return [
    ...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
    { type: 'text', text: m.content || '(imagen)' }
  ]
}

/** OpenAI y compatibles: partes `text` e `image_url` con la imagen en data URL. */
export function openAiContent(m: ChatMessage): unknown {
  const imgs = loaded(m)
  if (!imgs.length) return m.content
  return [
    { type: 'text', text: m.content },
    ...imgs.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))
  ]
}

/** Gemini: `inlineData` junto al texto. */
export function googleParts(m: ChatMessage): unknown[] {
  return [{ text: m.content }, ...loaded(m).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))]
}

/** Ollama: base64 sin cabecera en `images` del mismo mensaje. */
export function ollamaImages(m: ChatMessage): string[] | undefined {
  const imgs = loaded(m)
  return imgs.length ? imgs.map((i) => i.data) : undefined
}

/**
 * Si el modelo acepta imágenes. Con Ollama, lo que diga su ficha; con el
 * resto, las modalidades del catálogo. Sin dato se intenta: si no puede, el
 * proveedor lo dice y se ve el error.
 */
export async function acceptsImages(def: ProviderDef | undefined, providerId: string, model: string): Promise<boolean> {
  if (def?.kind === 'ollama') {
    const caps = await modelCapabilities(model)
    return caps.length ? caps.includes('vision') : true
  }
  const modalities = modelModalities(providerId, model)
  return modalities?.length ? modalities.includes('image') : true
}
