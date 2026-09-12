/**
 * De un modelo a su página. Se usa al pinchar una fila del catálogo.
 *
 * Cada proveedor organiza su documentación a su manera, así que hay una
 * plantilla por proveedor. Cuando no hay una página fiable para el modelo
 * concreto, se devuelve la lista de modelos del proveedor —que siempre existe—
 * en lugar de un enlace inventado que acabaría en un 404.
 */
import { providerById } from './catalog'
import type { ModelLinks } from '@shared/types'

/** Quita el prefijo de proveedor de un id tipo "anthropic/claude-opus-4". */
function bare(modelId: string): string {
  return modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId
}

/** Familia del modelo, sin la versión ni la fecha, para docs por familia. */
function family(modelId: string): string {
  return bare(modelId)
    .replace(/[-@:]?\d{4}-?\d{2}-?\d{2}$/, '')
    .replace(/[-:](latest|preview|instruct|chat|it|hf)$/i, '')
}

function hf(modelId: string): string {
  return `https://huggingface.co/models?search=${encodeURIComponent(bare(modelId))}`
}

export function modelLinks(providerId: string, modelId: string): ModelLinks {
  const def = providerById(providerId)
  const id = bare(modelId)
  const extras: { label: string; url: string }[] = []
  let primary = ''
  let primaryKind: ModelLinks['primaryKind'] = 'provider'

  switch (providerId) {
    case 'anthropic':
      primary = 'https://docs.anthropic.com/en/docs/about-claude/models/overview'
      extras.push({ label: 'Precios', url: 'https://www.anthropic.com/pricing#api' })
      break

    case 'openai':
      primary = `https://platform.openai.com/docs/models/${encodeURIComponent(id)}`
      primaryKind = 'model'
      extras.push({ label: 'Precios', url: 'https://openai.com/api/pricing/' })
      break

    case 'google':
      primary = 'https://ai.google.dev/gemini-api/docs/models'
      extras.push({ label: 'Precios', url: 'https://ai.google.dev/pricing' })
      break

    case 'openrouter':
      // OpenRouter usa el id completo con el proveedor delante.
      primary = `https://openrouter.ai/${modelId}`
      primaryKind = 'model'
      break

    case 'groq':
      primary = `https://console.groq.com/docs/model/${encodeURIComponent(id)}`
      primaryKind = 'model'
      break

    case 'deepseek':
      primary = 'https://api-docs.deepseek.com/quick_start/pricing'
      break

    case 'xai':
      primary = `https://docs.x.ai/docs/models/${encodeURIComponent(id)}`
      primaryKind = 'model'
      break

    case 'mistral':
      primary = 'https://docs.mistral.ai/getting-started/models/models_overview/'
      break

    case 'together':
      primary = `https://api.together.ai/models/${encodeURIComponent(id)}`
      primaryKind = 'model'
      break

    case 'fireworks':
      primary = `https://app.fireworks.ai/models/fireworks/${encodeURIComponent(id)}`
      primaryKind = 'model'
      break

    case 'cerebras':
      primary = 'https://inference-docs.cerebras.ai/models/overview'
      break

    case 'perplexity':
      primary = 'https://docs.perplexity.ai/getting-started/models'
      break

    case 'cohere':
      primary = 'https://docs.cohere.com/docs/models'
      break

    case 'moonshot':
      primary = 'https://platform.moonshot.ai/docs/pricing/chat'
      break

    case 'zhipu':
      primary = 'https://docs.z.ai/guides/llm/overview'
      break

    case 'dashscope':
      primary = 'https://www.alibabacloud.com/help/en/model-studio/models'
      break

    case 'nvidia':
      primary = `https://build.nvidia.com/search?q=${encodeURIComponent(id)}`
      primaryKind = 'model'
      break

    case 'sambanova':
      primary = 'https://docs.sambanova.ai/cloud/docs/get-started/supported-models'
      break

    case 'nebius':
      primary = `https://studio.nebius.com/models/${encodeURIComponent(id)}`
      primaryKind = 'model'
      break

    case 'hyperbolic':
      primary = 'https://app.hyperbolic.ai/models'
      break

    case 'huggingface':
      // Aquí el id ya es el repositorio: el enlace es exacto.
      primary = `https://huggingface.co/${modelId}`
      primaryKind = 'model'
      break

    case 'github-models':
      primary = `https://github.com/marketplace/models/search?query=${encodeURIComponent(id)}`
      primaryKind = 'model'
      break

    case 'azure-openai':
      primary = 'https://learn.microsoft.com/azure/ai-foundry/openai/concepts/models'
      break

    case 'ollama':
      // El nombre lleva la etiqueta detrás: ollama.com/library/qwen3:8b
      primary = `https://ollama.com/library/${encodeURIComponent(id.split(':')[0])}`
      primaryKind = 'model'
      extras.push({ label: 'Buscar los pesos en Hugging Face', url: hf(family(id)) })
      break

    case 'lmstudio':
      primary = `https://lmstudio.ai/models?search=${encodeURIComponent(family(id))}`
      primaryKind = 'model'
      extras.push({ label: 'Buscar los pesos en Hugging Face', url: hf(family(id)) })
      break

    default:
      // Motores locales y cualquier proveedor que no tenga ficha propia: el
      // modelo es un fichero de pesos, así que lo útil es Hugging Face.
      if (def?.local) {
        primary = hf(family(id))
        primaryKind = 'model'
      } else {
        primary = def?.docsUrl ?? hf(family(id))
      }
  }

  if (def?.docsUrl && !primary.startsWith(def.docsUrl)) {
    extras.push({ label: `Web de ${def.name}`, url: def.docsUrl })
  }
  if (!def?.local && providerId !== 'huggingface' && providerId !== 'openrouter') {
    extras.push({ label: 'Comparar en OpenRouter', url: `https://openrouter.ai/models?q=${encodeURIComponent(family(id))}` })
  }

  return { primary, primaryKind, extras }
}
