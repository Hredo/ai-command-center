import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { paths } from './paths'
import { DEFAULT_APPEARANCE, DEFAULT_EDITOR } from '@shared/defaults'
import type { AppConfig, Settings, Agent, CliAgent, Project } from '@shared/types'

const defaultSettings: Settings = {
  theme: 'dark',
  language: 'es',
  appearance: { ...DEFAULT_APPEARANCE },
  editor: { ...DEFAULT_EDITOR },
  panes: {},
  editorCommand: 'code',
  terminalCommand: 'wt',
  autoRefreshCatalog: true,
  currency: 'USD',
  eurRate: 0.92,
  arenaDefaults: [],
  streamChunkMs: 33,
  notifyOnFinish: true,
  notifyOnlyWhenUnfocused: true,
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
 * Los agentes que la app detectó sola se actualizan cuando aprendemos a
 * sacarles más información. Sólo se toca el que siga tal cual lo dejó la
 * detección: si lo has cambiado a mano, se queda como lo pusiste.
 */
function migrateDetectedClis(cfg: AppConfig): void {
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
  }
  if (changed) {
    try {
      writeFileSync(paths.config, JSON.stringify(cfg, null, 2), 'utf8')
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
      migrateDetectedClis(cache!)
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
  writeFileSync(paths.config, JSON.stringify(cfg, null, 2), 'utf8')
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
