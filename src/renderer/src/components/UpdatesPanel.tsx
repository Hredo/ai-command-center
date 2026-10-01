/**
 * Ajustes › Preferencias: la versión instalada, si hay una más nueva en
 * GitHub y su descarga para este sistema. La app no se actualiza sola (no va
 * firmada): la descarga la abre el navegador y el instalador lo lanzas tú.
 */
import React, { useState } from 'react'
import { ArrowUpCircle, Download, ExternalLink, RefreshCw, ChevronRight } from 'lucide-react'
import { Panel, PanelHeader, Button, Toggle, cx } from './ui'
import { Markdown } from './Markdown'
import { useT } from '../lib/i18n'
import { bytes, relTime } from '../lib/format'
import { IS_WIN } from '../lib/platform'
import { checkUpdateNow, skipUpdate, updateAvailable, useUpdate } from '../lib/updates'
import type { Settings, UpdateDownload } from '@shared/types'

const KIND_LABEL: Record<UpdateDownload['kind'], string> = {
  installer: 'Instalador (.exe)',
  portable: 'Portable (.zip)',
  dmg: 'Imagen de disco (.dmg)',
  appimage: 'AppImage',
  deb: 'Paquete .deb',
  checksums: 'Sumas SHA-256'
}

export function UpdatesPanel({ s, setSetting }: { s: Settings; setSetting: (patch: Partial<Settings>) => Promise<void> }): React.JSX.Element {
  const t = useT()
  const u = useUpdate()
  const [checking, setChecking] = useState(false)
  const [notes, setNotes] = useState(false)
  const available = updateAvailable(u)
  const files = (u?.downloads ?? []).filter((d) => d.kind !== 'checksums')
  const sums = u?.downloads.find((d) => d.kind === 'checksums')

  const check = async (): Promise<void> => {
    setChecking(true)
    await checkUpdateNow()
    setChecking(false)
  }

  return (
    <Panel>
      <PanelHeader
        title={t('Versión')}
        icon={<ArrowUpCircle size={14} className={available ? 'text-accent' : undefined} />}
        subtitle={t('Avisa cuando hay una nueva en GitHub; no se instala sola')}
        right={
          <Button variant="ghost" size="sm" onClick={() => void check()} loading={checking} data-update-check>
            <RefreshCw size={12} /> {t('Buscar ahora')}
          </Button>
        }
      />
      <div className="p-4 space-y-3" data-updates>
        <div className="flex items-baseline gap-2 flex-wrap text-[12.5px]">
          <span className="text-dim">{t('Instalada')}</span>
          <span className="num">v{u?.current ?? '…'}</span>
          {u?.latest ? (
            <>
              <span className="text-dim">·</span>
              <span className="text-dim">{t('Última publicada')}</span>
              <span className={cx('num', available ? 'text-accent' : '')} data-update-latest>
                v{u.latest}
              </span>
            </>
          ) : null}
          {u?.checkedAt ? <span className="text-[11px] text-dim ml-auto">{t('mirado {when}', { when: relTime(u.checkedAt) })}</span> : null}
        </div>

        <div className="text-[12.5px]" data-update-state>
          {!u ? (
            <span className="text-dim">{s.checkUpdates === false ? t('La comprobación está apagada.') : t('Todavía no se ha mirado.')}</span>
          ) : u.error ? (
            <span className="text-warn">{t(u.error)}</span>
          ) : available ? (
            <span className="text-accent">{t('Hay una versión nueva: v{v}', { v: u.latest ?? '' })}</span>
          ) : u.newer && u.skipped ? (
            <span className="text-dim">{t('Omitiste la v{v}: no se vuelve a avisar de ella.', { v: u.latest ?? '' })}</span>
          ) : (
            <span className="text-ok">{t('Tienes la última versión.')}</span>
          )}
        </div>

        {u?.newer ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {files.map((d, i) => (
                <Button
                  key={d.url}
                  variant={i === 0 ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => void window.api.app.openExternal(d.url)}
                  title={d.name}
                  data-update-download={d.kind}
                >
                  <Download size={12} /> {t(KIND_LABEL[d.kind])} <span className="num opacity-70">{bytes(d.size)}</span>
                </Button>
              ))}
              {u.url ? (
                <Button variant="ghost" size="sm" onClick={() => void window.api.app.openExternal(u.url!)}>
                  <ExternalLink size={12} /> {t('Ver en GitHub')}
                </Button>
              ) : null}
              {u.skipped ? (
                <Button variant="ghost" size="sm" onClick={() => void skipUpdate(null)} data-update-unskip>
                  {t('Volver a avisar')}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => void skipUpdate(u.latest ?? null)} data-update-skip>
                  {t('Omitir esta versión')}
                </Button>
              )}
            </div>
            <p className="text-[11.5px] text-dim leading-relaxed">
              {t('La descarga la abre el navegador. Cierra la app antes de instalar; tus datos y ajustes se quedan donde están.')}
              {IS_WIN ? ' ' + t('Si Windows bloquea el instalador (Smart App Control), usa la versión portable.') : ''}
              {sums ? (
                <>
                  {' '}
                  <button type="button" className="text-accent hover:underline" onClick={() => void window.api.app.openExternal(sums.url)}>
                    {t('Sumas SHA-256')}
                  </button>
                </>
              ) : null}
            </p>
            {u.notes ? (
              <div>
                <button
                  type="button"
                  onClick={() => setNotes((n) => !n)}
                  className="flex items-center gap-1 text-[12px] text-muted hover:text-ink"
                  data-update-notes-toggle
                >
                  <ChevronRight size={12} className={cx('transition-transform', notes && 'rotate-90')} /> {t('Notas de la versión')}
                </button>
                {notes ? (
                  <div className="mt-2 max-h-[320px] overflow-y-auto rounded-lg border border-line bg-void px-3 py-2 text-[12.5px]" data-update-notes>
                    <Markdown>{u.notes}</Markdown>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <Toggle
          checked={s.checkUpdates !== false}
          onChange={(v) => {
            void setSetting({ checkUpdates: v }).then(() => {
              if (v) void check()
            })
          }}
          label={t('Mirar al arrancar y cada seis horas')}
        />
        <p className="text-[11.5px] text-dim leading-relaxed">
          {t('Sólo se consulta la página pública de versiones de GitHub, sin cuenta ni datos tuyos.')}
        </p>
      </div>
    </Panel>
  )
}
