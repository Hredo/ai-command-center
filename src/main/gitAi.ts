/**
 * Git con IA: el mensaje de un commit escrito por un modelo a partir del diff.
 *
 * Se lanza como cualquier otra ejecución (`runPrompt`): el gasto entra en el
 * histórico y cuentan los presupuestos. Conviene un modelo barato o local;
 * lo eliges tú y se recuerda.
 */
import { randomUUID } from 'node:crypto'
import { commitContext } from './git'
import { runPrompt } from './providers/run'
import type { RunRecord } from '@shared/types'

/** Quita lo que los modelos añaden alrededor aunque se les pida que no. */
export function cleanCommitMessage(raw: string): string {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fence = /^```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(t)
  if (fence) t = fence[1].trim()
  t = t.replace(/^(mensaje de commit|commit message)\s*:\s*/i, '').trim()
  if (/^(["'`]).*\1$/s.test(t)) t = t.slice(1, -1).trim()
  return t.replace(/\n{3,}/g, '\n\n')
}

export async function suggestCommitMessage(
  cwd: string,
  pick: { providerId: string; model: string },
  lang: 'es' | 'en' = 'es'
): Promise<{ message: string; run: RunRecord }> {
  const ctx = await commitContext(cwd)
  if (!ctx) throw new Error('Esta carpeta no es un repositorio de git')
  if (!ctx.diff.trim()) throw new Error('No hay cambios que confirmar: lo nuevo que git no sigue no entra en «Confirmar»')
  const language = lang === 'en' ? 'inglés' : 'español'
  const prompt = [
    'Escribe el mensaje de commit de git para estos cambios.',
    '',
    `- Sigue el estilo de los commits recientes del repositorio: idioma, prefijos (feat:, fix:…), mayúsculas y longitud. Si no hay commits, escríbelo en ${language}.`,
    '- Primera línea de 72 caracteres como mucho, que diga qué cambia.',
    '- Si hace falta, una línea en blanco y un cuerpo breve con el porqué y lo importante. No listes cada fichero.',
    '- Devuelve sólo el mensaje: sin explicaciones, sin comillas y sin bloques de código.',
    '',
    ctx.subjects.length ? 'Commits recientes:\n' + ctx.subjects.map((s) => '- ' + s).join('\n') : 'El repositorio aún no tiene commits.',
    '',
    'Resumen de los cambios:',
    ctx.stat,
    '',
    'Diff' + (ctx.truncated ? ' (recortado: es muy largo)' : '') + ':',
    ctx.diff
  ].join('\n')

  const run = await runPrompt(
    {
      providerId: pick.providerId,
      model: pick.model,
      prompt,
      systemPrompt: 'Escribes mensajes de commit de git claros y concretos. Contestas sólo con el mensaje.',
      temperature: 0.2,
      maxTokens: 400,
      projectPath: cwd,
      kind: 'git'
    },
    () => undefined,
    randomUUID()
  )
  if (run.status === 'error') throw new Error(run.error || 'El modelo no contestó')
  const message = cleanCommitMessage(run.response ?? '')
  if (!message) throw new Error('El modelo devolvió un mensaje vacío')
  return { message, run }
}
