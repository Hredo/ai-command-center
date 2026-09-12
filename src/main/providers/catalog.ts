import type { ProviderDef } from '@shared/types'

/**
 * Catálogo de proveedores. Casi todos hablan el protocolo de OpenAI, así que
 * el motor sólo implementa 4 dialectos reales: anthropic, openai, google y ollama.
 */
export const PROVIDERS: ProviderDef[] = [
  // ---------- Nube ----------
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    modelsPath: '/v1/models',
    envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    local: false,
    docsUrl: 'https://console.anthropic.com/settings/keys',
    slugs: ['claude']
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    envKeys: ['OPENAI_API_KEY'],
    local: false,
    docsUrl: 'https://platform.openai.com/api-keys',
    slugs: ['gpt', 'o1', 'o3', 'o4']
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsPath: '/models',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    local: false,
    docsUrl: 'https://aistudio.google.com/apikey',
    slugs: ['gemini']
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    envKeys: ['OPENROUTER_API_KEY'],
    local: false,
    docsUrl: 'https://openrouter.ai/keys',
    notes: 'Una sola key para cientos de modelos. Su catálogo público alimenta la pestaña Modelos.'
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsPath: '/models',
    envKeys: ['GROQ_API_KEY'],
    local: false,
    docsUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    modelsPath: '/models',
    envKeys: ['DEEPSEEK_API_KEY'],
    local: false,
    docsUrl: 'https://platform.deepseek.com/api_keys',
    slugs: ['deepseek']
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    modelsPath: '/models',
    envKeys: ['XAI_API_KEY', 'GROK_API_KEY'],
    local: false,
    docsUrl: 'https://console.x.ai',
    slugs: ['grok']
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsPath: '/models',
    envKeys: ['MISTRAL_API_KEY'],
    local: false,
    docsUrl: 'https://console.mistral.ai/api-keys',
    slugs: ['mistral', 'magistral', 'ministral', 'codestral']
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    modelsPath: '/models',
    envKeys: ['TOGETHER_API_KEY'],
    local: false,
    docsUrl: 'https://api.together.ai/settings/api-keys'
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    kind: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    modelsPath: '/models',
    envKeys: ['FIREWORKS_API_KEY'],
    local: false,
    docsUrl: 'https://fireworks.ai/account/api-keys'
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    modelsPath: '/models',
    envKeys: ['CEREBRAS_API_KEY'],
    local: false,
    docsUrl: 'https://cloud.cerebras.ai'
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    kind: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    envKeys: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY'],
    local: false,
    docsUrl: 'https://www.perplexity.ai/settings/api',
    slugs: ['sonar']
  },
  {
    id: 'cohere',
    name: 'Cohere',
    kind: 'openai',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    modelsPath: '/models',
    envKeys: ['COHERE_API_KEY', 'CO_API_KEY'],
    local: false,
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    slugs: ['command']
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    modelsPath: '/models',
    envKeys: ['MOONSHOT_API_KEY'],
    local: false,
    slugs: ['kimi', 'moonshot']
  },
  {
    id: 'zhipu',
    name: 'Z.ai / Zhipu (GLM)',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    envKeys: ['ZHIPUAI_API_KEY', 'ZAI_API_KEY', 'GLM_API_KEY'],
    local: false,
    slugs: ['glm']
  },
  {
    id: 'dashscope',
    name: 'Alibaba Qwen',
    kind: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    modelsPath: '/models',
    envKeys: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    local: false,
    slugs: ['qwen']
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    kind: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    modelsPath: '/models',
    envKeys: ['NVIDIA_API_KEY'],
    local: false
  },
  {
    id: 'sambanova',
    name: 'SambaNova',
    kind: 'openai',
    baseUrl: 'https://api.sambanova.ai/v1',
    modelsPath: '/models',
    envKeys: ['SAMBANOVA_API_KEY'],
    local: false
  },
  {
    id: 'nebius',
    name: 'Nebius AI Studio',
    kind: 'openai',
    baseUrl: 'https://api.studio.nebius.ai/v1',
    modelsPath: '/models',
    envKeys: ['NEBIUS_API_KEY'],
    local: false
  },
  {
    id: 'hyperbolic',
    name: 'Hyperbolic',
    kind: 'openai',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    modelsPath: '/models',
    envKeys: ['HYPERBOLIC_API_KEY'],
    local: false
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    kind: 'openai',
    baseUrl: 'https://router.huggingface.co/v1',
    modelsPath: '/models',
    envKeys: ['HF_TOKEN', 'HUGGINGFACE_API_KEY', 'HUGGING_FACE_HUB_TOKEN'],
    local: false,
    docsUrl: 'https://huggingface.co/settings/tokens'
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    kind: 'openai',
    baseUrl: 'https://models.github.ai/inference',
    modelsPath: '/models',
    envKeys: ['GITHUB_TOKEN', 'GITHUB_MODELS_TOKEN'],
    local: false
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    kind: 'openai',
    baseUrl: '',
    envKeys: ['AZURE_OPENAI_API_KEY'],
    local: false,
    notes: 'Requiere poner tu endpoint completo en Ajustes (https://TU-RECURSO.openai.azure.com/openai/v1).'
  },

  // ---------- Local ----------
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    modelsPath: '/api/tags',
    envKeys: ['OLLAMA_HOST'],
    local: true,
    port: 11434,
    docsUrl: 'https://ollama.com',
    notes: 'Reporta tokens/s reales medidos por el propio motor.'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 1234
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp server',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8080/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 8080
  },
  {
    id: 'vllm',
    name: 'vLLM',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 8000
  },
  {
    id: 'jan',
    name: 'Jan',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1337/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 1337
  },
  {
    id: 'localai',
    name: 'LocalAI',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8081/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 8081
  },
  {
    id: 'gpt4all',
    name: 'GPT4All',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:4891/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 4891
  },
  {
    id: 'koboldcpp',
    name: 'KoboldCpp',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:5001/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 5001
  },
  {
    id: 'textgen',
    name: 'Text generation WebUI',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:5000/v1',
    modelsPath: '/models',
    envKeys: [],
    local: true,
    port: 5000
  }
]

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** Adivina el proveedor a partir del id del modelo (para el catálogo global). */
export function guessProvider(modelId: string): string | undefined {
  const lower = modelId.toLowerCase()
  for (const p of PROVIDERS) {
    for (const s of p.slugs ?? []) if (lower.includes(s)) return p.id
  }
  return undefined
}

/** URL base efectiva teniendo en cuenta overrides del usuario. */
export function effectiveBaseUrl(def: ProviderDef, override?: string): string {
  const raw = (override || def.baseUrl || '').trim()
  return raw.replace(/\/+$/, '')
}
