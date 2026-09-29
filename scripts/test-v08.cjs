/**
 * Pruebas de lo que llegó en la 0.8.
 *
 * Igual que las demás: nada de proveedores ni CLIs de verdad. Agentes falsos
 * (scripts de Node que hablan como Claude Code, OpenCode, Codex o Gemini CLI),
 * un repositorio git de usar y tirar y un HOME falso para lo que se lee de las
 * carpetas de otras herramientas. Cada bloque se puede leer por separado.
 *
 * Uso: pnpm exec electron scripts/test-v08.cjs
 */
const { app } = require('electron')
const { waitWindow } = require('./window.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-v08-'))
const REPO = path.join(TMP, 'repo')
const FIXTURES = path.join(TMP, 'fixtures')
const HOME = path.join(TMP, 'home')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function setupRepo() {
  fs.mkdirSync(path.join(REPO, 'sub'), { recursive: true })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'prueba@local'])
  git(['config', 'user.name', 'Prueba'])
  fs.writeFileSync(path.join(REPO, 'app.js'), 'uno\ndos\ntres\n', 'utf8')
  fs.writeFileSync(path.join(REPO, 'sub', 'nota.txt'), 'hola\n', 'utf8')
  git(['add', '.'])
  git(['commit', '-qm', 'primer commit'])
}

/** Un CLI falso que habla como Claude Code y hace pasos, para tener detalle que podar. */
const CLAUDE_FIXTURE = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const args = process.argv.slice(2)
const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : ''
const forked = args.includes('--fork-session')
let prompt = ''
process.stdin.on('data', (c) => (prompt += c))
process.stdin.on('end', () => {
  const sid = forked || !resumed ? 'sesion-' + Math.random().toString(16).slice(2, 10) : resumed
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-falso', cwd: process.cwd() })
  out({ type: 'assistant', session_id: sid, message: { model: 'claude-falso', content: [
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'app.js' } },
    { type: 'text', text: 'resume=' + (resumed || 'no') + ' fork=' + forked + ' prompt=' + prompt.slice(0, 200) }
  ], usage: { input_tokens: 100, output_tokens: 20 } } })
  out({ type: 'result', session_id: sid, total_cost_usd: 0.01, duration_ms: 50, num_turns: 1,
    result: 'resume=' + (resumed || 'no') + ' fork=' + forked + ' prompt=' + prompt.slice(0, 400) })
})
`

/**
 * Codex falso con `exec --json`: dice su sesión, razona, lanza un comando,
 * cambia un archivo, lleva una lista de tareas y cierra el turno con tokens.
 * Contesta qué argumentos le llegaron, para comprobar cómo se retoma.
 */
const CODEX_FIXTURE = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const args = process.argv.slice(2)
const r = args.indexOf('resume')
const sid = r !== -1 ? args[r + 1] : 'hilo-' + Math.random().toString(16).slice(2, 10)
const prompt = args[args.length - 1]
out({ type: 'thread.started', thread_id: sid })
out({ type: 'turn.started' })
out({ type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'Pienso primero.' } })
out({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls', status: 'in_progress' } })
out({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'ls', aggregated_output: 'app.js', exit_code: 0, status: 'completed' } })
out({ type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'app.js', kind: 'update' }], status: 'completed' } })
out({ type: 'item.completed', item: { id: 'i3', type: 'todo_list', items: [{ text: 'leer', completed: true }, { text: 'arreglar', completed: false }] } })
out({ type: 'item.completed', item: { id: 'i4', type: 'agent_message', text: 'args=' + args.join(' ') } })
out({ type: 'turn.completed', usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 40, reasoning_output_tokens: 10 } })
`

/** Gemini CLI falso con stream-json. */
const GEMINI_FIXTURE = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const args = process.argv.slice(2)
const r = args.indexOf('--resume')
const sid = r !== -1 ? args[r + 1] : 'gem-' + Math.random().toString(16).slice(2, 10)
out({ type: 'init', session_id: sid, model: 'gemini-falso' })
out({ type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { absolute_path: 'app.js' } })
out({ type: 'tool_result', tool_id: 't1', status: 'success', output: '3 líneas' })
out({ type: 'message', role: 'assistant', content: 'resume=', delta: true })
out({ type: 'message', role: 'assistant', content: (r !== -1 ? args[r + 1] : 'no'), delta: true })
out({ type: 'result', status: 'success', stats: { total_tokens: 300, input_tokens: 250, output_tokens: 50, duration_ms: 80 } })
`

/** OpenCode falso: cada evento lleva sessionID. */
const OPENCODE_FIXTURE = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const args = process.argv.slice(2)
const r = args.indexOf('--session')
const forked = args.includes('--fork')
const sid = r !== -1 && !forked ? args[r + 1] : 'ses_' + Math.random().toString(16).slice(2, 10)
out({ type: 'step_start', sessionID: sid, part: { type: 'step-start', sessionID: sid } })
out({ type: 'text', sessionID: sid, part: { type: 'text', text: 'session=' + (r !== -1 ? args[r + 1] : 'no') + ' fork=' + forked } })
out({ type: 'step_finish', sessionID: sid, part: { type: 'step-finish', reason: 'stop', tokens: { total: 90, input: 80, output: 10, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 } })
`

/** Un CLI de texto plano que no sabe retomar: devuelve lo que le llegó. */
const PLAIN_FIXTURE = `
process.stdout.write('recibido: ' + (process.argv[2] ?? ''))
`

/**
 * Deja un ejecutable con el nombre de la herramienta de verdad (claude,
 * codex…) que lanza su script falso: la app decide cómo retomar por el nombre
 * del comando, así que tiene que llamarse igual.
 */
function makeBin(name, script) {
  const bin = path.join(FIXTURES, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const target = path.join(FIXTURES, script)
  if (process.platform === 'win32') {
    const file = path.join(bin, name + '.cmd')
    fs.writeFileSync(file, `@node "${target}" %*\r\n`, 'utf8')
    return file
  }
  const file = path.join(bin, name)
  fs.writeFileSync(file, `#!/bin/sh\nexec node "${target}" "$@"\n`, 'utf8')
  fs.chmodSync(file, 0o755)
  return file
}

const BINS = {}

/** Un agente que toca el repositorio: edita, crea, borra y cambia lo que ya estaba sin confirmar. */
const EDITOR_FIXTURE = `
const fs = require('node:fs')
const path = require('node:path')
fs.appendFileSync('app.js', 'del-agente\\n')
fs.mkdirSync('nuevo', { recursive: true })
fs.writeFileSync(path.join('nuevo', 'creado.txt'), 'lo creó el agente\\n')
fs.rmSync(path.join('sub', 'nota.txt'))
fs.writeFileSync('previo.txt', 'pisado por el agente\\n')
process.stdout.write('hecho')
`

function setupFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true })
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(path.join(FIXTURES, 'claude.js'), CLAUDE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'codex.js'), CODEX_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'gemini.js'), GEMINI_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'opencode.js'), OPENCODE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'plain.js'), PLAIN_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'editor.js'), EDITOR_FIXTURE, 'utf8')
  BINS.claude = makeBin('claude', 'claude.js')
  BINS.codex = makeBin('codex', 'codex.js')
  BINS.gemini = makeBin('gemini', 'gemini.js')
  BINS.opencode = makeBin('opencode', 'opencode.js')
  BINS.plain = makeBin('otro-cli', 'plain.js')
  BINS.editor = makeBin('editor-cli', 'editor.js')
}

/* ------------------------------------------------------------------ *
 * Sesiones de otras herramientas, en carpetas falsas                  *
 * ------------------------------------------------------------------ */

const CODEX_HOME = path.join(HOME, 'codex')
const GEMINI_HOME = path.join(HOME, 'gemini')
const DATA_HOME = path.join(HOME, 'data')
const CODEX_ID = '0199a213-81c0-7800-8aa1-bbab2a035a53'

function setupExternal() {
  const now = Date.now()
  const iso = (ms) => new Date(ms).toISOString()
  // Codex: una sesión en el repo con sus tokens y las ventanas del plan.
  const day = path.join(CODEX_HOME, 'sessions', '2026', '09', '29')
  fs.mkdirSync(day, { recursive: true })
  const lines = [
    { timestamp: iso(now - 600000), type: 'session_meta', payload: { id: CODEX_ID, cwd: REPO } },
    { timestamp: iso(now - 599000), type: 'turn_context', payload: { cwd: REPO, model: 'gpt-5-codex' } },
    { timestamp: iso(now - 598000), type: 'event_msg', payload: { type: 'user_message', message: 'arregla el login de la app' } },
    {
      timestamp: iso(now - 500000),
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'update_plan',
        arguments: JSON.stringify({ plan: [{ step: 'leer login', status: 'completed' }, { step: 'arreglar token', status: 'in_progress' }] })
      }
    },
    { timestamp: iso(now - 400000), type: 'event_msg', payload: { type: 'agent_message', message: 'He encontrado el fallo del token.' } },
    {
      timestamp: iso(now - 399000),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 9000, cached_input_tokens: 4000, output_tokens: 700, reasoning_output_tokens: 100, total_tokens: 9700 },
          last_token_usage: { input_tokens: 9000, cached_input_tokens: 4000, output_tokens: 700, reasoning_output_tokens: 100, total_tokens: 9700 }
        },
        rate_limits: {
          primary: { used_percent: 42.5, window_minutes: 300, resets_in_seconds: 3600 },
          secondary: { used_percent: 12, window_minutes: 10080, resets_in_seconds: 400000 }
        }
      }
    }
  ]
  fs.writeFileSync(
    path.join(day, `rollout-2026-09-29T10-00-00-${CODEX_ID}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  )

  // Gemini CLI: la carpeta es el SHA-256 de la ruta del proyecto.
  const hash = require('node:crypto').createHash('sha256').update(REPO).digest('hex')
  const chats = path.join(GEMINI_HOME, '.gemini', 'tmp', hash, 'chats')
  fs.mkdirSync(chats, { recursive: true })
  fs.writeFileSync(
    path.join(chats, 'session-gem1.json'),
    JSON.stringify({
      sessionId: 'gem-sesion-1',
      projectHash: hash,
      startTime: iso(now - 300000),
      messages: [
        { id: 'u1', timestamp: iso(now - 300000), type: 'user', content: 'documenta la API' },
        { id: 'g1', timestamp: iso(now - 290000), type: 'gemini', content: 'Primer paso.', model: 'gemini-2.5-pro', tokens: { input: 1000, output: 100, cached: 0, thoughts: 20, tool: 0, total: 1120 } },
        { id: 'g2', timestamp: iso(now - 280000), type: 'gemini', content: 'Hecho.', model: 'gemini-2.5-pro', tokens: { input: 1200, output: 80, cached: 500, thoughts: 0, tool: 0, total: 1280 } }
      ]
    }),
    'utf8'
  )

  // OpenCode: su SQLite con una sesión del plan Go, su lista de tareas y una
  // tabla de cuentas con un secreto que la app no debe leer nunca.
  const ocDir = path.join(DATA_HOME, 'opencode')
  fs.mkdirSync(ocDir, { recursive: true })
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(ocDir, 'opencode.db'))
  db.exec(`
    create table session (id text primary key, project_id text, parent_id text, slug text, directory text, title text,
      version text, time_created integer, time_updated integer, model text, cost real, tokens_input integer,
      tokens_output integer, tokens_reasoning integer, tokens_cache_read integer);
    create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
    create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
    create table todo (session_id text, content text, status text, priority text, position integer, time_created integer, time_updated integer);
    create table account (id text primary key, access_token text);
  `)
  db.prepare('insert into account values (?, ?)').run('cuenta', 'SECRETO-QUE-NO-DEBE-LEERSE')
  db.prepare('insert into session values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'ses_oc1', 'p1', null, 'slug', REPO, 'Refactor del router', '1', now - 200000, now - 100000,
    JSON.stringify({ id: 'kimi-k3', providerID: 'opencode-go' }), 0.42, 3000, 400, 0, 100
  )
  db.prepare('insert into message values (?,?,?,?,?)').run('m1', 'ses_oc1', now - 200000, now - 200000, JSON.stringify({ role: 'user' }))
  db.prepare('insert into message values (?,?,?,?,?)').run(
    'm2', 'ses_oc1', now - 150000, now - 150000,
    JSON.stringify({ role: 'assistant', providerID: 'opencode-go', modelID: 'kimi-k3', cost: 0.42, tokens: { input: 3000, output: 400 } })
  )
  db.prepare('insert into part values (?,?,?,?,?,?)').run('p1', 'm1', 'ses_oc1', now - 200000, now - 200000, JSON.stringify({ type: 'text', text: 'refactoriza el router' }))
  db.prepare('insert into part values (?,?,?,?,?,?)').run('p2', 'm2', 'ses_oc1', now - 150000, now - 150000, JSON.stringify({ type: 'text', text: 'Router partido en dos.' }))
  db.prepare('insert into todo values (?,?,?,?,?,?,?)').run('ses_oc1', 'separar rutas', 'completed', 'high', 0, now, now)
  db.prepare('insert into todo values (?,?,?,?,?,?,?)').run('ses_oc1', 'añadir tests', 'pending', 'high', 1, now, now)
  db.close()

  // Gemini CLI entra con cuenta de Google: el plan se supone gratuito.
  fs.writeFileSync(
    path.join(GEMINI_HOME, '.gemini', 'settings.json'),
    JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }),
    'utf8'
  )

  // Claude Code con una barra de estado propia y otro ajuste que no se puede perder.
  fs.mkdirSync(CLAUDE_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(CLAUDE_DIR, 'settings.json'),
    JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'echo mi-barra' } }, null, 2),
    'utf8'
  )
}

const CLAUDE_DIR = path.join(HOME, 'claude')

setupRepo()
setupFixtures()
setupExternal()
process.env.CODEX_HOME = CODEX_HOME
process.env.GEMINI_CLI_HOME = GEMINI_HOME
process.env.XDG_DATA_HOME = DATA_HOME
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR
// Una clave de mentira: sólo para que el freno de presupuesto llegue a mirar
// (con el freno puesto no sale ninguna petición).
process.env.GROQ_API_KEY = 'clave-de-prueba'

// Un catálogo de modelos de mentira (y reciente, para que no se descargue):
// el mismo modelo en models.dev, con sus capacidades, y en OpenRouter, con
// sus puntuaciones. Se guarda el de verdad y se devuelve al acabar.
const CATALOG = path.join(app.getPath('userData'), 'data', 'models-cache.json')
const CATALOG_BACKUP = fs.existsSync(CATALOG) ? fs.readFileSync(CATALOG) : null
fs.mkdirSync(path.dirname(CATALOG), { recursive: true })
fs.writeFileSync(CATALOG, JSON.stringify({
  fetchedAt: Date.now(),
  models: [
    { id: 'modelo-prueba-4-5', providerId: 'anthropic', name: 'Modelo prueba', source: 'catalog', priceIn: 1, priceOut: 5,
      caps: { tools: true, reasoning: true, openWeights: false }, knowledge: '2025-03' },
    { id: 'vendor/modelo-prueba-4.5', providerId: 'openrouter', name: 'Modelo prueba', source: 'catalog', priceIn: 1, priceOut: 5,
      caps: { tools: true }, bench: { intelligence: 61, coding: 55, design: [{ arena: 'models', category: 'website', elo: 1300, rank: 3 }] } },
    { id: 'otro-modelo', providerId: 'openrouter', name: 'Otro', source: 'catalog', priceIn: 0, priceOut: 0 }
  ]
}), 'utf8')

require('../out/main/index.js')

app.whenReady().then(async () => {
  const win = await waitWindow()
  const js = (code) => win.webContents.executeJavaScript(code)
  const ctx = JSON.stringify({ repo: REPO, fixtures: FIXTURES.replace(/\\/g, '/'), home: HOME })

  /* -------------------------------------------------------------- *
   * H2 · Poda del histórico                                        *
   * H3 · Cada ejecución, en su proyecto                            *
   * -------------------------------------------------------------- */
  const h = await js(`(async () => {
    const { repo, fixtures } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    // En una subcarpeta: en la raíz del repo hay sesiones de fuera que también contarían.
    const project = { id: 'proyecto-prueba', name: 'Proyecto de prueba', path: repo + '/sub', color: '#fff', createdAt: Date.now() }
    await api.projects.save(project)
    const agent = {
      id: 'claude-falso', name: 'Claude falso', type: 'cli', command: 'node',
      args: [fixtures + '/claude.js'], parser: 'claude-stream-json', color: '#f0b429', createdAt: Date.now()
    }
    await api.agents.saveCli(agent)

    // Sin projectId, sólo con una carpeta de dentro del proyecto: tiene que apuntarse igual.
    const sid = await engine.newSession('cli', { cliAgentId: agent.id })
    const run = await engine.sendCli(sid, { prompt: 'mira', agentId: agent.id, projectPath: repo + '/sub/' })
    const totals = (await api.runs.projectTotals(project.id)).data

    // Se envejece la ejecución y se poda.
    await api.runs.update(run.id, { createdAt: Date.now() - 400 * 86400000, response: 'x'.repeat(5000) })
    await api.config.settings({ historyDetailDays: 30 })
    const compact = (await api.runs.compact()).data
    const after = (await api.runs.query({ projectId: project.id })).data
    const row = after.rows.find((r) => r.id === run.id)
    const month = (await api.runs.query({ from: Date.now() - 30 * 86400000 })).data

    await engine.deleteSession(sid)
    await api.runs.remove(run.id)
    await api.agents.removeCli(agent.id)
    await api.projects.remove(project.id)
    await api.config.settings({ historyDetailDays: 180 })
    return { run, totals, compact, row, sums: after, month }
  })()`)

  log(h.run?.projectId === 'proyecto-prueba', 'UNA RUTA DENTRO DE UN PROYECTO SE LE APUNTA SOLA', String(h.run?.projectId))
  log(h.totals?.runs === 1 && Math.abs((h.totals?.cost ?? 0) - 0.01) < 1e-9, 'los totales del proyecto salen del histórico entero', JSON.stringify({ runs: h.totals?.runs, cost: h.totals?.cost }))
  log((h.compact?.compacted ?? 0) >= 1, 'LA PODA COMPACTA LO VIEJO', JSON.stringify(h.compact))
  log(Boolean(h.row) && !h.row.steps && h.row.response.length <= 2001 && h.row.compacted === true, 'se quita el detalle y se marca', h.row ? `${h.row.response.length} caracteres, pasos: ${h.row.steps ? 'sí' : 'no'}` : 'sin fila')
  log(h.row?.costTotal === 0.01 && h.row?.totalTokens === 120, 'LAS MÉTRICAS SE CONSERVAN', h.row ? `${h.row.costTotal} $, ${h.row.totalTokens} tokens` : '')
  log(h.sums?.cost === 0.01 && h.sums?.tokens === 120, 'el Histórico suma todo lo filtrado, no sólo la página', JSON.stringify({ cost: h.sums?.cost, tokens: h.sums?.tokens }))
  log(!h.month?.rows?.some((r) => r.id === h.run?.id), 'el filtro por fecha deja fuera lo viejo', `${h.month?.total} en 30 días`)

  /* -------------------------------------------------------------- *
   * A1 · Retomar la sesión del agente · A7 · Codex y Gemini en JSON *
   * -------------------------------------------------------------- */
  const bins = JSON.stringify(BINS)
  const a1 = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    const make = async (id, command, args, parser) => {
      const agent = { id, name: id, type: 'cli', command, args, parser, color: '#fff', createdAt: Date.now() }
      await api.agents.saveCli(agent)
      return agent
    }
    const two = async (agent, fork) => {
      const sid = await engine.newSession('cli', { cliAgentId: agent.id })
      const first = await engine.sendCli(sid, { prompt: 'primero', agentId: agent.id, projectPath: repo })
      if (fork) engine.patchSessionConfig(sid, { cliForkNext: true })
      const second = await engine.sendCli(sid, { prompt: 'segundo', agentId: agent.id, projectPath: repo })
      const session = engine.peekChat(sid)?.session
      await engine.deleteSession(sid)
      for (const r of [first, second]) if (r?.id) await api.runs.remove(r.id)
      await api.agents.removeCli(agent.id)
      return { first, second, session }
    }
    const claude = await two(await make('claude-a1', bins.claude, ['-p', '--output-format', 'stream-json', '--verbose'], 'claude-stream-json'))
    const claudeFork = await two(await make('claude-fork', bins.claude, ['-p', '--output-format', 'stream-json', '--verbose'], 'claude-stream-json'), true)
    const codex = await two(await make('codex-a1', bins.codex, ['exec', '--json', '{{prompt}}'], 'codex-json'))
    const gemini = await two(await make('gemini-a1', bins.gemini, ['--output-format', 'stream-json', '-p', '{{prompt}}'], 'gemini-stream-json'))
    const opencode = await two(await make('opencode-a1', bins.opencode, ['run', '--format', 'json', '{{prompt}}'], 'opencode-json'))
    const plain = await two(await make('plain-a1', bins.plain, ['{{prompt}}'], 'plain'))
    return { claude, claudeFork, codex, gemini, opencode, plain }
  })()`)

  const c = a1.claude
  log(Boolean(c.first?.cliSessionId), 'Claude: la sesión del agente se captura', String(c.first?.cliSessionId))
  log(
    c.second?.response?.includes('resume=' + c.first?.cliSessionId) && c.second?.resumedFrom === c.first?.cliSessionId,
    'CLAUDE RETOMA SU SESIÓN EN EL SEGUNDO TURNO',
    (c.second?.response ?? '').slice(0, 60)
  )
  log(c.second?.steps?.some((s) => s.id === 'resume'), 'la línea de tiempo dice que retoma')
  const f = a1.claudeFork
  log(
    f.second?.response?.includes('fork=true') && f.second?.cliSessionId !== f.first?.cliSessionId && f.session?.cliSessionId === f.second?.cliSessionId,
    'BIFURCAR SIGUE EN UNA SESIÓN NUEVA Y LA CONSOLA SE QUEDA CON ELLA',
    `${f.first?.cliSessionId} → ${f.second?.cliSessionId}`
  )
  log(f.session?.cliForkNext === false, 'la bifurcación es sólo para ese turno')

  const x = a1.codex
  log(Boolean(x.first?.cliSessionId?.startsWith('hilo-')), 'Codex: la sesión sale de thread.started', String(x.first?.cliSessionId))
  log(
    (x.second?.response ?? '').includes('resume ' + x.first?.cliSessionId + ' segundo'),
    'CODEX RETOMA CON «exec … resume <id> prompt»',
    (x.second?.response ?? '').slice(0, 80)
  )
  log(x.first?.promptTokens === 500 && x.first?.completionTokens === 40 && x.first?.cachedTokens === 100, 'Codex: tokens reales del turno', `${x.first?.promptTokens}/${x.first?.completionTokens}/${x.first?.cachedTokens}`)
  log(
    x.first?.steps?.some((s) => s.tool === 'Bash' && s.target === 'ls' && s.status === 'ok') &&
      x.first?.steps?.some((s) => s.tool === 'Edit' && s.target?.includes('app.js')),
    'Codex: comandos y cambios de archivos en la línea de tiempo'
  )
  log(x.first?.todos?.length === 2 && x.first.todos[0].done === true, 'Codex: su lista de tareas queda guardada', JSON.stringify(x.first?.todos))
  log((x.first?.response ?? '').startsWith('args='), 'Codex: la respuesta es el mensaje del agente, sin JSON')

  const g = a1.gemini
  log(g.first?.model === 'gemini-falso' && Boolean(g.first?.cliSessionId), 'Gemini: modelo y sesión del init', `${g.first?.model} ${g.first?.cliSessionId}`)
  log(g.second?.response === 'resume=' + g.first?.cliSessionId, 'GEMINI RETOMA CON --resume', g.second?.response)
  log(g.first?.promptTokens === 250 && g.first?.completionTokens === 50, 'Gemini: tokens del resultado', `${g.first?.promptTokens}/${g.first?.completionTokens}`)
  log(g.first?.steps?.some((s) => s.tool === 'read_file' && s.status === 'ok'), 'Gemini: la herramienta se abre y se cierra')

  const o = a1.opencode
  log(Boolean(o.first?.cliSessionId?.startsWith('ses_')), 'OpenCode: la sesión sale de sessionID', String(o.first?.cliSessionId))
  log((o.second?.response ?? '').includes('session=' + o.first?.cliSessionId), 'OPENCODE RETOMA CON --session', o.second?.response)

  const p = a1.plain
  log(
    (p.second?.response ?? '').includes('Conversación anterior') && (p.second?.response ?? '').includes('primero'),
    'UN CLI QUE NO SABE RETOMAR RECIBE LA CONVERSACIÓN EN EL PROMPT',
    (p.second?.response ?? '').replace(/\s+/g, ' ').slice(0, 80)
  )

  /* -------------------------------------------------------------- *
   * A6 · Sesiones de Codex, OpenCode y Gemini CLI de fuera          *
   * A2 · Relevo entre agentes                                       *
   * -------------------------------------------------------------- */
  const ext = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    const project = { id: 'proyecto-ext', name: 'Repo ext', path: repo, color: '#fff', createdAt: Date.now() }
    await api.projects.save(project)
    await api.external.refresh()
    await new Promise((r) => setTimeout(r, 300))
    const rows = (await api.runs.query({ limit: 50 })).data.rows
    const codex = rows.find((r) => r.id === 'codex-${CODEX_ID}')
    const opencode = rows.find((r) => r.id === 'opencode-ses_oc1')
    const gemini = rows.find((r) => r.id === 'gemini-gem-sesion-1')

    const rCodex = (await api.relay.build({ kind: 'codex', id: '${CODEX_ID}' })).data
    const rOc = (await api.relay.build({ kind: 'opencode', id: 'ses_oc1' })).data

    // Relevo desde una conversación de la Consola.
    const agent = { id: 'codex-relay', name: 'Codex falso', type: 'cli', command: bins.codex, args: ['exec', '--json', '{{prompt}}'], parser: 'codex-json', color: '#fff', createdAt: Date.now() }
    await api.agents.saveCli(agent)
    const sid = await engine.newSession('cli', { cliAgentId: agent.id, projectId: project.id })
    const run = await engine.sendCli(sid, { prompt: 'empieza el arreglo', agentId: agent.id, projectPath: repo, projectId: project.id })
    await engine.saveSessionNow(sid)
    const rSes = (await api.relay.build({ kind: 'session', id: sid })).data
    const prompt = (await api.relay.prompt(rSes, { includeDiff: true, note: 'termina los tests' })).data
    const bad = await api.relay.build({ kind: 'inventado', id: 'x' })

    await engine.deleteSession(sid)
    if (run?.id) await api.runs.remove(run.id)
    await api.agents.removeCli(agent.id)
    for (const r of [codex, opencode, gemini]) if (r) await api.runs.remove(r.id)
    await api.projects.remove(project.id)
    return { codex, opencode, gemini, rCodex, rOc, rSes, prompt, bad }
  })()`)

  log(
    Boolean(ext.codex) && ext.codex.projectId === 'proyecto-ext' && ext.codex.promptTokens === 9000,
    'CODEX DE FUERA ENTRA AL HISTÓRICO, EN SU PROYECTO',
    ext.codex ? `${ext.codex.promptTokens} tokens, ${ext.codex.model}` : 'no aparece'
  )
  log(
    Boolean(ext.opencode) && Math.abs(ext.opencode.costTotal - 0.42) < 1e-9 && ext.opencode.costEstimated === false,
    'OPENCODE DE FUERA, CON SU COSTE REAL',
    ext.opencode ? String(ext.opencode.costTotal) : 'no aparece'
  )
  log(ext.opencode?.prompt === 'refactoriza el router', 'OpenCode: la primera petición da título', String(ext.opencode?.prompt))
  log(
    Boolean(ext.gemini) && ext.gemini.projectId === 'proyecto-ext' && ext.gemini.promptTokens === 2200,
    'GEMINI CLI DE FUERA, EN SU PROYECTO POR SU HASH',
    ext.gemini ? `${ext.gemini.promptTokens} tokens, proyecto ${ext.gemini.projectId}` : 'no aparece'
  )
  log(ext.rCodex?.goal === 'arregla el login de la app' && ext.rCodex?.exchanges?.length === 2, 'relevo desde Codex: objetivo e intercambios', `${ext.rCodex?.exchanges?.length} mensajes`)
  log(ext.rCodex?.todos?.length === 2 && ext.rCodex.todos[1].active === true, 'relevo desde Codex: su plan como tareas', JSON.stringify(ext.rCodex?.todos))
  log(
    ext.rOc?.todos?.length === 2 && ext.rOc.todos[0].done === true && ext.rOc.exchanges?.length === 2,
    'relevo desde OpenCode: tareas y conversación de su base de datos'
  )
  log(!JSON.stringify(ext.rOc ?? {}).includes('SECRETO'), 'LAS CUENTAS DE OPENCODE NO SE LEEN')
  log(
    ext.rSes?.todos?.length === 2 && ext.rSes?.projectId === 'proyecto-ext' && (ext.rSes?.exchanges?.length ?? 0) >= 2,
    'RELEVO DESDE LA CONSOLA: TAREAS, PROYECTO Y CONVERSACIÓN',
    `${ext.rSes?.todos?.length} tareas, ${ext.rSes?.exchanges?.length} mensajes`
  )
  log(
    typeof ext.prompt === 'string' && ext.prompt.includes('Tomas el relevo') && ext.prompt.includes('termina los tests') && ext.prompt.includes('arreglar'),
    'EL PROMPT DEL RELEVO LLEVA OBJETIVO, TAREAS Y LA NOTA',
    (ext.prompt ?? '').slice(0, 70)
  )
  log(ext.bad?.ok === false, 'un origen inventado se rechaza', ext.bad?.error)

  /* -------------------------------------------------------------- *
   * A3 · Cupos de todas las IAs                                     *
   * A4 · Proyección, avisos y a quién pasar el relevo               *
   * A5 · Presupuestos                                               *
   * -------------------------------------------------------------- */
  const settingsFile = path.join(CLAUDE_DIR, 'settings.json')
  const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))

  const sl = await js(`(async () => {
    const api = window.api
    window.__alerts = []
    api.quotas.onAlert((a) => window.__alerts.push(a))
    const before = (await api.quotas.statusLine()).data
    const installed = (await api.quotas.installStatusLine()).data
    const cfg = (await api.config.get()).data
    return { before, installed, flag: cfg.settings.quotas?.claudeStatusLine }
  })()`)
  const withOurs = readSettings()
  log(sl.before?.foreign === true && sl.before?.installed === false, 'la barra de estado que ya tenías se reconoce como tuya')
  log(
    sl.installed?.installed === true && sl.installed?.chained === true && sl.flag === true,
    'EL STATUSLINE DE LA APP SE PONE Y ENCADENA EL TUYO',
    withOurs.statusLine?.command
  )
  log(withOurs.theme === 'dark', 'el resto de settings.json no se toca')
  log(
    fs.readdirSync(path.join(app.getPath('userData'), 'data', 'statusline')).some((f) => f.startsWith('settings.backup-')),
    'se guarda copia de settings.json antes de escribir'
  )

  // Claude Code llamaría a la barra así: con su JSON por la entrada estándar.
  const nowS = Math.floor(Date.now() / 1000)
  const feed = (five) =>
    require('node:child_process').execSync(withOurs.statusLine.command, {
      input: JSON.stringify({
        model: { display_name: 'Opus' },
        rate_limits: {
          five_hour: { used_percentage: five, resets_at: nowS + 7200 },
          seven_day: { used_percentage: 64, resets_at: nowS + 3 * 86400 }
        }
      }),
      encoding: 'utf8'
    })
  const shown = feed(37)
  log(shown.includes('mi-barra'), 'TU BARRA SE SIGUE VIENDO: LA DE LA APP LA EJECUTA DETRÁS', shown.trim())

  const agentsJson = JSON.stringify({
    claude: { id: 'claude-cupo', name: 'Claude cupo', type: 'cli', command: BINS.claude, args: ['-p', '--output-format', 'stream-json', '--verbose'], parser: 'claude-stream-json', color: '#fff', createdAt: Date.now() },
    codex: { id: 'codex-cupo', name: 'Codex cupo', type: 'cli', command: BINS.codex, args: ['exec', '--json', '{{prompt}}'], parser: 'codex-json', color: '#fff', createdAt: Date.now() }
  })
  const q = await js(`(async () => {
    const api = window.api
    const agents = ${agentsJson}
    await api.agents.saveCli(agents.claude)
    await api.agents.saveCli(agents.codex)
    const first = (await api.quotas.get(true)).data
    await api.config.settings({ quotas: { claudeStatusLine: true, geminiPlan: 'pro' } })
    const pro = (await api.quotas.get(true)).data
    return { first, pro }
  })()`)
  const byId = (r, id) => r?.quotas?.find((x) => x.id === id)
  const five = byId(q.first, 'claude.five_hour')
  log(five?.usedPct === 37 && five?.origin === 'official' && five?.unit === 'percent', 'CLAUDE: EL % OFICIAL DE LA VENTANA DE 5 H', JSON.stringify({ pct: five?.usedPct, origin: five?.origin }))
  log(byId(q.first, 'claude.seven_day')?.usedPct === 64, 'Claude: y el de la semana')
  log(
    five?.projection && Math.abs(five.projection.ratePerHour - 37 / 3) < 0.2 && five.projection.hitsBeforeReset === false,
    'A ESTE RITMO: PROYECCIÓN CON LA MEDIA DE LA VENTANA',
    JSON.stringify(five?.projection)
  )
  const cx1 = byId(q.first, 'codex.primary')
  log(cx1?.usedPct === 42.5 && cx1?.label === 'Ventana de 5 h' && cx1?.origin === 'official', 'CODEX: SU % OFICIAL DE LA VENTANA DE 5 H', JSON.stringify({ pct: cx1?.usedPct, label: cx1?.label }))
  log(byId(q.first, 'codex.secondary')?.label === 'Semana' && byId(q.first, 'codex.secondary')?.usedPct === 12, 'Codex: y la semanal')
  const gem = byId(q.first, 'gemini.daily')
  log(gem?.used === 2 && gem?.limit === 1000 && gem?.target === 'gratuito', 'GEMINI CLI: PETICIONES DE HOY CONTRA EL TOPE DEL PLAN GRATUITO', JSON.stringify({ used: gem?.used, limit: gem?.limit }))
  log(byId(q.pro, 'gemini.daily')?.limit === 1500, 'con el plan Pro elegido, su tope', String(byId(q.pro, 'gemini.daily')?.limit))
  const go = byId(q.first, 'opencode-go.5h')
  log(go && Math.abs(go.used - 0.42) < 1e-9 && go.limit === 12, 'OPENCODE GO: SU GASTO CONTRA 12 $ CADA 5 H, SIN ACTIVARLO', go ? `${go.used} de ${go.limit}` : 'no aparece')
  log(
    q.first?.gaps?.some((g) => g.provider === 'ChatGPT (web y app)') && q.first?.gaps?.some((g) => g.provider === 'Gemini (app y web)'),
    'lo que no se puede saber se dice, con enlace',
    (q.first?.gaps ?? []).map((g) => g.provider).join(', ')
  )
  log(!q.first?.quotas?.some((x) => x.providerKey === 'openrouter' || x.providerKey === 'copilot'), 'sin clave ni permiso no se pregunta a nadie')

  // Se agota la ventana de Claude: aviso al 100 % y relevo al que más margen tiene.
  feed(100)
  const ex = await js(`(async () => {
    const api = window.api
    const r = (await api.quotas.get(true)).data
    await new Promise((res) => setTimeout(res, 300))
    return { r, alerts: window.__alerts.slice() }
  })()`)
  const out = ex.alerts.find((a) => a.quotaId === 'claude.five_hour' && a.level === 100)
  log(Boolean(out), 'AL AGOTARSE UN CUPO LLEGA EL AVISO', out ? `${out.provider} · ${out.label}` : JSON.stringify(ex.alerts.map((a) => a.quotaId + '@' + a.level)))
  log(
    // Codex tiene un 42,5 %: le queda un 58 %. Otro agente sólo podría ganarle con más margen aún.
    Boolean(out?.suggestion) && out.suggestion.agentId !== 'claude-cupo' && (out.suggestion.left ?? 0) >= 57,
    'Y PROPONE SEGUIR CON LA IA QUE MÁS MARGEN TIENE',
    JSON.stringify(out?.suggestion)
  )
  log(!ex.alerts.some((a) => a.quotaId === 'codex.primary'), 'un cupo por debajo del primer umbral no avisa')

  // Presupuestos: uno sobre el agente contando lo estimado y con freno, y otro
  // de sólo dinero real, donde lo que va por el plan no cuenta.
  const b = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    await api.config.settings({ budgets: [
      { id: 'b-agente', scope: 'agent', target: 'claude-cupo', period: 'day', limitUsd: 0.015, includeEstimated: true, hard: true },
      { id: 'b-real', scope: 'agent', target: 'claude-cupo', period: 'day', limitUsd: 0.001, hard: true }
    ] })
    await api.quotas.get(true)
    const sid = await engine.newSession('cli', { cliAgentId: 'claude-cupo' })
    const r1 = await engine.sendCli(sid, { prompt: 'uno', agentId: 'claude-cupo', projectPath: repo })
    await wait(1200)
    const after1 = (await api.quotas.get(true)).data
    const r2 = await engine.sendCli(sid, { prompt: 'dos', agentId: 'claude-cupo', projectPath: repo })
    await wait(1200)
    const r3 = await engine.sendCli(sid, { prompt: 'tres', agentId: 'claude-cupo', projectPath: repo })

    // Una llamada por API (dinero de verdad) cuenta en un presupuesto de proveedor.
    await api.runs.update(r2.id, { kind: 'chat', providerId: 'openrouter', costTotal: 1.5, agentId: undefined })
    await api.config.settings({ budgets: [{ id: 'b-or', scope: 'provider', target: 'openrouter', period: 'month', limitUsd: 3 }] })
    await wait(1200)
    const api1 = (await api.quotas.get(true)).data

    // Y con el freno puesto, una llamada por API ni sale: se para antes de la red.
    await api.runs.update(r1.id, { kind: 'chat', providerId: 'groq', costTotal: 1 })
    await api.config.settings({ budgets: [{ id: 'b-groq', scope: 'provider', target: 'groq', period: 'day', limitUsd: 0.5, hard: true }] })
    const apiBlocked = (await api.run.prompt({ providerId: 'groq', model: 'llama-de-prueba', prompt: 'hola' }, 'run-freno-api')).data
    // Lo local no cuesta dinero: un presupuesto «de todo» agotado no lo frena.
    await api.config.settings({ budgets: [{ id: 'b-todo', scope: 'total', period: 'day', limitUsd: 0.5, hard: true }] })
    const local = (await api.run.prompt({ providerId: 'ollama', model: 'no-existe', prompt: 'hola' }, 'run-local')).data
    await api.runs.remove('run-freno-api')
    await api.runs.remove('run-local')

    await engine.deleteSession(sid)
    for (const r of [r1, r2, r3]) if (r?.id) await api.runs.remove(r.id)
    return { r1, r2, r3, after1, api1, apiBlocked, local, alerts: window.__alerts.slice() }
  })()`)
  const bAg = byId(b.after1, 'budget.b-agente')
  log(bAg && Math.abs(bAg.used - 0.01) < 1e-9 && Math.round(bAg.usedPct) === 67 && bAg.origin === 'own', 'PRESUPUESTO: CUENTA LO GASTADO POR EL AGENTE', bAg ? `${bAg.used} de ${bAg.limit}` : 'no aparece')
  log(byId(b.after1, 'budget.b-real')?.used === 0, 'POR OMISIÓN, LO DEL PLAN DE SUSCRIPCIÓN NO CUENTA COMO DINERO', String(byId(b.after1, 'budget.b-real')?.used))
  log(b.r2?.status === 'ok', 'el presupuesto de sólo dinero real no frena al agente del plan', b.r2?.error)
  log(
    b.r3?.status === 'error' && /Presupuesto agotado/.test(b.r3?.error ?? ''),
    'CON EL PRESUPUESTO AGOTADO Y EL FRENO PUESTO, NO SE LANZA',
    (b.r3?.error ?? '').slice(0, 80)
  )
  log(
    b.alerts.some((a) => a.quotaId === 'budget.b-agente' && a.level === 50) && b.alerts.some((a) => a.quotaId === 'budget.b-agente' && a.level === 100),
    'LOS PRESUPUESTOS AVISAN AL 50 % Y AL AGOTARSE',
    b.alerts.filter((a) => a.quotaId.startsWith('budget.')).map((a) => a.quotaId + '@' + a.level).join(', ')
  )
  const bOr = byId(b.api1, 'budget.b-or')
  log(bOr?.used === 1.5 && bOr?.usedPct === 50, 'una llamada por API cuenta en el presupuesto de su proveedor', bOr ? `${bOr.used} de ${bOr.limit}` : 'no aparece')
  log(
    b.apiBlocked?.status === 'error' && /Presupuesto agotado/.test(b.apiBlocked?.error ?? ''),
    'EL FRENO TAMBIÉN PARA LAS LLAMADAS POR API, ANTES DE SALIR A LA RED',
    (b.apiBlocked?.error ?? '').slice(0, 70)
  )
  log(!/Presupuesto agotado/.test(b.local?.error ?? ''), 'lo local nunca se frena por dinero', (b.local?.error ?? 'ok').slice(0, 60))

  // Se quita el statusLine: vuelve el tuyo. Si alguien lo ha cambiado, no se toca.
  const un = await js(`(async () => {
    const api = window.api
    const off = (await api.quotas.uninstallStatusLine()).data
    const cfg = (await api.config.get()).data
    return { off, flag: cfg.settings.quotas?.claudeStatusLine }
  })()`)
  const restored = readSettings()
  log(
    restored.statusLine?.command === 'echo mi-barra' && restored.theme === 'dark' && un.off?.installed === false && un.flag === false,
    'AL QUITARLO, SETTINGS.JSON QUEDA COMO ESTABA',
    JSON.stringify(restored.statusLine)
  )
  await js(`window.api.quotas.installStatusLine()`)
  const tampered = readSettings()
  tampered.statusLine = { type: 'command', command: 'echo otra-barra' }
  fs.writeFileSync(settingsFile, JSON.stringify(tampered, null, 2), 'utf8')
  const foreign = await js(`window.api.quotas.uninstallStatusLine().then((r) => r.data)`)
  log(
    Boolean(foreign?.untouched) && readSettings().statusLine?.command === 'echo otra-barra',
    'SI LA BARRA YA NO ES LA DE LA APP, NO SE TOCA',
    foreign?.untouched
  )

  await js(`(async () => {
    const api = window.api
    await api.agents.removeCli('claude-cupo')
    await api.agents.removeCli('codex-cupo')
    await api.config.settings({ budgets: [], quotas: {} })
  })()`)

  /* -------------------------------------------------------------- *
   * C1 · Puntuaciones y capacidades · C3 · Elo personal             *
   * C6 · Lo medido de cada modelo y favoritos                       *
   * -------------------------------------------------------------- */
  const cm = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    const cat = (await api.models.catalog('modelo-prueba', 50)).data

    // Dos agentes compiten dos veces y gana siempre el mismo.
    const mk = async (id, command, args, parser) => {
      await api.agents.saveCli({ id, name: id, type: 'cli', command, args, parser, color: '#fff', createdAt: Date.now() })
    }
    await mk('elo-a', bins.claude, ['-p', '--output-format', 'stream-json', '--verbose'], 'claude-stream-json')
    await mk('elo-b', bins.codex, ['exec', '--json', '{{prompt}}'], 'codex-json')
    const sid = await engine.newSession('cli', { cliAgentId: 'elo-a' })
    const runs = []
    for (const [agent, arena, winner] of [['elo-a', 'arena-1', true], ['elo-b', 'arena-1', false], ['elo-a', 'arena-2', true], ['elo-b', 'arena-2', false]]) {
      const r = await engine.sendCli(sid, { prompt: 'duelo', agentId: agent, projectPath: repo })
      await api.runs.update(r.id, { arenaId: arena, winner })
      runs.push(r)
    }
    const elo = (await api.runs.elo()).data
    const usage = (await api.runs.modelUsage()).data

    const favOn = (await api.models.favorite('openrouter:otro-modelo', true)).data
    const cfgOn = (await api.config.get()).data.favorites
    const favOff = (await api.models.favorite('openrouter:otro-modelo', false)).data

    await engine.deleteSession(sid)
    for (const r of runs) await api.runs.remove(r.id)
    await api.agents.removeCli('elo-a')
    await api.agents.removeCli('elo-b')
    return { cat, elo, usage, favOn, cfgOn, favOff, a: runs[0], b: runs[1] }
  })()`)
  const md = cm.cat?.find((m) => m.providerId === 'anthropic')
  const or = cm.cat?.find((m) => m.providerId === 'openrouter' && m.id.includes('modelo-prueba'))
  log(md?.bench?.intelligence === 61 && md?.bench?.coding === 55, 'LAS PUNTUACIONES DE OPENROUTER LLEGAN AL MISMO MODELO DE OTRA FUENTE', JSON.stringify(md?.bench ?? null).slice(0, 80))
  log(md?.caps?.reasoning === true && md?.knowledge === '2025-03', 'models.dev: capacidades y fecha de corte se guardan')
  log(or?.bench?.design?.[0]?.elo === 1300, 'Design Arena por categoría se conserva')
  const ea = cm.elo?.find((e) => e.providerId === cm.a?.providerId && e.model === cm.a?.model)
  const eb = cm.elo?.find((e) => e.providerId === cm.b?.providerId && e.model === cm.b?.model)
  log(ea?.elo === 1531 && ea?.wins === 2 && ea?.games === 2 && eb?.elo === 1469, 'ELO PERSONAL CON LOS GANADORES DE LA ARENA', `${ea?.elo} / ${eb?.elo}`)
  log(cm.elo?.[0]?.key === ea?.key, 'la clasificación va de mayor a menor')
  const ua = cm.usage?.find((u) => u.providerId === cm.a?.providerId && u.model === cm.a?.model)
  log(ua?.runs === 2 && ua?.elo === 1531 && Math.abs((ua?.cost ?? 0) - 0.02) < 1e-9, 'LO MEDIDO DE CADA MODELO LLEVA SU ELO', ua ? `${ua.runs} ejecuciones, ${ua.cost} $, Elo ${ua.elo}` : 'no aparece')
  log(cm.favOn?.includes('openrouter:otro-modelo') && cm.cfgOn?.includes('openrouter:otro-modelo') && !cm.favOff?.includes('openrouter:otro-modelo'), 'los favoritos se guardan y se quitan')

  /* -------------------------------------------------------------- *
   * B1 · Puntos de control y deshacer un turno                      *
   * -------------------------------------------------------------- */
  // Antes del turno: un cambio sin confirmar, un fichero nuevo y algo preparado en el índice.
  fs.writeFileSync(path.join(REPO, 'app.js'), 'uno\ndos\ntres\nsin-confirmar\n', 'utf8')
  fs.writeFileSync(path.join(REPO, 'previo.txt'), 'mío, sin seguir\n', 'utf8')
  fs.writeFileSync(path.join(REPO, 'preparado.txt'), 'en el índice\n', 'utf8')
  git(['add', 'preparado.txt'])
  const indexBefore = git(['diff', '--cached', '--name-only'])
  const headBefore = git(['rev-parse', 'HEAD'])

  const b1 = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    await api.agents.saveCli({ id: 'editor', name: 'Editor', type: 'cli', command: bins.editor, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    const sid = await engine.newSession('cli', { cliAgentId: 'editor' })
    const run = await engine.sendCli(sid, { prompt: 'cambia cosas', agentId: 'editor', projectPath: repo })
    const preview = run.checkpoint ? (await api.checkpoints.preview(run.checkpoint.root, run.id)).data : null
    await engine.deleteSession(sid)
    await api.agents.removeCli('editor')
    return { run, preview }
  })()`)
  const read = (rel) => (fs.existsSync(path.join(REPO, rel)) ? fs.readFileSync(path.join(REPO, rel), 'utf8') : null)
  const afterAgent = { app: read('app.js'), creado: read('nuevo/creado.txt'), nota: read('sub/nota.txt') }
  log(Boolean(b1.run?.checkpoint?.commit) && afterAgent.app?.includes('del-agente') && afterAgent.creado && afterAgent.nota === null, 'ANTES DEL TURNO SE GUARDA UN PUNTO DE CONTROL', b1.run?.checkpoint?.commit?.slice(0, 10))
  log(
    git(['diff', '--cached', '--name-only']) === indexBefore && git(['stash', 'list']) === '' && git(['rev-parse', 'HEAD']) === headBefore,
    'la foto no toca el índice, el stash ni la rama'
  )
  const ckCommit = b1.run?.checkpoint?.commit ?? 'HEAD'
  log(
    !git(['log', '--oneline']).includes('acc:') && git(['branch', '--contains', ckCommit]) === '',
    'el punto de control vive fuera de las ramas',
    git(['for-each-ref', '--format=%(refname)', 'refs/acc/checkpoints']).split('\n').length + ' refs'
  )
  const pv = b1.preview
  log(
    pv && ['app.js', 'previo.txt', 'sub/nota.txt'].every((f) => pv.restore.includes(f)) && pv.remove.includes('nuevo/creado.txt') && pv.headMoved === false,
    'LA VISTA PREVIA DICE QUÉ VUELVE Y QUÉ SE BORRA',
    pv ? `vuelven ${pv.restore.join(', ')} · se borran ${pv.remove.join(', ')}` : 'sin vista previa'
  )

  const undo = await js(`window.api.checkpoints.undo(${JSON.stringify(b1.run?.checkpoint?.root ?? '')}, ${JSON.stringify(b1.run?.id ?? '')}).then((r) => r)`)
  log(
    undo?.ok && read('app.js') === 'uno\ndos\ntres\nsin-confirmar\n' && read('sub/nota.txt') === 'hola\n' &&
      read('previo.txt') === 'mío, sin seguir\n' && read('nuevo/creado.txt') === null && !fs.existsSync(path.join(REPO, 'nuevo')),
    'DESHACER DEVUELVE EL ÁRBOL A COMO ESTABA, CON LO SIN CONFIRMAR',
    undo?.error ?? `app.js: ${JSON.stringify(read('app.js'))}`
  )
  log(git(['diff', '--cached', '--name-only']) === indexBefore, 'deshacer tampoco toca lo preparado en el índice', git(['diff', '--cached', '--name-only']))
  const redo = await js(`window.api.checkpoints.undo(${JSON.stringify(b1.run?.checkpoint?.root ?? '')}, ${JSON.stringify(undo?.data?.safetyId ?? '')}).then((r) => r)`)
  log(
    redo?.ok && read('app.js')?.includes('del-agente') && read('nuevo/creado.txt') === 'lo creó el agente\n' && read('sub/nota.txt') === null,
    'Y EL DESHACER TAMBIÉN SE DESHACE',
    redo?.error ?? ''
  )
  const bad = await js(`window.api.checkpoints.undo(${JSON.stringify(REPO)}, '../../etc').then((r) => r)`)
  log(bad?.ok === false, 'un id de punto de control raro se rechaza', bad?.error)
  // Se deja el repositorio como al principio para lo que venga detrás.
  git(['reset', '-q', '--hard'])
  git(['clean', '-qfd'])

  /* -------------------------------------------------------------- *
   * B2 · Un worktree por tarea                                      *
   * -------------------------------------------------------------- */
  // El .env y lo que deja la preparación no van a git (como node_modules).
  fs.appendFileSync(path.join(REPO, '.git', 'info', 'exclude'), '\n.env\nsetup-hecho.txt\n', 'utf8')
  fs.writeFileSync(path.join(REPO, '.env'), 'SECRETO_DE_PRUEBA=1\n', 'utf8')
  fs.writeFileSync(path.join(TMP, 'fuera.txt'), 'fuera del repositorio\n', 'utf8')
  const headB2 = git(['rev-parse', 'HEAD'])
  const setupCmd = `node -e "require('fs').writeFileSync('setup-hecho.txt', 'ok')"`
  const wt = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    const project = { id: 'proyecto-wt', name: 'Repo wt', path: repo, color: '#fff', createdAt: Date.now(),
      worktreeSetup: ${JSON.stringify(setupCmd)}, worktreeCopy: ['.env', '../fuera.txt'] }
    await api.projects.save(project)
    await api.agents.saveCli({ id: 'editor-wt', name: 'Editor', type: 'cli', command: bins.editor, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    const sid = await engine.newSession('cli', { cliAgentId: 'editor-wt', projectId: project.id })
    const created = await api.worktrees.create(repo, { label: 'Arreglo del login', projectId: project.id, sessionId: sid })
    const info = created.data
    let run = null
    if (info) {
      engine.patchSessionConfig(sid, { worktreePath: info.path })
      run = await engine.sendCli(sid, { prompt: 'cambia cosas', agentId: 'editor-wt', projectPath: info.path, projectId: project.id })
    }
    const listed = (await api.worktrees.list(repo)).data ?? []
    return { created, info, run, listed, sid }
  })()`)
  const wtPath = wt.info?.path ?? ''
  const inWt = (rel) => (wtPath && fs.existsSync(path.join(wtPath, rel)) ? fs.readFileSync(path.join(wtPath, rel), 'utf8') : null)
  log(
    wt.created?.ok && wt.info?.branch === 'acc/arreglo-del-login' && path.basename(path.dirname(wtPath)) === 'repo.worktrees',
    'UN WORKTREE CON SU CARPETA Y SU RAMA acc/ AL LADO DEL REPOSITORIO',
    wt.created?.error ?? `${wt.info?.branch} · ${wtPath}`
  )
  log(
    inWt('.env') === 'SECRETO_DE_PRUEBA=1\n' && !fs.existsSync(path.join(TMP, 'repo.worktrees', 'fuera.txt')) && !fs.existsSync(path.join(wtPath, '..', 'fuera.txt')),
    'se copia el .env y nada de fuera del repositorio'
  )
  log(wt.info?.setup?.ok === true && inWt('setup-hecho.txt') === 'ok', 'LA PREPARACIÓN DEL PROYECTO CORRE DENTRO DEL WORKTREE', wt.info?.setup?.output?.slice(-120))
  log(
    inWt('app.js')?.includes('del-agente') && inWt('nuevo/creado.txt') && !fs.readFileSync(path.join(REPO, 'app.js'), 'utf8').includes('del-agente') &&
      !fs.existsSync(path.join(REPO, 'nuevo')) && git(['rev-parse', 'HEAD']) === headB2,
    'EL AGENTE TRABAJA EN EL WORKTREE Y TU CARPETA NO SE TOCA',
    wt.run?.error ?? ''
  )
  log(Boolean(wt.run?.checkpoint?.commit), 'el turno en el worktree también tiene punto de control')
  const lw = wt.listed.find((w) => !w.main)
  log(
    wt.listed.length === 2 && wt.listed[0].main && lw?.label === 'Arreglo del login' && lw?.projectId === 'proyecto-wt' && lw?.sessionId === wt.sid && lw?.dirty >= 4 && lw?.ahead === 0,
    'LA LISTA DICE DE QUIÉN ES Y CUÁNTO LLEVA SIN CONFIRMAR',
    lw ? `${lw.dirty} sin confirmar, ${lw.ahead} por delante` : 'no aparece'
  )

  const wt2 = await js(`(async () => {
    const api = window.api
    const path = ${JSON.stringify(wtPath)}
    const removeDirty = await api.worktrees.remove(path, { deleteBranch: true })
    const mergeNoMsg = await api.worktrees.merge(path, {})
    const merged = await api.worktrees.merge(path, { message: 'Arreglo del login' })
    const after = ((await api.worktrees.list(path)).data ?? []).find((w) => !w.main)
    const removed = await api.worktrees.remove(path, { deleteBranch: true })
    return { removeDirty, mergeNoMsg, merged, after, removed }
  })()`)
  log(wt2.removeDirty?.ok === false && wt2.merged?.data?.ok === true, 'CON CAMBIOS SIN CONFIRMAR NO SE QUITA SIN FORZAR', wt2.removeDirty?.error)
  log(wt2.mergeNoMsg?.ok === false, 'y no se fusiona sin decir con qué mensaje confirmarlos', wt2.mergeNoMsg?.error)
  const mainApp = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8')
  log(
    wt2.merged?.ok && wt2.merged.data?.ok && wt2.merged.data?.committed && mainApp.includes('del-agente') && fs.existsSync(path.join(REPO, 'nuevo', 'creado.txt')) &&
      git(['log', '-1', '--format=%s']).startsWith('Fusiona acc/arreglo-del-login') && git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length === 3,
    'FUSIONAR CONFIRMA LO PENDIENTE Y HACE UN MERGE EN TU RAMA',
    wt2.merged?.error ?? wt2.merged?.data?.output?.slice(0, 120)
  )
  log(wt2.after?.dirty === 0 && wt2.after?.ahead === 0, 'después de fusionar no queda nada pendiente', wt2.after ? `${wt2.after.dirty} / ${wt2.after.ahead}` : '')
  log(
    wt2.removed?.ok && !fs.existsSync(wtPath) && git(['branch', '--list', 'acc/*']) === '',
    'QUITARLO BORRA LA CARPETA Y LA RAMA',
    wt2.removed?.error ?? git(['branch', '--list', 'acc/*'])
  )

  const wt3 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const made = (await api.worktrees.create(repo, { label: 'Arreglo del login', projectId: 'proyecto-wt' })).data
    return { made }
  })()`)
  const wt3Path = wt3.made?.path ?? ''
  if (wt3Path) fs.writeFileSync(path.join(wt3Path, 'a-medias.txt'), 'sin confirmar\n', 'utf8')
  const wt4 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const path = ${JSON.stringify(wt3Path)}
    const soft = await api.worktrees.remove(path, { deleteBranch: true })
    const forced = await api.worktrees.remove(path, { force: true, deleteBranch: true })
    const notWt = await api.worktrees.remove(repo, { force: true })
    const notRepo = await api.worktrees.merge(${JSON.stringify(TMP.replace(/\\/g, '/'))}, { message: 'x' })
    return { soft, forced, notWt, notRepo }
  })()`)
  log(wt3.made?.branch === 'acc/arreglo-del-login', 'el mismo nombre otra vez vuelve a servir cuando el anterior ya no está', wt3.made?.branch)
  log(
    wt4.soft?.ok === false && wt4.forced?.ok && !fs.existsSync(wt3Path) && git(['branch', '--list', 'acc/*']) === '',
    'A SABIENDAS, SÍ: SE QUITA CON LO QUE TENGA Y SU RAMA',
    wt4.forced?.error ?? ''
  )
  log(wt4.notWt?.ok === false && fs.existsSync(path.join(REPO, 'app.js')), 'LA CARPETA PRINCIPAL NO SE PUEDE QUITAR COMO SI FUERA UN WORKTREE', wt4.notWt?.error)
  log(wt4.notRepo?.ok === false, 'ni se fusiona algo que no es un worktree', wt4.notRepo?.error)
  await js(`(async () => {
    const engine = window.__accEngine
    await engine.deleteSession(${JSON.stringify(wt.sid ?? '')})
    await window.api.agents.removeCli('editor-wt')
    await window.api.projects.remove('proyecto-wt')
  })()`)

  /* -------------------------------------------------------------- *
   * Cierre                                                         *
   * -------------------------------------------------------------- */
  try {
    if (CATALOG_BACKUP) fs.writeFileSync(CATALOG, CATALOG_BACKUP)
    else fs.rmSync(CATALOG, { force: true })
  } catch {
    /* el catálogo se vuelve a descargar solo */
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* en Windows a veces git deja un candado; no importa para la prueba */
  }
  console.log('\nRESULTADOS')
  for (const r of results) console.log('  ' + r)
  const ok = results.filter((r) => r.startsWith('PASA')).length
  console.log(`${ok}/${results.length} comprobaciones correctas`)
  app.exit(ok === results.length ? 0 : 1)
})
