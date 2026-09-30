/**
 * Centro de MCP: los servidores MCP de cada CLI, en un solo sitio.
 *
 * Cada herramienta los guarda a su manera (documentación de cada una,
 * septiembre de 2026):
 *
 *   Claude Code  ~/.claude.json → mcpServers           .mcp.json → mcpServers
 *                (y ~/.claude.json → projects[ruta].mcpServers, el ámbito «local»)
 *   Codex        ~/.codex/config.toml → [mcp_servers.x] .codex/config.toml
 *   OpenCode     ~/.config/opencode/opencode.json → mcp opencode.json → mcp
 *   Gemini CLI   ~/.gemini/settings.json → mcpServers    .gemini/settings.json
 *   Copilot CLI  ~/.copilot/mcp-config.json → mcpServers .mcp.json, .github/mcp.json
 *   Esta app     config.json → mcpServers (los usan los agentes por API)
 *
 * Aquí se leen todos a un formato común y se copia un servidor de uno a otro.
 * Tres reglas:
 *
 *  - Los secretos no salen de aquí: a la interfaz sólo llega que hay uno.
 *  - Al copiar, un secreto escrito tal cual se convierte en una referencia a
 *    una variable de entorno, con la sintaxis de cada CLI (`${VAR}`,
 *    `{env:VAR}`, `env_vars`…). El valor no se copia nunca: se dice qué
 *    variable hay que definir.
 *  - Copiar sólo añade. Si el destino ya tiene un servidor con ese nombre, no
 *    se toca; y antes de escribir se guarda una copia del fichero.
 *
 * Los JSON se editan con jsonc-parser, que cambia sólo lo necesario y respeta
 * comentarios y formato; en el TOML de Codex la tabla nueva se añade al final
 * y se comprueba que el resultado se sigue leyendo antes de guardarlo.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { writeFileAtomic } from '../atomic'
import { paths } from '../paths'
import { getConfig, saveConfig } from '../config'
import type {
  AppMcpServer, McpClient, McpClientFile, McpCopyPlan, McpDefinition, McpReport, McpServerRow, McpSpec, McpValue
} from '@shared/types'

type Scope = 'personal' | 'project'

/* ------------------------------------------------------------------ *
 * Dónde está cada uno                                                *
 * ------------------------------------------------------------------ */

interface Place {
  /** Quién lee este fichero: `.mcp.json` lo leen Claude Code y Copilot. */
  clients: McpClient[]
  scope: Scope
  file: string
  format: 'json' | 'toml' | 'app'
  /** Dónde están los servidores dentro del fichero. */
  key: string[]
  /** Se lee, pero no se escribe en él (hay otro sitio mejor para escribir). */
  readOnly?: boolean
}

const claudeJson = (): string =>
  process.env['CLAUDE_CONFIG_DIR'] ? join(process.env['CLAUDE_CONFIG_DIR'], '.claude.json') : join(homedir(), '.claude.json')
const codexHome = (): string => process.env['CODEX_HOME'] || join(homedir(), '.codex')
const geminiHome = (): string => process.env['GEMINI_CLI_HOME'] || homedir()
const copilotHome = (): string => process.env['COPILOT_HOME'] || join(homedir(), '.copilot')
const opencodeDir = (): string => join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'opencode')

/** OpenCode acepta .jsonc y .json: el que exista, y si no, el .json. */
function firstExisting(dir: string, names: string[]): string {
  return names.map((n) => join(dir, n)).find((p) => existsSync(p)) ?? join(dir, names[names.length - 1])
}

function places(projectPath?: string): Place[] {
  const list: Place[] = [
    { clients: ['claude'], scope: 'personal', file: claudeJson(), format: 'json', key: ['mcpServers'] },
    { clients: ['codex'], scope: 'personal', file: join(codexHome(), 'config.toml'), format: 'toml', key: ['mcp_servers'] },
    {
      clients: ['opencode'],
      scope: 'personal',
      file: firstExisting(opencodeDir(), ['opencode.jsonc', 'config.json', 'opencode.json']),
      format: 'json',
      key: ['mcp']
    },
    { clients: ['gemini'], scope: 'personal', file: join(geminiHome(), '.gemini', 'settings.json'), format: 'json', key: ['mcpServers'] },
    { clients: ['copilot'], scope: 'personal', file: join(copilotHome(), 'mcp-config.json'), format: 'json', key: ['mcpServers'] },
    { clients: ['app'], scope: 'personal', file: paths.config, format: 'app', key: ['mcpServers'] }
  ]
  if (projectPath) {
    list.push(
      { clients: ['claude', 'copilot'], scope: 'project', file: join(projectPath, '.mcp.json'), format: 'json', key: ['mcpServers'] },
      { clients: ['copilot'], scope: 'project', file: join(projectPath, '.github', 'mcp.json'), format: 'json', key: ['mcpServers'], readOnly: true },
      { clients: ['codex'], scope: 'project', file: join(projectPath, '.codex', 'config.toml'), format: 'toml', key: ['mcp_servers'] },
      {
        clients: ['opencode'],
        scope: 'project',
        file: firstExisting(projectPath, ['opencode.jsonc', 'opencode.json']),
        format: 'json',
        key: ['mcp']
      },
      { clients: ['gemini'], scope: 'project', file: join(projectPath, '.gemini', 'settings.json'), format: 'json', key: ['mcpServers'] }
    )
    // El ámbito «local» de Claude Code: por proyecto, dentro de ~/.claude.json.
    // En Windows guarda la ruta con barras normales.
    for (const p of new Set([projectPath, projectPath.replace(/\\/g, '/')])) {
      list.push({ clients: ['claude'], scope: 'project', file: claudeJson(), format: 'json', key: ['projects', p, 'mcpServers'], readOnly: true })
    }
  }
  return list
}

/** Dónde se escribe al copiar a un CLI. */
function writePlace(client: McpClient, scope: Scope, projectPath?: string): Place | null {
  if (client === 'app' && scope === 'project') return null
  return places(projectPath).find((p) => p.scope === scope && p.clients.includes(client) && !p.readOnly) ?? null
}

/* ------------------------------------------------------------------ *
 * Leer                                                               *
 * ------------------------------------------------------------------ */

interface Found {
  spec: McpSpec
  enabled: boolean
}

function readText(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  } catch {
    return null
  }
}

function jsonDoc(text: string): { doc: any; error?: string } {
  const errors: ParseError[] = []
  const doc = parseJsonc(text, errors, { allowTrailingComma: true })
  return errors.length ? { doc: null, error: 'JSON con errores' } : { doc: doc ?? {} }
}

function at(doc: any, key: string[]): any {
  let cur = doc
  for (const k of key) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  return cur
}

function strings(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : undefined
}

function record(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out[k] = String(x)
  return Object.keys(out).length ? out : undefined
}

/** Lleva cada sintaxis de referencia a `${VAR}`. */
function normRefs(v: string, client: McpClient): string {
  let s = v
  if (client === 'opencode') s = s.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, '${$1}')
  if (client === 'gemini') {
    s = s.replace(/(^|[^$\w{])\$([A-Za-z_][A-Za-z0-9_]*)/g, '$1${$2}')
    if (process.platform === 'win32') s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, '${$1}')
  }
  return s
}

function normRecord(r: Record<string, string> | undefined, client: McpClient): Record<string, string> | undefined {
  if (!r) return undefined
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, normRefs(v, client)]))
}

function fromJson(client: McpClient, raw: any): Found | null {
  if (!raw || typeof raw !== 'object') return null
  if (client === 'opencode') {
    const enabled = raw.enabled !== false
    if (raw.type === 'remote' && typeof raw.url === 'string') {
      return { enabled, spec: { transport: 'http', url: normRefs(raw.url, client), headers: normRecord(record(raw.headers), client) } }
    }
    const cmd = strings(raw.command) ?? (typeof raw.command === 'string' ? [raw.command] : undefined)
    if (!cmd?.length) return null
    return {
      enabled,
      spec: {
        transport: 'stdio',
        command: normRefs(cmd[0], client),
        args: cmd.slice(1).map((a) => normRefs(a, client)),
        env: normRecord(record(raw.environment), client),
        cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined
      }
    }
  }
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
  const url = typeof raw.httpUrl === 'string' ? raw.httpUrl : typeof raw.url === 'string' ? raw.url : undefined
  let transport: McpSpec['transport']
  if (type === 'stdio' || type === 'local' || (!type && typeof raw.command === 'string')) transport = 'stdio'
  else if (type === 'sse') transport = 'sse'
  else if (type === 'ws') transport = 'ws'
  else if (type === 'http' || type === 'streamable-http' || typeof raw.httpUrl === 'string') transport = 'http'
  else if (url) transport = client === 'gemini' ? 'sse' : 'http'
  else return null
  const enabled = raw.disabled !== true && raw.enabled !== false
  if (transport === 'stdio') {
    if (typeof raw.command !== 'string') return null
    return {
      enabled,
      spec: {
        transport,
        command: normRefs(raw.command, client),
        args: strings(raw.args)?.map((a) => normRefs(a, client)),
        env: normRecord(record(raw.env), client),
        cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined
      }
    }
  }
  if (!url) return null
  return { enabled, spec: { transport, url: normRefs(url, client), headers: normRecord(record(raw.headers), client) } }
}

function fromToml(raw: any): Found | null {
  if (!raw || typeof raw !== 'object') return null
  const enabled = raw.enabled !== false
  if (typeof raw.url === 'string') {
    const headers: Record<string, string> = { ...(record(raw.http_headers) ?? {}) }
    for (const [h, v] of Object.entries(record(raw.env_http_headers) ?? {})) headers[h] = '${' + v + '}'
    if (typeof raw.bearer_token_env_var === 'string') headers['Authorization'] = 'Bearer ${' + raw.bearer_token_env_var + '}'
    return { enabled, spec: { transport: 'http', url: raw.url, headers: Object.keys(headers).length ? headers : undefined } }
  }
  if (typeof raw.command !== 'string') return null
  const env: Record<string, string> = { ...(record(raw.env) ?? {}) }
  for (const v of Array.isArray(raw.env_vars) ? raw.env_vars : []) {
    const name = typeof v === 'string' ? v : typeof v?.name === 'string' ? v.name : null
    if (name) env[name] = '${' + name + '}'
  }
  return {
    enabled,
    spec: {
      transport: 'stdio',
      command: raw.command,
      args: strings(raw.args),
      env: Object.keys(env).length ? env : undefined,
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined
    }
  }
}

/** Los servidores de un sitio. Si el fichero está roto, el error y nada más. */
function readPlace(place: Place): { servers: Map<string, Found>; exists: boolean; error?: string } {
  const servers = new Map<string, Found>()
  if (place.format === 'app') {
    for (const [name, s] of Object.entries(getConfig().mcpServers ?? {})) {
      const { enabled, addedAt: _a, ...spec } = s
      servers.set(name, { enabled, spec })
    }
    return { servers, exists: true }
  }
  const text = readText(place.file)
  if (text === null) return { servers, exists: false }
  if (place.format === 'toml') {
    let doc: any
    try {
      doc = parseToml(text)
    } catch {
      return { servers, exists: true, error: 'TOML con errores' }
    }
    for (const [name, raw] of Object.entries(at(doc, place.key) ?? {})) {
      const f = fromToml(raw)
      if (f) servers.set(name, f)
    }
    return { servers, exists: true }
  }
  const { doc, error } = jsonDoc(text)
  if (error) return { servers, exists: true, error }
  const block = at(doc, place.key)
  if (block && typeof block === 'object') {
    for (const [name, raw] of Object.entries(block)) {
      const f = fromJson(place.clients[0], raw)
      if (f) servers.set(name, f)
    }
  }
  return { servers, exists: true }
}

/* ------------------------------------------------------------------ *
 * Secretos                                                           *
 * ------------------------------------------------------------------ */

const SECRET_KEY = /(api[-_]?key|token|secret|passw(or)?d|pwd|auth|credential|cookie|session|private[-_]?key|access[-_]?key)/i
const SECRET_VALUE = /^(sk-|sk_|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abpr]-|AKIA|AIza|glpat-|hf_|pk_live|rk_live|eyJ)/
const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g
const ONLY_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/

function refsIn(v: string): string[] {
  return [...v.matchAll(REF)].map((m) => m[1])
}

/** ¿Es un secreto escrito tal cual? Una referencia a una variable no lo es. */
export function looksSecret(key: string, value: string): boolean {
  const bare = value.replace(REF, '').replace(/^Bearer\s+/i, '').trim()
  if (!bare) return false
  if (SECRET_VALUE.test(bare)) return true
  if (SECRET_KEY.test(key) && bare.length >= 6) return true
  return bare.length >= 24 && /^[A-Za-z0-9_\-.=+/]+$/.test(bare) && /\d/.test(bare) && /[A-Za-z]/.test(bare)
}

function shown(r: Record<string, string> | undefined): McpValue[] {
  return Object.entries(r ?? {}).map(([key, v]) => {
    if (looksSecret(key, v)) return { key, secret: true }
    const refs = refsIn(v)
    return refs.length ? { key, ref: refs[0], value: v } : { key, value: v }
  })
}

const SECRET_FLAG = /^--?(api[-_]?key|token|secret|password|auth|access[-_]?token)$/i

/** Argumentos con los secretos tapados, y si había alguno. */
function maskArgs(args: string[]): { args: string[]; secret: boolean } {
  let secret = false
  const out = args.map((a, i) => {
    const eq = /^(--?[\w-]+)=(.*)$/.exec(a)
    if (eq && SECRET_FLAG.test(eq[1]) && eq[2] && !refsIn(eq[2]).length) {
      secret = true
      return `${eq[1]}=•••`
    }
    if (i > 0 && SECRET_FLAG.test(args[i - 1]) && !refsIn(a).length) {
      secret = true
      return '•••'
    }
    if (SECRET_VALUE.test(a)) {
      secret = true
      return '•••'
    }
    return a
  })
  return { args: out, secret }
}

function maskUrl(url: string): { url: string; secret: boolean } {
  let secret = false
  const out = url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (m, sep, k, v) => {
    if (v && !refsIn(decodeURIComponent(v)).length && (SECRET_KEY.test(k) || SECRET_VALUE.test(v))) {
      secret = true
      return `${sep}${k}=•••`
    }
    return m
  })
  if (SECRET_VALUE.test(url.split('/').pop() ?? '')) secret = true
  return { url: out, secret }
}

const SALT = randomBytes(16)

function definitionOf(client: McpClient, place: Place, f: Found): McpDefinition {
  const s = f.spec
  let summary = ''
  let secretInline = false
  if (s.transport === 'stdio') {
    const m = maskArgs(s.args ?? [])
    summary = [s.command ?? '', ...m.args].join(' ').trim()
    secretInline = m.secret || SECRET_VALUE.test(s.command ?? '')
  } else {
    const m = maskUrl(s.url ?? '')
    summary = m.url
    secretInline = m.secret
  }
  return {
    client,
    scope: place.scope,
    file: place.file,
    enabled: f.enabled,
    transport: s.transport,
    summary,
    env: shown(s.env),
    headers: shown(s.headers),
    // Con sal: la huella sirve para comparar, no para adivinar un secreto.
    hash: createHash('sha256').update(SALT).update(JSON.stringify(s)).digest('hex').slice(0, 16),
    secretInline: secretInline || undefined
  }
}

export function mcpReport(projectPath?: string): McpReport {
  const files: McpClientFile[] = []
  const rows = new Map<string, McpServerRow>()
  for (const place of places(projectPath)) {
    const r = readPlace(place)
    // Los ficheros donde se escribe, siempre; los que sólo se leen, si existen.
    if (!place.readOnly || r.exists) {
      for (const client of place.clients) {
        if (!files.some((f) => f.client === client && f.scope === place.scope && f.file === place.file)) {
          files.push({ client, scope: place.scope, file: place.file, exists: r.exists, error: r.error })
        }
      }
    }
    for (const [name, f] of r.servers) {
      const key = `${place.scope}:${name}`
      const row = rows.get(key) ?? { name, scope: place.scope, definitions: [], differs: false }
      for (const client of place.clients) row.definitions.push(definitionOf(client, place, f))
      rows.set(key, row)
    }
  }
  for (const row of rows.values()) row.differs = new Set(row.definitions.map((d) => d.hash)).size > 1
  const servers = [...rows.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name))
  return { files, servers }
}

/* ------------------------------------------------------------------ *
 * Copiar                                                             *
 * ------------------------------------------------------------------ */

const NAME = /^[\w.@-]{1,64}$/

function sourceSpec(from: { client: McpClient; scope: Scope; name: string }, projectPath?: string): { found: Found; place: Place } | null {
  for (const place of places(projectPath)) {
    if (place.scope !== from.scope || !place.clients.includes(from.client)) continue
    const found = readPlace(place).servers.get(from.name)
    if (found) return { found, place }
  }
  return null
}

function envName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'MCP'
}

/**
 * El servidor listo para otro sitio: sin ningún secreto escrito. Lo que era
 * un secreto pasa a ser `${VAR}`, y se apunta qué variables hacen falta.
 */
function withoutSecrets(name: string, spec: McpSpec): { spec: McpSpec; converted: string[] } {
  const converted: string[] = []
  const fix = (r: Record<string, string> | undefined, header: boolean): Record<string, string> | undefined => {
    if (!r) return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(r)) {
      if (!looksSecret(k, v)) {
        out[k] = v
        continue
      }
      const variable = header
        ? /^authorization$/i.test(k)
          ? `${envName(name)}_TOKEN`
          : `${envName(name)}_${envName(k)}`
        : envName(k)
      converted.push(variable)
      out[k] = header && /^Bearer\s/i.test(v) ? 'Bearer ${' + variable + '}' : '${' + variable + '}'
    }
    return out
  }
  return { spec: { ...spec, env: fix(spec.env, false), headers: fix(spec.headers, true) }, converted }
}

function allRefs(spec: McpSpec): string[] {
  const vals = [spec.command ?? '', ...(spec.args ?? []), spec.url ?? '', spec.cwd ?? '', ...Object.values(spec.env ?? {}), ...Object.values(spec.headers ?? {})]
  return [...new Set(vals.flatMap(refsIn))]
}

/** Las referencias en la sintaxis de OpenCode. Los valores por defecto no los admite. */
function toOpencodeRefs(v: string, warnings: string[]): string {
  return v.replace(REF, (_m, name, def) => {
    if (def) warnings.push(`OpenCode no admite valor por defecto en \${${name}${def}}: se queda sin él.`)
    return `{env:${name}}`
  })
}

function jsonEntry(client: McpClient, spec: McpSpec, warnings: string[]): any {
  if (client === 'opencode') {
    const r = (v: string): string => toOpencodeRefs(v, warnings)
    const rr = (x?: Record<string, string>): Record<string, string> | undefined =>
      x ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, r(v)])) : undefined
    if (spec.transport === 'stdio') {
      return {
        type: 'local',
        command: [r(spec.command ?? ''), ...(spec.args ?? []).map(r)],
        ...(spec.env ? { environment: rr(spec.env) } : {}),
        ...(spec.cwd ? { cwd: spec.cwd } : {}),
        enabled: true
      }
    }
    return { type: 'remote', url: r(spec.url ?? ''), ...(spec.headers ? { headers: rr(spec.headers) } : {}), enabled: true }
  }
  if (client === 'gemini') {
    if (spec.transport === 'stdio') {
      return { command: spec.command, ...(spec.args?.length ? { args: spec.args } : {}), ...(spec.env ? { env: spec.env } : {}), ...(spec.cwd ? { cwd: spec.cwd } : {}) }
    }
    return { [spec.transport === 'sse' ? 'url' : 'httpUrl']: spec.url, ...(spec.headers ? { headers: spec.headers } : {}) }
  }
  // Claude Code y Copilot CLI.
  if (spec.transport === 'stdio') {
    return {
      type: 'stdio',
      command: spec.command,
      args: spec.args ?? [],
      ...(spec.env ? { env: spec.env } : {}),
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      ...(client === 'copilot' ? { tools: ['*'] } : {})
    }
  }
  return {
    type: spec.transport,
    url: spec.url,
    ...(spec.headers ? { headers: spec.headers } : {}),
    ...(client === 'copilot' ? { tools: ['*'] } : {})
  }
}

const tomlKey = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k))
const tomlStr = (v: string): string => JSON.stringify(v)

/** La tabla de Codex. Codex no expande variables dentro de un valor: cada referencia va por su campo. */
function tomlTable(name: string, spec: McpSpec, warnings: string[]): { text: string; value: any } {
  const head = `mcp_servers.${tomlKey(name)}`
  const lines: string[] = [`[${head}]`]
  const value: any = {}
  const sub: string[] = []
  if ([spec.command ?? '', ...(spec.args ?? []), spec.url ?? '', spec.cwd ?? ''].some((v) => refsIn(v).length)) {
    throw new Error('Codex no expande variables en la orden, los argumentos ni la URL: este servidor no se puede copiar tal cual.')
  }
  if (spec.transport === 'stdio') {
    lines.push(`command = ${tomlStr(spec.command ?? '')}`)
    value.command = spec.command
    if (spec.args?.length) {
      lines.push(`args = [${spec.args.map(tomlStr).join(', ')}]`)
      value.args = spec.args
    }
    if (spec.cwd) {
      lines.push(`cwd = ${tomlStr(spec.cwd)}`)
      value.cwd = spec.cwd
    }
    const envVars: string[] = []
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(spec.env ?? {})) {
      const only = ONLY_REF.exec(v)
      if (only) {
        if (only[1] !== k) warnings.push(`En Codex, ${k} se toma de la variable de entorno ${k} (no de ${only[1]}): defínela con ese nombre.`)
        envVars.push(k)
      } else if (refsIn(v).length) {
        throw new Error(`Codex no expande variables dentro de un valor (${k}): este servidor no se puede copiar tal cual.`)
      } else env[k] = v
    }
    if (envVars.length) {
      lines.push(`env_vars = [${envVars.map(tomlStr).join(', ')}]`)
      value.env_vars = envVars
    }
    if (Object.keys(env).length) {
      sub.push(`[${head}.env]`, ...Object.entries(env).map(([k, v]) => `${tomlKey(k)} = ${tomlStr(v)}`), '')
      value.env = env
    }
  } else {
    lines.push(`url = ${tomlStr(spec.url ?? '')}`)
    value.url = spec.url
    const plain: Record<string, string> = {}
    const fromEnv: Record<string, string> = {}
    for (const [h, v] of Object.entries(spec.headers ?? {})) {
      const bearer = /^Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/i.exec(v)
      const only = ONLY_REF.exec(v)
      if (/^authorization$/i.test(h) && bearer) {
        lines.push(`bearer_token_env_var = ${tomlStr(bearer[1])}`)
        value.bearer_token_env_var = bearer[1]
      } else if (only) fromEnv[h] = only[1]
      else if (refsIn(v).length) throw new Error(`Codex no expande variables dentro de la cabecera ${h}: este servidor no se puede copiar tal cual.`)
      else plain[h] = v
    }
    if (Object.keys(plain).length) {
      sub.push(`[${head}.http_headers]`, ...Object.entries(plain).map(([k, v]) => `${tomlKey(k)} = ${tomlStr(v)}`), '')
      value.http_headers = plain
    }
    if (Object.keys(fromEnv).length) {
      sub.push(`[${head}.env_http_headers]`, ...Object.entries(fromEnv).map(([k, v]) => `${tomlKey(k)} = ${tomlStr(v)}`), '')
      value.env_http_headers = fromEnv
    }
  }
  return { text: [...lines, '', ...sub].join('\n').trimEnd() + '\n', value }
}

interface Prepared {
  plan: McpCopyPlan
  place?: Place
  write?: () => void
}

function prepare(
  from: { client: McpClient; scope: Scope; name: string },
  to: { client: McpClient; scope: Scope },
  projectPath?: string
): Prepared {
  const fail = (error: string, file = ''): Prepared => ({
    plan: { client: to.client, scope: to.scope, file, snippet: '', needsEnv: [], warnings: [], error }
  })
  if (!NAME.test(from?.name ?? '')) return fail('Nombre de servidor no válido')
  if (to.scope === 'project' && !projectPath) return fail('Hace falta el proyecto')
  const source = sourceSpec(from, projectPath)
  if (!source) return fail('No se encuentra ese servidor en su configuración')
  const found = source.found
  const def = definitionOf(from.client, source.place, found)
  if (def.secretInline) {
    return fail('Lleva un secreto escrito en los argumentos o en la URL. Pásalo a una variable de entorno en el original y cópialo después.')
  }
  const place = writePlace(to.client, to.scope, projectPath)
  if (!place) return fail('Ese destino no admite servidores MCP')
  const s = found.spec
  if (s.transport === 'ws' && to.client !== 'claude') return fail('Es un servidor por WebSocket: sólo Claude Code los admite.', place.file)
  if (s.transport === 'sse' && to.client === 'codex') return fail('Codex sólo habla HTTP transmitible (streamable), no SSE.', place.file)

  const current = readPlace(place)
  if (current.error) return fail(`${basename(place.file)} tiene errores (${current.error}): no se escribe en él.`, place.file)
  if (current.servers.has(from.name)) {
    return fail(`Ya hay un servidor «${from.name}» en ${place.file}. No se toca: si quieres reemplazarlo, bórralo tú primero.`, place.file)
  }

  const warnings: string[] = []
  const { spec, converted } = withoutSecrets(from.name, s)
  if (converted.length) {
    warnings.push(
      `Los secretos no se copian: ${converted.join(', ')} ${converted.length === 1 ? 'pasa' : 'pasan'} a leerse de ${converted.length === 1 ? 'una variable' : 'variables'} de entorno con ${converted.length === 1 ? 'ese nombre' : 'esos nombres'}. El valor sigue en ${def.file}.`
    )
  }
  if (to.client === 'copilot' && allRefs(spec).length) {
    warnings.push('La documentación de Copilot CLI no dice si expande ${VAR}: comprueba que el servidor arranca.')
  }
  const needsEnv = allRefs(spec)
  const plan: McpCopyPlan = { client: to.client, scope: to.scope, file: place.file, snippet: '', needsEnv, warnings }

  if (place.format === 'app') {
    const entry: AppMcpServer = { ...spec, enabled: true, addedAt: Date.now() }
    plan.snippet = JSON.stringify({ [from.name]: spec }, null, 2)
    return {
      plan,
      place,
      write: () => {
        const cfg = getConfig()
        saveConfig({ ...cfg, mcpServers: { ...(cfg.mcpServers ?? {}), [from.name]: entry } })
      }
    }
  }

  if (place.format === 'toml') {
    let table: { text: string; value: any }
    try {
      table = tomlTable(from.name, spec, warnings)
    } catch (err) {
      return fail((err as Error).message, place.file)
    }
    plan.snippet = table.text
    const before = readText(place.file) ?? ''
    const after = (before && !before.endsWith('\n') ? before + '\n' : before) + (before.trim() ? '\n' : '') + table.text
    // Se comprueba antes de escribir que el fichero se sigue leyendo y trae lo que toca.
    let check: any
    try {
      check = parseToml(after)
    } catch {
      return fail(`No se puede añadir a ${basename(place.file)} sin romperlo (¿define mcp_servers en línea?). Añádelo a mano.`, place.file)
    }
    if (JSON.stringify(check?.mcp_servers?.[from.name]) !== JSON.stringify(table.value)) {
      return fail(`No se puede añadir a ${basename(place.file)} sin romperlo. Añádelo a mano.`, place.file)
    }
    return { plan, place, write: () => writeChecked(place, after, plan) }
  }

  const entry = jsonEntry(to.client, spec, warnings)
  plan.snippet = JSON.stringify({ [from.name]: entry }, null, 2)
  const before = readText(place.file) ?? '{}\n'
  const edits = modify(before, [...place.key, from.name], entry, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } })
  const after = applyEdits(before, edits)
  const back = jsonDoc(after)
  if (back.error || JSON.stringify(at(back.doc, [...place.key, from.name])) !== JSON.stringify(entry)) {
    return fail(`No se puede añadir a ${basename(place.file)} sin romperlo. Añádelo a mano.`, place.file)
  }
  return { plan, place, write: () => writeChecked(place, after, plan) }
}

/** Copia de seguridad del fichero y escritura. Se guardan las 60 últimas copias. */
function writeChecked(place: Place, text: string, plan: McpCopyPlan): void {
  const dir = join(paths.dir, 'respaldos', 'mcp')
  if (existsSync(place.file)) {
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = join(dir, `${stamp}-${plan.client}-${plan.scope}-${basename(place.file)}`)
    copyFileSync(place.file, backup)
    plan.backup = backup
    const old = readdirSync(dir).sort()
    for (const f of old.slice(0, Math.max(0, old.length - 60))) {
      try {
        unlinkSync(join(dir, f))
      } catch {
        /* otra vez será */
      }
    }
  }
  mkdirSync(dirname(place.file), { recursive: true })
  writeFileAtomic(place.file, text)
}

export function planMcpCopy(
  from: { client: McpClient; scope: Scope; name: string },
  to: { client: McpClient; scope: Scope },
  projectPath?: string
): McpCopyPlan {
  return prepare(from, to, projectPath).plan
}

export function copyMcpServer(
  from: { client: McpClient; scope: Scope; name: string },
  to: { client: McpClient; scope: Scope },
  projectPath?: string
): McpCopyPlan {
  const p = prepare(from, to, projectPath)
  if (p.plan.error || !p.write) throw new Error(p.plan.error ?? 'No se puede copiar')
  p.write()
  return p.plan
}

/* ------------------------------------------------------------------ *
 * Los de la app                                                      *
 * ------------------------------------------------------------------ */

export function setAppMcpEnabled(name: string, enabled: boolean): void {
  const cfg = getConfig()
  const cur = cfg.mcpServers?.[name]
  if (!cur) throw new Error('No existe ese servidor')
  saveConfig({ ...cfg, mcpServers: { ...cfg.mcpServers, [name]: { ...cur, enabled } } })
}

export function removeAppMcp(name: string): void {
  const cfg = getConfig()
  const next = { ...(cfg.mcpServers ?? {}) }
  delete next[name]
  saveConfig({ ...cfg, mcpServers: next })
}

/**
 * Alta a mano: una orden o una URL y los nombres de las variables de entorno
 * que necesita. Los valores no pasan nunca por aquí: se leen del entorno.
 */
export function addAppMcp(input: { name: string; target: string; envVars?: string[] }): void {
  const name = (input?.name ?? '').trim()
  if (!NAME.test(name)) throw new Error('Nombre no válido: letras, números, puntos, guiones y guiones bajos')
  const cfg = getConfig()
  if (cfg.mcpServers?.[name]) throw new Error(`Ya hay un servidor «${name}»`)
  const target = (input?.target ?? '').trim()
  if (!target) throw new Error('Falta la orden o la URL')
  const env: Record<string, string> = {}
  for (const v of input.envVars ?? []) {
    const k = v.trim()
    if (!k) continue
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`${k} no es un nombre de variable válido`)
    env[k] = '${' + k + '}'
  }
  let spec: McpSpec
  if (/^https?:\/\//i.test(target)) {
    if (maskUrl(target).secret) throw new Error('La URL lleva un secreto: ponlo en una variable de entorno')
    spec = { transport: 'http', url: target }
  } else {
    const parts = target.match(/"[^"]*"|'[^']*'|\S+/g)?.map((p) => p.replace(/^["']|["']$/g, '')) ?? []
    if (maskArgs(parts.slice(1)).secret) throw new Error('La orden lleva un secreto: ponlo en una variable de entorno')
    spec = { transport: 'stdio', command: parts[0], args: parts.slice(1), ...(Object.keys(env).length ? { env } : {}) }
  }
  saveConfig({ ...cfg, mcpServers: { ...(cfg.mcpServers ?? {}), [name]: { ...spec, enabled: true, addedAt: Date.now() } } })
}
