/**
 * PET v2 — RLHF Self-Learning Engine
 * Collects positive/negative signals when users interact with rewrites.
 * Builds a Bayesian preference model per domain+technique locally.
 * No server needed — all stored in chrome.storage.local.
 *
 * Preference model: P(technique|domain) += weight on positive signal
 * After 10+ signals PET can auto-recommend based on YOUR history.
 */

const STORE_KEY    = 'pet_rlhf'
const MAX_SIGNALS  = 500
const MIN_SIGNALS_FOR_PREF = 10  // need this many to trust recommendations

// ── Signal recording ───────────────────────────────────────────────────────

/**
 * Call when user clicks "Use" on a rewrite — strong positive signal.
 */
export function signalPositive(rewrite, originalPrompt, provider) {
  _record({
    type:     'positive',
    weight:   1.0,
    technique: rewrite.technique || '',
    label:     rewrite.label || '',
    domain:    rewrite.domain || 'general',
    provider:  provider || 'unknown',
    promptLen: (originalPrompt || '').length,
    score:     rewrite.score || null,
    ts:        Date.now(),
  })
}

/**
 * Call when user clicks "↺ Vary" — implicit negative signal (mild).
 */
export function signalNegative(rewrite, originalPrompt, provider) {
  _record({
    type:     'negative',
    weight:   0.4,
    technique: rewrite.technique || '',
    label:     rewrite.label || '',
    domain:    rewrite.domain || 'general',
    provider:  provider || 'unknown',
    promptLen: (originalPrompt || '').length,
    score:     rewrite.score || null,
    ts:        Date.now(),
  })
}

/**
 * Call when user clicks "Copy" — lighter positive signal.
 */
export function signalCopy(rewrite, originalPrompt, provider) {
  _record({
    type:     'copy',
    weight:   0.6,
    technique: rewrite.technique || '',
    label:     rewrite.label || '',
    domain:    rewrite.domain || 'general',
    provider:  provider || 'unknown',
    promptLen: (originalPrompt || '').length,
    score:     rewrite.score || null,
    ts:        Date.now(),
  })
}

function _record(signal) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  chrome.storage.local.get(STORE_KEY, data => {
    const store = data[STORE_KEY] || { signals: [], bayes: {} }
    store.signals.push(signal)
    if (store.signals.length > MAX_SIGNALS) {
      store.signals = store.signals.slice(-MAX_SIGNALS)
    }
    // Update Bayesian counts inline
    store.bayes = _rebuildBayes(store.signals)
    chrome.storage.local.set({ [STORE_KEY]: store })
  })
}

// ── Bayesian preference model ──────────────────────────────────────────────

/**
 * Rebuild the preference table from raw signals.
 * bayes[domain][technique] = { pos, neg, score }
 */
function _rebuildBayes(signals) {
  const counts = {}
  for (const s of signals) {
    const d = s.domain || 'general'
    const t = s.technique || ''
    if (!t) continue
    if (!counts[d]) counts[d] = {}
    if (!counts[d][t]) counts[d][t] = { pos: 0, neg: 0 }
    if (s.type === 'positive') counts[d][t].pos += s.weight
    else if (s.type === 'copy') counts[d][t].pos += s.weight
    else if (s.type === 'negative') counts[d][t].neg += s.weight
  }
  // Compute score = pos / (pos + neg + smoothing)
  const bayes = {}
  for (const [domain, techs] of Object.entries(counts)) {
    bayes[domain] = {}
    for (const [tech, c] of Object.entries(techs)) {
      const total = c.pos + c.neg + 2  // Laplace smoothing
      bayes[domain][tech] = {
        score: c.pos / total,
        pos:   c.pos,
        neg:   c.neg,
      }
    }
  }
  return bayes
}

// ── Read preferences ───────────────────────────────────────────────────────

/**
 * Get the ranked technique preferences for a domain.
 * Returns array sorted by preference score descending.
 * Only returns results if enough signals exist.
 */
export async function getBayesPreferences(domain) {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return resolve([])
    }
    chrome.storage.local.get(STORE_KEY, data => {
      const store = data[STORE_KEY] || { signals: [], bayes: {} }
      const totalSignals = store.signals.length
      if (totalSignals < MIN_SIGNALS_FOR_PREF) {
        return resolve([])
      }
      const domainData = store.bayes[domain] || store.bayes['general'] || {}
      const ranked = Object.entries(domainData)
        .map(([technique, c]) => ({ technique, ...c }))
        .sort((a, b) => b.score - a.score)
      resolve(ranked)
    })
  })
}

/**
 * Get the single most-preferred technique for a domain.
 * Returns null if not enough data yet.
 */
export async function getRecommendedTechnique(domain) {
  const prefs = await getBayesPreferences(domain)
  return prefs[0] || null
}

/**
 * Get overall RLHF stats for display in Dashboard.
 */
export async function getRLHFStats() {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return resolve({ total: 0, positive: 0, negative: 0, copy: 0, topTechnique: null, topProvider: null })
    }
    chrome.storage.local.get(STORE_KEY, data => {
      const store = data[STORE_KEY] || { signals: [] }
      const signals = store.signals

      const pos  = signals.filter(s => s.type === 'positive').length
      const neg  = signals.filter(s => s.type === 'negative').length
      const copy = signals.filter(s => s.type === 'copy').length

      // Top technique by positive signals
      const techCounts = {}
      const provCounts = {}
      for (const s of signals) {
        if (s.type === 'positive' || s.type === 'copy') {
          if (s.technique) techCounts[s.technique] = (techCounts[s.technique] || 0) + 1
          if (s.provider)  provCounts[s.provider]  = (provCounts[s.provider]  || 0) + 1
        }
      }
      const topTechnique = Object.entries(techCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || null
      const topProvider  = Object.entries(provCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || null

      resolve({
        total:        signals.length,
        positive:     pos,
        negative:     neg,
        copy,
        topTechnique,
        topProvider,
        hasEnoughData: signals.length >= MIN_SIGNALS_FOR_PREF,
      })
    })
  })
}

/**
 * Clear all RLHF data (for testing / user reset).
 */
export function clearRLHF() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.remove(STORE_KEY)
  }
}
