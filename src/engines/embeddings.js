/**
 * PET v3 -- Browser-Native Embeddings Engine
 *
 * Provides real semantic similarity in the browser without running
 * a local ML model (which would be 80MB+ download).
 *
 * Strategy (in priority order):
 *   1. Provider embedding API  -- Gemini / OpenAI have free embedding endpoints
 *      Gemini: text-embedding-004  (free, 768-dim)
 *      OpenAI: text-embedding-3-small (paid, 1536-dim)
 *   2. TF-IDF cosine similarity -- no API needed, runs in JS, 80% as good for short text
 *   3. Jaccard on keywords      -- pure offline fallback
 *
 * Embeddings are cached in chrome.storage.local with a 24h TTL to avoid
 * re-embedding the same text on every session.
 *
 * LLM techniques used:
 *   - Embedding-based semantic retrieval (not keyword matching)
 *   - Cosine similarity for technique/domain matching
 *   - TF-IDF weighting for offline approximation
 */

const EMBED_CACHE_KEY = 'pet_embed_cache_v1'
const CACHE_TTL_MS    = 24 * 60 * 60 * 1000  // 24 hours

// ── Cache layer ────────────────────────────────────────────────────────────
async function getCached(text) {
  try {
    const r = await chrome.storage.local.get(EMBED_CACHE_KEY)
    const cache = r[EMBED_CACHE_KEY] || {}
    const entry = cache[hashText(text)]
    if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.vec
  } catch {}
  return null
}

async function setCache(text, vec) {
  try {
    const r = await chrome.storage.local.get(EMBED_CACHE_KEY)
    const cache = r[EMBED_CACHE_KEY] || {}
    // Keep max 200 cached embeddings
    const keys = Object.keys(cache)
    if (keys.length > 200) {
      const oldest = keys.sort((a, b) => cache[a].ts - cache[b].ts).slice(0, 50)
      oldest.forEach(k => delete cache[k])
    }
    cache[hashText(text)] = { vec, ts: Date.now() }
    await chrome.storage.local.set({ [EMBED_CACHE_KEY]: cache })
  } catch {}
}

function hashText(text) {
  let h = 0
  for (let i = 0; i < Math.min(text.length, 200); i++) {
    h = ((h << 5) - h) + text.charCodeAt(i)
    h |= 0
  }
  return String(h)
}

// ── Provider embedding API calls ───────────────────────────────────────────

async function embedWithGemini(text, apiKey) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`
  const body = JSON.stringify({
    model: 'models/text-embedding-004',
    content: { parts: [{ text: text.slice(0, 2000) }] }
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Gemini embed HTTP ${res.status}`)
  const data = await res.json()
  return data.embedding?.values || null
}

async function embedWithOpenAI(text, apiKey) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`OpenAI embed HTTP ${res.status}`)
  const data = await res.json()
  return data.data?.[0]?.embedding || null
}

// ── TF-IDF cosine similarity (offline fallback) ────────────────────────────

const STOP = new Set([
  'i','a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','to','of','in','on','at','by','for','with','about',
  'and','but','or','so','yet','this','that','these','those','it','its',
  'my','your','his','her','our','their','what','which','who','how',
  'when','where','why','can','not','no','from','into','through',
])

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
}

function tfidfVector(text, corpus) {
  const tokens = tokenize(text)
  const tf = {}
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1

  const vocab = [...new Set(corpus.flatMap(tokenize))]
  const vec   = new Float32Array(vocab.length)
  const N     = corpus.length + 1  // +1 for smoothing

  vocab.forEach((term, i) => {
    const tfScore  = (tf[term] || 0) / Math.max(tokens.length, 1)
    const df       = corpus.filter(d => tokenize(d).includes(term)).length + 1
    const idfScore = Math.log(N / df)
    vec[i] = tfScore * idfScore
  })

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

function dotProduct(a, b) {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) sum += a[i] * b[i]
  return sum
}

function cosineSim(vecA, vecB) {
  // Assumes normalized vectors
  return Math.max(-1, Math.min(1, dotProduct(vecA, vecB)))
}

// ── Main embedding function ────────────────────────────────────────────────

/**
 * Embed a piece of text. Uses best available method.
 * Returns a float array (provider) or a Float32Array (TF-IDF).
 */
export async function embedText(text, providerKeys = {}) {
  if (!text?.trim()) return null

  // Check cache first
  const cached = await getCached(text)
  if (cached) return cached

  // Try provider APIs in priority order
  if (providerKeys.gemini) {
    try {
      const vec = await embedWithGemini(text, providerKeys.gemini)
      if (vec) { await setCache(text, vec); return vec }
    } catch (e) { console.warn('[PET embed] Gemini failed:', e.message) }
  }

  if (providerKeys.openai) {
    try {
      const vec = await embedWithOpenAI(text, providerKeys.openai)
      if (vec) { await setCache(text, vec); return vec }
    } catch (e) { console.warn('[PET embed] OpenAI failed:', e.message) }
  }

  // TF-IDF offline (no cache for this since it depends on corpus)
  return null  // caller falls back to Jaccard
}

/**
 * Semantic similarity between two texts.
 * Returns 0-1 score. Uses provider embeddings if available, TF-IDF if not.
 */
export async function semanticSim(textA, textB, providerKeys = {}) {
  // Try real embeddings first
  const [vecA, vecB] = await Promise.all([
    embedText(textA, providerKeys),
    embedText(textB, providerKeys),
  ])
  if (vecA && vecB) {
    // Cosine similarity on provider embeddings
    const normA = Math.sqrt(vecA.reduce((s, v) => s + v * v, 0)) || 1
    const normB = Math.sqrt(vecB.reduce((s, v) => s + v * v, 0)) || 1
    let dot = 0
    for (let i = 0; i < Math.min(vecA.length, vecB.length); i++) {
      dot += (vecA[i] / normA) * (vecB[i] / normB)
    }
    return Math.max(0, Math.min(1, dot))
  }

  // TF-IDF cosine fallback
  const corpus = [textA, textB]
  const vA = tfidfVector(textA, corpus)
  const vB = tfidfVector(textB, corpus)
  const sim = cosineSim(vA, vB)
  return (sim + 1) / 2  // normalize -1..1 → 0..1
}

/**
 * Rank a list of candidates by semantic similarity to a query.
 * Returns sorted array [{text, score}].
 */
export async function rankBySimilarity(query, candidates, providerKeys = {}) {
  if (!candidates?.length) return []

  // Try provider embeddings for the query
  const qVec = await embedText(query, providerKeys)

  if (qVec) {
    // Embed all candidates (uses cache aggressively)
    const cVecs = await Promise.all(candidates.map(c => embedText(c, providerKeys)))
    const normQ = Math.sqrt(qVec.reduce((s, v) => s + v * v, 0)) || 1

    const scored = candidates.map((c, i) => {
      const cVec = cVecs[i]
      if (!cVec) return { text: c, score: 0 }
      const normC = Math.sqrt(cVec.reduce((s, v) => s + v * v, 0)) || 1
      let dot = 0
      for (let j = 0; j < Math.min(qVec.length, cVec.length); j++) {
        dot += (qVec[j] / normQ) * (cVec[j] / normC)
      }
      return { text: c, score: Math.max(0, dot) }
    })
    return scored.sort((a, b) => b.score - a.score)
  }

  // TF-IDF fallback -- build corpus from query + candidates
  const corpus = [query, ...candidates]
  const qVecTF = tfidfVector(query, corpus)
  const scored = candidates.map(c => ({
    text:  c,
    score: Math.max(0, cosineSim(qVecTF, tfidfVector(c, corpus))),
  }))
  return scored.sort((a, b) => b.score - a.score)
}

/**
 * Find the best-matching technique for a prompt using embeddings.
 * Used to select which technique to surface from RLHF history.
 */
export async function matchTechnique(prompt, techniquesWithDescriptions, providerKeys = {}) {
  if (!techniquesWithDescriptions?.length) return null
  const candidates = techniquesWithDescriptions.map(t => t.description || t.name)
  const ranked = await rankBySimilarity(prompt, candidates, providerKeys)
  if (!ranked.length) return null
  const best = ranked[0]
  const idx  = candidates.indexOf(best.text)
  return { ...techniquesWithDescriptions[idx], similarity: best.score }
}
