/**
 * Skills: carpetas con un SKILL.md que los agentes de consola cargan cuando
 * vienen al caso. Cada CLI las busca en sus sitios, y no todos en los mismos
 * (documentación de cada uno, septiembre de 2026):
 *
 *   Claude Code  ~/.claude/skills            .claude/skills
 *   Codex        ~/.agents/skills            .agents/skills
 *   OpenCode     ~/.config/opencode/skills   .opencode/skills
 *                ~/.claude/skills            .claude/skills
 *                ~/.agents/skills            .agents/skills
 *   Gemini CLI   ~/.gemini/skills            .gemini/skills
 *                ~/.agents/skills            .agents/skills
 *   Copilot CLI  ~/.copilot/skills           .github/skills
 *                ~/.agents/skills            .claude/skills, .agents/skills
 *
 * Así que con dos carpetas se llega a todos: `.claude/skills` para Claude Code
 * y `.agents/skills` para el resto. Aquí se listan todas, se dice quién ve
 * cada una y se copia a donde falte. Copiar nunca pisa: si ya hay una con ese
 * nombre, se dice y no se toca.
 */
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { SkillInfo, SkillLocation, SkillsReport, SkillTool } from '@shared/types'

interface LocDef {
  id: string
  scope: 'personal' | 'project'
  /** Dentro del proyecto, o de la carpeta personal si no se dice `base`. */
  rel: string
  /** De dónde cuelga una personal, si el CLI deja cambiarlo con una variable. */
  base?: () => string
  readers: SkillTool[]
  readOnly?: boolean
}

// Cada CLI deja mover su carpeta con una variable de entorno: se respeta.
const claudeDir = (): string => process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')
const xdgConfig = (): string => process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config')
const geminiHome = (): string => process.env['GEMINI_CLI_HOME'] || homedir()

const LOCATIONS: LocDef[] = [
  { id: 'claude', scope: 'personal', rel: 'skills', base: claudeDir, readers: ['claude', 'opencode'] },
  { id: 'claude-synced', scope: 'personal', rel: 'skills/synced', base: claudeDir, readers: ['claude'], readOnly: true },
  { id: 'agents', scope: 'personal', rel: '.agents/skills', readers: ['codex', 'opencode', 'gemini', 'copilot'] },
  { id: 'opencode', scope: 'personal', rel: 'opencode/skills', base: xdgConfig, readers: ['opencode'] },
  { id: 'gemini', scope: 'personal', rel: '.gemini/skills', base: geminiHome, readers: ['gemini'] },
  { id: 'copilot', scope: 'personal', rel: '.copilot/skills', readers: ['copilot'] },
  { id: 'claude', scope: 'project', rel: '.claude/skills', readers: ['claude', 'opencode', 'copilot'] },
  { id: 'agents', scope: 'project', rel: '.agents/skills', readers: ['codex', 'opencode', 'gemini', 'copilot'] },
  { id: 'opencode', scope: 'project', rel: '.opencode/skills', readers: ['opencode'] },
  { id: 'gemini', scope: 'project', rel: '.gemini/skills', readers: ['gemini'] },
  { id: 'github', scope: 'project', rel: '.github/skills', readers: ['copilot'] }
]

/** Carpetas dentro de una de Skills que no son Skills. */
const NOT_SKILLS = new Set(['synced', '.trash'])
/** Una Skill con más que esto no se copia: no es una Skill, es otra cosa. */
const MAX_BYTES = 50 * 1024 * 1024
const MAX_FILES = 3000
/** Lo que nunca se copia de una Skill. */
const SKIP = new Set(['.git', 'node_modules', '.venv', '__pycache__'])
/** El nombre que exige el estándar (y OpenCode, que lo hace cumplir). */
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function locPath(def: LocDef, projectPath?: string): string | null {
  const base = def.scope === 'personal' ? (def.base ?? homedir)() : projectPath
  return base ? join(base, ...def.rel.split('/')) : null
}

/** Lee `name` y `description` del frontmatter, incluidos los bloques `>` y `|`. */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^﻿/, ''))
  if (!m) return {}
  const out: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i])
    if (!kv || (kv[1] !== 'name' && kv[1] !== 'description')) continue
    let value = kv[2].trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim())
      value = block.join(value.startsWith('>') ? ' ' : '\n')
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1)
    }
    out[kv[1]] = value
  }
  return { name: out.name || undefined, description: out.description || undefined }
}

function dirsOf(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !NOT_SKILLS.has(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    return []
  }
}

export function listSkills(projectPath?: string): SkillsReport {
  const locations: SkillLocation[] = []
  const byKey = new Map<string, SkillInfo>()
  for (const def of LOCATIONS) {
    if (def.scope === 'project' && !projectPath) continue
    const path = locPath(def, projectPath)
    if (!path) continue
    const exists = existsSync(path)
    locations.push({ id: def.id, scope: def.scope, path, readers: def.readers, exists, readOnly: def.readOnly })
    if (!exists) continue
    for (const dir of dirsOf(path)) {
      const file = join(path, dir, 'SKILL.md')
      let text: string
      try {
        if (!statSync(file).isFile()) continue
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const fm = parseFrontmatter(text)
      const key = `${def.scope}:${dir}`
      const skill =
        byKey.get(key) ??
        ({ dir, scope: def.scope, name: fm.name, description: fm.description, copies: [], readers: [], differs: false, warnings: [], rejectedBy: [] } as SkillInfo)
      const hash = createHash('sha1').update(text).digest('hex')
      if (skill.copies.length && skill.copies.some((c) => c.hash !== hash)) skill.differs = true
      skill.copies.push({ location: def.id, path: join(path, dir), hash })
      for (const r of def.readers) if (!skill.readers.includes(r)) skill.readers.push(r)
      if (!skill.name && fm.name) skill.name = fm.name
      if (!skill.description && fm.description) skill.description = fm.description
      byKey.set(key, skill)
    }
  }
  // Lo que cada CLI exige según su documentación: Codex, OpenCode y Copilot
  // piden name y description; OpenCode, además, que name sea como la carpeta.
  for (const s of byKey.values()) {
    if (!s.name || !s.description) {
      s.warnings.push('Su SKILL.md no tiene name y description en el frontmatter: algunos CLIs no la cargan.')
      s.rejectedBy = (['codex', 'opencode', 'copilot'] as SkillTool[]).filter((r) => s.readers.includes(r))
    } else if (s.name !== s.dir || !NAME_RE.test(s.name)) {
      s.warnings.push('OpenCode sólo la carga si su name es igual que la carpeta, en minúsculas y con guiones.')
      s.rejectedBy = s.readers.includes('opencode') ? ['opencode'] : []
    }
  }
  const skills = [...byKey.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.dir.localeCompare(b.dir))
  return { locations, skills }
}

/** Cuánto ocupa lo que se copiaría, sin contar lo que se salta. */
function measure(dir: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else {
        files++
        bytes += statSync(full).size
      }
      if (bytes > MAX_BYTES || files > MAX_FILES) return
    }
  }
  walk(dir)
  return { bytes, files }
}

/**
 * Copia una Skill a otra carpeta de Skills. El origen tiene que ser una Skill
 * de las que se listan (no cualquier ruta) y el destino, una carpeta conocida.
 */
export function copySkill(source: string, target: { id: string; scope: 'personal' | 'project' }, projectPath?: string): SkillsReport {
  const report = listSkills(projectPath)
  const src = resolve(source)
  const skill = report.skills.find((s) => s.copies.some((c) => resolve(c.path) === src))
  if (!skill) throw new Error('Esa carpeta no es una de las Skills que se conocen')
  const def = LOCATIONS.find((l) => l.id === target?.id && l.scope === target?.scope)
  if (!def || def.readOnly) throw new Error('Destino de Skills no válido')
  const base = locPath(def, projectPath)
  if (!base) throw new Error('Hace falta el proyecto para copiarla a una carpeta del proyecto')
  const name = basename(src)
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new Error('Nombre de Skill no válido')
  const dest = join(base, name)
  if (resolve(dest) === src) throw new Error('Ya está en esa carpeta')
  if (existsSync(dest)) {
    throw new Error(`Ya hay una Skill «${name}» en ${base}. No se toca: si quieres reemplazarla, bórrala tú primero.`)
  }
  const size = measure(src)
  if (size.bytes > MAX_BYTES || size.files > MAX_FILES) {
    throw new Error(`«${name}» ocupa demasiado para copiarla (${size.files} ficheros): cópiala a mano si de verdad es una Skill.`)
  }
  cpSync(src, dest, {
    recursive: true,
    errorOnExist: true,
    force: false,
    dereference: true,
    filter: (from) => !relative(src, from).split(sep).some((part) => SKIP.has(part))
  })
  return listSkills(projectPath)
}
