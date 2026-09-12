/** Formateadores compartidos. Todo lo numérico pasa por aquí. */

export function cost(usd: number, currency: 'USD' | 'EUR' = 'USD', rate = 0.92): string {
  const v = currency === 'EUR' ? usd * rate : usd
  const sym = currency === 'EUR' ? '€' : '$'
  if (v === 0) return `${sym}0`
  if (v < 0.0001) return `<${sym}0.0001`
  if (v < 0.01) return sym + v.toFixed(4)
  if (v < 10) return sym + v.toFixed(3)
  return sym + v.toFixed(2)
}

export function tokens(n: number): string {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

export function ms(v?: number): string {
  if (v == null) return '—'
  if (v < 1000) return Math.round(v) + 'ms'
  if (v < 60_000) return (v / 1000).toFixed(v < 10_000 ? 2 : 1) + 's'
  const m = Math.floor(v / 60_000)
  return `${m}m ${Math.round((v % 60_000) / 1000)}s`
}

export function tps(v?: number): string {
  if (!v) return '—'
  return v.toFixed(1) + ' t/s'
}

export function bytes(n?: number): string {
  if (!n) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + units[i]
}

export function relTime(t: number): string {
  const d = Date.now() - t
  if (d < 60_000) return 'hace un momento'
  if (d < 3_600_000) return `hace ${Math.floor(d / 60_000)} min`
  if (d < 86_400_000) return `hace ${Math.floor(d / 3_600_000)} h`
  if (d < 604_800_000) return `hace ${Math.floor(d / 86_400_000)} d`
  return new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function dateTime(t: number): string {
  return new Date(t).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function price(v?: number): string {
  if (v == null) return '—'
  if (v === 0) return 'gratis'
  if (v < 1) return '$' + v.toFixed(3)
  return '$' + v.toFixed(2)
}

export function pct(v: number): string {
  return (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%'
}

/** Color estable por cadena, para dar identidad a modelos y proveedores. */
const PALETTE = [
  '#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#fb7185',
  '#60a5fa', '#f472b6', '#4ade80', '#fbbf24', '#38bdf8'
]

export function colorFor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** Nombre corto de modelo para etiquetas y ejes de gráficos. */
export function shortModel(id: string): string {
  const bare = id.includes('/') ? id.split('/').pop()! : id
  return bare.length > 26 ? bare.slice(0, 24) + '…' : bare
}

export function uid(): string {
  return crypto.randomUUID()
}
