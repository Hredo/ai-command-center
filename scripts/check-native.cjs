/**
 * Guardia previa al empaquetado (y, fuera de Windows, también preparación).
 *
 * La consola real depende de binarios nativos que tienen que estar en
 * build/Release del paquete. Si esa carpeta se queda vacía —por ejemplo porque
 * un node-gyp fallido la limpió— la aplicación se empaqueta igual, arranca
 * igual, y la terminal se queda colgada al abrir la primera pestaña. Eso pasó
 * una vez; no vuelve a pasar en silencio.
 *
 * Cada sistema llega a build/Release por un camino distinto:
 *
 *  - Windows: el script de instalación del paquete descarga los binarios.
 *  - Linux: el paquete los trae precompilados, pero en prebuilds/linux-<arch>/
 *    y con un nombre por versión de Node, que no es donde los busca la app
 *    dentro de Electron. Son módulos N-API —el mismo binario vale para
 *    cualquier versión de Node y de Electron—, así que basta con copiarlo.
 *  - macOS: no trae ninguno y lo compila al instalar (hacen falta las
 *    herramientas de línea de órdenes de Xcode). Además deja spawn-helper,
 *    que tiene que poder ejecutarse: sin permiso de ejecución cada pestaña
 *    muere con «posix_spawnp failed».
 */
const { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { dirname, join } = require('node:path')

const PKG = '@homebridge/node-pty-prebuilt-multiarch'
const NEEDED = {
  win32: ['pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty.dll', 'winpty-agent.exe'],
  darwin: ['pty.node', 'spawn-helper'],
  linux: ['pty.node']
}[process.platform] ?? ['pty.node']

let root
try {
  root = dirname(require.resolve(PKG + '/package.json'))
} catch {
  fail('el paquete ' + PKG + ' no está instalado.')
}

const release = join(root, 'build', 'Release')

if (process.platform === 'linux') prepareLinux()
if (process.platform === 'darwin') prepareMac()

const missing = NEEDED.filter((f) => !existsSync(join(release, f)))
if (missing.length) {
  fail(
    'faltan los binarios de la consola real en\n  ' +
      release +
      '\n\nSin ellos la terminal se cuelga al abrir una pestaña.\nFaltan: ' +
      missing.join(', ')
  )
}

// En macOS y Linux se comprueba además que el binario carga: al ser N-API,
// si carga en este Node carga también en Electron. En Windows no se hace
// porque Smart App Control puede bloquear la carga en el equipo de desarrollo
// sin que el binario tenga nada de malo.
if (process.platform !== 'win32') {
  try {
    require(join(release, 'pty.node'))
  } catch (err) {
    fail('pty.node está, pero no carga: ' + (err && err.message ? err.message : err))
  }
}

console.log('[check-native] consola real lista: ' + NEEDED.length + ' binarios en build/Release')

/** Copia el precompilado de esta arquitectura a build/Release si falta. */
function prepareLinux() {
  const target = join(release, 'pty.node')
  if (existsSync(target)) return
  const musl = existsSync('/etc/alpine-release')
  const dir = join(root, 'prebuilds', `linux-${process.arch}`)
  let files = []
  try {
    files = readdirSync(dir).filter((f) => /^node\.abi\d+(\.musl)?\.node$/.test(f) && f.includes('.musl') === musl)
  } catch {
    // Sin precompilado para esta arquitectura: se intenta compilar.
  }
  if (files.length) {
    // El de la ABI más alta: todos son el mismo módulo N-API.
    files.sort((a, b) => Number(b.match(/abi(\d+)/)[1]) - Number(a.match(/abi(\d+)/)[1]))
    mkdirSync(release, { recursive: true })
    copyFileSync(join(dir, files[0]), target)
    console.log('[check-native] copiado prebuilds/linux-' + process.arch + '/' + files[0] + ' a build/Release/pty.node')
    return
  }
  compile()
}

/** Compila si falta y deja spawn-helper ejecutable. */
function prepareMac() {
  if (!existsSync(join(release, 'pty.node')) || !existsSync(join(release, 'spawn-helper'))) compile()
  const helper = join(release, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}

function compile() {
  console.log('[check-native] compilando la consola nativa con node-gyp…')
  const r = spawnSync('pnpm', ['dlx', 'node-gyp@11', 'rebuild'], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) {
    fail(
      'no se pudo compilar la consola nativa.' +
        (process.platform === 'darwin'
          ? '\nHacen falta las herramientas de Xcode: xcode-select --install'
          : '\nHacen falta un compilador de C++ y Python 3 (en Debian/Ubuntu: sudo apt install build-essential python3)')
    )
  }
}

function fail(msg) {
  console.error('\n[check-native] ' + msg + '\n\nArréglalo con:\n  pnpm install\n')
  process.exit(1)
}
