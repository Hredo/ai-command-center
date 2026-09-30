/**
 * Avisar a la ventana: el canal y lo que lleva tienen que estar en el
 * contrato (shared/ipcContract.ts, IpcEvents), igual que lo escucha el preload.
 */
import type { BrowserWindow } from 'electron'
import type { IpcEvent, IpcEvents } from '@shared/ipcContract'

export function emit<E extends IpcEvent>(win: BrowserWindow | null | undefined, channel: E, payload: IpcEvents[E]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}
