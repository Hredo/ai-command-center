/**
 * Pasar una batería de prompts por la Arena.
 *
 * Cada caso se lanza en la Arena con los contendientes que tengas puestos
 * (y, si hay proyecto, cada uno en su worktree, con las pruebas del repo al
 * acabar). De cada respuesta se comprueba lo que pida el caso y sale una
 * matriz: caso por contendiente, aprobado o no, con coste y tiempo.
 *
 * El juez local da su nota con la rúbrica del caso. Se guarda como lo que es:
 * la opinión de ese modelo.
 */
import type { Battery, BatteryCell, BatteryCheck, BatteryCheckResult, BatteryRun } from '@shared/types'
import { launchArena, peekArenaState, setArena, uid, type Contender } from './engine'

/** Lo que parezca JSON dentro de la respuesta: tal cual o dentro de un bloque ```json. */
function extractJson(text: string): unknown {
  const t = text.trim()
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(t)
  const candidate = fenced ? fenced[1] : t
  return JSON.parse(candidate)
}

/** Las comprobaciones que no necesitan a nadie más: texto, expresión regular, JSON y pruebas. */
export function checkResponse(check: BatteryCheck, response: string, tests?: { ok: boolean }): BatteryCheckResult {
  const base = { checkId: check.id, kind: check.kind }
  const v = check.value ?? ''
  switch (check.kind) {
    case 'contains':
      return { ...base, pass: response.toLowerCase().includes(v.toLowerCase()), detail: response.toLowerCase().includes(v.toLowerCase()) ? undefined : `no contiene «${v}»` }
    case 'not_contains':
      return { ...base, pass: !response.toLowerCase().includes(v.toLowerCase()), detail: response.toLowerCase().includes(v.toLowerCase()) ? `contiene «${v}»` : undefined }
    case 'regex': {
      try {
        const m = /^\/(.*)\/([a-z]*)$/s.exec(v)
        const re = m ? new RegExp(m[1], m[2]) : new RegExp(v)
        const pass = re.test(response)
        return { ...base, pass, detail: pass ? undefined : `no casa con ${v}` }
      } catch (err) {
        return { ...base, pass: false, detail: `expresión no válida: ${(err as Error).message}` }
      }
    }
    case 'json': {
      try {
        extractJson(response)
        return { ...base, pass: true }
      } catch {
        return { ...base, pass: false, detail: 'no es JSON válido' }
      }
    }
    case 'tests':
      if (!tests) return { ...base, pass: false, detail: 'sin pruebas: hace falta la Arena de código con orden de pruebas' }
      return { ...base, pass: tests.ok, detail: tests.ok ? undefined : 'las pruebas fallan' }
    case 'judge':
      return { ...base, pass: false, detail: 'sin juez' }
  }
}

export interface BatteryProgress {
  caseIndex: number
  total: number
}

/**
 * Pasa la batería entera. `names` pone nombre a cada contendiente (como en la
 * Arena); `shouldStop` se consulta entre casos.
 */
export async function runBattery(
  battery: Battery,
  opts: {
    names: (c: Contender) => string
    onProgress?: (p: BatteryProgress) => void
    shouldStop?: () => boolean
  }
): Promise<BatteryRun> {
  const start = peekArenaState()
  const usable = start.contenders.filter((c) => (c.mode === 'api' ? c.providerId && c.model : c.cliAgentId))
  const run: BatteryRun = {
    id: uid(),
    batteryId: battery.id,
    batteryName: battery.name,
    at: Date.now(),
    contenders: usable.map((c) => ({ key: c.key, label: opts.names(c) })),
    cells: [],
    judgeModel: battery.judgeModel
  }
  const labels = Object.fromEntries(usable.map((c) => [c.key, opts.names(c)]))

  for (let i = 0; i < battery.cases.length; i++) {
    if (opts.shouldStop?.()) {
      run.stopped = true
      break
    }
    const kase = battery.cases[i]
    opts.onProgress?.({ caseIndex: i, total: battery.cases.length })
    setArena({ prompt: kase.prompt })
    await launchArena(labels)
    const st = peekArenaState()
    for (const c of st.contenders) {
      if (!c.runId || !run.contenders.some((x) => x.key === c.key)) continue
      const response = c.run?.response ?? c.content ?? ''
      const checks: BatteryCheckResult[] = []
      for (const check of kase.checks) {
        if (check.kind !== 'judge') {
          checks.push(checkResponse(check, response, c.tests))
          continue
        }
        if (!battery.judgeModel) {
          checks.push({ checkId: check.id, kind: 'judge', pass: false, detail: 'sin juez elegido' })
          continue
        }
        if (!response.trim()) {
          checks.push({ checkId: check.id, kind: 'judge', pass: false, detail: 'respuesta vacía' })
          continue
        }
        const r = await window.api.batteries.judge(battery.judgeModel, { rubric: check.value ?? '', prompt: kase.prompt, response })
        if (r.ok && r.data) {
          const min = Math.min(10, Math.max(1, check.min ?? 6))
          checks.push({ checkId: check.id, kind: 'judge', pass: r.data.score >= min, score: r.data.score, detail: r.data.reason })
        } else checks.push({ checkId: check.id, kind: 'judge', pass: false, detail: r.error ?? 'el juez falló' })
      }
      const cell: BatteryCell = {
        caseId: kase.id,
        contender: c.key,
        runId: c.run?.id ?? c.runId,
        ok: !c.error && checks.every((x) => x.pass),
        checks,
        cost: c.run?.costTotal ?? 0,
        ms: c.run?.totalMs ?? 0,
        error: c.error
      }
      run.cells.push(cell)
    }
    // En la Arena de código cada caso deja un worktree por contendiente: se quitan.
    if (st.project) {
      for (const c of st.contenders) {
        if (!c.worktreePath) continue
        await window.api.worktrees.remove(c.worktreePath, { force: true, deleteBranch: true })
      }
      setArena({ contenders: peekArenaState().contenders.map((c) => (c.worktreePath ? { ...c, outcome: 'removed' as const } : c)) })
    }
  }
  await window.api.batteries.saveRun(run)
  return run
}
