/**
 * Prueba de las funciones nuevas, contra la app de verdad.
 *
 * Lo importante que se comprueba aquí es el fallo que se reportó: que una
 * ejecución no muera al cambiar de pantalla. Se lanza un prompt en la Consola,
 * se navega al Panel mientras genera, se vuelve, y se verifica que la
 * respuesta llegó completa y con sus métricas.
 *
 * Se usa un servidor local que habla el protocolo SSE de OpenAI, así que no se
 * gasta ni un token ni se toca ninguna cuenta.
 *
 * Uso: pnpm exec electron scripts/test-features.cjs
 */
const { app, BrowserWindow } = require('electron')
const http = require('node:http')

const PORT = 8124
const CHUNKS = Array.from({ length: 24 }, (_, i) => `trozo${i} `)
const TTFT_DELAY = 200
const CHUNK_DELAY = 90 // total ~2.4 s: da tiempo de sobra a cambiar de pantalla

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'modelo-de-prueba', context_length: 8192 }] }))
        return
      }
      if (!req.url.endsWith('/chat/completions')) {
        res.writeHead(404).end()
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        })
        const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
        await new Promise((r) => setTimeout(r, TTFT_DELAY))
        for (const c of CHUNKS) {
          send({ choices: [{ delta: { content: c }, index: 0 }] })
          await new Promise((r) => setTimeout(r, CHUNK_DELAY))
        }
        send({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 31, completion_tokens: 24, total_tokens: 55 }
        })
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

require('../out/main/index.js')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

app.whenReady().then(async () => {
  const server = await startMock()
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 3000))

  const js = (code) => win.webContents.executeJavaScript(code)

  /* -------------------------------------------------------------- *
   * 1. Una ejecución sobrevive al cambio de pantalla               *
   * -------------------------------------------------------------- */
  const survive = await js(`(async () => {
    const api = window.api
    const sleep = (n) => new Promise(r => setTimeout(r, n))
    const byText = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t)

    const prev = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${PORT}/v1')

    // Se crea una sesión y se manda el prompt desde la propia Consola.
    byText('Consola')?.click()
    await sleep(500)

    const sessionsBefore = (await api.sessions.list()).data.length

    // El motor se usa directamente: es el mismo camino que usa el botón.
    const engine = window.__accEngine
    if (!engine) return { error: 'el motor no está expuesto para pruebas' }

    const sid = await engine.newSession('chat', { providerId: 'vllm', model: 'modelo-de-prueba' })
    const sending = engine.sendChat(sid, {
      providerId: 'vllm',
      model: 'modelo-de-prueba',
      prompt: 'Cuenta hasta veinte',
      maxTokens: 512
    })

    // A mitad de la generación se cambia de pantalla, que es lo que rompía.
    await sleep(700)
    const midTurns = engine.peekChat(sid)?.turns ?? []
    const midText = midTurns[1]?.content ?? ''
    const midLive = midTurns[1]?.live ?? null

    byText('Panel')?.click()
    await sleep(300)
    // Las páginas se quedan montadas y sólo se ocultan, que es justamente lo
    // que permite que la ejecución siga: así que se comprueba el atributo
    // hidden del contenedor y no si el texto está en el documento.
    const hiddenPanels = [...document.querySelectorAll('main > div')].map((d) => d.hasAttribute('hidden'))
    const visibleCount = hiddenPanels.filter((h) => !h).length
    const chatHidden = document.body.innerText.includes('Ctrl + Enter para enviar') === false
    const onDashboard = visibleCount === 1 && chatHidden

    // Se espera a que acabe estando en otra pantalla.
    const run = await sending
    byText('Consola')?.click()
    await sleep(400)

    const after = engine.peekChat(sid)?.turns ?? []
    const finalText = after[1]?.content ?? ''
    const metrics = after[1]?.metrics ?? null

    // Y sigue guardada tras recargar la lista desde disco.
    await engine.flushPersist()
    await sleep(400)
    const stored = (await api.sessions.get(sid)).data
    const sessionsAfter = (await api.sessions.list()).data.length

    // Limpieza
    await engine.deleteSession(sid)
    if (run?.id) await api.runs.remove(run.id)
    await api.providers.setBaseUrl('vllm', prev)

    return {
      midText, midLive, onDashboard, finalText, metrics, run,
      storedTurns: stored?.turns?.length ?? 0,
      storedText: stored?.turns?.[1]?.content ?? '',
      storedMetrics: stored?.turns?.[1]?.metrics ?? null,
      sessionsBefore, sessionsAfter
    }
  })()`)

  const expected = CHUNKS.join('')

  if (survive.error) {
    log(false, 'el motor está accesible para la prueba', survive.error)
  } else {
    log(
      survive.midText.length > 0 && survive.midText.length < expected.length,
      'el texto va llegando por streaming',
      `${survive.midText.length} de ${expected.length} caracteres a mitad`
    )
    log(
      survive.midLive != null && survive.midLive.ttftMs != null,
      'las métricas en vivo existen mientras genera',
      survive.midLive ? `primer token a los ${survive.midLive.ttftMs} ms, ~${survive.midLive.approxTokens} tokens` : 'sin métricas'
    )
    log(survive.onDashboard, 'la navegación al Panel ocurre de verdad')
    log(
      survive.finalText === expected,
      'LA RESPUESTA LLEGA COMPLETA PESE A CAMBIAR DE PANTALLA',
      `${survive.finalText.length} de ${expected.length} caracteres`
    )
    log(
      survive.metrics?.promptTokens === 31 && survive.metrics?.completionTokens === 24,
      'las métricas finales son las reales del proveedor',
      survive.metrics ? `${survive.metrics.promptTokens} → ${survive.metrics.completionTokens}` : 'sin métricas'
    )
    log(
      (survive.metrics?.tokensPerSec ?? 0) > 0 && (survive.metrics?.ttftMs ?? 0) >= TTFT_DELAY,
      'velocidad y latencia calculadas',
      `${(survive.metrics?.tokensPerSec ?? 0).toFixed(1)} t/s, primer token ${survive.metrics?.ttftMs} ms`
    )
    log(
      survive.storedTurns === 2 && survive.storedText === expected,
      'la conversación queda guardada en disco y se puede retomar',
      `${survive.storedTurns} turnos, ${survive.storedText.length} caracteres`
    )
    log(
      survive.storedMetrics?.completionTokens === 24,
      'las métricas viajan con la sesión guardada'
    )
  }

  /* -------------------------------------------------------------- *
   * 2. Sesiones: cerrar, reabrir y borrar                          *
   * -------------------------------------------------------------- */
  const sess = await js(`(async () => {
    const api = window.api
    const engine = window.__accEngine
    const sid = await engine.newSession('chat', { title: 'Prueba de ciclo' })

    await api.sessions.patch(sid, { turns: [
      { id: 'a', role: 'user', content: 'hola' },
      { id: 'b', role: 'assistant', content: 'adiós', metrics: {
        promptTokens: 1, completionTokens: 1, totalTokens: 2, totalMs: 10,
        costTotal: 0, costEstimated: true, status: 'ok' } }
    ] })

    await engine.archiveSession(sid)
    const archived = (await api.sessions.get(sid)).data
    const inOpenList = (await api.sessions.list()).data.filter(s => !s.archived).some(s => s.id === sid)

    await engine.unarchiveSession(sid)
    const reopened = (await api.sessions.get(sid)).data

    await engine.openSession(sid)
    const loadedTurns = engine.peekChat(sid)?.turns?.length ?? 0

    await engine.deleteSession(sid)
    const gone = (await api.sessions.get(sid)).data

    return {
      archivedFlag: archived?.archived === true,
      keptTurns: archived?.turns?.length ?? 0,
      inOpenList,
      reopenedFlag: reopened?.archived === false,
      loadedTurns,
      gone: gone === null
    }
  })()`)

  log(sess.archivedFlag && sess.keptTurns === 2, 'cerrar una sesión la archiva sin perder la conversación', `${sess.keptTurns} turnos conservados`)
  log(!sess.inOpenList, 'una sesión cerrada desaparece de las abiertas')
  log(sess.reopenedFlag, 'una sesión cerrada se puede reabrir')
  log(sess.loadedTurns === 2, 'al reabrirla se recupera su conversación', `${sess.loadedTurns} turnos`)
  log(sess.gone, 'borrarla la elimina del todo')

  /* -------------------------------------------------------------- *
   * 3. Enlaces de modelos                                          *
   * -------------------------------------------------------------- */
  const links = await js(`(async () => {
    const api = window.api
    const cases = [
      ['anthropic', 'claude-opus-4'],
      ['openai', 'gpt-4o'],
      ['openrouter', 'qwen/qwen3-8b'],
      ['ollama', 'qwen3:8b'],
      ['groq', 'llama-3.3-70b-versatile'],
      ['huggingface', 'Qwen/Qwen3-8B']
    ]
    const out = {}
    for (const [p, m] of cases) {
      const r = await api.models.links(p, m)
      out[p] = r.data
    }
    return out
  })()`)

  const allHttps = Object.values(links).every((l) => l?.primary?.startsWith('https://'))
  log(allHttps, 'todos los enlaces son direcciones https válidas')
  log(
    links.ollama?.primary === 'https://ollama.com/library/qwen3',
    'el enlace de un modelo de Ollama apunta a su biblioteca',
    links.ollama?.primary
  )
  log(
    links.openrouter?.primary === 'https://openrouter.ai/qwen/qwen3-8b',
    'el de OpenRouter apunta al modelo exacto',
    links.openrouter?.primary
  )
  log(
    links.huggingface?.primary === 'https://huggingface.co/Qwen/Qwen3-8B',
    'el de Hugging Face apunta al repositorio',
    links.huggingface?.primary
  )
  log(
    links.anthropic?.primaryKind === 'provider' && links.anthropic.extras.length > 0,
    'cuando no hay página por modelo se dice y se ofrecen alternativas',
    `${links.anthropic?.extras?.length ?? 0} alternativas`
  )
  log(
    Object.values(links).every((l) => Array.isArray(l?.extras)),
    'todos traen su lista de alternativas'
  )

  /* -------------------------------------------------------------- *
   * 4. Detección de motores locales                                *
   * -------------------------------------------------------------- */
  const detect = await js('window.api.detect.local()')
  const ollama = (detect.data ?? []).find((s) => s.id === 'ollama')
  log(Boolean(ollama), 'Ollama aparece en el sondeo de motores locales')
  log(
    ollama?.up === true,
    'lo detecta encendido ahora que lo está',
    ollama?.up ? `${ollama.models.length} modelos en ${ollama.latencyMs} ms` : `caído (${ollama?.url})`
  )

  /* -------------------------------------------------------------- *
   * 5. Notificaciones                                              *
   * -------------------------------------------------------------- */
  const { Notification } = require('electron')
  log(Notification.isSupported(), 'el sistema acepta notificaciones de escritorio')
  const cfg = await js('window.api.config.get()')
  log(
    cfg.data?.settings?.notifyOnFinish === true,
    'el aviso al terminar viene activado por defecto'
  )

  /* -------------------------------------------------------------- *
   * 6. Terminal dentro de la app                                   *
   * -------------------------------------------------------------- */
  // Comprobación somera: el detalle de la terminal lo cubre test-pty.cjs.
  const term = await js(`(async () => {
    const engine = window.__accEngine
    const sleep = (n) => new Promise(r => setTimeout(r, n))
    let buf = ''
    const { id } = await engine.openTerm({ title: 'prueba' })
    const off = engine.onTermData(id, (f) => { if (f.type === 'data') buf += f.data })
    await sleep(1600)
    engine.sendTermCommand(id, 'Write-Output "vivo"')
    for (let i = 0; i < 60; i++) {
      if (engine.peekTerm(id)?.busy === false && buf.includes('vivo')) break
      await sleep(100)
    }
    const st = engine.peekTerm(id)
    const backend = st?.info?.backend
    const exitCode = st?.lastExit?.code
    off()
    await engine.closeTerm(id)
    return { ok: buf.includes('vivo'), exitCode, backend }
  })()`)

  log(
    term.ok && term.exitCode === 0,
    'la terminal integrada ejecuta y devuelve su salida',
    `motor ${term.backend}, código ${term.exitCode}`
  )

  console.log('\nRESULTADOS')
  for (const line of results) console.log('  ' + line)
  const failed = results.filter((l) => l.startsWith('FALLA')).length
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`)

  server.close()
  app.exit(failed ? 1 : 0)
})
