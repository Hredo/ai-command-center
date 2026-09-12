/**
 * Límites de uso, leídos de las cabeceras de la respuesta.
 *
 * Cada proveedor las nombra a su manera y muchos no las mandan. Aquí sólo se
 * recoge lo que llega de verdad: si un proveedor no informa, la app dice que
 * no informa en vez de mostrar un número inventado.
 */
import type { UsageLimit } from '@shared/types'

function num(h: Headers, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = h.get(n)
    if (v == null) continue
    const parsed = Number(v)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Los "reset" vienen de tres formas: epoch en segundos, epoch en milisegundos
 * o una duración tipo "6m0s". Se normalizan a epoch en milisegundos.
 */
function resetAt(h: Headers, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = h.get(n)
    if (!v) continue
    const iso = Date.parse(v)
    if (!Number.isNaN(iso) && /[a-z]{3}/i.test(v)) return iso

    const dur = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/i.exec(v.trim())
    if (dur && (dur[1] || dur[2] || dur[3] || dur[4])) {
      const secs =
        Number(dur[1] ?? 0) * 3600 + Number(dur[2] ?? 0) * 60 + Number(dur[3] ?? 0) + Number(dur[4] ?? 0) / 1000
      return Date.now() + secs * 1000
    }

    const n2 = Number(v)
    if (Number.isFinite(n2)) {
      if (n2 > 1e12) return n2 // epoch en ms
      if (n2 > 1e9) return n2 * 1000 // epoch en segundos
      return Date.now() + n2 * 1000 // segundos que faltan
    }
  }
  return undefined
}

export function readUsageLimit(headers: Headers, source: string): UsageLimit | undefined {
  const limit: UsageLimit = { source }

  limit.requestsLimit = num(headers, 'anthropic-ratelimit-requests-limit', 'x-ratelimit-limit-requests')
  limit.requestsRemaining = num(
    headers,
    'anthropic-ratelimit-requests-remaining',
    'x-ratelimit-remaining-requests'
  )
  limit.tokensLimit = num(headers, 'anthropic-ratelimit-tokens-limit', 'x-ratelimit-limit-tokens', 'x-ratelimit-limit')
  limit.tokensRemaining = num(
    headers,
    'anthropic-ratelimit-tokens-remaining',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-remaining'
  )
  limit.inputTokensRemaining = num(headers, 'anthropic-ratelimit-input-tokens-remaining')
  limit.outputTokensRemaining = num(headers, 'anthropic-ratelimit-output-tokens-remaining')
  limit.resetAt = resetAt(
    headers,
    'anthropic-ratelimit-tokens-reset',
    'anthropic-ratelimit-requests-reset',
    'x-ratelimit-reset-tokens',
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset'
  )
  const retry = num(headers, 'retry-after')
  if (retry != null) limit.retryAfterSeconds = retry

  const any = Object.keys(limit).some((k) => k !== 'source' && (limit as any)[k] != null)
  return any ? limit : undefined
}
