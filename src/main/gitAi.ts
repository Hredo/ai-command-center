/**
 * Git con IA: el mensaje de un commit escrito por un modelo a partir del diff.
 *
 * Se lanza como cualquier otra ejecución (`runPrompt`): el gasto entra en el
 * histórico y cuentan los presupuestos. Conviene un modelo barato o local;
 * lo eliges tú y se recuerda.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { commitContext } from './git'
import { runPrompt } from './providers/run'
import type { RunRecord } from '@shared/types'

/* ------------------------------------------------------------------ *
 * Revisión                                                           *
 * ------------------------------------------------------------------ */

export interface AiReviewResult {
  /** El diff que se revisó, tal cual (recortado si era enorme). */
  diff: string
  truncated: boolean
  summary: string
  comments: { file: string; line?: number; severity: 'error' | 'warning' | 'info'; comment: string }[]
  run: RunRecord
}

const MAX_REVIEW_DIFF = 60_000

function gitOut(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 30000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (_e, out) =>
      resolve(String(out ?? ''))
    )
  })
}

/** Lo que devuelve el modelo, como JSON aunque venga envuelto en texto o en un bloque de código. */
export function parseReview(raw: string): { summary: string; comments: AiReviewResult['comments'] } | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a === -1 || b <= a) return null
  let data: any
  try {
    data = JSON.parse(text.slice(a, b + 1))
  } catch {
    return null
  }
  const list = Array.isArray(data?.comments) ? data.comments : []
  const comments = list
    .filter((c: any) => c && typeof c.comment === 'string' && c.comment.trim() && typeof c.file === 'string')
    .slice(0, 60)
    .map((c: any) => ({
      file: String(c.file).replace(/^[ab]\//, '').trim(),
      line: Number.isFinite(Number(c.line)) && Number(c.line) > 0 ? Math.trunc(Number(c.line)) : undefined,
      severity: c.severity === 'error' || c.severity === 'warning' ? c.severity : 'info',
      comment: String(c.comment).trim()
    }))
  return { summary: typeof data?.summary === 'string' ? data.summary.trim() : '', comments }
}

/**
 * Un modelo revisa los cambios antes de confirmarlos (`commit`: lo que
 * confirmaría el panel) o antes de abrir la PR (`branch`: la rama contra su
 * base). Devuelve comentarios por fichero y línea; el diff va con ellos para
 * enseñarlos donde tocan.
 */
export async function reviewChanges(
  cwd: string,
  scope: 'commit' | 'branch',
  base: string | undefined,
  pick: { providerId: string; model: string },
  lang: 'es' | 'en' = 'es'
): Promise<AiReviewResult> {
  let diff = ''
  if (scope === 'commit') {
    // Lo mismo que confirmaría el panel (git commit -a): contra HEAD, o lo preparado si aún no hay commits.
    const head = (await gitOut(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).trim()
    diff = await gitOut(cwd, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-U3', head ? 'HEAD' : '--cached'])
  } else {
    const b = String(base ?? '').trim()
    if (!b || b.startsWith('-')) throw new Error('Falta la rama con la que comparar')
    const remote = await gitOut(cwd, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${b}`])
    diff = await gitOut(cwd, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-U3', `${remote.trim() ? 'origin/' + b : b}...HEAD`])
  }
  if (!diff.trim()) throw new Error(scope === 'commit' ? 'No hay cambios que revisar' : 'Esta rama no tiene cambios respecto a su base')
  const truncated = diff.length > MAX_REVIEW_DIFF
  if (truncated) diff = diff.slice(0, diff.lastIndexOf('\ndiff --git', MAX_REVIEW_DIFF) > 0 ? diff.lastIndexOf('\ndiff --git', MAX_REVIEW_DIFF) : MAX_REVIEW_DIFF)
  const language = lang === 'en' ? 'inglés' : 'español'
  const prompt = [
    'Revisa este diff como un buen revisor de código. Busca fallos reales: errores de lógica, casos que se rompen, datos que se pierden, seguridad, recursos que no se liberan, condiciones de carrera y cambios de comportamiento que no parecen queridos. No comentes estilo ni gustos salvo que causen un fallo. No inventes: si no lo ves en el diff, no lo digas.',
    '',
    'Devuelve sólo JSON, con esta forma exacta:',
    '{"summary": "una o dos frases con lo más importante", "comments": [{"file": "ruta/del/fichero", "line": 123, "severity": "error", "comment": "qué pasa y cómo arreglarlo"}]}',
    '- "line" es el número de línea en la versión nueva del fichero (la del lado +); si el problema está en una línea borrada, la nueva más cercana.',
    '- "severity": "error" si es un fallo, "warning" si es un riesgo, "info" si es una mejora que vale la pena.',
    '- Si no ves problemas, "comments": [].',
    `- Escribe en ${language}.`,
    '',
    'Diff' + (truncated ? ' (recortado: es muy largo, faltan los últimos ficheros)' : '') + ':',
    diff
  ].join('\n')
  const run = await runPrompt(
    {
      providerId: pick.providerId,
      model: pick.model,
      prompt,
      systemPrompt: 'Eres un revisor de código riguroso y concreto. Contestas sólo con el JSON que se te pide.',
      temperature: 0.1,
      maxTokens: 3000,
      projectPath: cwd,
      kind: 'git'
    },
    () => undefined,
    randomUUID()
  )
  if (run.status === 'error') throw new Error(run.error || 'El modelo no contestó')
  const parsed = parseReview(run.response ?? '')
  if (!parsed) throw new Error('El modelo no devolvió una revisión legible: ' + (run.response ?? '').slice(0, 200))
  return { diff, truncated, summary: parsed.summary, comments: parsed.comments, run }
}

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
