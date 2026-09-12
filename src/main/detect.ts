import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, effectiveBaseUrl } from './providers/catalog'
import { resolveKey, mask } from './secrets'
import { getConfig, saveConfig } from './config'
import type { DetectionResult, DetectedCli, DetectedServer, ProviderStatus } from '@shared/types'

/** CLIs de agentes conocidos, con la forma de invocarlos sin interacción. */
export const KNOWN_CLIS: {
  id: string
  name: string
  command: string
  args: string[]
  parser: 'claude-stream-json' | 'opencode-json' | 'plain'
}[] = [
  {
    // Sin {{prompt}}: el prompt entra por stdin y así no hay que escaparlo.
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: ['-p', '--output-format', 'stream-json', '--verbose'],
    parser: 'claude-stream-json'
  },
  { id: 'codex', name: 'OpenAI Codex', command: 'codex', args: ['exec', '{{prompt}}'], parser: 'plain' },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini', args: ['-p', '{{prompt}}'], parser: 'plain' },
  { id: 'aider', name: 'Aider', command: 'aider', args: ['--message', '{{prompt}}', '--yes'], parser: 'plain' },
  {
    // --format json saca sus eventos uno por línea: de ahí salen el
    // razonamiento, los archivos que abre y sus tokens de verdad.
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['run', '--format', 'json', '{{prompt}}'],
    parser: 'opencode-json'
  },
  { id: 'goose', name: 'Goose', command: 'goose', args: ['run', '-t', '{{prompt}}'], parser: 'plain' },
  { id: 'crush', name: 'Crush', command: 'crush', args: ['run', '{{prompt}}'], parser: 'plain' },
  { id: 'amp', name: 'Amp', command: 'amp', args: ['-x', '{{prompt}}'], parser: 'plain' },
  { id: 'qwen-code', name: 'Qwen Code', command: 'qwen', args: ['-p', '{{prompt}}'], parser: 'plain' },
  { id: 'cursor-agent', name: 'Cursor Agent', command: 'cursor-agent', args: ['-p', '{{prompt}}'], parser: 'plain' },
  { id: 'droid', name: 'Factory Droid', command: 'droid', args: ['exec', '{{prompt}}'], parser: 'plain' },
  { id: 'llm', name: 'llm (Datasette)', command: 'llm', args: ['{{prompt}}'], parser: 'plain' }
]

function run(cmd: string, args: string[], timeout = 4000): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, shell: false }, (err, stdout, stderr) => {
      resolve({ out: (stdout || stderr || '').toString().trim(), code: err ? 1 : 0 })
    })
  })
}

/** `where` en Windows, `which` en el resto. */
async function whichCmd(command: string): Promise<string | undefined> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const { out, code } = await run(finder, [command], 4000)
  if (code !== 0 || !out) return undefined
  return out.split(/\r?\n/)[0]?.trim() || undefined
}

export async function detectClis(withVersion = true): Promise<DetectedCli[]> {
  return Promise.all(
    KNOWN_CLIS.map(async (c) => {
      const path = await whichCmd(c.command)
      const found = Boolean(path)
      let version: string | undefined
      if (found && withVersion) {
        const { out } = await run(c.command, ['--version'], 5000)
        version = out.split(/\r?\n/)[0]?.slice(0, 60) || undefined
      }
      return { id: c.id, name: c.name, command: c.command, found, path, version }
    })
  )
}

/**
 * Bases alternativas a probar. En Windows `localhost` resuelve primero a ::1 y
 * muchos motores sólo escuchan en 127.0.0.1 (o al contrario), así que un único
 * intento da falsos negativos: el motor está encendido y la app dice que no.
 */
function candidateBases(base: string): string[] {
  const out = [base]
  if (/\/\/127\.0\.0\.1[:/]?/.test(base)) out.push(base.replace('127.0.0.1', 'localhost'))
  else if (/\/\/localhost[:/]?/.test(base)) out.push(base.replace('localhost', '127.0.0.1'))
  else if (/\/\/\[::1\][:/]?/.test(base)) out.push(base.replace('[::1]', '127.0.0.1'))
  return out
}

/** Guarda como definitiva la dirección por la que el motor sí contesta. */
function rememberWorkingBase(providerId: string, baseUrl: string): void {
  const cfg = getConfig()
  if (cfg.providers[providerId]?.baseUrl === baseUrl) return
  console.log(`[detect] ${providerId} responde en ${baseUrl}; se guarda como endpoint`)
  saveConfig({
    ...cfg,
    providers: { ...cfg.providers, [providerId]: { ...(cfg.providers[providerId] ?? {}), baseUrl } }
  })
}

/** Sondea los puertos de los motores locales conocidos. */
export async function probeLocalServers(timeoutMs = 1500): Promise<DetectedServer[]> {
  const locals = PROVIDERS.filter((p) => p.local)
  return Promise.all(
    locals.map(async (def) => {
      const override = getConfig().providers[def.id]
      const base = effectiveBaseUrl(def, override?.baseUrl)
      const down: DetectedServer = { id: def.id, name: def.name, url: base, up: false, models: [] }

      for (const candidate of candidateBases(base)) {
        const t0 = Date.now()
        try {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), timeoutMs)
          const res = await fetch(`${candidate}${def.modelsPath ?? '/models'}`, { signal: ctrl.signal })
          clearTimeout(timer)
          if (!res.ok) continue
          const json: any = await res.json()
          const models: string[] =
            def.kind === 'ollama'
              ? (json.models ?? []).map((m: any) => m.name)
              : (json.data ?? []).map((m: any) => m.id)

          // Si ha respondido por la base alternativa, se fija como la buena:
          // de lo contrario el sondeo diría "encendido" y luego el prompt
          // fallaría al salir por la dirección que no escucha.
          if (candidate !== base) {
            rememberWorkingBase(def.id, candidate)
          }
          return { id: def.id, name: def.name, url: candidate, up: true, models, latencyMs: Date.now() - t0 }
        } catch {
          // Se prueba la siguiente base antes de darlo por caído.
        }
      }
      return down
    })
  )
}

/* ------------------------------------------------------------------ *
 * Vigilancia de motores locales                                      *
 * ------------------------------------------------------------------ */

let watchTimer: NodeJS.Timeout | null = null
/** Huella del último sondeo, para avisar sólo cuando algo cambia de verdad. */
let lastFingerprint = ''

function fingerprint(servers: DetectedServer[]): string {
  return servers
    .filter((s) => s.up)
    .map((s) => `${s.id}:${s.models.length}`)
    .sort()
    .join('|')
}

/**
 * Sondea en segundo plano y llama a onChange cuando aparece o desaparece un
 * motor, o cuando cambia su lista de modelos. Así arrancar Ollama con la app
 * abierta se refleja solo, sin tener que pulsar "Reescanear".
 */
export function watchLocalServers(onChange: (servers: DetectedServer[]) => void): void {
  stopWatchingLocalServers()
  const tick = async (): Promise<void> => {
    const seconds = getConfig().settings.localPollSeconds ?? 8
    if (seconds > 0) {
      try {
        const servers = await probeLocalServers(1200)
        const fp = fingerprint(servers)
        if (fp !== lastFingerprint) {
          lastFingerprint = fp
          onChange(servers)
        }
      } catch (err) {
        console.error('[detect] fallo sondeando motores locales:', err)
      }
    }
    watchTimer = setTimeout(() => void tick(), Math.max(3, seconds || 8) * 1000)
  }
  // Un primer sondeo inmediato fija la huella sin avisar de un cambio falso.
  void probeLocalServers(1200)
    .then((s) => {
      lastFingerprint = fingerprint(s)
    })
    .catch(() => undefined)
    .finally(() => {
      watchTimer = setTimeout(() => void tick(), 4000)
    })
}

export function stopWatchingLocalServers(): void {
  if (watchTimer) clearTimeout(watchTimer)
  watchTimer = null
}

/** Claves de API presentes en el entorno del usuario. */
export function detectEnvKeys(): { name: string; providerId?: string; masked: string }[] {
  const out: { name: string; providerId?: string; masked: string }[] = []
  const seen = new Set<string>()
  for (const p of PROVIDERS) {
    for (const name of p.envKeys) {
      const v = process.env[name]
      if (v && v.trim() && !seen.has(name)) {
        seen.add(name)
        out.push({ name, providerId: p.id, masked: mask(v.trim()) })
      }
    }
  }
  // Cualquier otra variable con pinta de key de IA que no esté en el catálogo.
  for (const [name, v] of Object.entries(process.env)) {
    if (seen.has(name) || !v) continue
    if (/^[A-Z0-9_]*(API_KEY|_TOKEN|APIKEY)$/.test(name) && /AI|LLM|GPT|CLAUDE|GEMINI|MODEL|ANTHROPIC|OPENAI/.test(name)) {
      seen.add(name)
      out.push({ name, masked: mask(v) })
    }
  }
  return out
}

const CONFIG_DIRS: { name: string; rel: string }[] = [
  { name: 'Claude Code', rel: '.claude' },
  { name: 'Codex', rel: '.codex' },
  { name: 'Gemini CLI', rel: '.gemini' },
  { name: 'Aider', rel: '.aider.conf.yml' },
  { name: 'Ollama', rel: '.ollama' },
  { name: 'LM Studio', rel: '.lmstudio' },
  { name: 'Cursor', rel: '.cursor' },
  { name: 'Continue', rel: '.continue' },
  { name: 'Goose', rel: '.config/goose' }
]

export function detectConfigDirs(): { name: string; path: string; exists: boolean }[] {
  const home = homedir()
  return CONFIG_DIRS.map((d) => {
    const path = join(home, d.rel)
    return { name: d.name, path, exists: existsSync(path) }
  })
}

/** Estado de todos los proveedores: key encontrada + alcanzable. */
export async function providerStatuses(probe = true): Promise<ProviderStatus[]> {
  const cfg = getConfig()
  const servers = probe ? await probeLocalServers() : []
  return PROVIDERS.map((def) => {
    const override = cfg.providers[def.id]
    const { source, envVar } = resolveKey(def.id)
    const server = servers.find((s) => s.id === def.id)
    const base = effectiveBaseUrl(def, override?.baseUrl)
    const enabled = override?.enabled ?? (def.local ? Boolean(server?.up) : source !== 'none')
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      local: def.local,
      baseUrl: base,
      enabled,
      keySource: source,
      envVar,
      reachable: def.local ? (server ? server.up : null) : source !== 'none' ? null : false,
      detail: def.local
        ? server?.up
          ? `${server.models.length} modelos · ${server.latencyMs}ms`
          : 'Sin respuesta en el puerto'
        : source === 'env'
          ? `Key desde ${envVar}`
          : source === 'stored'
            ? 'Key guardada'
            : 'Sin key',
      modelCount: server?.models.length,
      checkedAt: Date.now()
    }
  })
}

export async function detectAll(): Promise<DetectionResult> {
  const [clis, localServers, providers] = await Promise.all([
    detectClis(),
    probeLocalServers(),
    providerStatuses(false)
  ])
  // Se reconcilia el estado local con el sondeo ya hecho para no repetirlo.
  for (const p of providers) {
    const s = localServers.find((x) => x.id === p.id)
    if (s) {
      p.reachable = s.up
      p.enabled = s.up
      p.modelCount = s.models.length
      p.detail = s.up ? `${s.models.length} modelos · ${s.latencyMs}ms` : 'Sin respuesta en el puerto'
    }
  }
  return {
    providers,
    clis,
    localServers,
    envKeys: detectEnvKeys(),
    configDirs: detectConfigDirs(),
    scannedAt: Date.now()
  }
}

