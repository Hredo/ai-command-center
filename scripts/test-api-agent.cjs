/**
 * Prueba del modo agente de los modelos por API, contra Ollama de verdad.
 *
 * Crea un repositorio con fallos, le pide a un modelo local que los arregle y
 * comprueba en disco que lo ha hecho: que ha leído, que ha editado y que git
 * ve el cambio. Después prueba los permisos —un comando que se aprueba, otro
 * que se rechaza y el modo sólo plan, que no puede tocar nada— y repite el
 * arreglo por el dialecto de OpenAI usando el endpoint compatible de Ollama.
 *
 * Los modelos no son deterministas: una FALLA puede ser el modelo y no la app.
 * Por eso cada escenario enseña los pasos que dio.
 *
 * Necesita Ollama encendido con el modelo (por omisión qwen3:8b).
 * Uso: pnpm exec electron scripts/test-api-agent.cjs [modelo]
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// Datos aparte: no toca tu configuración y puede correr con la app abierta.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-api-agent-'))
app.setPath('userData', path.join(TMP, 'userdata'))
require('../out/main/index.js')

const MODEL = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'qwen3:8b'
const REPO = path.join(TMP, 'repo')
const CALC = path.join(REPO, 'calc.js')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim()
}

function setupRepo() {
  fs.mkdirSync(REPO, { recursive: true })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'prueba@local'])
  git(['config', 'user.name', 'Prueba'])
  fs.writeFileSync(
    CALC,
    [
      'function suma(a, b) {',
      '  return a - b',
      '}',
      '',
      'function resta(a, b) {',
      '  return a - b',
      '}',
      '',
      'function multiplica(a, b) {',
      '  return a + b',
      '}',
      '',
      'module.exports = { suma, resta, multiplica }',
      ''
    ].join('\n'),
    'utf8'
  )
  fs.writeFileSync(path.join(REPO, 'README.md'), '# calc\n\nUtilidades de aritmética.\n', 'utf8')
  git(['add', '.'])
  git(['commit', '-qm', 'primer commit'])
}

function describeSteps(run) {
  return (run?.steps ?? [])
    .filter((s) => s.kind === 'tool')
    .map((s) => `${s.tool}(${(s.target ?? '').slice(0, 50)})${s.status === 'ok' ? '' : ':' + s.status}${s.approval ? '[' + s.approval + ']' : ''}`)
    .join(' → ')
}

app.whenReady().then(async () => {
  setupRepo()
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 3000))
  const js = (code) => win.webContents.executeJavaScript(code)

  /** Lanza una petición en modo agente y contesta a los permisos con `decide`. */
  const agent = async ({ label, prompt, providerId = 'ollama', permissionMode = 'acceptEdits', decide = 'true' }) => {
    const t0 = Date.now()
    const out = await js(`(async () => {
      const e = window.__accEngine
      const sleep = (n) => new Promise((r) => setTimeout(r, n))
      const decide = (s) => ${decide}
      const id = await e.newSession('chat', { providerId: ${JSON.stringify(providerId)}, model: ${JSON.stringify(MODEL)}, title: ${JSON.stringify(label)} })
      let done = false
      const decisions = []
      const pending = e.sendChat(id, {
        prompt: ${JSON.stringify(prompt)},
        providerId: ${JSON.stringify(providerId)},
        model: ${JSON.stringify(MODEL)},
        projectPath: ${JSON.stringify(REPO)},
        projectName: 'repo',
        agentMode: true,
        permissionMode: ${JSON.stringify(permissionMode)},
        effort: 'minimal',
        temperature: 0.2
      }).then((r) => { done = true; return r })
      const started = Date.now()
      let sawLive = false
      while (!done) {
        const st = e.peekChat(id)
        const turn = st?.turns?.[st.turns.length - 1]
        if (turn?.steps?.length) sawLive = true
        for (const s of turn?.steps ?? []) {
          if (s.approval === 'pending' && s.status === 'running' && !decisions.some((d) => d.id === s.id)) {
            const allow = decide(s)
            decisions.push({ id: s.id, tool: s.tool, target: s.target, allow })
            e.approveStep(turn.runId, s.id, allow)
          }
        }
        if (Date.now() - started > 300000) e.stopSession(id)
        await sleep(200)
      }
      const run = await pending
      return { run, decisions, sawLive }
    })()`)
    out.ms = Date.now() - t0
    console.log(`\n[${label}] ${out.run?.status} en ${(out.ms / 1000).toFixed(1)} s · ${out.run?.notes ?? ''}`)
    console.log(`  pasos: ${describeSteps(out.run) || '(ninguno)'}`)
    if (out.run?.error) console.log(`  error: ${out.run.error}`)
    console.log(`  respuesta: ${(out.run?.response ?? '').replace(/\s+/g, ' ').slice(0, 220)}`)
    return out
  }

  const tools = (run, name) => (run?.steps ?? []).filter((s) => s.kind === 'tool' && s.tool === name)

  // 1. Arreglar un fallo: tiene que leer y editar, y git tiene que verlo.
  {
    const r = await agent({
      label: 'arreglo con Ollama',
      prompt: 'En calc.js la función suma resta en lugar de sumar. Arréglala. No toques las demás funciones.'
    })
    const text = fs.readFileSync(CALC, 'utf8')
    log(r.run?.status === 'ok', 'la ejecución en modo agente termina bien', r.run?.error ?? '')
    log(r.sawLive, 'los pasos llegan a la interfaz mientras trabaja')
    log(
      tools(r.run, 'read_file').length > 0 || tools(r.run, 'search_text').length > 0,
      'mira el código antes de tocarlo',
      describeSteps(r.run)
    )
    log(
      tools(r.run, 'edit_file').some((s) => s.status === 'ok') || tools(r.run, 'write_file').some((s) => s.status === 'ok'),
      'edita el archivo con una herramienta'
    )
    log(/function suma\(a, b\) \{\s*return a \+ b/.test(text), 'suma queda arreglada en disco')
    log(/function resta\(a, b\) \{\s*return a - b/.test(text), 'resta sigue intacta')
    log((r.run?.filesChanged ?? []).some((f) => f.path.endsWith('calc.js')), 'git ve calc.js cambiado', JSON.stringify(r.run?.filesChanged))
    log((r.run?.contextUsed ?? 0) > 0, 'se informa del contexto ocupado', `${r.run?.contextUsed} / ${r.run?.contextLimit}`)
  }

  // 2. Un comando que se aprueba.
  {
    const r = await agent({
      label: 'comando aprobado',
      prompt:
        'Usa la herramienta run_command para ejecutar exactamente este comando y dime qué imprime: node -e "console.log(\'RESULTADO\', require(\'./calc.js\').suma(2, 3))"',
      decide: 'true'
    })
    const runs = tools(r.run, 'run_command')
    log(r.decisions.length > 0, 'el comando pide permiso antes de ejecutarse', JSON.stringify(r.decisions.map((d) => d.target)))
    log(runs.some((s) => s.status === 'ok' && /RESULTADO/.test(s.detail ?? '')), 'tras aprobarlo se ejecuta y devuelve su salida', runs.map((s) => (s.detail ?? '').slice(0, 80)).join(' | '))
  }

  // 3. Un comando que se rechaza.
  {
    const r = await agent({
      label: 'comando rechazado',
      prompt: 'Ejecuta git status con la herramienta run_command y dime el resultado.',
      decide: 'false'
    })
    const runs = tools(r.run, 'run_command')
    log(r.decisions.length > 0 && r.decisions.every((d) => !d.allow), 'el comando espera permiso y se rechaza')
    log(runs.length > 0 && runs.every((s) => s.denied && s.status === 'error'), 'el paso rechazado queda marcado y no se ejecuta')
    log(r.run?.status === 'ok', 'el agente sigue y termina tras el rechazo', r.run?.status)
  }

  // 4. Sólo plan: no puede tocar nada.
  {
    const before = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8')
    const r = await agent({
      label: 'sólo plan',
      prompt: 'Cambia el título del README.md para que diga "# Calculadora".',
      permissionMode: 'plan'
    })
    const after = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8')
    log(before === after, 'en modo sólo plan el README no cambia')
    log(!(r.run?.steps ?? []).some((s) => /^(edit_file|write_file|run_command)$/.test(s.tool ?? '') && s.status === 'ok'), 'no hay ninguna edición con éxito')
  }

  // 5. El mismo trabajo por el dialecto de OpenAI (endpoint compatible de Ollama).
  {
    await js(`window.api.providers.setBaseUrl('llamacpp', 'http://127.0.0.1:11434/v1')`)
    const r = await agent({
      label: 'arreglo por el dialecto OpenAI',
      providerId: 'llamacpp',
      prompt: 'En calc.js la función multiplica suma en lugar de multiplicar. Arréglala. No toques las demás funciones.'
    })
    const text = fs.readFileSync(CALC, 'utf8')
    log(r.run?.status === 'ok', 'dialecto OpenAI: la ejecución termina bien', r.run?.error ?? '')
    log(/function multiplica\(a, b\) \{\s*return a \* b/.test(text), 'dialecto OpenAI: multiplica queda arreglada en disco', describeSteps(r.run))
  }

  console.log('\nRESULTADOS')
  for (const line of results) console.log('  ' + line)
  const failed = results.filter((l) => l.startsWith('FALLA')).length
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`)
  console.log(`\ncalc.js al final:\n${fs.readFileSync(CALC, 'utf8')}`)
  app.exit(failed ? 1 : 0)
})
