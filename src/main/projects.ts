import { spawn, execFile } from 'node:child_process'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, extname, basename, relative } from 'node:path'
import { shell } from 'electron'
import { getConfig } from './config'
import type { ProjectInfo } from '@shared/types'

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', 'target', '.cache', 'coverage', '.turbo', 'release', '.gradle',
  'bin', 'obj', '.idea', '.vscode-test', 'vendor', '.pnpm-store'
])

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin', '.go': 'Go', '.rs': 'Rust',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.cpp': 'C++', '.c': 'C', '.swift': 'Swift',
  '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart', '.sql': 'SQL', '.sh': 'Shell',
  '.ps1': 'PowerShell', '.r': 'R', '.ipynb': 'Notebook', '.html': 'HTML', '.css': 'CSS',
  '.scss': 'SCSS', '.md': 'Markdown'
}

/** Dependencias que delatan que un proyecto ya usa IA. */
const AI_DEPS = [
  'openai', '@anthropic-ai/sdk', 'anthropic', '@google/generative-ai', '@google/genai',
  'langchain', '@langchain/core', 'llamaindex', 'ollama', 'ai', '@ai-sdk/openai',
  '@ai-sdk/anthropic', '@ai-sdk/google', 'groq-sdk', '@mistralai/mistralai', 'cohere-ai',
  'transformers', 'torch', 'huggingface_hub', 'litellm', 'google-generativeai',
  'sentence-transformers', 'chromadb', 'faiss-cpu', 'tiktoken', 'instructor', 'guidance'
]

function execIn(cwd: string, cmd: string, args: string[], timeout = 4000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : stdout.toString().trim())
    })
  })
}

interface WalkResult {
  files: string[]
  bytes: number
  truncated: boolean
}

/** Recorrido acotado: no queremos que un monorepo congele la interfaz. */
function walk(dir: string, maxFiles = 4000, maxDepth = 6): WalkResult {
  const files: string[] = []
  let bytes = 0
  let truncated = false

  const visit = (current: string, depth: number): void => {
    if (files.length >= maxFiles) {
      truncated = true
      return
    }
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (files.length >= maxFiles) {
        truncated = true
        return
      }
      if (e.name.startsWith('.') && e.name !== '.env' && e.name !== '.github') continue
      if (IGNORE.has(e.name)) continue
      const full = join(current, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth) visit(full, depth + 1)
      } else if (e.isFile()) {
        files.push(full)
        try {
          bytes += statSync(full).size
        } catch {
          /* fichero volátil */
        }
      }
    }
  }
  visit(dir, 0)
  return { files, bytes, truncated }
}

function readJson(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Sólo los NOMBRES de las variables: los valores no salen nunca del disco. */
function envKeyNames(dir: string): string[] {
  const names = new Set<string>()
  for (const f of ['.env', '.env.local', '.env.development', '.env.production']) {
    const p = join(dir, f)
    if (!existsSync(p)) continue
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
        if (m) names.add(m[1])
      }
    } catch {
      /* sin permisos */
    }
  }
  return [...names]
}

export async function scanProject(path: string): Promise<ProjectInfo> {
  if (!existsSync(path)) {
    return { path, exists: false, languages: [], aiDeps: [], envKeyNames: [] }
  }

  const { files, bytes, truncated } = walk(path)

  const counts = new Map<string, number>()
  for (const f of files) {
    const lang = LANG_BY_EXT[extname(f).toLowerCase()]
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }
  const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l)

  const pkg = readJson(join(path, 'package.json'))
  const aiDeps = new Set<string>()
  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    for (const d of Object.keys(deps)) {
      if (AI_DEPS.includes(d) || d.startsWith('@ai-sdk/') || d.startsWith('@langchain/')) aiDeps.add(d)
    }
  }
  for (const reqFile of ['requirements.txt', 'pyproject.toml', 'environment.yml']) {
    const p = join(path, reqFile)
    if (!existsSync(p)) continue
    try {
      const text = readFileSync(p, 'utf8').toLowerCase()
      for (const d of AI_DEPS) if (text.includes(d.toLowerCase())) aiDeps.add(d)
    } catch {
      /* ignorado */
    }
  }

  let packageManager: string | undefined
  if (existsSync(join(path, 'pnpm-lock.yaml'))) packageManager = 'pnpm'
  else if (existsSync(join(path, 'yarn.lock'))) packageManager = 'yarn'
  else if (existsSync(join(path, 'bun.lockb'))) packageManager = 'bun'
  else if (existsSync(join(path, 'package-lock.json'))) packageManager = 'npm'
  else if (existsSync(join(path, 'requirements.txt'))) packageManager = 'pip'
  else if (existsSync(join(path, 'Cargo.toml'))) packageManager = 'cargo'

  const [gitBranch, status] = await Promise.all([
    execIn(path, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    execIn(path, 'git', ['status', '--porcelain'])
  ])

  let readme: string | undefined
  for (const name of ['README.md', 'readme.md', 'README.MD', 'README.txt']) {
    const p = join(path, name)
    if (existsSync(p)) {
      try {
        readme = readFileSync(p, 'utf8').slice(0, 1500)
      } catch {
        /* ignorado */
      }
      break
    }
  }

  return {
    path,
    exists: true,
    gitBranch: gitBranch || undefined,
    gitDirty: status ? status.split('\n').filter(Boolean).length : 0,
    languages,
    packageManager,
    aiDeps: [...aiDeps],
    envKeyNames: envKeyNames(path),
    fileCount: truncated ? files.length : files.length,
    sizeBytes: bytes,
    readme,
    scripts: pkg?.scripts
  }
}

/** Árbol compacto para meter como contexto en el prompt. */
export function projectTree(path: string, maxEntries = 220): string {
  const { files } = walk(path, maxEntries * 3, 4)
  const rels = files.map((f) => relative(path, f).replace(/\\/g, '/')).sort()
  const shown = rels.slice(0, maxEntries)
  const extra = rels.length - shown.length
  return shown.join('\n') + (extra > 0 ? `\n… y ${extra} ficheros más` : '')
}

/**
 * Construye el bloque de contexto que se antepone al prompt cuando hay
 * proyecto seleccionado. Acotado para no reventar la ventana de contexto.
 */
export async function projectContext(
  path: string,
  opts: { tree?: boolean; readme?: boolean; files?: string[]; maxChars?: number } = {}
): Promise<string> {
  const maxChars = opts.maxChars ?? 24_000
  const info = await scanProject(path)
  const parts: string[] = []

  parts.push(`# Proyecto: ${basename(path)}`)
  parts.push(`Ruta: ${path}`)
  if (info.gitBranch) parts.push(`Rama git: ${info.gitBranch} (${info.gitDirty} ficheros modificados)`)
  if (info.languages.length) parts.push(`Lenguajes: ${info.languages.join(', ')}`)
  if (info.packageManager) parts.push(`Gestor de paquetes: ${info.packageManager}`)
  if (info.aiDeps.length) parts.push(`Dependencias de IA: ${info.aiDeps.join(', ')}`)
  if (info.scripts) parts.push(`Scripts: ${Object.keys(info.scripts).join(', ')}`)

  if (opts.readme !== false && info.readme) {
    parts.push(`\n## README (extracto)\n${info.readme}`)
  }
  if (opts.tree !== false) {
    parts.push(`\n## Estructura\n\`\`\`\n${projectTree(path)}\n\`\`\``)
  }
  for (const rel of opts.files ?? []) {
    const full = join(path, rel)
    if (!existsSync(full)) continue
    try {
      const content = readFileSync(full, 'utf8').slice(0, 8000)
      parts.push(`\n## ${rel}\n\`\`\`\n${content}\n\`\`\``)
    } catch {
      /* binario o sin permisos */
    }
  }

  const out = parts.join('\n')
  return out.length > maxChars ? out.slice(0, maxChars) + '\n… (contexto recortado)' : out
}

/** Lista ficheros del proyecto para el selector de contexto. */
export function listProjectFiles(path: string, query = '', limit = 300): string[] {
  const { files } = walk(path, 6000, 7)
  const rels = files.map((f) => relative(path, f).replace(/\\/g, '/'))
  const q = query.toLowerCase()
  return (q ? rels.filter((r) => r.toLowerCase().includes(q)) : rels).slice(0, limit)
}

// ---------------------------------------------------------------------------
// Abrir cosas
// ---------------------------------------------------------------------------

/**
 * Parte lo que el usuario haya escrito en los ajustes («code», «code -n»,
 * «"C:\\Program Files\\X\\x.exe" --flag») en programa y argumentos, respetando
 * las comillas. Sin esto, un comando con opciones se intentaba ejecutar como si
 * el nombre entero fuese el del programa.
 */
function splitCommand(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * En Windows los lanzadores de estas herramientas son `.cmd`, y un `.cmd` sólo
 * arranca a través de `cmd.exe`. Eso obliga a construir una línea de órdenes, y
 * una línea de órdenes es donde vive la inyección de comandos.
 *
 * La regla aquí es entrecomillar *siempre*, no sólo cuando hay un espacio. Los
 * caracteres que a `cmd.exe` le dicen «aquí empieza otro comando» —`&`, `|`,
 * `<`, `>`, `^`— son todos legales en un nombre de carpeta de Windows, así que
 * un proyecto llamado `demo & rm` acababa ejecutando dos cosas. Dentro de
 * comillas no significan nada, y las comillas del propio texto se doblan.
 */
function launch(command: string, args: string[], cwd?: string): void {
  if (process.platform === 'win32') {
    const quoted = [command, ...args].map((a) => `"${String(a).replace(/"/g, '""')}"`)
    // `/s` con un par de comillas envolviendo todo es la forma documentada de
    // decirle a cmd.exe «quita este par y ejecuta el resto tal cual». Y el modo
    // literal hace falta porque, si no, Node vuelve a entrecomillar por su
    // cuenta con barras invertidas, que es una convención que cmd.exe no
    // entiende, y deshace justo lo que se acaba de hacer.
    spawn('cmd.exe', ['/d', '/s', '/c', `"${quoted.join(' ')}"`], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    }).unref()
  } else {
    spawn(command, args, { cwd, detached: true, stdio: 'ignore' }).unref()
  }
}

export function openInEditor(path: string): { ok: boolean; error?: string } {
  const [cmd, ...extra] = splitCommand(getConfig().settings.editorCommand || 'code')
  if (!cmd) return { ok: false, error: 'no hay ningún editor configurado en Ajustes' }
  try {
    launch(cmd, [...extra, path])
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

export function openInExplorer(path: string): void {
  shell.openPath(path)
}

export function openInTerminal(path: string): { ok: boolean; error?: string } {
  const [cmd, ...extra] = splitCommand(getConfig().settings.terminalCommand || 'wt')
  if (!cmd) return { ok: false, error: 'no hay ninguna terminal configurada en Ajustes' }
  try {
    if (process.platform === 'win32') {
      // Windows Terminal si está; si no, una consola normal en la carpeta. La
      // ruta viaja como argumento y nunca pegada dentro de otro comando: no hay
      // ningún `cd /d "…"` que un nombre de carpeta con comillas pueda romper.
      if (cmd === 'wt') launch('wt', [...extra, '-d', path])
      else launch(cmd, [...extra], path)
    } else {
      launch(cmd, [...extra, path], path)
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}
