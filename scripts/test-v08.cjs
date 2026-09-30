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
  log(d3.editorLoaded && d3.saved && d3.projectSkillRow, 'EL EDITOR DE INSTRUCCIONES GUARDA EN DISCO, Y SALEN LAS SKILLS DEL PROYECTO', d3.error ?? '')
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
      "process.stdin.on('data', (c) => (prompt += c))",
      "process.stdin.on('end', () => {",
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
      '})'
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
  await new Promise((r) => setTimeout(r, 1200))
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
      "process.stdin.on('data', (c) => (prompt += c))",
      "process.stdin.on('end', () => {",
      "  const sid = 'e4-' + Math.random().toString(16).slice(2, 8)",
      "  out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-falso', cwd: process.cwd() })",
      "  const settings = s !== -1 ? fs.readFileSync(args[s + 1], 'utf8') : 'ninguno'",
      "  const text = 'ajustes=' + settings + ' prompt=' + prompt",
      "  out({ type: 'assistant', session_id: sid, message: { model: 'claude-falso', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } } })",
      "  out({ type: 'result', session_id: sid, total_cost_usd: 0, duration_ms: 5, num_turns: 1, result: text })",
      '})'
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
