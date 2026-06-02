/**
 * PET v2 — Provider Registry
 * Single source of truth for all LLM provider metadata.
 * Adding a new provider = add one entry here. Zero other changes needed.
 *
 * CORS SAFETY NOTE:
 * - All providers listed as browser_safe: true can be called directly from service worker
 * - Claude browser_safe: false (Anthropic CORS policy) — routed via backend proxy OR
 *   using the anthropic-dangerous-direct-browser-access header (works in SW context)
 */

export const PROVIDERS = {
  // ── Google Gemini ──────────────────────────────────────────────────────
  gemini: {
    name: 'Google Gemini',
    icon: '✨',
    endpoint: 'https://generativelanguage.googleapis.com',
    keyPlaceholder: 'AIzaSy...',
    keyHint: 'Free at aistudio.google.com → Get API Key',
    keyLink: 'https://aistudio.google.com/app/apikey',
    browser_safe: true,
    free_tier: true,
    format: 'gemini',
    models: [
      { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', tier: 'fast',  ctx: 1000000, note: 'Best value · Free tier' },
      { id: 'gemini-2.5-pro-preview-06-05',   label: 'Gemini 2.5 Pro',   tier: 'smart', ctx: 1000000, note: 'Most powerful' },
      { id: 'gemini-2.0-flash',                label: 'Gemini 2.0 Flash', tier: 'fast',  ctx: 1048576, note: 'Fastest' },
      { id: 'gemini-1.5-flash',                label: 'Gemini 1.5 Flash', tier: 'fast',  ctx: 1048576, note: 'Stable' },
    ],
    default_fast:  'gemini-2.5-flash-preview-05-20',
    default_smart: 'gemini-2.5-flash-preview-05-20',
  },

  // ── OpenAI / GPT ───────────────────────────────────────────────────────
  openai: {
    name: 'OpenAI',
    icon: '🤖',
    endpoint: 'https://api.openai.com',
    keyPlaceholder: 'sk-proj-...',
    keyHint: 'platform.openai.com/api-keys',
    keyLink: 'https://platform.openai.com/api-keys',
    browser_safe: true,
    free_tier: false,
    format: 'openai',
    models: [
      { id: 'gpt-4o',           label: 'GPT-4o',         tier: 'smart', ctx: 128000,  note: 'Best quality' },
      { id: 'gpt-4o-mini',      label: 'GPT-4o Mini',    tier: 'fast',  ctx: 128000,  note: 'Best value' },
      { id: 'gpt-4.1',         label: 'GPT-4.1',        tier: 'smart', ctx: 1000000, note: 'Latest' },
      { id: 'gpt-4.1-mini',    label: 'GPT-4.1 Mini',   tier: 'fast',  ctx: 1000000, note: 'Fast + cheap' },
      { id: 'o4-mini',          label: 'o4-mini',         tier: 'smart', ctx: 200000,  note: 'Reasoning' },
    ],
    default_fast:  'gpt-4o-mini',
    default_smart: 'gpt-4o',
  },

  // ── Groq (ultra-fast inference) ───────────────────────────────────────
  groq: {
    name: 'Groq',
    icon: '⚡',
    endpoint: 'https://api.groq.com/openai',
    keyPlaceholder: 'gsk_...',
    keyHint: 'Free at console.groq.com — fastest inference',
    keyLink: 'https://console.groq.com/keys',
    browser_safe: true,
    free_tier: true,
    format: 'openai',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B',     tier: 'smart', ctx: 128000, note: 'Best Groq model · Free' },
      { id: 'llama-3-8b-8192',         label: 'Llama 3 8B',         tier: 'fast',  ctx: 8192,   note: 'Ultra fast · Free' },
      { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B',       tier: 'smart', ctx: 32768,  note: 'Good quality · Free' },
      { id: 'gemma2-9b-it',            label: 'Gemma 2 9B',         tier: 'fast',  ctx: 8192,   note: 'Google · Free' },
      { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1',  tier: 'smart', ctx: 128000, note: 'Reasoning · Free' },
    ],
    default_fast:  'llama-3-8b-8192',
    default_smart: 'llama-3.3-70b-versatile',
  },

  // ── Anthropic Claude ──────────────────────────────────────────────────
  claude: {
    name: 'Claude',
    icon: '🧠',
    endpoint: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'console.anthropic.com — excellent for nuanced writing',
    keyLink: 'https://console.anthropic.com/keys',
    browser_safe: true,  // via anthropic-dangerous-direct-browser-access header
    free_tier: false,
    format: 'claude',
    models: [
      { id: 'claude-sonnet-4-5',         label: 'Claude Sonnet 4.5', tier: 'smart', ctx: 200000, note: 'Best balance' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', tier: 'smart', ctx: 200000, note: 'Strong reasoning' },
      { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku',  tier: 'fast',  ctx: 200000, note: 'Fastest Claude' },
      { id: 'claude-opus-4',              label: 'Claude Opus 4',      tier: 'smart', ctx: 200000, note: 'Most capable' },
    ],
    default_fast:  'claude-3-5-haiku-20241022',
    default_smart: 'claude-sonnet-4-5',
  },

  // ── Grok / xAI ────────────────────────────────────────────────────────
  grok: {
    name: 'Grok (xAI)',
    icon: '𝕏',
    endpoint: 'https://api.x.ai',
    keyPlaceholder: 'xai-...',
    keyHint: 'console.x.ai — real-time web access',
    keyLink: 'https://console.x.ai',
    browser_safe: true,
    free_tier: false,
    format: 'openai',
    models: [
      { id: 'grok-3',        label: 'Grok 3',        tier: 'smart', ctx: 131072, note: 'Most capable' },
      { id: 'grok-3-mini',   label: 'Grok 3 Mini',   tier: 'fast',  ctx: 131072, note: 'Fast + cheap' },
      { id: 'grok-2-1212',   label: 'Grok 2',        tier: 'smart', ctx: 131072, note: 'Stable' },
      { id: 'grok-beta',     label: 'Grok Beta',     tier: 'smart', ctx: 131072, note: 'Latest features' },
    ],
    default_fast:  'grok-3-mini',
    default_smart: 'grok-3',
  },

  // ── OpenRouter (100+ models with one key) ──────────────────────────────
  openrouter: {
    name: 'OpenRouter',
    icon: '🌐',
    endpoint: 'https://openrouter.ai/api',
    keyPlaceholder: 'sk-or-...',
    keyHint: 'openrouter.ai/keys — access 100+ models with one key',
    keyLink: 'https://openrouter.ai/keys',
    browser_safe: true,
    free_tier: true,
    format: 'openai',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free)',  tier: 'smart', ctx: 128000, note: 'Free' },
      { id: 'microsoft/mai-ds-r1:free',                label: 'MAI DS R1 (Free)',      tier: 'smart', ctx: 163840, note: 'Free · Reasoning' },
      { id: 'moonshotai/kimi-k2:free',                 label: 'Kimi K2 (Free)',        tier: 'smart', ctx: 131072, note: 'Free · Kimi' },
      { id: 'google/gemini-2.0-flash-exp:free',        label: 'Gemini 2.0 Flash (Free)', tier: 'fast', ctx: 1048576, note: 'Free' },
      { id: 'qwen/qwen3-235b-a22b:free',               label: 'Qwen3 235B (Free)',     tier: 'smart', ctx: 40960,  note: 'Free' },
      { id: 'deepseek/deepseek-chat',                   label: 'DeepSeek Chat',         tier: 'smart', ctx: 163840, note: 'Cheap' },
      { id: 'anthropic/claude-3.5-sonnet',              label: 'Claude 3.5 Sonnet',     tier: 'smart', ctx: 200000, note: 'Via OpenRouter' },
      { id: 'openai/gpt-4o',                            label: 'GPT-4o',                tier: 'smart', ctx: 128000, note: 'Via OpenRouter' },
    ],
    default_fast:  'meta-llama/llama-3.3-70b-instruct:free',
    default_smart: 'meta-llama/llama-3.3-70b-instruct:free',
  },

  // ── DeepSeek ──────────────────────────────────────────────────────────
  deepseek: {
    name: 'DeepSeek',
    icon: '🔍',
    endpoint: 'https://api.deepseek.com',
    keyPlaceholder: 'sk-...',
    keyHint: 'platform.deepseek.com — best value for reasoning',
    keyLink: 'https://platform.deepseek.com/api_keys',
    browser_safe: true,
    free_tier: false,
    format: 'openai',
    models: [
      { id: 'deepseek-chat',    label: 'DeepSeek V3',         tier: 'smart', ctx: 163840, note: 'Best value' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1 Reasoner', tier: 'smart', ctx: 163840, note: 'Reasoning' },
    ],
    default_fast:  'deepseek-chat',
    default_smart: 'deepseek-chat',
  },

  // ── Ollama (local, private, free) ─────────────────────────────────────
  ollama: {
    name: 'Ollama (Local)',
    icon: '🦙',
    endpoint: 'http://localhost:11434',
    keyPlaceholder: '',
    keyHint: 'No key needed — runs on your machine. ollama.ai',
    keyLink: 'https://ollama.ai',
    browser_safe: true,
    free_tier: true,
    format: 'openai',
    models: [],  // populated dynamically via /api/tags
    default_fast:  null,  // set from detected models
    default_smart: null,
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Get endpoint URL for a provider */
export function getEndpoint(provider) {
  return PROVIDERS[provider]?.endpoint || ''
}

/** Get the appropriate model for a tier (fast/smart) */
export function getModel(provider, tier = 'smart', modelOverride = null) {
  if (modelOverride) return modelOverride
  const p = PROVIDERS[provider]
  if (!p) return ''
  return tier === 'fast' ? p.default_fast : p.default_smart
}

/** Get all providers as sorted array for UI rendering */
export function getProviderList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p }))
}

/** Get models for a specific provider */
export function getModelsForProvider(providerId) {
  return PROVIDERS[providerId]?.models || []
}

/** Determine the active provider from stored keys + user selection */
export function resolveActiveProvider(keys, userSelectedProvider) {
  // User explicitly selected a provider and it has a key
  if (userSelectedProvider && keys[userSelectedProvider]) {
    return userSelectedProvider
  }

  // Auto-select: prefer free-tier providers with keys set
  const priority = ['gemini', 'groq', 'openrouter', 'openai', 'claude', 'grok', 'deepseek', 'ollama']
  for (const id of priority) {
    const hasKey = id === 'ollama' ? !!keys.ollama_model : !!keys[id]
    if (hasKey) return id
  }

  return null  // no providers configured → offline mode
}

/** Human-readable provider label for status bar */
export function providerLabel(provider, model) {
  const p = PROVIDERS[provider]
  if (!p) return 'Offline'
  const modelInfo = p.models.find(m => m.id === model)
  const modelLabel = modelInfo?.label || model?.split('/').pop() || ''
  return `${p.icon} ${p.name}${modelLabel ? ` · ${modelLabel}` : ''}`
}
