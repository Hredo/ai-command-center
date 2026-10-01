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
const http = require('node:http')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-v08-'))
const REPO = path.join(TMP, 'repo')
const FIXTURES = path.join(TMP, 'fixtures')
const HOME = path.join(TMP, 'home')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

/** Líneas añadidas y quitadas de una ejecución. */
function changes(r) {
  if (!r?.filesChanged) return null
  return r.filesChanged.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 })
}

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
const CLAUDE_FIXTURE = `require(${JSON.stringify(path.join(__dirname, 'fake-claude.cjs'))}).run()
`

/**
 * Codex falso con `exec --json`: dice su sesión, razona, lanza un comando,
 * cambia un archivo, lleva una lista de tareas y cierra el turno con tokens.
 * Contesta qué argumentos le llegaron, para comprobar cómo se retoma.
 */
const CODEX_FIXTURE = `
if (process.argv.includes('app-server')) return require(${JSON.stringify(path.join(__dirname, 'fake-codex.cjs'))}).run()
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
if (process.argv.includes('--experimental-acp')) return require(${JSON.stringify(path.join(__dirname, 'fake-acp.cjs'))}).run('gemini')
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
if (process.argv.includes('acp')) return require(${JSON.stringify(path.join(__dirname, 'fake-acp.cjs'))}).run('opencode')
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

/** Un agente que cambia cosas y, si le llega una revisión, la corrige y repite lo que recibió. */
const REVIEW_FIXTURE = `
const fs = require('node:fs')
let prompt = ''
process.stdin.on('data', (c) => (prompt += c))
process.stdin.on('end', () => {
  if (prompt.includes('He revisado')) {
    fs.appendFileSync('app.js', 'corregido\\n')
    process.stdout.write('revision recibida:\\n' + prompt)
  } else {
    fs.writeFileSync('app.js', 'uno\\nDOS\\ntres\\ncuatro\\n')
    fs.writeFileSync('extra.txt', 'nuevo\\n')
    process.stdout.write('hecho')
  }
})
`

/**
 * Un agente para el tablero de Tareas que hace una cosa según lo que le pidan:
 * tardar un poco y crear un fichero, preguntar a mitad, seguir cuando le dicen
 * que sí o fallar. La conversación anterior le llega dentro del prompt, así
 * que la respuesta se mira antes que la pregunta.
 */
const TASK_FIXTURE = `
const fs = require('node:fs')
let prompt = ''
process.stdin.on('data', (c) => (prompt += c))
process.stdin.on('end', () => {
  if (prompt.includes('sí, sigue')) {
    fs.appendFileSync('medio.txt', 'entero\\n')
    process.stdout.write('Listo.')
  } else if (prompt.includes('falla')) {
    process.stderr.write('se rompió algo')
    process.exit(3)
  } else if (prompt.includes('pregunta')) {
    fs.writeFileSync('medio.txt', 'a medias\\n')
    process.stdout.write('He hecho la mitad.\\n\\n**¿Sigo con la otra parte?**')
  } else {
    setTimeout(() => {
      fs.writeFileSync('tarea.txt', 'hecho por la tarea\\n')
      process.stdout.write('Hecho: tarea.txt creado.')
    }, 2500)
  }
})
`

/**
 * Un proveedor compatible con OpenAI que hace de agente: la primera vez pide
 * escribir app.js con write_file y, cuando le llega el resultado, termina.
 */
const API_PORT = 18000 + Math.floor(Math.random() * 1000)
function startAgentMock() {
  return new Promise((resolve) => {
    const requests = []
    const server = http.createServer((req, res) => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'agente-de-prueba', context_length: 32000 }] }))
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        let msgs = []
        let offered = []
        try {
          const parsed = JSON.parse(body)
          requests.push(parsed)
          msgs = parsed.messages ?? []
          offered = (parsed.tools ?? []).map((t) => t.function?.name)
        } catch {}
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
        const users = msgs.filter((m) => m.role === 'user')
        // Con imágenes el contenido llega en partes: el texto es la parte «text».
        const textOf = (c) => (Array.isArray(c) ? c.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : String(c ?? ''))
        const lastUser = textOf(users[users.length - 1]?.content)
        const tools = msgs.filter((m) => m.role === 'tool')
        // El mensaje de un commit: contesta dentro de un bloque de código, como hacen muchos modelos.
        const sysText = String(msgs.find((m) => m.role === 'system')?.content ?? '')
        if (sysText.includes('mensajes de commit')) {
          send({ choices: [{ delta: { content: '```\nArregla el total de la factura\n\nEl redondeo se hacía antes de sumar.\n```' } }] })
          send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 20 } })
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        // Una revisión: el JSON dentro de un bloque de código y con texto alrededor.
        if (sysText.includes('revisor de código')) {
          const review = {
            summary: 'Hay una división por cero.',
            comments: [
              { file: 'calc.js', line: 2, severity: 'error', comment: 'Si b es 0 divide por cero.' },
              { file: 'calc.js', line: 1, severity: 'info', comment: 'El nombre div es poco claro.' },
              { file: 'otro/inexistente.js', line: 5, severity: 'warning', comment: 'Fichero que no está en el diff.' }
            ]
          }
          send({ choices: [{ delta: { content: 'Aquí tienes la revisión:\n```json\n' + JSON.stringify(review) + '\n```\nEspero que ayude.' } }] })
          send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 80 } })
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        // La descripción de una PR: con «Título:» delante, que hay que quitar.
        if (sysText.includes('descripciones de pull requests')) {
          send({ choices: [{ delta: { content: 'Título: Añade el panel de PR\n\n- Lista las PR abiertas con su CI\n- Abre la PR desde la app' } }] })
          send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 400, completion_tokens: 30 } })
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        // «eco: texto»: contesta sin herramientas, con cuántos mensajes tuyos le han llegado.
        const eco = /eco: (.+)$/s.exec(lastUser)
        if (eco) {
          send({ choices: [{ delta: { content: `Eco ${users.length}: ${eco[1]}` } }] })
          send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5 } })
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        // «web: {args} || {args}…»: pide web_fetch con cada uno, en orden.
        const web = /web: (.+)$/s.exec(lastUser)
        if (web && offered.includes('web_fetch')) {
          const calls = web[1].split(' || ').map((x) => JSON.parse(x))
          const i = tools.length
          if (i < calls.length) {
            send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_web_' + i, function: { name: 'web_fetch', arguments: JSON.stringify(calls[i]) } }] } }] })
            send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 60, completion_tokens: 10 } })
          } else {
            send({ choices: [{ delta: { content: `Leídas ${i} direcciones.` } }] })
            send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 90, completion_tokens: 6 } })
          }
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        const mcpCall = /suma/.test(lastUser)
          ? ['mcp__calc__sumar', { a: 2, b: 3, detalle: { unidades: 'm' } }]
          : /borra la memoria/.test(lastUser)
            ? ['mcp__calc__borrar', {}]
            : /token/.test(lastUser)
              ? ['mcp__calc__token', {}]
              : null
        if (mcpCall && offered.includes(mcpCall[0])) {
          if (!tools.length) {
            send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_mcp', function: { name: mcpCall[0], arguments: JSON.stringify(mcpCall[1]) } }] } }] })
            send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 60, completion_tokens: 10 } })
          } else {
            send({ choices: [{ delta: { content: 'Resultado: ' + tools[tools.length - 1].content } }] })
            send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 90, completion_tokens: 6 } })
          }
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        if (!msgs.some((m) => m.role === 'tool')) {
          send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'app.js', content: 'uno\nDOS\ntres\n' }) } }] } }] })
          send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 80, completion_tokens: 20 } })
        } else {
          send({ choices: [{ delta: { content: 'He puesto DOS en app.js.' } }] })
          send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 8 } })
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.requests = requests
    server.listen(API_PORT, '127.0.0.1', () => resolve(server))
  })
}

function setupFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true })
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(path.join(FIXTURES, 'claude.js'), CLAUDE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'codex.js'), CODEX_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'gemini.js'), GEMINI_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'opencode.js'), OPENCODE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'plain.js'), PLAIN_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'editor.js'), EDITOR_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'review.js'), REVIEW_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'task.js'), TASK_FIXTURE, 'utf8')
  BINS.claude = makeBin('claude', 'claude.js')
  BINS.codex = makeBin('codex', 'codex.js')
  BINS.gemini = makeBin('gemini', 'gemini.js')
  BINS.opencode = makeBin('opencode', 'opencode.js')
  BINS.plain = makeBin('otro-cli', 'plain.js')
  BINS.editor = makeBin('editor-cli', 'editor.js')
  BINS.review = makeBin('revisor-cli', 'review.js')
  BINS.task = makeBin('tarea-cli', 'task.js')
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
// Las tareas programadas miran el reloj cada medio segundo en vez de cada 30.
process.env.ACC_SCHEDULE_TICK_MS = '500'
// El Linux de las pruebas no tiene quien pinte la bandeja: aquí se da por hecho que sí.
process.env.ACC_TRAY_HOST = '1'
// El recorrido de bienvenida sólo sale solo en la app instalada; aquí se pide, para probarlo.
process.env.ACC_TOUR = '1'

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
    { id: 'otro-modelo', providerId: 'openrouter', name: 'Otro', source: 'catalog', priceIn: 0, priceOut: 0 },
    { id: 'agente-sin-vision', providerId: 'vllm', name: 'Sin visión', source: 'catalog', modalities: ['text'] }
  ]
}), 'utf8')

require('../out/main/index.js')

app.whenReady().then(async () => {
  const win = await waitWindow()
  const js = (code) => win.webContents.executeJavaScript(code)
  const ctx = JSON.stringify({ repo: REPO, fixtures: FIXTURES.replace(/\\/g, '/'), home: HOME })

  /* -------------------------------------------------------------- *
   * T1 · El recorrido de bienvenida sale solo la primera vez, y la  *
   *      ayuda lo explica todo                                     *
   * -------------------------------------------------------------- */
  const reloadT1 = async () => {
    win.reload()
    const end = Date.now() + 15000
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 250))
      const ready = await js(`Boolean(window.__accEngine && window.__accHelp && document.querySelector('[data-sidebar]'))`).catch(() => false)
      if (ready) break
    }
    await new Promise((r) => setTimeout(r, 600))
  }
  // Como la primera vez: sin el recorrido hecho, con la mesa y el menú de fábrica.
  await js(`window.api.config.settings({ tourDone: false, workspace: undefined, layouts: [], nav: undefined, appearance: undefined })`)
  await reloadT1()
  const t1 = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    // Sale solo, sin pedirlo.
    const tour = await until(() => document.querySelector('[data-tour]'))
    out.auto = Boolean(tour)
    out.first = document.querySelector('[data-tour-card]')?.textContent ?? ''
    out.looks = [...document.querySelectorAll('[data-look]')].map((b) => b.getAttribute('data-look')).join(',')
    // Elegir el aspecto cambia el tema al momento.
    out.themeBefore = document.documentElement.dataset.theme
    document.querySelector('[data-look="mesa-clara"]')?.click()
    out.themeLight = await until(() => (document.documentElement.dataset.theme === 'mesa-clara' ? document.documentElement.dataset.scheme : null), 3000)
    document.querySelector('[data-look="mesa"]')?.click()
    await until(() => document.documentElement.dataset.theme === 'mesa', 3000)
    // Los pasos señalan lo que explican.
    const next = () => document.querySelector('[data-tour-next-btn]')?.click()
    const steps = []
    for (let i = 1; i <= 6; i++) {
      next()
      await until(() => document.querySelector('[data-tour]')?.getAttribute('data-tour-step') === String(i), 3000)
      await sleep(120)
      steps.push((document.querySelector('[data-tour-card] h2')?.textContent ?? '') + (document.querySelector('[data-tour] .border-accent.pointer-events-none') ? '*' : ''))
    }
    out.steps = steps.join(' | ')
    // Con la flecha atrás se vuelve; Esc no hace falta: el último paso lleva a Cuentas.
    document.querySelector('[data-tour-back]')?.click()
    out.back = await until(() => document.querySelector('[data-tour]')?.getAttribute('data-tour-step') === '5', 3000) ? true : false
    next()
    await until(() => document.querySelector('[data-tour-go="accounts"]'), 3000)
    document.querySelector('[data-tour-go="accounts"]')?.click()
    out.closed = Boolean(await until(() => !document.querySelector('[data-tour]'), 3000))
    out.accounts = Boolean(await until(() => document.querySelector('[data-page="settings"]:not([hidden]) [data-accounts]'), 5000))
    out.done = await until(async () => (await api.config.get()).data.settings.tourDone === true, 3000)
    return out
  })()`)
  await reloadT1()
  const t1b = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    // La segunda vez ya no sale.
    await sleep(2200)
    out.again = Boolean(document.querySelector('[data-tour]'))
    // La ayuda: el botón de la barra, el buscador y cada tema.
    document.querySelector('[data-open-help]')?.click()
    out.open = Boolean(await until(() => document.querySelector('[data-help]')))
    const items = () => [...document.querySelectorAll('[data-help-item]')].map((b) => b.getAttribute('data-help-item'))
    out.topics = items().length
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('[data-help-search]'), 'worktree')
    out.search = await until(() => { const l = items(); return l.length && l.length < out.topics ? l.join(',') : null }, 3000)
    set(document.querySelector('[data-help-search]'), 'zzzz no existe')
    out.none = Boolean(await until(() => items().length === 0, 3000))
    set(document.querySelector('[data-help-search]'), '')
    await until(() => items().length === out.topics, 3000)
    // Todos los temas tienen texto de verdad, y los que llevan a una sección, su botón.
    const thin = []
    for (const id of items()) {
      document.querySelector('[data-help-item="' + id + '"]')?.click()
      const shown = await until(() => { const a = document.querySelector('[data-help-topic="' + id + '"]'); return a && a.querySelector('.md') ? a : null }, 4000)
      if (!shown || (shown.textContent ?? '').length < 120) thin.push(id)
    }
    out.thin = thin.join(',')
    document.querySelector('[data-help-item="tasks"]')?.click()
    const go = await until(() => document.querySelector('[data-help-topic="tasks"] [data-help-go]'), 3000)
    out.goLabel = go?.textContent?.trim()
    go?.click()
    out.went = Boolean(await until(() => !document.querySelector('[data-help]') && document.querySelector('[data-page="tasks"]:not([hidden])'), 4000))
    // F1 la abre y la cierra; desde ella se repite el recorrido.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))
    out.f1 = Boolean(await until(() => document.querySelector('[data-help]'), 3000))
    document.querySelector('[data-help-tour]')?.click()
    out.replay = Boolean(await until(() => document.querySelector('[data-tour]') && !document.querySelector('[data-help]'), 3000))
    document.querySelector('[data-tour-skip]')?.click()
    out.skipped = Boolean(await until(() => !document.querySelector('[data-tour]'), 3000))
    window.__accEngine.navigate('dashboard')
    return out
  })()`)

  log(
    t1.auto && /Te damos la bienvenida/.test(t1.first) && t1.looks === 'mesa,mesa-clara,command,github-dark',
    'T1: LA PRIMERA VEZ SALE SOLO EL RECORRIDO DE BIENVENIDA, CON EL ASPECTO A ELEGIR',
    t1.looks
  )
  log(t1.themeBefore === 'mesa' && t1.themeLight === 'light', 'el tema de fábrica es el nuevo y elegir otro en el recorrido lo cambia al momento', `${t1.themeBefore} → ${t1.themeLight}`)
  log(
    t1.steps === 'Las secciones* | Varias secciones a la vez* | Ir a cualquier sitio* | Lo que está pasando* | La ayuda, siempre aquí* | Listo. ¿Por dónde empiezas?' && t1.back,
    'CADA PASO SEÑALA EN LA PROPIA INTERFAZ LO QUE EXPLICA, Y SE PUEDE VOLVER ATRÁS',
    t1.steps
  )
  log(t1.closed && t1.accounts && t1.done === true, 'el último paso lleva a conectar las IAs y deja apuntado que el recorrido ya se hizo', JSON.stringify({ closed: t1.closed, accounts: t1.accounts, done: t1.done }))
  log(t1b.again === false, 'LA SEGUNDA VEZ YA NO SALE')
  log(
    t1b.open && t1b.topics >= 18 && t1b.thin === '' && /tasks/.test(t1b.search ?? '') && t1b.none,
    'EL BOTÓN DE AYUDA ABRE LA DOCUMENTACIÓN: TODOS LOS TEMAS TIENEN TEXTO Y EL BUSCADOR LOS FILTRA',
    `${t1b.topics} temas · «worktree» → ${t1b.search}`
  )
  log(t1b.goLabel === 'Abrir Tareas' && t1b.went, 'cada tema lleva a su sección', String(t1b.goLabel))
  log(t1b.f1 && t1b.replay && t1b.skipped, 'F1 abre la ayuda y desde ella se repite el recorrido', JSON.stringify({ f1: t1b.f1, replay: t1b.replay }))

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
  log(Boolean(x.first?.cliSessionId?.startsWith('hilo-')), 'Codex: la sesión es el hilo que abre su servidor', String(x.first?.cliSessionId))
  log(
    (x.second?.response ?? '').includes('hilo=resume ' + x.first?.cliSessionId) && /prompt=segundo/.test(x.second?.response ?? ''),
    'CODEX RETOMA SU HILO (thread/resume)',
    (x.second?.response ?? '').slice(0, 80)
  )
  log(x.first?.promptTokens === 500 && x.first?.completionTokens === 40 && x.first?.cachedTokens === 100, 'Codex: tokens reales del turno', `${x.first?.promptTokens}/${x.first?.completionTokens}/${x.first?.cachedTokens}`)
  log(
    x.first?.steps?.some((s) => s.tool === 'Bash' && s.target === 'ls' && s.status === 'ok') &&
      x.first?.steps?.some((s) => s.tool === 'Edit' && s.target?.includes('app.js')),
    'Codex: comandos y cambios de archivos en la línea de tiempo'
  )
  log(x.first?.todos?.length === 2 && x.first.todos[0].done === true, 'Codex: su lista de tareas queda guardada', JSON.stringify(x.first?.todos))
  log((x.first?.response ?? '').startsWith('hilo=nuevo'), 'Codex: la respuesta es el mensaje del agente, sin JSON')

  const g = a1.gemini
  log(g.first?.model === 'gemini-falso' && Boolean(g.first?.cliSessionId), 'Gemini: modelo y sesión del init', `${g.first?.model} ${g.first?.cliSessionId}`)
  log(g.second?.response === 'resume=' + g.first?.cliSessionId, 'GEMINI RETOMA SU SESIÓN (ACP, CARGÁNDOLA)', g.second?.response)
  log(g.first?.promptTokens === 250 && g.first?.completionTokens === 50, 'Gemini: tokens del resultado', `${g.first?.promptTokens}/${g.first?.completionTokens}`)
  log(g.first?.steps?.some((s) => s.tool === 'read_file' && s.status === 'ok'), 'Gemini: la herramienta se abre y se cierra')

  const o = a1.opencode
  log(Boolean(o.first?.cliSessionId?.startsWith('ses_')), 'OpenCode: la sesión sale de sessionID', String(o.first?.cliSessionId))
  log((o.second?.response ?? '').includes('session=' + o.first?.cliSessionId), 'OPENCODE RETOMA SU SESIÓN (ACP)', o.second?.response)

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
    // Por id: el histórico de las pruebas se queda entre pasadas y lo de fuera tiene fechas viejas.
    const rows = (await api.runs.compare(['codex-${CODEX_ID}', 'opencode-ses_oc1', 'gemini-gem-sesion-1'])).data
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
    // La conversación tiene que existir y estar libre antes de cada turno: si no, el envío no sale.
    const free = async () => { for (let i = 0; i < 100; i++) { const c = engine.peekChat(sid); if (c && !c.runningRunId) return; await wait(50) } }
    await free()
    const r1 = await engine.sendCli(sid, { prompt: 'uno', agentId: 'claude-cupo', projectPath: repo })
    await wait(1200)
    const after1 = (await api.quotas.get(true)).data
    await free()
    const r2 = await engine.sendCli(sid, { prompt: 'dos', agentId: 'claude-cupo', projectPath: repo })
    await wait(1200)
    await free()
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
    b.r3 ? `${b.r3.status}: ${(b.r3.error ?? '').slice(0, 80)}` : `sin ejecución (r1 ${b.r1?.status}/${b.r1?.costTotal}, r2 ${b.r2?.status}/${b.r2?.costTotal})`
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
   * B4 · Revisar el diff de un turno y devolver comentarios         *
   * -------------------------------------------------------------- */
  git(['reset', '-q', '--hard', headB2])
  git(['clean', '-qfd'])
  const b4a = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    await api.projects.save({ id: 'proyecto-rev', name: 'Repo rev', path: repo, color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'revisor', name: 'Revisor', type: 'cli', command: bins.review, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    const sid = await engine.newSession('cli', { cliAgentId: 'revisor', projectId: 'proyecto-rev' })
    const run = await engine.sendCli(sid, { prompt: 'cambia app.js', agentId: 'revisor', projectPath: repo, projectId: 'proyecto-rev' })
    const diff = run?.checkpoint ? (await api.checkpoints.diff(run.checkpoint.root, run.id)).data : null
    engine.focusChat(sid)
    return { sid, run, diff }
  })()`)
  log(
    b4a.diff?.until === 'now' && b4a.diff.diff.includes('+DOS') && b4a.diff.diff.includes('-dos') && b4a.diff.diff.includes('+++ b/extra.txt'),
    'EL DIFF DE UN TURNO SALE DE SU PUNTO DE CONTROL, CON LO NUEVO',
    b4a.diff ? b4a.diff.diff.split('\n').length + ' líneas' : 'sin diff'
  )
  log(git(['status', '--porcelain']).includes('extra.txt') && git(['diff', '--cached', '--name-only']) === '', 'leer el diff no toca el índice')

  // Por la interfaz: abrir la revisión, comentar una línea, cerrar y volver (el borrador sigue), y enviar.
  const ui = await js(`(async () => {
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(100) } return null }
    const byText = (sel, text, scope = document) => [...scope.querySelectorAll(sel)].find((x) => x.textContent.trim() === text)
    const modal = () => document.querySelector('div.fixed.inset-0')
    const type = (el, value) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const out = {}
    const revisar = await until(() => byText('button', 'Revisar'))
    if (!revisar) return { error: 'no aparece el botón Revisar' }
    revisar.click()
    const line = await until(() => [...document.querySelectorAll('[title="Comentar esta línea"]')].find((x) => x.textContent.includes('DOS')))
    if (!line) return { error: 'no aparece la línea en el diff' }
    out.lines = document.querySelectorAll('[title="Comentar esta línea"]').length
    line.click()
    const ta = await until(() => document.querySelector('textarea[placeholder="Qué hay que cambiar aquí…"]'))
    type(ta, 'en minúsculas, como estaba')
    await sleep(50)
    byText('button', 'Guardar comentario', modal()).click()
    await sleep(150)
    out.count1 = document.body.textContent.includes('1 comentario')
    byText('button', 'Cerrar', modal()).click()
    await sleep(200)
    byText('button', 'Revisar').click()
    out.draftKept = Boolean(await until(() => document.body.textContent.includes('en minúsculas, como estaba')))
    const general = await until(() => document.querySelector('textarea[placeholder^="Lo que no va sobre"]'))
    type(general, 'añade una prueba')
    await sleep(50)
    const enviar = [...modal().querySelectorAll('button')].find((x) => x.textContent.includes('Enviar al agente'))
    out.canSend = !enviar.disabled
    enviar.click()
    const sid = ${JSON.stringify(b4a.sid)}
    await until(() => { const c = window.__accEngine.peekChat(sid); return c && c.turns.length >= 4 && !c.runningRunId }, 15000)
    const c = window.__accEngine.peekChat(sid)
    out.prompt = c.turns[2]?.content ?? ''
    out.answer = c.turns[3]?.content ?? ''
    out.run2 = c.turns[3]?.runId
    out.modalClosed = !document.body.textContent.includes('Revisar este turno')
    return out
  })()`)
  log(!ui.error && ui.lines >= 5 && ui.count1, 'LA REVISIÓN ENSEÑA EL DIFF Y DEJA COMENTAR UNA LÍNEA', ui.error ?? `${ui.lines} líneas`)
  log(ui.draftKept === true, 'cerrar la revisión sin enviar no tira el comentario')
  log(
    ui.prompt?.startsWith('He revisado') && ui.prompt.includes('app.js, línea 2:') && ui.prompt.includes('`+DOS`') &&
      ui.prompt.includes('en minúsculas, como estaba') && ui.prompt.includes('Además:\nañade una prueba'),
    'LOS COMENTARIOS VAN AL AGENTE CON SU FICHERO, SU LÍNEA Y EL CÓDIGO',
    JSON.stringify(ui.prompt ?? '').slice(0, 160)
  )
  log(
    ui.answer?.includes('revision recibida') && ui.answer.includes('en minúsculas, como estaba') && fs.readFileSync(path.join(REPO, 'app.js'), 'utf8').endsWith('corregido\n') && ui.modalClosed,
    'EL AGENTE LOS RECIBE COMO EL SIGUIENTE TURNO Y CORRIGE',
    JSON.stringify(ui.answer ?? '').slice(0, 100)
  )
  const b4b = await js(`(async () => {
    const api = window.api
    const root = ${JSON.stringify(b4a.run?.checkpoint?.root ?? '')}
    const onlyFirst = (await api.checkpoints.diff(root, ${JSON.stringify(b4a.run?.id ?? '')}, ${JSON.stringify(ui.run2 ?? '')})).data
    const toNow = (await api.checkpoints.diff(root, ${JSON.stringify(b4a.run?.id ?? '')})).data
    const bad = await api.checkpoints.diff(root, '../../x')
    const engine = window.__accEngine
    await engine.deleteSession(${JSON.stringify(b4a.sid)})
    await api.agents.removeCli('revisor')
    await api.projects.remove('proyecto-rev')
    return { onlyFirst, toNow, bad }
  })()`)
  log(
    b4b.onlyFirst?.until === 'next' && b4b.onlyFirst.diff.includes('+DOS') && !b4b.onlyFirst.diff.includes('corregido') && b4b.toNow?.diff.includes('+corregido'),
    'EL DIFF DE UN TURNO VIEJO ACABA DONDE EMPEZÓ EL SIGUIENTE',
    b4b.onlyFirst?.until
  )
  log(b4b.bad?.ok === false, 'un id raro tampoco vale para el diff', b4b.bad?.error)
  git(['reset', '-q', '--hard', headB2])
  git(['clean', '-qfd'])

  /* -------------------------------------------------------------- *
   * B5 · Arena de código (y C7: agentes por API en la Arena)        *
   * -------------------------------------------------------------- */
  const mock = await startAgentMock()
  const headB5 = git(['rev-parse', 'HEAD'])
  const testCmd = `node -e "process.exit(require('fs').readFileSync('app.js','utf8').includes('DOS')?0:1)"`
  const b5 = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    const prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-arena', name: 'Repo arena', path: repo, color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'arena-bien', name: 'Bien', type: 'cli', command: bins.review, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'arena-mal', name: 'Mal', type: 'cli', command: bins.editor, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    const c = (p) => ({ ...engine.emptyContender(p.mode), ...p })
    engine.setArena({
      prompt: 'pon DOS en app.js',
      project: { id: 'proyecto-arena', name: 'Repo arena', path: repo },
      testCommand: ${JSON.stringify(testCmd)},
      permissionMode: 'acceptEdits',
      contenders: [
        c({ mode: 'cli', cliAgentId: 'arena-bien' }),
        c({ mode: 'cli', cliAgentId: 'arena-mal' }),
        c({ mode: 'api', providerId: 'vllm', model: 'agente-de-prueba' })
      ]
    })
    await engine.launchArena({})
    const state = engine.peekArena()
    const execMain = await api.worktrees.exec(repo, 'echo hola')
    return { state, prevBase, execMain }
  })()`)
  const cs = b5.state?.contenders ?? []
  const [cBien, cMal, cApi] = cs
  const wts = cs.map((c) => c.worktreePath).filter(Boolean)
  log(
    wts.length === 3 && new Set(wts).size === 3 && wts.every((w) => w.includes('repo.worktrees')) && cs.every((c) => c.worktreeBranch?.startsWith('acc/arena-')),
    'CADA CONTENDIENTE TRABAJA EN SU PROPIO WORKTREE',
    cs.map((c) => c.worktreeBranch ?? c.error).join(', ')
  )
  log(
    fs.readFileSync(path.join(REPO, 'app.js'), 'utf8') === 'uno\ndos\ntres\n' && git(['rev-parse', 'HEAD']) === headB5,
    'MIENTRAS COMPITEN, TU CARPETA NO SE TOCA'
  )
  const wtRead = (c, rel) => (c?.worktreePath && fs.existsSync(path.join(c.worktreePath, rel)) ? fs.readFileSync(path.join(c.worktreePath, rel), 'utf8') : null)
  log(
    wtRead(cApi, 'app.js') === 'uno\nDOS\ntres\n' && cApi?.run?.status === 'ok' && (cApi?.steps ?? []).some((st) => JSON.stringify(st).includes('write_file')),
    'UN MODELO POR API COMPITE COMO AGENTE, CON HERRAMIENTAS, EN SU WORKTREE',
    cApi?.error ?? cApi?.run?.error ?? `${(cApi?.steps ?? []).length} pasos`
  )
  log(wtRead(cBien, 'app.js')?.includes('DOS') && wtRead(cMal, 'app.js')?.includes('del-agente') && !wtRead(cMal, 'app.js')?.includes('DOS'), 'cada agente de consola deja lo suyo en su carpeta')
  log(
    cBien?.tests?.ok === true && cMal?.tests?.ok === false && cApi?.tests?.ok === true,
    'LAS PRUEBAS SE PASAN EN EL WORKTREE DE CADA UNO',
    cs.map((c) => (c.tests ? (c.tests.ok ? 'pasan' : 'fallan') : 'sin pruebas')).join(' / ')
  )
  log(
    cs.every((c) => c.run?.arenaId && c.run.arenaId === b5.state.arenaId && c.run.projectId === 'proyecto-arena') && (changes(cBien?.run)?.added ?? 0) > 0,
    'las ejecuciones van a la misma comparativa y al proyecto, con sus cambios contados'
  )
  log(b5.execMain?.ok === false, 'las pruebas no se pueden lanzar en la carpeta principal', b5.execMain?.error)

  // Fusionar el ganador (el de API) desde la Arena: se fusiona y se quitan todos los worktrees.
  const merged = await js(`(async () => {
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    btn('Arena')?.click()
    const merges = await until(() => { const l = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'Fusionar este'); return l.length === 3 ? l : null })
    if (!merges) return { error: 'no salen los tres «Fusionar este»' }
    merges[2].click()
    const modal = await until(() => document.querySelector('div.fixed.inset-0'))
    const msg = modal.querySelector('input')?.value
    btn('Fusionar', modal).click()
    await until(() => window.__accEngine.peekArena().contenders.every((c) => c.outcome), 15000)
    await sleep(300)
    const defaults = btn('Predeterminados')
    defaults?.click()
    await sleep(500)
    const cfg = (await window.api.config.get()).data
    return { msg, outcomes: window.__accEngine.peekArena().contenders.map((c) => c.outcome), winner: window.__accEngine.peekArena().contenders.map((c) => c.run?.winner), defaults: cfg.settings.arenaDefaults }
  })()`)
  log(
    !merged.error && merged.outcomes?.join() === 'removed,removed,merged' && fs.readFileSync(path.join(REPO, 'app.js'), 'utf8') === 'uno\nDOS\ntres\n' &&
      git(['log', '-1', '--format=%s']).startsWith('Fusiona acc/arena-') && git(['log', '-2', '--format=%s']).includes(merged.msg ?? '#'),
    'FUSIONAR EL GANADOR LO LLEVA A TU RAMA CON SU MENSAJE',
    merged.error ?? `${merged.outcomes?.join()} · ${git(['log', '-1', '--format=%s'])}`
  )
  log(
    wts.every((w) => !fs.existsSync(w)) && git(['branch', '--list', 'acc/*']) === '' && git(['worktree', 'list']).split('\n').length === 1,
    'Y SE QUITAN LOS WORKTREES Y LAS RAMAS DE TODOS',
    git(['branch', '--list', 'acc/*'])
  )
  log(merged.winner?.join() === 'false,false,true', 'el fusionado queda como ganador en el histórico')
  log(
    merged.defaults?.join() === 'cli:arena-bien,cli:arena-mal,api:vllm:agente-de-prueba',
    'los contendientes se guardan como predeterminados de la Arena',
    merged.defaults?.join()
  )
  await js(`(async () => {
    const api = window.api
    await api.providers.setBaseUrl('vllm', ${JSON.stringify(b5.prevBase ?? '')})
    await api.config.settings({ arenaDefaults: [] })
    const rows = (await api.runs.query({ limit: 50 })).data.rows
    for (const r of rows) if (r.arenaId === ${JSON.stringify(b5.state?.arenaId ?? '-')}) await api.runs.remove(r.id)
    await api.agents.removeCli('arena-bien')
    await api.agents.removeCli('arena-mal')
    await api.projects.remove('proyecto-arena')
    window.__accEngine.setArena({ project: undefined, testCommand: '', contenders: [] })
  })()`)
  mock.close()
  git(['reset', '-q', '--hard', headB2])
  git(['clean', '-qfd'])

  /* -------------------------------------------------------------- *
   * B3 · Tablero de Tareas                                          *
   * -------------------------------------------------------------- */
  const mockB3 = await startAgentMock()
  const b3 = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${bins}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    const modal = () => document.querySelector('div.fixed.inset-0')
    const setValue = (el, value) => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    }
    const cardIn = (col, id) => document.querySelector('[data-column="' + col + '"] [data-task="' + id + '"]')
    const out = {}

    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-tareas', name: 'Repo tareas', path: repo, color: '#fff', createdAt: Date.now() })
    await api.projects.save({ id: 'proyecto-otro', name: 'Otro', path: repo + '-otro', color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'tarea', name: 'Tarea', type: 'cli', command: bins.task, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    // Una charla sin proyecto no es una tarea.
    await api.sessions.save({ id: 'charla-suelta', kind: 'chat', title: 'charla suelta', createdAt: Date.now(), updatedAt: Date.now(),
      turns: [{ id: 'u', role: 'user', content: 'hola' }, { id: 'a', role: 'assistant', content: '¿Qué tal?' }] })
    await engine.loadSessions()
    const cfg = async () => (await api.config.get()).data
    // La app relee la configuración al guardar un proyecto o un agente.
    await sleep(600)

    btn('Tareas')?.click()
    await until(() => btn('Nueva tarea'))

    // Nueva tarea por la interfaz, en su worktree.
    btn('Nueva tarea').click()
    const m = await until(() => (modal()?.querySelector('textarea') ? modal() : null))
    if (!m) return { error: 'no se abre «Nueva tarea»' }
    const [selProject, selAgent] = m.querySelectorAll('select')
    setValue(selProject, 'proyecto-tareas')
    await sleep(50)
    setValue(selAgent, 'cli:tarea')
    await sleep(50)
    out.worktreeOnByDefault = m.textContent.includes('Una carpeta y una rama propias')
    setValue(m.querySelector('textarea'), 'crea tarea.txt')
    await sleep(50)
    btn('Lanzar', m).click()
    const s1 = await until(() => engine.peekSessions().find((s) => s.title === 'crea tarea.txt' && s.worktreePath))
    if (!s1) return { error: 'la tarea no se crea con worktree' }
    out.s1 = s1.id
    out.wt = s1.worktreePath
    out.runningCol = Boolean(await until(() => cardIn('running', s1.id), 5000))
    out.runningBadge = Boolean(cardIn('running', s1.id)?.textContent.includes('worktree'))
    out.reviewCol = Boolean(await until(() => cardIn('review', s1.id), 15000))
    await sleep(300)
    out.reviewText = cardIn('review', s1.id)?.textContent ?? ''

    // Revisar: el diff entero de la tarea.
    btn('Revisar', cardIn('review', s1.id))?.click()
    out.diffShows = Boolean(await until(() => modal()?.textContent.includes('tarea.txt') && modal().textContent.includes('Todo lo que ha cambiado la tarea')))
    btn('Cerrar', modal())?.click()
    await sleep(200)

    // Hecha y, si le vuelves a escribir, sale de Hecho sola.
    btn('Hecha', cardIn('review', s1.id))?.click()
    out.doneCol = Boolean(await until(() => cardIn('done', s1.id)))
    out.doneSaved = Boolean(await until(async () => (await api.sessions.get(s1.id)).data?.taskDone?.turns === 2))
    const again = engine.sendTurn(s1.id, 'otra vuelta', await cfg())
    out.reopenRunning = Boolean(await until(() => cardIn('running', s1.id), 5000))
    await again
    out.reopenReview = Boolean(await until(() => cardIn('review', s1.id), 8000))

    // Pregunta: necesita tu respuesta, y se contesta desde la tarjeta.
    const s2 = await engine.newSession('cli', { cliAgentId: 'tarea', projectId: 'proyecto-tareas' })
    await engine.sendTurn(s2, 'haz la mitad y pregunta', await cfg())
    const q = await until(() => cardIn('attention', s2))
    out.questionReason = Boolean(q?.textContent.includes('Te ha preguntado algo'))
    // Falla: también necesita tu respuesta.
    const s3 = await engine.newSession('cli', { cliAgentId: 'tarea', projectId: 'proyecto-tareas' })
    await engine.sendTurn(s3, 'esto falla', await cfg())
    const f = await until(() => cardIn('attention', s3))
    out.failReason = f?.textContent ?? ''
    await sleep(200)
    out.attn = document.querySelectorAll('[data-column="attention"] [data-task]').length
    const navBtn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Tareas') && x.closest('.border-r'))
    out.badge = navBtn?.textContent.trim().replace('Tareas', '')

    btn('Responder', cardIn('attention', s2))?.click()
    const ta = await until(() => cardIn('attention', s2)?.querySelector('textarea'))
    if (ta) {
      setValue(ta, 'sí, sigue')
      await sleep(50)
      btn('Enviar', cardIn('attention', s2))?.click()
    }
    await until(() => { const c = engine.peekChat(s2); return c && c.turns.length >= 4 && !c.runningRunId }, 10000)
    out.replyPrompt = engine.peekChat(s2)?.turns[2]?.content
    out.replyReview = Boolean(await until(() => cardIn('review', s2)))

    // Un agente por API que pide permiso: se da desde la tarjeta.
    const s4 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-tareas', agentMode: true, permissionMode: 'manual', includeContext: false })
    const apiRun = engine.sendTurn(s4, 'pon DOS en app.js', await cfg())
    const pend = await until(() => (cardIn('attention', s4)?.textContent.includes('Espera tu permiso') ? cardIn('attention', s4) : null))
    out.pendingShown = Boolean(pend) && pend.textContent.includes('app.js')
    if (pend) btn('Permitir', pend)?.click()
    const apiRes = await Promise.race([apiRun, sleep(15000).then(() => ({ error: 'no acabó' }))])
    out.apiStatus = apiRes.run?.status ?? apiRes.error
    out.apiReview = Boolean(await until(() => cardIn('review', s4)))

    // La Arena de código sale como una tarjeta más mientras quede ganador por elegir.
    engine.setArena({ prompt: 'compite', arenaId: 'arena-falsa', running: false, project: { id: 'proyecto-tareas', name: 'Repo tareas', path: repo },
      contenders: [{ ...engine.emptyContender('cli'), cliAgentId: 'tarea', runId: 'r-falso', worktreePath: repo + '.worktrees/falso' }] })
    out.arenaCard = (await until(() => cardIn('review', 'arena')))?.textContent ?? ''
    engine.setArena({ project: undefined, arenaId: undefined, prompt: '', contenders: [] })
    await sleep(150)
    out.arenaGone = !document.querySelector('[data-task="arena"]')

    out.chatHidden = !document.querySelector('[data-task="charla-suelta"]')
    // Filtrar por otro proyecto deja fuera las de este.
    const filter = document.querySelector('select[aria-label="Proyecto"]')
    setValue(filter, 'proyecto-otro')
    await sleep(150)
    out.filtered = !document.querySelector('[data-task="' + s1.id + '"]') && !document.querySelector('[data-task="' + s2 + '"]')
    setValue(filter, '')

    out.ids = [s1.id, s2, s3, s4]
    return out
  })()`)
  log(!b3.error && b3.worktreeOnByDefault && b3.wt?.includes('repo.worktrees'), 'NUEVA TAREA DESDE EL TABLERO, EN SU PROPIO WORKTREE', b3.error ?? b3.wt)
  log(b3.runningCol && b3.runningBadge, 'mientras trabaja está en «En marcha», con su worktree')
  log(
    b3.reviewCol && (b3.reviewText ?? '').includes('+1') && (b3.reviewText ?? '').includes('1 fichero') && /acc\//.test(b3.reviewText ?? ''),
    'AL ACABAR PASA A «PARA REVISAR» CON SU RAMA Y SUS LÍNEAS',
    (b3.reviewText ?? '').slice(0, 140)
  )
  log(
    Boolean(b3.wt) && fs.existsSync(path.join(b3.wt, 'tarea.txt')) && !fs.existsSync(path.join(REPO, 'tarea.txt')),
    'el agente de la tarea trabaja en el worktree, no en tu carpeta'
  )
  log(b3.diffShows, 'REVISAR ENSEÑA TODO LO QUE HA CAMBIADO LA TAREA')
  log(b3.doneCol && b3.doneSaved, 'DARLA POR HECHA LA LLEVA A «HECHO» Y SE GUARDA')
  log(b3.reopenRunning && b3.reopenReview, 'si le vuelves a escribir, sale de «Hecho» sola')
  log(b3.questionReason, 'UNA TAREA QUE ACABA PREGUNTANDO NECESITA TU RESPUESTA')
  log((b3.failReason ?? '').includes('Falló'), 'una que falla, también', (b3.failReason ?? '').slice(0, 100))
  log(Number(b3.badge) === b3.attn && b3.attn >= 2, 'el menú cuenta las que necesitan tu respuesta', `insignia ${b3.badge}, columna ${b3.attn}`)
  log(
    b3.replyPrompt === 'sí, sigue' && b3.replyReview && fs.existsSync(path.join(REPO, 'medio.txt')) && fs.readFileSync(path.join(REPO, 'medio.txt'), 'utf8').includes('entero'),
    'SE LE CONTESTA DESDE LA TARJETA Y SIGUE',
    JSON.stringify(b3.replyPrompt)
  )
  log(
    b3.pendingShown && b3.apiStatus === 'ok' && b3.apiReview && fs.readFileSync(path.join(REPO, 'app.js'), 'utf8') === 'uno\nDOS\ntres\n',
    'EL PERMISO QUE PIDE UN AGENTE POR API SE DA DESDE LA TARJETA',
    String(b3.apiStatus)
  )
  log((b3.arenaCard ?? '').includes('Elige el ganador') && b3.arenaGone, 'la Arena de código sale mientras quede ganador por elegir')
  log(b3.chatHidden && b3.filtered, 'las charlas sueltas no salen y el filtro de proyecto funciona')
  await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    await api.providers.setBaseUrl('vllm', ${JSON.stringify(b3.prevBase ?? '')})
    if (${JSON.stringify(b3.wt ?? '')}) await api.worktrees.remove(${JSON.stringify(b3.wt ?? '')}, { force: true, deleteBranch: true })
    for (const id of ${JSON.stringify(b3.ids ?? [])}) await engine.deleteSession(id)
    await engine.deleteSession('charla-suelta')
    await api.agents.removeCli('tarea')
    await api.projects.remove('proyecto-tareas')
    await api.projects.remove('proyecto-otro')
  })()`)
  mockB3.close()
  git(['reset', '-q', '--hard', headB2])
  git(['clean', '-qfd'])

  /* -------------------------------------------------------------- *
   * D3 · AGENTS.md, CLAUDE.md y Skills                              *
   * -------------------------------------------------------------- */
  // Las carpetas personales de Skills cuelgan de HOME: uno de mentira mientras dura el bloque.
  const SKHOME = path.join(TMP, 'skills-home')
  const prevHome = process.env.HOME
  const prevXdg = process.env.XDG_CONFIG_HOME
  process.env.HOME = SKHOME
  process.env.XDG_CONFIG_HOME = path.join(SKHOME, '.config')
  const skill = (dir, name, desc) => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: >\n  ${desc}\n  en dos líneas\n---\n\nPasos de ${name}.\n`)
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'scripts', 'hola.sh'), 'echo hola\n')
    fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'pesado.js'), '//\n')
  }
  skill(path.join(CLAUDE_DIR, 'skills', 'revisar-pr'), 'revisar-pr', 'Revisa una PR')
  skill(path.join(SKHOME, '.agents', 'skills', 'Mala_Skill'), 'otra-cosa', 'Nombre mal puesto')
  skill(path.join(REPO, '.claude', 'skills', 'desplegar'), 'desplegar', 'Despliega la app')
  fs.writeFileSync(path.join(REPO, 'AGENTS.md'), '# Reglas\nREGLA-AGENTS: usa pnpm siempre.\n')
  fs.writeFileSync(path.join(REPO, 'CLAUDE.md'), '@AGENTS.md\nREGLA-CLAUDE: responde en español.\n')
  const mockD3 = await startAgentMock()
  const d3 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    const setValue = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const out = {}

    // Leer y escribir, sin pisar lo que cambió otro.
    const read = (await api.instructions.read(repo)).data
    out.read = read.map((f) => f.file + ':' + f.exists).join()
    const agents = read.find((f) => f.file === 'AGENTS.md')
    const w1 = await api.instructions.write(repo, [{ file: 'AGENTS.md', content: agents.content + 'REGLA-NUEVA\\n', expectedMtime: agents.mtimeMs }])
    out.w1 = w1.ok
    const stale = await api.instructions.write(repo, [{ file: 'AGENTS.md', content: 'pisado', expectedMtime: agents.mtimeMs - 5000 }])
    out.stale = stale.ok ? 'se escribió' : stale.error
    const bad = await api.instructions.write(repo, [{ file: '../fuera.md', content: 'x', expectedMtime: null }])
    out.bad = bad.ok ? 'se escribió' : bad.error
    // Mantener GEMINI.md como copia: se escriben los dos a la vez.
    const now = (await api.instructions.read(repo)).data
    const a2 = now.find((f) => f.file === 'AGENTS.md')
    const g2 = now.find((f) => f.file === 'GEMINI.md')
    const both = await api.instructions.write(repo, [
      { file: 'AGENTS.md', content: a2.content, expectedMtime: a2.mtimeMs },
      { file: 'GEMINI.md', content: a2.content, expectedMtime: g2.mtimeMs }
    ])
    out.both = both.ok && both.data.find((f) => f.file === 'GEMINI.md').content === a2.content
    const disk = (await api.instructions.read(repo)).data
    out.bothDisk = disk.find((f) => f.file === 'GEMINI.md').content === disk.find((f) => f.file === 'AGENTS.md').content

    // El contexto de un chat con proyecto las lleva; el de un agente, el propio bucle.
    const ctxText = (await api.projects.context(repo, {})).data
    out.ctxRules = ctxText.includes('REGLA-AGENTS') && ctxText.includes('REGLA-CLAUDE') && !ctxText.includes('@AGENTS.md')
    out.ctxOnce = ctxText.split('REGLA-AGENTS').length - 1
    const noRules = (await api.projects.context(repo, { instructions: false })).data
    out.ctxOff = !noRules.includes('REGLA-AGENTS')

    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-d3', name: 'Repo d3', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(500)
    const sid = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-d3', agentMode: true, permissionMode: 'bypassPermissions' })
    const r = await engine.sendTurn(sid, 'pon DOS en app.js', (await api.config.get()).data)
    out.agentStatus = r.run?.status ?? r.error
    out.sid = sid

    // Skills: quién ve cada una, y copiar a donde falte.
    const list = (await api.skills.list(repo)).data
    const find = (l, dir, scope) => l.skills.find((s) => s.dir === dir && s.scope === scope)
    out.revisar = find(list, 'revisar-pr', 'personal')?.readers.slice().sort().join()
    out.mala = find(list, 'Mala_Skill', 'personal')?.warnings.join(' ')
    out.malaRejected = find(list, 'Mala_Skill', 'personal')?.rejectedBy.join()
    out.desc = find(list, 'revisar-pr', 'personal')?.description
    out.desplegar = find(list, 'desplegar', 'project')?.readers.slice().sort().join()
    const src = find(list, 'revisar-pr', 'personal').copies[0].path
    const again = await api.skills.copy(src, { id: 'claude', scope: 'personal' })
    out.again = again.ok ? 'copió' : again.error
    const fake = await api.skills.copy(repo, { id: 'agents', scope: 'personal' })
    out.fake = fake.ok ? 'copió' : fake.error
    const synced = await api.skills.copy(src, { id: 'claude-synced', scope: 'personal' })
    out.synced = synced.ok ? 'copió' : synced.error

    // Por la interfaz: Agentes › Skills › Copiar para Codex.
    btn('Agentes')?.click()
    await until(() => btn('Skills'))
    btn('Skills').click()
    const cell = await until(() => document.querySelector('[data-skill="revisar-pr"] [data-tool="codex"]'))
    if (!cell) return { ...out, error: 'no sale la fila de revisar-pr' }
    out.cellBefore = cell.textContent.trim()
    btn('Copiar', cell)?.click()
    out.cellAfter = Boolean(await until(() => {
      const c = document.querySelector('[data-skill="revisar-pr"] [data-tool="codex"]')
      return c && !btn('Copiar', c) ? c : null
    }))
    out.geminiAfter = !btn('Copiar', document.querySelector('[data-skill="revisar-pr"] [data-tool="gemini"]'))

    // Y el editor: Proyectos › el proyecto › Instrucciones.
    btn('Proyectos')?.click()
    await sleep(600)
    ;[...document.querySelectorAll('button, div')].find((x) => x.textContent.trim() === 'Repo d3')?.click()
    await until(() => btn('Instrucciones'))
    btn('Instrucciones')?.click()
    const ta = await until(() => document.querySelector('textarea[spellcheck="false"]'))
    if (!ta) return { ...out, error: 'no sale el editor de instrucciones' }
    out.editorLoaded = ta.value.includes('REGLA-AGENTS')
    setValue(ta, ta.value + 'REGLA-DESDE-LA-APP\\n')
    await sleep(80)
    btn('Guardar', ta.closest('div.space-y-3'))?.click()
    out.saved = Boolean(await until(async () => (await api.instructions.read(repo)).data.find((f) => f.file === 'AGENTS.md').content.includes('REGLA-DESDE-LA-APP')))
    out.projectSkillRow = Boolean(document.querySelector('[data-skill="desplegar"]'))
    return out
  })()`)
  const sysOf = (reqs) => {
    const body = reqs.find((b) => (b.messages ?? []).some((m) => m.role === 'system'))
    return body ? body.messages.find((m) => m.role === 'system').content : ''
  }
  const agentSys = sysOf(mockD3.requests ?? [])
  log(d3.read === 'AGENTS.md:true,CLAUDE.md:true,GEMINI.md:false' && d3.w1, 'SE LEEN Y SE ESCRIBEN AGENTS.md, CLAUDE.md Y GEMINI.md', d3.error ?? d3.read)
  log(typeof d3.stale === 'string' && d3.stale.includes('ha cambiado en disco') && !fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8').includes('pisado'), 'NO SE PISA LO QUE CAMBIÓ OTRO MIENTRAS LO TENÍAS ABIERTO', d3.stale)
  log(typeof d3.bad === 'string' && !fs.existsSync(path.join(TMP, 'fuera.md')), 'sólo se escriben esos tres ficheros', d3.bad)
  log(d3.both && d3.bothDisk, 'una copia se guarda a la vez que AGENTS.md')
  log(d3.ctxRules && d3.ctxOnce === 1 && d3.ctxOff, 'EL CONTEXTO DEL PROYECTO LLEVA SUS INSTRUCCIONES, CON LOS @IMPORTS Y SIN REPETIR', `veces: ${d3.ctxOnce}`)
  log(
    d3.agentStatus === 'ok' && agentSys.includes('REGLA-AGENTS') && agentSys.includes('REGLA-CLAUDE') && agentSys.split('REGLA-AGENTS').length === 2,
    'UN AGENTE POR API TRABAJA CON AGENTS.md Y CLAUDE.md EN SU PROMPT',
    `${d3.agentStatus} · ${agentSys.length} caracteres`
  )
  log(d3.revisar === 'claude,opencode' && d3.desplegar === 'claude,copilot,opencode' && d3.desc === 'Revisa una PR en dos líneas', 'CADA SKILL DICE QUÉ CLIs LA CARGAN', `${d3.revisar} · ${d3.desplegar}`)
  log(typeof d3.mala === 'string' && d3.mala.includes('OpenCode') && d3.malaRejected === 'opencode', 'se avisa de la que OpenCode no cargaría', d3.mala)
  log(
    d3.cellBefore?.includes('Copiar') && d3.cellAfter && d3.geminiAfter &&
      fs.existsSync(path.join(SKHOME, '.agents', 'skills', 'revisar-pr', 'SKILL.md')) &&
      fs.existsSync(path.join(SKHOME, '.agents', 'skills', 'revisar-pr', 'scripts', 'hola.sh')) &&
      !fs.existsSync(path.join(SKHOME, '.agents', 'skills', 'revisar-pr', 'node_modules')),
    'COPIAR UNA SKILL LA LLEVA A .agents/skills Y LA VEN CODEX, GEMINI Y COPILOT',
    d3.error ?? ''
  )
  log(
    typeof d3.again === 'string' && d3.again.includes('Ya está') && typeof d3.fake === 'string' && typeof d3.synced === 'string',
    'copiar no pisa, ni vale una ruta cualquiera, ni se escribe en lo que baja claude.ai',
    [d3.again, d3.fake, d3.synced].join(' | ').slice(0, 160)
  )
  log(d3.editorLoaded && d3.saved && d3.projectSkillRow, 'EL EDITOR DE INSTRUCCIONES GUARDA EN DISCO, Y SALEN LAS SKILLS DEL PROYECTO', d3.error ?? JSON.stringify({ cargado: d3.editorLoaded, guardado: d3.saved, skill: d3.projectSkillRow }))
  await js(`(async () => {
    const api = window.api
    await api.providers.setBaseUrl('vllm', ${JSON.stringify(d3.prevBase ?? '')})
    if (${JSON.stringify(d3.sid ?? '')}) await window.__accEngine.deleteSession(${JSON.stringify(d3.sid ?? '')})
    await api.projects.remove('proyecto-d3')
  })()`)
  mockD3.close()
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = prevXdg
  fs.rmSync(path.join(CLAUDE_DIR, 'skills'), { recursive: true, force: true })
  git(['reset', '-q', '--hard', headB2])
  git(['clean', '-qfd'])

  /* -------------------------------------------------------------- *
   * D1 · Centro de MCP  ·  D2 · MCP en los agentes por API          *
   * -------------------------------------------------------------- */
  const MCPHOME = path.join(TMP, 'mcp-home')
  const envBefore = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, COPILOT_HOME: process.env.COPILOT_HOME, CALC_TOKEN: process.env.CALC_TOKEN }
  process.env.HOME = MCPHOME
  process.env.XDG_CONFIG_HOME = path.join(MCPHOME, '.config')
  process.env.COPILOT_HOME = path.join(MCPHOME, '.copilot')
  process.env.CALC_TOKEN = 'valor-de-prueba'
  const MCP_FIXTURE = path.join(FIXTURES, 'mcp-calc.js')
  fs.writeFileSync(
    MCP_FIXTURE,
    [
      "const rl = require('node:readline').createInterface({ input: process.stdin })",
      "const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')",
      "rl.on('line', (line) => {",
      '  let m',
      '  try { m = JSON.parse(line) } catch { return }',
      "  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'calc', version: '1.0.0' } } })",
      "  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [",
      "    { name: 'sumar', description: 'Suma dos números', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' }, detalle: { type: 'object', properties: { unidades: { type: 'string', enum: ['m', 'km'] } } } }, required: ['a', 'b'] }, annotations: { readOnlyHint: true } },",
      "    { name: 'borrar', description: 'Borra la memoria', inputSchema: { type: 'object', properties: {} } },",
      "    { name: 'token', description: 'Dice si tiene su token', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }",
      '  ] } })',
      "  else if (m.method === 'tools/call') {",
      '    const a = m.params.arguments || {}',
      "    const text = m.params.name === 'sumar' ? String(Number(a.a) + Number(a.b)) : m.params.name === 'token' ? (process.env.CALC_TOKEN === 'valor-de-prueba' ? 'token ok' : 'sin token') : 'memoria borrada'",
      "    send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } })",
      "  } else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} })",
      '})'
    ].join('\n')
  )
  // Configuraciones de mentira, con secretos escritos tal cual: no deben salir de main.
  const GH = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz123456'
  const SK = 'sk-' + 'abcdefghijklmnopqrstuvwx'
  fs.mkdirSync(CLAUDE_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(CLAUDE_DIR, '.claude.json'),
    JSON.stringify(
      {
        numStartups: 5,
        mcpServers: {
          calc: { type: 'stdio', command: 'node', args: [MCP_FIXTURE], env: { CALC_TOKEN: GH, LOG_LEVEL: 'debug' } },
          remoto: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ' + SK } }
        }
      },
      null,
      2
    )
  )
  fs.mkdirSync(CODEX_HOME, { recursive: true })
  const codexToml = path.join(CODEX_HOME, 'config.toml')
  fs.writeFileSync(codexToml, '# mi configuración\nmodel = "gpt-5"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp"]\nenv_vars = ["DOCS_KEY"]\n')
  const ocFile = path.join(MCPHOME, '.config', 'opencode', 'opencode.jsonc')
  fs.mkdirSync(path.dirname(ocFile), { recursive: true })
  fs.writeFileSync(ocFile, '{\n  // mis servidores\n  "mcp": {\n    "sentry": { "type": "remote", "url": "https://mcp.sentry.dev/mcp", "headers": { "Authorization": "Bearer {env:SENTRY_TOKEN}" } }\n  }\n}\n')
  fs.writeFileSync(path.join(REPO, '.mcp.json'), JSON.stringify({ mcpServers: { 'del-repo': { type: 'stdio', command: 'node', args: ['servidor.js'] } } }, null, 2))
  const mockD1 = await startAgentMock()
  const d1 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    const out = {}

    const rep = (await api.mcp.list()).data
    out.leak = JSON.stringify(rep).includes('ghp_') || JSON.stringify(rep).includes('sk-abc')
    const row = (name, scope = 'personal') => rep.servers.find((s) => s.name === name && s.scope === scope)
    out.rows = rep.servers.filter((s) => s.scope === 'personal').map((s) => s.name + ':' + s.definitions.map((d) => d.client).join('+')).sort().join(' ')
    const calcDef = row('calc')?.definitions[0]
    out.calcEnv = calcDef?.env.map((v) => v.key + '=' + (v.secret ? 'secreto' : v.ref ? '$' + v.ref : v.value)).join(',')
    out.sentryRef = row('sentry')?.definitions[0]?.headers[0]?.ref
    out.docsRef = row('docs')?.definitions[0]?.env[0]?.ref

    const cp = (name, from, to, scope = 'personal') => api.mcp.copy({ client: from, scope, name }, { client: to, scope }, scope === 'project' ? repo : undefined)
    const plan = (await api.mcp.plan({ client: 'claude', scope: 'personal', name: 'calc' }, { client: 'codex', scope: 'personal' })).data
    out.plan = plan
    const toCodex = await cp('calc', 'claude', 'codex')
    out.toCodex = toCodex.ok ? toCodex.data.backup ?? 'sin copia' : toCodex.error
    const toOc = await cp('calc', 'claude', 'opencode')
    out.toOc = toOc.ok || toOc.error
    const toClaude = await cp('sentry', 'opencode', 'claude')
    out.toClaude = toClaude.ok || toClaude.error
    const toGemini = await cp('docs', 'codex', 'gemini')
    out.toGemini = toGemini.ok || toGemini.error
    const remotoCodex = await cp('remoto', 'claude', 'codex')
    out.remotoCodex = remotoCodex.ok ? remotoCodex.data.needsEnv.join() : remotoCodex.error
    const again = await cp('calc', 'claude', 'claude')
    out.again = again.ok ? 'copió' : again.error
    const proj = (await api.mcp.list(repo)).data
    out.repoRow = proj.servers.find((s) => s.name === 'del-repo' && s.scope === 'project')?.definitions.map((d) => d.client).sort().join('+')
    const toRepoGemini = await cp('del-repo', 'claude', 'gemini', 'project')
    out.toRepoGemini = toRepoGemini.ok || toRepoGemini.error

    // A la app: los agentes por API lo usan.
    const toApp = await cp('calc', 'claude', 'app')
    out.toApp = toApp.ok || toApp.error
    const cfg1 = (await api.config.get()).data
    out.appSpec = cfg1.mcpServers?.calc
    const tested = await api.mcp.test('calc')
    out.tested = tested.ok ? tested.data.tools.map((t) => t.name + (t.readOnly ? '(lectura)' : '')).join(',') : tested.error
    await api.mcp.add({ name: 'roto', target: 'no-existe-este-comando-mcp --x', envVars: [] })

    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-mcp', name: 'Repo mcp', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(500)
    const cfg = async () => (await api.config.get()).data
    const s1 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-mcp', agentMode: true, permissionMode: 'acceptEdits', includeContext: false })
    const r1 = await engine.sendTurn(s1, 'suma 2 y 3 con la calculadora', await cfg())
    const t1 = engine.peekChat(s1)?.turns.at(-1)
    out.sumStatus = r1.run?.status ?? r1.error
    out.sumAnswer = t1?.content
    out.sumSteps = (t1?.steps ?? []).map((st) => (st.tool ?? st.kind) + ':' + st.status + (st.approval ? ':' + st.approval : '')).join(' | ')
    out.rotoNote = (t1?.steps ?? []).some((st) => st.kind === 'note' && (st.detail ?? '').includes('roto'))

    // Una que cambia algo espera tu permiso.
    const s2 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-mcp', agentMode: true, permissionMode: 'acceptEdits', includeContext: false })
    const p2 = engine.sendTurn(s2, 'borra la memoria', await cfg())
    const pend = await until(() => engine.peekChat(s2)?.turns.at(-1)?.steps?.find((st) => st.approval === 'pending'))
    out.borrarPending = pend?.tool
    if (pend) engine.approveStep(engine.peekChat(s2).runningRunId, pend.id, true)
    const r2 = await p2
    out.borrarAnswer = engine.peekChat(s2)?.turns.at(-1)?.content
    out.borrarStatus = r2.run?.status ?? r2.error

    // En «Sólo plan» sólo se ofrecen las de lectura.
    const s3 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-mcp', agentMode: true, permissionMode: 'plan', includeContext: false })
    await engine.sendTurn(s3, 'dime si tienes token', await cfg())
    out.tokenAnswer = engine.peekChat(s3)?.turns.at(-1)?.content

    // Por la interfaz: Agentes › MCP › Copiar calc a Gemini CLI.
    btn('Agentes')?.click()
    await until(() => btn('MCP'))
    btn('MCP').click()
    const cell = await until(() => document.querySelector('[data-mcp="calc"] [data-client="gemini"]'))
    if (!cell) return { ...out, error: 'no sale la fila de calc' }
    btn('Copiar', cell)?.click()
    const modal = await until(() => {
      const m = document.querySelector('div.fixed.inset-0')
      return m && m.textContent.includes('CALC_TOKEN') && btn('Añadirlo', m) ? m : null
    })
    out.modalSnippet = modal ? modal.querySelector('pre')?.textContent : null
    out.modalLeak = modal ? modal.textContent.includes('ghp_') : null
    if (modal) btn('Añadirlo', modal).click()
    out.uiDone = Boolean(await until(() => document.querySelector('[data-mcp="calc"] [data-client="gemini"]') && !btn('Copiar', document.querySelector('[data-mcp="calc"] [data-client="gemini"]'))))

    out.ids = [s1, s2, s3]
    return out
  })()`)
  const reqs = mockD1.requests ?? []
  const planToolsOf = (text) => {
    const r = reqs.find((b) => (b.messages ?? []).some((m) => m.role === 'user' && String(m.content).includes(text)))
    return (r?.tools ?? []).map((t) => t.function?.name)
  }
  const planTools = planToolsOf('dime si tienes token')
  const toml = require('smol-toml')
  let codexDoc = null
  try {
    codexDoc = toml.parse(fs.readFileSync(codexToml, 'utf8'))
  } catch {}
  const ocText = fs.readFileSync(ocFile, 'utf8')
  const claudeDoc = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, '.claude.json'), 'utf8'))
  const geminiFile = path.join(GEMINI_HOME, '.gemini', 'settings.json')
  const geminiDoc = fs.existsSync(geminiFile) ? JSON.parse(fs.readFileSync(geminiFile, 'utf8')) : {}
  const everything = [fs.readFileSync(codexToml, 'utf8'), ocText, JSON.stringify(geminiDoc), JSON.stringify(d1.appSpec ?? {}), JSON.stringify(d1.plan ?? {})].join('\n')

  log(
    !d1.leak && d1.rows === 'calc:claude docs:codex remoto:claude sentry:opencode' && d1.calcEnv === 'CALC_TOKEN=secreto,LOG_LEVEL=debug' && d1.sentryRef === 'SENTRY_TOKEN' && d1.docsRef === 'DOCS_KEY',
    'EL CENTRO DE MCP LEE LOS SERVIDORES DE CADA CLI SIN SACAR SUS SECRETOS',
    d1.error ?? `${d1.rows} · ${d1.calcEnv}`
  )
  log(
    d1.plan?.snippet?.includes('env_vars = ["CALC_TOKEN"]') && d1.plan.snippet.includes('LOG_LEVEL = "debug"') && d1.plan.needsEnv?.includes('CALC_TOKEN') && !everything.includes(GH) && !everything.includes(SK),
    'AL COPIAR, UN SECRETO PASA A UNA VARIABLE DE ENTORNO Y SU VALOR NO SE COPIA',
    (d1.plan?.warnings ?? []).join(' ').slice(0, 140)
  )
  log(
    codexDoc?.model === 'gpt-5' && codexDoc?.mcp_servers?.calc?.command === 'node' && codexDoc?.mcp_servers?.docs && fs.readFileSync(codexToml, 'utf8').startsWith('# mi configuración') &&
      typeof d1.toCodex === 'string' && fs.existsSync(d1.toCodex),
    'CODEX: LA TABLA SE AÑADE AL TOML SIN TOCAR LO DEMÁS, CON COPIA DE SEGURIDAD',
    d1.toCodex
  )
  log(
    ocText.includes('// mis servidores') && ocText.includes('"CALC_TOKEN": "{env:CALC_TOKEN}"') && /"command": \[\s*"node"/.test(ocText),
    'OPENCODE: SE AÑADE CON SU SINTAXIS ({env:VAR}) Y SE CONSERVAN LOS COMENTARIOS'
  )
  log(
    claudeDoc.numStartups === 5 && claudeDoc.mcpServers?.sentry?.headers?.Authorization === 'Bearer ${SENTRY_TOKEN}' && claudeDoc.mcpServers.sentry.type === 'http',
    'Claude Code: la referencia de OpenCode pasa a ${VAR} y el resto de .claude.json se queda igual'
  )
  log(geminiDoc.mcpServers?.docs?.env?.DOCS_KEY === '${DOCS_KEY}' && geminiDoc.mcpServers.docs.command === 'npx', 'Gemini CLI: el fichero se crea con el servidor')
  log(d1.remotoCodex === 'REMOTO_TOKEN' && codexDoc?.mcp_servers?.remoto?.bearer_token_env_var === 'REMOTO_TOKEN', 'una cabecera con token pasa a bearer_token_env_var en Codex', String(d1.remotoCodex))
  log(typeof d1.again === 'string' && d1.again.includes('Ya hay'), 'copiar no pisa uno que ya existe', d1.again)
  log(
    d1.repoRow === 'claude+copilot' && d1.toRepoGemini === true && fs.existsSync(path.join(REPO, '.gemini', 'settings.json')),
    'los del proyecto: .mcp.json cuenta para Claude Code y Copilot, y se copian al repositorio',
    d1.repoRow
  )
  log(
    d1.toApp === true && d1.appSpec?.env?.CALC_TOKEN === '${CALC_TOKEN}' && d1.tested === 'sumar(lectura),borrar,token(lectura)',
    'UN SERVIDOR PASA A LA APP Y ARRANCA CON SUS HERRAMIENTAS',
    String(d1.tested)
  )
  log(
    d1.sumStatus === 'ok' && d1.sumAnswer?.includes('5') && /mcp__calc__sumar:ok/.test(d1.sumSteps ?? '') && !/sumar:[a-z]+:pending/.test(d1.sumSteps ?? ''),
    'UN AGENTE POR API USA UNA HERRAMIENTA MCP DE LECTURA SIN PEDIR PERMISO',
    `${d1.sumAnswer} · ${d1.sumSteps}`
  )
  log(d1.rotoNote === true && d1.sumStatus === 'ok', 'un servidor que no arranca se apunta en la actividad y el agente sigue')
  log(d1.borrarPending === 'mcp__calc__borrar' && d1.borrarStatus === 'ok' && d1.borrarAnswer?.includes('memoria borrada'), 'UNA HERRAMIENTA MCP QUE CAMBIA ALGO ESPERA TU PERMISO', String(d1.borrarAnswer))
  log(
    planTools.includes('mcp__calc__token') && !planTools.includes('mcp__calc__borrar') && d1.tokenAnswer?.includes('token ok'),
    'en «Sólo plan» sólo se ofrecen las de lectura, y el servidor recibe su variable de entorno',
    String(d1.tokenAnswer)
  )
  log(d1.modalSnippet?.includes('${CALC_TOKEN}') && d1.modalLeak === false && d1.uiDone, 'COPIAR DESDE LA INTERFAZ ENSEÑA LO QUE SE AÑADE Y LO AÑADE', d1.error ?? '')
  const geminiAfter = fs.existsSync(geminiFile) ? JSON.parse(fs.readFileSync(geminiFile, 'utf8')) : {}
  log(geminiAfter.mcpServers?.calc?.env?.CALC_TOKEN === '${CALC_TOKEN}', 'y queda en settings.json de Gemini CLI')
  await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    await api.providers.setBaseUrl('vllm', ${JSON.stringify(d1.prevBase ?? '')})
    for (const id of ${JSON.stringify(d1.ids ?? [])}) await engine.deleteSession(id)
    await api.mcp.remove('calc')
    await api.mcp.remove('roto')
    await api.projects.remove('proyecto-mcp')
  })()`)
  mockD1.close()
  for (const [k, v] of Object.entries(envBefore)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  git(['reset', '-q', '--hard', headB2])
  git(['clean', '-qfd'])

  /* -------------------------------------------------------------- *
   * C2 · Recomendador de IA                                         *
   * -------------------------------------------------------------- */
  // Un Ollama de mentira: dice su ventana y clasifica siempre como código trivial.
  const OLLAMA_PORT = API_PORT + 1
  const ollamaReqs = []
  const ollamaMock = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        let parsed = {}
        try {
          parsed = JSON.parse(body || '{}')
        } catch {}
        const json = (o) => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(o))
        }
        if (req.url.startsWith('/api/show')) return json({ model_info: { 'llama.context_length': 8192 }, capabilities: ['completion'] })
        if (req.url.startsWith('/api/tags')) return json({ models: [{ name: 'mini:1b', model: 'mini:1b', size: 900000000, details: { parameter_size: '1B' } }] })
        if (req.url.startsWith('/api/chat')) {
          ollamaReqs.push(parsed)
          return json({ message: { role: 'assistant', content: JSON.stringify({ category: 'code', difficulty: 1, needsTools: false, needsVision: false }) }, done: true })
        }
        if (req.url.startsWith('/api/version')) return json({ version: '0.12.0' })
        json({})
      })
    })
    server.listen(OLLAMA_PORT, '127.0.0.1', () => resolve(server))
  })
  const c2 = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    const setValue = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const out = {}

    // La lógica, con modelos sintéticos.
    btn('Modelos')?.click()
    const R = await until(() => window.__accRecommend)
    if (!R) return { error: 'no carga el recomendador' }
    const hello = R.classifyByRules('escribe un hola mundo en python')
    const hard = R.classifyByRules('Diseña la arquitectura de un sistema distribuido de pagos para producción: alta concurrencia, seguridad, migración de datos legacy y escalabilidad. ' + 'Detalla cada servicio. '.repeat(40))
    const proj = R.classifyByRules('arregla los tests que fallan', { project: true })
    const refactor = R.classifyByRules('Refactoriza el módulo de pagos para que soporte reembolsos parciales, con pruebas')
    out.rules = [hello.category, hello.difficulty, hard.difficulty, proj.category, proj.needsTools, refactor.category, refactor.difficulty].join(',')
    const m = (id, pi, po, intel, coding, extra = {}) => ({ id, providerId: 'x', name: id, source: 'provider', priceIn: pi, priceOut: po, caps: { tools: true }, bench: intel == null ? undefined : { intelligence: intel, coding }, ...extra })
    const models = [
      m('barato', 0.1, 0.4, 30, 25),
      m('medio', 1, 4, 55, 50),
      m('caro', 15, 75, 70, 68),
      m('sin-nota', 0.05, 0.1),
      m('sin-herramientas', 2, 8, 45, 45, { caps: {} }),
      { id: 'qwen3:8b', providerId: 'ollama', name: 'qwen3', source: 'local', local: true, sizeBytes: 5e9 },
      { id: 'text-embedding-3-small', providerId: 'x', name: 'emb', source: 'provider', priceIn: 0.02, priceOut: 0, bench: { intelligence: 99 } }
    ]
    const usage = [{ key: 'x:medio', providerId: 'x', model: 'medio', runs: 3, tokensIn: 0, tokensOut: 0, cost: 0, avgTtft: 500, avgTps: 50, avgMs: 0, errors: 0, lastAt: Date.now(), elo: 1540 }]
    // El listón sale del mercado: aquí, tres modelos con 25, 50 y 68 en código.
    const market = models.slice(0, 3)
    const r1 = R.recommend(hello, models, usage, market, {})
    out.easy = [r1.sufficient?.model.id, r1.best?.model.id, r1.local?.model.id, r1.unrated].join(',')
    const codeHard = { ...R.classifyByRules('refactoriza este código de producción con concurrencia'), difficulty: 5 }
    const est = R.estimateTokens('refactoriza', codeHard)
    const r5 = R.recommend({ ...codeHard, ...est }, models, usage, market, {})
    out.hard = [r5.threshold, r5.sufficient?.model.id, r5.balanced?.model.id, r5.best?.model.id, r5.local ? 'local' : 'sin-local'].join(',')
    out.measured = r5.sufficient?.seconds > 0 && r5.sufficient?.elo === 1540
    const tools = R.recommend(proj, models, usage, market, {})
    out.tools = tools.excluded.tools
    const allBad = R.recommend({ ...codeHard, ...est }, [m('flojo', 0.1, 0.1, 10, 8)], [], market, {})
    out.belowBar = allBad.belowBar && allBad.sufficient?.model.id === 'flojo'
    const subs = R.recommend(hello, models, [], market, {
      cliAgents: [{ id: 'cc', name: 'Claude Code', type: 'cli', command: 'claude', args: [], parser: 'plain', color: '#fff', createdAt: 0 }],
      quotas: [{ id: 'claude.five_hour', provider: 'Claude', providerKey: 'claude', label: 'Ventana de 5 h', kind: 'window', unit: 'percent', usedPct: 40, origin: 'official', how: '', updatedAt: 0, agents: ['claude'] }]
    })
    out.subs = subs.subscriptions.map((s) => s.agent.id + ':' + s.leftPct).join()

    // Clasificar con un modelo local: JSON con esquema y la ventana entera.
    out.prevOllama = (await api.config.get()).data.providers['ollama']?.baseUrl ?? ''
    await api.providers.setBaseUrl('ollama', 'http://127.0.0.1:${OLLAMA_PORT}')
    const cls = await api.recommend.classify('escribe un hola mundo', 'mini:1b')
    out.cls = cls.ok ? [cls.data.category, cls.data.difficulty].join(',') : cls.error

    // Por la interfaz: desde la Consola, «¿Qué modelo?» y usar el local.
    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await sleep(400)
    btn('Disponibles')?.click()
    btn('Refrescar')?.click()
    await until(() => document.body.textContent.includes('agente-de-prueba'), 10000)
    const sid = await engine.newSession('chat', { providerId: 'x', model: 'no-existe' })
    engine.focusChat(sid)
    const input = await until(() => [...document.querySelectorAll('textarea')].find((x) => x.offsetParent && x.closest('main')))
    if (input) {
      setValue(input, 'escribe un hola mundo en python')
      await sleep(100)
    }
    const open = await until(() => btn('¿Qué modelo?'))
    open?.click()
    const modal = await until(() => document.querySelector('div.fixed.inset-0 textarea') ? document.querySelector('div.fixed.inset-0') : null)
    if (!modal) return { ...out, error: 'no se abre el recomendador' }
    out.prefilled = modal.querySelector('textarea').value
    out.classifier = (await until(() => modal.querySelector('[data-classifier="local"]'), 6000)) ? 'local' : modal.querySelector('[data-classifier]')?.getAttribute('data-classifier')
    const localPick = await until(() => modal.querySelector('[data-pick="local"]'))
    out.localText = localPick?.textContent ?? ''
    if (localPick) btn('Usar', localPick)?.click()
    await sleep(300)
    const st = engine.peekChat(sid)?.session
    out.used = st ? st.providerId + ':' + st.model : null
    out.sid = sid
    return out
  })()`)
  const chatReq = ollamaReqs[ollamaReqs.length - 1]
  log(c2.rules === 'code,1,5,agentic,true,code,3', 'LAS REGLAS CLASIFICAN TIPO Y DIFICULTAD', c2.error ?? c2.rules)
  log(c2.easy === 'barato,caro,qwen3:8b,1', 'PARA UN HOLA MUNDO, LA SUFICIENTE ES LA MÁS BARATA (Y SE OFRECE LA LOCAL)', c2.easy)
  log(c2.hard === '50,medio,medio,caro,sin-local', 'PARA ALGO DIFÍCIL SUBE EL LISTÓN: LA MÁS BARATA QUE LLEGA', c2.hard)
  log(c2.measured === true, 'el tiempo sale de tu velocidad medida y se enseña tu Elo')
  log(c2.tools === 2 && c2.belowBar === true, 'sin herramientas no entra en un trabajo de proyecto; si ninguno llega, se dice')
  log(c2.subs === 'cc:60', 'tus suscripciones salen con lo que les queda del cupo', c2.subs)
  log(
    c2.cls === 'code,1' && chatReq?.options?.num_ctx === 8192 && chatReq?.format?.properties?.difficulty && chatReq?.stream === false,
    'UN MODELO LOCAL CLASIFICA LA TAREA CON ESQUEMA Y SU VENTANA ENTERA',
    `${c2.cls} · num_ctx ${chatReq?.options?.num_ctx}`
  )
  log(
    c2.prefilled === 'escribe un hola mundo en python' && ['vllm', 'ollama'].includes(c2.used?.split(':')[0]) && c2.localText.includes(c2.used.split(':').slice(1).join(':')),
    'DESDE LA CONSOLA, «¿QUÉ MODELO?» RECOMIENDA Y «USAR» CAMBIA EL DE LA CONVERSACIÓN',
    c2.error ?? `${c2.used} · ${c2.classifier}`
  )
  log(c2.classifier === 'local', 'en la interfaz la afina el modelo local al dejar de escribir', String(c2.classifier))
  await js(`(async () => {
    const api = window.api
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await api.providers.setBaseUrl('vllm', ${JSON.stringify(c2.prevBase ?? '')})
    await api.providers.setBaseUrl('ollama', ${JSON.stringify(c2.prevOllama ?? '')})
    if (${JSON.stringify(c2.sid ?? '')}) await window.__accEngine.deleteSession(${JSON.stringify(c2.sid ?? '')})
  })()`)
  ollamaMock.close()

  /* -------------------------------------------------------------- *
   * B6 · «Necesita tu respuesta»: el hook de Claude Code y los      *
   * permisos denegados en la Consola                                *
   * -------------------------------------------------------------- */
  const claudeSettings = path.join(CLAUDE_DIR, 'settings.json')
  const settingsBefore = fs.existsSync(claudeSettings) ? fs.readFileSync(claudeSettings, 'utf8') : null
  fs.mkdirSync(CLAUDE_DIR, { recursive: true })
  fs.writeFileSync(
    claudeSettings,
    JSON.stringify(
      {
        model: 'opus',
        hooks: {
          Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'echo mio' }] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }]
        }
      },
      null,
      2
    )
  )
  // Un Claude Code falso al que le faltan permisos, en su propia carpeta (tiene que llamarse claude).
  const permDir = path.join(FIXTURES, 'perm')
  fs.mkdirSync(permDir, { recursive: true })
  fs.writeFileSync(
    path.join(permDir, 'perm.js'),
    [
      "const fs = require('node:fs')",
      "const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')",
      'const args = process.argv.slice(2)',
      "const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : ''",
      "const s = args.indexOf('--settings')",
      "let prompt = ''",
      // Como el de verdad: con --input-format stream-json el turno empieza con el primer mensaje.
      "const streaming = args.includes('--input-format')",
      'let started = false',
      "process.stdin.on('data', (c) => { prompt += c; if (streaming && !started && prompt.includes(String.fromCharCode(10))) { started = true; turn() } })",
      "process.stdin.on('end', () => { if (!streaming) turn(); else process.exit(0) })",
      'function turn() {',
      "  const sid = resumed || 'perm-' + Math.random().toString(16).slice(2, 8)",
      "  out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-falso', cwd: process.cwd() })",
      '  if (s !== -1) {',
      "    const allow = JSON.parse(fs.readFileSync(args[s + 1], 'utf8')).permissions.allow",
      "    const text = 'permitido: ' + JSON.stringify(allow) + ' resume=' + resumed",
      "    out({ type: 'assistant', session_id: sid, message: { model: 'claude-falso', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } } })",
      "    out({ type: 'result', session_id: sid, total_cost_usd: 0, duration_ms: 5, num_turns: 1, result: text })",
      '    return',
      '  }',
      "  out({ type: 'assistant', session_id: sid, message: { model: 'claude-falso', content: [{ type: 'text', text: 'No he podido.' }], usage: { input_tokens: 10, output_tokens: 5 } } })",
      "  out({ type: 'result', session_id: sid, total_cost_usd: 0, duration_ms: 5, num_turns: 1, result: 'No he podido.',",
      "    permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'npm test' } }, { tool_name: 'Write', tool_input: { file_path: process.cwd() + '/nuevo.txt' } }] })",
      '}'
    ].join('\n')
  )
  const permBin = (() => {
    const target = path.join(permDir, 'perm.js')
    if (process.platform === 'win32') {
      const f = path.join(permDir, 'claude.cmd')
      fs.writeFileSync(f, `@node "${target}" %*\r\n`)
      return f
    }
    const f = path.join(permDir, 'claude')
    fs.writeFileSync(f, `#!/bin/sh\nexec node "${target}" "$@"\n`)
    fs.chmodSync(f, 0o755)
    return f
  })()
  const transcript = path.join(TMP, 'transcripcion-ses.jsonl')
  fs.writeFileSync(transcript, '{"type":"user"}\n')

  const b6a = await js(`(async () => {
    const api = window.api
    const before = (await api.attention.hook()).data
    const inst = await api.attention.install()
    const again = await api.attention.install()
    return { before, inst: inst.data, again: again.data, err: inst.error }
  })()`)
  const afterInstall = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'))
  const notif = afterInstall.hooks?.Notification ?? []
  const ourHook = notif.flatMap((g) => g.hooks ?? []).find((h) => String(h.command).includes('acc-notify'))
  log(
    b6a.before?.installed === false && b6a.inst?.installed === true && notif.length === 2 && notif[0].hooks[0].command === 'echo mio' &&
      afterInstall.hooks.PreToolUse?.[0]?.hooks?.[0]?.command === 'echo pre' && afterInstall.model === 'opus' &&
      notif.filter((g) => g.hooks.some((h) => String(h.command).includes('acc-notify'))).length === 1,
    'EL HOOK DE AVISOS SE AÑADE AL LADO DE LOS TUYOS, SIN TOCARLOS (Y SÓLO UNA VEZ)',
    b6a.err ?? JSON.stringify(notif).slice(0, 160)
  )
  log(
    fs.readdirSync(path.join(app.getPath('userData'), 'data', 'claude-notify')).some((f) => f.startsWith('settings.backup-')),
    'antes de escribir en settings.json se guarda una copia'
  )

  // Claude Code avisa: se ejecuta el script del hook con lo que mandaría por stdin.
  const scriptPath = /"([^"]+)"/.exec(ourHook?.command ?? '')?.[1]
  const payload = JSON.stringify({
    session_id: 'ses-terminal', transcript_path: transcript, cwd: REPO, hook_event_name: 'Notification',
    message: 'Claude needs your permission to use Bash', title: 'Claude Code', notification_type: 'permission_prompt'
  })
  let hookRan = false
  try {
    execFileSync('sh', [scriptPath], { input: payload })
    hookRan = true
  } catch {}
  const b6b = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    await api.projects.save({ id: 'proyecto-aviso', name: 'Repo aviso', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(400)
    const out = {}
    out.listed = Boolean(await until(() => engine.peekAttention().find((a) => a.id === 'ses-terminal')))
    btn('Tareas')?.click()
    const card = await until(() => document.querySelector('[data-column="attention"] [data-task="term:ses-terminal"]'))
    out.cardText = card?.textContent ?? ''
    const navBtn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Tareas') && x.closest('.border-r'))
    out.badge = navBtn?.textContent.trim().replace('Tareas', '')
    out.attn = document.querySelectorAll('[data-column="attention"] [data-task]').length
    return out
  })()`)
  // Le contestas en la terminal y Claude sigue: su transcripción avanza.
  await new Promise((r) => setTimeout(r, 2200))
  fs.appendFileSync(transcript, '{"type":"assistant"}\n')
  const b6c = await js(`(async () => {
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150) } return null }
    const gone = await until(() => !window.__accEngine.peekAttention().some((a) => a.id === 'ses-terminal') && !document.querySelector('[data-task="term:ses-terminal"]'))
    const off = await window.api.attention.uninstall()
    return { gone: Boolean(gone), off: off.data }
  })()`)
  const afterOff = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'))
  log(hookRan && b6b.listed && b6b.cardText.includes('Claude needs your permission to use Bash') && b6b.cardText.includes('Repo aviso'), 'UN AVISO DE CLAUDE CODE EN LA TERMINAL SALE EN «NECESITA TU RESPUESTA»', b6b.cardText.slice(0, 120))
  log(Number(b6b.badge) === b6b.attn && b6b.attn >= 1, 'y cuenta en la insignia del menú', `insignia ${b6b.badge}, columna ${b6b.attn}`)
  log(b6c.gone, 'CUANDO CLAUDE SIGUE TRABAJANDO, EL AVISO SE QUITA SOLO')
  log(
    b6c.off?.installed === false && JSON.stringify(afterOff.hooks?.Notification) === JSON.stringify([{ matcher: '', hooks: [{ type: 'command', command: 'echo mio' }] }]) &&
      afterOff.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command === 'echo pre',
    'AL DESACTIVARLO SE QUITA SÓLO EL HOOK DE LA APP',
    JSON.stringify(afterOff.hooks ?? {}).slice(0, 140)
  )

  // En la Consola: lo que le faltó sale como aviso y se le puede dar para seguir.
  const b6d = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    await api.agents.saveCli({ id: 'perm', name: 'Claude falso', type: 'cli', command: ${JSON.stringify(permBin)}, args: ['-p', '--output-format', 'stream-json', '--verbose'], parser: 'claude-stream-json', color: '#fff', createdAt: Date.now() })
    await sleep(400)
    const sid = await engine.newSession('cli', { cliAgentId: 'perm', projectId: 'proyecto-aviso', permissionMode: 'acceptEdits' })
    await engine.sendTurn(sid, 'pasa los tests', (await api.config.get()).data)
    const first = engine.peekChat(sid).turns.at(-1)
    const out = { rules: (first.steps ?? []).filter((s) => s.denied).map((s) => s.rule).join(' | ') }
    engine.focusChat(sid)
    const box = await until(() => document.querySelector('[data-denied]'))
    out.box = box?.textContent ?? ''
    btn('Permitir eso y seguir', box ?? document)?.click()
    await until(() => { const c = engine.peekChat(sid); return c && c.turns.length >= 4 && !c.runningRunId }, 10000)
    out.answer = engine.peekChat(sid).turns.at(-1)?.content ?? ''
    out.sessionCli = engine.peekChat(sid).session.cliSessionId
    out.permissionMode = engine.peekChat(sid).session.permissionMode
    await engine.deleteSession(sid)
    await api.agents.removeCli('perm')
    await api.projects.remove('proyecto-aviso')
    return out
  })()`)
  const cliSettingsDir = path.join(app.getPath('userData'), 'data', 'cli-settings')
  log(b6d.rules === 'Bash(npm test) | Edit(nuevo.txt)', 'CADA PERMISO DENEGADO LLEVA LA REGLA EXACTA QUE LO HABRÍA DEJADO', b6d.rules)
  log(b6d.box.includes('Le faltó permiso para') && b6d.box.includes('npm test'), 'en la Consola sale como aviso en el turno', b6d.box.slice(0, 100))
  log(
    b6d.answer.startsWith('permitido: ["Bash(npm test)","Edit(nuevo.txt)"]') && b6d.answer.includes('resume=perm-') && b6d.permissionMode === 'acceptEdits',
    '«PERMITIR ESO Y SEGUIR» RETOMA LA SESIÓN CON PERMISO SÓLO PARA ESO',
    b6d.answer.slice(0, 120)
  )
  log(!fs.existsSync(cliSettingsDir) || fs.readdirSync(cliSettingsDir).length === 0, 'el fichero de permisos de esa ejecución se borra al acabar')
  if (settingsBefore === null) fs.rmSync(claudeSettings, { force: true })
  else fs.writeFileSync(claudeSettings, settingsBefore)

  /* -------------------------------------------------------------- *
   * C4 · Baterías de prompts  ·  C5 · Juez local                    *
   * -------------------------------------------------------------- */
  const batFixture = (name, json, math) => {
    const file = path.join(FIXTURES, name + '.js')
    fs.writeFileSync(
      file,
      `let p = ''\nprocess.stdin.on('data', (c) => (p += c))\nprocess.stdin.on('end', () => process.stdout.write(p.includes('JSON') ? ${JSON.stringify(json)} : ${JSON.stringify(math)}))\n`
    )
    return makeBin(name, name + '.js')
  }
  const binBien = batFixture('bat-bien', '{"saludo":"hola"}', 'El resultado es 4.')
  const binMal = batFixture('bat-mal', 'hola, pero sin json', 'No lo sé: error.')
  const JUDGE_PORT = API_PORT + 2
  const judgeReqs = []
  const judgeMock = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        let parsed = {}
        try {
          parsed = JSON.parse(body || '{}')
        } catch {}
        res.writeHead(200, { 'content-type': 'application/json' })
        if (req.url.startsWith('/api/show')) return res.end(JSON.stringify({ model_info: { 'qwen.context_length': 4096 }, capabilities: ['completion'] }))
        if (req.url.startsWith('/api/chat')) {
          judgeReqs.push(parsed)
          const user = String(parsed.messages?.find((m) => m.role === 'user')?.content ?? '')
          const good = user.includes('Respuesta que juzgas:\nEl resultado es 4')
          return res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify({ score: good ? 8 : 2, reason: good ? 'Dice que es 4.' : 'No responde.' }) }, done: true }))
        }
        res.end('{}')
      })
    })
    server.listen(JUDGE_PORT, '127.0.0.1', () => resolve(server))
  })
  const c4 = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    const out = {}
    out.prevOllama = (await api.config.get()).data.providers['ollama']?.baseUrl ?? ''
    await api.providers.setBaseUrl('ollama', 'http://127.0.0.1:${JUDGE_PORT}')
    await api.agents.saveCli({ id: 'bat-bien', name: 'Bien', type: 'cli', command: ${JSON.stringify(binBien)}, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'bat-mal', name: 'Mal', type: 'cli', command: ${JSON.stringify(binMal)}, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    await api.batteries.save({
      id: 'bat-1', name: 'Formato', createdAt: Date.now(), judgeModel: 'juez:1b',
      cases: [
        { id: 'c1', prompt: 'saluda en JSON', checks: [{ id: 'k1', kind: 'json' }, { id: 'k2', kind: 'contains', value: 'hola' }] },
        { id: 'c2', prompt: 'cuánto es 2+2', checks: [
          { id: 'k3', kind: 'regex', value: '\\\\b4\\\\b' }, { id: 'k4', kind: 'not_contains', value: 'error' },
          { id: 'k5', kind: 'judge', value: 'La respuesta dice que 2+2 es 4', min: 6 }
        ] }
      ]
    })
    await sleep(500)
    const direct = await api.batteries.judge('juez:1b', { rubric: 'dice 4', prompt: '2+2', response: 'El resultado es 4.' })
    out.direct = direct.ok ? direct.data.score + ':' + direct.data.reason : direct.error

    btn('Arena')?.click()
    await until(() => btn('Baterías'))
    engine.setArena({ project: undefined, testCommand: '', prompt: '', contenders: [
      { ...engine.emptyContender('cli'), cliAgentId: 'bat-bien' },
      { ...engine.emptyContender('cli'), cliAgentId: 'bat-mal' }
    ] })
    btn('Baterías').click()
    const panel = await until(() => document.querySelector('[data-batteries]'))
    const go = await until(() => { const b = btn('Pasar la batería', panel); return b && !b.disabled ? b : null })
    if (!go) return { ...out, error: 'no se puede pasar la batería' }
    go.click()
    const runs = await until(async () => { const r = await api.batteries.runs('bat-1'); return r.data?.length ? r.data : null }, 40000)
    out.run = runs?.[0] ?? null
    await sleep(400)
    out.totals = [...document.querySelectorAll('[data-total]')].map((x) => x.textContent.trim())
    out.cells = document.querySelectorAll('[data-cell]').length
    return out
  })()`)
  const judgeReq = judgeReqs.find((r) => r.format?.properties?.score)
  const byLabel = (label) => c4.run?.contenders.find((c) => c.label === label)?.key
  const cellOf = (caseId, label) => c4.run?.cells.find((c) => c.caseId === caseId && c.contender === byLabel(label))
  const bien2 = cellOf('c2', 'Bien')
  const mal1 = cellOf('c1', 'Mal')
  log(c4.direct === '8:Dice que es 4.' && judgeReq?.options?.num_ctx === 4096 && judgeReq?.stream === false, 'EL JUEZ LOCAL PUNTÚA CON RÚBRICA, ESQUEMA Y SU VENTANA ENTERA', String(c4.direct))
  log(
    Boolean(c4.run) && c4.run.cells.length === 4 && cellOf('c1', 'Bien')?.ok && bien2?.ok && !mal1?.ok && !cellOf('c2', 'Mal')?.ok,
    'UNA BATERÍA PASA CADA CASO A LOS CONTENDIENTES Y COMPRUEBA LAS RESPUESTAS',
    c4.error ?? c4.run?.cells.map((c) => c.ok).join(',')
  )
  log(
    mal1?.checks.map((c) => c.kind + ':' + c.pass).join(',') === 'json:false,contains:true' &&
      cellOf('c2', 'Mal')?.checks.map((c) => c.kind + ':' + c.pass).join(',') === 'regex:false,not_contains:false,judge:false',
    'cada comprobación dice si pasa: JSON, contiene, expresión regular, no contiene y juez',
    mal1?.checks.map((c) => c.detail).join(' | ')
  )
  log(
    bien2?.checks.find((c) => c.kind === 'judge')?.score === 8 && c4.run?.judgeModel === 'juez:1b',
    'la nota del juez se guarda con el juez que la dio'
  )
  log(
    c4.cells === 4 && c4.totals.length === 2 && c4.totals.some((x) => x.includes('2/2') && x.includes('100 %')) && c4.totals.some((x) => x.includes('0/2')),
    'LA MATRIZ ENSEÑA CADA CASILLA Y EL TOTAL DE CADA CONTENDIENTE',
    c4.totals.join(' | ')
  )
  await js(`(async () => {
    const api = window.api
    await api.providers.setBaseUrl('ollama', ${JSON.stringify(c4.prevOllama ?? '')})
    for (const r of (await api.batteries.runs('bat-1')).data ?? []) await api.batteries.removeRun(r.id)
    await api.batteries.remove('bat-1')
    await api.agents.removeCli('bat-bien')
    await api.agents.removeCli('bat-mal')
    window.__accEngine.setArena({ prompt: '', contenders: [] })
  })()`)
  judgeMock.close()

  /* -------------------------------------------------------------- *
   * D4 · web_fetch en los agentes por API                          *
   * -------------------------------------------------------------- */
  const webLog = []
  const webServer = http.createServer((req, res) => {
    webLog.push({ path: req.url, ua: req.headers['user-agent'] ?? '' })
    const port = webServer.address().port
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/doc' || u.pathname === '/otra') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><title>Página &amp; prueba</title><style>body { color: red }</style>
<script>console.log('no debe salir')</script></head><body>
<nav><a href="/otra">otra página</a> <a href="#arriba">arriba</a></nav>
<h1>Cabecera</h1><p>Texto con &aacute;cento, &#x2713; y &amp;.</p>
<ul><li>uno</li><li>dos <b>fuerte</b></li></ul>
<img src="l.png" alt="logo"><pre>  sangría
    más</pre><p>Ver <a href="https://ejemplo.com/x">https://ejemplo.com/x</a></p>
<noscript>activa js</noscript></body></html>`)
      return
    }
    if (u.pathname === '/redir-mismo') {
      res.writeHead(302, { location: '/doc?via=mismo' })
      res.end()
      return
    }
    if (u.pathname === '/redir-otro') {
      res.writeHead(302, { location: `http://localhost:${port}/doc?desde=otro` })
      res.end()
      return
    }
    if (u.pathname === '/largo') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(Array.from({ length: 5000 }, (_, i) => 'linea ' + String(i).padStart(4, '0')).join('\n'))
      return
    }
    if (u.pathname === '/pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(Buffer.from('%PDF-1.4\n\u0000\u0001binario'))
      return
    }
    if (u.pathname === '/latin1') {
      res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' })
      res.end(Buffer.from('<p>Canción de año</p>', 'latin1'))
      return
    }
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('<title>No está</title><p>No existe</p>')
  })
  await new Promise((r) => webServer.listen(0, '127.0.0.1', r))
  const WEB = `http://127.0.0.1:${webServer.address().port}`
  const mockD4 = await startAgentMock()
  const webPrompt = (...calls) => 'web: ' + calls.map((c) => JSON.stringify(c)).join(' || ')
  const d4Prompts = {
    main: webPrompt(
      { url: WEB + '/doc' },
      { url: WEB + '/redir-mismo' },
      { url: WEB + '/redir-otro' },
      { url: WEB + '/largo' },
      { url: WEB + '/largo', offset: 20000, max_chars: 60000 },
      { url: WEB + '/pdf' },
      { url: WEB + '/404' },
      { url: WEB + '/latin1' },
      { url: 'ftp://ejemplo.com/x' }
    ),
    plan: webPrompt({ url: WEB + '/doc?plan=1' }),
    bypass: webPrompt({ url: WEB + '/otra' })
  }
  const d4 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const prompts = ${JSON.stringify(d4Prompts)}
    const out = {}
    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-web', name: 'Repo web', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(400)
    const cfg = async () => (await api.config.get()).data
    const session = (permissionMode) => engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-web', agentMode: true, permissionMode, includeContext: false })
    const stepsOf = (sid) => (engine.peekChat(sid)?.turns.at(-1)?.steps ?? []).filter((st) => st.tool === 'web_fetch')

    // «Acepta ediciones»: el primer dominio se aprueba y el resto del turno no pregunta.
    const s1 = await session('acceptEdits')
    const p1 = engine.sendTurn(s1, prompts.main, await cfg())
    const pend = await until(() => stepsOf(s1).find((st) => st.approval === 'pending'))
    out.pendingTarget = pend?.target
    engine.focusChat(s1)
    const txt = await until(() => [...document.querySelectorAll('span')].find((x) => x.textContent.includes('Quiere leer esta página'))?.textContent)
    out.pendingText = txt ?? ''
    if (pend) engine.approveStep(engine.peekChat(s1).runningRunId, pend.id, true)
    const r1 = await p1
    out.status = r1.run?.status ?? r1.error
    out.answer = engine.peekChat(s1)?.turns.at(-1)?.content
    out.steps = stepsOf(s1).map((st) => st.status + ':' + (st.approval ?? '-')).join(' ')
    out.summaries = stepsOf(s1).map((st) => st.detail ?? '').join(' | ')

    // «Sólo plan»: se ofrece, pregunta, y si dices que no, no sale nada.
    const s2 = await session('plan')
    const p2 = engine.sendTurn(s2, prompts.plan, await cfg())
    const pend2 = await until(() => stepsOf(s2).find((st) => st.approval === 'pending'))
    out.planPending = Boolean(pend2)
    if (pend2) engine.approveStep(engine.peekChat(s2).runningRunId, pend2.id, false)
    await p2
    out.planSteps = stepsOf(s2).map((st) => st.status + ':' + (st.approval ?? '-')).join(' ')

    // «Sin límites»: no pregunta.
    const s3 = await session('bypassPermissions')
    const r3 = await engine.sendTurn(s3, prompts.bypass, await cfg())
    out.bypassStatus = r3.run?.status ?? r3.error
    out.bypassSteps = stepsOf(s3).map((st) => st.status + ':' + (st.approval ?? '-')).join(' ')

    await api.providers.setBaseUrl('vllm', out.prevBase)
    for (const id of [s1, s2, s3]) await engine.deleteSession(id)
    await api.projects.remove('proyecto-web')
    return out
  })()`)
  const d4Reqs = mockD4.requests ?? []
  const lastFor = (prompt) =>
    d4Reqs
      .filter((b) => (b.messages ?? []).some((m) => m.role === 'user' && String(m.content).includes(prompt)))
      .sort((a, b) => b.messages.length - a.messages.length)[0]
  const mainReq = lastFor(d4Prompts.main)
  const webResults = (mainReq?.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content))
  const [rDoc, rMismo, rOtro, rLargo1, rLargo2, rPdf, r404, rLatin, rFtp] = webResults
  const planReq = lastFor(d4Prompts.plan)
  const planOffered = (planReq?.tools ?? []).map((t) => t.function?.name)
  const planResult = (planReq?.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content)).join(' ')
  const webPaths = webLog.map((l) => l.path)
  const webSys = String(mainReq?.messages?.[0]?.content ?? '')

  log(
    webResults.length === 9 && d4.status === 'ok' && d4.answer?.includes('Leídas 9') && d4.steps.split(' ').filter((s) => s.endsWith(':approved')).length === 1,
    'WEB_FETCH: SE APRUEBA EL DOMINIO UNA VEZ Y EL RESTO DEL TURNO NO PREGUNTA',
    `${d4.status} · ${d4.steps}`
  )
  log(d4.pendingTarget === WEB + '/doc' && d4.pendingText.includes('podrá leer más de 127.0.0.1'), 'el aviso de permiso dice qué dominio queda aprobado', d4.pendingText.slice(0, 120))
  log(
    Boolean(rDoc) && rDoc.includes('Título: Página & prueba') && rDoc.includes('# Cabecera') && rDoc.includes('Texto con ácento, ✓ y &.') && rDoc.includes('- uno') &&
      rDoc.includes(`otra página (${WEB}/otra)`) && rDoc.includes('[imagen: logo]') && rDoc.includes('```\n  sangría\n    más\n```') && rDoc.includes('Ver https://ejemplo.com/x') &&
      !rDoc.includes('no debe salir') && !rDoc.includes('color: red') && !rDoc.includes('activa js') && !rDoc.includes('#arriba'),
    'EL HTML LLEGA COMO TEXTO: SIN SCRIPTS NI ESTILOS, CON TÍTULOS, LISTAS, CÓDIGO Y ENLACES',
    (rDoc ?? '').replace(/\n/g, '⏎').slice(0, 200)
  )
  log(Boolean(rMismo) && rMismo.includes(`URL: ${WEB}/doc?via=mismo`) && rMismo.includes('# Cabecera'), 'una redirección dentro del mismo dominio se sigue', (rMismo ?? '').slice(0, 80))
  log(
    Boolean(rOtro) && rOtro.includes(`a otro dominio: http://localhost:${webServer.address().port}/doc?desde=otro`) && !webPaths.some((p) => p.includes('desde=otro')),
    'UNA REDIRECCIÓN A OTRO DOMINIO NO SE SIGUE SOLA: SE LE DICE AL AGENTE',
    (rOtro ?? '').slice(0, 120)
  )
  log(
    Boolean(rLargo1) && rLargo1.includes('caracteres 0–20000 de 54999') && rLargo1.includes('offset=20000') && Boolean(rLargo2) && rLargo2.includes('caracteres 20000–54999 de 54999. Es el final.') &&
      rLargo2.trimEnd().endsWith('linea 4999') && webPaths.filter((p) => p === '/largo').length === 1,
    'UN TEXTO LARGO LLEGA POR TROZOS CON OFFSET, SIN VOLVER A DESCARGARLO',
    `${(rLargo1 ?? '').split('\n').slice(0, 3).join(' · ')}`
  )
  log(Boolean(rPdf) && rPdf.includes('Es un PDF') && Boolean(r404) && r404.includes('Estado: 404') && d4.steps.split(' ')[5]?.startsWith('error') && d4.steps.split(' ')[6]?.startsWith('error'), 'un PDF o un 404 vuelven como error explicado', `${(rPdf ?? '').slice(-60)} · ${d4.steps}`)
  log(Boolean(rLatin) && rLatin.includes('Canción de año'), 'respeta el juego de caracteres que declara la página', (rLatin ?? '').slice(-40))
  log(Boolean(rFtp) && rFtp.includes('no es una URL http ni https') && d4.steps.split(' ')[8] === 'error:-', 'una URL que no es http(s) se rechaza sin preguntar ni conectar', rFtp)
  log(webLog.length > 0 && webLog.every((l) => l.ua.includes('AI-Command-Center')), 'se identifica como AI Command Center', webLog[0]?.ua)
  log(webSys.includes('web_fetch') && webSys.includes('No metas en la URL datos del proyecto'), 'las instrucciones del agente le explican web_fetch')
  log(
    planOffered.includes('web_fetch') && !planOffered.includes('write_file') && d4.planPending && d4.planSteps === 'error:denied' && planResult.includes('no ha permitido') && !webPaths.some((p) => p.includes('plan=1')),
    'EN «SÓLO PLAN» SE OFRECE, PREGUNTA Y, SI DICES QUE NO, NO SALE NINGUNA PETICIÓN',
    `${d4.planSteps} · ${planOffered.join(',')}`
  )
  log(d4.bypassStatus === 'ok' && d4.bypassSteps === 'ok:-' && webPaths.includes('/otra'), 'en «Sin límites» lee sin preguntar', d4.bypassSteps)
  mockD4.close()
  webServer.close()

  /* -------------------------------------------------------------- *
   * E1 · Editar y reenviar, regenerar y bifurcar                   *
   * -------------------------------------------------------------- */
  const mockE1 = await startAgentMock()
  fs.rmSync(path.join(REPO, 'app.js'), { force: true })
  const safetyRefs = () =>
    git(['for-each-ref', '--format=%(refname)', 'refs/acc/checkpoints/'])
      .split('\n')
      .filter((l) => l.includes('-antes-de-deshacer-')).length
  const safetyBefore = safetyRefs()
  const e1 = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${JSON.stringify(BINS)}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim().includes(text))
    const type = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const idle = (sid, n) => until(() => { const c = engine.peekChat(sid); return c && !c.runningRunId && c.turns.length === n && !c.turns.some((x) => x.streaming) ? c : null }, 15000)
    const out = {}
    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-e1', name: 'Repo e1', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(400)
    const cfg = async () => (await api.config.get()).data
    const ids = []

    // 1 · Editar el primer mensaje de un agente que creó un archivo, deshaciendo también el archivo.
    const s1 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-e1', agentMode: true, permissionMode: 'acceptEdits', includeContext: false })
    ids.push(s1)
    await engine.sendTurn(s1, 'primero', await cfg())
    await engine.sendTurn(s1, 'segundo', await cfg())
    const before = engine.peekChat(s1).turns
    out.firstChanged = (before[1].metrics?.filesChanged ?? []).map((f) => f.path).join(',')
    const plan = engine.planRewind(s1, before[0].id)
    out.plan = plan ? { index: plan.index, dropped: plan.dropped, cks: plan.checkpoints.length } : null
    engine.focusChat(s1)
    const editBtn = await until(() => document.querySelector('[data-turn="' + before[0].id + '"] [data-action="edit"]'))
    editBtn?.click()
    const box = await until(() => document.querySelector('[data-rewind]'))
    out.boxText = box?.querySelector('textarea')?.value
    out.dropText = box?.textContent.includes('los 3 que vienen detrás')
    if (box) type(box.querySelector('textarea'), 'primero editado')
    const toggle = await until(() => btn('Devolver también los archivos', box ?? document))
    toggle?.click()
    out.preview = (await until(() => { const f = document.querySelector('[data-rewind-files]'); return f && f.textContent.includes('app.js') ? f.textContent : null })) ?? ''
    await sleep(100)
    document.querySelector('[data-rewind-go]')?.click()
    const after = await idle(s1, 2)
    out.afterTurns = after?.turns.map((x) => x.role + ':' + x.content.slice(0, 30)).join(' | ')
    out.afterChanged = (after?.turns[1].metrics?.filesChanged ?? []).map((f) => f.path).join(',')
    out.modalGone = !document.querySelector('[data-rewind]')
    await sleep(900)
    out.stored = ((await api.sessions.get(s1)).data?.turns ?? []).map((x) => x.content.slice(0, 20)).join(' | ')

    // 2 · Regenerar la última respuesta de un chat: directo, con la conversación de antes.
    const s2 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba' })
    ids.push(s2)
    await engine.sendTurn(s2, 'eco: hola', await cfg())
    await engine.sendTurn(s2, 'eco: adiós', await cfg())
    engine.focusChat(s2)
    const t2 = engine.peekChat(s2).turns
    const regen = await until(() => document.querySelector('[data-turn="' + t2[3].id + '"] [data-action="regenerate"]'))
    regen?.click()
    await sleep(300)
    out.regenModal = Boolean(document.querySelector('[data-rewind]'))
    const r2 = await until(() => { const c = engine.peekChat(s2); return c && !c.runningRunId && c.turns.length === 4 && c.turns[3].id !== t2[3].id ? c : null }, 10000)
    out.regenTurns = r2?.turns.map((x) => x.content).join(' | ')

    // 3 · Regenerar una respuesta anterior pide confirmación y se puede hacer en una copia.
    const regen1 = document.querySelector('[data-turn="' + r2.turns[1].id + '"] [data-action="regenerate"]')
    regen1?.click()
    const box3 = await until(() => document.querySelector('[data-rewind]'))
    out.box3Dropped = box3?.getAttribute('data-rewind-dropped') ?? box3?.querySelector('[data-rewind-dropped]')?.getAttribute('data-rewind-dropped')
    btn('Hacerlo en una copia', box3 ?? document)?.click()
    await sleep(100)
    document.querySelector('[data-rewind-go]')?.click()
    const copy = await until(() => engine.peekSessions().find((s) => s.title === 'eco: hola (copia)'))
    out.copyId = copy?.id
    if (copy) ids.push(copy.id)
    const copyChat = copy ? await idle(copy.id, 2) : null
    out.copyTurns = copyChat?.turns.map((x) => x.content).join(' | ')
    out.originalTurns = engine.peekChat(s2)?.turns.map((x) => x.content).join(' | ')

    // 4 · Bifurcar desde la primera respuesta.
    engine.focusChat(s2)
    const forkBtn = await until(() => document.querySelector('[data-turn="' + r2.turns[1].id + '"] [data-action="fork"]'))
    forkBtn?.click()
    const forked = await until(() => engine.peekSessions().find((s) => s.title === 'eco: hola (bifurcada)'))
    if (forked) ids.push(forked.id)
    out.forkTurns = forked ? engine.peekChat(forked.id)?.turns.map((x) => x.content).join(' | ') : null
    if (forked) await engine.sendTurn(forked.id, 'eco: sigue', await cfg())
    out.forkAnswer = forked ? engine.peekChat(forked.id)?.turns.at(-1)?.content : null
    out.originalAfterFork = engine.peekChat(s2)?.turns.length

    // 5 · Agente de consola: al rebobinar no retoma su sesión vieja; al bifurcar al final, sí (bifurcando).
    await api.agents.saveCli({ id: 'claude-e1', name: 'Claude e1', type: 'cli', command: bins.claude, args: ['-p', '--output-format', 'stream-json', '--verbose'], parser: 'claude-stream-json', color: '#fff', createdAt: Date.now() })
    await sleep(300)
    const s3 = await engine.newSession('cli', { cliAgentId: 'claude-e1', projectId: 'proyecto-e1' })
    ids.push(s3)
    await engine.sendTurn(s3, 'primero', await cfg())
    await engine.sendTurn(s3, 'segundo', await cfg())
    const c3 = engine.peekChat(s3)
    const firstSid = c3.session.cliSessionId
    const re = await engine.rewindAndSend(s3, c3.turns[3].id, 'segundo bis', await cfg())
    out.cliRewound = re.run?.response ?? re.error
    const c3b = engine.peekChat(s3)
    out.cliAfter = { turns: c3b.turns.length, sid: c3b.session.cliSessionId, rewound: c3b.session.cliRewound, first: firstSid }
    await engine.sendTurn(s3, 'tercero', await cfg())
    out.cliNext = engine.peekChat(s3).turns.at(-1)?.content
    const lastSid = engine.peekChat(s3).session.cliSessionId
    const f1 = await engine.forkAt(s3, engine.peekChat(s3).turns.at(-1).id, 'fork final', await cfg())
    ids.push(f1)
    await engine.sendTurn(f1, 'cuarto', await cfg())
    out.cliForkEnd = { answer: engine.peekChat(f1).turns.at(-1)?.content, lastSid }
    const f2 = await engine.forkAt(s3, engine.peekChat(s3).turns[1].id, 'fork medio', await cfg())
    ids.push(f2)
    await engine.sendTurn(f2, 'otro camino', await cfg())
    out.cliForkMid = engine.peekChat(f2).turns.at(-1)?.content

    await api.providers.setBaseUrl('vllm', out.prevBase)
    for (const id of ids) await engine.deleteSession(id)
    await api.agents.removeCli('claude-e1')
    await api.projects.remove('proyecto-e1')
    return out
  })()`)
  const e1Reqs = mockE1.requests ?? []
  const edited = e1Reqs.filter((b) => (b.messages ?? []).some((m) => m.role === 'user' && String(m.content).includes('primero editado')))
  const editedUsers = edited[0] ? edited[0].messages.filter((m) => m.role === 'user').map((m) => String(m.content)) : []
  const adiosReqs = e1Reqs.filter((b) => { const u = (b.messages ?? []).filter((m) => m.role === 'user'); return u.length && String(u.at(-1).content) === 'eco: adiós' })

  log(
    e1.plan?.index === 0 && e1.plan.dropped === 4 && e1.plan.cks === 1 && e1.firstChanged.includes('app.js') && e1.boxText === 'primero' && e1.dropText,
    'EDITAR UN MENSAJE DICE CUÁNTO SE QUITA Y QUÉ ARCHIVOS CAMBIARON ESOS TURNOS',
    JSON.stringify(e1.plan) + ' · ' + e1.firstChanged
  )
  log(e1.preview.includes('app.js') && e1.preview.includes('Se borran'), 'al marcarlo, enseña qué archivos vuelven atrás', e1.preview.slice(0, 120))
  log(
    e1.modalGone && e1.afterTurns?.startsWith('user:primero editado | assistant:') && editedUsers.length === 1 && e1.stored?.startsWith('primero editado'),
    'SE REENVÍA EDITADO Y LO DE DETRÁS SALE DE LA CONVERSACIÓN (TAMBIÉN EN DISCO)',
    `${e1.afterTurns} · usuarios en la petición: ${editedUsers.length}`
  )
  log(safetyRefs() > safetyBefore && e1.afterChanged.includes('app.js'), 'LOS ARCHIVOS SE DESHICIERON ANTES DE REENVIAR, CON FOTO DE SEGURIDAD', `${e1.afterChanged} · fotos ${safetyBefore}→${safetyRefs()}`)
  log(
    e1.regenModal === false && e1.regenTurns === 'eco: hola | Eco 1: hola | eco: adiós | Eco 2: adiós' && adiosReqs.length === 2 && adiosReqs.every((b) => b.messages.filter((m) => m.role === 'user').length === 2),
    'REGENERAR LA ÚLTIMA RESPUESTA VA DIRECTO Y NO DUPLICA EL MENSAJE',
    `${e1.regenTurns} · ${adiosReqs.length} peticiones`
  )
  log(
    e1.box3Dropped === '4' && e1.copyTurns === 'eco: hola | Eco 1: hola' && e1.originalTurns === 'eco: hola | Eco 1: hola | eco: adiós | Eco 2: adiós',
    'REGENERAR MÁS ATRÁS PREGUNTA, Y EN UNA COPIA LA ORIGINAL NO SE TOCA',
    `copia: ${e1.copyTurns} · original: ${e1.originalTurns}`
  )
  log(e1.forkTurns === 'eco: hola | Eco 1: hola' && e1.forkAnswer === 'Eco 2: sigue' && e1.originalAfterFork === 4, 'BIFURCAR COPIA HASTA ESA RESPUESTA Y SIGUE DESDE AHÍ', `${e1.forkTurns} → ${e1.forkAnswer}`)
  log(
    String(e1.cliRewound).startsWith('resume=no fork=false prompt=Conversación anterior') && String(e1.cliRewound).includes('primero') && String(e1.cliRewound).includes('segundo bis') &&
      e1.cliAfter.turns === 4 && e1.cliAfter.sid && e1.cliAfter.sid !== e1.cliAfter.first && e1.cliAfter.rewound === false,
    'UN AGENTE DE CONSOLA REBOBINADO NO RETOMA SU SESIÓN VIEJA: EMPIEZA OTRA CON LA CONVERSACIÓN',
    String(e1.cliRewound).slice(0, 140)
  )
  log(String(e1.cliNext).startsWith('resume=' + e1.cliAfter.sid), 'y el turno siguiente ya retoma la sesión nueva', String(e1.cliNext).slice(0, 60))
  log(String(e1.cliForkEnd?.answer).startsWith('resume=' + e1.cliForkEnd?.lastSid + ' fork=true'), 'bifurcar al final usa la bifurcación del propio CLI', String(e1.cliForkEnd?.answer).slice(0, 60))
  log(String(e1.cliForkMid).startsWith('resume=no') && String(e1.cliForkMid).includes('Conversación anterior'), 'bifurcar más atrás le pasa la conversación hasta ahí', String(e1.cliForkMid).slice(0, 80))
  mockE1.close()

  /* -------------------------------------------------------------- *
   * E2 · Biblioteca de prompts con variables                       *
   * -------------------------------------------------------------- */
  const branchE2 = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const e2 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    const setVal = (el, value) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    const out = {}

    const now = Date.now()
    await api.prompts.save({ id: 'p-rev', name: '  Revisar PR  ', text: 'Revisa la rama {{rama}} de {{proyecto}} buscando {{foco:fallos}} y dime {{formato}}. Otra vez: {{Formato}}.', createdAt: now })
    await api.prompts.save({ id: 'p-res', name: 'Resumen', text: 'Resume esto en tres frases.', description: 'Tres frases', createdAt: now })
    const cfg1 = (await api.prompts.save({ id: 'p-fecha', name: 'Fecha', text: 'Hoy es {{fecha}}.', createdAt: now })).data
    out.saved = cfg1.prompts.filter((p) => p.id.startsWith('p-')).map((p) => p.name).join(',')
    const bad = await api.prompts.save({ id: 'p-vacio', name: 'x', text: '   ', createdAt: now })
    out.emptyRejected = !bad.ok

    await api.projects.save({ id: 'proyecto-e2', name: 'Repo e2', path: repo, color: '#fff', createdAt: now })
    await sleep(300)
    const sid = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba', projectId: 'proyecto-e2' })
    engine.focusChat(sid)
    await until(() => document.querySelector('textarea[placeholder*="agente-de-prueba"]'))
    const box = document.querySelector('textarea[placeholder*="agente-de-prueba"]')
    await sleep(600)

    // «/res» + Enter: sin variables, entra tal cual.
    box.focus()
    setVal(box, '/res')
    const first = await until(() => document.querySelector('[data-slash] [data-prompt]'))
    out.firstMatch = first?.getAttribute('data-prompt')
    key(box, 'Enter')
    await sleep(150)
    out.afterEnter = box.value

    // «Oye /rev»: pide lo que falta, con proyecto y rama ya puestos.
    setVal(box, 'Oye /rev')
    const row = await until(() => document.querySelector('[data-slash] [data-prompt="p-rev"]'))
    row?.click()
    const fill = await until(() => document.querySelector('[data-prompt-fill]'))
    out.fields = fill ? [...fill.querySelectorAll('[data-var]')].map((f) => f.getAttribute('data-var') + '=' + f.value).join(' | ') : null
    const formato = fill?.querySelector('[data-var="formato"]')
    if (formato) setVal(formato, 'una lista')
    await sleep(100)
    out.preview = document.querySelector('[data-prompt-preview]')?.textContent
    document.querySelector('[data-prompt-insert]')?.click()
    await sleep(200)
    out.afterFill = box.value
    out.modalClosed = !document.querySelector('[data-prompt-fill]')

    // Sólo con variables que se rellenan solas: entra directo.
    setVal(box, '/fech')
    await until(() => document.querySelector('[data-slash] [data-prompt="p-fecha"]'))
    key(box, 'Enter')
    await sleep(150)
    out.afterDate = box.value
    out.noModalForDate = !document.querySelector('[data-prompt-fill]')

    // Esc cierra la lista sin tocar nada; una ruta no la abre.
    setVal(box, 'mira /r')
    out.openBeforeEsc = Boolean(await until(() => document.querySelector('[data-slash]')))
    key(box, 'Escape')
    await sleep(120)
    out.closedByEsc = !document.querySelector('[data-slash]') && box.value === 'mira /r'
    setVal(box, 'mira src/re')
    await sleep(150)
    out.pathNoSlash = !document.querySelector('[data-slash]')

    // Guardar lo escrito como prompt nuevo.
    setVal(box, 'Traduce {{texto}} al inglés')
    await sleep(100)
    document.querySelector('[data-save-prompt]')?.click()
    const nameInput = await until(() => document.querySelector('[data-prompt-name]'))
    out.saveText = document.querySelector('[data-prompt-text]')?.value
    out.saveVars = document.querySelector('[data-vars]')?.textContent
    if (nameInput) setVal(nameInput, 'Traducir')
    await sleep(100)
    document.querySelector('[data-prompt-save]')?.click()
    await until(async () => ((await api.config.get()).data.prompts ?? []).some((p) => p.name === 'Traducir'))
    const cfg2 = (await api.config.get()).data
    out.uses = cfg2.prompts.filter((p) => p.id.startsWith('p-')).map((p) => p.name + ':' + (p.uses ?? 0)).sort().join(',')
    out.traducir = cfg2.prompts.find((p) => p.name === 'Traducir')?.text

    // Agentes › Prompts: editar y borrar.
    btn('Agentes')?.click()
    const tab = await until(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Prompts')))
    tab?.click()
    const lib = await until(() => document.querySelector('[data-prompt-library]'))
    out.rows = lib ? lib.querySelectorAll('[data-library-row]').length : 0
    lib?.querySelector('[data-library-row="p-res"]')?.click()
    await sleep(150)
    const text = lib?.querySelector('[data-prompt-text]')
    if (text) setVal(text, 'Resume esto en dos frases.')
    await sleep(100)
    lib?.querySelector('[data-prompt-save]')?.click()
    await until(async () => ((await api.config.get()).data.prompts ?? []).find((p) => p.id === 'p-res')?.text.includes('dos frases'))
    out.edited = (await api.config.get()).data.prompts.find((p) => p.id === 'p-res')?.text
    btn('Borrar', lib)?.click()
    const confirm = await until(() => [...document.querySelectorAll('div.fixed.inset-0')].find((m) => m.textContent.includes('sale de la biblioteca')))
    if (confirm) [...confirm.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Borrar')?.click()
    await until(async () => !((await api.config.get()).data.prompts ?? []).some((p) => p.id === 'p-res'))
    out.afterDelete = ((await api.config.get()).data.prompts ?? []).map((p) => p.id).sort().join(',')

    // En la Arena también.
    btn('Arena')?.click()
    const arenaBox = await until(() => document.querySelector('textarea[placeholder*="Ctrl"]'))
    if (arenaBox) {
      arenaBox.focus()
      setVal(arenaBox, '/fech')
      await until(() => document.querySelector('[data-slash] [data-prompt="p-fecha"]'))
      key(arenaBox, 'Enter')
      await sleep(150)
    }
    out.arena = engine.peekArena().prompt
    engine.setArena({ prompt: '' })

    await engine.deleteSession(sid)
    for (const p of (await api.config.get()).data.prompts ?? []) await api.prompts.remove(p.id)
    await api.projects.remove('proyecto-e2')
    btn('Consola')?.click()
    return out
  })()`)
  const today = await js(`new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })`)
  log(e2.saved === 'Revisar PR,Resumen,Fecha' && e2.emptyRejected, 'LA BIBLIOTECA GUARDA PROMPTS (Y NO UNO VACÍO)', e2.saved)
  log(e2.firstMatch === 'p-res' && e2.afterEnter === 'Resume esto en tres frases.', '«/» ABRE LA BIBLIOTECA Y ENTER INSERTA EL PROMPT', e2.afterEnter)
  log(
    e2.fields === `rama=${branchE2} | proyecto=Repo e2 | foco=fallos | formato=` &&
      e2.afterFill === `Oye Revisa la rama ${branchE2} de Repo e2 buscando fallos y dime una lista. Otra vez: una lista.` && e2.modalClosed,
    'CON VARIABLES PIDE LO QUE FALTA; PROYECTO Y RAMA VIENEN PUESTOS',
    `${e2.fields} → ${e2.afterFill}`
  )
  log(e2.afterDate === `Hoy es ${today}.` && e2.noModalForDate, 'si sólo tiene variables que se rellenan solas, entra directo', e2.afterDate)
  log(e2.openBeforeEsc && e2.closedByEsc && e2.pathNoSlash, 'Esc cierra la lista y una ruta como src/… no la abre')
  log(e2.saveText === 'Traduce {{texto}} al inglés' && (e2.saveVars ?? '').includes('texto') && e2.traducir === 'Traduce {{texto}} al inglés', 'LO ESCRITO SE GUARDA COMO PROMPT, CON SUS VARIABLES A LA VISTA', e2.saveVars)
  log(e2.uses === 'Fecha:1,Resumen:1,Revisar PR:1', 'cada inserción cuenta como uso', e2.uses)
  log(e2.rows === 4 && e2.edited === 'Resume esto en dos frases.' && !e2.afterDelete.includes('p-res'), 'EN AGENTES › PROMPTS SE EDITAN Y SE BORRAN', `${e2.rows} filas · ${e2.afterDelete}`)
  log(e2.arena === `Hoy es ${today}.`, 'y en la Arena «/» también inserta', e2.arena)

  /* -------------------------------------------------------------- *
   * E3 · Búsqueda de texto completo                                *
   * -------------------------------------------------------------- */
  const mockE3 = await startAgentMock()
  const e3 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const setVal = (el, value) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const out = {}
    const now = Date.now()
    const q = async (text, extra = {}) => (await api.search.query({ text, ...extra })).data
    const brief = (r) => r.hits.map((h) => h.kind + ':' + (h.sessionId ?? '') + ':' + (h.role ?? h.field)).join(' | ')

    await api.projects.save({ id: 'proyecto-e3', name: 'Repo e3', path: repo, color: '#fff', createdAt: now })
    const turn = (id, role, content) => ({ id, role, content })
    await api.sessions.save({ id: 'e3-a', kind: 'chat', title: 'Migración de la base', projectId: 'proyecto-e3', createdAt: now, updatedAt: now, turns: [
      turn('a1', 'user', 'Cómo migramos la tabla de FACTURACIÓN sin parar el servicio'),
      turn('a2', 'assistant', 'Con una migración en dos fases: primero añades la columna nueva y luego copias los datos.')
    ] })
    await api.sessions.save({ id: 'e3-b', kind: 'chat', title: 'Otra', archived: true, createdAt: now, updatedAt: now, turns: [
      turn('b1', 'user', 'la facturación del mes pasado'),
      turn('b2', 'assistant', 'De acuerdo.')
    ] })
    await api.sessions.save({ id: 'e3-c', kind: 'chat', title: 'Nada', createdAt: now, updatedAt: now, turns: [turn('c1', 'user', 'hola'), turn('c2', 'assistant', 'adiós')] })
    await engine.loadSessions()

    const r1 = await q('facturacion')
    out.plain = brief(r1)
    const hit = r1.hits.find((h) => h.sessionId === 'e3-a')
    out.marked = hit ? hit.ranges.map(([a, b]) => hit.snippet.slice(a, b)).join(',') : null
    out.noArchived = brief(await q('facturacion', { archived: false }))
    out.phrase = brief(await q('"dos fases"'))
    out.bothWords = brief(await q('columna FASES'))
    out.wrongOrder = (await q('"fases dos"')).total
    out.project = brief(await q('facturacion', { projectId: 'proyecto-e3' }))
    out.short = (await q('a')).total

    // Una ejecución cuya conversación ya no existe sale del histórico; la de una que sigue, no se repite.
    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await sleep(300)
    const cfg = (await api.config.get()).data
    const gone = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba' })
    const goneRun = await engine.sendTurn(gone, 'eco: canción del verano', cfg)
    out.goneRunId = goneRun.run?.id
    await engine.deleteSession(gone)
    const kept = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba' })
    // Una palabra que no haya salido en otra pasada de las pruebas.
    const word = 'zanahoria' + Date.now().toString(36)
    const keptRun = await engine.sendTurn(kept, 'eco: ' + word + ' morada', cfg)
    await engine.flushPersist()
    await sleep(900)
    const r2 = await q('cancion VERANO', { scope: 'runs' })
    out.run = r2.hits.map((h) => h.kind + ':' + h.field + ':' + (h.runId === out.goneRunId)).join(' | ')
    out.runSnippet = r2.hits[0]?.snippet
    out.keptAll = (await q(word)).hits.map((h) => h.kind + ':' + h.role).sort().join(' | ')
    out.keptRuns = (await q(word, { scope: 'runs' })).total

    // Por la interfaz: botón de arriba, resultados y abrir el mensaje.
    document.querySelector('[data-open-search]')?.click()
    const input = await until(() => document.querySelector('[data-search-input]'))
    if (input) setVal(input, 'facturacion')
    await until(() => document.querySelectorAll('[data-search-results] [data-hit]').length >= 2)
    out.uiHits = document.querySelectorAll('[data-search-results] [data-hit]').length
    out.uiMark = document.querySelector('[data-search-results] mark')?.textContent
    const target = [...document.querySelectorAll('[data-search-results] [data-hit]')].find((b) => b.textContent.includes('Migración de la base'))
    target?.click()
    const ring = await until(() => { const el = document.querySelector('[data-turn="a1"]'); return el && el.className.includes('ring-1') ? el : null })
    out.flashed = Boolean(ring)
    out.modalClosed = !document.querySelector('[data-search]')

    // Ctrl+Mayús+F desde cualquier sitio; un resultado del histórico abre la ejecución.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }))
    const input2 = await until(() => document.querySelector('[data-search-input]'))
    out.shortcut = Boolean(input2)
    if (input2) setVal(input2, 'cancion verano')
    const runHit = await until(() => document.querySelector('[data-search-results] [data-hit="run"]'))
    runHit?.click()
    out.detail = Boolean(await until(() => document.body.innerText.includes('Eco 1: canción del verano')))

    await api.providers.setBaseUrl('vllm', out.prevBase)
    await engine.deleteSession(kept)
    if (keptRun.run?.id) await api.runs.remove(keptRun.run.id)
    for (const id of ['e3-a', 'e3-b', 'e3-c']) await engine.deleteSession(id)
    if (out.goneRunId) await api.runs.remove(out.goneRunId)
    await api.projects.remove('proyecto-e3')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    return out
  })()`)
  log(
    e3.plain === 'turn:e3-a:user | turn:e3-b:user' || e3.plain === 'turn:e3-b:user | turn:e3-a:user',
    'BUSCA EN LOS MENSAJES DE TODAS LAS CONVERSACIONES, TAMBIÉN LAS CERRADAS, SIN MAYÚSCULAS NI TILDES',
    e3.plain
  )
  log(e3.marked === 'FACTURACIÓN', 'marca la palabra tal como está escrita', e3.marked)
  log(e3.noArchived === 'turn:e3-a:user' && e3.project === 'turn:e3-a:user', 'filtra por cerradas y por proyecto', `${e3.noArchived} · ${e3.project}`)
  log(e3.phrase === 'turn:e3-a:assistant' && e3.bothWords === 'turn:e3-a:assistant' && e3.wrongOrder === 0 && e3.short === 0, 'PALABRAS EN EL MISMO MENSAJE Y "FRASES EXACTAS"', `${e3.phrase} · ${e3.bothWords} · ${e3.wrongOrder}`)
  log(e3.run === 'run:prompt:true' && (e3.runSnippet ?? '').includes('canción del verano'), 'EL HISTÓRICO ENTRA EN LA BÚSQUEDA', `${e3.run} · ${e3.runSnippet}`)
  log(e3.keptAll === 'turn:assistant | turn:user' && e3.keptRuns === 1, 'lo que está en una conversación no sale repetido desde el histórico', `${e3.keptAll} · ${e3.keptRuns} en el histórico`)
  log(e3.uiHits === 2 && e3.uiMark?.toLowerCase().startsWith('factura') && e3.flashed && e3.modalClosed, 'DESDE LA BARRA DE ARRIBA: ELEGIR UN RESULTADO LLEVA AL MENSAJE Y LO MARCA', `${e3.uiHits} resultados · ${e3.uiMark}`)
  log(e3.shortcut && e3.detail, 'Ctrl+Mayús+F lo abre y un resultado del histórico abre la ejecución')
  mockE3.close()

  /* -------------------------------------------------------------- *
   * E4 · Imágenes pegadas y mensajes multimodales                  *
   * -------------------------------------------------------------- */
  const mockE4 = await startAgentMock()
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const notesE4 = path.join(TMP, 'notas-e4.txt')
  fs.writeFileSync(notesE4, 'CONTENIDO-SECRETO-42\n')
  // Un Claude Code falso que enseña el fichero de ajustes que recibe (tiene que llamarse claude).
  const e4Dir = path.join(FIXTURES, 'e4')
  fs.mkdirSync(e4Dir, { recursive: true })
  fs.writeFileSync(
    path.join(e4Dir, 'claude-e4.js'),
    [
      "const fs = require('node:fs')",
      "const out = (o) => process.stdout.write(JSON.stringify(o) + String.fromCharCode(10))",
      'const args = process.argv.slice(2)',
      "const s = args.indexOf('--settings')",
      "let prompt = ''",
      // Como el de verdad: con --input-format stream-json el turno empieza con el primer mensaje.
      "const streaming = args.includes('--input-format')",
      'let started = false',
      "process.stdin.on('data', (c) => { prompt += c; if (streaming && !started && prompt.includes(String.fromCharCode(10))) { started = true; const m = JSON.parse(prompt.split(String.fromCharCode(10))[0]); prompt = m.message.content.map((b) => b.text).join(''); turn() } })",
      "process.stdin.on('end', () => { if (!streaming) turn(); else process.exit(0) })",
      'function turn() {',
      "  const sid = 'e4-' + Math.random().toString(16).slice(2, 8)",
      "  out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-falso', cwd: process.cwd() })",
      "  const settings = s !== -1 ? fs.readFileSync(args[s + 1], 'utf8') : 'ninguno'",
      "  const text = 'ajustes=' + settings + ' prompt=' + prompt",
      "  out({ type: 'assistant', session_id: sid, message: { model: 'claude-falso', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } } })",
      "  out({ type: 'result', session_id: sid, total_cost_usd: 0, duration_ms: 5, num_turns: 1, result: text })",
      '}'
    ].join('\n')
  )
  let e4Bin
  if (process.platform === 'win32') {
    e4Bin = path.join(e4Dir, 'claude.cmd')
    fs.writeFileSync(e4Bin, `@node "${path.join(e4Dir, 'claude-e4.js')}" %*\r\n`)
  } else {
    e4Bin = path.join(e4Dir, 'claude')
    fs.writeFileSync(e4Bin, `#!/bin/sh\nexec node "${path.join(e4Dir, 'claude-e4.js')}" "$@"\n`)
    fs.chmodSync(e4Bin, 0o755)
  }

  const e4 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_1PX)}), (c) => c.charCodeAt(0))

    const pasted = await api.attach.paste(bytes, 'image/png')
    out.pasted = pasted.ok ? { image: pasted.data.image, mime: pasted.data.mime, dir: pasted.data.path.includes('pegados'), text: pasted.data.text } : pasted.error
    const img = pasted.data
    const thumb = await api.attach.thumb(img.path)
    out.thumb = thumb.ok ? String(thumb.data).slice(0, 22) : thumb.error
    const bmp = await api.attach.paste(bytes, 'image/bmp')
    out.bmpRejected = !bmp.ok
    const notes = (await api.attach.describe(${JSON.stringify(notesE4)})).data

    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-e4', name: 'Repo e4', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(300)
    const cfg = async () => (await api.config.get()).data
    const ids = []

    // Con visión (sin dato en el catálogo se intenta): la imagen va como imagen, y vuelve en el turno siguiente con el archivo de texto.
    const s1 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-de-prueba' })
    ids.push(s1)
    await engine.sendTurn(s1, 'eco: mira esto', await cfg(), { attachments: [img, notes] })
    out.first = engine.peekChat(s1).turns.at(-1)?.content
    await engine.sendTurn(s1, 'eco: y ahora qué', await cfg())
    out.second = engine.peekChat(s1).turns.at(-1)?.content

    // Un modelo que el catálogo dice que sólo lee texto: la imagen va como ruta.
    const s2 = await engine.newSession('chat', { providerId: 'vllm', model: 'agente-sin-vision' })
    ids.push(s2)
    await engine.sendTurn(s2, 'eco: sin vista', await cfg(), { attachments: [img] })

    // En la Consola: la miniatura sale en el mensaje enviado.
    engine.focusChat(s1)
    out.thumbInTurn = Boolean(await until(() => document.querySelector('[data-turn] [data-attachment-image] img[data-thumb]')))

    // Un agente de consola recibe la ruta, y Claude Code puede leer la carpeta de la imagen.
    await api.agents.saveCli({ id: 'claude-e4', name: 'Claude e4', type: 'cli', command: ${JSON.stringify(e4Bin)}, args: ['-p', '--output-format', 'stream-json', '--verbose'], parser: 'claude-stream-json', color: '#fff', createdAt: Date.now() })
    await sleep(300)
    const s3 = await engine.newSession('cli', { cliAgentId: 'claude-e4', projectId: 'proyecto-e4', permissionMode: 'acceptEdits' })
    ids.push(s3)
    const r3 = await engine.sendTurn(s3, 'describe la imagen', await cfg(), { attachments: [img] })
    out.cli = r3.run?.response ?? r3.error
    out.imgDir = img.path.replace(/[\\\\/][^\\\\/]+$/, '')

    await api.providers.setBaseUrl('vllm', out.prevBase)
    for (const id of ids) await engine.deleteSession(id)
    await api.agents.removeCli('claude-e4')
    await api.projects.remove('proyecto-e4')
    return out
  })()`)
  const e4Reqs = mockE4.requests ?? []
  const reqWith = (text) => e4Reqs.find((b) => (b.messages ?? []).some((m) => m.role === 'user' && JSON.stringify(m.content).includes(text)) && JSON.stringify(b.messages.filter((m) => m.role === 'user').at(-1).content).includes(text))
  const r1 = reqWith('eco: mira esto')
  const u1 = r1?.messages.filter((m) => m.role === 'user').at(-1)?.content
  const parts1 = Array.isArray(u1) ? u1.map((p) => p.type).join(',') : typeof u1
  const img1 = Array.isArray(u1) ? u1.find((p) => p.type === 'image_url')?.image_url?.url ?? '' : ''
  const text1 = Array.isArray(u1) ? u1.find((p) => p.type === 'text')?.text ?? '' : String(u1)
  const r2 = reqWith('eco: y ahora qué')
  const hist = r2?.messages.filter((m) => m.role === 'user')[0]?.content
  const r3 = reqWith('eco: sin vista')
  const u3 = r3?.messages.filter((m) => m.role === 'user').at(-1)?.content
  let settings = null
  try {
    settings = JSON.parse(String(e4.cli).split('ajustes=')[1].split(' prompt=')[0])
  } catch {}

  log(e4.pasted?.image === true && e4.pasted.mime === 'image/png' && e4.pasted.dir && e4.pasted.text === false && e4.bmpRejected, 'UNA IMAGEN PEGADA SE GUARDA EN LA CARPETA DE LA APP COMO ADJUNTO', JSON.stringify(e4.pasted))
  log(e4.thumb === 'data:image/png;base64,' && e4.thumbInTurn, 'y se ve en miniatura, también en el mensaje enviado', `${e4.thumb} · ${e4.thumbInTurn}`)
  log(
    parts1 === 'text,image_url' && img1.startsWith('data:image/png;base64,iVBOR') && text1.includes('CONTENIDO-SECRETO-42'),
    'CON VISIÓN, LA IMAGEN VA COMO IMAGEN Y EL ARCHIVO DE TEXTO DENTRO DEL MENSAJE',
    `${parts1} · ${img1.slice(0, 30)}`
  )
  log(
    Array.isArray(hist) && hist.some((p) => p.type === 'image_url') && JSON.stringify(hist).includes('CONTENIDO-SECRETO-42') && String(e4.second).startsWith('Eco 2'),
    'EN EL TURNO SIGUIENTE LOS ADJUNTOS VUELVEN CON EL HISTORIAL',
    Array.isArray(hist) ? hist.map((p) => p.type).join(',') : String(hist).slice(0, 80)
  )
  log(typeof u3 === 'string' && u3.includes('este modelo no acepta imágenes') && u3.includes('pegados'), 'si el catálogo dice que el modelo no ve imágenes, va la ruta', typeof u3 === 'string' ? u3.slice(-120) : typeof u3)
  log(
    String(e4.cli).includes('Archivos adjuntos') && String(e4.cli).includes('pegados') && settings?.permissions?.additionalDirectories?.[0] === e4.imgDir,
    'A CLAUDE CODE LE LLEGA LA RUTA Y PERMISO PARA LEER ESA CARPETA',
    JSON.stringify(settings)
  )
  mockE4.close()

  /* -------------------------------------------------------------- *
   * E5 · Exportar e importar conversaciones                        *
   * -------------------------------------------------------------- */
  // Los diálogos de guardar y abrir contestan solos con rutas de la carpeta de pruebas.
  const { dialog: dlg } = require('electron')
  const realSave = dlg.showSaveDialog
  const realOpen = dlg.showOpenDialog
  let nextSave = null
  let nextOpen = null
  dlg.showSaveDialog = async (...a) => (nextSave ? { canceled: false, filePath: nextSave } : realSave.apply(dlg, a))
  dlg.showOpenDialog = async (...a) => (nextOpen ? { canceled: false, filePaths: nextOpen } : realOpen.apply(dlg, a))
  const e5Dir = path.join(TMP, 'e5')
  fs.mkdirSync(e5Dir, { recursive: true })
  const mdFile = path.join(e5Dir, 'conversacion.md')
  const jsonFile = path.join(e5Dir, 'conversacion.json')
  const uiFile = path.join(e5Dir, 'desde-la-interfaz.md')
  const badFile = path.join(e5Dir, 'roto.json')
  fs.writeFileSync(badFile, '{ esto no es json')

  const e5a = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const now = Date.now()
    await api.projects.save({ id: 'proyecto-e5', name: 'Repo e5', path: repo, color: '#fff', createdAt: now })
    const step = (id, tool) => ({ id, at: now, kind: 'tool', tool, status: 'ok' })
    await api.sessions.save({
      id: 'e5-conv', kind: 'chat', title: 'Plan de la migración', projectId: 'proyecto-e5', providerId: 'vllm', model: 'agente-de-prueba',
      worktreePath: '/no/existe', cliSessionId: 'sesion-vieja', createdAt: now, updatedAt: now,
      turns: [
        { id: 'u1', role: 'user', content: 'Dime cómo migrar la tabla', attachments: [{ path: '/tmp/notas.txt', name: 'notas.txt', bytes: 10, text: true }] },
        { id: 'r1', role: 'assistant', content: 'En **dos fases**: primero la columna, luego los datos.', model: 'agente-de-prueba', reasoning: 'Hay que evitar bloquear la tabla.',
          steps: [step('s1', 'read_file'), step('s2', 'read_file'), step('s3', 'edit_file')],
          metrics: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, costTotal: 0.0123, status: 'ok', checkpoint: { root: '/otro/equipo', head: 'abc' } } },
        { id: 'u2', role: 'user', content: '¿Y si falla?' },
        { id: 'r2', role: 'assistant', content: '', model: 'agente-de-prueba', error: 'límite de cupo' }
      ]
    })
    await engine.loadSessions()
    return true
  })()`)
  nextSave = mdFile
  const e5b = await js(`(async () => {
    const api = window.api
    const out = {}
    const md = await api.exchange.export(['e5-conv'], 'md', 'es')
    out.md = md.ok ? md.data : md.error
    return out
  })()`)
  nextSave = jsonFile
  const e5c = await js(`(async () => {
    const r = await window.api.exchange.export(['e5-conv'], 'json', 'es')
    return r.ok ? r.data : r.error
  })()`)
  const mdOut = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, 'utf8') : ''
  let exported = null
  try {
    exported = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
  } catch {}

  nextOpen = [jsonFile, mdFile, badFile]
  const e5d = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const r = await api.exchange.import()
    const out = { result: r.ok ? r.data : r.error }
    const list = (await api.sessions.list()).data
    const fromJson = list.find((s) => s.id === r.data?.imported?.[0]?.id)
    const fromMd = list.find((s) => s.id === r.data?.imported?.[1]?.id)
    out.json = fromJson && {
      sameId: fromJson.id === 'e5-conv', turns: fromJson.turns.length, projectId: fromJson.projectId, worktreePath: fromJson.worktreePath ?? null,
      cliSessionId: fromJson.cliSessionId ?? null, checkpoint: fromJson.turns[1].metrics?.checkpoint ?? null, steps: fromJson.turns[1].steps?.length, titled: fromJson.titled
    }
    out.md = fromMd && { title: fromMd.title, turns: fromMd.turns.map((t) => t.role + ':' + t.content.slice(0, 26)).join(' | '), model: fromMd.turns[1]?.model }
    out.ids = (r.data?.imported ?? []).map((x) => x.id)
    return out
  })()`)

  // Desde la interfaz: el botón de la fila abre el diálogo y guarda en Markdown.
  nextSave = uiFile
  const e5e = await js(`(async () => {
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    engine.focusChat('e5-conv')
    const row = await until(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Plan de la migración'))?.parentElement)
    row?.querySelector('[data-action="export"]')?.click()
    const pick = await until(() => document.querySelector('[data-export] [data-format="md"]'))
    pick?.click()
    await sleep(800)
    return { modal: Boolean(pick) }
  })()`)
  const uiMd = fs.existsSync(uiFile) ? fs.readFileSync(uiFile, 'utf8') : ''
  await js(`(async () => {
    const engine = window.__accEngine
    for (const id of ['e5-conv', ...${JSON.stringify(e5d.ids ?? [])}]) await engine.deleteSession(id)
    await window.api.projects.remove('proyecto-e5')
  })()`)
  dlg.showSaveDialog = realSave
  dlg.showOpenDialog = realOpen

  log(
    e5a && e5b.md?.count === 1 && mdOut.startsWith('# Plan de la migración') && mdOut.includes('- Proyecto: Repo e5') && mdOut.includes('- Modelo: vllm/agente-de-prueba') &&
      mdOut.includes('## Tú\n\nDime cómo migrar la tabla') && mdOut.includes('## Respuesta · agente-de-prueba · 1.5k tokens · $0.0123') &&
      mdOut.includes('<summary>Razonamiento</summary>') && mdOut.includes('_Herramientas: read_file ×2, edit_file_') && mdOut.includes('_Adjuntos: notas.txt_') && mdOut.includes('> **Error:** límite de cupo'),
    'EXPORTAR EN MARKDOWN: MENSAJES, RAZONAMIENTO, HERRAMIENTAS, ADJUNTOS Y COSTE',
    mdOut.split('\n').slice(0, 6).join(' ⏎ ')
  )
  log(e5c?.count === 1 && exported?.format === 'ai-command-center/conversations' && exported.sessions?.[0]?.id === 'e5-conv' && exported.sessions[0].turns.length === 4, 'exportar en JSON guarda la conversación entera', JSON.stringify(e5c))
  log(
    e5d.json && !e5d.json.sameId && e5d.json.turns === 4 && e5d.json.projectId === 'proyecto-e5' && e5d.json.worktreePath === null && e5d.json.cliSessionId === null &&
      e5d.json.checkpoint === null && e5d.json.steps === 3 && e5d.json.titled === true,
    'IMPORTAR EL JSON LA TRAE ENTERA, CON ID NUEVO Y SIN LO QUE SÓLO VALE EN EL OTRO EQUIPO',
    JSON.stringify(e5d.json)
  )
  log(
    e5d.md?.title === 'Plan de la migración' && e5d.md.turns === 'user:Dime cómo migrar la tabla | assistant:En **dos fases**: primero  | user:¿Y si falla? | assistant:> **Error:** límite de cup' && e5d.md.model === 'agente-de-prueba',
    'IMPORTAR EL MARKDOWN RECUPERA LOS MENSAJES',
    e5d.md?.turns
  )
  log((e5d.result?.skipped ?? []).length === 1 && e5d.result.skipped[0].file === 'roto.json' && e5d.result.skipped[0].reason.includes('JSON'), 'un fichero roto se salta y se dice por qué', JSON.stringify(e5d.result?.skipped))
  log(e5e.modal && uiMd.startsWith('# Plan de la migración'), 'desde la fila de la conversación se exporta', uiMd.slice(0, 40))

  /* -------------------------------------------------------------- *
   * F1 · Mensaje de commit escrito por IA                          *
   * -------------------------------------------------------------- */
  const mockF1 = await startAgentMock()
  const headF1 = git(['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(REPO, 'factura.js'), 'total = redondea(a) + redondea(b)\n')
  git(['add', 'factura.js'])
  git(['commit', '-qm', 'Añade la factura'])
  fs.writeFileSync(path.join(REPO, 'factura.js'), 'total = redondea(a + b)\n')
  // Un repositorio sin nada que confirmar.
  const cleanRepo = path.join(TMP, 'f1-limpio')
  fs.mkdirSync(cleanRepo, { recursive: true })
  git(['init', '-q', '-b', 'main'], cleanRepo)
  git(['config', 'user.email', 'prueba@local'], cleanRepo)
  git(['config', 'user.name', 'Prueba'], cleanRepo)
  fs.writeFileSync(path.join(cleanRepo, 'a.txt'), 'a\n')
  git(['add', '.'], cleanRepo)
  git(['commit', '-qm', 'inicio'], cleanRepo)

  const f1 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const out = {}
    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    out.prevModel = (await api.config.get()).data.settings.gitModel ?? null
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.projects.save({ id: 'proyecto-f1', name: 'Repo f1', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(300)

    const r = await api.git.suggestCommit(repo, { providerId: 'vllm', model: 'agente-de-prueba' }, 'es')
    out.message = r.ok ? r.data.message : r.error
    out.kind = r.data?.run.kind
    out.project = r.data?.run.projectId
    out.inHistory = r.ok ? ((await api.runs.compare([r.data.run.id])).data ?? []).length === 1 : false
    const clean = await api.git.suggestCommit(${JSON.stringify(cleanRepo)}, { providerId: 'vllm', model: 'agente-de-prueba' }, 'es')
    out.cleanError = clean.ok ? 'no falló' : clean.error

    // Por la interfaz: Proyectos › Git › Escribir con IA, con el modelo elegido y recordado.
    await api.config.settings({ gitModel: { providerId: 'vllm', model: 'agente-de-prueba' } })
    await sleep(300)
    engine.navigate({ page: 'projects', projectId: 'proyecto-f1', tab: 'git' })
    const button = await until(() => document.querySelector('[data-ai-commit]:not([disabled])'))
    button?.click()
    const note = await until(() => document.querySelector('[data-ai-note]'))
    out.note = note?.textContent ?? ''
    out.box = document.querySelector('[data-commit-message]')?.value

    if (r.ok) await api.runs.remove(r.data.run.id)
    for (const run of (await api.runs.query({ kind: 'git', projectId: 'proyecto-f1' })).data.rows) await api.runs.remove(run.id)
    await api.config.settings({ gitModel: out.prevModel })
    await api.providers.setBaseUrl('vllm', out.prevBase)
    await api.projects.remove('proyecto-f1')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    return out
  })()`)
  const f1Req = (mockF1.requests ?? []).find((b) => String(b.messages?.find((m) => m.role === 'system')?.content ?? '').includes('mensajes de commit'))
  const f1Prompt = String(f1Req?.messages?.find((m) => m.role === 'user')?.content ?? '')
  git(['reset', '-q', '--hard', headF1])

  log(
    f1.message === 'Arregla el total de la factura\n\nEl redondeo se hacía antes de sumar.' && f1.kind === 'git' && f1.project === 'proyecto-f1' && f1.inHistory,
    'F1: UN MODELO ESCRIBE EL MENSAJE DEL COMMIT, LIMPIO, Y SU GASTO ENTRA EN EL HISTÓRICO',
    JSON.stringify(f1.message)
  )
  log(
    f1Prompt.includes('-total = redondea(a) + redondea(b)') && f1Prompt.includes('+total = redondea(a + b)') && f1Prompt.includes('- Añade la factura') && f1Prompt.includes('factura.js'),
    'le llega el diff que se confirmaría y los commits recientes, para copiar el estilo',
    f1Prompt.slice(0, 120).replace(/\n/g, ' ⏎ ')
  )
  log(String(f1.cleanError).includes('No hay cambios que confirmar'), 'sin cambios lo dice y no gasta nada', f1.cleanError)
  log(f1.box === 'Arregla el total de la factura\n\nEl redondeo se hacía antes de sumar.' && f1.note.includes('agente-de-prueba'), 'EN PROYECTOS › GIT, «ESCRIBIR CON IA» RELLENA EL MENSAJE Y DICE QUIÉN LO ESCRIBIÓ', f1.note)
  mockF1.close()

  /* -------------------------------------------------------------- *
   * G7 · Explorador: buscar en todo el proyecto y Ctrl+S           *
   * -------------------------------------------------------------- */
  const headG7 = git(['rev-parse', 'HEAD'])
  fs.mkdirSync(path.join(REPO, 'src', 'componentes'), { recursive: true })
  fs.writeFileSync(path.join(REPO, 'src', 'componentes', 'FilesPanel.tsx'), 'export {}\n')
  fs.writeFileSync(path.join(REPO, 'src', 'componentes', 'Otro.tsx'), 'export {}\n')
  fs.mkdirSync(path.join(REPO, 'node_modules', 'paquete'), { recursive: true })
  fs.writeFileSync(path.join(REPO, 'node_modules', 'paquete', 'FilesPanel.js'), '// no debe salir\n')
  fs.writeFileSync(path.join(REPO, 'windows.txt'), 'uno\r\ndos\r\n')

  const g7 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const setVal = (el, value) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
    const out = {}

    const s1 = (await api.files.search(repo, 'filespanel')).data
    out.byName = s1.hits.map((h) => h.rel).join(',')
    const s2 = (await api.files.search(repo, 'fpan')).data
    out.fuzzy = s2.hits[0] ? s2.hits[0].rel + ':' + s2.hits[0].marks.join('.') : null
    out.twoWords = (await api.files.search(repo, 'componentes otro')).data.hits.map((h) => h.rel).join(',')
    out.empty = (await api.files.search(repo, '   ')).data.total

    await api.projects.save({ id: 'proyecto-g7', name: 'Repo g7', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(300)
    engine.navigate({ page: 'projects', projectId: 'proyecto-g7', tab: 'files' })
    const box = await until(() => document.querySelector('[data-files-panel] [data-files-search]'))
    box.focus()
    setVal(box, 'nota')
    const hit = await until(() => document.querySelector('[data-files-results] [data-hit="sub/nota.txt"]'))
    out.uiHit = Boolean(hit)
    out.noHeavy = ![...document.querySelectorAll('[data-files-results] [data-hit]')].some((b) => b.getAttribute('data-hit').includes('node_modules'))
    key(box, 'Enter')
    const area = await until(() => { const t = document.querySelector('[data-files-panel] textarea'); return t && t.value.startsWith('hola') ? t : null })
    out.opened = Boolean(area)

    // Ctrl+S sin el cursor en el texto.
    setVal(area, 'hola editado\\n')
    await sleep(100)
    document.activeElement?.blur()
    key(window, 's', { ctrlKey: true })
    await sleep(700)

    // Un fichero con CRLF sigue con CRLF.
    setVal(box, 'windows')
    await until(() => document.querySelector('[data-files-results] [data-hit="windows.txt"]'))
    key(box, 'Enter')
    const area2 = await until(() => { const t = document.querySelector('[data-files-panel] textarea'); return t && t.value.startsWith('uno') ? t : null })
    setVal(area2, 'uno\\ndos\\ntres\\n')
    await sleep(100)
    key(area2, 's', { ctrlKey: true })
    await sleep(700)

    // Crear un fichero: queda abierto con el cursor dentro, y Ctrl+S lo guarda.
    key(box, 'Escape')
    await sleep(100)
    out.backToTree = !document.querySelector('[data-files-results]')
    const newBtn = [...document.querySelectorAll('[data-files-panel] button')].find((b) => b.title === 'Fichero nuevo' || b.title === 'Archivo nuevo' || b.title === 'Nuevo fichero')
    out.newBtn = newBtn?.title ?? null
    newBtn?.click()
    const nameInput = await until(() => document.querySelector('.fixed.inset-0 input'))
    if (nameInput) {
      setVal(nameInput, 'nuevo.md')
      key(nameInput, 'Enter')
    }
    const focused = await until(() => { const a = document.activeElement; return a && a.tagName === 'TEXTAREA' && a.closest('[data-files-panel]') ? a : null })
    out.focusedNew = Boolean(focused)
    if (focused) {
      setVal(focused, '# Nuevo\\n')
      await sleep(100)
      key(focused, 's', { ctrlKey: true })
      await sleep(700)
    }

    // Con el explorador oculto, Ctrl+S no guarda nada suyo.
    if (focused) setVal(focused, '# Nuevo cambiado\\n')
    await sleep(100)
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    await sleep(300)
    document.activeElement?.blur()
    key(window, 's', { ctrlKey: true })
    await sleep(600)

    await api.projects.remove('proyecto-g7')
    return out
  })()`)
  const readG7 = (rel) => (fs.existsSync(path.join(REPO, rel)) ? fs.readFileSync(path.join(REPO, rel), 'utf8') : null)
  const notaG7 = readG7('sub/nota.txt')
  const winG7 = readG7('windows.txt')
  const nuevoG7 = readG7('nuevo.md')
  git(['reset', '-q', '--hard', headG7])
  git(['clean', '-qfd'])
  fs.rmSync(path.join(REPO, 'node_modules'), { recursive: true, force: true })

  log(
    g7.byName === 'src/componentes/FilesPanel.tsx' && g7.fuzzy?.startsWith('src/componentes/FilesPanel.tsx:0.') && g7.twoWords === 'src/componentes/Otro.tsx' && g7.empty === 0,
    'G7: LA BÚSQUEDA MIRA TODO EL PROYECTO, SIN NODE_MODULES, Y ENCUENTRA POR LETRAS SUELTAS',
    `${g7.byName} · ${g7.fuzzy} · ${g7.twoWords}`
  )
  log(g7.uiHit && g7.noHeavy && g7.opened, 'EN EL EXPLORADOR FILTRA MIENTRAS ESCRIBES Y ENTER ABRE EL FICHERO')
  log(notaG7 === 'hola editado\n', 'CTRL+S GUARDA AUNQUE EL CURSOR NO ESTÉ EN EL TEXTO', JSON.stringify(notaG7))
  log(winG7 === 'uno\r\ndos\r\ntres\r\n', 'un fichero con finales de línea de Windows los conserva al guardar', JSON.stringify(winG7))
  log(g7.backToTree && g7.focusedNew && nuevoG7 === '# Nuevo\n', 'AL CREAR UN FICHERO QUEDA ABIERTO PARA ESCRIBIR Y CTRL+S LO GUARDA', `${g7.newBtn} · ${JSON.stringify(nuevoG7)}`)

  /* -------------------------------------------------------------- *
   * F2 · Pull requests y CI por gh                                 *
   * -------------------------------------------------------------- */
  const mockF2 = await startAgentMock()
  const f2Dir = path.join(FIXTURES, 'gh-falso')
  fs.mkdirSync(f2Dir, { recursive: true })
  const ghLog = path.join(f2Dir, 'llamadas.jsonl')
  const ghCreated = path.join(f2Dir, 'creada.json')
  fs.writeFileSync(
    path.join(f2Dir, 'gh.js'),
    [
      "const fs = require('node:fs')",
      'const args = process.argv.slice(2)',
      "fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, cwd: process.cwd() }) + String.fromCharCode(10))",
      "const out = (o) => process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o))",
      "const cmd = args.slice(0, 2).join(' ')",
      'const now = new Date().toISOString()',
      "const pr7 = { number: 7, title: 'Mejora el panel', url: 'https://github.com/h/r/pull/7', state: 'OPEN', isDraft: false, headRefName: 'panel', baseRefName: 'main', author: { login: 'hugo' }, updatedAt: now, reviewDecision: 'APPROVED',",
      "  statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }, { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }, { __typename: 'StatusContext', state: 'SUCCESS' }] }",
      "if (args[0] === '--version') out('gh version 2.60.0 (falso)')",
      "else if (args[0] === 'api') out({ login: 'hugo', name: 'Hugo', url: 'https://github.com/hugo' })",
      "else if (args[0] === 'auth') process.stderr.write('  - Token scopes: repo')",
      'else if (cmd === \'pr list\') out([pr7])',
      "else if (cmd === 'pr view') {",
      "  if (fs.existsSync(process.env.FAKE_GH_CREATED)) out({ ...pr7, number: 8, title: 'Añade el panel de PR', headRefName: 'rama-f2', reviewDecision: '', statusCheckRollup: [{ __typename: 'CheckRun', status: 'QUEUED' }] })",
      "  else { process.stderr.write('no pull requests found for branch \"rama-f2\"'); process.exit(1) }",
      '}',
      "else if (cmd === 'pr checks') { out([{ name: 'test', state: 'SUCCESS', bucket: 'pass', link: 'https://x', workflow: 'CI' }, { name: 'lint', state: 'FAILURE', bucket: 'fail', link: 'https://y', workflow: 'CI' }]); process.exit(1) }",
      "else if (cmd === 'run list') out([{ databaseId: 11, displayTitle: 'Arregla', workflowName: 'CI', status: 'completed', conclusion: 'success', headBranch: 'rama-f2', event: 'push', createdAt: now, url: 'https://github.com/h/r/actions/runs/11' }])",
      "else if (cmd === 'pr create') {",
      "  const i = args.indexOf('--body-file')",
      "  fs.writeFileSync(process.env.FAKE_GH_CREATED, JSON.stringify({ args, body: fs.readFileSync(args[i + 1], 'utf8') }))",
      "  out('https://github.com/h/r/pull/8' + String.fromCharCode(10))",
      '}',
      "else { process.stderr.write('orden desconocida: ' + args.join(' ')); process.exit(1) }"
    ].join('\n')
  )
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(f2Dir, 'gh.cmd'), `@node "${path.join(f2Dir, 'gh.js')}" %*\r\n`)
  } else {
    fs.writeFileSync(path.join(f2Dir, 'gh'), `#!/bin/sh\nexec node "${path.join(f2Dir, 'gh.js')}" "$@"\n`)
    fs.chmodSync(path.join(f2Dir, 'gh'), 0o755)
  }
  const pathBeforeF2 = process.env.PATH
  process.env.PATH = f2Dir + path.delimiter + process.env.PATH
  process.env.FAKE_GH_LOG = ghLog
  process.env.FAKE_GH_CREATED = ghCreated

  // Un origen de verdad (un repositorio desnudo) y una rama con un commit nuevo.
  const originF2 = path.join(TMP, 'f2-origen.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', originF2])
  const headF2 = git(['rev-parse', 'HEAD'])
  const branchBeforeF2 = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  git(['remote', 'add', 'origin', originF2])
  git(['push', '-q', 'origin', 'HEAD:main'])
  git(['fetch', '-q', 'origin'])
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  git(['checkout', '-q', '-b', 'rama-f2'])
  fs.writeFileSync(path.join(REPO, 'panel-pr.js'), 'module.exports = "PR"\n')
  git(['add', 'panel-pr.js'])
  git(['commit', '-qm', 'Añade el panel de PR'])

  const f2 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const setVal = (el, value) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const out = {}
    await api.github.refresh()
    const rep = (await api.git.pulls(repo)).data
    out.report = rep && {
      gh: rep.gh, github: rep.github, branch: rep.branch, base: rep.base, current: rep.current ?? null, needsPush: rep.needsPush, upstream: rep.upstream,
      open: rep.open.map((p) => p.number + ':' + JSON.stringify(p.checks) + ':' + p.review).join(','), runs: rep.runs.map((r) => r.workflow + ':' + r.conclusion).join(',')
    }
    const checks = await api.git.pullChecks(repo, 7)
    out.checks = checks.ok ? checks.data.map((c) => c.name + ':' + c.state).join(',') : checks.error

    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.config.settings({ gitModel: { providerId: 'vllm', model: 'agente-de-prueba' } })
    const desc = await api.git.describePull(repo, 'main', { providerId: 'vllm', model: 'agente-de-prueba' }, 'es')
    out.desc = desc.ok ? { title: desc.data.title, body: desc.data.body } : desc.error
    if (desc.ok) await api.runs.remove(desc.data.run.id)

    // Por la interfaz: Proyectos › Git › Abrir una PR.
    await api.projects.save({ id: 'proyecto-f2', name: 'Repo f2', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(300)
    engine.navigate({ page: 'projects', projectId: 'proyecto-f2', tab: 'git' })
    await until(() => document.querySelector('[data-pulls] [data-open-prs] [data-pr="7"]'))
    out.uiOpen = Boolean(document.querySelector('[data-pulls] [data-pr="7"] [data-checks]'))
    const openBtn = await until(() => document.querySelector('[data-pulls] [data-open-pr]'))
    openBtn?.click()
    const formEl = await until(() => document.querySelector('[data-pr-form]'))
    out.needsPushNote = formEl?.querySelector('[data-needs-push]')?.textContent ?? null
    document.querySelector('[data-ai-pr]')?.click()
    await until(() => document.querySelector('[data-pr-title]')?.value)
    out.uiTitle = document.querySelector('[data-pr-title]')?.value
    setVal(document.querySelector('[data-pr-body]'), 'Cuerpo escrito a mano')
    await sleep(100)
    document.querySelector('[data-create-pr]')?.click()
    out.current = await until(async () => { const r = (await api.git.pulls(repo)).data; return r?.current?.number === 8 ? r.current.number : null })
    out.formClosed = !document.querySelector('[data-pr-form]')
    out.uiCurrent = Boolean(await until(() => document.querySelector('[data-pulls] [data-pr="8"]')))

    for (const run of (await api.runs.query({ kind: 'git' })).data.rows) await api.runs.remove(run.id)
    await api.config.settings({ gitModel: null })
    await api.providers.setBaseUrl('vllm', out.prevBase)
    await api.projects.remove('proyecto-f2')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    return out
  })()`)
  let created = null
  try {
    created = JSON.parse(fs.readFileSync(ghCreated, 'utf8'))
  } catch {}
  let pushedF2 = false
  try {
    pushedF2 = Boolean(execFileSync('git', ['--git-dir', originF2, 'rev-parse', '--verify', 'rama-f2'], { encoding: 'utf8' }).trim())
  } catch {}
  const ghCalls = fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : ''
  const f2Prompt = String(
    (mockF2.requests ?? []).find((b) => String(b.messages?.find((m) => m.role === 'system')?.content ?? '').includes('descripciones de pull requests'))?.messages?.find((m) => m.role === 'user')?.content ?? ''
  )
  git(['checkout', '-q', branchBeforeF2])
  git(['branch', '-q', '-D', 'rama-f2'])
  git(['remote', 'remove', 'origin'])
  git(['reset', '-q', '--hard', headF2])
  process.env.PATH = pathBeforeF2
  await js(`window.api.github.refresh()`)

  const repF2 = f2.report ?? {}
  log(
    repF2.gh === 'ok' && repF2.github && repF2.branch === 'rama-f2' && repF2.base === 'main' && repF2.current === null && repF2.needsPush === true && repF2.upstream === false &&
      repF2.open === '7:{"pass":2,"fail":1,"pending":1,"total":4}:APPROVED' && repF2.runs === 'CI:success',
    'F2: LAS PR ABIERTAS CON SU CI, LA RAMA SIN PR Y LAS ACTIONS, TODO POR GH',
    JSON.stringify(repF2)
  )
  log(f2.checks === 'test:pass,lint:fail', 'las comprobaciones de una PR salen aunque gh termine con error por las que fallan', f2.checks)
  log(
    f2.desc?.title === 'Añade el panel de PR' && f2.desc.body.startsWith('- Lista las PR abiertas') && f2Prompt.includes('- Añade el panel de PR') && f2Prompt.includes('panel-pr.js') && f2Prompt.includes('hacia main'),
    'UN MODELO ESCRIBE EL TÍTULO Y LA DESCRIPCIÓN A PARTIR DE LOS COMMITS Y EL DIFF DE LA RAMA',
    JSON.stringify(f2.desc)
  )
  log(
    f2.uiOpen && (f2.needsPushNote ?? '').includes('git push -u origin HEAD') && f2.uiTitle === 'Añade el panel de PR' && f2.formClosed && f2.current === 8 && f2.uiCurrent,
    'DESDE EL PANEL SE ABRE LA PR: AVISA DE QUE SUBE LA RAMA Y LUEGO LA ENSEÑA',
    `${f2.needsPushNote} · ${f2.uiTitle}`
  )
  log(
    pushedF2 && created?.args?.join(' ').includes('--title Añade el panel de PR') && created.args.includes('--base') && created.args.includes('main') &&
      created.args.includes('--head') && created.args.includes('rama-f2') && created.body === 'Cuerpo escrito a mano',
    'LA RAMA SE SUBE A ORIGIN Y GH CREA LA PR CON SU TÍTULO, SU CUERPO Y SU BASE',
    JSON.stringify(created?.args)
  )
  log(!/auth token|--with-token|GH_TOKEN/.test(ghCalls), 'la app nunca pide el token a gh', ghCalls.split('\n').length - 1 + ' llamadas')
  mockF2.close()

  /* -------------------------------------------------------------- *
   * F3 · Revisión con IA antes del commit o de la PR               *
   * -------------------------------------------------------------- */
  const mockF3 = await startAgentMock()
  const headF3 = git(['rev-parse', 'HEAD'])
  const branchBeforeF3 = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  fs.writeFileSync(path.join(REPO, 'calc.js'), 'function div(a, b) {\n  return a\n}\n')
  git(['add', 'calc.js'])
  git(['commit', '-qm', 'Añade div'])
  const baseF3 = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  fs.writeFileSync(path.join(REPO, 'calc.js'), 'function div(a, b) {\n  return a / b\n}\n')

  const f3 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
    const out = {}
    const pick = { providerId: 'vllm', model: 'agente-de-prueba' }
    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.config.settings({ gitModel: pick })
    await api.projects.save({ id: 'proyecto-f3', name: 'Repo f3', path: repo, color: '#fff', createdAt: Date.now() })
    await sleep(300)

    const r = await api.git.review(repo, 'commit', undefined, pick, 'es')
    out.api = r.ok ? { summary: r.data.summary, comments: r.data.comments.map((c) => c.file + ':' + c.line + ':' + c.severity).join(','), diffHasCalc: r.data.diff.includes('+  return a / b'), kind: r.data.run.kind } : r.error

    // Por la interfaz: Proyectos › Git › Revisar con IA.
    engine.navigate({ page: 'projects', projectId: 'proyecto-f3', tab: 'git' })
    const btn = await until(() => document.querySelector('[data-ai-review-commit]:not([disabled])'))
    btn?.click()
    const box = await until(() => document.querySelector('[data-ai-review] [data-ai-summary]'))
    out.summary = box?.textContent
    const errorBox = document.querySelector('[data-ai-review] [data-ai-comment="error"]')
    // El comentario va justo debajo de la línea que cambió (la 2 nueva: «return a / b»).
    out.errorAfter = errorBox?.previousElementSibling?.textContent ?? ''
    out.loose = document.querySelector('[data-ai-review] [data-ai-loose]')?.textContent ?? ''
    out.before = document.querySelectorAll('[data-ai-review] [data-ai-comment]').length
    document.querySelector('[data-ai-review] [data-ai-comment="info"] button')?.click()
    await sleep(150)
    out.after = document.querySelectorAll('[data-ai-review] [data-ai-comment]').length
    ;[...document.querySelectorAll('.fixed.inset-0 button')].find((b) => b.textContent.trim() === 'Cerrar')?.click()

    for (const run of (await api.runs.query({ kind: 'git' })).data.rows) await api.runs.remove(run.id)
    return out
  })()`)
  // La rama entera contra su base.
  git(['stash', '-q'])
  git(['checkout', '-q', '-b', 'rama-f3'])
  git(['stash', 'pop', '-q'])
  git(['commit', '-qam', 'Divide de verdad'])
  const f3b = await js(`(async () => {
    const api = window.api
    const r = await api.git.review(${JSON.stringify(REPO)}, 'branch', ${JSON.stringify(baseF3)}, { providerId: 'vllm', model: 'agente-de-prueba' }, 'es')
    const out = r.ok ? { diffHasCalc: r.data.diff.includes('+  return a / b'), n: r.data.comments.length } : { error: r.error }
    const none = await api.git.review(${JSON.stringify(REPO)}, 'branch', 'rama-f3', { providerId: 'vllm', model: 'agente-de-prueba' }, 'es')
    out.sameBranch = none.ok ? 'no falló' : none.error
    for (const run of (await api.runs.query({ kind: 'git' })).data.rows) await api.runs.remove(run.id)
    await api.config.settings({ gitModel: null })
    await api.providers.setBaseUrl('vllm', ${JSON.stringify(f3.prevBase ?? '')})
    await api.projects.remove('proyecto-f3')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    return out
  })()`)
  const f3Prompt = String(
    (mockF3.requests ?? []).find((b) => String(b.messages?.find((m) => m.role === 'system')?.content ?? '').includes('revisor de código'))?.messages?.find((m) => m.role === 'user')?.content ?? ''
  )
  git(['checkout', '-q', branchBeforeF3])
  git(['branch', '-q', '-D', 'rama-f3'])
  git(['reset', '-q', '--hard', headF3])

  log(
    f3.api?.summary === 'Hay una división por cero.' && f3.api.comments === 'calc.js:2:error,calc.js:1:info,otro/inexistente.js:5:warning' && f3.api.diffHasCalc && f3.api.kind === 'git' &&
      f3Prompt.includes('+  return a / b') && f3Prompt.includes('"severity"'),
    'F3: UN MODELO REVISA EL DIFF Y SUS COMENTARIOS SE LEEN AUNQUE VENGAN ENVUELTOS EN TEXTO',
    JSON.stringify(f3.api)
  )
  log(
    f3.summary === 'Hay una división por cero.' && f3.errorAfter.includes('return a / b') && f3.loose.includes('otro/inexistente.js') && f3.before === 3 && f3.after === 2,
    'EN EL PANEL, CADA COMENTARIO SALE DEBAJO DE SU LÍNEA; LO QUE NO ESTÁ EN EL DIFF, APARTE; Y SE PUEDEN DESCARTAR',
    `${f3.errorAfter.trim()} · ${f3.before}→${f3.after}`
  )
  log(f3b.diffHasCalc && f3b.n === 3 && String(f3b.sameBranch).includes('no tiene cambios'), 'también revisa la rama entera contra su base antes de la PR', JSON.stringify(f3b))
  mockF3.close()

  /* -------------------------------------------------------------- *
   * G1 · Paleta de comandos (Ctrl+K)                               *
   * -------------------------------------------------------------- */
  fs.writeFileSync(path.join(REPO, 'package.json'), JSON.stringify({ name: 'g1', scripts: { 'saluda-g1': 'echo hola-g1' } }))

  const g1 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const setVal = (el, value) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
    const palette = () => document.querySelector('[data-palette]')
    const input = () => document.querySelector('[data-palette-input]')
    const first = () => document.querySelector('[data-palette-results] [data-palette-index="0"]')
    const openP = async () => { key(window, 'k', { ctrlKey: true }); return until(() => input()) }
    const search = async (text, id) => {
      setVal(input(), text)
      return until(() => { const f = first(); return f && (!id || f.getAttribute('data-palette-item') === id) ? f : null })
    }
    const out = {}

    await api.projects.save({ id: 'proyecto-g1', name: 'Zanfaturas Gé', path: repo, color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'agente-g1', name: 'Xilófono G1', type: 'cli', command: 'true', args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    const sid = await engine.newSession('chat', { title: 'Canción del ñandú zq1' })
    await sleep(400)

    // Se abre y se cierra con Ctrl+K; sin texto enseña un poco de cada cosa, por grupos.
    await openP()
    out.opened = Boolean(palette())
    out.groups = [...palette().querySelectorAll('[data-palette-results] > div')].map((d) => d.textContent.trim()).join('|')
    key(window, 'k', { ctrlKey: true })
    await sleep(150)
    out.closedAgain = !palette()

    // Un proyecto por un trozo de su nombre, marcado.
    await openP()
    const p = await search('zanfat', 'project:proyecto-g1')
    out.project = p?.getAttribute('data-palette-item') ?? first()?.getAttribute('data-palette-item')
    out.mark = p?.querySelector('mark')?.textContent ?? ''
    // Y una de sus pestañas con dos palabras: Enter lleva a Proyectos › Git.
    const tab = await search('zanfat git', 'project:proyecto-g1:git')
    out.tab = tab?.getAttribute('data-palette-item') ?? first()?.getAttribute('data-palette-item')
    key(input(), 'Enter')
    await sleep(150)
    out.closedOnEnter = !palette()
    out.gitShown = Boolean(await until(() => { const b = document.querySelector('[data-ai-review-commit]'); return b && b.offsetParent ? b : null }))

    // Una conversación sin tildes ni orden: «nandu cancion».
    await openP()
    const s = await search('nandu cancion', 'session:' + sid)
    out.session = s?.getAttribute('data-palette-item') === 'session:' + sid
    out.sessionMarks = s ? [...s.querySelectorAll('mark')].map((m) => m.textContent).join(',') : first()?.textContent
    key(input(), 'Enter')
    out.chatActive = Boolean(await until(() => document.querySelector('[data-session-item="' + sid + '"][data-active]')))

    // Lo que acabas de elegir sale arriba, en Recientes, al volver a abrir.
    await openP()
    out.recent = palette().querySelector('[data-palette-results] > div')?.textContent.trim() + ':' + first()?.getAttribute('data-palette-item')

    // Las iniciales valen: «cn» → Conversación nueva.
    setVal(input(), 'cn')
    await sleep(150)
    out.initials = Boolean(document.querySelector('[data-palette-item="action:new-chat"]'))
    // Sin nada que encaje queda buscar lo escrito en los mensajes.
    setVal(input(), 'qwxzv')
    await sleep(150)
    out.fallback = [...document.querySelectorAll('[data-palette-item]')].map((b) => b.getAttribute('data-palette-item')).join(',')

    // Un agente: abre una sesión nueva con él en la Consola.
    const before = new Set(engine.peekSessions().map((x) => x.id))
    await search('xilofono', 'cli:agente-g1')
    key(input(), 'Enter')
    const made = await until(() => engine.peekSessions().find((x) => !before.has(x.id)))
    out.agentSession = made ? made.kind + ':' + made.cliAgentId : null
    out.agentActive = made ? Boolean(await until(() => document.querySelector('[data-session-item="' + made.id + '"][data-active]'))) : false

    // Un script del package.json: se lanza en la terminal del proyecto.
    await openP()
    const sc = await search('zanfat saluda', 'script:proyecto-g1:saluda-g1')
    out.scriptDetail = sc?.textContent ?? first()?.textContent
    key(input(), 'Enter')
    const term = await until(() => Object.values(engine.peekTerms()).find((x) => x.info.projectId === 'proyecto-g1'), 10000)
    out.scriptSent = term ? Boolean(await until(() => engine.termScrollback(term.info.id).includes('saluda-g1'), 15000)) : false
    out.scriptOutput = term ? Boolean(await until(() => engine.termScrollback(term.info.id).includes('hola-g1'), 15000)) : false

    // Limpieza.
    if (term) await engine.closeTerm(term.info.id)
    await engine.deleteSession(sid)
    if (made) await engine.deleteSession(made.id)
    await api.agents.removeCli('agente-g1')
    await api.projects.remove('proyecto-g1')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    return out
  })()`)
  fs.rmSync(path.join(REPO, 'package.json'), { force: true })

  log(
    g1.opened && g1.groups.includes('Acciones') && g1.groups.includes('Secciones') && g1.closedAgain,
    'G1: CTRL+K ABRE LA PALETA Y LA CIERRA; SIN TEXTO ENSEÑA UN POCO DE CADA COSA',
    g1.groups
  )
  log(
    g1.project === 'project:proyecto-g1' && g1.mark === 'Zanfat' && g1.tab === 'project:proyecto-g1:git' && g1.closedOnEnter && g1.gitShown,
    'ENCUENTRA UN PROYECTO Y SU PESTAÑA DE GIT, Y ENTER LLEVA ALLÍ',
    `${g1.project} · «${g1.mark}» · ${g1.tab} · git:${g1.gitShown}`
  )
  log(
    g1.session && /Canción/.test(g1.sessionMarks) && /ñandú/.test(g1.sessionMarks) && g1.chatActive,
    'ENCUENTRA UNA CONVERSACIÓN SIN TILDES NI ORDEN Y LA ABRE EN LA CONSOLA',
    g1.sessionMarks
  )
  log(String(g1.recent).startsWith('Recientes:session:'), 'lo último que elegiste sale arriba, en Recientes', g1.recent)
  log(g1.initials && g1.fallback === 'action:search-text', 'vale con las iniciales y, si nada encaja, queda buscar en los mensajes', g1.fallback)
  log(g1.agentSession === 'cli:agente-g1' && g1.agentActive, 'UN AGENTE ABRE UNA SESIÓN NUEVA CON ÉL', String(g1.agentSession))
  log(
    /pnpm run saluda-g1/.test(g1.scriptDetail ?? '') && g1.scriptSent && g1.scriptOutput,
    'UN SCRIPT DEL PACKAGE.JSON SE LANZA EN LA TERMINAL DEL PROYECTO',
    `${(g1.scriptDetail ?? '').trim()} · enviado:${g1.scriptSent} · salida:${g1.scriptOutput}`
  )
  /* -------------------------------------------------------------- *
   * G2 · Bandeja del sistema: cerrar no corta lo que está en marcha *
   * -------------------------------------------------------------- */
  const { dialog: dlgG2 } = require('electron')
  const realBox = dlgG2.showMessageBoxSync
  const boxes = []
  let answer = 2
  dlgG2.showMessageBoxSync = (...a) => {
    const opts = a.find((x) => x && typeof x === 'object' && 'buttons' in x)
    boxes.push(opts)
    return answer
  }
  const sleepG2 = (n) => new Promise((r) => setTimeout(r, n))
  await js(`window.api.config.settings({ closeToTray: true, trayHintShown: false })`)

  // Con la bandeja (lo normal): cerrar esconde la ventana; la app y la ventana siguen vivas.
  const termG2 = await js(`window.__accEngine.openTerm({ title: 'g2' }).then((r) => r.id)`)
  win.close()
  await sleepG2(400)
  const g2 = { hidden: !win.isDestroyed() && !win.isVisible(), boxesAfterClose: boxes.length }
  g2.hint = (await js(`window.api.config.get()`)).data.settings.trayHintShown === true
  // La ventana escondida sigue trabajando: la terminal responde.
  await js(`window.__accEngine.sendTermCommand(${JSON.stringify(termG2)}, 'echo sigue-g2')`)
  const endG2 = Date.now() + 8000
  while (Date.now() < endG2 && !(await js(`window.__accEngine.termScrollback(${JSON.stringify(termG2)})`)).split('sigue-g2').length <= 2) await sleepG2(150)
  g2.termAlive = (await js(`window.__accEngine.termScrollback(${JSON.stringify(termG2)})`)).split('sigue-g2').length > 2
  // Abrir la app otra vez (segunda instancia) trae la ventana.
  app.emit('second-instance', {}, [], process.cwd())
  await sleepG2(300)
  g2.shownAgain = win.isVisible()

  // «Cerrar sale»: con algo en marcha pregunta antes. Cancelar deja la ventana.
  await js(`window.api.config.settings({ closeToTray: false })`)
  await js(`window.api.app.setBusy({ chats: 1, arena: 0, terms: 1 })`)
  answer = 2
  win.close()
  await sleepG2(300)
  g2.asked = boxes[0] ? boxes[0].message + ' | ' + boxes[0].detail + ' | ' + boxes[0].buttons.join('/') : null
  g2.cancelKeeps = !win.isDestroyed() && win.isVisible()
  // «Seguir en la bandeja» la esconde en ese momento.
  answer = 1
  win.close()
  await sleepG2(300)
  g2.trayChoice = !win.isDestroyed() && !win.isVisible()
  app.emit('second-instance', {}, [], process.cwd())
  await sleepG2(300)

  dlgG2.showMessageBoxSync = realBox
  await js(`(async () => {
    await window.__accEngine.closeTerm(${JSON.stringify(termG2)})
    await window.api.config.settings({ closeToTray: true })
  })()`)
  win.show()

  log(g2.hidden && g2.boxesAfterClose === 0 && g2.hint, 'G2: CERRAR LA VENTANA LA ESCONDE EN LA BANDEJA, SIN PREGUNTAR, Y AVISA UNA VEZ', JSON.stringify({ hidden: g2.hidden, hint: g2.hint }))
  log(g2.termAlive, 'LO QUE ESTÁ EN MARCHA SIGUE CON LA VENTANA ESCONDIDA', 'la terminal contesta')
  log(g2.shownAgain, 'abrir la app otra vez trae la ventana escondida')
  log(
    /2 cosas en marcha/.test(g2.asked ?? '') && /Consola/.test(g2.asked ?? '') && /Seguir en la bandeja/.test(g2.asked ?? '') && g2.cancelKeeps && g2.trayChoice,
    'CON «CERRAR SALE» PREGUNTA SI HAY ALGO EN MARCHA; CANCELAR LA DEJA Y SE PUEDE MANDAR A LA BANDEJA',
    g2.asked
  )
  /* -------------------------------------------------------------- *
   * G3 · Atajo global y prompt rápido                              *
   * -------------------------------------------------------------- */
  const mockG3 = await startAgentMock()
  const { BrowserWindow: BWG3 } = require('electron')
  const sleepG3 = (n) => new Promise((r) => setTimeout(r, n))
  const untilG3 = async (fn, ms = 10000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const v = await fn()
      if (v) return v
      await sleepG3(100)
    }
    return null
  }
  const g3 = await js(`(async () => {
    const api = window.api
    const out = {}
    out.prevBase = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${API_PORT}/v1')
    await api.config.settings({ quickModel: { providerId: 'vllm', model: 'agente-de-prueba' } })
    out.status = (await api.quick.status()).data
    await api.config.settings({ quickHotkey: 'Nada+Que+Ver' })
    out.invalid = (await api.quick.status()).data
    await api.config.settings({ quickHotkey: '' })
    out.off = (await api.quick.status()).data
    await api.config.settings({ quickHotkey: undefined })
    out.back = (await api.quick.status()).data
    out.before = window.__accEngine.peekSessions().map((s) => s.id)
    await api.quick.open()
    return out
  })()`)

  const qwin = await untilG3(() => BWG3.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('#quick')))
  const qjs = (code) => qwin.webContents.executeJavaScript(code)
  await untilG3(async () => !qwin.webContents.isLoading() && (await qjs(`Boolean(document.querySelector('[data-quick-input]'))`)))
  await sleepG3(700)
  // Si perdió el foco se esconde sola (como Spotlight): entonces se vuelve a abrir y se mira al momento.
  if (!qwin.isVisible()) {
    await js(`window.api.quick.open()`)
    await untilG3(() => qwin.isVisible(), 3000)
    await sleepG3(500)
  }
  g3.visible = qwin.isVisible()
  g3.onTop = qwin.isAlwaysOnTop()
  // `--quick` en una segunda instancia (un atajo del escritorio) abre la ventanita.
  qwin.hide()
  app.emit('second-instance', {}, [process.execPath, '--quick'], process.cwd())
  g3.flag = Boolean(await untilG3(() => qwin.isVisible(), 3000))
  g3.command = (await js(`window.api.quick.status()`)).data?.command
  const ask = (text) =>
    qjs(`(async () => {
      const box = document.querySelector('[data-quick-input]')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)})
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })()`)
  // Espera a que el modelo esté elegido (el botón de enviar se habilita al escribir).
  await untilG3(() => qjs(`Boolean(document.querySelector('[data-quick] button[aria-label]')) && !document.querySelector('[data-quick] [data-quick-input]').disabled`))
  await sleepG3(800)
  await ask('eco: hola rápido')
  await untilG3(() => qjs(`document.querySelectorAll('[data-quick-exchange="done"]').length === 1`), 15000)
  g3.first = await qjs(`document.querySelector('[data-quick-exchange="done"] [data-quick-answer]')?.textContent ?? ''`)
  await ask('eco: otra')
  await untilG3(() => qjs(`document.querySelectorAll('[data-quick-exchange="done"]').length === 2`), 15000)
  g3.second = await qjs(`[...document.querySelectorAll('[data-quick-exchange="done"] [data-quick-answer]')][1]?.textContent ?? ''`)
  g3.empty = await qjs(`window.api.quick.submit({ prompt: '   ', providerId: 'vllm', model: 'agente-de-prueba' }).then((r) => r.ok ? 'aceptado' : r.error)`)

  // La conversación es de la Consola: una sola, con las dos preguntas.
  const g3s = await js(`(async () => {
    const e = window.__accEngine
    const before = new Set(${JSON.stringify(g3.before)})
    const made = e.peekSessions().filter((s) => !before.has(s.id))
    const chat = made[0] ? e.peekChat(made[0].id) : null
    return { n: made.length, id: made[0]?.id, turns: chat ? chat.turns.map((t) => t.role + ':' + t.content).join(' | ') : null }
  })()`)

  // «Seguir en la Consola»: se esconde la ventanita y se abre esa conversación.
  await qjs(`document.querySelector('[data-quick-console]')?.click()`)
  await sleepG3(500)
  g3.hiddenAfterConsole = !qwin.isVisible()
  g3.consoleActive = await js(`(async () => {
    const end = Date.now() + 5000
    while (Date.now() < end) {
      if (document.querySelector('[data-session-item="${g3s.id}"][data-active]')) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  })()`)

  // Desde la paleta se abre; Esc la esconde.
  await js(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    const input = document.querySelector('[data-palette-input]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'prompt rapido')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    const first = document.querySelector('[data-palette-results] [data-palette-index="0"]')
    window.__g3first = first?.getAttribute('data-palette-item')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })()`)
  g3.paletteFirst = await js(`window.__g3first`)
  g3.fromPalette = Boolean(await untilG3(() => qwin.isVisible(), 3000))
  await qjs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await sleepG3(300)
  g3.escHides = !qwin.isVisible()

  await js(`(async () => {
    await window.__accEngine.deleteSession(${JSON.stringify(g3s.id ?? '')})
    await window.api.config.settings({ quickModel: null })
    await window.api.providers.setBaseUrl('vllm', ${JSON.stringify(g3.prevBase ?? '')})
    for (const run of (await window.api.runs.query({ search: 'eco: ' })).data.rows ?? []) if (/hola rápido|otra/.test(run.prompt)) await window.api.runs.remove(run.id)
  })()`)
  win.show()
  mockG3.close()

  log(
    typeof g3.status?.registered === 'boolean' && g3.status.accelerator === g3.status.defaultAccelerator &&
      g3.invalid?.error === 'invalid' && g3.off?.accelerator === '' && g3.off.registered === false && g3.back?.accelerator === g3.status.defaultAccelerator,
    'G3: EL ATAJO GLOBAL SE REGISTRA, SE APAGA, VUELVE AL DE SIEMPRE Y DICE SI NO VALE',
    `${g3.status?.accelerator} registrado:${g3.status?.registered} · inválido:${g3.invalid?.error}`
  )
  log(g3.visible && g3.onTop, 'la ventanita se abre encima de todo', JSON.stringify({ visible: g3.visible, onTop: g3.onTop }))
  log(
    g3.flag && (process.platform !== 'linux' || / --quick$/.test(g3.command ?? '')),
    'lanzar la app con --quick abre la ventanita: sirve para un atajo del escritorio (Wayland)',
    String(g3.command)
  )
  log(
    /Eco 1: hola rápido/.test(g3.first) && /Eco 2: otra/.test(g3.second),
    'PREGUNTA DESDE LA VENTANITA, VE LA RESPUESTA Y LA SIGUIENTE PREGUNTA CONTINÚA LA MISMA CONVERSACIÓN',
    `${g3.first.trim()} · ${g3.second.trim()}`
  )
  log(
    g3s.n === 1 && /user:eco: hola rápido \| assistant:Eco 1: hola rápido \| user:eco: otra \| assistant:Eco 2: otra/.test(g3s.turns ?? ''),
    'LA CONVERSACIÓN QUEDA GUARDADA EN LA CONSOLA',
    String(g3s.turns)
  )
  log(g3.hiddenAfterConsole && g3.consoleActive, '«Seguir en la Consola» esconde la ventanita y abre esa conversación', JSON.stringify({ hidden: g3.hiddenAfterConsole, active: g3.consoleActive }))
  log(g3.paletteFirst === 'action:quick' && g3.fromPalette && g3.escHides, 'se abre desde la paleta y Esc la esconde', String(g3.paletteFirst))
  log(g3.empty === 'Escribe algo', 'no se lanza un prompt vacío', String(g3.empty))
  /* -------------------------------------------------------------- *
   * G4 · Aviso de versión nueva (GitHub Releases, sin instalar)    *
   * -------------------------------------------------------------- */
  const currentG4 = app.getVersion()
  let replyG4 = null
  const hitsG4 = []
  const ghG4 = http.createServer((req, res) => {
    hitsG4.push({ url: req.url, ua: req.headers['user-agent'] ?? '' })
    const r = replyG4 ?? { status: 404, body: {} }
    res.writeHead(r.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(r.body))
  })
  await new Promise((r) => ghG4.listen(0, '127.0.0.1', r))
  process.env.ACC_RELEASES_URL = `http://127.0.0.1:${ghG4.address().port}/repos/x/y/releases/latest`
  const asset = (name) => ({ name, size: 123456789, browser_download_url: `https://github.com/Hredo/ai-command-center/releases/download/v99.0.0/${name}` })
  const release = (tag) => ({
    status: 200,
    body: {
      tag_name: tag,
      html_url: `https://github.com/Hredo/ai-command-center/releases/tag/${tag}`,
      published_at: '2026-10-01T10:00:00Z',
      draft: false,
      body: '## Novedades\n\n- Paleta de comandos\n- Prompt rápido',
      assets: [
        asset('AI-Command-Center-Setup-99.0.0.exe'),
        asset('AI-Command-Center-99.0.0-x64.zip'),
        asset('AI-Command-Center-99.0.0-mac-arm64.dmg'),
        asset('AI-Command-Center-99.0.0-mac-x64.dmg'),
        asset('AI-Command-Center-99.0.0-linux-x86_64.AppImage'),
        asset('AI-Command-Center-99.0.0-linux-amd64.deb'),
        asset('AI-Command-Center-99.0.0-linux-arm64.AppImage'),
        asset('SHA256SUMS.txt')
      ]
    }
  })

  replyG4 = release('v99.0.0')
  const g4 = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    await api.config.settings({ skippedVersion: undefined, checkUpdates: true })
    const u = (await api.updates.check()).data
    out.api = { newer: u.newer, latest: u.latest, kinds: u.downloads.map((d) => d.kind).join(','), url: u.url, notes: u.notes.includes('Prompt rápido') }
    const chip = await until(() => document.querySelector('[data-update-chip]'))
    out.chip = chip?.textContent ?? ''
    out.toast = Boolean(await until(() => [...document.querySelectorAll('.fixed.bottom-4 span')].some((s) => s.textContent.includes('Hay una versión nueva: v99.0.0'))))

    window.__accEngine.navigate({ page: 'settings', tab: 'prefs' })
    await until(() => document.querySelector('[data-updates] [data-update-latest]'))
    out.panelLatest = document.querySelector('[data-update-latest]')?.textContent
    out.primary = document.querySelector('[data-update-download]')?.getAttribute('data-update-download')
    document.querySelector('[data-update-notes-toggle]')?.click()
    out.notesShown = Boolean(await until(() => document.querySelector('[data-update-notes]')?.textContent.includes('Paleta de comandos')))

    // Omitir esta versión: deja de anunciarse sin volver a preguntar a GitHub.
    document.querySelector('[data-update-skip]')?.click()
    out.chipGone = Boolean(await until(() => !document.querySelector('[data-update-chip]')))
    out.skippedText = (await until(() => { const s = document.querySelector('[data-update-state]')?.textContent ?? ''; return s.includes('Omitiste') ? s : null })) ?? document.querySelector('[data-update-state]')?.textContent
    document.querySelector('[data-update-unskip]')?.click()
    out.chipBack = Boolean(await until(() => document.querySelector('[data-update-chip]')))
    return out
  })()`)

  replyG4 = release('v' + currentG4)
  g4.same = await js(`window.api.updates.check().then((r) => ({ newer: r.data.newer, state: null }))`)
  g4.sameState = await js(`(async () => { await new Promise((r) => setTimeout(r, 300)); return document.querySelector('[data-update-state]')?.textContent + '|' + Boolean(document.querySelector('[data-update-chip]')) })()`)
  replyG4 = release('v0.0.1')
  g4.older = await js(`window.api.updates.check().then((r) => r.data.newer)`)
  replyG4 = { status: 500, body: {} }
  g4.error = await js(`window.api.updates.check().then((r) => r.data.error)`)
  replyG4 = { status: 403, body: { message: 'API rate limit exceeded' } }
  g4.limited = await js(`window.api.updates.check().then((r) => r.data.error)`)
  g4.ua = hitsG4[0]?.ua ?? ''

  await js(`(async () => {
    await window.api.config.settings({ skippedVersion: undefined })
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
  })()`)
  delete process.env.ACC_RELEASES_URL
  ghG4.close()

  log(
    g4.api.newer && g4.api.latest === '99.0.0' && g4.api.kinds === 'appimage,deb,checksums' && /releases\/tag\/v99\.0\.0$/.test(g4.api.url) && g4.api.notes,
    'G4: DETECTA UNA VERSIÓN NUEVA EN GITHUB Y ELIGE LA DESCARGA DE ESTE SISTEMA',
    JSON.stringify(g4.api)
  )
  log(/v99\.0\.0 disponible/.test(g4.chip) && g4.toast, 'LA BARRA DE ARRIBA Y UN AVISO LO DICEN', `${g4.chip} · aviso:${g4.toast}`)
  log(g4.panelLatest === 'v99.0.0' && g4.primary === 'appimage' && g4.notesShown, 'en Ajustes salen la versión, la descarga recomendada y las notas', `${g4.panelLatest} · ${g4.primary}`)
  log(g4.chipGone && /Omitiste la v99\.0\.0/.test(g4.skippedText ?? '') && g4.chipBack, '«Omitir esta versión» deja de anunciarla y se puede deshacer', String(g4.skippedText))
  log(
    g4.same.newer === false && /Tienes la última versión/.test(g4.sameState) && g4.sameState.endsWith('|false') && g4.older === false,
    'con la misma versión o una más vieja no avisa',
    g4.sameState
  )
  log(
    g4.error === 'GitHub respondió con un error' && /limitado/.test(g4.limited ?? '') && g4.ua.startsWith('ai-command-center/'),
    'si GitHub falla o limita las consultas lo dice, sin inventar nada',
    `${g4.error} · ${g4.limited}`
  )
  /* -------------------------------------------------------------- *
   * G5 · Tareas programadas                                        *
   * -------------------------------------------------------------- */
  const headG5 = git(['rev-parse', 'HEAD'])
  const g5 = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const bins = ${JSON.stringify(BINS)}
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150) } return null }
    const get = async (id) => (await api.schedules.list()).data.find((s) => s.id === id)
    const out = {}
    for (const s of (await api.config.get()).data.schedules ?? []) if (s.id.startsWith('g5-')) await api.schedules.remove(s.id)
    await api.projects.save({ id: 'proyecto-g5', name: 'Repo g5', path: repo, color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'tarea-g5', name: 'Tarea G5', type: 'cli', command: bins.task, args: [], parser: 'plain', color: '#fff', createdAt: Date.now() })
    await sleep(300)
    const before = new Set(engine.peekSessions().map((s) => s.id))
    const base = { enabled: true, projectId: 'proyecto-g5', agent: 'cli:tarea-g5', worktree: true, prompt: 'programada zq5', catchUp: true }

    // Lo que no vale no se guarda.
    out.noPrompt = (await api.schedules.save({ ...base, id: 'g5-mal', name: 'x', prompt: '  ', repeat: 'daily', createdAt: Date.now() })).error
    out.noProject = (await api.schedules.save({ ...base, id: 'g5-mal', name: 'x', projectId: 'no-existe', repeat: 'daily', createdAt: Date.now() })).error

    // La próxima hora de cada tipo.
    const now = Date.now()
    await api.schedules.save({ ...base, enabled: true, id: 'g5-diaria', name: 'Diaria', repeat: 'daily', time: '03:00', createdAt: now })
    await api.schedules.save({ ...base, id: 'g5-laborables', name: 'Laborables', repeat: 'weekdays', time: '07:30', createdAt: now })
    await api.schedules.save({ ...base, id: 'g5-semanal', name: 'Semanal', repeat: 'weekly', time: '09:15', weekday: 0, createdAt: now })
    await api.schedules.save({ ...base, id: 'g5-horas', name: 'Horas', repeat: 'hourly', everyHours: 6, createdAt: now })
    // Guardadas apagadas: esto es sólo para ver sus horas, no para que corran.
    for (const id of ['g5-diaria', 'g5-laborables', 'g5-semanal', 'g5-horas']) {
      const s = (await api.config.get()).data.schedules.find((x) => x.id === id)
      out[id] = await get(id).then((v) => v.nextRunAt)
      await api.schedules.save({ ...s, enabled: false })
    }
    out.next = {
      diaria: (() => { const d = new Date(out['g5-diaria']); return d.getHours() === 3 && d.getMinutes() === 0 && out['g5-diaria'] > now && out['g5-diaria'] <= now + 86400000 })(),
      laborables: (() => { const d = new Date(out['g5-laborables']); return d.getHours() === 7 && d.getMinutes() === 30 && d.getDay() >= 1 && d.getDay() <= 5 && out['g5-laborables'] > now })(),
      semanal: (() => { const d = new Date(out['g5-semanal']); return d.getDay() === 0 && d.getHours() === 9 && d.getMinutes() === 15 && out['g5-semanal'] <= now + 7 * 86400000 })(),
      horas: out['g5-horas'] === now + 6 * 3600000
    }

    // Una que tocaba hace una hora (la app «estaba cerrada»): se lanza sola al mirar el reloj.
    const hace2h = Date.now() - 2 * 3600000
    await api.schedules.save({ ...base, id: 'g5-toca', name: 'Toca zq5', repeat: 'hourly', everyHours: 1, createdAt: hace2h })
    // La que pidió no recuperarse se apunta como saltada; la apagada no hace nada.
    await api.schedules.save({ ...base, id: 'g5-salta', name: 'Salta zq5', repeat: 'hourly', everyHours: 1, catchUp: false, createdAt: hace2h })
    await api.schedules.save({ ...base, id: 'g5-apagada', name: 'Apagada zq5', enabled: false, repeat: 'hourly', everyHours: 1, createdAt: hace2h })

    const ran = await until(async () => { const s = await get('g5-toca'); return s?.lastStatus === 'ok' || s?.lastStatus === 'error' ? s : null }, 30000)
    out.ran = ran ? { status: ran.lastStatus, error: ran.lastError, session: ran.lastSessionId, next: ran.nextRunAt - ran.lastRunAt } : null
    const session = ran?.lastSessionId ? engine.peekSessions().find((s) => s.id === ran.lastSessionId) : null
    out.session = session ? { title: session.title, kind: session.kind, worktree: Boolean(session.worktreePath), wt: session.worktreePath } : null
    out.tareaTxt = session?.worktreePath ? (await api.files.read(session.worktreePath, 'tarea.txt')).data?.text ?? null : null
    await sleep(1500)
    out.onlyOnce = engine.peekSessions().filter((s) => !before.has(s.id) && s.title === 'Toca zq5').length
    out.salta = await get('g5-salta').then((s) => s.lastStatus)
    out.apagada = await get('g5-apagada').then((s) => s.lastRunAt ?? null)
    out.saltaSessions = engine.peekSessions().filter((s) => !before.has(s.id) && s.title === 'Salta zq5').length

    // «Lanzar ahora», con una que falla: queda el fallo apuntado.
    await api.schedules.save({ ...base, id: 'g5-falla', name: 'Falla zq5', enabled: false, repeat: 'daily', time: '03:00', worktree: false, prompt: 'esto falla', createdAt: Date.now() })
    out.runNow = (await api.schedules.runNow('g5-falla')).ok
    const failed = await until(async () => { const s = await get('g5-falla'); return s?.lastStatus === 'error' ? s : null })
    out.failed = failed ? failed.lastError : null

    // En Tareas: la tira de programadas y la tarjeta de lo que corrió.
    engine.navigate('tasks')
    const row = await until(() => document.querySelector('[data-schedules] [data-schedule="g5-toca"]'))
    out.row = row ? row.querySelector('[data-schedule-cadence]')?.textContent + ' | ' + row.querySelector('[data-schedule-status]')?.textContent.trim() : null
    out.card = Boolean(await until(() => [...document.querySelectorAll('[data-column]')].some((c) => c.textContent.includes('Toca zq5'))))

    // El formulario: «Programar» guarda en vez de lanzar.
    document.querySelector('[data-open-schedule]')?.click()
    const fields = await until(() => document.querySelector('[data-schedule-fields]'))
    const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    const modal = fields?.closest('.fixed')
    const selects = modal ? [...modal.querySelectorAll('select')] : []
    const projectSel = selects[0]
    if (projectSel) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(projectSel, 'proyecto-g5'); projectSel.dispatchEvent(new Event('change', { bubbles: true })) }
    await sleep(250)
    const agentSel = [...(document.querySelector('[data-schedule-fields]')?.closest('.fixed')?.querySelectorAll('select') ?? [])][1]
    if (agentSel) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(agentSel, 'cli:tarea-g5'); agentSel.dispatchEvent(new Event('change', { bubbles: true })) }
    set(document.querySelector('[data-task-prompt]'), 'desde el formulario zq5')
    set(document.querySelector('[data-schedule-name]'), 'Formulario zq5')
    set(document.querySelector('[data-schedule-time]'), '22:45')
    // Hasta que el formulario refleja lo escrito no se envía.
    await until(() => /22:45/.test(document.querySelector('[data-form-next]')?.textContent ?? ''), 4000)
    await sleep(250)
    out.formNext = document.querySelector('[data-form-next]')?.textContent ?? ''
    document.querySelector('[data-task-submit]')?.click()
    const saved = await until(async () => (await api.config.get()).data.schedules?.find((s) => s.name === 'Formulario zq5'))
    if (!saved) out.formWhy = [...document.querySelectorAll('.fixed')].map((x) => (x.textContent ?? '').slice(0, 160)).join(' || ')
    out.form = saved ? { repeat: saved.repeat, time: saved.time, agent: saved.agent, worktree: saved.worktree, project: saved.projectId } : null
    out.formLaunched = engine.peekSessions().some((s) => !before.has(s.id) && s.title.includes('Formulario zq5'))
    out.login = (await api.app.loginItem()).data

    // Limpieza.
    for (const s of (await api.config.get()).data.schedules ?? []) if (s.id.startsWith('g5-') || s.name === 'Formulario zq5' || s.prompt === 'desde el formulario zq5') await api.schedules.remove(s.id)
    for (const s of engine.peekSessions()) if (!before.has(s.id)) await engine.deleteSession(s.id)
    await api.agents.removeCli('tarea-g5')
    await api.projects.remove('proyecto-g5')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Consola')?.click()
    return out
  })()`)
  for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
    const wt = line.startsWith('worktree ') ? line.slice(9) : null
    if (wt && wt !== REPO && !wt.endsWith('/repo')) {
      try {
        git(['worktree', 'remove', '--force', wt])
      } catch {}
    }
  }
  git(['reset', '-q', '--hard', headG5])

  log(/Escribe qué tiene que hacer/.test(g5.noPrompt ?? '') && /Elige un proyecto/.test(g5.noProject ?? ''), 'G5: UNA TAREA PROGRAMADA SIN TAREA O SIN PROYECTO NO SE GUARDA', `${g5.noPrompt} · ${g5.noProject}`)
  log(g5.next.diaria && g5.next.laborables && g5.next.semanal && g5.next.horas, 'CALCULA LA PRÓXIMA HORA: CADA DÍA, LABORABLES, SEMANAL Y POR HORAS', JSON.stringify(g5.next))
  log(
    g5.ran?.status === 'ok' && g5.session?.title === 'Toca zq5' && g5.session.kind === 'cli' && g5.session.worktree && /hecho por la tarea/.test(g5.tareaTxt ?? '') && g5.ran.next === 3600000 && g5.onlyOnce === 1,
    'LA QUE TOCABA SE LANZA SOLA, EN SU WORKTREE, UNA SOLA VEZ, Y QUEDA APUNTADO CÓMO FUE',
    JSON.stringify({ ran: g5.ran && { status: g5.ran.status, error: g5.ran.error }, session: g5.session?.title, txt: Boolean(g5.tareaTxt), veces: g5.onlyOnce })
  )
  log(g5.salta === 'missed' && g5.saltaSessions === 0 && g5.apagada === null, 'la que pidió no recuperarse se salta y la apagada no hace nada', `${g5.salta} · ${g5.apagada}`)
  log(g5.runNow && Boolean(g5.failed), '«Lanzar ahora» funciona y un fallo queda apuntado', String(g5.failed))
  log(/Cada hora/.test(g5.row ?? '') && /bien/.test(g5.row ?? '') && g5.card, 'EN TAREAS SALEN LAS PROGRAMADAS Y LA TARJETA DE LO QUE CORRIÓ', String(g5.row))
  log(
    g5.form?.repeat === 'daily' && g5.form.time === '22:45' && g5.form.agent === 'cli:tarea-g5' && g5.form.worktree && !g5.formLaunched && /La próxima/.test(g5.formNext),
    'EL FORMULARIO PROGRAMA EN VEZ DE LANZAR Y DICE CUÁNDO TOCA',
    `${JSON.stringify(g5.form)} · ${g5.formNext}${g5.formWhy ? ' · ' + g5.formWhy : ''}`
  )
  log(g5.login?.supported === false && g5.login.reason === 'dev', 'abrir al iniciar sesión sólo se ofrece en la app instalada', JSON.stringify(g5.login))
  /* -------------------------------------------------------------- *
   * P2 · Cada CLI como en su terminal: OpenCode por ACP y Claude    *
   *      Code preguntan sus permisos aquí                          *
   * -------------------------------------------------------------- */
  const OUTSIDE_P2 = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-fuera-'))
  fs.writeFileSync(path.join(OUTSIDE_P2, 'secreto.txt'), 'la palabra es mandarina\n')
  const secretP2 = path.join(OUTSIDE_P2, 'secreto.txt')
  const p2 = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${JSON.stringify(BINS)}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    await api.projects.save({ id: 'proyecto-p2', name: 'Repo p2', path: repo, color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'opencode-p2', name: 'OpenCode p2', type: 'cli', command: bins.opencode, args: ['run', '--format', 'json', '{{prompt}}'], parser: 'opencode-json', color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'claude-p2', name: 'Claude p2', type: 'cli', command: bins.claude, args: ['-p', '--output-format', 'stream-json', '--verbose'], parser: 'claude-stream-json', color: '#fff', createdAt: Date.now() })
    await sleep(300)
    const pendingOf = (sid) => {
      const chat = engine.peekChat(sid)
      const turn = chat?.turns?.[chat.turns.length - 1]
      const step = (turn?.steps ?? []).find((s) => s.approval === 'pending' && s.status === 'running')
      return step ? { step, runId: chat.runningRunId ?? turn.runId } : null
    }
    const made = []
    const session = async (agent, extra = {}) => {
      const sid = await engine.newSession('cli', { cliAgentId: agent, projectId: 'proyecto-p2', ...extra })
      made.push(sid)
      return sid
    }

    // 1. OpenCode pide entrar en una carpeta de fuera: la pregunta sale aquí, con «Permitir una vez».
    let sid = await session('opencode-p2')
    let running = engine.sendCli(sid, { prompt: 'pide permiso fuera: ${secretP2}', agentId: 'opencode-p2', projectPath: repo, projectId: 'proyecto-p2' })
    let pend = await until(() => pendingOf(sid))
    out.ask = pend ? { kind: pend.step.ask?.kind, target: pend.step.ask?.target, always: pend.step.always?.scope, tool: pend.step.tool } : null
    // Por la interfaz: en la Consola salen los tres botones.
    engine.focusChat(sid)
    const buttons = await until(() => { const b = [...document.querySelectorAll('[data-approve]')].map((x) => x.getAttribute('data-approve')); return b.length >= 3 ? b : null })
    out.buttons = buttons ? buttons.join(',') : null
    out.text = [...document.querySelectorAll('[data-approve="once"]')][0]?.closest('div')?.parentElement?.textContent ?? ''
    document.querySelector('[data-approve="once"]')?.click()
    let run = await running
    out.once = { response: run?.response, status: run?.status, session: run?.cliSessionId, step: (run?.steps ?? []).find((s) => s.ask)?.approval }

    // 2. «Siempre» elige la opción de siempre del propio OpenCode.
    sid = await session('opencode-p2')
    running = engine.sendCli(sid, { prompt: 'pide permiso fuera: ${secretP2}', agentId: 'opencode-p2', projectPath: repo, projectId: 'proyecto-p2' })
    pend = await until(() => pendingOf(sid))
    if (pend) engine.approveStep(pend.runId, pend.step.id, true, true)
    run = await running
    out.always = run?.response

    // 3. Rechazar: el agente se entera y sigue sin ello.
    sid = await session('opencode-p2')
    running = engine.sendCli(sid, { prompt: 'pide permiso fuera: ${secretP2}', agentId: 'opencode-p2', projectPath: repo, projectId: 'proyecto-p2' })
    pend = await until(() => pendingOf(sid))
    if (pend) engine.approveStep(pend.runId, pend.step.id, false)
    run = await running
    out.deny = { response: run?.response, denied: (run?.steps ?? []).some((s) => s.denied && s.approval === 'denied') }

    // 4. Un turno normal: su línea de tiempo, tokens, contexto, coste; y el segundo turno retoma.
    sid = await session('opencode-p2')
    const first = await engine.sendCli(sid, { prompt: 'hola', agentId: 'opencode-p2', projectPath: repo, projectId: 'proyecto-p2', model: 'opencode/gpt-5.1-codex' })
    out.turn = {
      thinking: (first?.steps ?? []).some((s) => s.kind === 'thinking' && s.detail === 'Pienso un poco.'),
      tool: (first?.steps ?? []).some((s) => s.tool === 'bash' && s.target === 'ls' && s.status === 'ok'),
      todos: (first?.todos ?? []).map((t) => t.text + (t.done ? '✓' : t.active ? '…' : '')).join(','),
      tokens: first?.promptTokens + '/' + first?.completionTokens + '/' + first?.cachedTokens,
      context: first?.contextUsed + '/' + first?.contextLimit,
      cost: first?.costTotal,
      model: first?.model,
      response: first?.response
    }
    engine.patchSessionConfig(sid, { permissionMode: 'plan' })
    const second = await engine.sendCli(sid, { prompt: 'otra', agentId: 'opencode-p2', projectPath: repo, projectId: 'proyecto-p2', permissionMode: 'plan' })
    out.second = second?.response

    // 5. Claude Code pregunta antes de escribir; «Siempre en este proyecto» le pasa su regla.
    sid = await session('claude-p2')
    running = engine.sendCli(sid, { prompt: 'pide permiso', agentId: 'claude-p2', projectPath: repo, projectId: 'proyecto-p2', permissionMode: 'manual' })
    pend = await until(() => pendingOf(sid))
    out.claudeAsk = pend ? { kind: pend.step.ask?.kind, target: pend.step.ask?.target, always: pend.step.always?.scope, what: pend.step.always?.what, tool: pend.step.tool } : null
    if (pend) engine.approveStep(pend.runId, pend.step.id, true, true)
    run = await running
    out.claudeAllow = { response: run?.response, status: run?.status }

    // 6. Y si se le niega, se entera.
    sid = await session('claude-p2')
    running = engine.sendCli(sid, { prompt: 'pide permiso', agentId: 'claude-p2', projectPath: repo, projectId: 'proyecto-p2', permissionMode: 'manual' })
    pend = await until(() => pendingOf(sid))
    if (pend) engine.approveStep(pend.runId, pend.step.id, false)
    run = await running
    out.claudeDeny = { response: run?.response, denied: (run?.steps ?? []).some((s) => s.denied) }

    // 7. Detenerlo mientras espera: no se queda colgado.
    sid = await session('opencode-p2')
    running = engine.sendCli(sid, { prompt: 'pide permiso fuera: ${secretP2}', agentId: 'opencode-p2', projectPath: repo, projectId: 'proyecto-p2' })
    pend = await until(() => pendingOf(sid))
    const t0 = Date.now()
    engine.stopSession(sid)
    run = await Promise.race([running, sleep(8000).then(() => 'colgado')])
    out.stop = run === 'colgado' ? 'colgado' : { status: run?.status, ms: Date.now() - t0 }

    for (const id of made) await engine.deleteSession(id)
    for (const r of (await api.runs.query({ projectId: 'proyecto-p2' })).data.rows) await api.runs.remove(r.id)
    await api.agents.removeCli('opencode-p2')
    await api.agents.removeCli('claude-p2')
    await api.projects.remove('proyecto-p2')
    return out
  })()`)
  const permisoP2 = fs.existsSync(path.join(REPO, 'permiso.txt'))
  fs.rmSync(path.join(REPO, 'permiso.txt'), { force: true })
  fs.rmSync(OUTSIDE_P2, { recursive: true, force: true })

  log(
    p2.ask?.kind === 'outside' && p2.ask.target === OUTSIDE_P2 && p2.ask.always === 'session' && p2.buttons === 'once,always,deny' && /fuera del proyecto/.test(p2.text),
    'P2: OPENCODE (ACP) PIDE ENTRAR EN UNA CARPETA DE FUERA Y LA PREGUNTA SALE EN LA CONSOLA CON SUS BOTONES',
    JSON.stringify(p2.ask) + ' · ' + p2.buttons
  )
  log(
    /leído: la palabra es mandarina \(opción=once\)/.test(p2.once?.response ?? '') && p2.once.status === 'ok' && p2.once.step === 'approved' && /^ses_/.test(p2.once.session ?? ''),
    'PERMITIR UNA VEZ: EL AGENTE LO LEE Y SIGUE',
    p2.once?.response
  )
  log(/opción=always/.test(p2.always ?? ''), '«Siempre» usa la opción de siempre del propio OpenCode', p2.always)
  log(/no me dejaron \(reject\)/.test(p2.deny?.response ?? '') && p2.deny.denied, 'rechazar le llega al agente y la fila queda negada', p2.deny?.response)
  log(
    p2.turn?.thinking && p2.turn.tool && p2.turn.todos === 'leer✓,contestar…' && p2.turn.tokens === '80/10/5' && p2.turn.context === '1234/32000' && p2.turn.cost === 0.02,
    'POR ACP LLEGAN SU PENSAMIENTO, SUS HERRAMIENTAS, SU PLAN, TOKENS, CONTEXTO Y COSTE',
    JSON.stringify(p2.turn)
  )
  log(
    /model=opencode\/gpt-5\.1-codex/.test(p2.turn?.response ?? '') && p2.turn.model === 'opencode/gpt-5.1-codex',
    'el modelo elegido se le pone a la sesión',
    p2.turn?.model
  )
  log(/session=ses_\S+ fork=false model=\S+ effort=\S+ mode=plan/.test(p2.second ?? ''), 'el segundo turno retoma su sesión y «Sólo plan» es su modo plan', (p2.second ?? '').slice(0, 90))
  log(
    p2.claudeAsk?.kind === 'edit' && p2.claudeAsk.target === 'permiso.txt' && p2.claudeAsk.always === 'project' && p2.claudeAsk.what === 'Write(permiso.txt)' &&
      /escrito siempre=true/.test(p2.claudeAllow?.response ?? '') && permisoP2,
    'CLAUDE CODE PREGUNTA ANTES DE ESCRIBIR Y «SIEMPRE EN ESTE PROYECTO» LE PASA SU REGLA',
    JSON.stringify(p2.claudeAsk) + ' · ' + p2.claudeAllow?.response
  )
  log(/no me dejaron/.test(p2.claudeDeny?.response ?? '') && p2.claudeDeny.denied, 'si se le niega a Claude Code, se entera', p2.claudeDeny?.response)
  log(p2.stop !== 'colgado' && p2.stop?.ms < 5000, 'detenerlo mientras espera un permiso no lo deja colgado', JSON.stringify(p2.stop))
  /* -------------------------------------------------------------- *
   * P2 · Codex por su app-server: aprobaciones, hilos y permisos    *
   * -------------------------------------------------------------- */
  const cx = await js(`(async () => {
    const { repo } = ${ctx}
    const bins = ${JSON.stringify(BINS)}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    await api.projects.save({ id: 'proyecto-cx', name: 'Repo cx', path: repo, color: '#fff', createdAt: Date.now() })
    await api.agents.saveCli({ id: 'codex-p2', name: 'Codex p2', type: 'cli', command: bins.codex, args: ['exec', '--json', '-c', 'model_verbosity=low', '{{prompt}}'], parser: 'codex-json', color: '#fff', createdAt: Date.now() })
    await sleep(300)
    const pendingOf = (sid) => {
      const chat = engine.peekChat(sid)
      const turn = chat?.turns?.[chat.turns.length - 1]
      const step = (turn?.steps ?? []).find((s) => s.approval === 'pending' && s.status === 'running')
      return step ? { step, runId: chat.runningRunId ?? turn.runId } : null
    }
    const made = []
    const session = async () => {
      const sid = await engine.newSession('cli', { cliAgentId: 'codex-p2', projectId: 'proyecto-cx' })
      made.push(sid)
      return sid
    }
    const send = (sid, prompt, extra = {}) => engine.sendCli(sid, { prompt, agentId: 'codex-p2', projectPath: repo, projectId: 'proyecto-cx', ...extra })

    // 1. Un comando que necesita permiso: la pregunta sale aquí; «Permitir» es accept.
    let sid = await session()
    let running = send(sid, 'pide permiso comando')
    let pend = await until(() => pendingOf(sid))
    out.ask = pend ? { kind: pend.step.ask?.kind, target: pend.step.ask?.target, scope: pend.step.always?.scope, what: pend.step.always?.what, tool: pend.step.tool, detail: pend.step.detail } : null
    engine.focusChat(sid)
    const buttons = await until(() => { const b = [...document.querySelectorAll('[data-approve]')].map((x) => x.getAttribute('data-approve')); return b.length >= 3 ? b : null })
    out.buttons = buttons ? buttons.join(',') : null
    document.querySelector('[data-approve="once"]')?.click()
    let run = await running
    out.once = { response: run?.response, status: run?.status, session: run?.cliSessionId, step: (run?.steps ?? []).find((s) => s.ask), cmd: (run?.steps ?? []).find((s) => s.id === 'cmd')?.detail }

    // 2. «Siempre»: con regla propuesta, se le devuelve su regla.
    sid = await session()
    running = send(sid, 'pide permiso comando')
    pend = await until(() => pendingOf(sid))
    if (pend) engine.approveStep(pend.runId, pend.step.id, true, true)
    run = await running
    out.always = run?.response

    // 3. Rechazar: Codex se entera y la fila queda negada.
    sid = await session()
    running = send(sid, 'pide permiso comando')
    pend = await until(() => pendingOf(sid))
    if (pend) engine.approveStep(pend.runId, pend.step.id, false)
    run = await running
    out.deny = { response: run?.response, denied: (run?.steps ?? []).some((s) => s.denied && s.approval === 'denied' && s.status === 'error') }

    // 4. Un parche: pregunta antes de escribir; «Siempre» vale para la sesión.
    sid = await session()
    running = send(sid, 'pide permiso parche')
    pend = await until(() => pendingOf(sid))
    out.patchAsk = pend ? { kind: pend.step.ask?.kind, target: pend.step.ask?.target, scope: pend.step.always?.scope, tool: pend.step.tool } : null
    if (pend) engine.approveStep(pend.runId, pend.step.id, true, true)
    run = await running
    const edit = (run?.steps ?? []).find((s) => s.tool === 'Edit')
    out.patch = { response: run?.response, added: edit?.added, approval: edit?.approval, status: edit?.status }

    // 5. Permisos extra (la red): se conceden para el turno.
    sid = await session()
    running = send(sid, 'pide permiso red')
    pend = await until(() => pendingOf(sid))
    out.netAsk = pend ? pend.step.ask?.kind : null
    if (pend) engine.approveStep(pend.runId, pend.step.id, true)
    run = await running
    out.net = run?.response

    // 6. Un turno normal con modelo, esfuerzo y «Sólo lectura»; el segundo retoma; el tercero bifurca.
    sid = await session()
    const nativeSid = sid
    engine.patchSessionConfig(sid, { permissionMode: 'plan' })
    const first = await send(sid, 'hola', { model: 'gpt-prueba', effort: 'high', permissionMode: 'plan' })
    out.turn = {
      response: first?.response,
      model: first?.model,
      thinking: (first?.steps ?? []).some((s) => s.kind === 'thinking' && s.detail === 'Pienso primero.'),
      bash: (first?.steps ?? []).some((s) => s.tool === 'Bash' && s.target === 'ls' && s.status === 'ok' && /app\\.js/.test(s.detail ?? '')),
      edit: (first?.steps ?? []).find((s) => s.tool === 'Edit'),
      todos: (first?.todos ?? []).map((t) => t.text + (t.done ? '✓' : t.active ? '…' : '')).join(','),
      tokens: first?.promptTokens + '/' + first?.completionTokens + '/' + first?.cachedTokens + '/' + first?.reasoningTokens,
      context: first?.contextUsed + '/' + first?.contextLimit,
      session: first?.cliSessionId
    }
    const second = await send(sid, 'otra', { permissionMode: 'bypassPermissions' })
    out.second = { response: second?.response, tokens: second?.promptTokens + '/' + second?.completionTokens, resumed: second?.resumedFrom }
    engine.patchSessionConfig(sid, { cliForkNext: true })
    const third = await send(sid, 'bifurca')
    out.fork = { response: third?.response, session: third?.cliSessionId, forked: third?.forked }

    // 7. Sin modo elegido la Consola manda el de partida de Codex (su Auto).
    sid = await session()
    await engine.sendTurn(sid, 'por omisión', (await api.config.get()).data)
    out.initial = engine.peekChat(sid)?.turns?.slice(-1)[0]?.content
    engine.focusChat(sid)
    engine.navigate('chat')
    await sleep(300)
    const sel = await until(() => document.querySelector('[data-cli-permission]'), 3000)
    out.modes = sel ? [...sel.options].map((o) => o.value).join(',') + ' → ' + sel.value : 'sin selector'

    // 8. Sin sesión iniciada: el error dice qué hacer.
    sid = await session()
    run = await send(sid, 'sin cuenta')
    out.noauth = { status: run?.status, error: run?.error }

    // 9. Pararlo mientras espera: no se queda colgado.
    sid = await session()
    running = send(sid, 'pide permiso comando')
    pend = await until(() => pendingOf(sid))
    const t0 = Date.now()
    engine.stopSession(sid)
    run = await Promise.race([running, sleep(8000).then(() => 'colgado')])
    out.stop = run === 'colgado' ? 'colgado' : { status: run?.status, ms: Date.now() - t0 }

    // 10. «Abrir en su terminal»: el Codex original, retomando la sesión de la conversación.
    engine.focusChat(nativeSid)
    engine.navigate('chat')
    await sleep(400)
    const openBtn = await until(() => document.querySelector('[data-open-native]'), 4000)
    const termsBefore = new Set(Object.keys(engine.peekTerms()))
    openBtn?.click()
    const term = await until(() => Object.values(engine.peekTerms()).find((x) => !termsBefore.has(x.info.id)), 10000)
    const wanted = 'resume ' + engine.peekChat(nativeSid)?.session?.cliSessionId
    out.native = {
      title: term?.info?.title,
      cwd: term?.info?.cwd,
      typed: term ? Boolean(await until(() => engine.termScrollback(term.info.id).includes(wanted), 15000)) : false,
      ran: term ? Boolean(await until(() => engine.termScrollback(term.info.id).includes('args=' + wanted), 15000)) : false,
      shown: term ? Boolean(await until(() => (document.querySelector('[data-page="terminal"]')?.hidden === false && document.querySelector('[data-term-tab="' + term.info.id + '"][data-active]') ? true : null), 4000)) : false
    }
    if (term) await engine.closeTerm(term.info.id)
    engine.navigate('chat')

    for (const id of made) await engine.deleteSession(id)
    for (const r of (await api.runs.query({ projectId: 'proyecto-cx' })).data.rows) await api.runs.remove(r.id)
    await api.agents.removeCli('codex-p2')
    await api.projects.remove('proyecto-cx')
    return out
  })()`)
  const parcheCx = fs.existsSync(path.join(REPO, 'parche-codex.txt'))
  fs.rmSync(path.join(REPO, 'parche-codex.txt'), { force: true })

  log(
    cx.ask?.kind === 'run' && cx.ask.target === 'touch fuera.txt' && cx.ask.scope === 'user' && cx.ask.what === 'touch' && cx.ask.tool === 'Bash' &&
      /fuera del sandbox/.test(cx.ask.detail ?? '') && cx.buttons === 'once,always,deny',
    'P2: CODEX (APP-SERVER) PIDE APROBAR UN COMANDO Y LA PREGUNTA SALE EN LA CONSOLA CON SUS BOTONES',
    JSON.stringify(cx.ask) + ' · ' + cx.buttons
  )
  log(
    /ejecutado \(decisión=accept\)/.test(cx.once?.response ?? '') && cx.once.status === 'ok' && cx.once.step?.approval === 'approved' && cx.once.step?.status === 'ok' &&
      /^hilo-/.test(cx.once.session ?? '') && /codex(\.cmd)? app-server -c model_verbosity=low/.test(cx.once.cmd ?? ''),
    'PERMITIR UNA VEZ: CODEX LO EJECUTA Y SIGUE (y sus -c llegan al servidor)',
    cx.once?.response + ' · ' + cx.once?.cmd
  )
  log(/decisión=regla:touch/.test(cx.always ?? ''), '«Siempre» le devuelve la regla que el propio Codex propone', cx.always)
  log(/no me dejaron \(decline\)/.test(cx.deny?.response ?? '') && cx.deny.denied, 'rechazar le llega a Codex y la fila queda negada', cx.deny?.response)
  log(
    cx.patchAsk?.kind === 'edit' && /parche-codex\.txt/.test(cx.patchAsk.target ?? '') && cx.patchAsk.scope === 'session' &&
      /parche aplicado \(decisión=acceptForSession\)/.test(cx.patch?.response ?? '') && cx.patch.added === 2 && cx.patch.approval === 'approved' && cx.patch.status === 'ok' && parcheCx,
    'CODEX PREGUNTA ANTES DE APLICAR UN PARCHE Y «SIEMPRE EN ESTA SESIÓN» ES SU acceptForSession',
    JSON.stringify(cx.patchAsk) + ' · ' + JSON.stringify(cx.patch)
  )
  log(cx.netAsk === 'fetch' && /red=true alcance=turn/.test(cx.net ?? ''), 'los permisos extra (la red) se le conceden para el turno', cx.net)
  log(
    cx.turn?.thinking && cx.turn.bash && cx.turn.edit?.added === 2 && cx.turn.edit?.removed === 1 && cx.turn.todos === 'leer✓,arreglar…' &&
      cx.turn.tokens === '500/40/100/10' && cx.turn.context === '540/272000' && !/DE OTRO HILO/.test(cx.turn.response ?? ''),
    'POR SU SERVIDOR LLEGAN SU RAZONAMIENTO, SUS COMANDOS, SUS PARCHES CON +/−, SU PLAN, LOS TOKENS Y EL CONTEXTO',
    JSON.stringify({ ...cx.turn, response: undefined })
  )
  log(
    /hilo=nuevo fork=false model=gpt-prueba effort=high approval=on-request sandbox=read-only prompt=hola/.test(cx.turn?.response ?? '') && cx.turn.model === 'gpt-prueba',
    'modelo, esfuerzo y «Sólo lectura» (on-request + read-only) van al hilo y al turno',
    (cx.turn?.response ?? '').slice(0, 110)
  )
  log(
    (cx.second?.response ?? '').includes('hilo=resume ' + cx.turn?.session) && /approval=never sandbox=danger-full-access/.test(cx.second.response) &&
      cx.second.tokens === '500/40' && cx.second.resumed === cx.turn?.session,
    'EL SEGUNDO TURNO RETOMA SU HILO, CUENTA SÓLO SUS TOKENS Y «SIN LÍMITES» ES SU FULL ACCESS',
    (cx.second?.response ?? '').slice(0, 110) + ' · ' + cx.second?.tokens
  )
  log(
    /fork=true/.test(cx.fork?.response ?? '') && cx.fork.session !== cx.turn?.session && cx.fork.forked === true,
    'bifurcar abre un hilo nuevo a partir del anterior (thread/fork)',
    (cx.fork?.response ?? '').slice(0, 60)
  )
  log(
    /approval=on-request sandbox=workspace-write/.test(cx.initial ?? '') && cx.modes === 'acceptEdits,manual,plan,bypassPermissions → acceptEdits',
    'sin elegir nada, la Consola enseña y manda el modo de partida de Codex (su Auto)',
    (cx.initial ?? '').slice(0, 110) + ' · ' + cx.modes
  )
  log(cx.noauth?.status === 'error' && /no tiene sesión iniciada/.test(cx.noauth.error ?? ''), 'sin sesión de Codex, el error dice que hay que entrar', cx.noauth?.error)
  log(cx.stop !== 'colgado' && cx.stop?.ms < 5000, 'pararlo mientras espera una aprobación no lo deja colgado', JSON.stringify(cx.stop))
  log(
    cx.native?.title === 'Codex p2' && cx.native.cwd === REPO && cx.native.typed && cx.native.ran && cx.native.shown,
    '«ABRIR EN SU TERMINAL» LANZA EL CLI ORIGINAL, EN EL PROYECTO Y RETOMANDO LA SESIÓN DE LA CONVERSACIÓN',
    JSON.stringify(cx.native)
  )
  /* -------------------------------------------------------------- *
   * P4 · Cuentas: iniciar sesión con GitHub, con cada CLI y con     *
   *      OpenRouter                                                *
   * -------------------------------------------------------------- */
  const p4Dir = path.join(FIXTURES, 'cuentas')
  const p4State = path.join(p4Dir, 'estado')
  const p4Home = path.join(TMP, 'home-cuentas')
  const p4GhLog = path.join(p4Dir, 'gh.jsonl')
  fs.mkdirSync(p4State, { recursive: true })
  fs.mkdirSync(p4Home, { recursive: true })
  // gh, claude, codex, gemini y opencode falsos, con memoria: recuerdan si hay sesión.
  fs.writeFileSync(
    path.join(p4Dir, 'cuenta.js'),
    [
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      "const { execFileSync } = require('node:child_process')",
      'const [tool, ...args] = process.argv.slice(2)',
      "const dir = process.env.FAKE_ACCOUNTS",
      "const has = (n) => fs.existsSync(path.join(dir, n))",
      "const put = (n) => fs.writeFileSync(path.join(dir, n), '1')",
      "const del = (n) => fs.rmSync(path.join(dir, n), { force: true })",
      "const cmd = args.slice(0, 2).join(' ')",
      "const NL = String.fromCharCode(10)",
      "if (tool === 'gh') {",
      "  fs.appendFileSync(path.join(dir, '..', 'gh.jsonl'), JSON.stringify(args) + NL)",
      "  if (args[0] === '--version') process.stdout.write('gh version 2.100.0 (falso)')",
      "  else if (args[0] === 'api') {",
      "    if (has('gh')) process.stdout.write(JSON.stringify({ login: 'hugo-cuentas', name: 'Hugo', url: 'https://github.com/hugo-cuentas' }))",
      "    else { process.stderr.write('To get started with GitHub CLI, please run:  gh auth login'); process.exit(4) }",
      "  } else if (cmd === 'auth status') process.stderr.write('  - Token scopes: gist, read:org, repo')",
      "  else if (cmd === 'auth login') {",
      "    if (has('gh-falla')) { process.stderr.write('error: device code expired' + NL); process.exit(1) }",
      "    process.stderr.write(NL + '! First copy your one-time code: AB12-CD34' + NL + 'Open this URL to continue in your web browser: https://github.com/login/device' + NL)",
      "    const end = Date.now() + 30000",
      "    const timer = setInterval(() => {",
      "      if (has('gh-autorizado')) { clearInterval(timer); del('gh-autorizado'); put('gh'); process.stderr.write('✓ Authentication complete.' + NL); process.exit(0) }",
      "      if (Date.now() > end) process.exit(1)",
      "    }, 100)",
      "  } else if (cmd === 'auth setup-git') execFileSync('git', ['config', '--global', 'credential.https://github.com.helper', '!gh auth git-credential'])",
      "  else { process.stderr.write('orden desconocida: ' + args.join(' ')); process.exit(1) }",
      "} else if (tool === 'claude') {",
      "  if (cmd === 'auth status') {",
      "    if (has('claude')) console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'hugo@example.com', subscriptionType: 'pro' }, null, 2))",
      "    else { console.log(JSON.stringify({ loggedIn: false, authMethod: 'none' })); process.exit(1) }",
      "  } else if (cmd === 'auth login') { put('claude'); console.log('Login successful') }",
      "  else if (cmd === 'auth logout') { del('claude'); console.log('Logged out') }",
      "} else if (tool === 'codex') {",
      "  if (cmd === 'login status') process.stderr.write(has('codex') ? 'Logged in using ChatGPT' + NL : 'Not logged in' + NL)",
      "  else if (args[0] === 'login') { put('codex'); console.log('Successfully logged in') }",
      "} else if (tool === 'opencode') {",
      "  if (cmd === 'auth list') {",
      "    const ESC = String.fromCharCode(27)",
      "    const rows = has('opencode') ? ['●  OpenCode Zen ' + ESC + '[90mapi' + ESC + '[0m', '│', '●  Anthropic oauth', '│'] : []",
      "    console.log(['', '┌  Credentials ~/.local/share/opencode/auth.json', '│', ...rows, '└  ' + rows.length / 2 + ' credentials', '', '┌  Environment', '│', '●  OPENAI_API_KEY OPENAI_API_KEY', '│', '└  1 environment variable', ''].join(NL))",
      '  }',
      '}'
    ].join('\n')
  )
  for (const tool of ['gh', 'claude', 'codex', 'gemini', 'opencode']) {
    const file = path.join(p4Dir, tool)
    fs.writeFileSync(file, `#!/bin/sh\nexec node "${path.join(p4Dir, 'cuenta.js')}" ${tool} "$@"\n`)
    fs.chmodSync(file, 0o755)
    if (process.platform === 'win32') fs.writeFileSync(file + '.cmd', `@node "${path.join(p4Dir, 'cuenta.js')}" ${tool} %*\r\n`)
  }
  const p4Env = { PATH: process.env.PATH, HOME: process.env.HOME, FAKE_ACCOUNTS: process.env.FAKE_ACCOUNTS, GEMINI_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_API_KEY: process.env.GOOGLE_API_KEY }
  process.env.PATH = p4Dir + path.delimiter + process.env.PATH
  process.env.HOME = p4Home
  process.env.FAKE_ACCOUNTS = p4State
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY

  // Un OpenRouter falso: sólo da la clave si el código es bueno y el verificador casa con el reto.
  const orSeen = { challenge: '', bodies: [] }
  const orServer = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {}
        orSeen.bodies.push({ method: req.method, url: req.url, method2: body.code_challenge_method })
        const hash = require('node:crypto').createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        res.setHeader('content-type', 'application/json')
        if (req.method === 'POST' && req.url === '/api/v1/auth/keys' && body.code === 'codigo-bueno' && hash === orSeen.challenge) {
          res.end(JSON.stringify({ key: 'sk-or-v1-clave-de-prueba-oauth-1234' }))
        } else {
          res.statusCode = 403
          res.end(JSON.stringify({ error: { message: 'Invalid code or code_verifier' } }))
        }
      })
    })
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  const orBase = `http://127.0.0.1:${orServer.address().port}`
  process.env.ACC_OPENROUTER_URL = orBase
  const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)) } return null }

  // 1. El estado de partida y el inicio de sesión de GitHub que falla, se cancela y, por fin, entra.
  const p4a = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    window.__p4Events = []
    window.__p4Off = api.accounts.onEvent((e) => window.__p4Events.push(e))
    await api.github.refresh()
    const first = (await api.accounts.status()).data
    out.first = first.map((a) => a.id + ':' + a.installed + ':' + a.signedIn).join(' ')
    engine.navigate({ page: 'settings', tab: 'accounts' })
    const row = (id) => document.querySelector('[data-accounts] [data-account="' + id + '"]')
    out.rows = Boolean(await until(() => row('github') && row('claude') && row('codex') && row('gemini') && row('opencode') && row('openrouter')))
    out.githubRow = row('github')?.getAttribute('data-signed')
    return out
  })()`)
  fs.writeFileSync(path.join(p4State, 'gh-falla'), '1')
  const p4b = await js(`(async () => {
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    // Falla: se dice por qué, sin cerrar el diálogo.
    document.querySelector('[data-account-login="github"]')?.click()
    out.error = (await until(() => document.querySelector('[data-github-error]')))?.textContent
    return out
  })()`)
  fs.rmSync(path.join(p4State, 'gh-falla'), { force: true })
  const p4c = await js(`(async () => {
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    // «Reintentar» pide otro código; cerrar el diálogo cancela a gh.
    ;[...document.querySelectorAll('[data-github-login] button')].find((b) => /Reintentar/.test(b.textContent))?.click()
    out.code = (await until(() => document.querySelector('[data-github-code]')))?.textContent
    out.text = document.querySelector('[data-github-login]')?.textContent ?? ''
    const before = window.__p4Events.length
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    out.closed = Boolean(await until(() => !document.querySelector('[data-github-login]'), 3000))
    if (!out.closed) { await window.api.accounts.githubCancel(); }
    const cancelled = await until(() => window.__p4Events.slice(before).find((e) => e.id === 'github' && e.phase === 'done'), 5000)
    out.cancelled = cancelled ? cancelled.ok + ':' + cancelled.error : null
    await sleep(200)
    // Y ahora de verdad.
    document.querySelector('[data-account-login="github"]')?.click()
    out.code2 = (await until(() => document.querySelector('[data-github-code]')))?.textContent
    return out
  })()`)
  fs.writeFileSync(path.join(p4State, 'gh-autorizado'), '1')
  const p4d = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    const row = (id) => document.querySelector('[data-accounts] [data-account="' + id + '"]')
    // Al autorizar, el diálogo se cierra solo y la fila cambia sin tocar nada.
    out.closed = Boolean(await until(() => !document.querySelector('[data-github-login]')))
    out.signed = Boolean(await until(() => row('github')?.getAttribute('data-signed') === 'true'))
    out.who = row('github')?.querySelector('[data-account-who]')?.textContent
    out.toast = Boolean(await until(() => document.body.innerText.includes('GitHub: sesión iniciada'), 3000))
    // Que git use esa sesión es un botón aparte.
    const setup = await until(() => document.querySelector('[data-github-setup-git]'), 4000)
    out.setupOffered = Boolean(setup)
    setup?.click()
    out.gitUses = Boolean(await until(async () => (await api.accounts.githubGit()).data === true, 6000))
    out.badge = Boolean(await until(() => /git la usa/.test(row('github')?.textContent ?? ''), 4000))

    // Un CLI: «Iniciar sesión» lanza su comando oficial en una terminal y la fila cambia sola.
    const termsBefore = new Set(Object.keys(engine.peekTerms()))
    document.querySelector('[data-account-login="claude"]')?.click()
    const term = await until(() => Object.values(engine.peekTerms()).find((x) => !termsBefore.has(x.info.id)), 10000)
    out.term = term ? { title: term.info.title, shown: Boolean(await until(() => document.querySelector('[data-page="terminal"]')?.hidden === false && document.querySelector('[data-term-tab="' + term.info.id + '"][data-active]'), 4000)) } : null
    out.typed = term ? Boolean(await until(() => engine.termScrollback(term.info.id).includes('Login successful'), 15000)) : false
    engine.navigate({ page: 'settings', tab: 'accounts' })
    out.claude = Boolean(await until(() => row('claude')?.getAttribute('data-signed') === 'true', 20000))
    out.claudeText = row('claude')?.textContent ?? ''
    out.claudeToast = Boolean(await until(() => document.body.innerText.includes('Claude Code: sesión iniciada'), 4000))
    if (term) await engine.closeTerm(term.info.id)
    return out
  })()`)
  // Lo que cada herramienta dice cuando hay sesión.
  fs.writeFileSync(path.join(p4State, 'codex'), '1')
  fs.writeFileSync(path.join(p4State, 'opencode'), '1')
  fs.mkdirSync(path.join(p4Home, '.gemini'), { recursive: true })
  fs.writeFileSync(path.join(p4Home, '.gemini', 'oauth_creds.json'), '{"refresh_token":"SECRETO-GEMINI"}')
  const p4e = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    const list = (await api.accounts.status()).data
    const by = (id) => list.find((a) => a.id === id)
    out.codex = by('codex')?.signedIn + ':' + by('codex')?.plan
    out.opencode = by('opencode')?.signedIn + ':' + by('opencode')?.who
    out.gemini = by('gemini')?.signedIn + ':' + by('gemini')?.plan
    out.leak = JSON.stringify(list).includes('SECRETO-GEMINI')
    // OpenRouter: empieza el OAuth y dice qué dirección hay que abrir.
    const before = window.__p4Events.length
    window.__p4Or = api.accounts.openrouterLogin()
    const ev = await until(() => window.__p4Events.slice(before).find((e) => e.id === 'openrouter' && e.phase === 'browser'))
    out.url = ev?.url
    return out
  })()`)
  let orUrl = null
  try {
    orUrl = new URL(p4e.url)
  } catch {}
  orSeen.challenge = orUrl?.searchParams.get('code_challenge') ?? ''
  const orCallback = orUrl?.searchParams.get('callback_url') ?? ''
  // Hace de navegador: un código malo primero (no vale) y, en otro intento, el bueno.
  const badPage = orCallback ? await fetch(orCallback + '?code=codigo-malo').then((r) => r.status).catch((e) => String(e)) : 'sin callback'
  const p4f = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    out.bad = (await window.__p4Or).data
    out.keyAfterBad = (await api.providers.status()).data.find((p) => p.id === 'openrouter')?.keySource
    // Segundo intento, por la interfaz.
    const before = window.__p4Events.length
    document.querySelector('[data-openrouter-login]')?.click()
    const ev = await until(() => window.__p4Events.slice(before).find((e) => e.id === 'openrouter' && e.phase === 'browser'))
    out.url = ev?.url
    out.waiting = Boolean(await until(() => /Esperando a que autorices en el navegador/.test(document.querySelector('[data-account="openrouter"]')?.textContent ?? ''), 3000))
    return out
  })()`)
  let orUrl2 = null
  try {
    orUrl2 = new URL(p4f.url)
  } catch {}
  orSeen.challenge = orUrl2?.searchParams.get('code_challenge') ?? ''
  const orCallback2 = orUrl2?.searchParams.get('callback_url') ?? ''
  const goodPage = orCallback2 ? await fetch(orCallback2 + '?code=codigo-bueno').then(async (r) => r.status + ' ' + (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).catch((e) => String(e)) : 'sin callback'
  const reused = orCallback2 ? await fetch(orCallback2 + '?code=codigo-bueno').then((r) => r.status).catch(() => 'cerrado') : 'sin callback'
  const p4g = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80) } return null }
    const out = {}
    out.stored = await until(async () => (await api.providers.status()).data.find((p) => p.id === 'openrouter')?.keySource === 'stored', 6000)
    out.preview = (await api.providers.keyPreview('openrouter')).data
    out.badge = Boolean(await until(() => /key guardada/.test(document.querySelector('[data-account="openrouter"]')?.textContent ?? ''), 4000))
    out.toast = Boolean(await until(() => document.body.innerText.includes('OpenRouter conectado'), 3000))
    out.events = JSON.stringify(window.__p4Events)
    window.__p4Off?.()
    await api.providers.setKey('openrouter', '')
    engine.navigate('chat')
    return out
  })()`)
  const p4Calls = fs.existsSync(p4GhLog) ? fs.readFileSync(p4GhLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  const p4GitConfig = fs.existsSync(path.join(p4Home, '.gitconfig')) ? fs.readFileSync(path.join(p4Home, '.gitconfig'), 'utf8') : ''
  orServer.close()
  delete process.env.ACC_OPENROUTER_URL
  for (const [k, v] of Object.entries(p4Env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await js(`window.api.github.refresh()`)

  log(
    p4a.first === 'github:true:false claude:true:false codex:true:false gemini:true:false opencode:true:false' && p4a.rows && p4a.githubRow === 'false',
    'P4: AJUSTES › CUENTAS PREGUNTA A CADA HERRAMIENTA SI HAY SESIÓN (GITHUB, CLAUDE CODE, CODEX, GEMINI, OPENCODE)',
    p4a.first
  )
  log(/device code expired/.test(p4b.error ?? ''), 'si gh falla, el diálogo dice por qué', p4b.error)
  log(
    p4c.code === 'AB12-CD34' && /caduca en 15 minutos/.test(p4c.text) && p4c.cancelled === 'false:cancelado' && p4c.code2 === 'AB12-CD34',
    'GITHUB SE INICIA SIN SALIR DE LA APP: ENSEÑA EL CÓDIGO DE UN SOLO USO DE gh; CERRAR EL DIÁLOGO LO CANCELA',
    JSON.stringify(p4c)
  )
  log(
    p4d.closed && p4d.signed && p4d.who === 'hugo-cuentas' && p4d.toast,
    'AL AUTORIZAR EN EL NAVEGADOR EL DIÁLOGO SE CIERRA SOLO Y LA FILA PASA A «CON SESIÓN»',
    JSON.stringify({ closed: p4d.closed, signed: p4d.signed, who: p4d.who, toast: p4d.toast })
  )
  log(
    p4d.setupOffered && p4d.gitUses && p4d.badge && /gh auth git-credential/.test(p4GitConfig),
    'que git use esa sesión es un botón aparte (gh auth setup-git)',
    p4GitConfig.replace(/\s+/g, ' ').trim()
  )
  log(
    p4Calls.some((a) => a.join(' ') === 'auth login --hostname github.com --git-protocol https --web') && !p4Calls.some((a) => a.includes('token')),
    'la app lanza el inicio de sesión de gh y nunca le pide el token',
    `${p4Calls.length} llamadas`
  )
  log(
    p4d.term?.title === 'Claude Code' && p4d.term.shown && p4d.typed && p4d.claude && /hugo@example\.com/.test(p4d.claudeText) && /pro/.test(p4d.claudeText) && p4d.claudeToast,
    'UN CLI SE INICIA CON SU COMANDO OFICIAL EN UNA TERMINAL DE LA APP Y SU FILA CAMBIA SOLA AL TERMINAR',
    JSON.stringify({ term: p4d.term, typed: p4d.typed, claude: p4d.claude })
  )
  log(
    p4e.codex === 'true:ChatGPT' && p4e.opencode === 'true:OpenCode Zen, Anthropic' && p4e.gemini === 'true:Google' && !p4e.leak,
    'Codex, OpenCode y Gemini CLI dicen su sesión sin que la app abra ningún fichero de credenciales',
    `${p4e.codex} · ${p4e.opencode} · ${p4e.gemini}`
  )
  log(
    orUrl?.origin === orBase && orUrl.pathname === '/auth' && /^http:\/\/localhost:\d+\/callback$/.test(orCallback) &&
      orUrl.searchParams.get('code_challenge_method') === 'S256' && (orUrl.searchParams.get('code_challenge') ?? '').length >= 43,
    'OPENROUTER: SU OAUTH CON PKCE ABRE SU PÁGINA CON UN RETO Y UN RETORNO QUE SÓLO VALE EN ESTA MÁQUINA',
    p4e.url
  )
  log(
    badPage === 502 && p4f.bad?.ok === false && /Invalid code/.test(p4f.bad?.error ?? '') && p4f.keyAfterBad === 'none',
    'un código que no vale no deja ninguna clave y dice el motivo',
    badPage + ' · ' + JSON.stringify(p4f.bad)
  )
  log(
    /^200 /.test(goodPage) && /OpenRouter está conectado/.test(goodPage) && p4f.waiting && p4g.stored && p4g.badge && p4g.toast && reused !== 200 &&
      orSeen.bodies.filter((b) => b.url === '/api/v1/auth/keys').length === 2 &&
      orSeen.bodies.filter((b) => b.url === '/api/v1/auth/keys').every((b) => b.method === 'POST' && b.method2 === 'S256'),
    'CON EL CÓDIGO BUENO LA CLAVE QUEDA GUARDADA Y EL PROVEEDOR LISTO; EL ENLACE NO SIRVE DOS VECES',
    goodPage + ' · reuso: ' + reused
  )
  log(
    !p4g.events.includes('sk-or-v1-clave') && p4g.preview === 'sk-or...1234',
    'la clave no pasa por la ventana: sólo se ve enmascarada',
    String(p4g.preview)
  )
  /* -------------------------------------------------------------- *
   * P3 · Todo en vivo: lo que se gasta fuera de la app (Claude      *
   *      Code, Codex) y los saldos remotos se ven al momento        *
   * -------------------------------------------------------------- */
  // Un OpenRouter de mentira que dice lo gastado con la clave; cada consulta queda contada.
  const p3Or = { usage: 1.25, hits: 0, auth: [] }
  const p3Server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/v1/key') {
        p3Or.hits++
        p3Or.auth.push(req.headers.authorization)
        res.end(JSON.stringify({ data: { label: 'prueba', limit: 10, limit_remaining: 10 - p3Or.usage, usage: p3Or.usage, usage_daily: p3Or.usage, usage_weekly: p3Or.usage, usage_monthly: p3Or.usage, is_free_tier: false } }))
      } else {
        res.statusCode = 404
        res.end('{}')
      }
    })
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  process.env.ACC_OPENROUTER_URL = `http://127.0.0.1:${p3Server.address().port}`
  const p3Mock = await startAgentMock()

  // Un id nuevo en cada pasada: el histórico de la app de pruebas se conserva entre una y otra.
  const p3Sid = require('node:crypto').randomUUID()
  const p3ProjDir = path.join(CLAUDE_DIR, 'projects', REPO.replace(/[^a-zA-Z0-9]/g, '-'))
  const p3File = path.join(p3ProjDir, p3Sid + '.jsonl')
  const p3Line = (o) => JSON.stringify({ sessionId: p3Sid, cwd: REPO, version: '2.1.220', entrypoint: 'claude-desktop', timestamp: new Date().toISOString(), ...o }) + '\n'
  const p3Assistant = (inTok, outTok, id) =>
    p3Line({ type: 'assistant', uuid: id, message: { id: 'msg_' + id, role: 'assistant', model: 'claude-vivo-zq7', content: [{ type: 'text', text: 'hecho' }], usage: { input_tokens: inTok, output_tokens: outTok, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })

  await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    window.__p3 = { live: [], quotas: [], alerts: [] }
    window.__p3.off = [
      api.live.onChanged((e) => window.__p3.live.push({ at: Date.now(), topics: e.topics })),
      api.quotas.onUpdated((r) => window.__p3.quotas.push({ at: Date.now(), r })),
      api.quotas.onAlert((a) => window.__p3.alerts.push({ at: Date.now(), a }))
    ]
    await api.providers.setKey('openrouter', 'sk-or-v1-clave-p3-0000')
    await api.quotas.get(true)
    engine.navigate('dashboard')
  })()`)
  await new Promise((r) => setTimeout(r, 1500))

  // Los tiempos se miden con el reloj monótono del arnés y los avisos se cuentan por
  // posición: el reloj de pared de WSL da saltos y no sirve para comparar entre procesos.
  const p3Ms = (t0) => Number((process.hrtime.bigint() - t0) / 1000000n)
  const p3Mark = () => js(`({ live: window.__p3.live.length, quotas: window.__p3.quotas.length, alerts: window.__p3.alerts.length })`)

  // 1. Claude Code «fuera» (aquí, la app de escritorio de Claude): la carpeta de
  //    sesiones ni existía al arrancar la app. Aparece una sesión y va creciendo.
  const p3M1 = await p3Mark()
  const p3H1 = process.hrtime.bigint()
  fs.mkdirSync(p3ProjDir, { recursive: true })
  fs.writeFileSync(p3File, p3Line({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'tarea viva zq7 desde fuera' } }) + p3Assistant(1000, 200, 'a1'))
  const p3Found = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const end = performance.now() + 20000
    while (performance.now() < end) {
      const run = (await api.runs.query({ limit: 400 })).data.rows.find((r) => r.cliSessionId === ${JSON.stringify(p3Sid)} || String(r.id).includes(${JSON.stringify(p3Sid)}))
      if (run) return { tokens: run.promptTokens + '/' + run.completionTokens, source: run.source, project: run.projectName, prompt: run.prompt }
      await sleep(100)
    }
    return null
  })()`)
  const p3a = { ...(p3Found ?? {}), found: Boolean(p3Found), ms: p3Ms(p3H1) }
  Object.assign(
    p3a,
    await js(`(async () => {
      const sleep = (n) => new Promise((r) => setTimeout(r, n))
      const until = async (fn, ms = 6000) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await fn(); if (v) return v; await sleep(100) } return null }
      // El Panel, que está a la vista, lo enseña sin tocar nada.
      const panel = Boolean(await until(() => (document.querySelector('[data-page="dashboard"]')?.innerText ?? '').includes('zq7')))
      return { panel, live: window.__p3.live.slice(${p3M1.live}).some((e) => e.topics.includes('runs')) }
    })()`)
  )
  const p3M2 = await p3Mark()
  const p3H2 = process.hrtime.bigint()
  fs.appendFileSync(p3File, p3Assistant(5000, 800, 'a2'))
  const p3Grown = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const end = performance.now() + 10000
    while (performance.now() < end) {
      const run = (await api.runs.query({ limit: 400 })).data.rows.find((r) => r.cliSessionId === ${JSON.stringify(p3Sid)} || String(r.id).includes(${JSON.stringify(p3Sid)}))
      if (run && run.promptTokens === 6000) return { tokens: run.promptTokens + '/' + run.completionTokens }
      await sleep(50)
    }
    return null
  })()`)
  const p3b = { ...(p3Grown ?? {}), grown: Boolean(p3Grown), ms: p3Ms(p3H2) }
  p3b.quotasAfter = await js(`(async () => {
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const end = performance.now() + 5000
    while (performance.now() < end) { if (window.__p3.quotas.length > ${p3M2.quotas}) return true; await sleep(60) }
    return false
  })()`)

  // 2. Codex «fuera»: su sesión apunta un % nuevo del plan y cruza un umbral.
  const p3Codex = path.join(CODEX_HOME, 'sessions', '2026', '09', '29', `rollout-2026-09-29T10-00-00-${CODEX_ID}.jsonl`)
  const p3M3 = await p3Mark()
  const p3H3 = process.hrtime.bigint()
  fs.appendFileSync(
    p3Codex,
    JSON.stringify({
      timestamp: new Date(Date.now() + 5000).toISOString(),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 15000, cached_input_tokens: 4000, output_tokens: 1200, reasoning_output_tokens: 100, total_tokens: 16200 },
          last_token_usage: { input_tokens: 6000, cached_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 0, total_tokens: 6500 }
        },
        rate_limits: { primary: { used_percent: 83, window_minutes: 300, resets_in_seconds: 3000 }, secondary: { used_percent: 14, window_minutes: 10080, resets_in_seconds: 399000 } }
      }
    }) + '\n'
  )
  // Sin pedir nada: el informe nuevo llega solo por su aviso.
  const p3Pct = await js(`(async () => {
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const end = performance.now() + 15000
    while (performance.now() < end) {
      if (window.__p3.quotas.slice(${p3M3.quotas}).some((q) => q.r.quotas.some((x) => x.id === 'codex.primary' && x.usedPct === 83))) return 83
      await sleep(50)
    }
    return window.__p3.quotas.slice(-1)[0]?.r.quotas.find((x) => x.id === 'codex.primary')?.usedPct ?? null
  })()`)
  const p3c = { pct: p3Pct, ms: p3Ms(p3H3) }
  Object.assign(
    p3c,
    await js(`(async () => {
      const api = window.api
      const sleep = (n) => new Promise((r) => setTimeout(r, n))
      const until = async (fn, ms = 5000) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await fn(); if (v) return v; await sleep(60) } return null }
      const alert = await until(() => window.__p3.alerts.slice(${p3M3.alerts}).find((a) => a.a.quotaId === 'codex.primary'))
      const run = (await api.runs.query({ limit: 400 })).data.rows.find((r) => String(r.id) === 'codex-${CODEX_ID}')
      // Y la sección de cupos del Panel pinta ese 83 %.
      const panel = Boolean(await until(() => /83\\s?%/.test(document.querySelector('[data-page="dashboard"]')?.innerText ?? '')))
      return { alert: alert ? alert.a.level : null, tokens: run ? run.promptTokens + '/' + run.completionTokens : null, panel }
    })()`)
  )

  // 3. El saldo de OpenRouter: se gasta «fuera» y, al terminar una ejecución de la app con él, se vuelve a preguntar solo.
  const p3HitsBefore = p3Or.hits
  const p3d = await js(`(async () => {
    const api = window.api
    const of = (r) => r?.quotas.find((x) => x.id === 'openrouter.key')
    const out = { before: of((await api.quotas.get()).data)?.used }
    out.prevBase = (await api.providers.status()).data.find((p) => p.id === 'openrouter')?.baseUrl ?? ''
    await api.providers.setBaseUrl('openrouter', 'http://127.0.0.1:${API_PORT}/v1')
    out.mark = window.__p3.quotas.length
    return out
  })()`)
  p3Or.usage = 4.5
  const p3H4 = process.hrtime.bigint()
  Object.assign(
    p3d,
    await js(`(async () => {
      const api = window.api
      const sleep = (n) => new Promise((r) => setTimeout(r, n))
      const of = (r) => r?.quotas.find((x) => x.id === 'openrouter.key')
      const run = (await api.run.prompt({ providerId: 'openrouter', model: 'modelo-de-prueba', prompt: 'hola p3' }, 'run-p3-or')).data
      const end = performance.now() + 15000
      let after = null
      while (performance.now() < end) {
        if (window.__p3.quotas.slice(${p3d.mark}).some((q) => of(q.r)?.used === 4.5)) { after = 4.5; break }
        await sleep(80)
      }
      return { run: run?.status, after: after ?? of(window.__p3.quotas.slice(-1)[0]?.r)?.used }
    })()`)
  )
  p3d.ms = p3Ms(p3H4)
  await js(`(async () => {
    await window.api.providers.setBaseUrl('openrouter', ${JSON.stringify(p3d.prevBase ?? '')})
    await window.api.runs.remove('run-p3-or')
  })()`)
  const p3HitsAfter = p3Or.hits

  // 4. Una herramienta que aparece con la app abierta también se vigila: se comprobó arriba
  //    (la carpeta de Claude Code no existía). Limpieza.
  await js(`(async () => {
    const api = window.api
    for (const off of window.__p3.off) off()
    await api.providers.setKey('openrouter', '')
    window.__accEngine.navigate('chat')
  })()`)
  // Primero la transcripción (si no, el vigilante la volvería a importar) y luego su ejecución.
  fs.rmSync(p3File, { force: true })
  await new Promise((r) => setTimeout(r, 1500))
  await js(`(async () => {
    const api = window.api
    for (const r of (await api.runs.query({ limit: 400 })).data.rows) if (String(r.id).includes(${JSON.stringify(p3Sid)})) await api.runs.remove(r.id)
  })()`)
  p3Server.close()
  p3Mock.close()
  delete process.env.ACC_OPENROUTER_URL

  log(
    p3a.found && p3a.tokens === '1000/200' && p3a.source === 'terminal' && /tarea viva zq7/.test(p3a.prompt ?? '') && p3a.ms < 12000,
    'P3: UNA SESIÓN DE CLAUDE CODE ABIERTA FUERA ENTRA SOLA AL HISTÓRICO, AUNQUE SU CARPETA APAREZCA CON LA APP YA ABIERTA',
    JSON.stringify(p3a)
  )
  log(p3a.panel && p3a.live, 'el Panel, a la vista, la enseña sin tocar nada', `panel:${p3a.panel} aviso:${p3a.live}`)
  log(
    p3b.grown && p3b.tokens === '6000/1000' && p3b.ms < 3000 && p3b.quotasAfter,
    'MIENTRAS ESA SESIÓN SIGUE GASTANDO, SUS TOKENS SUBEN EN MENOS DE 3 S Y LOS CUPOS SE RECALCULAN',
    JSON.stringify(p3b)
  )
  log(
    p3c.pct === 83 && p3c.ms < 4000 && p3c.tokens === '15000/1200',
    'EL % DEL PLAN QUE CODEX APUNTA EN OTRA TERMINAL LLEGA SOLO A LOS CUPOS EN MENOS DE 4 S',
    JSON.stringify(p3c)
  )
  log(p3c.alert >= 50 && p3c.panel, 'al cruzar un umbral salta su aviso y el Panel pinta el porcentaje nuevo', `aviso al ${p3c.alert} % · panel:${p3c.panel}`)
  log(
    p3d.before === 1.25 && p3d.run === 'ok' && p3d.after === 4.5 && p3d.ms < 6000 && p3HitsAfter > p3HitsBefore,
    'EL SALDO DE OPENROUTER SE VUELVE A PREGUNTAR SOLO AL GASTAR CON ÉL DESDE LA APP: SE VE LO GASTADO FUERA',
    JSON.stringify(p3d) + ` · consultas: ${p3HitsBefore}→${p3HitsAfter}`
  )
  log(
    p3Or.auth.every((a) => a === 'Bearer sk-or-v1-clave-p3-0000'),
    'la clave sólo viaja al propio OpenRouter (aquí, su doble de pruebas)',
    `${p3Or.auth.length} consultas`
  )
  /* -------------------------------------------------------------- *
   * T2 · La mesa de trabajo: varias secciones a la vez, que se      *
   *      dividen, se arrastran, se guardan y se recuerdan           *
   * -------------------------------------------------------------- */
  const t2 = await js(`(async () => {
    const api = window.api
    const wb = window.__accWorkspace
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 6000) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await fn(); if (v) return v; await sleep(60) } return null }
    const out = {}
    const panes = () => Number(document.querySelector('[data-workbench]')?.getAttribute('data-panes'))
    const shown = () => [...document.querySelectorAll('[data-page]')].filter((p) => !p.hidden).map((p) => p.getAttribute('data-page')).sort().join(',')
    const box = (page) => document.querySelector('[data-page="' + page + '"]')?.getBoundingClientRect()
    const headers = () => [...document.querySelectorAll('[data-pane-header]')].map((h) => h.getAttribute('data-pane-header') + (h.hasAttribute('data-focused') ? '*' : '')).join(',')
    wb.applyPresetLayout('single')
    // Lo último usado, en un orden conocido: es lo que entra al partir.
    wb.openSection('dashboard')
    wb.openSection('chat')
    await until(() => shown() === 'chat')
    out.single = panes() + ':' + headers()
    const firstLeaf = (n) => (n.kind === 'leaf' ? n : firstLeaf(n.a))

    // Lo que hay escrito no se pierde al cambiar la distribución: la sección no se vuelve a montar.
    const area = await until(() => document.querySelector('[data-page="chat"] textarea'))
    if (area) area.__marca = 'sigo-aqui'

    // 1. El botón de la barra: «Dos columnas» pone otra sección al lado.
    document.querySelector('[data-layout-menu]')?.click()
    const preset = await until(() => document.querySelector('[data-layout-popover] [data-preset="columns"]'))
    out.presets = [...document.querySelectorAll('[data-layout-popover] [data-preset]')].map((b) => b.getAttribute('data-preset')).join(',')
    preset?.click()
    await until(() => panes() === 2)
    const second = wb.peek().ws.root.b?.page
    out.columns = { panes: panes(), headers: headers(), sideBySide: Math.abs(box('chat').right - box(second).left) < 3 && Math.abs(box('chat').top - box(second).top) < 2 }
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    // 2. El menú: un clic abre en el panel activo; Ctrl+clic, al lado; una que ya está a la vista no se duplica.
    wb.focusPane(wb.peek().ws.root.a.id)
    document.querySelector('[data-nav="terminal"]')?.click()
    await until(() => shown().includes('terminal'))
    out.replace = shown()
    document.querySelector('[data-nav="history"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await until(() => panes() === 3)
    out.beside = { panes: panes(), shown: shown(), focus: headers().split(',').find((h) => h.endsWith('*')) }
    document.querySelector('[data-nav="terminal"]')?.click()
    await sleep(150)
    out.noDup = { panes: panes(), focus: headers().split(',').find((h) => h.endsWith('*')) }
    out.navState = [...document.querySelectorAll('[data-nav][data-nav-state]')].map((b) => b.getAttribute('data-nav') + ':' + b.getAttribute('data-nav-state')).sort().join(',')

    // 3. Cerrar un panel con su ✕: el de al lado se queda con el hueco.
    document.querySelector('[data-pane-header="history"] [data-pane-close]')?.click()
    await until(() => panes() === 2)
    out.closed = shown()

    // 4. Arrastrar una sección del menú y soltarla en el borde de abajo de un panel lo parte.
    const target = wb.peek().ws.focus
    wb.setDrag('tasks')
    const drop = await until(() => document.querySelector('[data-drop-layer] [data-drop-pane="terminal"]'))
    const r = drop.getBoundingClientRect()
    const dt = new DataTransfer()
    const at = { clientX: r.left + r.width / 2, clientY: r.bottom - 12, bubbles: true, cancelable: true, dataTransfer: dt }
    drop.dispatchEvent(new DragEvent('dragover', at))
    await sleep(80)
    out.dropHint = drop.textContent
    drop.dispatchEvent(new DragEvent('drop', at))
    await until(() => panes() === 3)
    const bt = box('terminal'), bk = box('tasks')
    out.dropped = { panes: panes(), below: Math.abs(bt.bottom + 30 - bk.top) < 4 && Math.abs(bt.left - bk.left) < 2, layer: Boolean(document.querySelector('[data-drop-layer]')) }
    // Soltarla en el centro de otro panel las intercambia.
    wb.dropSection('tasks', wb.peek().ws.root.kind === 'split' ? (wb.peek().ws.root.a.kind === 'leaf' ? wb.peek().ws.root.a.id : wb.peek().ws.root.b.id) : target, 'center')
    await sleep(150)
    out.swapped = shown()

    // 5. El tirador reparte el espacio y se recuerda.
    const rootId = wb.peek().ws.root.id
    const handle = document.querySelector('[data-split-handle="' + rootId + '"]')
    out.handle = Boolean(handle)
    wb.resizeSplit(rootId, 0.7, true)
    await sleep(120)
    const host = document.querySelector('[data-workbench]').getBoundingClientRect()
    const firstPage = firstLeaf(wb.peek().ws.root.a).page
    out.ratio = firstPage ? Math.round((box(firstPage).width / host.width) * 100) : null
    handle?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await sleep(120)
    out.even = firstPage ? Math.round((box(firstPage).width / host.width) * 100) : null

    // 6. Guardar la distribución con nombre, cambiar y volver a ella.
    document.querySelector('[data-layout-menu]')?.click()
    const name = await until(() => document.querySelector('[data-layout-name]'))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Mi mesa zq9')
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(80)
    document.querySelector('[data-layout-save]')?.click()
    out.saved = Boolean(await until(() => document.querySelector('[data-saved-layout="Mi mesa zq9"]')))
    const before = shown()
    document.querySelector('[data-layout-popover] [data-preset="single"]')?.click()
    await until(() => panes() === 1)
    out.one = panes()
    document.querySelector('[data-saved-layout="Mi mesa zq9"] button')?.click()
    await until(() => panes() === 3)
    out.restored = shown() === before
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    // 7. Atajos: F6 pasa de panel; Ctrl+Mayús+W lo cierra; Ctrl+\\ parte.
    const f0 = wb.peek().ws.focus
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', bubbles: true }))
    await sleep(80)
    out.f6 = wb.peek().ws.focus !== f0
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true, shiftKey: true, bubbles: true }))
    await until(() => panes() === 2)
    out.closeKey = panes()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\\\', code: 'Backslash', ctrlKey: true, bubbles: true }))
    await until(() => panes() === 3)
    out.splitKey = panes()

    // 8. En un panel estrecho la lista y el detalle de la Consola se pliegan en pestañas que se abren por encima.
    wb.applyPresetLayout('single')
    wb.openSection('chat')
    wb.applyPresetLayout('grid')
    await until(() => panes() === 4)
    // La columna de la Consola, bien estrecha, sea cual sea el tamaño de la ventana.
    wb.resizeSplit(wb.peek().ws.root.id, 0.3, true)
    await until(() => document.querySelector('[data-page="chat"]')?.getAttribute('data-w') === 'tight', 3000)
    const rail = await until(() => document.querySelector('[data-page="chat"] [data-pane-rail="chat.detail"]'), 4000)
    out.rails = [...document.querySelectorAll('[data-page="chat"] [data-pane-rail]')].map((b) => b.getAttribute('data-pane-rail')).sort().join(',')
    out.w = document.querySelector('[data-page="chat"]')?.getAttribute('data-w')
    rail?.click()
    out.drawer = Boolean(await until(() => { const d = document.querySelector('[data-page="chat"] [data-pane-drawer="chat.detail"]'); return d && !d.hidden }, 3000))
    out.four = { panes: panes(), max: wb.splitPane('row') === false }
    out.kept = document.querySelector('[data-page="chat"] textarea')?.__marca === 'sigo-aqui'

    // 9. El menú a tu gusto: esconder una sección y cambiar el orden; los atajos siguen al orden.
    const navIds = () => [...document.querySelectorAll('[data-sidebar] [data-nav]')].map((b) => b.getAttribute('data-nav')).join(',')
    out.navBefore = navIds()
    const st = wb.peek()
    wb.setNav(['terminal', ...st.navOrder.filter((p) => p !== 'terminal')], ['house'])
    await sleep(150)
    out.navAfter = navIds()
    wb.applyPresetLayout('single')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await until(() => shown() === 'terminal', 3000)
    out.ctrl1 = shown()
    // Lo guardado: la mesa, las distribuciones y el menú están en la configuración.
    wb.applyPresetLayout('columns')
    await sleep(700)
    const s = (await api.config.get()).data.settings
    out.persisted = { panes: s.workspace?.root?.kind, layouts: (s.layouts ?? []).map((l) => l.name).join(','), hidden: (s.nav?.hidden ?? []).join(','), first: s.nav?.order?.[0] }
    out.beforeReload = shown()
    return out
  })()`)
  // 10. Al volver a abrir la app, la mesa está como la dejaste.
  await reloadT1()
  const t2b = await js(`(async () => {
    const wb = window.__accWorkspace
    const sleep = (n) => new Promise((r) => setTimeout(r, n))
    const until = async (fn, ms = 6000) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await fn(); if (v) return v; await sleep(60) } return null }
    const shown = () => [...document.querySelectorAll('[data-page]')].filter((p) => !p.hidden).map((p) => p.getAttribute('data-page')).sort().join(',')
    await until(() => Number(document.querySelector('[data-workbench]')?.getAttribute('data-panes')) === 2)
    const out = { shown: shown(), nav: [...document.querySelectorAll('[data-sidebar] [data-nav]')].map((b) => b.getAttribute('data-nav')).join(',') }
    // Y se deja todo como venía para las demás baterías.
    wb.resetNav()
    wb.removeLayout(wb.peek().layouts[0]?.id)
    wb.applyPresetLayout('single')
    wb.openSection('dashboard')
    await sleep(700)
    out.clean = JSON.stringify({ k: wb.peek().ws.root.kind, l: wb.peek().layouts.length })
    return out
  })()`)

  log(t2.single === '1:' && t2.presets === 'single,columns,rows,side,grid', 'T2: CON UNA SOLA SECCIÓN NO HAY CABECERAS; EL BOTÓN DE LA BARRA OFRECE LAS DISTRIBUCIONES', t2.presets)
  log(
    t2.columns?.panes === 2 && t2.columns.sideBySide && /chat/.test(t2.columns.headers),
    '«DOS COLUMNAS» PONE OTRA SECCIÓN AL LADO, CADA UNA CON SU CABECERA',
    JSON.stringify(t2.columns)
  )
  log(
    /terminal/.test(t2.replace) && !/chat/.test(t2.replace) && t2.beside?.panes === 3 && /history/.test(t2.beside.shown) && t2.beside.focus === 'history*',
    'UN CLIC EN EL MENÚ ABRE EN EL PANEL ACTIVO Y CTRL+CLIC ABRE AL LADO',
    `${t2.replace} → ${t2.beside?.shown}`
  )
  log(
    t2.noDup?.panes === 3 && t2.noDup.focus === 'terminal*' && /terminal:focus/.test(t2.navState) && /history:shown/.test(t2.navState),
    'pedir una sección que ya está a la vista lleva a su panel, no la duplica; el menú marca las que se ven',
    t2.navState
  )
  log(t2.closed && !/history/.test(t2.closed) && t2.closed.split(',').length === 2, 'la ✕ de la cabecera cierra el panel', t2.closed)
  log(
    /Abrir abajo/.test(t2.dropHint ?? '') && t2.dropped?.panes === 3 && t2.dropped.below && !t2.dropped.layer,
    'ARRASTRAR UNA SECCIÓN Y SOLTARLA EN EL BORDE DE UN PANEL LO PARTE POR ESE LADO',
    JSON.stringify(t2.dropped) + ' · ' + t2.dropHint
  )
  log(t2.swapped && t2.swapped.split(',').length === 3 && /tasks/.test(t2.swapped), 'soltarla en el centro de otro panel las intercambia', t2.swapped)
  log(t2.handle && t2.ratio === 70 && t2.even === 50, 'EL TIRADOR REPARTE EL ESPACIO Y EL DOBLE CLIC LO IGUALA', `${t2.ratio} % → ${t2.even} %`)
  log(t2.saved && t2.one === 1 && t2.restored, 'UNA DISTRIBUCIÓN SE GUARDA CON NOMBRE Y SE VUELVE A ELLA', JSON.stringify({ saved: t2.saved, restored: t2.restored }))
  log(t2.f6 && t2.closeKey === 2 && t2.splitKey === 3, 'atajos: F6 pasa de panel, Ctrl+Mayús+W lo cierra y Ctrl+\\ parte', JSON.stringify({ f6: t2.f6, close: t2.closeKey, split: t2.splitKey }))
  log(
    t2.rails === 'chat.detail,chat.sessions' && t2.w === 'tight' && t2.drawer && t2.four?.panes === 4 && t2.four.max,
    'EN UN PANEL ESTRECHO LA CONSOLA PLIEGA SU LISTA Y SU DETALLE EN PESTAÑAS; MÁS DE CUATRO PANELES NO CABEN',
    `${t2.rails} · ${t2.w}`
  )
  log(t2.kept, 'CAMBIAR LA DISTRIBUCIÓN NO VUELVE A MONTAR LA SECCIÓN: LO ESCRITO SIGUE AHÍ')
  log(
    !/house/.test(t2.navAfter ?? '') && (t2.navAfter ?? '').startsWith('terminal,') && /house/.test(t2.navBefore ?? '') && t2.ctrl1 === 'terminal',
    'EL MENÚ SE ORDENA Y SE ESCONDE A GUSTO, Y CTRL+1 SIGUE A TU ORDEN',
    t2.navAfter
  )
  log(
    t2.persisted?.panes === 'split' && t2.persisted.layouts === 'Mi mesa zq9' && t2.persisted.hidden === 'house' && t2.persisted.first === 'terminal',
    'la mesa, las distribuciones y el menú quedan guardados',
    JSON.stringify(t2.persisted)
  )
  log(
    t2b.shown === t2.beforeReload && t2b.shown.split(',').length === 2 && !/house/.test(t2b.nav) && t2b.nav.startsWith('terminal,'),
    'AL VOLVER A ABRIR, LA MESA Y EL MENÚ ESTÁN COMO LOS DEJASTE',
    `${t2b.shown} · ${t2b.nav}`
  )
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
