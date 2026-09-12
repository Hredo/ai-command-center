/**
 * Página de terminales: varias pestañas, cada una con su shell persistente.
 *
 * Las terminales viven en el motor, no en esta página: cambiar de sección no
 * las cierra ni interrumpe lo que estén ejecutando.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  TerminalSquare, Plus, X, FolderGit2, Copy, ChevronDown, Cpu, Bot
} from 'lucide-react'
import { Button, Badge, Empty, cx, Dot, Field, Modal } from '../components/ui'
import { TerminalView } from '../components/Terminal'
import { useStore } from '../lib/store'
import { openTerm, closeTerm, useTerms, sendTermCommand } from '../lib/engine'


import { useT } from '../lib/i18n'
/** Atajos que ahorran teclear lo de siempre. Se traducen al pintarlos. */
const SNIPPETS: { label: string; cmd: string }[] = [
  { label: 'git status', cmd: 'git status' },
  { label: 'git log corto', cmd: 'git log --oneline -15' },
  { label: 'rama actual', cmd: 'git rev-parse --abbrev-ref HEAD' },
  { label: 'pnpm install', cmd: 'pnpm install' },
  { label: 'pnpm dev', cmd: 'pnpm dev' },
  { label: 'pnpm build', cmd: 'pnpm build' },
  { label: 'listar', cmd: 'Get-ChildItem' },
  { label: 'modelos de Ollama', cmd: 'ollama list' }
]

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || p
}

export default function Terminals(): React.JSX.Element {
  const t = useT()
  const { config, toast } = useStore()
  const terms = useTerms()
  const [active, setActive] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newCwd, setNewCwd] = useState('')
  const [showSnippets, setShowSnippets] = useState(false)

  const list = useMemo(
    () => Object.values(terms).sort((a, b) => a.info.createdAt - b.info.createdAt),
    [terms]
  )
  const projects = config?.projects ?? []
  const cliAgents = config?.cliAgents ?? []

  // Al entrar la primera vez se abre una terminal para no dejar la página
  // vacía. El cerrojo evita abrir dos: openTerm es asíncrono y sin él un
  // segundo render lo lanzaría otra vez antes de que la lista se actualice.
  const spawning = useRef(false)
  useEffect(() => {
    if (list.length > 0 || showNew || spawning.current) return
    spawning.current = true
    void openTerm({ title: 'Terminal' })
      .then(({ id, error }) => {
        if (id) setActive(id)
        else if (error) toast('error', t('No se pudo abrir la terminal:') + ' ' + error)
      })
      .finally(() => {
        spawning.current = false
      })
  }, [list.length, showNew])

  useEffect(() => {
    if (active && terms[active]) return
    setActive(list[list.length - 1]?.info.id ?? null)
  }, [active, terms, list])

  const spawn = async (cwd?: string, projectId?: string, title?: string): Promise<void> => {
    const { id, error } = await openTerm({ cwd, projectId, title })
    if (id) {
      setActive(id)
      setShowNew(false)
    } else {
      toast('error', t('No se pudo abrir la terminal:') + ' ' + (error ?? t('motivo desconocido')))
    }
  }

  const pickFolder = async (): Promise<void> => {
    const r = await window.api.projects.pick()
    if (r.ok && r.data) setNewCwd(r.data)
  }

  const activeState = active ? terms[active] : undefined

  return (
    <div className="h-full flex flex-col">
      {/* Pestañas */}
      <div className="h-11 shrink-0 border-b border-line bg-void flex items-stretch">
        <div className="flex-1 min-w-0 flex items-stretch overflow-x-auto">
          {list.map((term) => {
            const on = term.info.id === active
            return (
              <button
                key={term.info.id}
                onClick={() => setActive(term.info.id)}
                className={cx(
                  'group px-3 flex items-center gap-2 border-r border-line shrink-0 max-w-[240px] transition-colors',
                  on ? 'bg-panel text-ink' : 'text-muted hover:text-ink hover:bg-[#12151f]'
                )}
              >
                {on ? <span className="absolute" /> : null}
                <TerminalSquare size={13} className={cx('shrink-0', on ? 'text-accent' : '')} />
                <span className="text-[12px] truncate">
                  {term.info.title ?? shortPath(term.info.cwd)}
                </span>
                {term.busy ? <Dot tone="ok" pulse /> : null}
                {!term.info.alive ? <Dot tone="bad" /> : null}
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    void closeTerm(term.info.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-dim hover:text-bad transition-opacity shrink-0"
                  title={t('Cerrar la terminal')}
                >
                  <X size={12} />
                </span>
              </button>
            )
          })}
          <button
            onClick={() => setShowNew(true)}
            className="px-3 text-dim hover:text-accent hover:bg-hover transition-colors shrink-0"
            title={t('Terminal nueva')}
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 shrink-0 border-l border-line">
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={() => setShowSnippets((s) => !s)} disabled={!active}>
              <Copy size={12} /> {t('Atajos')} <ChevronDown size={11} />
            </Button>
            {showSnippets && active ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSnippets(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-[240px] bg-raised border border-line rounded-xl shadow-2xl py-1 fade-up">
                  {SNIPPETS.map((s) => (
                    <button
                      key={s.cmd}
                      onClick={() => {
                        sendTermCommand(active, s.cmd)
                        setShowSnippets(false)
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-hover flex flex-col gap-0.5"
                    >
                      <span className="text-[12px]">{t(s.label)}</span>
                      <span className="num text-[10.5px] text-dim truncate">{s.cmd}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          {activeState ? (
            <span className="num text-[11px] text-dim max-w-[280px] truncate" title={activeState.info.cwd}>
              {activeState.info.cwd}
            </span>
          ) : null}
        </div>
      </div>

      {/* Contenido. Todas las terminales abiertas se quedan montadas y sólo se
          esconde la que no toca: cambiar de pestaña no vuelve a crear el
          emulador ni repinta el historial desde cero. */}
      <div className="flex-1 min-h-0 relative">
        {list.map((term) => (
          <div key={term.info.id} className="absolute inset-0" hidden={term.info.id !== active}>
            <TerminalView termId={term.info.id} compact />
          </div>
        ))}
        {!list.length ? (
          <Empty
            icon={<TerminalSquare size={30} />}
            title={t('No hay ninguna terminal abierta')}
            hint={t('Cada pestaña es una shell propia dentro de la app, con su directorio y su historial. Siguen corriendo aunque te vayas a otra sección.')}
            action={
              <Button variant="primary" onClick={() => setShowNew(true)}>
                <Plus size={13} /> {t('Abrir una terminal')}
              </Button>
            }
          />
        ) : null}
      </div>

      {/* Diálogo de terminal nueva */}
      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title={t('Terminal nueva')}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowNew(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" onClick={() => void spawn(newCwd || undefined)}>
              <TerminalSquare size={13} /> {t('Abrir')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {projects.length ? (
            <Field label={t('En un proyecto')} hint={t('Arranca directamente en su carpeta')}>
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => void spawn(p.path, p.id, p.name)}
                    className="w-full px-3 py-2 rounded-lg border border-line hover:border-[#2c3346] hover:bg-hover flex items-center gap-2.5 text-left"
                  >
                    <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] truncate">{p.name}</span>
                      <span className="block num text-[10.5px] text-dim truncate">{p.path}</span>
                    </span>
                    <FolderGit2 size={13} className="text-dim shrink-0" />
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          <Field label={t('O en una carpeta cualquiera')}>
            <div className="flex gap-2">
              <input
                value={newCwd}
                onChange={(e) => setNewCwd(e.target.value)}
                placeholder={t('Vacío = tu carpeta de usuario')}
                className="flex-1 min-w-0 h-9 px-3 bg-raised border border-line rounded-lg num text-[12px] outline-none focus:border-[#2c3346]"
              />
              <Button variant="outline" onClick={() => void pickFolder()}>
                {t('Elegir…')}
              </Button>
            </div>
          </Field>

          {cliAgents.length ? (
            <div className="pt-1 border-t border-line">
              <div className="text-[11px] uppercase tracking-wider text-dim mb-2 flex items-center gap-1.5">
                <Bot size={11} /> {t('Agentes que tienes instalados')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cliAgents.map((a) => (
                  <Badge key={a.id} tone="neutral">
                    <Cpu size={10} /> {a.command}
                  </Badge>
                ))}
              </div>
              <p className="text-[11.5px] text-dim mt-2 leading-relaxed">
                {t('Los puedes lanzar a mano desde cualquier terminal, o usarlos como agente en un proyecto para que la app recoja sus métricas.')}
              </p>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
