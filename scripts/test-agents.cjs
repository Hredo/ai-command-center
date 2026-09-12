/**
 * Prueba de lo que rodea a un agente: razonamiento, contexto, límites de uso,
 * archivos tocados, líneas editadas, ramas, adjuntos y esfuerzo.
 *
 * No se llama a ningún proveedor ni a ningún CLI de verdad: se dan de alta
 * agentes falsos que son un script de Node escupiendo eventos con el mismo
 * formato exacto que Claude Code y OpenCode —los formatos se capturaron de las
 * dos herramientas reales—, y un repositorio git de mentira en una carpeta
 * temporal. Así la prueba es rápida, gratis y repetible.
 *
 * Uso: pnpm exec electron scripts/test-agents.cjs
 */
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const PORT = 8126
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-agents-'))
const REPO = path.join(TMP, 'repo')
const FIXTURES = path.join(TMP, 'fixtures')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

/* ------------------------------------------------------------------ *
 * Escenario en disco                                                 *
 * ------------------------------------------------------------------ */

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function setupRepo() {
  fs.mkdirSync(REPO, { recursive: true })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'prueba@local'])
  git(['config', 'user.name', 'Prueba'])
  fs.writeFileSync(path.join(REPO, 'app.js'), 'uno\ndos\ntres\n', 'utf8')
  fs.writeFileSync(path.join(REPO, 'README.md'), '# repo de prueba\n', 'utf8')
  git(['add', '.'])
  git(['commit', '-qm', 'primer commit'])
  git(['branch', 'otra-rama'])
}

/**
 * Agente falso que habla como OpenCode: emite sus eventos por líneas, toca
 * archivos de verdad y termina con los tokens y el coste del paso.
 */
const OPENCODE_FIXTURE = `
const fs = require('node:fs')
const path = require('node:path')
const repo = process.argv[2]
const prompt = process.argv[3] ?? ''
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')

out({ type: 'step_start', part: { type: 'step-start' } })
out({ type: 'tool_use', part: { type: 'tool', tool: 'read', state: { input: { filePath: path.join(repo, 'README.md') } } } })
out({ type: 'reasoning', part: { type: 'reasoning', text: 'Primero mirar el archivo, luego editarlo.' } })
out({ type: 'tool_use', part: { type: 'tool', tool: 'edit', state: { input: { filePath: path.join(repo, 'app.js') } } } })

// Cambios de verdad en el disco: dos líneas nuevas y una quitada.
fs.writeFileSync(path.join(repo, 'app.js'), 'uno\\ndos\\ncuatro\\ncinco\\n', 'utf8')
fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'a\\nb\\nc\\n', 'utf8')

out({ type: 'text', part: { type: 'text', text: 'Listo: he editado app.js. Prompt recibido: ' + prompt.length + ' caracteres.' } })
out({
  type: 'step_finish',
  part: {
    type: 'step-finish',
    reason: 'stop',
    tokens: { total: 18072, input: 11877, output: 51, reasoning: 7, cache: { write: 0, read: 6144 } },
    cost: 0.0123
  }
})
`

/** Agente falso que habla como Claude Code con --output-format stream-json. */
const CLAUDE_FIXTURE = `
const path = require('node:path')
const repo = process.argv[2]
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')

out({ type: 'system', model: 'claude-modelo-de-prueba' })
out({
  type: 'assistant',
  message: {
    model: 'claude-modelo-de-prueba',
    content: [
      { type: 'thinking', thinking: 'Voy a leer el fichero antes de tocar nada.' },
      { type: 'tool_use', name: 'Read', input: { file_path: path.join(repo, 'app.js') } },
      { type: 'tool_use', name: 'Edit', input: { file_path: path.join(repo, 'app.js') } },
      { type: 'text', text: 'Hecho.' }
    ],
    usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 }
  }
})
out({ type: 'result', total_cost_usd: 0.0456, duration_ms: 1234, num_turns: 2, result: 'Hecho.' })
`

/** Agente falso que sólo devuelve el prompt que le llegó: para los adjuntos. */
const ECHO_FIXTURE = `
process.stdout.write(process.argv[2] ?? '')
`

function setupFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true })
  fs.writeFileSync(path.join(FIXTURES, 'opencode.js'), OPENCODE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'claude.js'), CLAUDE_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'echo.js'), ECHO_FIXTURE, 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'adjunto.txt'), 'alfa\nbeta\ngamma\n', 'utf8')
  fs.writeFileSync(path.join(FIXTURES, 'binario.bin'), Buffer.from([1, 2, 0, 3, 4, 0, 5]))
}

/**
 * Proveedor de mentira que además manda cabeceras de límite de uso: es de
 * donde sale el "límite de uso" que se ve en la interfaz.
 */
function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'modelo-de-prueba', context_length: 32000 }] }))
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-ratelimit-limit-requests': '1000',
          'x-ratelimit-remaining-requests': '994',
          'x-ratelimit-limit-tokens': '400000',
          'x-ratelimit-remaining-tokens': '381500',
          'x-ratelimit-reset-tokens': '90s'
        })
        const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
        // El cuerpo se devuelve dentro de la respuesta para poder comprobar
        // qué se mandó: esfuerzo y adjuntos.
        send({ choices: [{ delta: { content: 'recibido:' + body.length } }] })
        send({ choices: [{ delta: { content: /reasoning_effort/.test(body) ? ' con-esfuerzo' : ' sin-esfuerzo' } }] })
        send({ choices: [{ delta: { content: /alfa/.test(body) ? ' con-adjunto' : ' sin-adjunto' } }] })
        send({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 }
        })
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

setupRepo()
setupFixtures()

require('../out/main/index.js')

app.whenReady().then(async () => {
  const server = await startMock()
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 3000))
  const js = (code) => win.webContents.executeJavaScript(code)

  const ctx = JSON.stringify({
    repo: REPO,
    fixtures: FIXTURES,
    node: process.execPath.replace(/electron\.exe$/i, 'electron.exe'),
    port: PORT
  })

  /* -------------------------------------------------------------- *
   * 1. Un agente tipo OpenCode: razonamiento, archivos, contexto   *
   * -------------------------------------------------------------- */
  const oc = await js(`(async () => {
    const { repo, fixtures } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const sleep = (n) => new Promise(r => setTimeout(r, n))
    if (!engine) return { error: 'sin motor' }

    const agent = {
      id: 'prueba-opencode', name: 'OpenCode de prueba', type: 'cli',
      command: 'node', args: [fixtures + '\\\\opencode.js', repo, '{{prompt}}'],
      parser: 'opencode-json', color: '#22d3ee', createdAt: Date.now()
    }
    await api.agents.saveCli(agent)

    const sid = await engine.newSession('cli', { cliAgentId: agent.id })
    const run = await engine.sendCli(sid, {
      prompt: 'edita app.js',
      agentId: agent.id,
      agentName: agent.name,
      projectPath: repo,
      effort: 'high'
    })
    await sleep(400)
    const turns = engine.peekChat(sid)?.turns ?? []
    const a = turns[1] ?? {}

    await engine.deleteSession(sid)
    if (run?.id) await api.runs.remove(run.id)
    await api.agents.removeCli(agent.id)

    return {
      texto: a.content ?? '',
      razonamiento: a.reasoning ?? '',
      metrics: a.metrics ?? null,
      files: a.metrics?.filesChanged ?? a.files ?? [],
      touched: a.metrics?.filesTouched ?? a.touched ?? [],
      coste: run?.costTotal, estimado: run?.costEstimated,
      rama: run?.branch, contexto: run?.contextLimit, tokens: run?.totalTokens
    }
  })()`)

  if (oc.error) {
    log(false, 'agente estilo OpenCode', oc.error)
  } else {
    log(oc.texto.includes('he editado app.js'), 'el texto sale limpio, sin el JSON crudo', oc.texto.slice(0, 60))
    log(
      oc.razonamiento.includes('mirar el archivo'),
      'SE VE EL RAZONAMIENTO DEL AGENTE',
      oc.razonamiento.slice(0, 60)
    )
    const app = oc.files.find((f) => f.path === 'app.js')
    log(
      Boolean(app) && app.added === 2 && app.removed === 1,
      'LÍNEAS EDITADAS CONTADAS CON GIT',
      app ? `app.js +${app.added} -${app.removed}` : 'no aparece app.js'
    )
    const nuevo = oc.files.find((f) => f.path === 'nuevo.txt')
    log(
      Boolean(nuevo) && nuevo.status === '?' && nuevo.added === 3,
      'un archivo nuevo cuenta sus líneas aunque git no lo siga',
      nuevo ? `+${nuevo.added}` : 'no aparece'
    )
    const leido = oc.touched.find((t) => t.kind === 'read')
    const editado = oc.touched.find((t) => t.kind === 'edit')
    log(
      Boolean(leido) && Boolean(editado) && leido.path.endsWith('README.md'),
      'DISTINGUE LO QUE SÓLO LEE DE LO QUE EDITA',
      `leído ${leido?.path?.split(/[\\\\/]/).pop()}, editado ${editado?.path?.split(/[\\\\/]/).pop()}`
    )
    log(oc.metrics?.contextUsed === 18072, 'el contexto ocupado sale del propio agente', String(oc.metrics?.contextUsed))
    log(oc.tokens === 11928, 'tokens reales de entrada y salida', String(oc.tokens))
    log(
      Math.abs((oc.coste ?? 0) - 0.0123) < 1e-9 && oc.estimado === false,
      'el coste es el que informa el agente, no una estimación',
      String(oc.coste)
    )
    log(oc.rama === 'main', 'se guarda la rama en la que trabajó', String(oc.rama))
  }

  /* -------------------------------------------------------------- *
   * 2. Un agente tipo Claude Code: pensamiento y herramientas      *
   * -------------------------------------------------------------- */
  const cc = await js(`(async () => {
    const { repo, fixtures } = ${ctx}
    const api = window.api
    const engine = window.__accEngine
    const agent = {
      id: 'prueba-claude', name: 'Claude de prueba', type: 'cli',
      command: 'node', args: [fixtures + '\\\\claude.js', repo],
      parser: 'claude-stream-json', color: '#f0b429', createdAt: Date.now()
    }
    await api.agents.saveCli(agent)
    const sid = await engine.newSession('cli', { cliAgentId: agent.id })
    const run = await engine.sendCli(sid, {
      prompt: 'arregla el bug', agentId: agent.id, agentName: agent.name, projectPath: repo
    })
    await new Promise(r => setTimeout(r, 300))
    const a = (engine.peekChat(sid)?.turns ?? [])[1] ?? {}
    await engine.deleteSession(sid)
    if (run?.id) await api.runs.remove(run.id)
    await api.agents.removeCli(agent.id)
    return {
      razonamiento: a.reasoning ?? '',
      touched: run?.filesTouched ?? [],
      modelo: run?.model, contexto: a.metrics?.contextUsed, coste: run?.costTotal
    }
  })()`)

  log(cc.razonamiento.includes('leer el fichero'), 'el pensamiento de Claude Code se muestra', cc.razonamiento.slice(0, 50))
  log(
    cc.touched.some((t) => t.kind === 'read') && cc.touched.some((t) => t.kind === 'edit'),
    'las herramientas de Claude Code se traducen a archivos tocados',
    cc.touched.map((t) => t.kind).join(', ')
  )
  log(cc.modelo === 'claude-modelo-de-prueba', 'el modelo real llega al registro', String(cc.modelo))
  log(cc.contexto === 2140, 'el contexto suma entrada, caché y salida', String(cc.contexto))

  /* -------------------------------------------------------------- *
   * 3. Adjuntos y esfuerzo en un CLI                               *
   * -------------------------------------------------------------- */
  const at = await js(`(async () => {
    const { repo, fixtures } = ${ctx}
    const api = window.api
    const engine = window.__accEngine

    const txt = await api.attach.describe(fixtures + '\\\\adjunto.txt')
    const bin = await api.attach.describe(fixtures + '\\\\binario.bin')

    const agent = {
      id: 'prueba-echo', name: 'Eco', type: 'cli',
      command: 'node', args: [fixtures + '\\\\echo.js', '{{prompt}}'],
      parser: 'plain', color: '#8b5cf6', createdAt: Date.now()
    }
    await api.agents.saveCli(agent)
    const sid = await engine.newSession('cli', { cliAgentId: agent.id })
    const run = await engine.sendCli(sid, {
      prompt: 'mira esto', agentId: agent.id, projectPath: repo,
      attachments: txt.data ? [txt.data] : []
    })
    await new Promise(r => setTimeout(r, 200))
    const a = (engine.peekChat(sid)?.turns ?? [])[1] ?? {}
    const user = (engine.peekChat(sid)?.turns ?? [])[0] ?? {}
    await engine.deleteSession(sid)
    if (run?.id) await api.runs.remove(run.id)
    await api.agents.removeCli(agent.id)

    // Un CLI con esfuerzo de verdad: se comprueba la línea de comandos que se
    // arma, aunque el ejecutable no exista en este equipo.
    const codex = {
      id: 'prueba-codex', name: 'Codex de prueba', type: 'cli',
      command: 'codex', args: ['exec', '{{prompt}}'],
      parser: 'plain', color: '#fff', createdAt: Date.now()
    }
    await api.agents.saveCli(codex)
    const sid2 = await engine.newSession('cli', { cliAgentId: codex.id })
    let meta = ''
    const off = window.api.cli.onEvent((e) => { if (e.type === 'meta') meta += e.data + '\\n' })
    const run2 = await engine.sendCli(sid2, {
      prompt: 'hola', agentId: codex.id, projectPath: repo, effort: 'high'
    })
    if (typeof off === 'function') off()
    await engine.deleteSession(sid2)
    if (run2?.id) await api.runs.remove(run2.id)
    await api.agents.removeCli(codex.id)

    return {
      txt: txt.data, bin: bin.data,
      salida: a.content ?? '',
      adjuntosGuardados: (user.attachments ?? []).length,
      meta, esfuerzoRegistrado: run2?.effort
    }
  })()`)

  log(at.txt?.text === true && at.txt?.lines >= 3, 'un adjunto de texto se describe con sus líneas', `${at.txt?.lines} líneas`)
  log(at.bin?.text === false && Boolean(at.bin?.skipped), 'un binario se detecta y no se manda su contenido', at.bin?.skipped ?? '')
  log(
    at.salida.includes('Archivos adjuntos') && at.salida.includes('adjunto.txt'),
    'AL CLI SE LE PASAN LAS RUTAS DE LOS ADJUNTOS',
    at.salida.replace(/\s+/g, ' ').slice(0, 80)
  )
  log(at.adjuntosGuardados === 1, 'el turno del usuario guarda sus adjuntos', String(at.adjuntosGuardados))
  log(
    at.meta.includes('model_reasoning_effort=high') && at.meta.includes('exec -c'),
    'EL ESFUERZO SE TRADUCE A ARGUMENTOS DEL CLI',
    (at.meta.split('\n')[0] ?? '').slice(0, 90)
  )
  log(at.esfuerzoRegistrado === 'high', 'el esfuerzo queda en el registro de la ejecución', String(at.esfuerzoRegistrado))

  /* -------------------------------------------------------------- *
   * 4. Ramas: listar, crear y cambiar                              *
   * -------------------------------------------------------------- */
  const gitRes = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const antes = (await api.git.info(repo)).data
    const cambio = (await api.git.checkout(repo, 'otra-rama')).data
    const despues = (await api.git.info(repo)).data
    const nueva = (await api.git.checkout(repo, 'rama-nueva', true)).data
    const final = (await api.git.info(repo)).data
    await api.git.checkout(repo, 'main')
    const cambios = (await api.git.changes(repo)).data
    return { antes, cambio, despues, nueva, final, cambios }
  })()`)

  log(gitRes.antes?.repo === true && gitRes.antes?.branch === 'main', 'detecta el repositorio y su rama', String(gitRes.antes?.branch))
  log(
    (gitRes.antes?.localBranches ?? []).includes('otra-rama'),
    'lista las ramas locales',
    (gitRes.antes?.localBranches ?? []).join(', ')
  )
  log(gitRes.cambio?.ok === true && gitRes.despues?.branch === 'otra-rama', 'SE PUEDE CAMBIAR DE RAMA', String(gitRes.despues?.branch))
  log(gitRes.nueva?.ok === true && gitRes.final?.branch === 'rama-nueva', 'y crear una rama nueva', String(gitRes.final?.branch))
  log(
    (gitRes.antes?.dirty ?? 0) + (gitRes.antes?.untracked ?? 0) > 0,
    'cuenta lo que hay sin confirmar',
    `${gitRes.antes?.dirty} sin añadir, ${gitRes.antes?.untracked} nuevos`
  )
  log(
    (gitRes.cambios ?? []).some((c) => c.path === 'app.js' && c.added === 2),
    'los cambios sueltos del árbol se leen aparte',
    (gitRes.cambios ?? []).map((c) => c.path).join(', ')
  )

  /* -------------------------------------------------------------- *
   * 5. Por API: límites de uso, contexto y esfuerzo                *
   * -------------------------------------------------------------- */
  const api = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const { repo, fixtures } = ${ctx}

    const prev = (await api.config.get()).data
    const prevBase = prev.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${PORT}/v1')

    // Ventana de contexto declarada a mano: es una de las tres fuentes que
    // usa la app, y la única que no depende de la red.
    const cfg = (await api.config.get()).data
    cfg.customModels = [...(cfg.customModels ?? []), {
      id: 'modelo-de-prueba', providerId: 'vllm', name: 'Modelo de prueba',
      contextLength: 32000, source: 'manual'
    }]
    await api.config.save(cfg)

    const txt = (await api.attach.describe(fixtures + '\\\\adjunto.txt')).data
    const sid = await engine.newSession('chat', { providerId: 'vllm', model: 'modelo-de-prueba' })
    const run = await engine.sendChat(sid, {
      providerId: 'vllm', model: 'modelo-de-prueba', prompt: 'hola',
      effort: 'high', attachments: [txt], projectPath: repo
    })
    await new Promise(r => setTimeout(r, 300))
    const a = (engine.peekChat(sid)?.turns ?? [])[1] ?? {}

    await engine.deleteSession(sid)
    if (run?.id) await api.runs.remove(run.id)
    const cfg2 = (await api.config.get()).data
    cfg2.customModels = (cfg2.customModels ?? []).filter(m => m.id !== 'modelo-de-prueba')
    await api.config.save(cfg2)
    await api.providers.setBaseUrl('vllm', prevBase)

    return {
      texto: run?.response ?? '', limite: run?.usageLimit ?? a.metrics?.usageLimit,
      contexto: run?.contextLimit, esfuerzo: run?.effort,
      promptGuardado: run?.prompt, adjuntos: run?.attachmentCount
    }
  })()`)

  log(api.texto.includes('con-esfuerzo'), 'EL ESFUERZO VIAJA EN LA PETICIÓN AL PROVEEDOR', api.texto)
  log(api.texto.includes('con-adjunto'), 'EL CONTENIDO DEL ADJUNTO VIAJA EN LA PETICIÓN')
  log(api.promptGuardado === 'hola' && api.adjuntos === 1, 'el histórico guarda tu prompt, no el volcado del archivo', api.promptGuardado)
  log(api.contexto === 32000, 'LA VENTANA DE CONTEXTO DEL MODELO SE RESUELVE', String(api.contexto))
  log(
    api.limite?.requestsRemaining === 994 && api.limite?.tokensRemaining === 381500,
    'EL LÍMITE DE USO SALE DE LAS CABECERAS DEL PROVEEDOR',
    `${api.limite?.requestsRemaining} peticiones, ${api.limite?.tokensRemaining} tokens`
  )
  log(
    typeof api.limite?.resetAt === 'number' && api.limite.resetAt > Date.now(),
    'y cuándo se repone',
    api.limite?.resetAt ? new Date(api.limite.resetAt).toISOString() : 'sin dato'
  )

  /* -------------------------------------------------------------- *
   * Cierre                                                        *
   * -------------------------------------------------------------- */
  server.close()
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
