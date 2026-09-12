/**
 * Deja Ollama con los dos mejores modelos gratuitos para este equipo.
 *
 * Usa la lógica de recomendación de la propia app —VRAM real de la GPU y peso
 * real de cada modelo según el registro de Ollama— así que a la vez sirve de
 * prueba de esa parte. Pasos: arrancar el servidor si hace falta, enseñar el
 * hardware y el ranking, borrar los modelos que hubiera e instalar los dos
 * primeros que cubran papeles distintos.
 *
 * Uso:
 *   pnpm exec electron scripts/ollama-setup.cjs --dry-run   (sólo informa)
 *   pnpm exec electron scripts/ollama-setup.cjs             (aplica)
 */
const { app, BrowserWindow } = require('electron')

require('../out/main/index.js')

const DRY = process.argv.includes('--dry-run')
const gb = (n) => (n / 1e9).toFixed(2) + ' GB'

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 2600))

  const step = (msg) => console.log('\n' + msg)

  // ---------------------------------------------------------------- Estado
  let status = await win.webContents.executeJavaScript('window.api.ollama.status()')
  if (!status.data.up) {
    step('Ollama no responde. Arrancándolo…')
    const started = await win.webContents.executeJavaScript('window.api.ollama.start()')
    console.log('  ' + (started.data?.detail ?? started.error))
    status = await win.webContents.executeJavaScript('window.api.ollama.status()')
    if (!status.data.up) {
      console.error('No se pudo arrancar Ollama. Se aborta sin tocar nada.')
      app.exit(1)
      return
    }
  }

  // ---------------------------------------------------------------- Hardware
  const rec = await win.webContents.executeJavaScript('window.api.ollama.recommend()')
  const { hw, items, installed } = rec.data
  const gpu = hw.gpus.find((g) => g.primary) ?? hw.gpus[0]

  step('EQUIPO')
  console.log(`  CPU        ${hw.cpu} (${hw.cores} hilos)`)
  console.log(`  RAM        ${hw.ramGb} GB`)
  console.log(`  GPU        ${gpu?.name ?? '—'}`)
  console.log(`  VRAM       ${gpu?.vramMb ? (gpu.vramMb / 1024).toFixed(1) + ' GB' : 'sin determinar'}`)
  console.log(`  Presupuesto para pesos en GPU: ${gpu?.vramMb ? (gpu.vramMb / 1024 - 1.3).toFixed(1) + ' GB' : '—'}`)

  step('RANKING CALCULADO POR LA APP')
  for (const r of items) {
    const fit = r.fits === 'gpu' ? 'GPU     ' : r.fits === 'partial' ? 'reparte ' : 'no cabe '
    console.log(`  ${String(r.score).padStart(3)}  ${fit}  ${r.name.padEnd(24)} ${String(r.sizeGb).padStart(6)} GB  ${r.tags.join(', ')}`)
  }

  const best = await win.webContents.executeJavaScript('window.api.ollama.best(2)')
  const picks = best.data.items

  step('ELEGIDOS (2 mejores, cubriendo papeles distintos)')
  for (const p of picks) {
    console.log(`  ${p.name}  ${p.sizeGb} GB  ${p.params}`)
    console.log(`    ${p.why}`)
  }

  step('YA INSTALADOS')
  const current = status.data.models
  if (!current.length) console.log('  (ninguno)')
  for (const m of current) console.log(`  ${m.name.padEnd(24)} ${gb(m.sizeBytes)}  ${m.parameterSize ?? ''} ${m.quantization ?? ''}`)

  if (DRY) {
    step('MODO INFORMATIVO: no se ha tocado nada.')
    app.exit(0)
    return
  }

  // ---------------------------------------------------------------- Borrado
  step('BORRANDO LOS MODELOS ACTUALES')
  let freed = 0
  for (const m of current) {
    const r = await win.webContents.executeJavaScript(
      `window.api.ollama.remove(${JSON.stringify(m.name)})`
    )
    if (r.ok) {
      freed += m.sizeBytes
      console.log(`  borrado  ${m.name}  (${gb(m.sizeBytes)} liberados)`)
    } else {
      console.log(`  FALLO    ${m.name}: ${r.error}`)
    }
  }
  console.log(`  total liberado: ${gb(freed)}`)

  // ---------------------------------------------------------------- Descarga
  step('DESCARGANDO LOS ELEGIDOS')
  for (const p of picks) {
    process.stdout.write(`  ${p.name} … `)
    const t0 = Date.now()
    const r = await win.webContents.executeJavaScript(
      `window.api.ollama.pull(${JSON.stringify(p.name)})`,
      false
    )
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    if (r.ok && r.data?.ok) console.log(`listo en ${secs}s`)
    else console.log(`FALLO tras ${secs}s: ${r.error ?? 'desconocido'}`)
  }

  // ---------------------------------------------------------------- Resultado
  const after = await win.webContents.executeJavaScript('window.api.ollama.status()')
  step('RESULTADO')
  let total = 0
  for (const m of after.data.models) {
    total += m.sizeBytes
    console.log(`  ${m.name.padEnd(24)} ${gb(m.sizeBytes)}  ${m.parameterSize ?? ''} ${m.quantization ?? ''}  ${(m.capabilities ?? []).join(',')}`)
  }
  console.log(`  ${after.data.models.length} modelos, ${gb(total)} en disco`)

  const missing = picks.filter((p) => !after.data.models.some((m) => m.name === p.name))
  if (missing.length) {
    console.error(`\nFaltan por instalar: ${missing.map((m) => m.name).join(', ')}`)
    app.exit(1)
    return
  }
  console.log('\nTodo en su sitio.')
  app.exit(0)
})
