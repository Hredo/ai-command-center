/**
 * Autoprueba de la aplicación, tal cual se instala.
 *
 * Se activa con ACC_SELFTEST=<carpeta> y sirve para una cosa: comprobar en un
 * macOS, un Linux o un Windows de verdad —los de GitHub Actions— que la app
 * empaquetada funciona entera, y no sólo que compila. Nadie tiene un Mac y un
 * Linux a mano cada vez que cambia algo; la CI sí.
 *
 * Lo que se prueba es lo que se rompe al cambiar de sistema:
 *
 *  - que la ventana pinta la interfaz (y se guardan capturas para verla);
 *  - que la consola nativa carga desde el paquete, con cada shell instalada,
 *    y que su integración devuelve el código de salida y la carpeta;
 *  - que Ctrl+C corta de verdad y que los acentos llegan enteros;
 *  - que los comandos del agente corren, propagan su código y se cortan por
 *    tiempo sin dejar procesos vivos;
 *  - que el PATH de la shell del usuario llega a la app aunque se abra desde
 *    el Dock o el menú del escritorio, y que con él se encuentran los CLIs.
 *
 * Deja `selftest.json` y las capturas en la carpeta indicada y sale con 0 si
 * todo pasa o con 1 si algo falla. Sin la variable, este módulo no hace nada.
 */
import { app, type BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { availableShells, closeTerm, createTerm, defaultShell, interruptTerm, runInTerm, terminalStatus } from './terminal'
import { executeTool } from './agents/tools'
import { detectClis } from './detect'
import { hardware } from './ollama'
import { IS_MAC, IS_WIN } from './platform'
import { launchedWithoutSandbox } from './security'
import type { TermEvent } from '@shared/types'

interface Check {
  name: string
  ok: boolean
  detail: string
  ms: number
}

const checks: Check[] = []

async function check(name: string, fn: () => Promise<string>, timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now()
  let timer: NodeJS.Timeout | undefined
  try {
    const detail = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sin respuesta en ${timeoutMs / 1000} s`)), timeoutMs)
      })
    ])
    checks.push({ name, ok: true, detail, ms: Date.now() - t0 })
  } catch (err: any) {
    checks.push({ name, ok: false, detail: err?.message ?? String(err), ms: Date.now() - t0 })
  } finally {
    clearTimeout(timer)
  }
  const last = checks[checks.length - 1]
  console.log(`[selftest] ${last.ok ? 'OK   ' : 'FALLA'} ${name} — ${last.detail}`)
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Lo último que ha salido, sin secuencias de escape, para los mensajes de fallo. */
function tail(text: string, n = 400): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '').replace(/\s+/g, ' ')
  return clean.slice(-n)
}

/* ------------------------------------------------------------------ *
 * Terminal                                                           *
 * ------------------------------------------------------------------ */

class Session {
  id = ''
  backend = ''
  out = ''
  ready = false
  exited = false
  ends: { code: number; cwd?: string; ms?: number }[] = []
  cwds: string[] = []

  static async open(shell: string, cwd: string): Promise<Session> {
    const s = new Session()
    const info = await createTerm({ shell, cwd, cols: 140, rows: 40 }, (e) => s.on(e))
    s.id = info.id
    s.backend = info.backend
    return s
  }

  on(e: Omit<TermEvent, 'termId'>): void {
    if (e.type === 'out' || e.type === 'err') this.out += e.data ?? ''
    else if (e.type === 'ready') this.ready = true
    else if (e.type === 'block-end') this.ends.push({ code: e.exitCode ?? 0, cwd: e.cwd, ms: e.durationMs })
    else if (e.type === 'cwd' && e.cwd) this.cwds.push(e.cwd)
    else if (e.type === 'exit') this.exited = true
  }

  async until(pred: () => boolean, ms: number, what: string): Promise<void> {
    const end = Date.now() + ms
    while (!pred()) {
      if (Date.now() > end) throw new Error(`${what}. Salida: «${tail(this.out)}»`)
      await sleep(50)
    }
  }

  /** Espera al primer prompt: la integración emite su marcador al pintarlo. */
  async prompt(): Promise<void> {
    await this.until(() => this.ends.length > 0, 25_000, 'la shell no llegó a su primer prompt con la integración cargada')
  }

  async run(command: string, ms = 20_000): Promise<{ code: number; cwd?: string; ms?: number }> {
    const n = this.ends.length
    runInTerm(this.id, command)
    await this.until(() => this.ends.length > n, ms, `«${command}» no cerró su bloque`)
    return this.ends[this.ends.length - 1]
  }
}

/** Las órdenes de prueba en el idioma de cada shell. */
function dialect(shell: string): { math: string; fail: string; sleep: string; utf8: string; cd: (dir: string) => string } {
  const name = (shell.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  if (name === 'pwsh' || name === 'powershell') {
    return {
      math: 'echo "acc-$(6*7)"',
      fail: 'cmd /c exit 3',
      sleep: 'Start-Sleep -Seconds 30',
      utf8: 'echo "ñandú €"',
      cd: (d) => `cd '${d}'`
    }
  }
  if (name === 'fish') {
    return {
      math: 'echo acc-(math 6 \\* 7)',
      fail: "sh -c 'exit 3'",
      sleep: 'sleep 30',
      utf8: "echo 'ñandú €'",
      cd: (d) => `cd '${d}'`
    }
  }
  return {
    math: 'echo acc-$((6*7))',
    fail: "sh -c 'exit 3'",
    sleep: 'sleep 30',
    utf8: "echo 'ñandú €'",
    cd: (d) => `cd '${d}'`
  }
}

async function terminalChecks(work: string): Promise<void> {
  await check('consola nativa', async () => {
    const st = await terminalStatus()
    assert(st.engine === 'native', `el motor es «${st.engine}», no la consola nativa: ${st.reason ?? 'sin motivo'}`)
    return 'node-pty carga desde el paquete'
  })

  // Todas las shells que haya y que la app sepa integrar: la de fábrica y,
  // en la CI, las que se instalan a propósito para probarlas.
  const known = IS_WIN ? ['pwsh', 'powershell'] : ['bash', 'zsh', 'fish']
  const seen = new Set<string>()
  const wanted: string[] = []
  for (const shell of [defaultShell(), ...availableShells().map((s) => s.path)]) {
    const name = (shell.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
    if (!known.includes(name)) continue
    // Una de cada; en Windows una sola PowerShell, que la 5.1 y la 7
    // comparten integración.
    const key = IS_WIN ? 'powershell' : name
    if (seen.has(key)) continue
    seen.add(key)
    wanted.push(shell)
  }

  for (const shell of wanted) {
    const label = shell.split(/[\\/]/).pop()
    const d = dialect(shell)
    const sub = join(work, 'carpeta con espacios ñ')
    mkdirSync(sub, { recursive: true })
    let s: Session | null = null

    await check(`${label}: abre con la integración`, async () => {
      s = await Session.open(shell, work)
      assert(s.backend === 'pty', `abrió con el motor «${s.backend}»`)
      await s.prompt()
      return `${shell} · primer prompt con código ${s.ends[0].code}`
    })
    if (!s) continue
    const t = s as Session

    await check(`${label}: ejecuta y devuelve el código`, async () => {
      const r = await t.run(d.math)
      assert(t.out.includes('acc-42'), 'no salió «acc-42»')
      assert(r.code === 0, `código ${r.code}`)
      const f = await t.run(d.fail)
      assert(f.code === 3, `el comando que falla devolvió ${f.code} en vez de 3`)
      return 'acc-42 con código 0; el que falla, 3'
    })

    await check(`${label}: sigue al cambiar de carpeta`, async () => {
      const r = await t.run(d.cd(sub))
      assert(r.code === 0, `cd devolvió ${r.code}`)
      await t.until(() => t.cwds.some((c) => c.endsWith('carpeta con espacios ñ')), 5000, 'no llegó la carpeta nueva')
      return t.cwds[t.cwds.length - 1]
    })

    await check(`${label}: acentos`, async () => {
      const before = t.out.length
      await t.run(d.utf8)
      assert(t.out.slice(before).includes('ñandú €'), 'no llegó «ñandú €» entero')
      return 'ñandú € llega entero'
    })

    await check(`${label}: Ctrl+C corta`, async () => {
      const n = t.ends.length
      runInTerm(t.id, d.sleep)
      await sleep(1200)
      await interruptTerm(t.id)
      await t.until(() => t.ends.length > n, 8000, 'Ctrl+C no cortó el comando')
      const r = t.ends[t.ends.length - 1]
      assert(r.code !== 0, 'el comando cortado devolvió 0')
      return `cortado con código ${r.code}`
    })

    await check(`${label}: se cierra`, async () => {
      closeTerm(t.id)
      await t.until(() => t.exited, 6000, 'la shell no terminó al cerrar la pestaña')
      return 'cerrada'
    })
  }
}

/* ------------------------------------------------------------------ *
 * Comandos del agente                                                *
 * ------------------------------------------------------------------ */

async function agentChecks(work: string): Promise<void> {
  const signal = new AbortController().signal

  await check('agente: comando con salida, acentos y código', async () => {
    const command = IS_WIN
      ? 'Write-Output hola; Write-Output "ñandú €"; (Get-Location).Path; exit 3'
      : "echo hola && echo 'ñandú €' && pwd && exit 3"
    const r = await executeTool('run_command', { command }, work, signal)
    assert(r.output.includes('hola'), `no salió «hola»: ${r.output}`)
    assert(r.output.includes('ñandú €'), `los acentos no llegaron enteros: ${r.output}`)
    assert(r.output.includes('[código de salida: 3]'), `no propagó el código 3: ${r.output}`)
    assert(r.isError, 'un código 3 no cuenta como error')
    return r.output.replace(/\s+/g, ' ').slice(0, 160)
  })

  await check('agente: corta por tiempo sin dejar procesos', async () => {
    const command = IS_WIN ? 'Start-Sleep -Seconds 40; Write-Output nunca' : 'sleep 40; echo nunca'
    const t0 = Date.now()
    const r = await executeTool('run_command', { command, timeout_seconds: 2 }, work, signal)
    const took = Date.now() - t0
    assert(took < 12_000, `tardó ${took} ms en cortar`)
    assert(r.output.includes('[cortado'), `no dice que lo cortó: ${r.output}`)
    assert(!r.output.includes('nunca'), 'el comando siguió después de cortarlo')
    if (!IS_WIN) {
      await sleep(500)
      // «[4]0» para que pgrep no se encuentre a sí mismo en la línea de bash.
      const left = await executeTool('run_command', { command: `pgrep -f 'sleep [4]0' || true` }, work, signal)
      assert(!/^\d+$/m.test(left.output.replace(/\[código de salida: \d+\]/, '').trim()), `quedó un sleep vivo: ${left.output}`)
    }
    return `cortado en ${(took / 1000).toFixed(1)} s`
  })
}

/* ------------------------------------------------------------------ *
 * Entorno                                                            *
 * ------------------------------------------------------------------ */

async function envChecks(): Promise<void> {
  // Informativo salvo que se pida: el AppImage arranca sin aislamiento en los
  // Ubuntu que bloquean los espacios de nombres, y eso se dice, no se esconde.
  await check('aislamiento de Chromium', async () => {
    const off = launchedWithoutSandbox()
    if (process.env['ACC_SELFTEST_EXPECT_SANDBOX'] === '1') assert(!off, 'arrancó con --no-sandbox')
    return off ? 'desactivado: arrancó con --no-sandbox' : 'activo'
  })

  const expectDir = process.env['ACC_SELFTEST_EXPECT_PATH']?.trim()
  if (expectDir) {
    await check('PATH de la shell del usuario', async () => {
      const parts = (process.env['PATH'] ?? '').split(delimiter)
      assert(parts.includes(expectDir), `${expectDir} no está en el PATH de la app: ${process.env['PATH']}`)
      return `${expectDir} está en el PATH`
    })
  }
  const expectCli = process.env['ACC_SELFTEST_EXPECT_CLI']?.trim()
  if (expectCli) {
    await check('detección de CLIs', async () => {
      const clis = await detectClis(false)
      const hit = clis.find((c) => c.command === expectCli)
      assert(hit?.found, `no encontró «${expectCli}»`)
      return `${expectCli} en ${hit.path}`
    })
  }
  await check('hardware', async () => {
    const hw = await hardware()
    assert(hw.cpu && hw.ramGb > 0, 'sin CPU o sin RAM')
    if (IS_MAC && process.arch === 'arm64') {
      assert(hw.unifiedMemory && (hw.bestVramMb ?? 0) > 0, 'no ve la memoria unificada de la GPU')
    }
    const gpu = hw.gpus.find((g) => g.primary) ?? hw.gpus[0]
    return `${hw.cpu} · ${hw.ramGb} GB · ${gpu ? `${gpu.name}${gpu.vramMb ? ` (${Math.round(gpu.vramMb / 1024)} GB)` : ''}` : 'sin GPU'}`
  })
}

/* ------------------------------------------------------------------ *
 * Ventana                                                            *
 * ------------------------------------------------------------------ */

/**
 * Guarda una captura de la página. Es para mirarla, no una comprobación: en
 * una pantalla virtual sin GPU (la CI de Linux) Chromium a veces no puede
 * componer el fotograma y falla, y eso no dice nada de la app.
 */
async function snap(win: BrowserWindow, file: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      writeFileSync(file, (await win.webContents.capturePage()).toPNG())
      return ''
    } catch (err: any) {
      if (i === 2) return ` (sin captura: ${err?.message ?? err})`
      await sleep(700)
    }
  }
  return ''
}

async function windowChecks(win: BrowserWindow, outDir: string): Promise<void> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true)

  await check('la interfaz pinta', async () => {
    if (win.webContents.isLoading()) {
      await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    }
    let nodes = 0
    for (let i = 0; i < 80 && nodes < 150; i++) {
      nodes = await js<number>(`document.getElementById('root')?.querySelectorAll('*').length ?? 0`)
      if (nodes < 150) await sleep(250)
    }
    assert(nodes >= 150, `sólo hay ${nodes} elementos en la página`)
    await sleep(1500)
    return `${nodes} elementos` + (await snap(win, join(outDir, 'selftest-panel.png')))
  })

  await check('atajo de sección y terminal en pantalla', async () => {
    // El mismo atajo que usa la gente: Cmd+4 en macOS, Ctrl+4 en el resto.
    await js(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ${IS_MAC ? 'metaKey' : 'ctrlKey'}: true, bubbles: true }))`
    )
    let text = ''
    for (let i = 0; i < 60 && text.trim().length < 3; i++) {
      await sleep(250)
      text = await js<string>(`document.querySelector('.xterm-rows')?.textContent ?? ''`)
    }
    assert(text.trim().length >= 3, 'la terminal de la página no pintó ningún prompt')
    await sleep(1000)
    return `prompt: «${text.trim().slice(0, 60)}»` + (await snap(win, join(outDir, 'selftest-terminal.png')))
  })

  if (IS_MAC) {
    await check('semáforos de macOS en su sitio', async () => {
      const pos = win.getWindowButtonPosition()
      assert(pos && pos.y > 0, `posición ${JSON.stringify(pos)}`)
      return JSON.stringify(pos)
    })
  }
}

/* ------------------------------------------------------------------ *
 * Entrada                                                            *
 * ------------------------------------------------------------------ */

export async function runSelfTest(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const work = mkdtempSync(join(tmpdir(), 'acc-selftest-work-'))
  const started = Date.now()
  // Pase lo que pase, la prueba acaba: una CI colgada no dice nada.
  const guard = setTimeout(() => {
    console.error('[selftest] se pasó del tiempo total')
    finish(outDir, started, 2)
  }, 240_000)

  try {
    await windowChecks(win, outDir)
    await envChecks()
    await terminalChecks(work)
    await agentChecks(work)
  } catch (err) {
    checks.push({ name: 'autoprueba', ok: false, detail: String(err), ms: 0 })
  }
  clearTimeout(guard)
  finish(outDir, started, checks.every((c) => c.ok) ? 0 : 1)
}

function finish(outDir: string, started: number, code: number): void {
  const report = {
    ok: code === 0,
    platform: `${process.platform}-${process.arch}`,
    version: app.getVersion(),
    electron: process.versions.electron,
    packaged: app.isPackaged,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    checks
  }
  try {
    writeFileSync(join(outDir, 'selftest.json'), JSON.stringify(report, null, 2), 'utf8')
  } catch (err) {
    console.error('[selftest] no se pudo escribir el informe:', err)
  }
  const failed = checks.filter((c) => !c.ok).length
  console.log(`[selftest] ${checks.length - failed}/${checks.length} comprobaciones bien en ${report.seconds} s`)
  app.exit(code)
}
