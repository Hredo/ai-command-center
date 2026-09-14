import { ipcMain, dialog, shell, app, BrowserWindow, safeStorage } from 'electron'
import { writeFileSync } from 'node:fs'
import { getConfig, saveConfig, updateSettings, saveAgent, saveCliAgent, saveProject, removeFrom } from './config'
import { setKey, getStoredKey, listKeyStatus, mask, resolveKey } from './secrets'
import { PROVIDERS } from './providers/catalog'
import { fetchProviderModels, refreshCatalog, getCatalog, searchCatalog, priceFor, enrich } from './providers/models'
import { runPrompt, abortRun, testProvider, answerApproval } from './providers/run'
import { runCliAgent, killCli } from './agents/cli'
import { detectAll, detectClis, probeLocalServers, providerStatuses, KNOWN_CLIS } from './detect'
import { scanProject, projectContext, listProjectFiles, openInEditor, openInExplorer, openInTerminal } from './projects'
import { queryRuns, overview, updateRun, deleteRun, clearRuns, arenaSessions, allRuns, bucketBy } from './runs'
import { paths } from './paths'
import { registerExtraIpc } from './ipcExtra'
import { checkArgs, isTrustedSender, openExternal, RENDERER_PREFS, type SecurityReport } from './security'
import { notifyRun } from './notify'
import { TITLEBAR_HEIGHT } from '@shared/defaults'
import type { RunOptions, CliRunOptions, Agent, CliAgent, Project } from '@shared/types'

/** El servidor de desarrollo, si lo hay: es el otro origen de confianza. */
const DEV_URL = process.env['ELECTRON_RENDERER_URL']

/**
 * Envuelve un handler con tres cosas que nadie debería tener que repetir:
 *
 *  - Comprueba quién llama. Sólo el marco principal de nuestra ventana. Un
 *    `iframe` colado en una respuesta de un modelo no tiene acceso a esto.
 *  - Revisa el tamaño y el número de argumentos, para que un error o un abuso
 *    no se traduzca en megabytes atravesando el puente.
 *  - Convierte un fallo en un mensaje para la interfaz en vez de en un crash.
 *    El detalle se registra en la consola del proceso principal, pero lo que
 *    viaja a la ventana es sólo el mensaje: las trazas llevan rutas y a veces
 *    trozos de lo que se estaba procesando.
 */
export function handle(channel: string, fn: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!isTrustedSender(e, DEV_URL)) {
      console.warn(`[ipc] ${channel}: llamada rechazada, el emisor no es la ventana`)
      return { ok: false, error: 'llamada no autorizada' }
    }
    try {
      checkArgs(channel, args)
      return { ok: true, data: await fn(...args) }
    } catch (err: any) {
      console.error(`[ipc] ${channel}:`, err)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // ---------------- Config ----------------
  handle('config:get', () => getConfig())
  handle('config:save', (cfg: any) => saveConfig(cfg))
  handle('config:settings', (patch: any) => updateSettings(patch))

  // ---------------- Proveedores ----------------
  handle('providers:defs', () => PROVIDERS)
  handle('providers:status', (probe = true) => providerStatuses(probe))
  handle('providers:test', (id: string) => testProvider(id))
  handle('providers:setKey', (id: string, key: string) => {
    setKey(id, key)
    return { source: resolveKey(id).source, masked: mask(getStoredKey(id)) }
  })
  handle('providers:keyStatus', () => listKeyStatus())
  handle('providers:keyPreview', (id: string) => mask(getStoredKey(id)))
  handle('providers:setBaseUrl', (id: string, baseUrl: string) => {
    const cfg = getConfig()
    return saveConfig({
      ...cfg,
      providers: { ...cfg.providers, [id]: { ...(cfg.providers[id] ?? {}), baseUrl } }
    })
  })
  handle('providers:setEnabled', (id: string, enabled: boolean) => {
    const cfg = getConfig()
    return saveConfig({
      ...cfg,
      providers: { ...cfg.providers, [id]: { ...(cfg.providers[id] ?? {}), enabled } }
    })
  })
  handle('providers:setPrice', (id: string, model: string, pin: number, pout: number) => {
    const cfg = getConfig()
    const prev = cfg.providers[id] ?? {}
    return saveConfig({
      ...cfg,
      providers: {
        ...cfg.providers,
        [id]: { ...prev, pricing: { ...(prev.pricing ?? {}), [model]: [pin, pout] } }
      }
    })
  })

  // ---------------- Modelos ----------------
  handle('models:fromProvider', async (id: string) => enrich(await fetchProviderModels(id)))
  handle('models:catalog', (query: string, limit?: number) => searchCatalog(query ?? '', limit))
  handle('models:catalogMeta', () => {
    const c = getCatalog()
    return { fetchedAt: c.fetchedAt, count: c.models.length }
  })
  handle('models:refresh', () => refreshCatalog())
  handle('models:price', (providerId: string, model: string) => priceFor(providerId, model))
  handle('models:available', async () => {
    // Modelos usables ahora: proveedores con key o motores locales vivos.
    const statuses = await providerStatuses(true)
    const usable = statuses.filter((s) => (s.local ? s.reachable : s.keySource !== 'none'))
    const results = await Promise.allSettled(usable.map((s) => fetchProviderModels(s.id)))
    const out: any[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push(...enrich(r.value))
      else out.push({ __error: true, providerId: usable[i].id, message: String(r.reason?.message ?? r.reason) })
    })
    return out
  })

  // ---------------- Detección ----------------
  handle('detect:all', () => detectAll())
  handle('detect:clis', () => detectClis())
  handle('detect:local', () => probeLocalServers())
  handle('detect:knownClis', () => KNOWN_CLIS)
  handle('detect:importClis', async () => {
    // Da de alta como agentes los CLIs que estén instalados y falten.
    const found = (await detectClis(false)).filter((c) => c.found)
    const cfg = getConfig()
    const existing = new Set(cfg.cliAgents.map((a) => a.id))
    const palette = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#fb7185', '#60a5fa']
    let added = 0
    for (const f of found) {
      if (existing.has(f.id)) continue
      const known = KNOWN_CLIS.find((k) => k.id === f.id)!
      saveCliAgent({
        id: f.id,
        name: f.name,
        type: 'cli',
        command: known.command,
        args: known.args,
        parser: known.parser,
        color: palette[added % palette.length],
        detected: true,
        path: f.path,
        createdAt: Date.now()
      })
      added++
    }
    return { added, found: found.length }
  })

  // ---------------- Ejecución ----------------
  ipcMain.handle('run:prompt', async (_e, opts: RunOptions, runId: string) => {
    const win = getWindow()
    const send = (payload: any): void => {
      if (win && !win.isDestroyed()) win.webContents.send('run:delta', { runId, ...payload })
    }
    const run = await runPrompt(opts, send, runId)
    if (run.kind !== 'arena') notifyRun(run)
    return { ok: run.status !== 'error', data: run, error: run.error }
  })
  handle('run:abort', (runId: string) => abortRun(runId))
  handle('run:approve', (runId: string, stepId: string, allow: boolean) =>
    answerApproval(String(runId), String(stepId), allow === true)
  )

  ipcMain.handle('cli:run', async (_e, opts: CliRunOptions, runId: string) => {
    const win = getWindow()
    const send = (payload: any): void => {
      if (win && !win.isDestroyed()) win.webContents.send('cli:event', { runId, ...payload })
    }
    const run = await runCliAgent(opts, send, runId)
    if (run.kind !== 'arena') notifyRun(run)
    return { ok: run.status !== 'error', data: run, error: run.error }
  })
  handle('cli:kill', (runId: string) => killCli(runId))

  // ---------------- Agentes ----------------
  handle('agents:save', (agent: Agent) => saveAgent(agent))
  handle('agents:saveCli', (agent: CliAgent) => saveCliAgent(agent))
  handle('agents:remove', (id: string) => removeFrom('agents', id))
  handle('agents:removeCli', (id: string) => removeFrom('cliAgents', id))

  // ---------------- Proyectos ----------------
  handle('projects:pick', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Elige la carpeta del proyecto',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    return res.filePaths[0]
  })
  handle('projects:save', (p: Project) => saveProject(p))
  handle('projects:remove', (id: string) => removeFrom('projects', id))
  handle('projects:scan', (path: string) => scanProject(path))
  handle('projects:context', (path: string, opts: any) => projectContext(path, opts ?? {}))
  handle('projects:files', (path: string, query: string) => listProjectFiles(path, query ?? ''))
  handle('projects:openEditor', (path: string) => openInEditor(path))
  handle('projects:openFolder', (path: string) => openInExplorer(path))
  handle('projects:openTerminal', (path: string) => openInTerminal(path))

  // ---------------- Histórico y analítica ----------------
  handle('runs:query', (q: any) => queryRuns(q ?? {}))
  handle('runs:overview', (days: number) => overview(days ?? 30))
  handle('runs:update', (id: string, patch: any) => updateRun(id, patch))
  handle('runs:delete', (id: string) => deleteRun(id))
  handle('runs:clear', () => clearRuns())
  handle('runs:arena', () => arenaSessions())
  handle('runs:compare', (ids: string[]) => allRuns().filter((r) => ids.includes(r.id)))
  handle('runs:buckets', (field: string, days: number) => {
    const since = Date.now() - (days ?? 30) * 86_400_000
    const rows = allRuns().filter((r) => r.createdAt >= since)
    const keyOf =
      field === 'model'
        ? (r: any) => r.model
        : field === 'project'
          ? (r: any) => r.projectName ?? '—'
          : field === 'agent'
            ? (r: any) => r.agentName ?? '—'
            : (r: any) => r.providerId
    return bucketBy(rows, keyOf)
  })
  handle('runs:export', async (format: 'json' | 'csv') => {
    const win = getWindow()
    const res = await dialog.showSaveDialog(win!, {
      title: 'Exportar histórico',
      defaultPath: `ai-command-center-runs.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (res.canceled || !res.filePath) return null
    const rows = allRuns()
    if (format === 'json') {
      writeFileSync(res.filePath, JSON.stringify(rows, null, 2), 'utf8')
    } else {
      const cols = [
        'id', 'createdAt', 'kind', 'providerId', 'model', 'agentName', 'projectName',
        'status', 'promptTokens', 'completionTokens', 'ttftMs', 'totalMs', 'tokensPerSec', 'costTotal'
      ]
      const esc = (v: any): string => {
        const s = v == null ? '' : String(v)
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const lines = [cols.join(',')]
      for (const r of rows) lines.push(cols.map((c) => esc((r as any)[c])).join(','))
      writeFileSync(res.filePath, lines.join('\n'), 'utf8')
    }
    return { path: res.filePath, rows: rows.length }
  })

  // ---------------- App ----------------
  handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: paths.dir,
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
    providerCount: PROVIDERS.length
  }))
  handle('app:openExternal', (url: string) => openExternal(url))
  handle('app:openDataDir', () => shell.openPath(paths.dir))
  handle('app:security', (): SecurityReport => {
    return {
      contextIsolation: RENDERER_PREFS.contextIsolation,
      nodeIntegration: RENDERER_PREFS.nodeIntegration,
      sandboxedRenderer: RENDERER_PREFS.sandbox,
      csp: true,
      navigationLocked: true,
      permissionsDenied: true,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      packaged: app.isPackaged,
      dataDir: paths.dir
    }
  })

  /**
   * Escala de la ventana y colores de la barra de título.
   *
   * El zoom lo aplica el preload con `webFrame`, pero los botones de Windows
   * los dibuja el sistema y no se enteran: hay que recalcular el alto de la
   * franja o dejan de cuadrar con la barra que pinta la aplicación.
   */
  handle('app:chrome', (opts: { zoom?: number; background?: string; symbol?: string }) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return false
    const zoom = Math.min(2, Math.max(0.5, Number(opts?.zoom) || 1))
    const hex = /^#[0-9a-fA-F]{6}$/
    win.setTitleBarOverlay({
      height: Math.round(TITLEBAR_HEIGHT * zoom),
      color: hex.test(opts?.background ?? '') ? opts.background! : undefined,
      symbolColor: hex.test(opts?.symbol ?? '') ? opts.symbol! : undefined
    })
    return true
  })

  // Terminales, sesiones, Ollama, enlaces y avisos.
  registerExtraIpc(getWindow)
}
