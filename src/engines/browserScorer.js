/**
 * PET v2 — Browser-Native ML Scorer
 * Approximates complex metrics entirely in the browser (zero server dependency).
 * Falls back to this when backend is offline or V2 routing is active without backend.
 */

// Simple english stop words
const STOP = new Set([
  'i','a','an','the','is','are','was','to','of','and','or','in','on',
  'at','for','with','this','it','my','we','do','be','by','you','your',
  'can','will','would','should','could','have','has','had','just','also',
  'what','when','where','how','why','who','which'
])

// Extract keywords
function getKeywords(text) {
  if (!text) return []
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
}

// Jaccard similarity
function jaccardSim(qKw, rKw) {
  if (!qKw.length) return 0
  const qSet = new Set(qKw)
  const rSet = new Set(rKw)
  let inter = 0
  for (const w of qSet) {
    if (rSet.has(w)) inter++
  }
  return inter / Math.max(qSet.size + rSet.size - inter, 1)
}

// Pseudo ROUGE-1 precision/recall
function pseudoRouge(qKw, rKw) {
  if (!qKw.length) return { p: 0, r: 0, f1: 0 }
  const qSet = new Set(qKw)
  const rSet = new Set(rKw)
  
  let hits = 0
  for (const w of qSet) {
    if (rSet.has(w)) hits++
  }
  
  const precision = hits / Math.max(rSet.size, 1)
  const recall    = hits / Math.max(qSet.size, 1)
  const f1        = 2 * precision * recall / Math.max(precision + recall, 0.001)
  
  return { p: precision, r: recall, f1 }
}

export function evaluateLocal(question, response) {
  if (!question || !response || response.trim().length < 20) {
    return {
      score: 10,
      grade: 'F',
      covered: [],
      missing: ['Response is empty or too short'],
      next_prompt: 'Please provide a complete answer to my question.',
      should_stop: false
    }
  }

  const qKw = getKeywords(question)
  const rKw = getKeywords(response)
  
  const jaccard = jaccardSim(qKw, rKw)
  const rouge = pseudoRouge(qKw, rKw)
  
  // Base coverage score (0-100)
  let baseScore = Math.min(100, Math.round((jaccard * 0.4 + rouge.f1 * 0.6) * 100))
  
  // Length heuristic
  const wordCount = response.split(/\s+/).length
  if (wordCount > 300) baseScore += 15
  else if (wordCount > 100) baseScore += 8
  
  // Structure heuristics
  if (/\n[*-]\s|\n\d+\.\s/.test(response)) baseScore += 10 // Uses lists
  if (/```[\s\S]*?```/.test(response)) baseScore += 15     // Uses code blocks
  if (/\d+[%$]/.test(response)) baseScore += 5             // Uses numbers/data

  const finalScore = Math.max(20, Math.min(95, baseScore))
  
  // Find missing concepts
  const missingWords = qKw.filter(w => !rKw.includes(w)).slice(0, 3)
  const coveredWords = qKw.filter(w => rKw.includes(w)).slice(0, 3)
  
  return {
    score: finalScore,
    grade: finalScore >= 85 ? 'A' : finalScore >= 70 ? 'B' : finalScore >= 55 ? 'C' : 'D',
    covered: coveredWords.length ? coveredWords.map(w => `Addressed "${w}"`) : ['General topic'],
    missing: missingWords.length ? missingWords.map(w => `Missed "${w}"`) : [],
    next_prompt: missingWords.length 
      ? `You missed the context around "${missingWords.join('", "')}". Please expand on that specifically.`
      : `Can you provide a more concrete example or apply this to a real-world scenario?`,
    should_stop: finalScore >= 85 && missingWords.length === 0
  }
}
