/**
 * El árbol de commits: quién viene de quién, qué ramas hay y qué se puede
 * hacer con ellas.
 *
 * Los carriles se calculan igual que en cualquier visor de git: se lleva una
 * lista de carriles ocupados, cada uno esperando un hash concreto. Cuando
 * aparece ese commit, ocupa el carril y pasa a esperar a su primer padre; los
 * demás padres (los merges) piden carril aparte. Con eso ya se sabe dónde va
 * cada punto, y las líneas se dibujan de hijo a padre porque las dos
 * posiciones están calculadas de antemano.
 *
 * Las acciones no pasan por la caja de comandos: cada botón dice qué quiere
 * hacer y el proceso principal arma la llamada a git. Las que reescriben
 * historia o pueden tirar trabajo preguntan antes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GitBranch, GitMerge, RefreshCw, Loader2, Check, X, AlertTriangle, Copy, Tag,
  Undo2, Play, SkipForward, Ban, GitCommitHorizontal, Scissors, RotateCcw, FileText
} from 'lucide-react'
import { Badge, Button, cx, Empty, Modal } from './ui'
import { relTime } from '../lib/format'
import type { GitGraph as Graph, GitInfo, GitOpName, GitOpParams, GitOpState, GraphCommit } from '@shared/types'
import { Pane } from './Resizable'

import { useT } from '../lib/i18n'
/* ------------------------------------------------------------------ *
 * Carriles                                                           *
 * ------------------------------------------------------------------ */

const ROW_H = 30
const LANE_W = 15
const DOT_R = 4.5

/** Un color por carril. Se repiten a partir del octavo, que ya es un lío. */
const LANE_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#60a5fa', '#f472b6', '#4ade80']

interface Row {
  commit: GraphCommit
  lane: number
}

interface Layout {
  rows: Row[]
  pos: Map<string, { row: number; lane: number }>
  lanes: number
}

function layout(commits: GraphCommit[]): Layout {
  /** Qué hash espera cada carril. `null` es carril libre. */
  const waiting: (string | null)[] = []
  const pos = new Map<string, { row: number; lane: number }>()
  const rows: Row[] = []
  let widest = 1

  commits.forEach((commit, i) => {
    let lane = waiting.indexOf(commit.hash)
    if (lane === -1) {
      lane = waiting.indexOf(null)
      if (lane === -1) {
        lane = waiting.length
        waiting.push(null)
      }
    }

    // Si varios carriles esperaban este commit, confluyen aquí: los demás
    // quedan libres.
    for (let l = 0; l < waiting.length; l++) {
      if (l !== lane && waiting[l] === commit.hash) waiting[l] = null
    }

    waiting[lane] = commit.parents[0] ?? null
    for (const parent of commit.parents.slice(1)) {
      if (waiting.includes(parent)) continue
      let free = waiting.indexOf(null)
      if (free === -1) {
        free = waiting.length
        waiting.push(null)
      }
      waiting[free] = parent
    }

    // Los carriles del final que ya no esperan a nadie no cuentan para el ancho.
    while (waiting.length && waiting[waiting.length - 1] === null) waiting.pop()
    widest = Math.max(widest, waiting.length, lane + 1)

    pos.set(commit.hash, { row: i, lane })
    rows.push({ commit, lane })
  })

  return { rows, pos, lanes: Math.min(widest, 12) }
}

const laneX = (lane: number): number => 10 + Math.min(lane, 11) * LANE_W
const rowY = (row: number): number => row * ROW_H + ROW_H / 2

/** Las líneas que unen cada commit con sus padres. */
function Edges({ data }: { data: Layout }): React.JSX.Element {
  const paths: React.JSX.Element[] = []
  const bottom = data.rows.length * ROW_H

  data.rows.forEach(({ commit, lane }, row) => {
    const x1 = laneX(lane)
    const y1 = rowY(row)

    commit.parents.forEach((parent, n) => {
      const target = data.pos.get(parent)
      const color = LANE_COLORS[(target ? target.lane : lane + n) % LANE_COLORS.length]

      if (!target) {
        // El padre se quedó fuera de lo que hemos pedido: se deja la línea
        // abierta hacia abajo en vez de fingir que la historia acaba aquí.
        paths.push(
          <path
            key={`${commit.hash}-${parent}`}
            d={`M ${x1} ${y1} V ${bottom}`}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
            opacity={0.35}
          />
        )
        return
      }

      const x2 = laneX(target.lane)
      const y2 = rowY(target.row)
      const d =
        x1 === x2
          ? `M ${x1} ${y1} V ${y2}`
          : // Baja por su carril y gira justo encima del padre.
            `M ${x1} ${y1} V ${y2 - ROW_H / 2} Q ${x1} ${y2} ${x2} ${y2}`

      paths.push(
        <path key={`${commit.hash}-${parent}`} d={d} stroke={color} strokeWidth={1.5} fill="none" opacity={0.75} />
      )
    })
  })

  return <>{paths}</>
}

/* ------------------------------------------------------------------ *
 * Etiquetas de rama                                                  *
 * ------------------------------------------------------------------ */

function RefBadge({ name, kind }: { name: string; kind: GraphCommit['refs'][number]['kind'] }): React.JSX.Element {
  const t = useT()
  const tone = kind === 'head' ? 'ok' : kind === 'tag' ? 'warn' : kind === 'remote' ? 'neutral' : 'violet'
  const icon = kind === 'tag' ? <Tag size={9} /> : <GitBranch size={9} />
  return (
    <Badge
      tone={tone as 'ok' | 'warn' | 'neutral' | 'violet'}
      title={kind === 'remote' ? t('rama remota') : kind === 'tag' ? t('etiqueta') : t('rama local')}
    >
      {icon}
      <span className="font-mono max-w-[180px] truncate">{name}</span>
    </Badge>
  )
}

/* ------------------------------------------------------------------ *
 * Panel                                                              *
 * ------------------------------------------------------------------ */

interface Pending {
  op: GitOpName
  params: GitOpParams
  title: string
  detail: string
  danger?: boolean
}

export function GitGraph({
  path,
  info,
  onToast,
  onOpenFile
}: {
  path: string
  info: GitInfo | null
  onToast?: (tone: 'ok' | 'error', msg: string) => void
  onOpenFile?: (file: string) => void
}): React.JSX.Element {
  const t = useT()
  const [graph, setGraph] = useState<Graph | null>(null)
  const [state, setState] = useState<GitOpState | null>(null)
  const [limit, setLimit] = useState(120)
  const [all, setAll] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [patch, setPatch] = useState<{ hash: string; text: string } | null>(null)
  const [newBranch, setNewBranch] = useState('')
  const [newTag, setNewTag] = useState('')
  const seq = useRef(0)

  const load = useCallback(() => {
    const mine = ++seq.current
    void window.api.git.graph(path, limit, all).then((r) => {
      if (mine !== seq.current) return
      setGraph(r.ok && r.data ? r.data : null)
    })
    void window.api.git.state(path).then((r) => {
      if (mine !== seq.current) return
      setState(r.ok && r.data ? r.data : null)
    })
  }, [path, limit, all])

  useEffect(load, [load])

  // En vivo: el vigilante avisa de cualquier commit, cambio de rama o merge
  // a medias, venga de esta ventana o de una terminal de fuera.
  useEffect(() => {
    // La vigilancia se cuenta por suscriptor, así que pedirla aquí también no
    // duplica nada y hace que el árbol funcione solo aunque se abra fuera de
    // la pantalla de proyectos.
    void window.api.git.watch(path)
    const off = window.api.git.onChanged((e) => {
      if (e.path !== path) return
      setState(e.state)
      load()
    })
    return () => {
      off()
      void window.api.git.unwatch(path)
    }
  }, [path, load])

  const data = useMemo(() => layout(graph?.commits ?? []), [graph])
  const current = graph?.branch
  const chosen = useMemo(
    () => data.rows.find((r) => r.commit.hash === selected)?.commit ?? null,
    [data, selected]
  )

  /** La referencia con la que trabajar: mejor el nombre de la rama que el hash. */
  const targetRef = (c: GraphCommit): string => {
    const local = c.refs.find((r) => r.kind === 'local' || (r.kind === 'head' && r.name !== 'HEAD'))
    return local?.name ?? c.hash
  }

  const run = useCallback(
    async (op: GitOpName, params: GitOpParams, label: string): Promise<void> => {
      setBusy(label)
      const r = await window.api.git.op(path, op, params)
      setBusy(null)
      const res = r.data
      if (!r.ok || !res) {
        onToast?.('error', r.error ?? t('no se pudo ejecutar'))
      } else if (res.refused) {
        onToast?.('error', res.refused)
      } else if (!res.ok) {
        // git explica bien sus fallos (conflictos, rama sin upstream…): se
        // enseña su primera línea tal cual.
        onToast?.('error', (res.err || res.out || t('git falló')).split('\n').filter(Boolean)[0] ?? 'git falló')
      } else {
        onToast?.('ok', `${label} listo`)
      }
      load()
    },
    [path, onToast, load]
  )

  const ask = (p: Pending): void => setPending(p)

  const openPatch = async (hash: string): Promise<void> => {
    const r = await window.api.git.show(path, hash)
    setPatch({ hash, text: r.ok && r.data ? r.data : t('(no se pudo leer el commit)') })
  }

  if (!info?.repo) {
    return (
      <div className="p-5">
        <Empty
          icon={<GitBranch size={26} />}
          title={t('Aquí no hay repositorio')}
          hint={t('El árbol necesita un repositorio de git en la carpeta del proyecto.')}
        />
      </div>
    )
  }

  const dirty = info.dirty + info.staged + info.untracked

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ------------------------------------------------- Cabecera */}
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-[12px] font-medium">{t('Árbol')}</span>
        <Badge tone="violet">
          <GitBranch size={10} />
          <span className="font-mono">{current ?? `HEAD ${info.head ?? ''}`}</span>
        </Badge>
        {dirty ? (
          <Badge
            tone="warn"
            title={t('git.counts', {
              staged: info.staged,
              dirty: info.dirty,
              untracked: info.untracked
            })}
          >
            {t('git.uncommitted', { n: dirty })}
          </Badge>
        ) : (
          <Badge tone="ok">{t('árbol limpio')}</Badge>
        )}
        {state?.stashes ? <Badge tone="neutral">{t('git.stashed', { n: state.stashes })}</Badge> : null}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setAll((v) => !v)}
            className={cx(
              'px-2 py-1 rounded-md border text-[11px] transition-colors',
              all ? 'bg-[#082a31] text-accent border-[#12525f]' : 'bg-raised text-dim border-line hover:text-muted'
            )}
            title={t('Ver todas las ramas o sólo la actual')}
          >
            {all ? t('todas las ramas') : t('sólo esta rama')}
          </button>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-raised border border-line rounded-md px-1.5 py-1 text-[11px] num outline-none"
            title={t('Cuántos commits se piden')}
          >
            {[60, 120, 250, 500].map((n) => (
              <option key={n} value={n}>
                {n} commits
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={load} title={t('Releer')}>
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>

      {/* --------------------------------- Operación a medias */}
      {state && state.operation !== 'none' ? (
        <div className="px-4 py-2.5 bg-[#241a09] border-b border-[#4a3512] flex items-start gap-2.5 shrink-0">
          <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-warn">
              {state.detail ?? state.operation}
              {state.step && state.total ? (
                <span className="num text-dim ml-1.5">
                  {state.step} de {state.total}
                </span>
              ) : null}
            </div>
            {state.conflicts.length ? (
              <div className="mt-1.5 space-y-0.5">
                <div className="text-[11px] text-dim">
                  {t('git.conflicts', { n: state.conflicts.length })}
                </div>
                {state.conflicts.slice(0, 12).map((f) => (
                  <button
                    key={f}
                    onClick={() => onOpenFile?.(f)}
                    disabled={!onOpenFile}
                    className={cx(
                      'block font-mono text-[11.5px] text-bad text-left truncate max-w-full',
                      onOpenFile ? 'hover:text-accent' : 'cursor-default'
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-dim mt-0.5">
                {t('No queda ningún conflicto: puedes continuar.')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="primary"
              disabled={Boolean(busy) || state.conflicts.length > 0}
              onClick={() => void run('continue', {}, 'continuar')}
              title={state.conflicts.length ? t('todavía hay conflictos sin resolver') : t('sigue con la operación')}
            >
              {busy === 'continuar' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Continuar
            </Button>
            {state.operation === 'rebase' ? (
              <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run('skip', {}, 'saltar')}>
                <SkipForward size={12} /> {t('Saltar')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              disabled={Boolean(busy)}
              onClick={() =>
                ask({
                  op: 'abort',
                  params: {},
                  title: t('Abortar la operación'),
                  detail: t('git.abortDetail', { op: state.operation }),
                  danger: true
                })
              }
            >
              <Ban size={12} /> {t('Abortar')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------- El árbol */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-auto">
          {!graph ? (
            <div className="p-5 text-[12.5px] text-dim">{t('Leyendo el árbol…')}</div>
          ) : data.rows.length === 0 ? (
            <div className="p-5 text-[12.5px] text-dim">{t('Todavía no hay ningún commit.')}</div>
          ) : (
            <div className="relative" style={{ minHeight: data.rows.length * ROW_H }}>
              <svg
                className="absolute left-0 top-0 pointer-events-none"
                width={data.lanes * LANE_W + 20}
                height={data.rows.length * ROW_H}
              >
                <Edges data={data} />
                {data.rows.map(({ commit, lane }, i) => {
                  const isHead = commit.hash === graph.head
                  const color = LANE_COLORS[lane % LANE_COLORS.length]
                  return (
                    <circle
                      key={commit.hash}
                      cx={laneX(lane)}
                      cy={rowY(i)}
                      r={commit.parents.length > 1 ? DOT_R + 1 : DOT_R}
                      fill={isHead ? color : '#0f1117'}
                      stroke={color}
                      strokeWidth={2}
                    />
                  )
                })}
              </svg>

              <div style={{ paddingLeft: data.lanes * LANE_W + 22 }}>
                {data.rows.map(({ commit }) => (
                  <button
                    key={commit.hash}
                    onClick={() => setSelected((s) => (s === commit.hash ? null : commit.hash))}
                    onDoubleClick={() => void openPatch(commit.hash)}
                    className={cx(
                      'w-full flex items-center gap-2 pr-4 text-[12px] text-left transition-colors',
                      selected === commit.hash ? 'bg-[#0e1725]' : 'hover:bg-raised'
                    )}
                    style={{ height: ROW_H }}
                  >
                    {commit.refs.map((r) => (
                      <RefBadge key={r.kind + r.name} name={r.name} kind={r.kind} />
                    ))}
                    <span className="truncate flex-1 min-w-0">{commit.subject}</span>
                    <span className="text-dim shrink-0 max-w-[140px] truncate">{commit.author}</span>
                    <span className="num text-dim shrink-0 w-[74px] text-right">{relTime(commit.at)}</span>
                    <span className="num text-accent shrink-0">{commit.short}</span>
                  </button>
                ))}
                {graph.truncated ? (
                  <div className="px-2 py-2 text-[11.5px] text-dim">
                    {t('Hay más historia por debajo: sube el número de commits si quieres verla.')}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------ Acciones del commit */}
        {chosen ? (
          <Pane paneKey="graph.detail" side="left" className="border-l border-line overflow-y-auto p-3 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="num text-accent text-[12.5px]">{chosen.short}</span>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(chosen.hash)
                    onToast?.('ok', 'Hash copiado')
                  }}
                  className="p-1 rounded text-dim hover:text-accent hover:bg-raised"
                  title={t('Copiar el hash completo')}
                >
                  <Copy size={11} />
                </button>
                <button onClick={() => setSelected(null)} className="ml-auto p-1 rounded text-dim hover:text-ink">
                  <X size={12} />
                </button>
              </div>
              <div className="text-[12.5px] leading-snug">{chosen.subject}</div>
              <div className="text-[11px] text-dim">
                {chosen.author} · {relTime(chosen.at)}
              </div>
              {chosen.refs.length ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {chosen.refs.map((r) => (
                    <RefBadge key={r.kind + r.name} name={r.name} kind={r.kind} />
                  ))}
                </div>
              ) : null}
            </div>

            <Button size="sm" className="w-full justify-center" onClick={() => void openPatch(chosen.hash)}>
              <FileText size={12} /> {t('Ver los cambios')}
            </Button>

            <div className="border-t border-line pt-3 space-y-1.5">
              <div className="text-[10.5px] uppercase tracking-wide text-dim">{t('Traer aquí')}</div>
              <Button
                size="sm"
                className="w-full justify-start"
                disabled={Boolean(busy) || chosen.hash === graph?.head}
                onClick={() =>
                  ask({
                    op: 'merge',
                    params: { ref: targetRef(chosen) },
                    title: `Merge de ${targetRef(chosen)}`,
                    detail: `Trae ${targetRef(chosen)} a ${current ?? t('la rama actual')}. Si los dos han tocado lo mismo, git parará con los conflictos y te los enseñará aquí.`
                  })
                }
              >
                <GitMerge size={12} /> {t('git.mergeInto', { branch: current ?? 'HEAD' })}
              </Button>
              <Button
                size="sm"
                className="w-full justify-start"
                disabled={Boolean(busy) || chosen.hash === graph?.head}
                onClick={() =>
                  ask({
                    op: 'rebase',
                    params: { ref: targetRef(chosen), autostash: true },
                    title: t('git.rebaseOnto', { ref: targetRef(chosen) }),
                    detail: t('git.rebaseDetail', {
                      from: current ?? t('la rama actual'),
                      onto: targetRef(chosen)
                    }),
                    danger: true
                  })
                }
              >
                <GitCommitHorizontal size={12} /> {t('Rebase sobre esto')}
              </Button>
              <Button
                size="sm"
                className="w-full justify-start"
                disabled={Boolean(busy)}
                onClick={() =>
                  ask({
                    op: 'cherry-pick',
                    params: { ref: chosen.hash },
                    title: 'Cherry-pick',
                    detail: `Copia sólo este commit encima de ${current ?? t('la rama actual')}.`
                  })
                }
              >
                <Scissors size={12} /> {t('Cherry-pick')}
              </Button>
              <Button
                size="sm"
                className="w-full justify-start"
                disabled={Boolean(busy)}
                onClick={() =>
                  ask({
                    op: 'revert',
                    params: { ref: chosen.hash },
                    title: t('Revertir'),
                    detail: t('Crea un commit nuevo que deshace lo que hizo este. No borra historia.')
                  })
                }
              >
                <Undo2 size={12} /> {t('Revertir')}
              </Button>
            </div>

            <div className="border-t border-line pt-3 space-y-1.5">
              <div className="text-[10.5px] uppercase tracking-wide text-dim">{t('Moverse')}</div>
              <Button
                size="sm"
                className="w-full justify-start"
                disabled={Boolean(busy)}
                onClick={() =>
                  ask({
                    op: 'checkout',
                    params: { ref: targetRef(chosen) },
                    title: `Ir a ${targetRef(chosen)}`,
                    detail:
                      targetRef(chosen) === chosen.hash
                        ? t('Este commit no tiene rama, así que quedarás con el HEAD suelto: haz una rama antes de cometer nada.')
                        : t('Cambia la copia de trabajo a esa rama.')
                  })
                }
              >
                <Play size={12} /> {t('Ir aquí')}
              </Button>
              <div className="flex items-center gap-1.5">
                <input
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newBranch.trim()) {
                      void run('branch', { name: newBranch.trim(), ref: chosen.hash }, t('rama nueva')).then(() =>
                        setNewBranch('')
                      )
                    }
                  }}
                  placeholder={t('rama nueva aquí…')}
                  className="flex-1 min-w-0 bg-void border border-line rounded px-2 py-1 text-[11.5px] font-mono outline-none focus:border-[#2c3346]"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!newBranch.trim() || Boolean(busy)}
                  onClick={() =>
                    void run('branch', { name: newBranch.trim(), ref: chosen.hash }, t('rama nueva')).then(() =>
                      setNewBranch('')
                    )
                  }
                >
                  <GitBranch size={11} />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTag.trim()) {
                      void run('tag', { name: newTag.trim(), ref: chosen.hash }, 'etiqueta').then(() => setNewTag(''))
                    }
                  }}
                  placeholder={t('etiqueta aquí…')}
                  className="flex-1 min-w-0 bg-void border border-line rounded px-2 py-1 text-[11.5px] font-mono outline-none focus:border-[#2c3346]"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!newTag.trim() || Boolean(busy)}
                  onClick={() => void run('tag', { name: newTag.trim(), ref: chosen.hash }, 'etiqueta').then(() => setNewTag(''))}
                >
                  <Tag size={11} />
                </Button>
              </div>
            </div>

            <div className="border-t border-line pt-3 space-y-1.5">
              <div className="text-[10.5px] uppercase tracking-wide text-dim">{t('Deshacer')}</div>
              <Button
                size="sm"
                className="w-full justify-start"
                disabled={Boolean(busy)}
                onClick={() =>
                  ask({
                    op: 'reset',
                    params: { ref: chosen.hash, mode: 'mixed' },
                    title: t('Mover la rama a este commit'),
                    detail: t(
                      'La rama actual vuelve a este punto. Los cambios de los commits posteriores se quedan en la carpeta sin confirmar, así que no se pierde nada.'
                    ),
                    danger: true
                  })
                }
              >
                <RotateCcw size={12} /> {t('Volver aquí, conservando los cambios')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                className="w-full justify-start"
                disabled={Boolean(busy)}
                onClick={() =>
                  ask({
                    op: 'reset',
                    params: { ref: chosen.hash, mode: 'hard' },
                    title: t('Volver aquí y tirar el resto'),
                    detail: t(
                      'La rama vuelve a este commit y se borra todo lo posterior, incluidos los cambios sin confirmar. Esto no se puede deshacer desde aquí.'
                    ),
                    danger: true
                  })
                }
              >
                <AlertTriangle size={12} /> {t('Volver aquí y tirar lo demás')}
              </Button>
            </div>

            {chosen.refs.some((r) => r.kind === 'local') && current !== targetRef(chosen) ? (
              <div className="border-t border-line pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start text-bad"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    ask({
                      op: 'branch-delete',
                      params: { name: targetRef(chosen) },
                      title: t('git.deleteBranch', { name: targetRef(chosen) }),
                      detail: t(
                        'Sólo borra la etiqueta local. Si tiene commits sin fusionar, git se negará y te lo dirá.'
                      ),
                      danger: true
                    })
                  }
                >
                  <X size={12} /> {t('git.deleteBranch', { name: targetRef(chosen) })}
                </Button>
              </div>
            ) : null}
          </Pane>
        ) : (
          <Pane paneKey="graph.detail" side="left" className="border-l border-line p-3">
            <div className="text-[11.5px] text-dim leading-relaxed">
              {t('Pincha un commit para hacer merge, rebase, cherry-pick, ramas o etiquetas desde él. Doble clic para ver sus cambios.')}
            </div>
            {info.behind || info.ahead ? (
              <div className="mt-3 space-y-1.5">
                {info.behind ? (
                  <Button
                    size="sm"
                    className="w-full justify-start"
                    disabled={Boolean(busy)}
                    onClick={() => void run('pull', {}, 'pull')}
                  >
                    {t('git.pullN', { n: info.behind, from: info.upstream ?? 'origin' })}
                  </Button>
                ) : null}
                {info.ahead ? (
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full justify-start"
                    disabled={Boolean(busy)}
                    onClick={() => void run('push', { setUpstream: !info.upstream }, 'push')}
                  >
                    {t('graph.pushAhead', { n: info.ahead })}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Pane>
        )}
      </div>

      {/* ------------------------------------------------ Confirmar */}
      <Modal open={Boolean(pending)} onClose={() => setPending(null)} title={pending?.title ?? ''} width="max-w-lg">
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted leading-relaxed">{pending?.detail}</p>
          {pending && dirty > 0 && ['merge', 'rebase', 'checkout', 'cherry-pick'].includes(pending.op) ? (
            <p className="text-[12px] text-warn leading-relaxed">
              Tienes {dirty} cambio{dirty === 1 ? '' : 's'} sin confirmar. Git se negará si estorban; puedes
              guardarlos en el stash desde el panel de Git.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant={pending?.danger ? 'danger' : 'primary'}
              onClick={() => {
                const p = pending
                setPending(null)
                if (p) void run(p.op, p.params, p.title.toLowerCase())
              }}
            >
              <Check size={12} /> {t('Hacerlo')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* --------------------------------------- Parche del commit */}
      <Modal open={Boolean(patch)} onClose={() => setPatch(null)} title={`Commit ${patch?.hash.slice(0, 8) ?? ''}`} width="max-w-4xl">
        <pre className="bg-[#07080c] border border-line rounded p-3 font-mono text-[11.5px] leading-[1.5] whitespace-pre max-h-[60vh] overflow-auto m-0">
          {(patch?.text ?? '').split('\n').map((l, i) => (
            <div
              key={i}
              className={
                l.startsWith('+') && !l.startsWith('+++')
                  ? 'text-ok'
                  : l.startsWith('-') && !l.startsWith('---')
                    ? 'text-bad'
                    : l.startsWith('@@')
                      ? 'text-violet'
                      : 'text-muted'
              }
            >
              {l || ' '}
            </div>
          ))}
        </pre>
      </Modal>
    </div>
  )
}
