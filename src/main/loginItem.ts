/**
 * Abrir la app al iniciar sesión, escondida en la bandeja: para que las
 * tareas programadas de la noche corran sin tener que acordarse de abrirla.
 *
 * Windows y macOS lo hacen con lo que trae Electron. Linux no tiene una
 * forma común salvo el estándar de autoarranque de freedesktop: un .desktop
 * en ~/.config/autostart que se crea al activarlo y se borra al quitarlo.
 * Sólo en la app instalada: en desarrollo se registraría el Electron suelto.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IS_LINUX, IS_MAC, IS_WIN } from './platform'
import type { LoginItemStatus } from '@shared/types'

const HIDDEN = '--hidden'

function linuxFile(): string {
  const base = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config')
  return join(base, 'autostart', 'ai-command-center.desktop')
}

/** Una ruta para la línea Exec de un .desktop: entre comillas y con lo especial escapado. */
function desktopQuote(p: string): string {
  return `"${p.replace(/(["`$\\])/g, '\\$1')}"`
}

export function loginItemStatus(): LoginItemStatus {
  if (!app.isPackaged) return { supported: false, enabled: false, reason: 'dev' }
  if (IS_WIN) return { supported: true, enabled: app.getLoginItemSettings({ args: [HIDDEN] }).openAtLogin }
  if (IS_MAC) return { supported: true, enabled: app.getLoginItemSettings().openAtLogin }
  if (IS_LINUX) return { supported: true, enabled: existsSync(linuxFile()) }
  return { supported: false, enabled: false }
}

export function setLoginItem(enabled: boolean): LoginItemStatus {
  if (!app.isPackaged) return loginItemStatus()
  if (IS_WIN) {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN] })
  } else if (IS_MAC) {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } else if (IS_LINUX) {
    const file = linuxFile()
    if (enabled) {
      // Una AppImage se mueve de sitio: lo que hay que arrancar es ella, no lo que desempaqueta.
      const exec = process.env['APPIMAGE'] || process.execPath
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(
        file,
        [
          '[Desktop Entry]',
          'Type=Application',
          'Name=AI Command Center',
          'Comment=Arranca en la bandeja para las tareas programadas',
          `Exec=${desktopQuote(exec)} ${HIDDEN}`,
          'Terminal=false',
          'X-GNOME-Autostart-enabled=true',
          ''
        ].join('\n'),
        'utf8'
      )
    } else {
      rmSync(file, { force: true })
    }
  }
  return loginItemStatus()
}

/** ¿La ha abierto el sistema al iniciar sesión? Entonces arranca en la bandeja. */
export function startedHidden(): boolean {
  if (process.argv.includes(HIDDEN)) return true
  if (IS_MAC && app.isPackaged) {
    try {
      return app.getLoginItemSettings().wasOpenedAtLogin === true
    } catch {
      return false
    }
  }
  return false
}
