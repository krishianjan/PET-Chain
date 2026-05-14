// Chrome-native storage — no polyfill needed in MV3
const KEY = 'pet_metrics_v1'

const DEFAULTS = {
  schema:            1,
  sessions:          0,
  prompts_rewritten: 0,
  tokens_saved:      0,
  avg_score:         0,
  score_history:     [],   // last 100 scores
  technique_counts:  {},   // { 'Chain of Thought': 3, ... }
  task_type_counts:  {},   // { 'finance': 2, ... }
  inject_count:      0,    // times user clicked "Use Prompt"
  last_active:       0,    // epoch ms
}

function get() {
  return new Promise(res =>
    chrome.storage.local.get(KEY, r => res({ ...DEFAULTS, ...(r[KEY] || {}) }))
  )
}
function save(m) {
  m.last_active = Date.now()
  return new Promise(res => chrome.storage.local.set({ [KEY]: m }, res))
}

export async function getMetrics() { return get() }

export async function recordSession() {
  const m = await get()
  // Deduplicate — only count a new session if last activity > 30 min ago
  if (Date.now() - m.last_active > 30 * 60 * 1000) {
    m.sessions++
    await save(m)
  }
}

export async function recordRewrite({ tokensSaved = 0, technique = '', taskType = '' } = {}) {
  const m = await get()
  m.prompts_rewritten++
  m.tokens_saved += Math.round(tokensSaved)
  if (technique) m.technique_counts[technique] = (m.technique_counts[technique] || 0) + 1
  if (taskType)  m.task_type_counts[taskType]  = (m.task_type_counts[taskType]  || 0) + 1
  await save(m)
}

export async function recordScore(score) {
  if (typeof score !== 'number') return
  const m = await get()
  m.score_history = [...m.score_history.slice(-99), score]
  m.avg_score     = Math.round(m.score_history.reduce((a, b) => a + b, 0) / m.score_history.length)
  await save(m)
}

export async function recordInject() {
  const m = await get()
  m.inject_count = (m.inject_count || 0) + 1
  await save(m)
}
