export function scoreResponse(question, response) {
  let score = 0
  const issues = []

  // 1. Length/Depth
  const words = response.trim().split(/\s+/).length
  if (words > 120) {
    score += 40
  } else if (words > 40) {
    score += 20
    issues.push('Response is a bit short')
  } else {
    issues.push('Response is very brief')
  }

  // 2. Structure (Check for lists or headers)
  if (/(\n[-*•]|\n\d+\.|\n#+ )/m.test(response)) {
    score += 30
  } else {
    issues.push('Lacks clear structure (no lists or sections)')
  }

  // 3. Specificity (Check for numbers, dates, or examples)
  if (/\d+|for example|specifically|such as|instance/i.test(response)) {
    score += 30
  } else {
    issues.push('Lacks concrete examples or data')
  }

  // 4. Content match check
  const qKeywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 4)
  const matches = qKeywords.filter(k => response.toLowerCase().includes(k))
  if (matches.length === 0 && qKeywords.length > 0) {
    score = Math.max(0, score - 20)
    issues.push('Might be off-topic (keywords not found)')
  }

  return {
    score: Math.min(100, score),
    issues,
    next_prompt: issues.length > 0 
      ? `Can you expand on the ${issues[0].toLowerCase()}? Give me more detail and examples.`
      : 'This looks good! Can you summarize the key takeaways in 3 bullets?'
  }
}