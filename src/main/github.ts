/**
 * GitHub a través de su CLI oficial (`gh`).
 *
 * La sesión se inicia con `gh auth login --web`: se abre el navegador y la
 * autorizas tú. La aplicación no ve ni pide tu contraseña ni tu token en
 * ningún momento; sólo pregunta a `gh` si ya hay sesión y con qué cuenta. Ese
 * es el motivo de usar el CLI en vez de pedir credenciales: el secreto se
 * queda donde debe estar.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { GhRepo, GhStatus } from '@shared/types'

/** Sitios donde winget y el instalador dejan gh, por si no está en el PATH. */
const GH_CANDIDATES = [
  'C:\\Program Files\\GitHub CLI\\gh.exe',
  'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
  `${process.env['LOCALAPPDATA'] ?? ''}\\Microsoft\\WindowsApps\\gh.exe`,
  '/usr/bin/gh',
  '/usr/local/bin/gh',
  '/opt/homebrew/bin/gh'
]

let ghPathMemo: string | null | undefined

function run(
  file: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {}
): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, timeout: opts.timeout ?? 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: (stdout ?? '').toString(), err: (stderr ?? '').toString().trim() })
      }
    )
  })
}

/** Ruta de gh: primero el PATH, luego los sitios habituales. */
export async function ghPath(): Promise<string | null> {
  if (ghPathMemo !== undefined) return ghPathMemo
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const found = await run(finder, ['gh'], { timeout: 6000 })
  if (found.ok && found.out.trim()) {
    ghPathMemo = found.out.split(/\r?\n/)[0].trim()
    return ghPathMemo
  }
  ghPathMemo = GH_CANDIDATES.find((p) => p && existsSync(p)) ?? null
  return ghPathMemo
}

/** Se olvida la ruta memorizada: útil justo después de instalarlo. */
export function forgetGhPath(): void {
  ghPathMemo = undefined
}

export async function ghStatus(): Promise<GhStatus> {
  const gh = await ghPath()
  if (!gh) {
    return {
      installed: false,
      authed: false,
      hint: 'GitHub CLI no está instalado. Se instala con: winget install --id GitHub.cli'
    }
  }

  const [version, user] = await Promise.all([
    run(gh, ['--version'], { timeout: 8000 }),
    // Una llamada a la API es la prueba de fuego: si contesta, la sesión vale.
    run(gh, ['api', 'user', '--jq', '{login: .login, name: .name, url: .html_url}'], { timeout: 15000 })
  ])

  const status: GhStatus = {
    installed: true,
    path: gh,
    version: version.ok ? (version.out.split(/\r?\n/)[0] ?? '').replace('gh version ', '').trim() : undefined,
    authed: false
  }

  if (user.ok && user.out.trim()) {
    try {
      const me = JSON.parse(user.out)
      status.authed = true
      status.login = me.login
      status.name = me.name ?? undefined
      status.url = me.url ?? undefined
    } catch {
      status.authed = false
    }
  } else {
    status.hint = 'Sin sesión. Pulsa «Iniciar sesión» y autoriza en el navegador.'
  }

  if (status.authed) {
    const scopes = await run(gh, ['auth', 'status'], { timeout: 12000 })
    const line = (scopes.out + '\n' + scopes.err).split(/\r?\n/).find((l) => l.includes('Token scopes'))
    if (line) status.scopes = line.split(':').slice(1).join(':').trim()
  }

  return status
}

/**
 * El comando que inicia sesión. No se ejecuta aquí a propósito: se manda a la
 * terminal integrada, donde el proceso puede hacer sus preguntas y abrir el
 * navegador, y donde tú ves exactamente lo que pasa.
 */
export function ghLoginCommand(): string {
  return 'gh auth login --web --git-protocol https'
}

export function ghLogoutCommand(): string {
  return 'gh auth logout'
}

/** Tus repositorios, los más recientes primero. */
export async function ghRepos(opts: { limit?: number; query?: string } = {}): Promise<GhRepo[]> {
  const gh = await ghPath()
  if (!gh) return []
  const limit = Math.min(200, Math.max(1, opts.limit ?? 60))
  const fields = 'nameWithOwner,description,isPrivate,isFork,isArchived,primaryLanguage,updatedAt,pushedAt,stargazerCount,url,defaultBranchRef,diskUsage'

  const args = opts.query?.trim()
    ? ['search', 'repos', opts.query.trim(), '--owner', '@me', '--limit', String(limit), '--json', fields]
    : ['repo', 'list', '--limit', String(limit), '--json', fields]

  const r = await run(gh, args, { timeout: 30000 })
  if (!r.ok || !r.out.trim()) return []
  try {
    const rows = JSON.parse(r.out) as any[]
    return rows.map((x) => ({
      nameWithOwner: x.nameWithOwner,
      description: x.description || undefined,
      private: Boolean(x.isPrivate),
      fork: Boolean(x.isFork),
      archived: Boolean(x.isArchived),
      language: x.primaryLanguage?.name || undefined,
      updatedAt: Date.parse(x.pushedAt || x.updatedAt) || undefined,
      stars: x.stargazerCount ?? 0,
      url: x.url,
      defaultBranch: x.defaultBranchRef?.name || undefined,
      sizeKb: x.diskUsage ?? undefined
    }))
  } catch {
    return []
  }
}

/**
 * Clona un repositorio. Devuelve la carpeta resultante para poder darla de
 * alta como proyecto en el mismo gesto.
 */
export async function ghClone(
  nameWithOwner: string,
  parentDir: string
): Promise<{ ok: boolean; detail: string; path?: string }> {
  const gh = await ghPath()
  if (!gh) return { ok: false, detail: 'GitHub CLI no está instalado' }
  if (!existsSync(parentDir)) return { ok: false, detail: 'la carpeta de destino no existe' }
  if (!/^[\w.-]+\/[\w.-]+$/.test(nameWithOwner)) return { ok: false, detail: 'nombre de repositorio no válido' }

  const folder = nameWithOwner.split('/')[1]
  const dest = `${parentDir.replace(/[\\/]+$/, '')}\\${folder}`.replace(/\\/g, process.platform === 'win32' ? '\\' : '/')
  if (existsSync(dest)) return { ok: false, detail: `ya existe una carpeta ${folder} ahí` }

  // Un repositorio grande tarda: cinco minutos de margen.
  const r = await run(gh, ['repo', 'clone', nameWithOwner, dest], { timeout: 300000 })
  if (!r.ok) return { ok: false, detail: r.err || 'gh repo clone falló' }
  return { ok: true, detail: r.err || 'clonado', path: dest }
}
