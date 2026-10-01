/**
 * La ventanita del prompt rápido (atajo global, Ajustes › Preferencias).
 *
 * Se carga con el mismo código que la ventana principal, con #quick en la
 * dirección, pero sin el motor: no lanza nada por su cuenta. Manda la pregunta
 * al proceso principal, que se la pasa a la ventana principal para que la haga
 * como una conversación de la Consola, y enseña lo que va llegando.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Copy, Check, CornerDownLeft, Plus, X, Zap } from 'lucide-react'
import { StoreProvider, useStore } from './lib/store'
import { PrefsProvider, usePrefs } from './lib/prefs'
import { I18nProvider, useT } from './lib/i18n'
import { ModelPicker, type Pick } from './components/ModelPicker'
import { Markdown } from './components/Markdown'
import { cx } from './components/ui'
import { cost, shortModel } from './lib/format'
import { withMod } from './lib/platform'
import type { QuickEvent } from '@shared/types'

interface Exchange {
  id: string
  requestId?: string
  prompt: string
  text: string
  thinking: boolean
  done: boolean
  error?: string
  model?: string
  cost?: number
  ms?: number
}

function Answer({ ex }: { ex: Exchange }): React.JSX.Element {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2" data-quick-exchange={ex.done ? 'done' : 'running'}>
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl bg-raised border border-line px-3 py-2 text-[13px] whitespace-pre-wrap break-words">{ex.prompt}</div>
      </div>
      <div className="text-[13px] leading-relaxed" data-quick-answer>
        {ex.error ? (
          <div className="rounded-lg border border-bad/40 bg-bad/10 text-bad px-3 py-2 text-[12.5px]" data-quick-error>
            {t(ex.error)}
          </div>
        ) : ex.text ? (
          <Markdown>{ex.text}</Markdown>
        ) : (
          <span className="text-dim text-[12.5px]">{ex.thinking ? t('Pensando…') : t('Esperando respuesta…')}</span>
        )}
      </div>
      {ex.done && !ex.error ? (
        <div className="flex items-center gap-3 text-[11px] text-dim">
          <span className="num">
            {[ex.model ? shortModel(ex.model) : null, ex.cost != null ? cost(ex.cost) : null, ex.ms != null ? `${(ex.ms / 1000).toFixed(1)} s` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-ink"
            onClick={() => {
              void navigator.clipboard.writeText(ex.text)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            }}
          >
            {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />} {copied ? t('Copiado') : t('Copiar')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Quick(): React.JSX.Element {
  const t = useT()
  const { config, models } = useStore()
  const [items, setItems] = useState<Exchange[]>([])
  const [sessionId, setSessionId] = useState<string>()
  const [input, setInput] = useState('')
  const [pick, setPick] = useState<Pick | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Lo que llegue antes de saber a qué pregunta pertenece (casi nunca pasa).
  const early = useRef(new Map<string, QuickEvent[]>())
  const known = useRef(new Set<string>())

  // El modelo de la última vez, si sigue existiendo; si no, uno local, o el primero.
  useEffect(() => {
    if (pick || !models.length) return
    const last = config?.settings.quickModel
    const still = last && models.some((m) => m.providerId === last.providerId && m.id === last.model)
    const fallback = models.find((m) => m.local) ?? models[0]
    setPick(still ? last : { providerId: fallback.providerId, model: fallback.id })
  }, [models, config?.settings.quickModel, pick])

  const apply = useCallback((e: QuickEvent) => {
    if (e.sessionId) setSessionId(e.sessionId)
    setItems((xs) =>
      xs.map((x) => {
        if (x.requestId !== e.requestId) return x
        if (e.done) {
          return {
            ...x,
            done: true,
            thinking: false,
            text: e.response || x.text,
            error: e.error,
            model: e.model ?? x.model,
            cost: e.costTotal,
            ms: e.totalMs
          }
        }
        const d = e.delta
        if (d?.type === 'text' && d.text) return { ...x, text: x.text + d.text, thinking: false }
        if (d?.type === 'reasoning') return { ...x, thinking: true }
        if (d?.type === 'error' && d.error) return { ...x, error: d.error }
        return x
      })
    )
  }, [])

  useEffect(
    () =>
      window.api.quick.onEvent((e) => {
        if (known.current.has(e.requestId)) apply(e)
        else early.current.set(e.requestId, [...(early.current.get(e.requestId) ?? []), e])
      }),
    [apply]
  )

  useEffect(
    () =>
      window.api.quick.onShown(() => {
        box.current?.focus()
        box.current?.select()
      }),
    []
  )

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  const busy = items.length > 0 && !items[items.length - 1].done

  const send = async (): Promise<void> => {
    const prompt = input.trim()
    if (!prompt || !pick || busy) return
    setInput('')
    const id = crypto.randomUUID()
    setItems((xs) => [...xs, { id, prompt, text: '', thinking: false, done: false, model: pick.model }])
    void window.api.config.settings({ quickModel: pick })
    const r = await window.api.quick.submit({ prompt, providerId: pick.providerId, model: pick.model, sessionId })
    if (!r.ok || !r.data) {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, done: true, error: r.error ?? 'No se pudo lanzar' } : x)))
      return
    }
    const requestId = r.data
    known.current.add(requestId)
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, requestId } : x)))
    for (const e of early.current.get(requestId) ?? []) apply(e)
    early.current.delete(requestId)
  }

  const reset = (): void => {
    setItems([])
    setSessionId(undefined)
    setInput('')
    box.current?.focus()
  }

  const openConsole = (): void => {
    if (sessionId) void window.api.quick.openConsole(sessionId)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        void window.api.quick.hide()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-full flex flex-col bg-panel border border-line overflow-hidden" data-quick>
      <div className="drag h-10 shrink-0 flex items-center gap-2 px-3 border-b border-line">
        <Zap size={13} className="text-accent" />
        <span className="text-[12.5px] font-medium">{t('Prompt rápido')}</span>
        <div className="no-drag ml-auto w-[240px]">
          <ModelPicker value={pick} onChange={setPick} compact />
        </div>
        {items.length ? (
          <button type="button" onClick={reset} className="no-drag text-dim hover:text-ink p-1" title={t('Pregunta nueva')} data-quick-new>
            <Plus size={14} />
          </button>
        ) : null}
        <button type="button" onClick={() => void window.api.quick.hide()} className="no-drag text-dim hover:text-ink p-1" aria-label={t('Cerrar')}>
          <X size={14} />
        </button>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-[12.5px] text-dim leading-relaxed px-6">
            {t('Pregunta a un modelo sin salir de lo que estás haciendo. La conversación se guarda en la Consola y puedes seguirla allí.')}
          </div>
        ) : (
          items.map((ex) => <Answer key={ex.id} ex={ex} />)
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3 space-y-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={box}
            autoFocus
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                openConsole()
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={items.length ? t('Sigue preguntando…') : t('Pregunta lo que sea…')}
            className="flex-1 resize-none bg-void border border-line rounded-lg px-3 py-2 text-[13.5px] outline-none focus:border-accent-dim placeholder:text-dim max-h-40"
            data-quick-input
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || !pick || busy}
            className={cx(
              'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
              input.trim() && pick && !busy ? 'bg-accent text-void' : 'bg-raised text-dim'
            )}
            aria-label={t('Enviar')}
          >
            <CornerDownLeft size={15} />
          </button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-dim">
          <span>{t('Enter enviar · Mayús+Enter salto de línea · Esc esconder')}</span>
          {sessionId ? (
            <button type="button" onClick={openConsole} className="flex items-center gap-1 text-accent hover:underline" data-quick-console>
              <ArrowUpRight size={11} /> {withMod(t('Seguir en la Consola (Ctrl+Enter)'))}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Localized({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { lang } = usePrefs()
  return <I18nProvider lang={lang}>{children}</I18nProvider>
}

export default function QuickPrompt(): React.JSX.Element {
  return (
    <StoreProvider>
      <PrefsProvider>
        <Localized>
          <Quick />
        </Localized>
      </PrefsProvider>
    </StoreProvider>
  )
}
