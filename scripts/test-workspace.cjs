/**
 * Prueba del espacio de trabajo: ficheros del proyecto, git y GitHub.
 *
 * Se monta un repositorio de mentira en una carpeta temporal y se trabaja
 * sobre él: leer el árbol, abrir y guardar ficheros, preparar, confirmar,
 * mirar el diff y el histórico, y comprobar que las rutas no pueden salirse
 * del proyecto ni ejecutarse comandos que no toca.
 *
 * De GitHub sólo se comprueba la detección: iniciar sesión es cosa tuya y del
 * navegador, y esta prueba no toca ninguna cuenta.
 *
 * Uso: pnpm exec electron scripts/test-workspace.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-ws-'))
const REPO = path.join(TMP, 'repo')

const results = []
const log = (ok, name, detail = '') =>
  results.push(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? ' — ' + detail : ''}`)

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function setup() {
  fs.mkdirSync(path.join(REPO, 'src', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(REPO, 'README.md'), '# demo\n\nun repo de prueba\n', 'utf8')
  fs.writeFileSync(path.join(REPO, 'src', 'index.ts'), 'export const uno = 1\n', 'utf8')
  fs.writeFileSync(path.join(REPO, 'src', 'lib', 'util.ts'), 'export const dos = 2\n', 'utf8')
  fs.writeFileSync(path.join(REPO, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
  // Una carpeta pesada, para comprobar que se marca y no se recorre sola.
  fs.mkdirSync(path.join(REPO, 'node_modules', 'algo'), { recursive: true })
  fs.writeFileSync(path.join(REPO, 'node_modules', 'algo', 'index.js'), 'module.exports = 1\n', 'utf8')

  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'prueba@local'])
  git(['config', 'user.name', 'Prueba'])
  git(['add', 'README.md', 'src'])
  git(['commit', '-qm', 'primer commit'])
}

setup()

require('../out/main/index.js')

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]
  await new Promise((r) => setTimeout(r, 3000))
  const js = (code) => win.webContents.executeJavaScript(code)
  const ctx = JSON.stringify({ repo: REPO, tmp: TMP })

  /* -------------------------------------------------------------- *
   * 1. Ficheros: ver, abrir, editar                                *
   * -------------------------------------------------------------- */
  const files = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const raiz = (await api.files.list(repo)).data
    const dentro = (await api.files.list(repo, 'src')).data
    const md = (await api.files.read(repo, 'README.md')).data
    const png = (await api.files.read(repo, 'logo.png')).data

    // Guardar y volver a leer.
    const guardado = await api.files.write(repo, 'src/index.ts', 'export const uno = 11\\nexport const tres = 3\\n')
    const releido = (await api.files.read(repo, 'src/index.ts')).data

    // Fuera del proyecto: tiene que negarse.
    const fuera = await api.files.read(repo, '../../otro.txt')
    const fueraAbs = await api.files.read(repo, 'C:\\\\Windows\\\\win.ini')

    // Crear y borrar.
    const creado = await api.files.create(repo, 'src/nuevo.txt', false)
    const trasCrear = (await api.files.list(repo, 'src')).data
    const papelera = await api.files.trash(repo, 'src/nuevo.txt')

    return {
      raiz, dentro, md, png,
      guardadoOk: guardado.ok, releido,
      fuera: { ok: fuera.ok, error: fuera.error },
      fueraAbs: { ok: fueraAbs.ok, error: fueraAbs.error },
      creado: creado.ok, trasCrear: (trasCrear ?? []).map(e => e.name), papelera: papelera.ok
    }
  })()`)

  const nm = (files.raiz ?? []).find((e) => e.name === 'node_modules')
  log(
    (files.raiz ?? []).some((e) => e.name === 'src' && e.dir) && (files.raiz ?? []).some((e) => e.name === 'README.md'),
    'SE VE EL CONTENIDO DEL PROYECTO',
    (files.raiz ?? []).map((e) => e.name).join(', ')
  )
  log((files.raiz ?? [])[0]?.dir === true, 'las carpetas van primero en el árbol', (files.raiz ?? [])[0]?.name)
  log(Boolean(nm?.heavy), 'node_modules se marca como carpeta pesada')
  log(
    (files.dentro ?? []).some((e) => e.name === 'lib' && e.dir) && (files.dentro ?? []).some((e) => e.name === 'index.ts'),
    'las carpetas se abren por niveles',
    (files.dentro ?? []).map((e) => e.name).join(', ')
  )
  log(
    files.md?.text?.includes('un repo de prueba') && files.md?.lines >= 3,
    'SE ABRE EL CONTENIDO DE UN FICHERO',
    `${files.md?.lines} líneas, ${files.md?.bytes} bytes`
  )
  log(files.png?.binary === true && files.png?.text == null, 'un binario no se intenta mostrar como texto')
  log(
    files.guardadoOk === true && files.releido?.text?.includes('tres = 3'),
    'SE PUEDE EDITAR Y GUARDAR',
    files.releido?.text?.replace(/\n/g, ' ')
  )
  log(files.fuera.ok === false, 'una ruta con .. no sale del proyecto', files.fuera.error ?? '')
  log(files.fueraAbs.ok === false, 'ni una ruta absoluta de fuera', files.fueraAbs.error ?? '')
  log(files.creado === true && (files.trasCrear ?? []).includes('nuevo.txt'), 'se crean ficheros nuevos')
  log(files.papelera === true, 'y se borran a la papelera del sistema')

  /* -------------------------------------------------------------- *
   * 2. Git: estado, preparar, confirmar, diff, histórico           *
   * -------------------------------------------------------------- */
  const g = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const cambios = (await api.git.changes(repo)).data
    const diff = (await api.git.diff(repo, 'src/index.ts')).data
    const preparado = (await api.git.stage(repo, ['src/index.ts'], true)).data
    const trasPreparar = (await api.git.info(repo)).data
    const confirmado = (await api.git.commit(repo, 'cambio de prueba', true)).data
    const log = (await api.git.log(repo, 5)).data
    const infoFinal = (await api.git.info(repo)).data

    const permitido = (await api.git.run(repo, 'status --porcelain')).data
    const prohibido = (await api.git.run(repo, 'daemon --export-all')).data
    const interactivo = (await api.git.run(repo, 'rebase -i HEAD~1')).data
    const duroSi = (await api.git.isDestructive('reset --hard HEAD~1')).data
    const duroNo = (await api.git.isDestructive('status')).data

    return { cambios, diff, preparado, trasPreparar, confirmado, log, infoFinal, permitido, prohibido, interactivo, duroSi, duroNo }
  })()`)

  log(
    (g.cambios ?? []).some((c) => c.path === 'src/index.ts' && c.added === 2 && c.removed === 1),
    'los cambios del proyecto se ven con sus líneas',
    (g.cambios ?? []).map((c) => `${c.path} +${c.added} -${c.removed}`).join(', ')
  )
  log(
    (g.diff ?? '').includes('+export const tres = 3') && (g.diff ?? '').includes('@@'),
    'el diff de un fichero llega entero'
  )
  log(g.preparado?.ok === true && (g.trasPreparar?.staged ?? 0) > 0, 'se puede preparar un fichero', `${g.trasPreparar?.staged} en el índice`)
  log(g.confirmado?.ok === true, 'SE PUEDE CONFIRMAR DESDE LA APP', (g.confirmado?.out ?? '').split('\n')[0])
  log(
    (g.log ?? [])[0]?.subject === 'cambio de prueba' && (g.log ?? []).length === 2,
    'el histórico sale con sus commits',
    (g.log ?? []).map((c) => c.subject).join(' | ')
  )
  log((g.infoFinal?.dirty ?? 0) === 0, 'tras confirmar, el árbol queda limpio')
  log(g.permitido?.ok === true, 'UN COMANDO DE GIT SE EJECUTA', 'git status --porcelain')
  log(
    g.prohibido?.ok === false && Boolean(g.prohibido?.refused),
    'un subcomando fuera de la lista se rechaza con motivo',
    g.prohibido?.refused ?? ''
  )
  log(
    g.interactivo?.ok === false && Boolean(g.interactivo?.refused),
    'los interactivos se mandan a la terminal en vez de colgarse',
    g.interactivo?.refused ?? ''
  )
  log(g.duroSi === true && g.duroNo === false, 'los comandos que tiran trabajo se marcan para confirmar')

  /* -------------------------------------------------------------- *
   * 3. Cerrar y reabrir un proyecto                                *
   * -------------------------------------------------------------- */
  const proj = await js(`(async () => {
    const { repo } = ${ctx}
    const api = window.api
    const p = { id: 'prueba-ws', name: 'Repo de prueba', path: repo, color: '#22d3ee', createdAt: Date.now() }
    await api.projects.save(p)
    const abierto = ((await api.config.get()).data.projects ?? []).find(x => x.id === p.id)
    await api.projects.save({ ...p, closed: true })
    const cerrado = ((await api.config.get()).data.projects ?? []).find(x => x.id === p.id)
    await api.projects.save({ ...p, closed: false })
    const reabierto = ((await api.config.get()).data.projects ?? []).find(x => x.id === p.id)
    await api.projects.remove(p.id)
    const borrado = ((await api.config.get()).data.projects ?? []).find(x => x.id === p.id)
    return { abierto: Boolean(abierto), cerrado: cerrado?.closed, reabierto: reabierto?.closed, borrado: Boolean(borrado) }
  })()`)

  log(proj.abierto === true && proj.cerrado === true, 'UN PROYECTO SE PUEDE CERRAR', 'closed = ' + proj.cerrado)
  log(proj.reabierto === false, 'y se puede reabrir')
  log(proj.borrado === false, 'quitarlo de la lista sigue funcionando')

  /* -------------------------------------------------------------- *
   * 4. GitHub: sólo detección                                      *
   * -------------------------------------------------------------- */
  const gh = await js(`(async () => {
    const api = window.api
    const st = (await api.github.status()).data
    const cmd = (await api.github.loginCommand()).data
    return { st, cmd }
  })()`)

  log(gh.st?.installed === true, 'SE DETECTA GITHUB CLI', gh.st?.version ? 'gh ' + gh.st.version : (gh.st?.hint ?? ''))
  log(
    typeof gh.st?.authed === 'boolean',
    'se sabe si hay sesión de GitHub',
    gh.st?.authed ? 'con sesión como ' + gh.st.login : 'sin sesión todavía'
  )
  log(
    (gh.cmd ?? '').startsWith('gh auth login') && (gh.cmd ?? '').includes('--web'),
    'el inicio de sesión va por el navegador, no por la app',
    gh.cmd ?? ''
  )

  /* -------------------------------------------------------------- */
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* git deja candados en Windows; da igual para la prueba */
  }

  console.log('\nRESULTADOS')
  for (const r of results) console.log('  ' + r)
  const ok = results.filter((r) => r.startsWith('PASA')).length
  console.log(`${ok}/${results.length} comprobaciones correctas`)
  app.exit(ok === results.length ? 0 : 1)
})
