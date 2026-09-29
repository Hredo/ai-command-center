/**
 * Espera a que la ventana de la app exista y su motor esté cargado.
 *
 * Las pruebas esperaban un tiempo fijo (2,5–3 s) y en Linux o macOS no
 * bastaba: antes de abrir la ventana la app lee el PATH de la shell de inicio
 * de sesión, que puede tardar hasta 4 s. Aquí se pregunta hasta que está.
 */
const { BrowserWindow } = require('electron')

async function waitWindow(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      try {
        const ready = await win.webContents.executeJavaScript('Boolean(window.api && window.__accEngine)')
        if (ready) {
          // Un respiro para que los efectos del primer pintado terminen.
          await new Promise((r) => setTimeout(r, 400))
          return win
        }
      } catch {
        /* todavía navegando */
      }
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('la ventana de la app no apareció a tiempo')
}

module.exports = { waitWindow }
