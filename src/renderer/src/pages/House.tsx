/**
 * La Casa.
 *
 * Una vista de la aplicación que no sirve para configurar nada: sirve para
 * mirar. Cada IA que la aplicación detecta —cada agente de consola, cada
 * modelo local, cada proveedor con llave— vive en esta casa. Cuando le mandas
 * trabajo se levanta y hace faena; cuando no, está en el sofá, en la piscina o
 * tirando a canasta.
 *
 * Si le mandas dos cosas a la vez al mismo, entra por la puerta otro vecino
 * idéntico para la segunda, y en cuanto esa tarea termina se marcha por donde
 * vino. Así, de un vistazo, se ve cuánto tienes en marcha y quién lo lleva.
 *
 * El dibujo es píxel a píxel sobre un lienzo, agrandado por un número entero:
 * no hay imágenes, ni nada generado fuera, ni dependencias nuevas.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { Home, Moon, Hammer, PauseCircle } from 'lucide-react'
import { useStore } from '../lib/store'
import { useArena, useOpenChats, useSessions } from '../lib/engine'
import { DollChip, HouseCanvas } from '../components/HouseCanvas'
import { lookOf, type Look } from '../lib/pixelArt'
import { emptyHouse, type HouseState, type Job, type Resident } from '../lib/house'
import { cx, Empty, Panel } from '../components/ui'
import { Pane } from '../components/Resizable'
import { useIsPageActive } from '../lib/pageActive'

import { useT } from '../lib/i18n'
/* ------------------------------------------------------------------ *
 * Quién vive aquí                                                    *
 * ------------------------------------------------------------------ */

/** Colores de los de siempre; los demás salen de la paleta por su nombre. */
const MARCAS: Record<string, string> = {
  anthropic: '#d97757',
  openai: '#19c37d',
  google: '#4285f4',
  deepseek: '#4d6bfe',
  mistral: '#fa520f',
  groq: '#f55036',
  xai: '#94a3b8',
  openrouter: '#6467f2',
  together: '#0f6fff',
  fireworks: '#ff5c8a',
  perplexity: '#20b8cd',
  cohere: '#39594d',
  ollama: '#a78bfa',
  lmstudio: '#7c6cf0',
  llamacpp: '#8fd3a0'
}

const PALETA = ['#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#60a5fa', '#f472b6', '#4ade80']

function colorDe(id: string): string {
  if (MARCAS[id]) return MARCAS[id]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETA[h % PALETA.length]
}

function tamano(bytes?: number): string | undefined {
  if (!bytes) return undefined
  const gb = bytes / 1e9
  return gb >= 1 ? gb.toFixed(1).replace('.', ',') + ' GB' : Math.round(bytes / 1e6) + ' MB'
}

/**
 * La lista de vecinos sale de lo que la aplicación ya sabe: los agentes de
 * consola que encontró en el sistema, los modelos que corren en esta máquina y
 * los proveedores de fuera que tienen llave. Uno de cada, ni más ni menos: si
 * no lo tienes, no vive aquí.
 */
function useResidents(): Resident[] {
  const { config, models, status } = useStore()
  const t = useT()
  return useMemo(() => {
    const out: Resident[] = []

    for (const a of config?.cliAgents ?? []) {
      out.push({
        id: 'cli:' + a.id,
        name: a.name,
        kind: 'cli',
        color: a.color || colorDe(a.id),
        detail: t('agente de consola') + ' · ' + a.command
      })
    }

    for (const m of models) {
      if (!m.local) continue
      out.push({
        id: 'local:' + m.providerId + ':' + m.id,
        name: m.name,
        kind: 'local',
        color: colorDe(m.providerId),
        detail: [t('modelo local'), m.providerId, tamano(m.sizeBytes)].filter(Boolean).join(' · ')
      })
    }

    for (const s of status) {
      if (s.local) continue
      if (s.keySource === 'none') continue
      out.push({
        id: 'prov:' + s.id,
        name: s.name,
        kind: 'remote',
        color: colorDe(s.id),
        detail: [t('por API'), s.modelCount ? s.modelCount + ' ' + t('modelos') : undefined].filter(Boolean).join(' · ')
      })
    }

    return out
  }, [config?.cliAgents, models, status, t])
}

/** A qué vecino le toca una tarea, de lo más concreto a lo menos. */
function residentFor(
  ids: Set<string>,
  opts: { cliAgentId?: string; providerId?: string; model?: string }
): string | undefined {
  if (opts.cliAgentId && ids.has('cli:' + opts.cliAgentId)) return 'cli:' + opts.cliAgentId
  if (opts.providerId && opts.model) {
    const local = 'local:' + opts.providerId + ':' + opts.model
    if (ids.has(local)) return local
  }
  if (opts.providerId && ids.has('prov:' + opts.providerId)) return 'prov:' + opts.providerId
  if (opts.model) {
    const suelto = [...ids].find((id) => id.endsWith(':' + opts.model))
    if (suelto) return suelto
  }
  return undefined
}

/** Las tareas vivas, sacadas de la consola, los proyectos y la arena. */
function useJobs(residents: Resident[]): Job[] {
  const t = useT()
  const chats = useOpenChats()
  const sesiones = useSessions()
  const arena = useArena()

  return useMemo(() => {
    const ids = new Set(residents.map((r) => r.id))
    const out: Job[] = []

    for (const [sid, c] of Object.entries(chats)) {
      if (!c.runningRunId) continue
      const s = c.session ?? sesiones.find((x) => x.id === sid)
      const rid = residentFor(ids, {
        cliAgentId: s?.cliAgentId,
        providerId: s?.providerId,
        model: s?.cliModel ?? s?.model
      })
      if (!rid) continue
      out.push({
        id: c.runningRunId,
        residentId: rid,
        where: s?.projectId ? t('un proyecto') : t('la consola'),
        label: s?.cliModel ?? s?.model
      })
    }

    for (const c of arena.contenders) {
      if (!c.streaming) continue
      const rid = residentFor(ids, { cliAgentId: c.cliAgentId, providerId: c.providerId, model: c.model })
      if (!rid) continue
      out.push({ id: c.runId ?? c.key, residentId: rid, where: t('la arena'), label: c.model })
    }

    return out
  }, [chats, sesiones, arena, residents])
}

/* ------------------------------------------------------------------ *
 * Pantalla                                                           *
 * ------------------------------------------------------------------ */

export default function House(): React.JSX.Element {
  const t = useT()
  const residents = useResidents()
  const jobs = useJobs(residents)
  // Quién está mirando lo dice el armazón, que es el único que lo sabe seguro:
  // la sección sigue montada cuando te vas a otra pestaña, y un observador del
  // DOM tiene que deducirlo de que el elemento dejó de ocupar sitio.
  const visible = useIsPageActive()
  const [mirando, setMirando] = useState<string | null>(null)
  const [casa, setCasa] = useState<HouseState>(emptyHouse)

  const looks = useMemo(() => {
    const m = new Map<string, Look>()
    for (const r of residents) m.set(r.id, lookOf(r.id, r.color, r.kind))
    return m
  }, [residents])

  const onState = useCallback((st: HouseState) => setCasa(st), [])

  const trabajando = new Set(jobs.map((j) => j.residentId))
  const visitas = Math.max(0, casa.dwellers.length - residents.length)

  if (!residents.length) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Empty
          icon={<Home size={30} />}
          title={t('La casa está vacía')}
          hint={t('Aquí vive una IA por cada agente de consola, modelo local y proveedor con llave que la aplicación detecte. Configura alguno en Ajustes o en Agentes y verás cómo se muda.')}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Cabecera */}
      <div className="h-[46px] shrink-0 px-4 flex items-center justify-between border-b border-line bg-void/60">
        <div className="flex items-center gap-2.5">
          <Home size={15} className="text-accent" />
          <span className="text-[13px] font-medium">{t('La Casa')}</span>
          <span className="text-[11.5px] text-dim">
            {t('house.living', { n: residents.length })}
            {visitas ? ' · ' + t('house.visiting', { n: visitas }) : ''}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11.5px]">
          <span className={cx('flex items-center gap-1.5', jobs.length ? 'text-ok' : 'text-dim')}>
            <Hammer size={12} />
            <span className="num">{jobs.length}</span> {t('con faena')}
          </span>
          <span className="flex items-center gap-1.5 text-dim">
            <Moon size={12} />
            <span className="num">{Math.max(0, residents.length - trabajando.size)}</span> {t('descansando')}
          </span>
          {!visible ? (
            <span className="flex items-center gap-1.5 text-dim" title={t('se reanuda al volver a esta pestaña')}>
              <PauseCircle size={12} /> {t('en pausa')}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Escena */}
        <div className="flex-1 min-w-0 relative bg-[#0d1119]">
          <HouseCanvas
            residents={residents}
            jobs={jobs}
            active={visible}
            hovered={mirando}
            onHover={setMirando}
            onState={onState}
          />
        </div>

        {/* Quién es quién */}
        <Pane paneKey="house.panel" side="left" className="border-l border-line bg-void/50 overflow-y-auto">
          <div className="px-3 py-2.5 text-[11px] text-dim border-b border-line-soft">
            {t('Quién vive aquí y qué está haciendo')}
          </div>
          {residents.map((r) => {
            const suyos = casa.dwellers.filter((d) => d.residentId === r.id)
            const principal = suyos[0]
            const activo = trabajando.has(r.id)
            const look = looks.get(r.id)
            return (
              <button
                key={r.id}
                onMouseEnter={() => setMirando(r.id)}
                onMouseLeave={() => setMirando(null)}
                className={cx(
                  'w-full text-left px-3 py-2 flex items-center gap-3 border-b border-line-soft transition-colors',
                  mirando === r.id ? 'bg-raised' : 'hover:bg-[#12151f]'
                )}
              >
                <span className="shrink-0 w-[24px] h-[40px] flex items-end">
                  {look ? <DollChip look={look} working={activo} /> : null}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className="text-[12.5px] truncate">{r.name}</span>
                    {suyos.length > 1 ? (
                      <span className="num text-[10px] text-accent shrink-0">×{suyos.length}</span>
                    ) : null}
                  </span>
                  <span className={cx('block text-[10.5px] truncate', activo ? 'text-ok' : 'text-dim')}>
                    {principal?.doing ?? r.detail}
                  </span>
                </span>
              </button>
            )
          })}

          <Panel className="m-3 p-3 text-[10.5px] text-dim leading-relaxed">
            Cada vecino es una IA de las que tienes. Si le mandas una tarea se pone a hacer faena; si le mandas
            otra a la vez, entra por la puerta una copia suya que se marcha cuando esa tarea acaba. El dibujo se
            para solo cuando te vas a otra pestaña.
          </Panel>
        </Pane>
      </div>
    </div>
  )
}
