/**
 * Terminales integradas.
 *
 * Motor principal: una consola de verdad. En Windows se abre un ConPTY a
 * través de node-pty, así que las aplicaciones de pantalla completa —opencode,
 * vim, los agentes en modo interactivo— funcionan exactamente igual que en
 * Windows Terminal: detectan que hay terminal, pintan su interfaz, responden
 * al teclado y aceptan Ctrl+C de verdad.
 *
 * Motor de respaldo: si el módulo nativo no carga (por ejemplo tras subir de
 * versión de Electron), se cae a una shell por tuberías que organiza la salida
 * en bloques delimitados por un centinela. Es menos capaz —nada interactivo
 * funciona— pero la app no se queda sin terminal.
 *
 * Sobre el PTY se inyecta una integración de shell mínima: el prompt de
 * PowerShell emite, invisible, el directorio actual y el código de salida de
 * cada comando. De ahí salen la ruta de la pestaña y las duraciones, sin tener
 * que adivinar nada del texto.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { paths } from './paths'
import { StringDecoder } from 'node:string_decoder'
import type { TermBackend, TermEvent, TermInfo } from '@shared/types'

export type TermEventFn = (e: Omit<TermEvent, 'termId'>) => void

type ShellKind = 'powershell' | 'cmd' | 'posix'

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)

/* ------------------------------------------------------------------ *
 * Carga del PTY                                                      *
 * ------------------------------------------------------------------ */

interface PtyProcess {
  pid: number
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void
  write: (d: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

interface PtyModule {
  spawn: (
    file: string,
    args: string[] | string,
    opts: { name?: string; cols: number; rows: number; cwd: string; env: Record<string, string>; useConpty?: boolean }
  ) => PtyProcess
}

let ptyModule: PtyModule | null = null
let ptyLoadError: string | null = null
let ptyTried = false

const PTY_PKG = '@homebridge/node-pty-prebuilt-multiarch'

/**
 * El paquete carga sus binarios de forma perezosa, al abrir la primera
 * consola. Por eso un require del paquete no prueba nada: puede salir bien y
 * reventar después dentro de spawn, y entonces la pestaña se queda colgada en
 * "abriendo una shell" para siempre. Pasó una vez, con un empaquetado al que
 * un node-gyp fallido le había vaciado build/Release. Aquí se cargan a mano,
 * al arrancar, para que la respuesta de ptyAvailable sea verdad.
 */
function loadNativeBindings(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const root = join(require.resolve(PTY_PKG), '..', '..')
  const needed = process.platform === 'win32' ? ['conpty.node', 'pty.node'] : ['pty.node']
  for (const file of needed) {
    const bin = join(root, 'build', 'Release', file)
    if (!existsSync(bin)) throw new Error(`falta ${file} en build/Release del módulo nativo`)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(bin)
  }
}

/** El módulo es nativo: si falla, se informa y se sigue con el respaldo. */
function loadPty(): PtyModule | null {
  if (ptyTried) return ptyModule
  ptyTried = true
  try {
    // require en vez de import: el binario se resuelve en tiempo de ejecución
    // desde node_modules, fuera del empaquetado de Vite.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(PTY_PKG) as PtyModule
    loadNativeBindings()
    ptyModule = mod
  } catch (err: any) {
    ptyModule = null
    ptyLoadError = err?.message?.split('\n')[0] ?? String(err)
    console.error('[terminal] sin PTY nativo, se usará el respaldo por tuberías:', ptyLoadError)
  }
  return ptyModule
}

export function ptyAvailable(): { available: boolean; reason?: string } {
  loadPty()
  return { available: Boolean(ptyModule), reason: ptyLoadError ?? undefined }
}

/** Un fallo al abrir la consola real invalida el motor para las siguientes. */
function demotePty(reason: string): void {
  ptyModule = null
  ptyLoadError = reason
}

/* ------------------------------------------------------------------ *
 * Estado                                                             *
 * ------------------------------------------------------------------ */

interface Term {
  id: string
  backend: TermBackend
  backendReason?: string
  /** Uno de los dos, según el motor. */
  pty?: PtyProcess
  child?: ChildProcess
  shell: string
  shellLabel: string
  kind: ShellKind
  cwd: string
  createdAt: number
  projectId?: string
  title?: string
  /** Sólo en el respaldo por tuberías. */
  marker?: string
  pending?: { startedAt: number }
  alive: boolean
  cols: number
  rows: number
  emit: TermEventFn
}

const terms = new Map<string, Term>()

/* ------------------------------------------------------------------ *
 * Elección de shell                                                  *
 * ------------------------------------------------------------------ */

const PWSH_CANDIDATES = [
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe'
]

export function defaultShell(): string {
  if (process.platform === 'win32') {
    const pwsh = PWSH_CANDIDATES.find((p) => existsSync(p))
    if (pwsh) return pwsh
    return process.env['SystemRoot']
      ? `${process.env['SystemRoot']}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe'
  }
  return process.env['SHELL'] || '/bin/bash'
}

function classify(shell: string): { kind: ShellKind; label: string } {
  const b = shell.toLowerCase()
  if (b.includes('pwsh')) return { kind: 'powershell', label: 'PowerShell 7' }
  if (b.includes('powershell')) return { kind: 'powershell', label: 'PowerShell' }
  if (b.includes('cmd')) return { kind: 'cmd', label: 'cmd' }
  if (b.includes('zsh')) return { kind: 'posix', label: 'zsh' }
  if (b.includes('bash')) return { kind: 'posix', label: 'bash' }
  return {
    kind: process.platform === 'win32' ? 'powershell' : 'posix',
    label: shell.split(/[\\/]/).pop() ?? shell
  }
}

/**
 * Entorno de la terminal.
 *
 * A diferencia del respaldo, aquí NO se fuerza NO_COLOR ni TERM=dumb: hay una
 * consola de verdad detrás y lo que se quiere es que las herramientas usen
 * todos sus colores y su interfaz.
 */
function ptyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v != null) env[k] = v
  delete env['NO_COLOR']
  delete env['FORCE_COLOR']
  delete env['CLICOLOR']
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  env['TERM_PROGRAM'] = 'ai-command-center'
  env['PYTHONIOENCODING'] = 'utf-8'
  env['ACC_TERMINAL'] = '1'
  return env
}

/* ------------------------------------------------------------------ *
 * Integración de shell sobre el PTY                                  *
 * ------------------------------------------------------------------ */

/**
 * Guión de arranque de la integración de shell.
 *
 * Redefine el prompt para que emita, en secuencias invisibles, el código de
 * salida del comando anterior y el directorio actual. Se conserva el prompt
 * original y sólo se le añaden los marcadores, así que la terminal se ve
 * exactamente igual que la de siempre.
 *
 * `$?` y `$LASTEXITCODE` se capturan en la primera línea de la función:
 * cualquier cosa que se ejecute antes los sobrescribiría.
 */
const PS_INIT = `# Generado por AI Command Center. Se carga al abrir una terminal.
# Añade al prompt marcadores invisibles con el directorio actual y el código
# de salida de cada comando, que es de donde salen la ruta de la pestaña y las
# duraciones. No cambia el aspecto del prompt.
$global:__accPrompt = $function:prompt
function global:prompt {
  $__ok = $?; $__ec = $LASTEXITCODE
  $code = if ($__ok) { 0 } elseif ($__ec) { $__ec } else { 1 }
  $cwd = (Get-Location).Path
  $orig = try { & $global:__accPrompt } catch { "PS $cwd> " }
  $e = [char]27; $b = [char]7
  "$e]133;D;$code$b$e]9;9;$cwd$b$orig$e]133;B$b"
}
`

let psInitPath: string | null = null

/**
 * La integración NO se teclea en la shell: al haber una consola de verdad, el
 * PTY hace eco de todo lo que entra por stdin y el usuario vería el código
 * fuente de la función y una ristra de `>>` al abrir cada terminal. Va en un
 * fichero que se carga con -Command, así que no se ve nada.
 */
function psInitFile(): string {
  if (psInitPath && existsSync(psInitPath)) return psInitPath
  const file = join(paths.dir, 'shell-init.ps1')
  try {
    writeFileSync(file, PS_INIT, 'utf8')
    psInitPath = file
  } catch (err) {
    console.error('[terminal] no se pudo escribir la integración de shell:', err)
    return ''
  }
  return file
}

/** Argumentos de arranque, con la integración ya cargada y sin eco. */
function ptyArgs(kind: ShellKind): string[] {
  if (kind === 'powershell') {
    const file = psInitFile()
    if (!file) return ['-NoLogo']
    // Las comillas simples de PowerShell se escapan duplicándolas.
    const quoted = file.replace(/'/g, "''")
    // -NoExit deja la sesión interactiva después de cargar el guión.
    return ['-NoLogo', '-NoExit', '-Command', `. '${quoted}'`]
  }
  if (kind === 'posix') {
    return ['-i']
  }
  return []
}

/**
 * En bash el equivalente se pone por variable de entorno, que tampoco se ve.
 * Se deja aparte porque no hay un fichero que cargar.
 */
function posixEnvIntegration(env: Record<string, string>): void {
  env['PROMPT_COMMAND'] =
    'printf "\\033]133;D;%s\\007\\033]9;9;%s\\007" "$?" "$PWD"' +
    (process.env['PROMPT_COMMAND'] ? `; ${process.env['PROMPT_COMMAND']}` : '')
}

/**
 * Extrae los marcadores de la salida y los devuelve como eventos aparte.
 * El texto sale intacto salvo los propios marcadores, que se quitan para que
 * no aparezcan como basura en pantalla.
 */
function harvestMarkers(
  raw: string,
  onCwd: (cwd: string) => void,
  onExit: (code: number) => void
): string {
  if (!raw.includes(']133;') && !raw.includes(']9;9;')) return raw

  // OSC 9;9;<ruta>, OSC 133;D;<código> y los 133;A / 133;B que delimitan el
  // prompt. Todos se quitan del texto: xterm los ignoraría, pero dejarlos
  // pasar es pedir problemas con cualquier emulador.
  //
  // El código admite signo: cuando se corta un programa con Ctrl+C, Windows
  // devuelve -1073741510 (0xC000013A) y un patrón de sólo dígitos dejaba el
  // marcador sin reconocer, así que el comando se quedaba "en marcha" para
  // siempre.
  const rx = new RegExp(
    `${ESC}\\](?:9;9;([^${BEL}${ESC}]*)|133;D;?(-?[0-9]*)|133;[AB])(?:${BEL}|${ESC}\\\\)`,
    'g'
  )
  return raw.replace(rx, (_m, cwd, code) => {
    if (cwd) onCwd(String(cwd).trim())
    else if (code !== undefined) onExit(normalizeExit(code))
    return ''
  })
}

/** Código de salida de Windows al cortar con Ctrl+C. */
const STATUS_CONTROL_C_EXIT = -1073741510

/**
 * Traduce el código a algo legible. El de Ctrl+C se convierte en 130, que es
 * la convención de toda la vida para "interrumpido por el usuario", en vez de
 * enseñar un número negativo de nueve cifras.
 */
function normalizeExit(raw: string): number {
  if (raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  if (n === STATUS_CONTROL_C_EXIT || n === 0xc000013a) return 130
  return n
}

/* ------------------------------------------------------------------ *
 * Creación                                                           *
 * ------------------------------------------------------------------ */

export function createTerm(
  opts: {
    cwd?: string
    shell?: string
    projectId?: string
    title?: string
    cols?: number
    rows?: number
    /** Fuerza el respaldo por tuberías. Para pruebas. */
    forcePipe?: boolean
  },
  emit: TermEventFn
): TermInfo {
  const shell = opts.shell?.trim() || defaultShell()
  const { kind, label } = classify(shell)
  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir()
  const id = randomUUID()
  const cols = Math.max(20, opts.cols ?? 120)
  const rows = Math.max(5, opts.rows ?? 30)

  const lib = opts.forcePipe ? null : loadPty()

  const term: Term = {
    id,
    backend: lib ? 'pty' : 'pipe',
    backendReason: lib ? undefined : (ptyLoadError ?? (opts.forcePipe ? 'forzado para pruebas' : undefined)),
    shell,
    shellLabel: label,
    kind,
    cwd,
    createdAt: Date.now(),
    projectId: opts.projectId,
    title: opts.title,
    alive: true,
    cols,
    rows,
    emit
  }

  if (lib) {
    try {
      startPty(term, lib)
    } catch (err: any) {
      // Abrir la consola real puede fallar aunque el módulo haya cargado.
      // Antes eso dejaba la pestaña en blanco: ahora se cae al respaldo y se
      // dice en pantalla por qué.
      const why = err?.message?.split('\n')[0] ?? String(err)
      console.error('[terminal] la consola real falló al abrirse:', why)
      demotePty(why)
      term.backend = 'pipe'
      term.backendReason = `la consola real falló al abrirse: ${why}`
      startPipe(term)
    }
  } else {
    startPipe(term)
  }

  terms.set(id, term)
  return info(term)
}

function info(t: Term): TermInfo {
  return {
    id: t.id,
    shell: t.shell,
    shellLabel: t.shellLabel,
    cwd: t.cwd,
    alive: t.alive,
    createdAt: t.createdAt,
    pid: t.pty?.pid ?? t.child?.pid,
    projectId: t.projectId,
    title: t.title,
    backend: t.backend,
    backendReason: t.backendReason
  }
}

/* ------------------------------------------------------------------ *
 * Motor PTY                                                          *
 * ------------------------------------------------------------------ */

function startPty(t: Term, lib: PtyModule): void {
  // Con perfil del usuario: es su terminal, con sus alias y su PATH.
  const env = ptyEnv()
  if (t.kind === 'posix') posixEnvIntegration(env)

  const p = lib.spawn(t.shell, ptyArgs(t.kind), {
    name: 'xterm-256color',
    cols: t.cols,
    rows: t.rows,
    cwd: t.cwd,
    env
  })
  t.pty = p

  let carry = ''

  p.onData((data) => {
    // Los marcadores pueden partirse entre dos trozos: se retiene la cola que
    // empiece un OSC sin cerrar.
    const buf = carry + data
    const cut = pendingOscStart(buf)
    carry = buf.slice(cut)
    const usable = buf.slice(0, cut)
    if (!usable) return

    const clean = harvestMarkers(
      usable,
      (cwd) => {
        if (cwd && cwd !== t.cwd) {
          t.cwd = cwd
          t.emit({ type: 'cwd', cwd })
        }
      },
      (code) => {
        const started = t.pending?.startedAt
        t.pending = undefined
        t.emit({
          type: 'block-end',
          exitCode: code,
          ok: code === 0,
          cwd: t.cwd,
          durationMs: started ? Date.now() - started : undefined
        })
      }
    )
    if (clean) t.emit({ type: 'out', data: clean })
  })

  p.onExit(({ exitCode }) => {
    t.alive = false
    t.emit({ type: 'exit', exitCode })
    terms.delete(t.id)
  })

  // La integración ya viene cargada por los argumentos de arranque: aquí no
  // se escribe nada en la shell, para que no haya eco en pantalla.
  t.emit({ type: 'ready', cwd: t.cwd })
}

/**
 * Si la cola contiene un OSC sin terminar, se guarda para el siguiente trozo.
 * Sin esto un marcador partido se colaría como texto visible.
 */
function pendingOscStart(buf: string): number {
  const at = buf.lastIndexOf(`${ESC}]`)
  if (at === -1) return buf.length
  const rest = buf.slice(at)
  if (rest.includes(BEL) || rest.includes(`${ESC}\\`)) return buf.length
  // Un OSC de estos nunca pasa de unos cientos de caracteres.
  return rest.length > 600 ? buf.length : at
}

/* ------------------------------------------------------------------ *
 * Motor de respaldo por tuberías                                     *
 * ------------------------------------------------------------------ */

function shellArgs(kind: ShellKind): string[] {
  if (kind === 'powershell') return ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-']
  if (kind === 'cmd') return ['/Q', '/K']
  return ['-i']
}

/** Sonda que cierra el bloque: código de salida, éxito y directorio actual. */
function probeLine(kind: ShellKind, marker: string): string {
  if (kind === 'powershell') {
    return `$__ok=$?; $__ec=$LASTEXITCODE; Write-Output "${marker}|$__ok|$__ec|$((Get-Location).Path)"`
  }
  if (kind === 'cmd') return `echo ${marker}^|%ERRORLEVEL%^|%ERRORLEVEL%^|%CD%`
  return `__acc_ec=$?; printf '%s|%s|%s|%s\\n' "${marker}" "$__acc_ec" "$__acc_ec" "$PWD"`
}

/** Sin esto PowerShell 5.1 escribe en cp850 y rompe los acentos. */
function bootLines(kind: ShellKind): string[] {
  if (kind === 'powershell') {
    return [
      '$ErrorActionPreference = "Continue"',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$OutputEncoding = [System.Text.Encoding]::UTF8',
      'if ($PSStyle) { $PSStyle.OutputRendering = "PlainText" }'
    ]
  }
  if (kind === 'cmd') return ['chcp 65001 > nul', 'prompt $G']
  return ['export PS1=""', 'export TERM=dumb']
}

function startPipe(t: Term): void {
  const marker = `__ACC${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`
  t.marker = marker

  const child = spawn(t.shell, shellArgs(t.kind), {
    cwd: t.cwd,
    windowsHide: true,
    env: {
      ...process.env,
      TERM: 'dumb',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      PYTHONIOENCODING: 'utf-8',
      ACC_TERMINAL: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.child = child

  wirePipe(t, marker)

  for (const line of bootLines(t.kind)) child.stdin?.write(line + '\r\n')
  child.stdin?.write(probeLine(t.kind, marker) + '\r\n')
}

function wirePipe(t: Term, marker: string): void {
  // El salto final es obligatorio: si no, un cwd que llega partido encajaría
  // con la ruta truncada y daría un bloque cerrado en falso.
  const rx = new RegExp(`${marker}\\|([^|]*)\\|([^|]*)\\|([^\\r\\n]*)\\r?\\n`, 'g')
  let ready = false

  const makeReader = (channel: 'out' | 'err') => {
    const dec = new StringDecoder('utf8')
    let carry = ''
    return (chunk: Buffer): void => {
      carry += dec.write(chunk)

      if (channel === 'err') {
        t.emit({ type: 'err', data: carry })
        carry = ''
        return
      }

      let plain = ''
      let last = 0
      let m: RegExpExecArray | null
      rx.lastIndex = 0
      while ((m = rx.exec(carry)) !== null) {
        plain += carry.slice(last, m.index)
        last = m.index + m[0].length

        const ok = /^(true|0)$/i.test((m[1] ?? '').trim())
        const rawEc = (m[2] ?? '').trim()
        const ec = rawEc === '' ? (ok ? 0 : 1) : Number(rawEc)
        const newCwd = (m[3] ?? '').trim()
        if (newCwd) t.cwd = newCwd

        if (!ready) {
          ready = true
          t.emit({ type: 'ready', cwd: t.cwd })
        } else {
          const started = t.pending?.startedAt
          t.pending = undefined
          t.emit({
            type: 'block-end',
            exitCode: Number.isFinite(ec) ? ec : ok ? 0 : 1,
            ok,
            cwd: t.cwd,
            durationMs: started ? Date.now() - started : undefined
          })
        }
      }

      const tail = carry.slice(last)
      const cut = safeCut(tail, marker)
      plain += tail.slice(0, cut)
      carry = tail.slice(cut)

      if (plain) t.emit({ type: 'out', data: plain })
    }
  }

  t.child?.stdout?.on('data', makeReader('out'))
  t.child?.stderr?.on('data', makeReader('err'))

  t.child?.on('error', (err) => {
    t.emit({ type: 'err', data: `\nNo se pudo iniciar ${t.shell}: ${err.message}\n` })
    t.alive = false
    t.emit({ type: 'exit', exitCode: -1 })
    terms.delete(t.id)
  })

  t.child?.on('close', (code) => {
    t.alive = false
    t.emit({ type: 'exit', exitCode: code ?? 0 })
    terms.delete(t.id)
  })
}

/**
 * Cuántos caracteres de la cola se pueden emitir ya. Se retiene lo que podría
 * ser un centinela a medio llegar.
 */
function safeCut(tail: string, marker: string): number {
  const at = tail.indexOf(marker)
  if (at !== -1) return at
  for (let k = Math.min(tail.length, marker.length - 1); k > 0; k--) {
    if (marker.startsWith(tail.slice(tail.length - k))) return tail.length - k
  }
  return tail.length
}

/* ------------------------------------------------------------------ *
 * Interacción                                                        *
 * ------------------------------------------------------------------ */

/**
 * Codifica el comando para que viaje sólo en ASCII (respaldo únicamente).
 *
 * PowerShell lee stdin con la página de códigos del sistema, no en UTF-8, y no
 * se puede cambiar después: el lector ya está creado. Un `Write-Output "eñe"`
 * acabaría mostrando "e├▒e". En base64 sólo pasan caracteres ASCII y la página
 * de códigos deja de importar. Se usa Invoke-Expression y no el operador de
 * llamada porque éste crearía un ámbito hijo y un `cd` no persistiría.
 *
 * En el PTY no hace falta: la consola habla UTF-8.
 */
function encodePipeCommand(kind: ShellKind, command: string): string {
  const line = command.replace(/\r?\n$/, '')
  if (kind !== 'powershell' || !/[^\u0000-\u007F]/.test(line)) return line
  const b64 = Buffer.from(line, 'utf8').toString('base64')
  return `Invoke-Expression ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}')))`
}

/** Ejecuta un comando como si lo hubieras tecleado. */
export function runInTerm(id: string, command: string): boolean {
  const t = terms.get(id)
  if (!t || !t.alive) return false
  t.pending = { startedAt: Date.now() }

  if (t.backend === 'pty' && t.pty) {
    t.pty.write(command.replace(/\r?\n$/, '') + '\r')
    return true
  }
  t.child?.stdin?.write(encodePipeCommand(t.kind, command) + '\r\n')
  t.child?.stdin?.write(probeLine(t.kind, t.marker!) + '\r\n')
  return true
}

/** Escritura cruda: lo que teclea el usuario, tal cual, incluidas las teclas. */
export function writeTerm(id: string, data: string): boolean {
  const t = terms.get(id)
  if (!t || !t.alive) return false
  if (t.backend === 'pty' && t.pty) {
    t.pty.write(data)
    return true
  }
  t.child?.stdin?.write(data)
  return true
}

export function resizeTerm(id: string, cols: number, rows: number): boolean {
  const t = terms.get(id)
  if (!t || !t.alive) return false
  t.cols = Math.max(20, Math.floor(cols))
  t.rows = Math.max(5, Math.floor(rows))
  if (t.backend === 'pty' && t.pty) {
    try {
      t.pty.resize(t.cols, t.rows)
    } catch {
      // Si la consola ya se cerró, no hay nada que redimensionar.
    }
  }
  return true
}

/**
 * Ctrl+C. Con PTY es el carácter 0x03 de verdad, que es lo que espera
 * cualquier programa. En el respaldo no hay consola a la que señalizar, así
 * que se matan los procesos hijos de la shell y se deja la shell viva.
 */
export function interruptTerm(id: string): Promise<boolean> {
  const t = terms.get(id)
  if (!t || !t.alive) return Promise.resolve(false)

  if (t.backend === 'pty' && t.pty) {
    t.pty.write('\u0003')
    return Promise.resolve(true)
  }

  const pid = t.child?.pid
  if (!pid) return Promise.resolve(false)

  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGINT')
    } catch {
      t.child?.kill('SIGINT')
    }
    t.pending = undefined
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ` +
          'ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null }'
      ],
      { timeout: 8000, windowsHide: true },
      () => {
        if (t.pending) {
          const started = t.pending.startedAt
          t.pending = undefined
          t.emit({ type: 'block-end', exitCode: 130, ok: false, cwd: t.cwd, durationMs: Date.now() - started })
        }
        resolve(true)
      }
    )
  })
}

export function closeTerm(id: string): boolean {
  const t = terms.get(id)
  if (!t) return false
  t.alive = false

  if (t.pty) {
    try {
      t.pty.kill()
    } catch {
      // Puede haber muerto ya por su cuenta.
    }
  } else if (t.child) {
    if (process.platform === 'win32' && t.child.pid) {
      spawn('taskkill', ['/PID', String(t.child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      t.child.kill('SIGTERM')
    }
  }
  terms.delete(id)
  return true
}

export function listTerms(): TermInfo[] {
  return [...terms.values()].map(info)
}

export function termCwd(id: string): string | undefined {
  return terms.get(id)?.cwd
}

export function closeAllTerms(): void {
  for (const id of [...terms.keys()]) closeTerm(id)
}

/** Shells instaladas que se pueden elegir en Ajustes. */
export function availableShells(): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = []
  if (process.platform === 'win32') {
    for (const p of PWSH_CANDIDATES) if (existsSync(p)) out.push({ path: p, label: 'PowerShell 7' })
    const root = process.env['SystemRoot'] ?? 'C:\\Windows'
    const ps = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    if (existsSync(ps)) out.push({ path: ps, label: 'Windows PowerShell 5.1' })
    const cmd = `${root}\\System32\\cmd.exe`
    if (existsSync(cmd)) out.push({ path: cmd, label: 'Símbolo del sistema (cmd)' })
    for (const g of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
      if (existsSync(g)) {
        out.push({ path: g, label: 'Git Bash' })
        break
      }
    }
  } else {
    for (const p of ['/bin/zsh', '/bin/bash', '/bin/sh']) if (existsSync(p)) out.push({ path: p, label: p })
  }
  return out
}
