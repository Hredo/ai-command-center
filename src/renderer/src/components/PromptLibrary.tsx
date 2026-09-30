/**
 * Biblioteca de prompts.
 *
 * - `PromptTextarea`: una caja de texto donde «/» abre la biblioteca. Al
 *   elegir uno se sustituye el «/…» escrito; si tiene variables, antes se
 *   piden (las de proyecto, rama y fecha vienen ya puestas).
 * - `PromptLibrary`: la lista con su editor, en Agentes › Prompts y desde el «/».
 * - `SavePromptButton`: guarda lo que hay en la caja como prompt nuevo.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, Copy, Library, Plus, Save, Search, Trash2, Braces } from 'lucide-react'
import { Badge, Button, Field, Input, Modal, Textarea, cx } from './ui'
import { useStore } from '../lib/store'
import { useT } from '../lib/i18n'
import { builtinValues, fillPrompt, promptVars, rankPrompts, slashToken } from '../lib/prompts'
import type { PromptTemplate } from '@shared/types'

type Ctx = { project?: string; branch?: string }

const firstLine = (s: string): string => s.trim().split('\n')[0] ?? ''

/* ------------------------------------------------------------------ *
 * Rellenar variables                                                 *
 * ------------------------------------------------------------------ */

function PromptFillModal({
  prompt,
  context,
  onClose,
  onInsert
}: {
  prompt: PromptTemplate
  context?: Ctx
  onClose: () => void
  onInsert: (text: string) => void
}): React.JSX.Element {
  const t = useT()
  const vars = useMemo(() => promptVars(prompt.text), [prompt.text])
  const [auto] = useState(() => builtinValues(context ?? {}))
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v.key, v.builtin ? auto[v.key] || v.default || '' : (v.default ?? '')]))
  )
  const preview = fillPrompt(prompt.text, values)
  // El foco, en el primer hueco por rellenar.
  const [firstAsk] = useState(() => (vars.find((v) => !values[v.key]) ?? vars.find((v) => !v.builtin))?.key)

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Rellenar «{name}»', { name: prompt.name })}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" onClick={() => onInsert(preview)} data-prompt-insert>
            {t('Insertar')}
          </Button>
        </>
      }
    >
      <div
        className="space-y-3"
        data-prompt-fill
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            onInsert(preview)
          }
        }}
      >
        {vars.map((v) => (
          <Field key={v.key} label={v.builtin && auto[v.key] ? `${v.name} · ${t('se rellena sola')}` : v.name}>
            <Textarea
              rows={Math.min(6, Math.max(1, (values[v.key] ?? '').split('\n').length))}
              value={values[v.key] ?? ''}
              autoFocus={v.key === firstAsk}
              placeholder={v.default ?? ''}
              onChange={(e) => setValues((cur) => ({ ...cur, [v.key]: e.target.value }))}
              className="text-[12.5px]"
              data-var={v.key}
            />
          </Field>
        ))}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-dim mb-1">{t('Así queda')}</div>
          <pre className="max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words bg-void border border-line rounded-lg px-3 py-2 text-[12px] text-muted m-0" data-prompt-preview>
            {preview}
          </pre>
        </div>
        <p className="text-[11px] text-dim">{t('Ctrl + Enter para insertar')}</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * La caja con «/»                                                    *
 * ------------------------------------------------------------------ */

export function PromptTextarea({
  value,
  onValue,
  context,
  placement = 'above',
  onKeyDown,
  ...rest
}: {
  value: string
  onValue: (v: string) => void
  /** Para las variables que se rellenan solas. */
  context?: Ctx
  /** Dónde sale la lista: encima si la caja está abajo de la pantalla. */
  placement?: 'above' | 'below'
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>): React.JSX.Element {
  const t = useT()
  const { config } = useStore()
  const prompts = config?.prompts ?? []
  const ref = useRef<HTMLTextAreaElement>(null)
  const [token, setToken] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  // Esc cierra la lista para ese «/»: no vuelve a salir hasta que escribas otro.
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [filling, setFilling] = useState<{ prompt: PromptTemplate; start: number; end: number } | null>(null)
  const [managing, setManaging] = useState(false)

  const matches = useMemo(() => (token ? rankPrompts(prompts, token.query).slice(0, 8) : []), [token, prompts])
  const open = Boolean(token) && dismissed !== token!.start && (matches.length > 0 || token!.query === '')

  const sync = (el: HTMLTextAreaElement): void => {
    const tok = slashToken(el.value, el.selectionStart ?? el.value.length)
    setToken(tok)
    if (!tok) setDismissed(null)
  }

  const insert = (text: string, start: number, end: number, id: string): void => {
    const next = value.slice(0, start) + text + value.slice(end)
    onValue(next)
    setToken(null)
    setFilling(null)
    void window.api.prompts.used(id)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  const choose = (p: PromptTemplate): void => {
    if (!token) return
    const start = token.start
    const end = token.start + 1 + token.query.length
    const auto = builtinValues(context ?? {})
    // Sólo se pregunta si hay algo que no se pueda rellenar solo.
    const ask = promptVars(p.text).some((v) => !v.builtin || !auto[v.key])
    if (ask) {
      setToken(null)
      setFilling({ prompt: p, start, end })
    } else {
      insert(fillPrompt(p.text, auto), start, end, p.id)
    }
  }

  return (
    <div className="relative">
      <Textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => {
          onValue(e.target.value)
          sync(e.target)
          setActive(0)
        }}
        onClick={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') && !open) sync(e.currentTarget)
        }}
        onBlur={() => setToken(null)}
        onKeyDown={(e) => {
          if (open && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = Math.max(1, matches.length)
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
              return
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && matches.length) {
              e.preventDefault()
              choose(matches[Math.min(active, matches.length - 1)])
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setDismissed(token!.start)
              return
            }
          }
          onKeyDown?.(e)
        }}
      />
      {open ? (
        <div
          // Que al pulsar en la lista la caja no pierda el foco (y la lista no se cierre).
          onMouseDown={(e) => e.preventDefault()}
          className={cx(
            'absolute left-0 right-0 z-30 rounded-lg border border-line bg-panel shadow-xl overflow-hidden',
            placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          )}
          data-slash
        >
          <div className="px-3 py-1.5 border-b border-line-soft flex items-center gap-2 text-[11px] text-dim">
            <Library size={12} /> {t('Biblioteca de prompts')}
            <span className="ml-auto">{t('↑↓ elegir · Enter insertar · Esc cerrar')}</span>
          </div>
          {matches.length ? (
            <div className="max-h-[260px] overflow-y-auto py-1">
              {matches.map((p, i) => {
                const n = promptVars(p.text).filter((v) => !v.builtin).length
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-prompt={p.id}
                    onClick={() => choose(p)}
                    onMouseEnter={() => setActive(i)}
                    className={cx('w-full text-left px-3 py-1.5 flex items-center gap-2.5', i === active ? 'bg-raised' : 'hover:bg-raised/60')}
                  >
                    <span className="text-[12.5px] font-medium text-ink shrink-0 max-w-[45%] truncate">/{p.name}</span>
                    <span className="text-[11.5px] text-dim truncate flex-1 min-w-0">{p.description || firstLine(p.text)}</span>
                    {n ? (
                      <Badge tone="violet" className="shrink-0">
                        <Braces size={10} /> {n}
                      </Badge>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="px-3 py-2.5 text-[12px] text-dim leading-relaxed">
              {t('Tu biblioteca está vacía. Guarda lo que escribas con el marcador que hay junto a la caja, o crea prompts en Agentes › Prompts.')}
            </div>
          )}
          <div className="px-2 py-1 border-t border-line-soft">
            <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
              <Library size={12} /> {t('Gestionar la biblioteca')}
            </Button>
          </div>
        </div>
      ) : null}

      {filling ? (
        <PromptFillModal
          prompt={filling.prompt}
          context={context}
          onClose={() => {
            setFilling(null)
            requestAnimationFrame(() => ref.current?.focus())
          }}
          onInsert={(text) => insert(text, filling.start, filling.end, filling.prompt.id)}
        />
      ) : null}
      <Modal open={managing} onClose={() => setManaging(false)} title={t('Biblioteca de prompts')} width="max-w-5xl">
        {managing ? <PromptLibrary /> : null}
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Editor y lista                                                     *
 * ------------------------------------------------------------------ */

const blank = (text = ''): PromptTemplate => ({ id: crypto.randomUUID(), name: '', text, createdAt: Date.now() })

function VarsHint({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const vars = promptVars(text)
  return (
    <div className="space-y-1.5">
      {vars.length ? (
        <div className="flex items-center gap-1.5 flex-wrap" data-vars>
          {vars.map((v) => (
            <Badge key={v.key} tone={v.builtin ? 'neutral' : 'violet'} title={v.default ? t('Por omisión: {value}', { value: v.default }) : undefined}>
              {v.name}
              {v.builtin ? ` · ${t('sola')}` : ''}
            </Badge>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] text-dim leading-relaxed">
        {t('Escribe {{variable}} o {{variable:valor por omisión}} para lo que cambie cada vez: se pide al insertarlo. {{proyecto}}, {{rama}} y {{fecha}} se rellenan solas.')}
      </p>
    </div>
  )
}

function PromptEditor({
  draft,
  onChange,
  compact
}: {
  draft: PromptTemplate
  onChange: (p: PromptTemplate) => void
  compact?: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3">
      <div className={cx('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-2')}>
        <Field label={t('Nombre')}>
          <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder={t('Revisar PR')} data-prompt-name />
        </Field>
        <Field label={t('Descripción')}>
          <Input value={draft.description ?? ''} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder={t('Opcional')} />
        </Field>
      </div>
      <Field label={t('Prompt')}>
        <Textarea
          rows={compact ? 8 : 14}
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          className="font-mono text-[12.5px] leading-relaxed"
          data-prompt-text
        />
      </Field>
      <VarsHint text={draft.text} />
    </div>
  )
}

export function PromptLibrary(): React.JSX.Element {
  const t = useT()
  const { config, toast } = useStore()
  const prompts = useMemo(() => [...(config?.prompts ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [config?.prompts])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<PromptTemplate | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  // Al entrar, el primero; al borrar el que estaba abierto, el siguiente.
  useEffect(() => {
    if (draft && (prompts.some((p) => p.id === draft.id) || !draft.name)) return
    if (!draft && prompts[0]) setDraft(prompts[0])
  }, [prompts, draft])

  const visible = query.trim() ? rankPrompts(prompts, query) : prompts
  const saved = draft ? prompts.find((p) => p.id === draft.id) : undefined
  const dirty = Boolean(draft && (!saved || saved.name !== draft.name || saved.text !== draft.text || (saved.description ?? '') !== (draft.description ?? '')))

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    const r = await window.api.prompts.save(draft)
    setBusy(false)
    if (!r.ok || !r.data) {
      toast('error', r.error ?? t('No se pudo guardar'))
      return
    }
    const stored = r.data.prompts?.find((p) => p.id === draft.id)
    if (stored) setDraft(stored)
    toast('ok', t('Prompt guardado'))
  }

  const remove = async (): Promise<void> => {
    if (!draft) return
    await window.api.prompts.remove(draft.id)
    setConfirm(false)
    setDraft(prompts.find((p) => p.id !== draft.id) ?? null)
  }

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4 min-h-[420px]" data-prompt-library>
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Buscar…')}
              className="w-full h-8 pl-7 pr-2 bg-raised border border-line rounded-md text-[12px] outline-none focus:border-[#2c3346] placeholder:text-dim"
            />
          </div>
          <Button size="sm" variant="primary" onClick={() => setDraft(blank())} title={t('Prompt nuevo')}>
            <Plus size={12} /> {t('Nuevo')}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {visible.length === 0 ? (
            <div className="px-2 py-6 text-center text-[11.5px] text-dim leading-relaxed">
              {prompts.length ? t('Ninguno encaja con la búsqueda.') : t('Todavía no hay prompts. Crea uno o guarda lo que escribas en la Consola con el marcador.')}
            </div>
          ) : (
            visible.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDraft(p)}
                data-library-row={p.id}
                className={cx(
                  'w-full text-left px-2.5 py-1.5 rounded-md',
                  draft?.id === p.id ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'
                )}
              >
                <div className="text-[12.5px] truncate">{p.name}</div>
                <div className="text-[11px] text-dim truncate">
                  {p.description || firstLine(p.text)}
                  {p.uses ? ` · ${t('{n} usos', { n: p.uses })}` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="min-w-0">
        {draft ? (
          <div className="space-y-3">
            <PromptEditor draft={draft} onChange={setDraft} />
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!dirty || !draft.text.trim()} data-prompt-save>
                <Save size={13} /> {t('Guardar')}
              </Button>
              {saved ? (
                <>
                  <Button variant="ghost" onClick={() => setDraft({ ...blank(draft.text), name: t('{name} (copia)', { name: draft.name }), description: draft.description })}>
                    <Copy size={13} /> {t('Duplicar')}
                  </Button>
                  <Button variant="ghost" className="ml-auto text-bad" onClick={() => setConfirm(true)}>
                    <Trash2 size={13} /> {t('Borrar')}
                  </Button>
                </>
              ) : null}
              {dirty && saved ? <span className="text-[11px] text-warn">{t('Sin guardar')}</span> : null}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-[12.5px] text-dim">{t('Elige uno o crea uno nuevo.')}</div>
        )}
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('Borrar el prompt')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              <Trash2 size={13} /> {t('Borrar')}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted">{t('«{name}» sale de la biblioteca. No se puede deshacer.', { name: draft?.name ?? '' })}</p>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Guardar lo escrito                                                 *
 * ------------------------------------------------------------------ */

export function SavePromptButton({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [draft, setDraft] = useState<PromptTemplate | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    const r = await window.api.prompts.save(draft)
    setBusy(false)
    if (!r.ok) {
      toast('error', r.error ?? t('No se pudo guardar'))
      return
    }
    setDraft(null)
    toast('ok', t('Guardado en la biblioteca: escribe / para usarlo'))
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-dim hover:text-accent transition-colors disabled:opacity-40 disabled:hover:text-dim"
        onClick={() => setDraft(blank(text))}
        disabled={!text.trim()}
        title={t('Guardar lo escrito en la biblioteca de prompts')}
        data-save-prompt
      >
        <BookmarkPlus size={12} /> {t('Guardar')}
      </button>
      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={t('Guardar en la biblioteca')}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!draft?.text.trim()} onClick={() => void save()} data-prompt-save>
              <Save size={13} /> {t('Guardar')}
            </Button>
          </>
        }
      >
        {draft ? <PromptEditor draft={draft} onChange={setDraft} compact /> : null}
      </Modal>
    </>
  )
}
