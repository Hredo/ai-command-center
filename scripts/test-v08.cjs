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

function setupFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true })
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(path.join(FIXTURES, 'claude.js'), CLAUDE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'codex.js'), CODEX_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'gemini.js'), GEMINI_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'opencode.js'), OPENCODE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'plain.js'), PLAIN_FIXTURE, 'utf8')
  BINS.claude = makeBin('claude', 'claude.js')
  BINS.codex = makeBin('codex', 'codex.js')
  BINS.gemini = makeBin('gemini', 'gemini.js')
  BINS.opencode = makeBin('opencode', 'opencode.js')
  BINS.plain = makeBin('otro-cli', 'plain.js')
}

setupRepo()
setupFixtures()

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
    const project = { id: 'proyecto-prueba', name: 'Proyecto de prueba', path: repo, color: '#fff', createdAt: Date.now() }
    await api.projects.save(project)
    const agent = {
      id: 'claude-falso', name: 'Claude falso', type: 'cli', command: 'node',
      args: [fixtures + '/claude.js'], parser: 'claude-stream-json', color: '#f0b429', createdAt: Date.now()
    }
    await api.agents.saveCli(agent)

    // Sin projectId, sólo con una carpeta de dentro del proyecto: tiene que apuntarse igual.
    const sid = await engine.newSession('cli', { cliAgentId: agent.id })
    const run = await engine.sendCli(sid, { prompt: 'mira', agentId: agent.id, projectPath: repo + '/sub' })
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
   * Cierre                                                         *
   * -------------------------------------------------------------- */
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
