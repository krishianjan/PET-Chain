export function buildEvalMetaPrompt(originalPrompt, llmResponse) {
  return {
    system: `You are a response quality evaluator. Output ONLY valid JSON. No explanation.`,

    user: `Evaluate this LLM response.

Question asked: "${originalPrompt.slice(0, 500)}"
Response received: "${llmResponse.slice(0, 1500)}"

Score the response on 3 axes (0-33 each, total 0-100):
- Completeness: Does it fully answer the question?
- Structure: Is it organized and easy to follow?
- Specificity: Does it include concrete details, examples, or numbers?

Then identify the single biggest gap and write the ONE best follow-up prompt to fix it.

Output this exact JSON (no other text):
{
  "score": 74,
  "breakdown": { "completeness": 25, "structure": 28, "specificity": 21 },
  "gap": "Missing concrete examples",
  "next_prompt": "Give me 3 specific real-world examples of this, each in 2 sentences"
}`
  }
}

export function parseEval(rawJSON) {
  try {
    const clean = rawJSON.replace(/```json|```/g, '').trim()
    const data = JSON.parse(clean)
    return {
      score: Math.min(100, Math.max(0, data.score || 0)),
      breakdown: data.breakdown || {},
      gap: data.gap || '',
      next_prompt: data.next_prompt || ''
    }
  } catch {
    return ruleBased(rawJSON)
  }
}

function ruleBased(text) {
  let score = 0
  const words = text.split(/\s+/).length
  if (words > 80) score += 33
  else if (words > 30) score += 16
  if (/(\n[-*•]|\n\d+\.)/m.test(text)) score += 33
  if (/\d+|for example|such as/i.test(text)) score += 33
  return { score: Math.min(99, score), breakdown: {}, gap: 'Limited analysis (offline mode)', next_prompt: '' }
}

export function scoreToState(score) {
  if (score >= 90) return 'celebrating'  // lovebirds fly
  if (score >= 70) return 'happy'         // dog tail shake
  if (score >= 50) return 'analyzing'     // cat playing wool (neutral)
  return 'error'                           // cat 404
}
