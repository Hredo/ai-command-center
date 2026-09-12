/**
 * Prueba de extremo a extremo del motor de ejecución.
 *
 * Levanta un servidor local que habla el protocolo SSE de OpenAI, apunta el
 * proveedor "vllm" a ese servidor y lanza un prompt real desde el renderer,
 * pasando por preload, IPC, el motor de streaming y el histórico.
 * Al terminar deja la configuración y el histórico como estaban.
 *
 * Uso: pnpm exec electron scripts/test-engine.cjs
 */
const { app, BrowserWindow } = require('electron')
const http = require('node:http')

const PORT = 8123
const CHUNKS = ['Hola', ', ', 'esto ', 'es ', 'una ', 'prueba ', 'del ', 'motor', '.']
const TTFT_DELAY = 220 // ms antes del primer token, para medir latencia inicial
const CHUNK_DELAY = 40

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
        const parsed = JSON.parse(body)
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
        // Uso real, como haría un proveedor de verdad
        send({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 }
        })
        res.write('data: [DONE]\n\n')
        res.end()
        server.emit('served', parsed)
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

require('../out/main/index.js')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

app.whenReady().then(async () => {
  const server = await startMock()
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 2500))

  const out = await win.webContents.executeJavaScript(`(async () => {
    const api = window.api
    const prev = (await api.config.get()).data.providers['vllm']?.baseUrl ?? ''
    await api.providers.setBaseUrl('vllm', 'http://127.0.0.1:${PORT}/v1')

    const runId = crypto.randomUUID()
    const deltas = []
    const off = api.run.onDelta(d => { if (d.runId === runId && d.type === 'text') deltas.push(d.text) })

    const res = await api.run.prompt({
      providerId: 'vllm',
      model: 'modelo-de-prueba',
      prompt: 'Di hola',
      systemPrompt: 'Eres breve.',
      temperature: 0.5,
      maxTokens: 256,
      kind: 'chat'
    }, runId)
    off()

    const hist = await api.runs.query({ limit: 5 })
    const found = hist.data.rows.find(r => r.id === runId)
    const overview = await api.runs.overview(30)

    // Limpieza: se borra la ejecución de prueba y se restaura el endpoint
    await api.runs.remove(runId)
    await api.providers.setBaseUrl('vllm', prev)

    return {
      streamed: deltas.join(''),
      deltaCount: deltas.length,
      run: res.data,
      persisted: Boolean(found),
      overviewRuns: overview.data.totalRuns
    }
  })()`)

  const r = out.run ?? {}
  log(out.streamed === CHUNKS.join(''), 'el texto llega completo por streaming', JSON.stringify(out.streamed))
  log(out.deltaCount === CHUNKS.length, 'llega un evento por fragmento', `${out.deltaCount} deltas`)
  log(r.status === 'ok', 'la ejecución termina correctamente', r.status)
  log(r.promptTokens === 42 && r.completionTokens === 17, 'toma el uso real del proveedor', `${r.promptTokens} → ${r.completionTokens}`)
  log(r.ttftMs >= TTFT_DELAY && r.ttftMs < TTFT_DELAY + 900, 'mide la latencia hasta el primer token', `${r.ttftMs} ms`)
  log(r.totalMs >= TTFT_DELAY + CHUNK_DELAY * CHUNKS.length - 60, 'mide el tiempo total', `${r.totalMs} ms`)
  log(r.tokensPerSec > 0, 'calcula la velocidad de generación', `${(r.tokensPerSec ?? 0).toFixed(1)} t/s`)
  log(typeof r.costTotal === 'number', 'calcula el coste', `$${r.costTotal}`)
  log(out.persisted, 'la ejecución queda guardada en el histórico')
  log(typeof out.overviewRuns === 'number', 'las analíticas agregan la ejecución', `${out.overviewRuns} en total`)

  console.log('\nRESULTADOS')
  for (const line of results) console.log('  ' + line)
  const failed = results.filter((l) => l.startsWith('FALLA')).length
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`)

  server.close()
  app.exit(failed ? 1 : 0)
})
