/**
 * Guardia previa al empaquetado.
 *
 * La consola real depende de binarios nativos que el script de instalación del
 * paquete descarga en build/Release. Si esa carpeta se queda vacía —por
 * ejemplo porque un node-gyp fallido la limpió— la aplicación se empaqueta
 * igual, arranca igual, y la terminal se queda colgada al abrir la primera
 * pestaña. Eso pasó una vez; no vuelve a pasar en silencio.
 */
const { existsSync } = require('node:fs')
const { dirname, join } = require('node:path')

const PKG = '@homebridge/node-pty-prebuilt-multiarch'
const NEEDED =
  process.platform === 'win32'
    ? ['pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty.dll', 'winpty-agent.exe']
    : ['pty.node']

let root
try {
  root = dirname(require.resolve(PKG + '/package.json'))
} catch {
  fail('el paquete ' + PKG + ' no está instalado.')
}

const release = join(root, 'build', 'Release')
const missing = NEEDED.filter((f) => !existsSync(join(release, f)))

if (missing.length) {
  fail(
    'faltan los binarios de la consola real en\n  ' +
      release +
      '\n\nSin ellos la terminal se cuelga al abrir una pestaña.\nFaltan: ' +
      missing.join(', ')
  )
}

console.log('[check-native] consola real lista: ' + NEEDED.length + ' binarios en build/Release')

function fail(msg) {
  console.error('\n[check-native] ' + msg + '\n\nArréglalo con:\n  pnpm install\n')
  process.exit(1)
}
