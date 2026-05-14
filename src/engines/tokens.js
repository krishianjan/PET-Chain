import selectorsConfig from '../../selectors.config.json'

const MODEL_LIMITS = {
  'gpt-4o': 128000, 'gpt-4-turbo': 128000, 'gpt-4': 8192, 'gpt-3.5-turbo': 16385,
  'claude-3-5-sonnet': 200000, 'claude-3-opus': 200000, 'claude-3-haiku': 200000,
  'gemini-1.5-pro': 1000000, 'gemini-1.5-flash': 1000000, 'gemini-1.0-pro': 32768,
}

const DIVISORS = { chatgpt: 4, claude: 3.5, gemini: 4 }

export function estimateTokens(text, platform = 'chatgpt') {
  if (!text) return 0
  return Math.round(text.length / (DIVISORS[platform] || 4))
}

export function detectModel(platform) {
  const sel = selectorsConfig.platforms[platform]?.model
  const el = sel && document.querySelector(sel)
  const txt = (el?.textContent || '').toLowerCase()
  
  for (const m of Object.keys(MODEL_LIMITS)) {
    if (txt.includes(m.replace(/-/g, ' '))) return m
  }
  
  return platform === 'claude' ? 'claude-3-5-sonnet'
       : platform === 'gemini' ? 'gemini-1.5-flash'
       : 'gpt-4o'
}

export function getContextUsage(platform) {
  const sel = selectorsConfig.platforms[platform]
  if (!sel) return { used: 0, limit: 128000, pct: 0, model: 'unknown' }
  
  const msgs = document.querySelectorAll(`${sel.response}, ${sel.textarea}`)
  let chars = 0
  msgs.forEach(m => chars += (m.textContent || '').length)
  
  const model = detectModel(platform)
  const limit = MODEL_LIMITS[model] || 128000
  const used = estimateTokens(' '.repeat(chars), platform)
  
  return { 
    used, 
    limit, 
    model, 
    pct: Math.min(100, Math.round((used / limit) * 100)) 
  }
}

export function tokenSavings(original, rewritten, platform) {
  const o = estimateTokens(original, platform)
  const r = estimateTokens(rewritten, platform)
  return { 
    original: o, 
    rewritten: r, 
    saved: Math.max(0, o - r), 
    pct: Math.round(Math.max(0, o - r) / Math.max(o, 1) * 100) 
  }
}
