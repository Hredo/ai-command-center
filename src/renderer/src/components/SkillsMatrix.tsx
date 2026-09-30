/**
 * Las Skills y qué CLI ve cada una. Una fila por Skill y una columna por CLI:
 * si la ve, se dice desde qué carpeta; si no, un botón la copia a la carpeta
 * que ese CLI lee (`.claude/skills` para Claude Code, `.agents/skills` para
 * los demás, que de paso la ven todos ellos).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, Check, Copy, FolderOpen, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button, Badge, Empty, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import type { SkillInfo, SkillsReport, SkillTool } from '@shared/types'

const TOOLS: { id: SkillTool; name: string; command: string }[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude' },
  { id: 'codex', name: 'Codex', command: 'codex' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini' },
  { id: 'copilot', name: 'Copilot CLI', command: 'copilot' }
]

/** A qué carpeta se copia para que la vea cada CLI. */
const TARGET: Record<SkillTool, string> = {
  claude: 'claude',
  codex: 'agents',
  opencode: 'agents',
  gemini: 'agents',
  copilot: 'agents'
}

export function SkillsMatrix({ scope, projectPath }: { scope: 'personal' | 'project'; projectPath?: string }): React.JSX.Element {
  const t = useT()
  const { toast, config } = useStore()
  const [report, setReport] = useState<SkillsReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await window.api.skills.list(projectPath)
    setReport(r.ok && r.data ? r.data : { locations: [], skills: [] })
  }, [projectPath])

  useEffect(() => {
    void load()
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const skills = useMemo(() => (report?.skills ?? []).filter((s) => s.scope === scope), [report, scope])
  const locations = useMemo(() => (report?.locations ?? []).filter((l) => l.scope === scope), [report, scope])
  // Qué CLIs tienes: los demás se enseñan igual, pero apagados.
  const installed = useMemo(
    () => new Set((config?.cliAgents ?? []).map((a) => a.command.toLowerCase().split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/, ''))),
    [config?.cliAgents]
  )

  const copy = async (skill: SkillInfo, tool: SkillTool): Promise<void> => {
    const target = TARGET[tool]
    const source = skill.copies[0].path
    setBusy(`${skill.dir}:${tool}`)
    const r = await window.api.skills.copy(source, { id: target, scope }, projectPath)
    setBusy(null)
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo copiar'))
      return
    }
    setReport(r.data)
    const where = r.data.locations.find((l) => l.id === target && l.scope === scope)?.path ?? ''
    toast('ok', t('«{name}» copiada a {path}', { name: skill.dir, path: where }))
  }

  if (!report) return <div className="text-[12px] text-dim">{t('Leyendo…')}</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <Sparkles size={13} className="text-accent" /> {scope === 'personal' ? t('Tus Skills') : t('Skills del proyecto')}
          <span className="num text-[11px] text-dim">{skills.length}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} title={t('Volver a mirar las carpetas')}>
          <RefreshCw size={12} />
        </Button>
      </div>
      <p className="text-[11.5px] text-dim leading-relaxed">
        {scope === 'personal'
          ? t('Carpetas con un SKILL.md que cada CLI carga en todos tus proyectos. Cada uno las busca en sitios distintos: aquí ves cuál ve cada una y la copias a donde falte.')
          : t('Skills de este repositorio: se versionan con él y las carga quien trabaje aquí.')}
      </p>

      {!skills.length ? (
        <Empty
          icon={<Sparkles size={28} />}
          title={t('Ninguna Skill')}
          hint={
            scope === 'personal'
              ? t('Crea una carpeta con un SKILL.md en ~/.claude/skills (Claude Code) o en ~/.agents/skills (Codex, OpenCode, Gemini y Copilot).')
              : t('Crea una carpeta con un SKILL.md en .claude/skills (Claude Code) o en .agents/skills (Codex, OpenCode, Gemini y Copilot).')
          }
        />
      ) : (
        <div className="border border-line rounded-lg overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[11px] text-dim text-left">
                <th className="px-3 py-2 font-medium">{t('Skill')}</th>
                {TOOLS.map((tool) => (
                  <th key={tool.id} className={cx('px-2 py-2 font-medium text-center whitespace-nowrap', !installed.has(tool.command) && 'opacity-50')}>
                    {tool.name}
                    {!installed.has(tool.command) ? <div className="text-[10px] font-normal">{t('no lo tienes')}</div> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.dir} className="border-t border-line-soft align-top" data-skill={s.dir}>
                  <td className="px-3 py-2 min-w-[240px]">
                    <div className="font-mono text-[12px] text-ink">{s.dir}</div>
                    {s.description ? <div className="text-[11px] text-dim line-clamp-2 mt-0.5">{s.description}</div> : null}
                    <div className="flex gap-1 flex-wrap mt-1">
                      {s.copies.map((c) => (
                        <Badge key={c.path} title={c.path}>
                          {locations.find((l) => l.id === c.location)?.path.split(/[\\/]/).slice(-2).join('/') ?? c.location}
                        </Badge>
                      ))}
                      {s.differs ? <Badge tone="warn">{t('las copias no son iguales')}</Badge> : null}
                    </div>
                    {s.warnings.map((w) => (
                      <div key={w} className="flex items-start gap-1 text-[11px] text-warn mt-1">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {t(w)}
                      </div>
                    ))}
                  </td>
                  {TOOLS.map((tool) => {
                    const sees = s.readers.includes(tool.id)
                    const rejected = s.rejectedBy.includes(tool.id)
                    const from = s.copies.find((c) => report.locations.find((l) => l.id === c.location && l.scope === scope)?.readers.includes(tool.id))
                    return (
                      <td key={tool.id} className="px-2 py-2 text-center" data-tool={tool.id}>
                        {sees && rejected ? (
                          <span className="inline-flex text-warn" title={t('La ve en {path}, pero no la carga: mira el aviso de la Skill', { path: from?.path ?? '' })}>
                            <AlertTriangle size={13} />
                          </span>
                        ) : sees ? (
                          <span className="inline-flex text-ok" title={t('La carga desde {path}', { path: from?.path ?? '' })}>
                            <Check size={14} />
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `${s.dir}:${tool.id}`}
                            onClick={() => void copy(s, tool.id)}
                            title={t('Copiarla a {path}', {
                              path: report.locations.find((l) => l.id === TARGET[tool.id] && l.scope === scope)?.path ?? ''
                            })}
                          >
                            <Copy size={11} /> {t('Copiar')}
                          </Button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wider text-dim">{t('Carpetas')}</div>
        {locations.map((l) => (
          <div key={l.path} className="flex items-center gap-2 text-[11px]">
            <span className={cx('font-mono truncate', l.exists ? 'text-muted' : 'text-dim')} title={l.path}>
              {l.path}
            </span>
            <span className="text-dim shrink-0">
              {l.readers.map((r) => TOOLS.find((x) => x.id === r)?.name).join(', ')}
              {l.readOnly ? ' · ' + t('las baja claude.ai') : ''}
            </span>
            {l.exists ? (
              <button className="text-dim hover:text-ink shrink-0" onClick={() => void window.api.projects.openFolder(l.path)} title={t('Abrir')}>
                <FolderOpen size={11} />
              </button>
            ) : (
              <span className="text-dim shrink-0">{t('no existe')}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
