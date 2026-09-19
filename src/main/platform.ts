/**
 * Lo que cambia de un sistema a otro, en un solo sitio.
 *
 * La app nació en Windows y ahí sigue haciendo lo mismo que antes; macOS y
 * Linux comparten casi todo lo demás (shell POSIX, señales, grupos de
 * procesos), así que la mayoría de las ramas son «Windows o el resto».
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'

/** El nombre del sistema tal y como se le cuenta a un modelo. */
export function osName(): string {
  return IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'
}

/**
 * La terminal externa de cada sistema, si no se ha elegido otra en Ajustes:
 * Windows Terminal, la app Terminal de macOS y, en Linux, la que tenga el
 * escritorio (se busca al abrirla).
 */
export function defaultTerminalCommand(): string {
  if (IS_WIN) return 'wt'
  if (IS_MAC) return 'Terminal'
  return ''
}

/**
 * Busca un ejecutable en el PATH sin lanzar ningún proceso.
 *
 * En Windows también prueba las extensiones de PATHEXT, que es como `where`
 * encuentra `claude.cmd` cuando se le pide `claude`.
 */
export function findInPath(cmd: string): string | undefined {
  if (!cmd) return undefined
  const exts = IS_WIN ? ['', ...(process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())] : ['']
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, cmd + ext)
      try {
        if (!statSync(full).isFile()) continue
        if (!IS_WIN) accessSync(full, constants.X_OK)
        return full
      } catch {
        // No está aquí o no se puede ejecutar: el siguiente.
      }
    }
  }
  return undefined
}

/**
 * Mata un proceso y todo lo que haya lanzado.
 *
 * En Windows lo hace `taskkill /T`. En macOS y Linux se manda la señal al
 * grupo entero, que existe si el proceso se lanzó con `detached: true`: un
 * CLI de npm, un `pnpm test` o un `cargo build` abren hijos propios, y matar
 * sólo al primero los dejaría huérfanos y trabajando.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (IS_WIN) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Ya había terminado.
    }
  }
}
