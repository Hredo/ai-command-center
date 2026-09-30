/**
 * Aviso de versión nueva.
 *
 * Mira la última versión publicada en GitHub (su API pública, sin cuenta ni
 * token) al arrancar y cada seis horas, y si es más nueva que la instalada lo
 * dice: la barra de arriba, un aviso y Ajustes, con las notas y la descarga de
 * este sistema. No descarga ni instala nada por su cuenta: la app no va
 * firmada, así que una actualización silenciosa no funcionaría en macOS y en
 * Windows la bloquearía Smart App Control. La descarga la hace el navegador.
 */
import { app } from 'electron'
import { getConfig } from './config'
import type { UpdateDownload, UpdateInfo } from '@shared/types'

const REPO = 'Hredo/ai-command-center'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const DOWNLOADS = `https://github.com/${REPO}/releases/`
const EVERY_MS = 6 * 3600_000
const TIMEOUT_MS = 10_000

let last: UpdateInfo | null = null
let timers: NodeJS.Timeout[] = []
let inFlight: Promise<UpdateInfo> | null = null

/**
 * Las pruebas apuntan a un servidor falso con ACC_RELEASES_URL. Sólo vale en
 * local: nadie puede redirigir el aviso a otro sitio con una variable.
 */
function apiUrl(): string {
  const o = process.env['ACC_RELEASES_URL']
  return o && /^http:\/\/127\.0\.0\.1:\d+\//.test(o) ? o : API
}

/** «v0.10.0» > «0.9.2» > «0.9.2-beta.1». Números de cada parte; lo prerelease, antes. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, ...rest] = v.trim().replace(/^v/i, '').split('-')
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: rest.join('-') }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

/** Las descargas de este sistema y arquitectura, la recomendada primero. */
export function pickDownloads(
  assets: { name: string; browser_download_url: string; size: number }[],
  platform: string,
  arch: string,
  local = false
): UpdateDownload[] {
  const safe = assets.filter((a) => local || String(a.browser_download_url).startsWith(DOWNLOADS))
  const out: UpdateDownload[] = []
  const add = (re: RegExp, kind: UpdateDownload['kind']): void => {
    const a = safe.find((x) => re.test(x.name))
    if (a) out.push({ name: a.name, url: a.browser_download_url, size: a.size, kind })
  }
  if (platform === 'win32') {
    add(/Setup-.*\.exe$/i, 'installer')
    add(/-x64\.zip$/i, 'portable')
  } else if (platform === 'darwin') {
    add(arch === 'arm64' ? /-mac-arm64\.dmg$/i : /-mac-x64\.dmg$/i, 'dmg')
  } else {
    const a = arch === 'arm64' ? 'arm64' : '(x86_64|amd64)'
    add(new RegExp(`-linux-${a}\\.AppImage$`, 'i'), 'appimage')
    add(new RegExp(`-linux-${a === 'arm64' ? 'arm64' : 'amd64'}\\.deb$`, 'i'), 'deb')
  }
  add(/SHA256SUMS/i, 'checksums')
  return out
}

async function fetchLatest(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const base: UpdateInfo = { current, newer: false, downloads: [], checkedAt: Date.now() }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const url = apiUrl()
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/vnd.github+json', 'user-agent': `ai-command-center/${current}` }
    })
    if (res.status === 403 || res.status === 429) return { ...base, error: 'GitHub ha limitado las consultas; se vuelve a mirar más tarde' }
    if (!res.ok) return { ...base, error: 'GitHub respondió con un error' }
    const r = (await res.json()) as {
      tag_name?: string
      html_url?: string
      published_at?: string
      body?: string
      draft?: boolean
      prerelease?: boolean
      assets?: { name: string; browser_download_url: string; size: number }[]
    }
    const latest = String(r.tag_name ?? '').replace(/^v/i, '')
    if (!latest || r.draft) return { ...base, error: 'No hay ninguna versión publicada' }
    const newer = compareVersions(latest, current) > 0
    const skipped = getConfig().settings.skippedVersion === latest
    const local = url !== API
    const page = String(r.html_url ?? '')
    return {
      ...base,
      latest,
      newer,
      skipped: newer && skipped,
      url: local || page.startsWith(DOWNLOADS) ? page : `${DOWNLOADS}tag/v${latest}`,
      publishedAt: r.published_at,
      notes: String(r.body ?? '').slice(0, 6000),
      downloads: pickDownloads(r.assets ?? [], process.platform, process.arch, local)
    }
  } catch (err: any) {
    return { ...base, error: err?.name === 'AbortError' ? 'GitHub no contestó a tiempo' : 'Sin conexión con GitHub' }
  } finally {
    clearTimeout(t)
  }
}

/** Mira ya (o se une a la consulta que esté en marcha). */
export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!inFlight) {
    inFlight = fetchLatest().finally(() => {
      inFlight = null
    })
  }
  last = await inFlight
  return last
}

export function lastUpdate(): UpdateInfo | null {
  if (!last) return null
  // «Omitir esta versión» se nota sin volver a preguntar a GitHub.
  const skipped = Boolean(last.newer && last.latest && getConfig().settings.skippedVersion === last.latest)
  return { ...last, skipped }
}

/**
 * Al arrancar (tras un respiro, para no competir con la carga) y cada seis
 * horas, si está activado en Ajustes. `onFound` recibe cada resultado.
 */
export function startUpdateChecks(onResult: (u: UpdateInfo) => void): void {
  stopUpdateChecks()
  const run = (): void => {
    if (getConfig().settings.checkUpdates === false) return
    void checkForUpdate().then(onResult)
  }
  timers = [setTimeout(run, 15_000), setInterval(run, EVERY_MS)]
  for (const t of timers) t.unref?.()
}

export function stopUpdateChecks(): void {
  for (const t of timers) clearTimeout(t)
  timers = []
}
