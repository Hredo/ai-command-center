/**
 * Escritura atómica de los ficheros de datos.
 *
 * `writeFileSync` sobre el fichero de verdad lo trunca primero y lo rellena
 * después: si la app se cierra, se va la luz o el disco se llena justo en
 * medio, queda a medias —o vacío— y con él el histórico entero, la
 * configuración o las claves. Aquí se escribe a un temporal en la misma
 * carpeta y después se renombra encima, que el sistema hace de golpe: o está
 * el fichero viejo entero o el nuevo entero, nunca un trozo.
 *
 * En Windows el renombrado puede fallar un instante con EPERM o EBUSY si
 * alguien tiene el fichero abierto (el antivirus que lo está mirando, el
 * indexador, OneDrive). Se reintenta unas pocas veces y, si sigue sin dejar,
 * se escribe directamente: perder la atomicidad en ese caso raro es mejor que
 * no guardar.
 */
import { renameSync, unlinkSync, writeFileSync, type WriteFileOptions } from 'node:fs'

const RETRIES = 5

/** Espera activa corta: esto corre en el proceso principal y es síncrono a propósito. */
function pause(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* nada: son milisegundos */
  }
}

export function writeFileAtomic(file: string, data: string | Buffer, options: WriteFileOptions = 'utf8'): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data, options)
  for (let i = 0; i <= RETRIES; i++) {
    try {
      renameSync(tmp, file)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && i < RETRIES) {
        pause(15 * (i + 1))
        continue
      }
      // Último recurso: escribir encima. Se borra el temporal para no dejar basura.
      try {
        writeFileSync(file, data, options)
      } finally {
        try {
          unlinkSync(tmp)
        } catch {
          /* ya no está */
        }
      }
      return
    }
  }
}
