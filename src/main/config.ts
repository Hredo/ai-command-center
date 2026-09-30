import { readFileSync, existsSync } from 'node:fs'
import { paths } from './paths'
import { writeFileAtomic } from './atomic'
import { notifyChange } from './live'
import { defaultTerminalCommand } from './platform'
import { DEFAULT_APPEARANCE, DEFAULT_EDITOR } from '@shared/defaults'
import type { AppConfig, Settings, Agent, CliAgent, Project } from '@shared/types'

const defaultSettings: Settings = {
  theme: 'dark',
  language: 'es',
  appearance: { ...DEFAULT_APPEARANCE },
  editor: { ...DEFAULT_EDITOR },
  panes: {},
  editorCommand: 'code',
  terminalCommand: defaultTerminalCommand(),
  autoRefreshCatalog: true,
  currency: 'USD',
  eurRate: 0.92,
  arenaDefaults: [],
  notifyOnFinish: true,
  notifyOnlyWhenUnfocused: true,
  closeToTray: true,
  localPollSeconds: 8
}

function emptyConfig(): AppConfig {
  return {
    settings: { ...defaultSettings },
    providers: {},
    agents: [],
    cliAgents: [],
    projects: [],
    favorites: [],
    customModels: []
  }
}

let cache: AppConfig | null = null

/**
 * Puesta al día de una configuración de una versión anterior.
 *
 * Los agentes que la app detectó sola se actualizan cuando aprendemos a
 * sacarles más información. Sólo se toca el que siga tal cual lo dejó la
 * detección: si lo has cambiado a mano, se queda como lo pusiste.
 */
function migrateConfig(cfg: AppConfig): void {
  let changed = false
  for (const agent of cfg.cliAgents) {
    const isOldOpencode =
      agent.detected &&
      agent.command === 'opencode' &&
      agent.parser === 'plain' &&
      agent.args.length === 2 &&
      agent.args[0] === 'run' &&
      agent.args[1] === '{{prompt}}'
    if (isOldOpencode) {
      agent.args = ['run', '--format', 'json', '{{prompt}}']
      agent.parser = 'opencode-json'
      changed = true
    }
    // 0.8: Codex, Gemini CLI y Cursor pasan a hablar en JSON, que trae su
    // sesión (para retomarla), sus pasos y sus tokens.
    const plainAs = (command: string, args: string[]): boolean =>
      agent.detected === true &&
      agent.command === command &&
      agent.parser === 'plain' &&
      agent.args.length === args.length &&
      agent.args.every((a, i) => a === args[i])
    if (plainAs('codex', ['exec', '{{prompt}}'])) {
      agent.args = ['exec', '--json', '{{prompt}}']
      agent.parser = 'codex-json'
      changed = true
    } else if (plainAs('gemini', ['-p', '{{prompt}}'])) {
      agent.args = ['--output-format', 'stream-json', '-p', '{{prompt}}']
      agent.parser = 'gemini-stream-json'
      changed = true
    } else if (plainAs('cursor-agent', ['-p', '{{prompt}}'])) {
      agent.args = ['-p', '--output-format', 'stream-json', '{{prompt}}']
      agent.parser = 'claude-stream-json'
      changed = true
    }
  }
  // 0.8: el presupuesto mensual, que era sólo informativo, pasa a ser uno más
  // de la lista de presupuestos, que avisan y pueden bloquear.
  const s = cfg.settings
  if (s.monthlyBudget && s.monthlyBudget > 0 && !s.budgets?.length) {
    s.budgets = [{ id: 'mensual', scope: 'total', period: 'month', limitUsd: s.monthlyBudget }]
    delete s.monthlyBudget
    changed = true
  }
  if (changed) {
    try {
      writeFileAtomic(paths.config, JSON.stringify(cfg, null, 2))
    } catch {
      /* si no se puede escribir, la mejora vale sólo para esta sesión */
    }
  }
}

export function getConfig(): AppConfig {
  if (cache) return cache
  if (existsSync(paths.config)) {
    try {
      const raw = JSON.parse(readFileSync(paths.config, 'utf8'))
      cache = {
        ...emptyConfig(),
        ...raw,
        settings: { ...defaultSettings, ...(raw.settings || {}) }
      }
      migrateConfig(cache!)
      return cache!
    } catch (e) {
      console.error('config.json corrupto, se parte de cero:', e)
    }
  }
  cache = emptyConfig()
  saveConfig(cache)
  return cache
}

export function saveConfig(cfg: AppConfig): AppConfig {
  cache = cfg
  writeFileAtomic(paths.config, JSON.stringify(cfg, null, 2))
  notifyChange('config')
  return cfg
}

export function updateSettings(patch: Partial<Settings>): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, settings: { ...cfg.settings, ...patch } })
}

/** Alta o actualización por id en cualquiera de las colecciones. */
export function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const copy = [...list]
  copy[i] = { ...copy[i], ...item }
  return copy
}

export function saveAgent(agent: Agent): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, agents: upsert(cfg.agents, agent) })
}

export function saveCliAgent(agent: CliAgent): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, cliAgents: upsert(cfg.cliAgents, agent) })
}

export function saveProject(project: Project): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, projects: upsert(cfg.projects, project) })
}

export function removeFrom(kind: 'agents' | 'cliAgents' | 'projects', id: string): AppConfig {
  const cfg = getConfig()
  return saveConfig({ ...cfg, [kind]: (cfg[kind] as { id: string }[]).filter((x) => x.id !== id) } as AppConfig)
}
