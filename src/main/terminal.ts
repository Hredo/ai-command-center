/**
 * Terminales integradas.
 *
 * Motor principal: una consola de verdad (ConPTY en Windows), así que las
 * aplicaciones de pantalla completa —opencode, vim, los agentes en modo
 * interactivo— funcionan exactamente igual que en Windows Terminal: detectan
 * que hay terminal, pintan su interfaz, responden al teclado y aceptan Ctrl+C
 * de verdad.
 *
 * Esa consola se abre de una de dos formas, por orden:
 *
 *  1. node-pty, un módulo nativo. Es lo más directo, pero su `conpty.node` no
 *     va firmado y Smart App Control lo bloquea en los equipos que lo tienen
 *     activado.
 *  2. Un puente en PowerShell (ver conpty.ts) que llama a la misma API de
 *     Windows sin cargar ningún binario propio. La consola que sale es la
 *     misma.
 *
 * Motor de respaldo: si ninguna de las dos funciona, se cae a una shell por
 * tuberías que organiza la salida en bloques delimitados por un centinela. Es
 * menos capaz —nada interactivo funciona— pero la app no se queda sin terminal.
 *
 * En macOS y Linux sólo existe la primera: node-pty abre un pseudoterminal
 * del sistema y no hay nada que Smart App Control pueda bloquear.
 *
 * Sobre la consola se inyecta una integración de shell mínima: el prompt de
 * PowerShell, bash, zsh o fish emite, invisible, el directorio actual y el
 * código de salida de cada comando. De ahí salen la ruta de la pestaña y las
 * duraciones, sin tener que adivinar nada del texto.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { paths } from './paths'
import { IS_MAC, IS_WIN, findInPath } from './platform'
import { userShell } from './shellEnv'
import { StringDecoder } from 'node:string_decoder'
import { bridgeStatus, markBridgeBroken, probeBridge, spawnBridge, type Bridge } from './conpty'
import { opencodeTerminalEnv } from './opencode'
import type { TermBackend, TermEvent, TermInfo } from '@shared/types'

export type TermEventFn = (e: Omit<TermEvent, 'termId'>) => void

type ShellKind = 'powershell' | 'cmd' | 'posix'

/** Con qué se abre la consola: módulo nativo, puente de PowerShell o tuberías. */
export type TermEngine = 'native' | 'bridge' | 'pipe'

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)

/**
 * Para pruebas: ACC_TERMINAL_ENGINE=bridge se salta node-pty y usa el puente;
 * =pipe se salta los dos.
 */
function forcedEngine(): 'bridge' | 'pipe' | null {
  const v = (process.env['ACC_TERMINAL_ENGINE'] ?? '').trim().toLowerCase()
  return v === 'bridge' || v === 'pipe' ? v : null
}

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
  const needed = IS_WIN ? ['conpty.node', 'pty.node'] : ['pty.node']
  for (const file of needed) {
    const bin = join(root, 'build', 'Release', file)
    if (!existsSync(bin)) throw new Error(`falta ${file} en build/Release del módulo nativo`)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(bin)
  }
  // En macOS cada consola nace a través de un pequeño ejecutable del paquete,
  // spawn-helper. Si falta o perdió el permiso de ejecución, la pestaña se
  // queda en «posix_spawnp failed». Se lanza desde fuera del asar, como hace
  // el propio paquete.
  if (IS_MAC) {
    const helper = join(root, 'build', 'Release', 'spawn-helper').replace('app.asar', 'app.asar.unpacked')
    try {
      accessSync(helper, constants.X_OK)
    } catch {
      throw new Error('falta spawn-helper del módulo nativo, o no se puede ejecutar')
    }
  }
}

/** El módulo es nativo: si falla, se informa y se sigue con el siguiente motor. */
function loadPty(): PtyModule | null {
  if (ptyTried) return ptyModule
  ptyTried = true
  const forced = forcedEngine()
  if (forced) {
    ptyLoadError = `módulo nativo desactivado con ACC_TERMINAL_ENGINE=${forced}`
    return null
  }
  try {
    // require en vez de import: el binario se resuelve en tiempo de ejecución
    // desde node_modules, fuera del empaquetado de Vite.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(PTY_PKG) as PtyModule
    loadNativeBindings()
    ptyModule = mod
  } catch (err: any) {
    ptyModule = null
    // Windows acaba sus mensajes con \r\n: sin recortar, el motivo llega con
    // un retorno de carro colgando.
    ptyLoadError = (err?.message?.split('\n')[0] ?? String(err)).trim()
    console.error('[terminal] el módulo nativo del PTY no carga:', ptyLoadError)
  }
  return ptyModule
}

/** El puente sólo tiene sentido en Windows y si no se ha pedido ir por tuberías. */
function bridgeAllowed(): boolean {
  return IS_WIN && forcedEngine() !== 'pipe'
}

/**
 * Qué motor tendrá la próxima terminal, con lo que se sabe ahora mismo. Si el
 * puente todavía no se ha sondeado, cuenta como no disponible: para una
 * respuesta segura está `terminalStatus`.
 */
export function ptyAvailable(): { available: boolean; engine: TermEngine; reason?: string } {
  loadPty()
  if (ptyModule) return { available: true, engine: 'native' }
  const bridge = bridgeAllowed() ? bridgeStatus() : null
  if (bridge?.ok) {
    return { available: true, engine: 'bridge', reason: ptyLoadError ?? undefined }
  }
  const reasons = [ptyLoadError, bridge?.reason ? `puente de PowerShell: ${bridge.reason}` : null].filter(Boolean)
  return { available: false, engine: 'pipe', reason: reasons.join(' · ') || undefined }
}

/** Lo mismo que ptyAvailable, pero esperando al sondeo del puente si hace falta. */
export async function terminalStatus(): Promise<{ available: boolean; engine: TermEngine; reason?: string }> {
  loadPty()
  if (!ptyModule && bridgeAllowed()) await probeBridge()
  return ptyAvailable()
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
  /** Uno de los tres, según el motor. */
  pty?: PtyProcess
  bridge?: Bridge
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
  /** Variables que se suman al entorno de la shell: OpenCode con los modelos de Ollama. */
  extraEnv?: Record<string, string>
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
  if (IS_WIN) {
    const pwsh = PWSH_CANDIDATES.find((p) => existsSync(p))
    if (pwsh) return pwsh
    return process.env['SystemRoot']
      ? `${process.env['SystemRoot']}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe'
  }
  // La del usuario: zsh en un Mac de fábrica, bash en casi todos los Linux.
  return userShell()
}

/** El nombre del programa sin carpeta ni extensión: «zsh», «pwsh», «bash». */
function shellName(shell: string): string {
  return (shell.split(/[\\/]/).pop() ?? shell).toLowerCase().replace(/\.exe$/, '')
}

/**
 * Se mira sólo el nombre del programa y no la ruta entera: una carpeta que se
 * llame «cmdtools» no convierte una zsh en cmd.
 */
function classify(shell: string): { kind: ShellKind; label: string } {
  const name = shellName(shell)
  if (name === 'pwsh') return { kind: 'powershell', label: 'PowerShell 7' }
  if (name === 'powershell') return { kind: 'powershell', label: 'PowerShell' }
  if (name === 'cmd') return { kind: 'cmd', label: 'cmd' }
  if (name === 'zsh' || name === 'bash' || name === 'fish') return { kind: 'posix', label: name }
  return { kind: IS_WIN ? 'powershell' : 'posix', label: name || shell }
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
  if (!IS_WIN) {
    // Electron cambia XDG_CURRENT_DESKTOP al arrancar en algunos escritorios
    // y guarda el original aparte; la shell tiene que ver el de verdad o
    // xdg-open y compañía abren las cosas con el programa equivocado.
    if (env['ORIGINAL_XDG_CURRENT_DESKTOP']) env['XDG_CURRENT_DESKTOP'] = env['ORIGINAL_XDG_CURRENT_DESKTOP']
    delete env['ORIGINAL_XDG_CURRENT_DESKTOP']
    // Las variables del AppImage son de la app, no de lo que se lance dentro:
    // otro AppImage abierto desde esta terminal creería ser éste.
    for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[k]
  }
  return env
}

/* ------------------------------------------------------------------ *
 * Integración de shell sobre la consola                              *
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

/*
 * La misma integración para las shells de macOS y Linux.
 *
 * Tampoco se teclea: cada shell tiene una forma de cargar un fichero propio
 * al arrancar sin que se vea. Y en las tres se carga primero la configuración
 * de siempre del usuario —sus alias, su prompt, su PATH— y después se añade
 * el marcador, así que el aspecto no cambia y el marcador ve el código de
 * salida antes que nadie.
 *
 * En macOS cada terminal nueva es de inicio de sesión, como en Terminal.app:
 * así se leen .zprofile y /etc/zprofile, que es donde Homebrew se apunta al
 * PATH. En Linux no, como en las terminales de GNOME o KDE.
 */

/** bash: se arranca con --rcfile, que sustituye a .bashrc; éste lo carga él. */
const BASH_INIT = `# Generado por AI Command Center. Se carga al abrir una terminal con bash.
# Carga tu configuración de siempre y después añade al prompt marcadores
# invisibles con el código de salida y el directorio actual. No cambia el
# aspecto del prompt.
if [ "\${ACC_BASH_LOGIN:-}" = 1 ]; then
  [ -r /etc/profile ] && . /etc/profile
  if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
  elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
  elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"
  fi
else
  [ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
fi
unset ACC_BASH_LOGIN
__acc_prompt() {
  local ec=$?
  builtin printf '\\033]133;D;%s\\007\\033]9;9;%s\\007' "$ec" "$PWD"
  return $ec
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=(__acc_prompt "\${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="__acc_prompt\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
`

/**
 * zsh no tiene --rcfile: lee sus ficheros de la carpeta ZDOTDIR. La app la
 * apunta a una suya, y cada fichero de ahí carga primero el tuyo del mismo
 * nombre. Al terminar el arranque ZDOTDIR vuelve a ser la tuya.
 */
const ZSH_HEADER = '# Generado por AI Command Center. zsh lo lee porque la app apunta ZDOTDIR aquí.\n'
const ZSH_FILES: Record<string, string> = {
  '.zshenv': `${ZSH_HEADER}__acc_zdotdir="$ZDOTDIR"
ZDOTDIR="\${ACC_USER_ZDOTDIR:-$HOME}"
[[ -r "$ZDOTDIR/.zshenv" ]] && builtin source "$ZDOTDIR/.zshenv"
ACC_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$__acc_zdotdir"
`,
  '.zprofile': `${ZSH_HEADER}ZDOTDIR="$ACC_USER_ZDOTDIR"
[[ -r "$ZDOTDIR/.zprofile" ]] && builtin source "$ZDOTDIR/.zprofile"
ZDOTDIR="$__acc_zdotdir"
`,
  '.zshrc': `${ZSH_HEADER}ZDOTDIR="$ACC_USER_ZDOTDIR"
# El /etc/zshrc de macOS pone el historial dentro de ZDOTDIR, que en ese
# momento era esta carpeta: se devuelve a su sitio para que sea el de siempre.
[[ "$HISTFILE" == "$__acc_zdotdir/.zsh_history" ]] && HISTFILE="$ZDOTDIR/.zsh_history"
[[ -r "$ZDOTDIR/.zshrc" ]] && builtin source "$ZDOTDIR/.zshrc"
__acc_precmd() {
  local ec=$?
  builtin printf '\\e]133;D;%s\\a\\e]9;9;%s\\a' "$ec" "$PWD"
  return $ec
}
precmd_functions=(__acc_precmd \${precmd_functions[@]})
if [[ -o login ]]; then
  ZDOTDIR="$__acc_zdotdir"
else
  unset __acc_zdotdir ACC_USER_ZDOTDIR
fi
`,
  '.zlogin': `${ZSH_HEADER}ZDOTDIR="$ACC_USER_ZDOTDIR"
[[ -r "$ZDOTDIR/.zlogin" ]] && builtin source "$ZDOTDIR/.zlogin"
unset __acc_zdotdir ACC_USER_ZDOTDIR
`
}

/**
 * fish: --init-command se ejecuta después de su config.fish. El código de
 * salida se toma al acabar cada comando (fish_postexec, donde $status es el
 * suyo); el primer prompt, que no viene de ningún comando, se marca con un 0
 * como en las demás shells.
 */
const FISH_INIT =
  "function __acc_postexec --on-event fish_postexec; printf '\\e]133;D;%s\\a' $status; end; " +
  'function __acc_prompt --on-event fish_prompt; ' +
  "if not set -q __acc_started; set -g __acc_started 1; printf '\\e]133;D;0\\a'; end; " +
  "printf '\\e]9;9;%s\\a' $PWD; end"

let posixInitDir: string | null = null

/**
 * Escribe los ficheros de integración una vez por arranque (así una versión
 * nueva de la app los actualiza) y devuelve la carpeta. Si no se puede
 * escribir, la terminal abre igual, sólo que sin marcadores.
 */
function posixInitFiles(): string {
  if (posixInitDir) return posixInitDir
  const dir = join(paths.dir, 'shell')
  try {
    mkdirSync(join(dir, 'zsh'), { recursive: true })
    const write = (file: string, text: string): void => {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : null
      if (current !== text) writeFileSync(file, text, { encoding: 'utf8', mode: 0o644 })
    }
    write(join(dir, 'bash-init.sh'), BASH_INIT)
    for (const [name, text] of Object.entries(ZSH_FILES)) write(join(dir, 'zsh', name), text)
    posixInitDir = dir
  } catch (err) {
    console.error('[terminal] no se pudo escribir la integración de shell:', err)
    return ''
  }
  return dir
}

/** Argumentos de arranque, con la integración ya cargada y sin eco. */
function ptyArgs(kind: ShellKind, shell: string): string[] {
  if (kind === 'powershell') {
    const file = psInitFile()
    if (!file) return ['-NoLogo']
    // Las comillas simples de PowerShell se escapan duplicándolas.
    const quoted = file.replace(/'/g, "''")
    // -NoExit deja la sesión interactiva después de cargar el guión.
    return ['-NoLogo', '-NoExit', '-Command', `. '${quoted}'`]
  }
  if (kind !== 'posix') return []
  // Git Bash en Windows sigue con la integración por variable de entorno.
  if (IS_WIN) return ['-i']

  const name = shellName(shell)
  const dir = posixInitFiles()
  if (name === 'bash' && dir) return ['--rcfile', join(dir, 'bash-init.sh'), '-i']
  if (name === 'zsh') return IS_MAC ? ['-l', '-i'] : ['-i']
  if (name === 'fish') return [...(IS_MAC ? ['-l'] : []), '-i', '--init-command', FISH_INIT]
  return IS_MAC ? ['-l', '-i'] : ['-i']
}

/** Entorno completo de la shell de una consola real, con su integración. */
function consoleEnv(kind: ShellKind, shell: string, extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...ptyEnv(), ...extra }
  if (kind !== 'posix') return env

  if (IS_WIN) {
    // Git Bash: el marcador va en PROMPT_COMMAND, que tampoco se ve.
    env['PROMPT_COMMAND'] =
      'printf "\\033]133;D;%s\\007\\033]9;9;%s\\007" "$?" "$PWD"' +
      (process.env['PROMPT_COMMAND'] ? `; ${process.env['PROMPT_COMMAND']}` : '')
    return env
  }

  const name = shellName(shell)
  const dir = posixInitFiles()
  if (name === 'zsh' && dir) {
    env['ACC_USER_ZDOTDIR'] = env['ZDOTDIR'] || homedir()
    env['ZDOTDIR'] = join(dir, 'zsh')
  } else if (name === 'bash') {
    if (IS_MAC) env['ACC_BASH_LOGIN'] = '1'
  }
  return env
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

export async function createTerm(
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
): Promise<TermInfo> {
  const shell = opts.shell?.trim() || defaultShell()
  const { kind, label } = classify(shell)
  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir()
  const id = randomUUID()
  const cols = Math.max(20, opts.cols ?? 120)
  const rows = Math.max(5, opts.rows ?? 30)

  const term: Term = {
    id,
    backend: 'pty',
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

  let started = false

  // Con Ollama encendido, el OpenCode que se abra aquí ve también sus modelos,
  // con la ventana entera.
  if (!opts.forcePipe) term.extraEnv = await opencodeTerminalEnv().catch(() => ({}))

  const lib = opts.forcePipe ? null : loadPty()
  if (lib) {
    try {
      startPty(term, lib)
      started = true
    } catch (err: any) {
      // Abrir la consola real puede fallar aunque el módulo haya cargado.
      // Antes eso dejaba la pestaña en blanco: ahora se prueba lo siguiente.
      const why = (err?.message?.split('\n')[0] ?? String(err)).trim()
      console.error('[terminal] la consola nativa falló al abrirse:', why)
      demotePty(`la consola nativa falló al abrirse: ${why}`)
    }
  }

  if (!started && !opts.forcePipe && bridgeAllowed()) {
    const probe = await probeBridge()
    if (probe.ok) {
      try {
        startBridge(term)
        started = true
      } catch (err: any) {
        const why = (err?.message?.split('\n')[0] ?? String(err)).trim()
        console.error('[terminal] el puente de PowerShell falló al abrirse:', why)
        markBridgeBroken(why)
      }
    }
  }

  if (!started) {
    term.backend = 'pipe'
    term.backendReason = opts.forcePipe ? 'forzado para pruebas' : ptyAvailable().reason
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
    pid: t.pty?.pid ?? t.bridge?.shellPid ?? t.bridge?.pid ?? t.child?.pid,
    projectId: t.projectId,
    title: t.title,
    backend: t.backend,
    backendReason: t.backendReason
  }
}

/* ------------------------------------------------------------------ *
 * Consola real: node-pty o puente                                    *
 * ------------------------------------------------------------------ */

/**
 * Lo que sale de la consola, venga del motor que venga: se recogen los
 * marcadores de la integración y el resto va tal cual a la ventana.
 */
function consoleOutput(t: Term): (data: string) => void {
  let carry = ''
  return (data) => {
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
  }
}

function consoleEnded(t: Term, exitCode: number): void {
  t.alive = false
  t.emit({ type: 'exit', exitCode })
  terms.delete(t.id)
}

function startPty(t: Term, lib: PtyModule): void {
  // Con perfil del usuario: es su terminal, con sus alias y su PATH.
  const p = lib.spawn(t.shell, ptyArgs(t.kind, t.shell), {
    name: 'xterm-256color',
    cols: t.cols,
    rows: t.rows,
    cwd: t.cwd,
    env: consoleEnv(t.kind, t.shell, t.extraEnv)
  })
  t.pty = p
  p.onData(consoleOutput(t))
  p.onExit(({ exitCode }) => consoleEnded(t, exitCode))

  // La integración ya viene cargada por los argumentos de arranque: aquí no
  // se escribe nada en la shell, para que no haya eco en pantalla.
  t.emit({ type: 'ready', cwd: t.cwd })
}

function startBridge(t: Term): void {
  t.bridge = spawnBridge({
    file: t.shell,
    args: ptyArgs(t.kind, t.shell),
    cwd: t.cwd,
    cols: t.cols,
    rows: t.rows,
    env: consoleEnv(t.kind, t.shell, t.extraEnv),
    onData: consoleOutput(t),
    onExit: (code, started) => {
      // Si ni siquiera llegó a arrancar la shell, el puente no sirve en este
      // equipo: las terminales siguientes irán directas al respaldo.
      if (!started) markBridgeBroken('la consola no llegó a abrirse')
      consoleEnded(t, code)
    }
  })
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

/**
 * Fin de línea al escribir en la shell. Una shell POSIX no se come el \r: con
 * \r\n, `ls` llegaría como `ls\r`, que no es ningún programa.
 */
function pipeEol(kind: ShellKind): string {
  return kind === 'posix' ? '\n' : '\r\n'
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

  // fish no entiende la sonda (`$?`, `VAR=valor`): el respaldo va con bash.
  const file =
    t.kind === 'posix' && shellName(t.shell) === 'fish' ? (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh') : t.shell
  const child = spawn(file, shellArgs(t.kind), {
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

  const eol = pipeEol(t.kind)
  for (const line of bootLines(t.kind)) child.stdin?.write(line + eol)
  child.stdin?.write(probeLine(t.kind, marker) + eol)
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
 * En la consola real no hace falta: habla UTF-8.
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

  const line = command.replace(/\r?\n$/, '') + '\r'
  if (t.pty) {
    t.pty.write(line)
    return true
  }
  if (t.bridge) {
    t.bridge.write(line)
    return true
  }
  const eol = pipeEol(t.kind)
  t.child?.stdin?.write(encodePipeCommand(t.kind, command) + eol)
  t.child?.stdin?.write(probeLine(t.kind, t.marker!) + eol)
  return true
}

/** Escritura cruda: lo que teclea el usuario, tal cual, incluidas las teclas. */
export function writeTerm(id: string, data: string): boolean {
  const t = terms.get(id)
  if (!t || !t.alive) return false
  if (t.pty) t.pty.write(data)
  else if (t.bridge) t.bridge.write(data)
  else t.child?.stdin?.write(data)
  return true
}

export function resizeTerm(id: string, cols: number, rows: number): boolean {
  const t = terms.get(id)
  if (!t || !t.alive) return false
  t.cols = Math.max(20, Math.floor(cols))
  t.rows = Math.max(5, Math.floor(rows))
  if (t.pty) {
    try {
      t.pty.resize(t.cols, t.rows)
    } catch {
      // Si la consola ya se cerró, no hay nada que redimensionar.
    }
  } else if (t.bridge) {
    t.bridge.resize(t.cols, t.rows)
  }
  return true
}

/**
 * Ctrl+C. En una consola real es el carácter 0x03 de verdad, que es lo que
 * espera cualquier programa. En el respaldo no hay consola a la que
 * señalizar, así que se matan los procesos hijos de la shell y se deja la
 * shell viva.
 */
export function interruptTerm(id: string): Promise<boolean> {
  const t = terms.get(id)
  if (!t || !t.alive) return Promise.resolve(false)

  if (t.pty) {
    t.pty.write('\u0003')
    return Promise.resolve(true)
  }
  if (t.bridge) {
    t.bridge.write('\u0003')
    return Promise.resolve(true)
  }

  const pid = t.child?.pid
  if (!pid) return Promise.resolve(false)

  if (!IS_WIN) {
    // Sin consola la shell no tiene control de trabajos: el Ctrl+C se manda
    // a sus hijos, que son los que están trabajando. La shell sigue viva y
    // su sonda cierra el bloque en cuanto el comando cae.
    return new Promise((resolve) => {
      execFile('pkill', ['-INT', '-P', String(pid)], { timeout: 4000 }, () => resolve(true))
    })
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
  } else if (t.bridge) {
    t.bridge.kill()
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
    // /etc/shells es la lista oficial de shells de inicio de sesión: ahí se
    // apuntan también las de Homebrew o las que instala el gestor de paquetes.
    let listed: string[] = []
    try {
      listed = readFileSync('/etc/shells', 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('/'))
    } catch {
      // Sin la lista, las de siempre.
    }
    // Las de Homebrew no siempre se apuntan en /etc/shells: también se
    // buscan en el PATH, que ya es el de la shell del usuario.
    const inPath = ['zsh', 'bash', 'fish'].map((n) => findInPath(n)).filter((p): p is string => Boolean(p))
    const candidates = [userShell(), ...listed, ...inPath, '/bin/zsh', '/bin/bash', '/bin/sh']
    const seen = new Set<string>()
    for (const p of candidates) {
      const name = shellName(p)
      // Las variantes restringidas o de rescate no son para una terminal normal.
      if (/^(rbash|nologin|false|git-shell|screen|tmux)$/.test(name)) continue
      if (seen.has(p) || !existsSync(p)) continue
      seen.add(p)
      out.push({ path: p, label: `${name} · ${p}` })
    }
  }
  return out
}
