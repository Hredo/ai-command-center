/**
 * Capturas de pantalla de la app en marcha, para revisar el aspecto.
 *
 * Uso: pnpm exec electron scripts/shot.cjs [seccion ...]
 * Ejemplo: pnpm exec electron scripts/shot.cjs Terminal Consola Ajustes
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

require('../out/main/index.js')

const OUT = join(__dirname, '..', 'shots')
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const wanted = args.length ? args : ['Panel', 'Consola', 'Terminal', 'Ajustes']

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]
  mkdirSync(OUT, { recursive: true })
  await new Promise((r) => setTimeout(r, 3200))

  const js = (code) => win.webContents.executeJavaScript(code)

  for (const name of wanted) {
    const clicked = await js(`(() => {
      const b = [...document.querySelectorAll('nav button')].find(
        (x) => x.textContent.trim() === ${JSON.stringify(name)}
      )
      if (!b) return false
      b.click()
      return true
    })()`)
    if (!clicked) {
      console.log(`  no encontré la sección "${name}"`)
      continue
    }

    // La terminal necesita un momento para arrancar la shell y pintar.
    await new Promise((r) => setTimeout(r, name === 'Terminal' ? 3200 : 900))

    if (name === 'Terminal') {
      // Se ejecutan un comando con color y otro que falla, para ver los dos
      // estados en la captura.
      await js(`(async () => {
        const e = window.__accEngine
        const sleep = (n) => new Promise((r) => setTimeout(r, n))
        const all = Object.values(e.peekTerms())
        const id = all.sort((a, b) => a.info.createdAt - b.info.createdAt).pop()?.info?.id
        if (!id) return false
        e.sendTermCommand(id, 'Get-ChildItem src | Select-Object -First 6 Name, Length')
        await sleep(1800)
        e.sendTermCommand(id, 'ollama list')
        await sleep(1800)
        e.sendTermCommand(id, 'comando_que_no_existe')
        await sleep(1500)
        return true
      })()`)
      await new Promise((r) => setTimeout(r, 600))
    }

    const img = await win.webContents.capturePage()
    const file = join(OUT, `${name.toLowerCase()}.png`)
    writeFileSync(file, img.toPNG())
    console.log(`  ${name} → ${file}`)
  }

  app.exit(0)
})
