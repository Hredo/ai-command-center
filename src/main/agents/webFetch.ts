/**
 * `web_fetch`: que un agente por API lea una página web.
 *
 * Descarga la URL —sólo http y https—, la convierte en texto legible y
 * devuelve un trozo acotado: el HTML pierde scripts, estilos y adornos, los
 * títulos quedan con «#», las listas con «-» y los enlaces como «texto (url)».
 *
 * Una redirección dentro del mismo dominio se sigue sola; a otro dominio no:
 * se le dice al modelo, que tendrá que pedirla, y el usuario aprobarla, igual
 * que aprobó la primera.
 */
import type { ToolResult } from './tools'

const TIMEOUT_MS = 20_000
const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const DEFAULT_CHARS = 20_000
const MAX_CHARS = 60_000
const CACHE_MS = 5 * 60_000
const CACHE_MAX = 20

const USER_AGENT = 'Mozilla/5.0 (compatible; AI-Command-Center; +https://github.com/Hredo/ai-command-center)'

interface Page {
  url: string
  status: number
  mime: string
  bytes: number
  /** Pasaba de MAX_BYTES y sólo se leyó el principio. */
  cut: boolean
  title: string
  text: string
  /** No es texto: sólo se dice qué es. */
  binary: boolean
}

/** Últimas páginas leídas: seguir con offset no vuelve a descargar. */
const cache = new Map<string, { at: number; page: Page }>()

/**
 * El dominio que se aprueba: el nombre del servidor en minúsculas y sin
 * «www.». `null` si la URL no es http ni https.
 */
export function fetchHost(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * HTML → texto                                                       *
 * ------------------------------------------------------------------ */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', middot: '·', bull: '•', copy: '©', reg: '®',
  trade: '™', deg: '°', times: '×', divide: '÷', euro: '€', pound: '£', yen: '¥', cent: '¢',
  sect: '§', para: '¶', iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º', plusmn: '±', micro: 'µ',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', le: '≤', ge: '≥',
  ne: '≠', minus: '−', infin: '∞', check: '✓', zwj: '', zwnj: '', lrm: '', rlm: '',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', yacute: 'ý',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Yacute: 'Ý',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  Agrave: 'À', Egrave: 'È', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', yuml: 'ÿ',
  Auml: 'Ä', Euml: 'Ë', Iuml: 'Ï', Ouml: 'Ö', Uuml: 'Ü',
  ntilde: 'ñ', Ntilde: 'Ñ', ccedil: 'ç', Ccedil: 'Ç', atilde: 'ã', otilde: 'õ',
  aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', szlig: 'ß'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[name] ?? NAMED[name.toLowerCase()] ?? m
  })
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '')

const BLOCK =
  /<\/?(?:p|div|section|article|header|footer|nav|aside|main|ul|ol|dl|dt|dd|table|thead|tbody|tfoot|tr|blockquote|figure|figcaption|form|fieldset|details|summary|address|caption)\b[^>]*>/gi

/** Texto legible de una página HTML, con su título aparte. */
export function htmlToText(html: string, base?: string): { title: string; text: string } {
  let s = html.replace(/\u0000/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const title = decodeEntities(stripTags(/<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s)?.[1] ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/<(script|style|noscript|svg|template|iframe|head|object|canvas|math|select)\b[\s\S]*?<\/\1\s*>/gi, ' ')

  // Los bloques <pre> conservan su espaciado: se apartan y vuelven al final.
  const pres: string[] = []
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, inner: string) => {
    pres.push(decodeEntities(stripTags(inner.replace(/<br\s*\/?>/gi, '\n'))).replace(/^\n+|\s+$/g, ''))
    return `\n\u0000${pres.length - 1}\u0000\n`
  })

  const attr = (attrs: string, name: string): string => {
    const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)
    return decodeEntities(m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim()
  }
  s = s.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const alt = attr(attrs, 'alt')
    return alt ? ` [imagen: ${alt}] ` : ' '
  })
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_m, attrs: string, inner: string) => {
    const raw = attr(attrs, 'href')
    if (!raw || raw.startsWith('#') || /^(javascript|data|tel):/i.test(raw)) return inner
    let abs = raw
    try {
      abs = new URL(raw, base).toString()
    } catch {
      /* se queda como venía */
    }
    const plain = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
    if (!plain) return inner.trim() ? `${inner} (${abs})` : ''
    if (plain === raw || plain === abs || plain.replace(/\/$/, '') === abs.replace(/\/$/, '')) return abs
    return `${inner} (${abs})`
  })

  s = s
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n---\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<t[dh]\b[^>]*>/gi, ' | ')
    .replace(/<\/?code\b[^>]*>/gi, '`')
    .replace(BLOCK, '\n')
  s = decodeEntities(stripTags(s))
    .replace(/[ \t\f\v \r]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/``/g, '')
    .trim()
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => '```\n' + (pres[Number(i)] ?? '') + '\n```')
  return { title, text: s }
}

/* ------------------------------------------------------------------ *
 * Descarga                                                           *
 * ------------------------------------------------------------------ */

const TEXTUAL = /^(text\/|application\/(.*\+)?(json|xml|javascript|ecmascript|x-yaml|yaml|toml|x-sh|x-www-form-urlencoded|graphql|ld\+json))/

function charsetOf(mime: string, head: Uint8Array, html: boolean): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(mime)?.[1]
  if (fromHeader) return fromHeader
  if (html) {
    const sniff = Buffer.from(head.subarray(0, 2048)).toString('latin1')
    const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(sniff)?.[1]
    if (meta) return meta
  }
  return 'utf-8'
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

async function readCapped(res: Response): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { bytes: new Uint8Array(), cut: false }
  const chunks: Uint8Array[] = []
  let size = 0
  let cut = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > MAX_BYTES) {
      chunks.push(value.subarray(0, MAX_BYTES - size))
      size = MAX_BYTES
      cut = true
      await reader.cancel().catch(() => undefined)
      break
    }
    chunks.push(value)
    size += value.byteLength
  }
  return { bytes: Buffer.concat(chunks), cut }
}

type Fetched = { page: Page } | { redirect: string; status: number } | { error: string }

function netError(err: any): string {
  const c = err?.cause
  const code = c?.code ?? err?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'no se encuentra ese dominio'
  if (code === 'ECONNREFUSED') return 'el servidor rechaza la conexión'
  if (code === 'ECONNRESET') return 'el servidor cortó la conexión'
  if (typeof code === 'string' && /CERT|SSL|TLS/.test(code)) return `certificado no válido (${code})`
  return c?.message ?? err?.message ?? String(err)
}

async function fetchPage(start: string, signal: AbortSignal): Promise<Fetched> {
  const host = fetchHost(start)
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const both = AbortSignal.any([signal, timeout])
  let url = start
  for (let hop = 0; ; hop++) {
    let res: Response
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: both,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.9,*/*;q=0.5',
          'accept-language': 'es,en;q=0.8'
        }
      })
    } catch (err) {
      if (signal.aborted) throw err
      if (timeout.aborted) return { error: `no respondió en ${TIMEOUT_MS / 1000} s` }
      return { error: netError(err) }
    }

    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined)
      let next: string
      try {
        next = new URL(location, url).toString()
      } catch {
        return { error: `redirige a una dirección no válida: ${location}` }
      }
      const nextHost = fetchHost(next)
      if (!nextHost) return { error: `redirige a ${next}, que no es http ni https` }
      if (nextHost !== host) return { redirect: next, status: res.status }
      if (hop >= MAX_REDIRECTS) return { error: `más de ${MAX_REDIRECTS} redirecciones seguidas` }
      url = next
      continue
    }

    let body: { bytes: Uint8Array; cut: boolean }
    try {
      body = await readCapped(res)
    } catch (err) {
      if (signal.aborted) throw err
      if (timeout.aborted) return { error: `no terminó de llegar en ${TIMEOUT_MS / 1000} s` }
      return { error: netError(err) }
    }
    const type = res.headers.get('content-type') ?? ''
    const mime = type.split(';')[0].trim().toLowerCase()
    const html = mime === 'text/html' || mime === 'application/xhtml+xml'
    const head = body.bytes.subarray(0, 1024)
    const binary = mime ? !TEXTUAL.test(mime) : head.includes(0)
    const page: Page = {
      url,
      status: res.status,
      mime: mime || 'desconocido',
      bytes: body.bytes.byteLength,
      cut: body.cut,
      title: '',
      text: '',
      binary
    }
    if (!binary) {
      const raw = decode(body.bytes, charsetOf(type, body.bytes, html))
      const sniffHtml = html || (!mime && /^\s*(<!doctype html|<html)/i.test(raw))
      if (sniffHtml) {
        const r = htmlToText(raw, url)
        page.title = r.title
        page.text = r.text
      } else {
        page.text = raw.replace(/\r\n/g, '\n').trim()
      }
    }
    return { page }
  }
}

const kb = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function intArg(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : dflt
}

/** La herramienta. Nunca lanza salvo al cancelar: un fallo vuelve al modelo como texto. */
export async function webFetchTool(args: any, signal: AbortSignal): Promise<ToolResult> {
  const url = String(args?.url ?? '').trim()
  if (!url) return { output: 'falta url', isError: true }
  if (!fetchHost(url)) return { output: `«${url}» no es una URL http ni https completa.`, isError: true }
  const maxChars = Math.min(MAX_CHARS, Math.max(1000, intArg(args?.max_chars, DEFAULT_CHARS)))
  const offset = Math.max(0, intArg(args?.offset, 0))

  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k)
  let page = cache.get(url)?.page
  if (!page) {
    const got = await fetchPage(url, signal)
    if ('error' in got) return { output: `No se pudo leer ${url}: ${got.error}.`, isError: true, summary: got.error }
    if ('redirect' in got) {
      return {
        output:
          `${url} redirige (${got.status}) a otro dominio: ${got.redirect}. ` +
          'No se sigue sola: si es la página que buscas, vuelve a llamar a web_fetch con esa URL.',
        isError: false,
        summary: `redirige a ${fetchHost(got.redirect)}`
      }
    }
    page = got.page
    if (page.status < 400) {
      cache.set(url, { at: now, page })
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
    }
  }

  const failed = page.status >= 400
  const head = [
    `URL: ${page.url}`,
    `Estado: ${page.status} · ${page.mime} · ${kb(page.bytes)}` + (page.cut ? ' (pasa de 2 MB: sólo se ha leído el principio)' : ''),
    page.title ? `Título: ${page.title}` : ''
  ].filter(Boolean)

  if (page.binary) {
    const what = page.mime === 'application/pdf' ? 'un PDF' : `un archivo ${page.mime}`
    return {
      output: [...head, '', `Es ${what}: web_fetch sólo lee texto y páginas web.`].join('\n'),
      isError: true,
      summary: `${page.status} · ${page.mime} · no es texto`
    }
  }

  const total = page.text.length
  const from = Math.min(offset, total)
  const to = Math.min(total, from + maxChars)
  const slice = page.text.slice(from, to)
  if (from > 0 || to < total) {
    head.push(
      `Texto: caracteres ${from}–${to} de ${total}.` + (to < total ? ` Para seguir, llama otra vez con offset=${to}.` : ' Es el final.')
    )
  }
  return {
    output: head.join('\n') + '\n\n' + (slice || (total ? '(nada a partir de ese offset)' : '(la página no tiene texto)')),
    isError: failed,
    summary: `${page.status} · ${page.mime} · ${total.toLocaleString('es-ES')} caracteres` + (to < total ? ` (${from}–${to})` : '')
  }
}

/** Para las pruebas: olvidar lo leído. */
export function clearFetchCache(): void {
  cache.clear()
}
