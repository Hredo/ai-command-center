/**
 * El entorno de la shell del usuario, fuera de Windows.
 *
 * En macOS una aplicación abierta desde el Dock o el Finder no hereda el
 * entorno de la terminal: su PATH se queda en /usr/bin:/bin:/usr/sbin:/sbin.
 * Ahí no están Homebrew (/opt/homebrew/bin) ni los globales de npm, pnpm o
 * nvm, que es justo donde viven claude, codex, opencode, gh u ollama: la app
 * no los encontraría aunque estén instalados. En Linux pasa lo mismo con lo
 * que se añade en .bashrc o .zshrc (nvm, por ejemplo) al abrirla desde el
 * menú del escritorio.
 *
 * Se hace lo mismo que VS Code: preguntarle a la shell de inicio de sesión del
 * usuario cuál es su PATH y juntarlo con el que ya hay. Y por si esa shell
 * tarda o se cuelga en su configuración, se añaden además las carpetas de
 * siempre que existan.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

const MARK = '__ACC_PATH__'

let loading: Promise<void> | null = null

/** La shell del usuario: la de $SHELL, la de su cuenta o la del sistema. */
export function userShell(): string {
  const fromEnv = process.env['SHELL']
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  try {
    const own = userInfo().shell
    if (own && existsSync(own)) return own
  } catch {
    // Sin entrada en /etc/passwd (contenedores): se sigue con el valor fijo.
  }
  if (process.platform === 'darwin') return '/bin/zsh'
  return existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'
}

/** Carpetas donde se instalan las herramientas aunque la shell no las diga. */
function wellKnownDirs(): string[] {
  const home = homedir()
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/home/linuxbrew/.linuxbrew/bin',
    '/snap/bin',
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.local', 'share', 'pnpm'),
    join(home, 'Library', 'pnpm'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, 'go', 'bin'),
    join(home, '.opencode', 'bin')
  ].filter((d) => existsSync(d))
}

/**
 * Lee el PATH de una shell interactiva y de inicio de sesión, que es la que
 * carga todo: /etc/profile, .zprofile, .zshrc, .bash_profile, .bashrc…
 *
 * Lo que imprima la configuración del usuario (un saludo, un aviso de
 * oh-my-zsh) se descarta: el PATH va entre dos marcas y sólo se lee lo de en
 * medio.
 */
function readLoginPath(timeoutMs: number): Promise<string | null> {
  const shell = userShell()
  const fish = /(^|\/)fish$/.test(shell)
  // En fish "$PATH" es una lista y entre comillas se une con espacios. En
  // bash y zsh van llaves: sin ellas, `$PATH__ACC_PATH__` sería otra variable.
  const script = fish ? `printf '%s' ${MARK}(string join : $PATH)${MARK}` : `printf '%s' "${MARK}\${PATH}${MARK}"`

  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (value: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(shell, ['-i', '-l', '-c', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        // Que oh-my-zsh no se ponga a actualizar ni tmux a abrirse solo.
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTARTED: 'true',
        ZSH_TMUX_AUTOSTART: 'false'
      },
      detached: true
    })
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Ya había terminado.
      }
      finish(null)
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.on('error', () => finish(null))
    child.on('close', () => {
      const m = out.match(new RegExp(`${MARK}([\\s\\S]*?)${MARK}`))
      finish(m ? m[1].trim() : null)
    })
  })
}

function merge(loginPath: string | null): void {
  const seen = new Set<string>()
  const out: string[] = []
  const parts = [
    ...(loginPath ?? '').split(':'),
    ...(process.env['PATH'] ?? '').split(':'),
    ...wellKnownDirs()
  ]
  for (const p of parts) {
    const dir = p.trim()
    if (dir && !seen.has(dir)) {
      seen.add(dir)
      out.push(dir)
    }
  }
  process.env['PATH'] = out.join(':')
}

/**
 * Un idioma con UTF-8 para lo que se lance desde la app.
 *
 * Una app de macOS abierta desde el Dock no trae LANG, y sin él Python, git o
 * la propia shell tratan «ñ» o «€» como bytes sueltos: zsh, por ejemplo, no
 * deja ni hacer `cd` a una carpeta con eñe. Terminal.app lo pone por su
 * cuenta; aquí se hace lo mismo, a partir del idioma del sistema. En Linux el
 * escritorio casi siempre lo trae; si no, C.UTF-8, que existe en todas las
 * distribuciones actuales.
 */
export function ensureUtf8Locale(systemLocale: string): void {
  if (process.platform === 'win32') return
  // LC_ALL manda sobre todo; si no, LC_CTYPE, que es el que decide los caracteres.
  const effective = process.env['LC_ALL'] || process.env['LC_CTYPE'] || process.env['LANG'] || ''
  if (/utf-?8/i.test(effective)) return
  if (process.platform === 'darwin') {
    const m = /^([a-z]{2})[-_]([A-Z]{2})/.exec(systemLocale || '')
    process.env['LANG'] = m ? `${m[1]}_${m[2]}.UTF-8` : 'en_US.UTF-8'
  } else {
    process.env['LANG'] = 'C.UTF-8'
  }
  // Un LC_ALL o LC_CTYPE sin UTF-8 taparía al LANG recién puesto.
  delete process.env['LC_ALL']
  delete process.env['LC_CTYPE']
}

/**
 * Completa el PATH con el de la shell del usuario. Se llama al arrancar, una
 * vez; las llamadas siguientes esperan a la primera. En Windows no hace nada:
 * ahí las aplicaciones sí heredan el PATH del usuario.
 */
export function loadShellEnv(timeoutMs = 6000): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  if (!loading) {
    loading = readLoginPath(timeoutMs)
      .then(merge)
      .catch(() => merge(null))
  }
  return loading
}
