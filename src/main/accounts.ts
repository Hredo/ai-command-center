/**
 * Cuentas: con qué has iniciado sesión y cómo entrar en lo que falta.
 *
 * La app no guarda ni ve la contraseña ni el token de nadie. Cada sesión es
 * la de la herramienta oficial, que es quien la abre y quien la guarda:
 *
 *  - GitHub: `gh auth login --web`. Sin terminal, gh da un código de un solo
 *    uso y la dirección donde escribirlo; la app enseña ese código (no es un
 *    secreto: es lo que tecleas tú en github.com) y espera a que gh termine.
 *  - Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI, Qwen Code, Cursor
 *    CLI, Ollama y Hugging Face: su propio comando de entrada, en una terminal
 *    de la app. Aquí sólo se les pregunta si hay sesión.
 *  - OpenRouter: su OAuth con PKCE. La clave que devuelve se guarda cifrada
 *    en main, como cualquier otra, y no pasa por la ventana.
 *
 * Los demás proveedores por API no ofrecen inicio de sesión a aplicaciones de
 * terceros: se entra con su clave, y se dice así.
 */
import { shell } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getConfig } from './config'
import { forgetGhPath, ghPath, ghStatus } from './github'
import { IS_WIN, findInPath, killTree } from './platform'
import { setKey } from './secrets'
import { ollamaBase } from './ollama'
import { dataDir } from './paths'
import { writeFileAtomic } from './atomic'
import { openRouterOrigin } from './testSeams'
import type { AccountStatus, AccountsEvent } from '@shared/types'

type Emit = (e: AccountsEvent) => void
let emit: Emit = () => {}

export function initAccounts(send: Emit): void {
  emit = send
  watchAccountFiles()
}

/* ------------------------------------------------------------------ *
 * Preguntar a cada herramienta                                       *
 * ------------------------------------------------------------------ */

function run(file: string, args: string[], timeout = 12000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    // Los CLIs de npm son .cmd en Windows: Node exige el shell para lanzarlos.
    const viaShell = IS_WIN && /\.(cmd|bat)$/i.test(file)
    execFile(
      viaShell ? `"${file}"` : file,
      args,
      { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', shell: viaShell },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout ?? ''), err: String(stderr ?? '') })
    )
  })
}

const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** El ejecutable del agente que tengas dado de alta con ese comando, o el del PATH. */
function binOf(cmd: string): string | undefined {
  const re = new RegExp(`(^|[\\\\/])${cmd}(\\.(cmd|exe|bat|ps1))?$`, 'i')
  const own = getConfig().cliAgents.find((a) => re.test(a.command.trim()))?.command.trim()
  if (own && (own.includes('/') || own.includes('\\')) && existsSync(own)) return own
  return findInPath(cmd)
}

async function github(): Promise<AccountStatus> {
  const s = await ghStatus()
  return {
    id: 'github',
    name: 'GitHub',
    kind: 'github',
    installed: s.installed,
    signedIn: s.installed ? s.authed : false,
    who: s.login,
    detail: s.installed ? (s.authed ? s.name : undefined) : s.hint,
    loginCommand: 'gh auth login --web --git-protocol https',
    logoutCommand: 'gh auth logout',
    installCommand: s.installCommand,
    installUrl: 'https://cli.github.com',
    inApp: true
  }
}

/** Instalar un CLI de npm: con pnpm si lo tienes, si no con npm. */
function npmInstall(pkg: string): string {
  return findInPath('pnpm') ? `pnpm add -g ${pkg}` : `npm install -g ${pkg}`
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

const claudeDir = (): string => process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')

async function claude(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'claude',
    name: 'Claude Code',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'claude auth login',
    logoutCommand: 'claude auth logout',
    installCommand: npmInstall('@anthropic-ai/claude-code'),
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup'
  }
  const bin = binOf('claude')
  if (!bin) return base
  const r = await run(bin, ['auth', 'status'])
  try {
    const j = JSON.parse(plain(r.out).trim())
    return {
      ...base,
      installed: true,
      signedIn: Boolean(j.loggedIn),
      who: typeof j.email === 'string' ? j.email : undefined,
      plan: typeof j.subscriptionType === 'string' ? j.subscriptionType : j.authMethod === 'api_key' ? 'API' : undefined
    }
  } catch {
    // No contestó a tiempo (al arrancar el equipo pasa) o es una versión sin
    // `auth status`: se mira si está el fichero de su sesión, sin enseñarlo.
    // Que no conteste no quiere decir que no haya sesión.
    const creds = readJson(join(claudeDir(), '.credentials.json'))
    if (creds?.claudeAiOauth) {
      const plan = creds.claudeAiOauth.subscriptionType
      return { ...base, installed: true, signedIn: true, plan: typeof plan === 'string' ? plan : undefined }
    }
    return { ...base, installed: true, signedIn: null, detail: 'No contestó al preguntarle; vuelve a comprobarlo en un momento.' }
  }
}

async function codex(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'codex',
    name: 'Codex (ChatGPT)',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'codex login',
    logoutCommand: 'codex logout',
    installCommand: npmInstall('@openai/codex'),
    installUrl: 'https://developers.openai.com/codex/cli'
  }
  const bin = binOf('codex')
  if (!bin) return base
  const r = await run(bin, ['login', 'status'])
  const text = plain(r.out + '\n' + r.err)
  if (/not logged in/i.test(text)) return { ...base, installed: true, signedIn: false }
  const m = /logged in using (an? )?([\w ]+?)(\s+-|\s*$)/im.exec(text)
  if (m) return { ...base, installed: true, signedIn: true, plan: /api key/i.test(m[2]) ? 'API' : m[2].trim() }
  const home = process.env['CODEX_HOME'] || join(homedir(), '.codex')
  if (existsSync(join(home, 'auth.json'))) return { ...base, installed: true, signedIn: true }
  return { ...base, installed: true, signedIn: null }
}

async function gemini(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'gemini',
    name: 'Gemini CLI',
    kind: 'cli',
    installed: false,
    signedIn: false,
    // No tiene un comando de entrada: se elige la cuenta al abrirlo (o con /auth).
    loginCommand: 'gemini',
    detail: 'Al abrirlo elige «Login with Google»; dentro, /auth cambia de cuenta.',
    installCommand: npmInstall('@google/gemini-cli'),
    installUrl: 'https://github.com/google-gemini/gemini-cli'
  }
  const bin = binOf('gemini')
  if (!bin) return base
  // Sólo se mira si el fichero de su sesión existe: no se abre.
  const dir = join(process.env['GEMINI_CLI_HOME'] || homedir(), '.gemini')
  const oauth = existsSync(join(dir, 'oauth_creds.json'))
  const key = Boolean(process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY'])
  const active = readJson(join(dir, 'google_accounts.json'))?.active
  return {
    ...base,
    installed: true,
    signedIn: oauth || key,
    who: oauth && typeof active === 'string' ? active : undefined,
    plan: oauth ? 'Google' : key ? 'API' : undefined,
    detail: oauth || key ? undefined : base.detail
  }
}

async function opencode(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'opencode',
    name: 'OpenCode',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'opencode auth login',
    logoutCommand: 'opencode auth logout',
    installCommand: npmInstall('opencode-ai'),
    installUrl: 'https://opencode.ai/docs'
  }
  const bin = binOf('opencode')
  if (!bin) return base
  // `auth list` dice con qué proveedores hay credencial, sin enseñar ninguna.
  const r = await run(bin, ['auth', 'list'])
  const lines = plain(r.out + '\n' + r.err).split(/\r?\n/)
  const names: string[] = []
  let section = ''
  for (const line of lines) {
    const head = /^[┌◇◆]\s+(\S+)/.exec(line)
    if (head) section = head[1]
    const item = /^●\s+(.+?)\s+(\S+)\s*$/.exec(line)
    if (item && /^cred/i.test(section)) names.push(item[1].trim())
  }
  if (!r.ok && !names.length) {
    // No contestó: su fichero de credenciales dice al menos si hay alguna.
    const data = process.env['XDG_DATA_HOME'] ? join(process.env['XDG_DATA_HOME'], 'opencode') : join(homedir(), '.local', 'share', 'opencode')
    const auth = readJson(join(data, 'auth.json'))
    if (auth && typeof auth === 'object' && Object.keys(auth).length) return { ...base, installed: true, signedIn: true, who: Object.keys(auth).join(', ') }
    return { ...base, installed: true, signedIn: null }
  }
  return {
    ...base,
    installed: true,
    signedIn: names.length > 0,
    who: names.join(', ') || undefined,
    detail: names.length ? undefined : 'Sin proveedores conectados. Sus modelos gratuitos funcionan sin cuenta.'
  }
}

async function copilot(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'copilot',
    detail: 'Al abrirlo escribe /login y sigue los pasos; /logout para salir.',
    installCommand: npmInstall('@github/copilot'),
    installUrl: 'https://github.com/github/copilot-cli'
  }
  const bin = binOf('copilot')
  if (!bin) return base
  const token = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'].find((k) => process.env[k]?.trim())
  if (token) return { ...base, installed: true, signedIn: true, plan: token, detail: undefined }
  // Guarda el token en el almacén de credenciales del sistema; en su
  // configuración queda con qué cuenta entraste. Si no se ve, no se afirma nada.
  const cfg = readJson(join(process.env['COPILOT_HOME'] || join(homedir(), '.copilot'), 'config.json'))
  const users: any[] = Array.isArray(cfg?.logged_in_users) ? cfg.logged_in_users : []
  const last = cfg?.last_logged_in_user
  const who = (last?.login ?? users[0]?.login) as string | undefined
  if (who) return { ...base, installed: true, signedIn: true, who, detail: undefined }
  return { ...base, installed: true, signedIn: cfg ? null : false }
}

async function qwen(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'qwen',
    name: 'Qwen Code',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'qwen',
    detail: 'Al abrirlo elige «Qwen OAuth» (gratis con cuenta de qwen.ai); dentro, /auth cambia de cuenta.',
    installCommand: npmInstall('@qwen-code/qwen-code'),
    installUrl: 'https://github.com/QwenLM/qwen-code'
  }
  const bin = binOf('qwen')
  if (!bin) return base
  const dir = join(homedir(), '.qwen')
  const oauth = existsSync(join(dir, 'oauth_creds.json'))
  const key = Boolean(process.env['DASHSCOPE_API_KEY'] || process.env['OPENAI_API_KEY'])
  return { ...base, installed: true, signedIn: oauth || key, plan: oauth ? 'Qwen OAuth' : key ? 'API' : undefined, detail: oauth || key ? undefined : base.detail }
}

async function cursor(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'cursor',
    name: 'Cursor CLI',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'cursor-agent login',
    logoutCommand: 'cursor-agent logout',
    installUrl: 'https://cursor.com/cli'
  }
  const bin = binOf('cursor-agent')
  if (!bin) return base
  const r = await run(bin, ['status'])
  const text = plain(r.out + '\n' + r.err)
  if (/not (logged|authenticated)/i.test(text)) return { ...base, installed: true, signedIn: false }
  const m = /logged in as\s+(\S+)/i.exec(text)
  if (m) return { ...base, installed: true, signedIn: true, who: m[1] }
  return { ...base, installed: true, signedIn: null }
}

async function ollamaAccount(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'ollama',
    name: 'Ollama (ollama.com)',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'ollama signin',
    logoutCommand: 'ollama signout',
    installUrl: 'https://ollama.com/download'
  }
  if (!findInPath('ollama')) return base
  // El servidor local sabe con qué cuenta de ollama.com entraste (para sus modelos en la nube).
  try {
    const res = await fetch(`${ollamaBase()}/api/me`, { method: 'POST', signal: AbortSignal.timeout(4000) })
    if (res.status === 401 || res.status === 403) return { ...base, installed: true, signedIn: false, detail: 'Hace falta para sus modelos en la nube; los locales van sin cuenta.' }
    if (!res.ok) return { ...base, installed: true, signedIn: null }
    const j: any = await res.json().catch(() => ({}))
    const who = j?.name || j?.email
    return { ...base, installed: true, signedIn: Boolean(who), who: who || undefined }
  } catch {
    return { ...base, installed: true, signedIn: null, detail: 'Ollama está apagado: arráncalo para saber si hay sesión.' }
  }
}

async function huggingface(): Promise<AccountStatus> {
  const base: AccountStatus = {
    id: 'huggingface',
    name: 'Hugging Face',
    kind: 'cli',
    installed: false,
    signedIn: false,
    loginCommand: 'hf auth login',
    logoutCommand: 'hf auth logout',
    installUrl: 'https://huggingface.co/docs/huggingface_hub/guides/cli'
  }
  const bin = findInPath('hf')
  if (!bin) return base
  const home = process.env['HF_HOME'] || join(homedir(), '.cache', 'huggingface')
  const file = existsSync(join(home, 'token')) || existsSync(join(home, 'stored_tokens'))
  const env = Boolean(process.env['HF_TOKEN'])
  if (!file && !env) return { ...base, installed: true, signedIn: false }
  const r = await run(bin, ['auth', 'whoami'], 10000)
  const who = plain(r.out).split(/\r?\n/).map((l) => l.replace(/^user:\s*/i, '').trim()).find((l) => l && !/not logged|warning/i.test(l))
  return { ...base, installed: true, signedIn: r.ok ? true : null, who: r.ok ? who : undefined }
}

/* ------------------------------------------------------------------ *
 * Lo último que se supo                                              *
 * ------------------------------------------------------------------ */

/**
 * La última respuesta clara de cada cuenta, guardada en disco (sin nada
 * secreto: si había sesión, con quién y el plan). Una comprobación que no
 * contesta —el CLI tarda al arrancar el equipo, Ollama está apagado— no
 * convierte una sesión en «sin sesión»: se enseña lo último que se supo.
 */
type Known = Pick<AccountStatus, 'signedIn' | 'who' | 'plan'> & { at: number }
const knownPath = (): string => join(dataDir(), 'cuentas.json')
let known: Record<string, Known> | null = null

function loadKnown(): Record<string, Known> {
  known ??= readJson(knownPath()) ?? {}
  return known!
}

function remember(list: AccountStatus[]): AccountStatus[] {
  const k = loadKnown()
  let dirty = false
  const out = list.map((a) => {
    if (!a.installed) return a
    if (a.signedIn !== null) {
      const prev = k[a.id]
      if (!prev || prev.signedIn !== a.signedIn || prev.who !== a.who || prev.plan !== a.plan) dirty = true
      k[a.id] = { signedIn: a.signedIn, who: a.who, plan: a.plan, at: Date.now() }
      return a
    }
    const prev = k[a.id]
    if (!prev || prev.signedIn === null) return a
    return { ...a, signedIn: prev.signedIn, who: a.who ?? prev.who, plan: a.plan ?? prev.plan, staleAt: prev.at }
  })
  if (dirty) {
    try {
      writeFileAtomic(knownPath(), JSON.stringify(k, null, 2))
    } catch {
      /* sin disco no pasa nada: se vuelve a preguntar */
    }
  }
  return out
}

/** El estado de todo, a la vez. Uno que falle no tumba a los demás. */
export async function accountsStatus(): Promise<AccountStatus[]> {
  const checks: [string, string, () => Promise<AccountStatus>][] = [
    ['github', 'GitHub', github],
    ['claude', 'Claude Code', claude],
    ['codex', 'Codex (ChatGPT)', codex],
    ['gemini', 'Gemini CLI', gemini],
    ['opencode', 'OpenCode', opencode],
    ['copilot', 'GitHub Copilot CLI', copilot],
    ['qwen', 'Qwen Code', qwen],
    ['cursor', 'Cursor CLI', cursor],
    ['ollama', 'Ollama (ollama.com)', ollamaAccount],
    ['huggingface', 'Hugging Face', huggingface]
  ]
  const list = await Promise.all(
    checks.map(([id, name, fn]) =>
      fn().catch(
        (): AccountStatus => ({ id, name, kind: id === 'github' ? 'github' : 'cli', installed: true, signedIn: null })
      )
    )
  )
  return remember(list)
}

/* ------------------------------------------------------------------ *
 * En vivo: cuando una herramienta guarda o borra su sesión            *
 * ------------------------------------------------------------------ */

/**
 * Se vigilan las carpetas donde cada herramienta guarda su sesión: entrar o
 * salir desde cualquier terminal (de la app o de fuera) se nota al momento,
 * sin preguntar a todos los CLIs cada pocos segundos.
 */
let watchers: FSWatcher[] = []
let watchTimer: ReturnType<typeof setTimeout> | null = null

function sessionDirs(): string[] {
  const h = homedir()
  return [
    claudeDir(),
    process.env['CODEX_HOME'] || join(h, '.codex'),
    join(process.env['GEMINI_CLI_HOME'] || h, '.gemini'),
    process.env['XDG_DATA_HOME'] ? join(process.env['XDG_DATA_HOME'], 'opencode') : join(h, '.local', 'share', 'opencode'),
    process.env['COPILOT_HOME'] || join(h, '.copilot'),
    join(h, '.qwen'),
    process.env['HF_HOME'] || join(h, '.cache', 'huggingface'),
    process.env['GH_CONFIG_DIR'] || (IS_WIN ? join(process.env['APPDATA'] || join(h, 'AppData', 'Roaming'), 'GitHub CLI') : join(h, '.config', 'gh'))
  ]
}

const SESSION_FILE = /credentials|auth|oauth|token|hosts\.yml|config\.json|google_accounts|stored_tokens/i

export function watchAccountFiles(): void {
  stopWatchingAccounts()
  for (const dir of sessionDirs()) {
    if (!existsSync(dir)) continue
    try {
      const w = watch(dir, { persistent: false }, (_event, file) => {
        if (file && !SESSION_FILE.test(String(file))) return
        if (watchTimer) clearTimeout(watchTimer)
        watchTimer = setTimeout(() => emit({ id: 'all', phase: 'changed' }), 1200)
      })
      w.on('error', () => {})
      watchers.push(w)
    } catch {
      /* una carpeta que no deja vigilarse: se queda con la comprobación normal */
    }
  }
}

function stopWatchingAccounts(): void {
  for (const w of watchers) w.close()
  watchers = []
  if (watchTimer) clearTimeout(watchTimer)
  watchTimer = null
}

/* ------------------------------------------------------------------ *
 * GitHub: el inicio de sesión de gh, sin salir de la app             *
 * ------------------------------------------------------------------ */

let ghLogin: ChildProcess | null = null

/**
 * Lanza `gh auth login --web`. Sin terminal, gh escribe el código de un solo
 * uso y la dirección, y se queda esperando a que lo autorices en el navegador.
 * El token lo recibe y lo guarda gh: por aquí no pasa.
 */
export async function startGithubLogin(): Promise<{ ok: boolean; error?: string }> {
  if (ghLogin) return { ok: true }
  forgetGhPath()
  const gh = await ghPath()
  if (!gh) return { ok: false, error: 'GitHub CLI no está instalado' }
  let child: ChildProcess
  try {
    child = spawn(gh, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], {
      windowsHide: true,
      detached: !IS_WIN,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  ghLogin = child
  let seen = ''
  let code: string | undefined
  let url: string | undefined
  let announced = false
  const onData = (chunk: Buffer): void => {
    seen += plain(chunk.toString('utf8'))
    code ??= /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(seen)?.[1]
    url ??= /(https:\/\/github\.com\/login\/device\S*)/i.exec(seen)?.[1]
    if (code && !announced) {
      announced = true
      emit({ id: 'github', phase: 'code', code, url: url ?? 'https://github.com/login/device' })
    }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  // El código caduca a los 15 minutos: pasado ese tiempo ya no va a servir.
  const expire = setTimeout(() => killTree(child), 15 * 60 * 1000)
  expire.unref?.()
  const end = (ok: boolean, error?: string): void => {
    if (ghLogin !== child) return
    ghLogin = null
    clearTimeout(expire)
    emit({ id: 'github', phase: 'done', ok, error })
  }
  child.on('error', (e) => end(false, e.message))
  child.on('close', (exit, signal) => {
    if (exit === 0) return end(true)
    if (signal || exit === null) return end(false, 'cancelado')
    const last = seen.trim().split(/\r?\n/).filter(Boolean).pop()
    end(false, last && !/one-time code|Open this URL/i.test(last) ? last : `gh salió con código ${exit}`)
  })
  return { ok: true }
}

export function cancelGithubLogin(): boolean {
  if (!ghLogin) return false
  killTree(ghLogin)
  return true
}

/** ¿Usa git la sesión de gh para github.com? */
export async function githubGitHelper(): Promise<boolean> {
  const git = findInPath('git')
  if (!git) return false
  const r = await run(git, ['config', '--global', '--get-all', 'credential.https://github.com.helper'], 6000)
  return /gh(\.exe)?"?\s+auth\s+git-credential/i.test(r.out)
}

/**
 * `gh auth setup-git`: que `git push` y `git pull` a github.com usen la sesión
 * de gh. Es lo que gh pregunta al entrar desde una terminal; aquí es un botón
 * aparte porque escribe en tu ~/.gitconfig.
 */
export async function githubSetupGit(): Promise<{ ok: boolean; detail: string }> {
  const gh = await ghPath()
  if (!gh) return { ok: false, detail: 'GitHub CLI no está instalado' }
  const r = await run(gh, ['auth', 'setup-git', '--hostname', 'github.com'], 15000)
  return { ok: r.ok, detail: r.ok ? 'git usa ya la sesión de gh para github.com' : plain(r.err).trim() || 'gh auth setup-git falló' }
}

/* ------------------------------------------------------------------ *
 * OpenRouter: OAuth con PKCE                                         *
 * ------------------------------------------------------------------ */

const OPENROUTER = 'https://openrouter.ai'
const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const openRouterBase = openRouterOrigin

let orFlow: { server: Server; cancel: (why: string) => void; submit: (code: string) => Promise<{ ok: boolean; error?: string }> } | null = null

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px system-ui;background:#0a0b0f;color:#e6e8ee;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#9aa3b5;margin:0">${text}</p></div>`

/**
 * Abre openrouter.ai para que autorices la app y recoge el código en un
 * servidor local de un solo uso (sólo escucha en esta máquina). El código se
 * cambia por una clave con el verificador que sólo conoce este proceso, y la
 * clave se guarda cifrada: la ventana sólo se entera de que ya hay clave.
 */
export function startOpenRouterLogin(): Promise<{ ok: boolean; error?: string }> {
  if (orFlow) orFlow.cancel('reiniciado')
  return new Promise((resolve) => {
    const verifier = b64url(randomBytes(48))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    let done = false
    // Se escucha en IPv4 y en IPv6: según el navegador y el sistema, «localhost»
    // es 127.0.0.1 o ::1, y si la vuelta llama a la que no escucha no llega nunca.
    let server6: Server | null = null
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://localhost')
      const code = u.searchParams.get('code')
      if (req.method !== 'GET' || u.pathname !== '/callback' || !code) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No hay nada aquí.')
        return
      }
      if (done) {
        res.writeHead(410, { 'content-type': 'text/plain; charset=utf-8' }).end('Este enlace ya se usó.')
        return
      }
      done = true
      void exchange(code).then(
        () => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Listo', 'OpenRouter está conectado. Ya puedes volver a AI Command Center.'))
          finish({ ok: true })
        },
        (e: unknown) => {
          const error = e instanceof Error ? e.message : String(e)
          res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('No se pudo conectar', 'Vuelve a AI Command Center para ver el motivo.'))
          finish({ ok: false, error })
        }
      )
    })
    const timer = setTimeout(() => finish({ ok: false, error: 'Se acabó el tiempo sin que autorizaras en OpenRouter' }), 10 * 60 * 1000)
    timer.unref?.()
    const finish = (r: { ok: boolean; error?: string }): void => {
      if (orFlow?.server !== server) return
      orFlow = null
      clearTimeout(timer)
      // Se deja salir la página de respuesta antes de cerrar.
      setTimeout(() => {
        server.close()
        server6?.close()
      }, 300).unref?.()
      emit({ id: 'openrouter', phase: 'done', ok: r.ok, error: r.error })
      resolve(r)
    }
    const exchange = async (code: string): Promise<void> => {
      const r = await fetch(`${openRouterBase()}/api/v1/auth/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        signal: AbortSignal.timeout(20000)
      })
      const body: any = await r.json().catch(() => ({}))
      if (!r.ok || typeof body?.key !== 'string' || !body.key) {
        throw new Error(String(body?.error?.message ?? body?.error ?? `OpenRouter respondió ${r.status}`))
      }
      setKey('openrouter', body.key)
    }
    orFlow = {
      server,
      cancel: (why) => finish({ ok: false, error: why }),
      // Si el navegador no vuelve a la app, el código está en su barra de direcciones.
      submit: async (code) => {
        if (done) return { ok: false, error: 'Este inicio de sesión ya terminó' }
        done = true
        try {
          await exchange(code)
          finish({ ok: true })
          return { ok: true }
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e)
          finish({ ok: false, error })
          return { ok: false, error }
        }
      }
    }
    server.on('error', (e) => finish({ ok: false, error: e.message }))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server6 = createServer((req, res) => server.emit('request', req, res))
      server6.on('error', () => {
        /* sin IPv6 en este equipo: se queda con IPv4 */
      })
      server6.listen(port, '::1')
      const url =
        `${openRouterBase()}/auth?callback_url=${encodeURIComponent(`http://localhost:${port}/callback`)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`
      emit({ id: 'openrouter', phase: 'browser', url })
      // En las pruebas no se abre ningún navegador: quien prueba hace de él.
      if (openRouterBase() === OPENROUTER) void shell.openExternal(url)
    })
  })
}

/**
 * Plan B: pegar el código (o la dirección entera a la que intentó volver el
 * navegador) cuando la vuelta a la app no llega.
 */
export function submitOpenRouterCode(input: string): Promise<{ ok: boolean; error?: string }> {
  if (!orFlow) return Promise.resolve({ ok: false, error: 'No hay ningún inicio de sesión de OpenRouter en marcha' })
  const raw = String(input ?? '').trim()
  let code = raw
  try {
    if (/^https?:\/\//i.test(raw)) code = new URL(raw).searchParams.get('code') ?? ''
  } catch {
    code = ''
  }
  if (!/^[\w.~-]{8,}$/.test(code)) return Promise.resolve({ ok: false, error: 'Eso no parece un código de OpenRouter' })
  return orFlow.submit(code)
}

export function cancelOpenRouterLogin(): boolean {
  if (!orFlow) return false
  orFlow.cancel('cancelado')
  return true
}

export function stopAccounts(): void {
  stopWatchingAccounts()
  cancelGithubLogin()
  cancelOpenRouterLogin()
}
