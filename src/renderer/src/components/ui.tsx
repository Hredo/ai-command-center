import React, { useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'

import { useT } from '../lib/i18n'
type Div = React.HTMLAttributes<HTMLDivElement>

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------- Botones
type BtnVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle'
type BtnSize = 'sm' | 'md' | 'icon'

const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-void hover:bg-cyan-300 font-medium',
  outline: 'border border-line bg-raised hover:bg-hover hover:border-[#2c3245] text-ink',
  ghost: 'hover:bg-hover text-muted hover:text-ink',
  subtle: 'bg-raised hover:bg-hover text-muted hover:text-ink',
  danger: 'border border-[#4a2530] bg-[#1e1218] text-bad hover:bg-[#2a1620]'
}

const SIZE: Record<BtnSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 gap-2 rounded-lg',
  icon: 'h-8 w-8 justify-center rounded-md'
}

export function Button({
  variant = 'outline',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: {
  variant?: BtnVariant
  size?: BtnSize
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center transition-colors select-none whitespace-nowrap',
        'disabled:opacity-40 disabled:pointer-events-none',
        BTN[variant],
        SIZE[size],
        className
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Contenedores
export function Panel({ className, children, ...rest }: Div): React.JSX.Element {
  return (
    <div {...rest} className={cx('bg-panel border border-line rounded-xl', className)}>
      {children}
    </div>
  )
}

export function PanelHeader({
  title,
  subtitle,
  right,
  icon
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
  icon?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 px-4 h-12 border-b border-line shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon ? <span className="text-dim shrink-0">{icon}</span> : null}
        <div className="min-w-0">
          <div className="font-medium truncate">{title}</div>
          {subtitle ? <div className="text-[11.5px] text-dim truncate">{subtitle}</div> : null}
        </div>
      </div>
      {right ? <div className="flex items-center gap-2 shrink-0">{right}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------- Etiquetas
export function Badge({
  tone = 'neutral',
  children,
  className,
  title
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent' | 'violet'
  children: React.ReactNode
  className?: string
  /** Tooltip: útil cuando la etiqueta es corta y necesita explicación. */
  title?: string
}): React.JSX.Element {
  const tones = {
    neutral: 'bg-raised text-muted border-line',
    ok: 'bg-[#0d2019] text-ok border-[#194b39]',
    warn: 'bg-[#241a09] text-warn border-[#4a3512]',
    bad: 'bg-[#241016] text-bad border-[#4a2029]',
    accent: 'bg-[#082a31] text-accent border-[#12525f]',
    violet: 'bg-[#1a1330] text-violet border-[#37275c]'
  }
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] leading-none whitespace-nowrap',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Dot({ tone = 'dim', pulse }: { tone?: 'ok' | 'bad' | 'warn' | 'dim'; pulse?: boolean }): React.JSX.Element {
  const c = { ok: 'bg-ok', bad: 'bg-bad', warn: 'bg-warn', dim: 'bg-dim' }[tone]
  return <span className={cx('inline-block w-1.5 h-1.5 rounded-full shrink-0', c, pulse && 'pulse')} />
}

// ---------------------------------------------------------------- Formularios
export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      {...rest}
      className={cx(
        'h-9 px-3 bg-void border border-line rounded-lg w-full',
        'placeholder:text-dim focus:border-accent-dim outline-none transition-colors',
        className
      )}
    />
  )
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea
      {...rest}
      className={cx(
        'px-3 py-2.5 bg-void border border-line rounded-lg w-full',
        'placeholder:text-dim focus:border-accent-dim outline-none transition-colors',
        className
      )}
    />
  )
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      {...rest}
      className={cx(
        'h-9 px-2.5 bg-void border border-line rounded-lg w-full',
        'focus:border-accent-dim outline-none transition-colors cursor-pointer',
        className
      )}
    >
      {children}
    </select>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <div className="text-[11.5px] uppercase tracking-wide text-dim mb-1.5 font-medium">{label}</div>
      {children}
      {hint ? <div className="text-[11.5px] text-dim mt-1.5">{hint}</div> : null}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 group"
    >
      <span
        className={cx(
          'w-9 h-5 rounded-full transition-colors relative shrink-0',
          checked ? 'bg-accent' : 'bg-[#242a3a]'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
            checked ? 'left-4.5' : 'left-0.5'
          )}
        />
      </span>
      {label ? <span className="text-muted group-hover:text-ink transition-colors">{label}</span> : null}
    </button>
  )
}

// ---------------------------------------------------------------- Modal
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
  footer
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string
  footer?: React.ReactNode
}): React.JSX.Element | null {
  const t = useT()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/65" onMouseDown={onClose}>
      <div
        className={cx('bg-panel border border-line rounded-2xl w-full shadow-2xl fade-up flex flex-col max-h-[86vh]', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-13 py-3.5 border-b border-line shrink-0">
          <h2 className="font-medium">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('Cerrar')}>
            <X size={16} />
          </Button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer ? <div className="px-5 py-3.5 border-t border-line flex justify-end gap-2 shrink-0">{footer}</div> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Estados
export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return <Loader2 size={size} className="animate-spin text-dim" />
}

export function Empty({
  icon,
  title,
  hint,
  action
}: {
  icon?: React.ReactNode
  title: string
  hint?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
      {icon ? <div className="text-[#2a3145]">{icon}</div> : null}
      <div className="text-muted font-medium">{title}</div>
      {hint ? <div className="text-[12.5px] text-dim max-w-md leading-relaxed">{hint}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/** Métrica destacada. `accent` la resalta como dato principal del panel. */
export function Stat({
  label,
  value,
  sub,
  tone,
  icon
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'accent' | 'ok' | 'warn' | 'bad'
  icon?: React.ReactNode
}): React.JSX.Element {
  const color = tone ? { accent: 'text-accent', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[tone] : 'text-ink'
  return (
    <div className="bg-panel border border-line rounded-xl px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[11px] uppercase tracking-wider text-dim font-medium truncate">{label}</div>
        {icon ? <span className="text-[#2f3648] shrink-0">{icon}</span> : null}
      </div>
      <div className={cx('num text-[22px] leading-none font-semibold', color)}>{value}</div>
      {sub ? <div className="text-[11.5px] text-dim mt-1.5 truncate">{sub}</div> : null}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items
}: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: string; count?: number }[]
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 p-1 bg-raised border border-line rounded-lg">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={cx(
            'px-3 h-7 rounded-md text-[12.5px] transition-colors flex items-center gap-1.5',
            value === it.id ? 'bg-[#252b3c] text-ink' : 'text-muted hover:text-ink'
          )}
        >
          {it.label}
          {it.count != null ? <span className="num text-[11px] text-dim">{it.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Barra proporcional para comparativas dentro de tablas. */
export function Meter({ value, max, color }: { value: number; max: number; color?: string }): React.JSX.Element {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="h-1.5 bg-[#1a1e2b] rounded-full overflow-hidden w-full">
      <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: color ?? '#22d3ee' }} />
    </div>
  )
}
