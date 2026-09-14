/**
 * Lectura de las respuestas HTTP de los proveedores. La comparten el chat de
 * siempre y el modo agente, que hablan con los mismos servidores.
 */

/** Lee un cuerpo SSE/NDJSON línea a línea sin cargarlo entero en memoria. */
export async function* lines(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (line) yield line
    }
  }
  if (buffer.trim()) yield buffer.trim()
}

/** El mensaje de error que manda el proveedor, sea cual sea su formato. */
export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text)
    return j.error?.message || (typeof j.error === 'string' ? j.error : '') || j.error?.type || j.message || text.slice(0, 500)
  } catch {
    return text.slice(0, 500) || `HTTP ${res.status}`
  }
}
