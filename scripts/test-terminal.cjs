/**
 * Prueba del motor de respaldo de la terminal (por tuberías, con bloques).
 *
 * El motor normal es el PTY —eso lo cubre test-pty.cjs—; esto verifica que si
 * el módulo nativo no cargara, la terminal de repuesto sigue siendo correcta:
 * códigos de salida, cwd que persiste, acentos y corte de un comando colgado.
 * Se pide explícitamente con forcePipe.
 *
 * Arranca la app de verdad y conduce una terminal desde el renderer: comandos
 * encadenados, cambio de directorio que persiste, códigos de salida de éxito y
 * de error, acentos, salida por stderr, un comando largo interrumpido y el
 * cierre de la shell.
 *
 * Uso: pnpm exec electron scripts/test-terminal.cjs
 */
const { app, BrowserWindow } = require('electron')

require('../out/main/index.js')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 2600))

  const out = await win.webContents.executeJavaScript(`(async () => {
    const api = window.api
    const blocks = []
    let current = null
    let ready = false
    let exited = null

    const off = api.term.onEvent((e) => {
      if (e.type === 'ready') { ready = true; return }
      if (e.type === 'exit') { exited = e.exitCode; return }
      if (e.type === 'out' || e.type === 'err') {
        if (current) current[e.type === 'err' ? 'err' : 'out'] += e.data ?? ''
        return
      }
      if (e.type === 'block-end' && current) {
        current.exitCode = e.exitCode
        current.ok = e.ok
        current.cwd = e.cwd
        current.durationMs = e.durationMs
        current.done = true
        current = null
      }
    })

    const created = await api.term.create({ cwd: process.cwd(), title: 'prueba', forcePipe: true })
    const id = created.data.id

    const waitReady = async () => {
      for (let i = 0; i < 60 && !ready; i++) await new Promise(r => setTimeout(r, 100))
      return ready
    }
    const runCmd = async (cmd, timeoutMs = 15000) => {
      const block = { cmd, out: '', err: '', done: false }
      current = block
      blocks.push(block)
      await api.term.run(id, cmd)
      const t0 = Date.now()
      while (!block.done && Date.now() - t0 < timeoutMs) await new Promise(r => setTimeout(r, 60))
      current = null
      return block
    }

    const readyOk = await waitReady()

    const b1 = await runCmd('echo hola mundo')
    const b2 = await runCmd('cd src; Get-Location | ForEach-Object { $_.Path }')
    const b3 = await runCmd('Get-ChildItem -Name | Select-Object -First 3')
    const ACCENTS = 'eñe áéíóú çü'
    const b4 = await runCmd('Write-Output "' + ACCENTS + '"')
    const accentsOk = b4.out.trim() === ACCENTS
    const accentPoints = [...b4.out.trim()].map(c => c.codePointAt(0))
    const b4b = await runCmd('cmd /c "exit 9" ; Write-Output "código ñ"')
    const b5 = await runCmd('cmd /c "exit 7"')
    const b6 = await runCmd('esto_no_existe_de_verdad_xyz')
    const b7 = await runCmd('Write-Error "fallo a proposito"')
    const b8 = await runCmd('node -e "process.stdout.write(String(2+2))"')

    // Interrupción de un comando largo.
    const long = { cmd: 'sleep', out: '', err: '', done: false }
    current = long
    blocks.push(long)
    await api.term.run(id, 'node -e "setTimeout(()=>{},60000)"')
    await new Promise(r => setTimeout(r, 1200))
    await api.term.interrupt(id)
    const t0 = Date.now()
    while (!long.done && Date.now() - t0 < 12000) await new Promise(r => setTimeout(r, 60))

    const listed = await api.term.list()
    const shells = await api.term.shells()
    const cwdRes = await api.term.cwd(id)
    const cwdNow = cwdRes.data

    await api.term.close(id)
    await new Promise(r => setTimeout(r, 900))
    const listedAfter = await api.term.list()
    off()

    return {
      readyOk, id,
      b1, b2, b3, b4, b5, b6, b7, b8, long,
      accentsOk, accentPoints, accentExpected: [...ACCENTS].map(c => c.codePointAt(0)),
      b4b,
      cwdNow,
      shellCount: (shells.data?.shells ?? []).length,
      shellCurrent: shells.data?.current ?? '',
      liveBefore: (listed.data ?? []).length,
      liveAfter: (listedAfter.data ?? []).length,
      exited
    }
  })()`)

  const has = (s, t) => String(s ?? '').includes(t)

  log(out.readyOk, 'la shell arranca y avisa de que está lista')
  // `echo a b` en PowerShell son dos objetos y por tanto dos líneas: es su
  // comportamiento real, no un fallo de la terminal.
  log(
    out.b1.done && has(out.b1.out, 'hola') && has(out.b1.out, 'mundo'),
    'un comando devuelve su salida',
    JSON.stringify(out.b1.out.trim())
  )
  log(out.b1.exitCode === 0 && out.b1.ok === true, 'éxito reportado como código 0', `código ${out.b1.exitCode}`)
  log(
    has(out.b2.out, 'ai-command-center') && has(out.b2.out, 'src'),
    'el cambio de directorio se aplica'
  )
  log(
    String(out.b2.cwd ?? '').replace(/\\/g, '/').endsWith('ai-command-center/src'),
    'el cwd del bloque refleja el directorio nuevo',
    out.b2.cwd
  )
  log(
    String(out.cwdNow ?? '').replace(/\\/g, '/').endsWith('ai-command-center/src'),
    'el cwd persiste entre comandos en la misma shell',
    out.cwdNow
  )
  log(out.b3.done && out.b3.out.trim().length > 0, 'lista ficheros del directorio actual')
  log(
    out.accentsOk,
    'los acentos llegan intactos (UTF-8)',
    out.accentsOk
      ? `${out.accentPoints.length} caracteres exactos`
      : `esperados [${out.accentExpected}] pero llegaron [${out.accentPoints}]`
  )
  log(out.b5.exitCode === 7, 'propaga el código de salida de un programa nativo', `código ${out.b5.exitCode}`)
  log(
    out.b4b.exitCode === 9 && has(out.b4b.out, 'código ñ'),
    'un comando con acentos conserva su código de salida',
    `código ${out.b4b.exitCode}`
  )
  log(out.b6.ok === false, 'marca como fallido un comando que no existe', `ok=${out.b6.ok}`)
  log(out.b7.ok === false && out.b7.err.length > 0, 'captura stderr y lo marca como error')
  log(has(out.b8.out, '4'), 'ejecuta node y recoge su stdout', JSON.stringify(out.b8.out.trim()))
  log(out.long.done, 'interrumpir cierra el bloque del comando colgado', `código ${out.long.exitCode}`)
  log(out.shellCount > 0, 'detecta shells instaladas', `${out.shellCount}: ${out.shellCurrent.split(/[\\/]/).pop()}`)
  log(out.liveBefore === 1 && out.liveAfter === 0, 'cerrar la terminal mata la shell', `${out.liveBefore} → ${out.liveAfter}`)
  log(out.exited !== null, 'el cierre se notifica al renderer', `código ${out.exited}`)

  console.log('\nRESULTADOS')
  for (const line of results) console.log('  ' + line)
  const failed = results.filter((l) => l.startsWith('FALLA')).length
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`)

  app.exit(failed ? 1 : 0)
})
