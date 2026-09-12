/**
 * Prueba de humo: arranca la app real (out/main/index.js), espera a que la
 * interfaz cargue, guarda una captura y vuelca los errores de consola.
 * No forma parte de la app; se lanza con: pnpm exec electron scripts/smoke.cjs
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const WAIT_MS = Number(process.env.SMOKE_WAIT ?? 9000)
const OUT = process.env.SMOKE_OUT ?? join(__dirname, '..', 'smoke.png')

const messages = []

require('../out/main/index.js')

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.log('SMOKE: no se creó ninguna ventana')
    app.exit(1)
    return
  }

  win.webContents.on('console-message', (event) => {
    const level = event.level ?? 'log'
    const message = event.message ?? ''
    messages.push(`[${level}] ${message}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    messages.push(`[FATAL] render-process-gone: ${JSON.stringify(details)}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    messages.push(`[FATAL] did-fail-load ${code}: ${desc}`)
  })

  await new Promise((r) => setTimeout(r, WAIT_MS))

  // ¿Ha montado React algo de verdad?
  const probe = await win.webContents
    .executeJavaScript(
      `(() => {
        const root = document.getElementById('root')
        const nav = [...document.querySelectorAll('nav button')].map(b => b.textContent.trim())
        const h1 = document.querySelector('h1')?.textContent ?? null
        const stats = [...document.querySelectorAll('.num')].slice(0, 8).map(e => e.textContent.trim())
        return {
          nodes: root ? root.querySelectorAll('*').length : 0,
          nav,
          h1,
          stats,
          apiPresent: typeof window.api === 'object'
        }
      })()`
    )
    .catch((e) => ({ error: String(e) }))

  const image = await win.webContents.capturePage()
  writeFileSync(OUT, image.toPNG())

  console.log('SMOKE_RESULT ' + JSON.stringify(probe))
  console.log('SMOKE_CONSOLE_START')
  for (const m of messages) console.log(m)
  console.log('SMOKE_CONSOLE_END')
  console.log('SMOKE: captura en ' + OUT)

  app.exit(0)
})
