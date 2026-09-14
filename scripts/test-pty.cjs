/**
 * Prueba de la terminal con consola real (ConPTY).
 *
 * Lo que se comprueba es el fallo reportado: escribir `opencode` en la
 * terminal y que no pasara nada. Con un PTY de verdad la aplicación detecta
 * terminal, arranca y pinta su interfaz; aquí se verifica que llega salida y
 * que responde a un Ctrl+C real.
 *
 * Uso: pnpm exec electron scripts/test-pty.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Datos aparte: la prueba no toca tu configuración y puede correr con la app
// instalada abierta, que si no se quedaría con el candado de instancia única.
// Con ACC_TERMINAL_ENGINE=bridge se prueba el puente de PowerShell.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'acc-pty-')))
require('../out/main/index.js')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 2800))
  const js = (code) => win.webContents.executeJavaScript(code)

  const pty = await js('window.api.term.pty()')
  log(
    pty.data?.available === true,
    'la consola nativa (PTY) carga en la app empaquetada',
    pty.data?.available ? 'ConPTY disponible' : (pty.data?.reason ?? 'sin motivo')
  )

  if (!pty.data?.available) {
    console.log('\nSin PTY no se puede seguir con esta prueba.')
    for (const l of results) console.log('  ' + l)
    app.exit(1)
    return
  }

  const out = await js(`(async () => {
    const engine = window.__accEngine
    const sleep = (n) => new Promise(r => setTimeout(r, n))

    let buf = ''
    const { id } = await engine.openTerm({
      cwd: process.cwd(),
      title: 'prueba pty',
      cols: 120,
      rows: 34
    })
    const off = engine.onTermData(id, (f) => { if (f.type === 'data') buf += f.data })

    // La shell necesita un momento y la integración se manda a los 350 ms.
    await sleep(1600)
    const afterBoot = buf.length
    const backend = engine.peekTerm(id)?.info?.backend

    // 1. Un comando normal, para ver que la consola responde.
    buf = ''
    engine.sendTermCommand(id, 'Write-Output "hola desde el pty"')
    await sleep(1400)
    const simple = buf

    // 2. El cwd tiene que llegar por la integración de shell.
    buf = ''
    engine.sendTermCommand(id, 'cd src')
    await sleep(1400)
    const cwdAfterCd = engine.peekTerm(id)?.info?.cwd ?? ''
    const lastExit = engine.peekTerm(id)?.lastExit ?? null

    // 3. Un código de salida distinto de cero.
    buf = ''
    engine.sendTermCommand(id, 'cmd /c "exit 5"')
    await sleep(1500)
    const failExit = engine.peekTerm(id)?.lastExit ?? null

    // 4. Recuperación tras cortar un programa que se queda leyendo la
    //    entrada. Se usa node y no un agente porque aquí lo que se prueba es
    //    la terminal, y el comportamiento de node ante un Ctrl+C es conocido.
    buf = ''
    engine.sendTermCommand(id, 'node -e "process.stdin.resume(); setInterval(()=>{},1000)"')
    await sleep(1800)
    const busyWhileBlocked = engine.peekTerm(id)?.busy ?? false
    engine.interruptTerm(id)
    await sleep(1800)
    const freedAfterCtrlC = engine.peekTerm(id)?.busy === false

    buf = ''
    engine.sendTermCommand(id, 'Write-Output "sigo-vivo"')
    await sleep(1600)
    const alive = buf

    // 5. Y por último lo que fallaba: opencode. Va al final porque es una
    //    aplicación de pantalla completa que se queda en primer plano.
    buf = ''
    engine.sendTermCommand(id, 'opencode')
    await sleep(9000)
    const opencodeOut = buf
    const busyDuringOpencode = engine.peekTerm(id)?.busy ?? false

    // Un Ctrl+C real: opencode lo atrapa y responde, que es lo correcto.
    const beforeInterrupt = buf.length
    engine.interruptTerm(id)
    await sleep(1800)
    const afterInterrupt = buf.length

    // Una terminal nueva tiene que abrirse igual de bien con la anterior
    // ocupada por una aplicación interactiva.
    const { id: id2 } = await engine.openTerm({ title: 'segunda' })
    let buf2 = ''
    const off2 = engine.onTermData(id2, (f) => { if (f.type === 'data') buf2 += f.data })
    await sleep(1600)
    engine.sendTermCommand(id2, 'Write-Output "segunda-ok"')
    await sleep(1600)
    const second = buf2
    off2()
    await engine.closeTerm(id2)

    const scrollLen = engine.termScrollback(id).length
    off()
    await engine.closeTerm(id)

    return {
      backend, afterBoot, simple, cwdAfterCd, lastExit, failExit, beforeInterrupt,
      opencodeOut, busyDuringOpencode, afterInterrupt, alive, scrollLen,
      busyWhileBlocked, freedAfterCtrlC, second
    }
  })()`)

  const has = (s, t) => String(s ?? '').includes(t)
  // El texto viene con secuencias de control: se limpian para poder buscar.
  const clean = (s) =>
    String(s ?? '')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[()][A-Za-z0-9]/g, '')

  log(out.backend === 'pty', 'la terminal se abre en modo consola', out.backend)
  log(out.afterBoot > 0, 'la shell escribe su prompt al arrancar', `${out.afterBoot} caracteres`)
  log(has(clean(out.simple), 'hola desde el pty'), 'un comando devuelve su salida')
  log(
    out.cwdAfterCd.replace(/\\/g, '/').endsWith('ai-command-center/src'),
    'el directorio actual llega por la integración de shell',
    out.cwdAfterCd
  )
  log(out.lastExit?.code === 0, 'el código de salida correcto se reporta', `código ${out.lastExit?.code}`)
  log(
    out.lastExit?.durationMs != null && out.lastExit.durationMs >= 0,
    'se mide la duración de cada comando',
    `${out.lastExit?.durationMs} ms`
  )
  log(out.failExit?.code === 5, 'un fallo se reporta con su código', `código ${out.failExit?.code}`)

  const oc = clean(out.opencodeOut)
  log(
    out.opencodeOut.length > 200,
    'OPENCODE ARRANCA Y PINTA SU INTERFAZ',
    `${out.opencodeOut.length} caracteres de salida`
  )
  log(
    /opencode|share|\/help|model|ask|build/i.test(oc),
    'la salida de opencode es reconocible',
    JSON.stringify(oc.replace(/\s+/g, ' ').trim().slice(0, 120))
  )
  log(
    out.afterInterrupt > out.beforeInterrupt,
    'la aplicación interactiva reacciona al Ctrl+C real',
    `respondió con ${out.afterInterrupt - out.beforeInterrupt} caracteres`
  )
  log(out.busyWhileBlocked, 'un programa que se queda leyendo marca la terminal como ocupada')
  log(out.freedAfterCtrlC, 'el Ctrl+C libera la terminal')
  log(
    has(clean(out.alive), 'sigo-vivo'),
    'tras cortar vuelve el prompt y la consola sigue usable',
    JSON.stringify(clean(out.alive).replace(/[\s]+/g, ' ').trim().slice(0, 80))
  )
  log(
    has(clean(out.second), 'segunda-ok'),
    'se puede abrir otra terminal aunque la primera esté ocupada por opencode'
  )
  log(out.busyDuringOpencode, 'opencode queda marcado como en ejecución')
  log(out.scrollLen > 0, 'se guarda el historial para repintar al volver a la pestaña', `${out.scrollLen} caracteres`)

  console.log('\nRESULTADOS')
  for (const line of results) console.log('  ' + line)
  const failed = results.filter((l) => l.startsWith('FALLA')).length
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`)

  if (out.opencodeOut) {
    console.log('\nPRIMEROS 400 CARACTERES DE OPENCODE (sin secuencias de control):')
    console.log('  ' + clean(out.opencodeOut).replace(/\s+/g, ' ').trim().slice(0, 400))
  }

  app.exit(failed ? 1 : 0)
})
