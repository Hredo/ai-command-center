/**
 * Pull requests y CI de GitHub, desde el proyecto.
 *
 * Todo pasa por `gh`, con su sesión: la app recibe las respuestas y nunca el
 * token. Se ven la PR de la rama en la que estás, las abiertas del
 * repositorio con el estado de su CI, las comprobaciones de una y las últimas
 * ejecuciones de Actions. Abrir una PR sube antes la rama si hace falta (se
 * dice en el diálogo) y la descripción la puede escribir un modelo.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ghPath, ghRun } from './github'
import { runPrompt } from './providers/run'
import type { PullCheck, PullSummary, PullsReport, RunRecord, WorkflowRun } from '@shared/types'

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }

function git(cwd: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: GIT_ENV }, (err, out, e) =>
      resolve({ ok: !err, out: String(out ?? ''), err: String(e ?? '').trim() })
    )
  })
}

const PR_FIELDS = 'number,title,url,state,isDraft,headRefName,baseRefName,author,updatedAt,reviewDecision,statusCheckRollup'

/** El estado de la CI de una PR, a partir de lo que devuelve GitHub para cada comprobación. */
export function summarizeChecks(rollup: unknown): PullSummary['checks'] {
  const out = { pass: 0, fail: 0, pending: 0, total: 0 }
  for (const c of Array.isArray(rollup) ? rollup : []) {
    out.total++
    const status = String(c?.status ?? '').toUpperCase()
    const conclusion = String(c?.conclusion ?? '').toUpperCase()
    const state = String(c?.state ?? '').toUpperCase()
    if (c?.__typename === 'StatusContext' || (state && !status)) {
      if (state === 'SUCCESS') out.pass++
      else if (state === 'FAILURE' || state === 'ERROR') out.fail++
      else out.pending++
      continue
    }
    if (status && status !== 'COMPLETED') out.pending++
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) out.pass++
    else out.fail++
  }
  return out
}

function toSummary(x: any): PullSummary {
  return {
    number: Number(x.number),
    title: String(x.title ?? ''),
    url: String(x.url ?? ''),
    state: (String(x.state ?? 'OPEN').toUpperCase() as PullSummary['state']) || 'OPEN',
    draft: Boolean(x.isDraft),
    head: String(x.headRefName ?? ''),
    base: String(x.baseRefName ?? ''),
    author: x.author?.login || undefined,
    updatedAt: Date.parse(x.updatedAt) || undefined,
    review: x.reviewDecision || undefined,
    checks: summarizeChecks(x.statusCheckRollup)
  }
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** Por qué no se puede hablar con GitHub, a partir de lo que dice `gh`. */
function ghProblem(err: string): Pick<PullsReport, 'gh' | 'github'> | null {
  const e = err.toLowerCase()
  if (/gh auth login|not logged|authentication/.test(e)) return { gh: 'noauth', github: true }
  if (/no git remotes|none of the git remotes|not a git repository|could not determine|no github remote/.test(e)) return { gh: 'ok', github: false }
  return null
}

/** La rama principal del repositorio: la que apunta `origin/HEAD`, o main/master. */
export async function defaultBase(cwd: string): Promise<string> {
  const head = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head.ok && head.out.trim()) return head.out.trim().replace(/^origin\//, '')
  for (const b of ['main', 'master']) {
    const r = await git(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${b}`])
    if (r.ok) return b
  }
  return 'main'
}

/** Si la rama hay que subirla antes de abrir su PR: sin rama remota o con commits sin subir. */
async function pushState(cwd: string): Promise<{ upstream: boolean; ahead: number }> {
  const up = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!up.ok || !up.out.trim()) return { upstream: false, ahead: 0 }
  const ahead = await git(cwd, ['rev-list', '--count', '@{u}..HEAD'])
  return { upstream: true, ahead: Number(ahead.out.trim()) || 0 }
}

export async function pullsReport(cwd: string): Promise<PullsReport> {
  if (!(await ghPath())) return { gh: 'missing', github: false, open: [], runs: [] }
  const branchR = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = branchR.ok ? branchR.out.trim() : undefined
  const [list, view, runs, base, push] = await Promise.all([
    ghRun(['pr', 'list', '--state', 'open', '--limit', '30', '--json', PR_FIELDS], { cwd, timeout: 30000 }),
    branch && branch !== 'HEAD' ? ghRun(['pr', 'view', '--json', PR_FIELDS], { cwd, timeout: 30000 }) : Promise.resolve(null),
    ghRun(
      ['run', 'list', '--limit', '10', ...(branch && branch !== 'HEAD' ? ['--branch', branch] : []), '--json', 'databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,createdAt,url'],
      { cwd, timeout: 30000 }
    ),
    defaultBase(cwd),
    pushState(cwd)
  ])
  if (!list.ok) {
    const problem = ghProblem(list.err)
    return { ...(problem ?? { gh: 'ok', github: true }), open: [], runs: [], branch, base, error: problem ? undefined : list.err || 'gh pr list falló' }
  }
  const open = (parseJson<any[]>(list.out) ?? []).map(toSummary)
  // Sin PR para esta rama, `gh pr view` falla con «no pull requests found»: no es un error.
  const current = view?.ok ? toSummary(parseJson<any>(view.out) ?? {}) : null
  const workflowRuns: WorkflowRun[] = runs.ok
    ? (parseJson<any[]>(runs.out) ?? []).map((r) => ({
        id: Number(r.databaseId),
        title: String(r.displayTitle ?? ''),
        workflow: String(r.workflowName ?? ''),
        status: String(r.status ?? ''),
        conclusion: r.conclusion || undefined,
        branch: r.headBranch || undefined,
        event: r.event || undefined,
        createdAt: Date.parse(r.createdAt) || 0,
        url: String(r.url ?? '')
      }))
    : []
  return {
    gh: 'ok',
    github: true,
    branch,
    base,
    current: current && current.number ? current : null,
    open,
    runs: workflowRuns,
    needsPush: !push.upstream || push.ahead > 0,
    upstream: push.upstream
  }
}

/** Las comprobaciones de una PR, una a una. */
export async function pullChecks(cwd: string, num: number): Promise<PullCheck[]> {
  const r = await ghRun(['pr', 'checks', String(Math.trunc(num)), '--json', 'name,state,bucket,link,workflow'], { cwd, timeout: 30000 })
  // `gh pr checks` sale con 8 si alguna está pendiente y con 1 si alguna falla, pero la lista la da igual.
  const rows = parseJson<any[]>(r.out)
  if (!rows) throw new Error(r.err || 'gh pr checks falló')
  return rows.map((c) => {
    const bucket = String(c.bucket ?? '').toLowerCase()
    const state: PullCheck['state'] =
      bucket === 'pass' ? 'pass' : bucket === 'fail' ? 'fail' : bucket === 'skipping' ? 'skipped' : bucket === 'cancel' ? 'cancel' : 'pending'
    return { name: String(c.name ?? ''), state, url: c.link || undefined, workflow: c.workflow || undefined }
  })
}

/**
 * Abre la PR de la rama actual. Si la rama no está subida (o tiene commits
 * sin subir), primero `git push -u origin HEAD`: lo has pedido tú al pulsar
 * y el diálogo lo dice antes.
 */
export async function createPull(
  cwd: string,
  input: { title: string; body: string; base: string; draft?: boolean }
): Promise<{ url: string; pushed: boolean }> {
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error('Falta el título de la PR')
  const base = String(input.base ?? '').trim()
  if (!base || base.startsWith('-')) throw new Error('Falta la rama de destino')
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
  if (!branch || branch === 'HEAD') throw new Error('No estás en ninguna rama (HEAD suelto)')
  if (branch === base) throw new Error(`Estás en ${base}: la PR sale de otra rama hacia ella`)

  const push = await pushState(cwd)
  let pushed = false
  if (!push.upstream || push.ahead > 0) {
    const r = await git(cwd, ['push', '-u', 'origin', 'HEAD'], 120000)
    if (!r.ok) throw new Error(`No se pudo subir la rama: ${r.err || 'git push falló'}`)
    pushed = true
  }

  // El cuerpo va en un fichero: sin comillas que escapar ni límites de la línea de órdenes.
  const dir = mkdtempSync(join(tmpdir(), 'acc-pr-'))
  const bodyFile = join(dir, 'cuerpo.md')
  writeFileSync(bodyFile, String(input.body ?? ''), 'utf8')
  try {
    const args = ['pr', 'create', '--title', title, '--body-file', bodyFile, '--base', base, '--head', branch]
    if (input.draft) args.push('--draft')
    const r = await ghRun(args, { cwd, timeout: 60000 })
    if (!r.ok) throw new Error(r.err || 'gh pr create falló')
    const url = r.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).pop()
    if (!url) throw new Error('GitHub no devolvió el enlace de la PR')
    return { url, pushed }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Título y descripción de la PR escritos por un modelo a partir de sus commits y su diff. */
export async function describePull(
  cwd: string,
  base: string,
  pick: { providerId: string; model: string },
  lang: 'es' | 'en' = 'es'
): Promise<{ title: string; body: string; run: RunRecord }> {
  // Contra la rama remota si está (es con la que se compara la PR), si no, la local.
  const remote = await git(cwd, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${base}`])
  const ref = remote.ok ? `origin/${base}` : base
  const [log, stat, diff] = await Promise.all([
    git(cwd, ['log', '--format=- %s%n%b', `${ref}..HEAD`]),
    git(cwd, ['-c', 'core.quotePath=false', 'diff', '--stat=120', `${ref}...HEAD`]),
    git(cwd, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-U2', `${ref}...HEAD`], 30000)
  ])
  if (!log.out.trim() && !diff.out.trim()) throw new Error(`Esta rama no tiene cambios respecto a ${base}`)
  const MAX = 40_000
  const clipped = diff.out.length > MAX
  const language = lang === 'en' ? 'inglés' : 'español'
  const prompt = [
    `Escribe el título y la descripción de una pull request hacia ${base}, en ${language} salvo que los commits estén en otro idioma.`,
    '',
    'Formato exacto:',
    '- Primera línea: el título, de 72 caracteres como mucho, sin «#».',
    '- Una línea en blanco.',
    '- La descripción en Markdown: qué cambia y por qué, en pocas viñetas, y cómo probarlo si se deduce. No inventes nada que no esté en los cambios.',
    '',
    'Commits:',
    log.out.trim() || '(sin commits nuevos: cambios en el árbol)',
    '',
    'Resumen:',
    stat.out.trim(),
    '',
    'Diff' + (clipped ? ' (recortado)' : '') + ':',
    clipped ? diff.out.slice(0, MAX) : diff.out
  ].join('\n')
  const run = await runPrompt(
    {
      providerId: pick.providerId,
      model: pick.model,
      prompt,
      systemPrompt: 'Escribes descripciones de pull requests claras y fieles a los cambios. Contestas sólo con el título y la descripción.',
      temperature: 0.2,
      maxTokens: 1200,
      projectPath: cwd,
      kind: 'git'
    },
    () => undefined,
    randomUUID()
  )
  if (run.status === 'error') throw new Error(run.error || 'El modelo no contestó')
  const text = (run.response ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[\w-]*\n([\s\S]*?)\n```\s*$/, '$1')
    .trim()
  const [first, ...rest] = text.split('\n')
  const title = first.replace(/^#+\s*/, '').replace(/^(t[ií]tulo|title)\s*:\s*/i, '').replace(/^["'`]|["'`]$/g, '').trim()
  const body = rest.join('\n').replace(/^(descripci[oó]n|description)\s*:\s*/i, '').trim()
  if (!title) throw new Error('El modelo no devolvió un título')
  return { title, body, run }
}
