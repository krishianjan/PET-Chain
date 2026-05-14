const STOP = new Set(['i', 'a', 'an', 'the', 'is', 'are', 'was', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'this', 'it', 'my', 'we', 'do', 'be', 'by', 'from', 'as'])

function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
}

function ngrams(tokens, n) {
    const result = []
    for (let i = 0; i <= tokens.length - n; i++) result.push(tokens.slice(i, i + n).join(' '))
    return result
}

// ROUGE-1 recall: how much of reference is in hypothesis
export function rouge1(reference, hypothesis) {
    const refTokens = tokenize(reference)
    const hypTokens = tokenize(hypothesis)
    if (!refTokens.length) return 0
    const overlap = refTokens.filter(t => hypTokens.includes(t)).length
    return overlap / refTokens.length
}

// ROUGE-2 (bigram overlap)
export function rouge2(reference, hypothesis) {
    const refBigrams = ngrams(tokenize(reference), 2)
    const hypBigrams = ngrams(tokenize(hypothesis), 2)
    if (!refBigrams.length) return 0
    const hypSet = new Set(hypBigrams)
    return refBigrams.filter(bg => hypSet.has(bg)).length / refBigrams.length
}

// BLEU-1 precision
export function bleu1(reference, hypothesis) {
    const refTokens = tokenize(reference)
    const hypTokens = tokenize(hypothesis)
    if (!hypTokens.length) return 0
    const refSet = new Set(refTokens)
    const matches = hypTokens.filter(t => refSet.has(t)).length
    return matches / hypTokens.length
}

// F1 on token overlap
export function f1Score(reference, hypothesis) {
    const refTokens = tokenize(reference)
    const hypTokens = tokenize(hypothesis)
    const refSet = new Set(refTokens)
    const hypSet = new Set(hypTokens)
    const tp = [...refSet].filter(t => hypSet.has(t)).length
    const precision = tp / Math.max(hypSet.size, 1)
    const recall = tp / Math.max(refSet.size, 1)
    const f1 = 2 * precision * recall / Math.max(precision + recall, 0.001)
    return { precision: round(precision), recall: round(recall), f1: round(f1) }
}

// Context relevance: does response address the question?
export function contextRelevance(question, response) {
    const qTokens = tokenize(question)
    const rTokens = tokenize(response)
    const rSet = new Set(rTokens)
    const covered = qTokens.filter(t => rSet.has(t)).length
    return round(covered / Math.max(qTokens.length, 1))
}

// Full evaluation report
export function evaluate(question, response) {
    if (!response || response.length < 10) {
        return { score: 0, grade: 'F', issues: ['Empty response'], metrics: {} }
    }

    const r1 = rouge1(question, response)
    const r2 = rouge2(question, response)
    const b1 = bleu1(question, response)
    const f1 = f1Score(question, response)
    const cr = contextRelevance(question, response)

    // Weighted composite score
    const composite = Math.round(
        (cr * 35) +   // context relevance is most important
        (r1 * 20) +   // unigram recall
        (r2 * 15) +   // bigram recall
        (f1.f1 * 20) + // precision+recall balance
        (b1 * 10)     // precision
    ) * 100

    const score = Math.max(15, Math.min(93, composite))

    // Grade
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F'

    // Specific issues
    const issues = []
    if (cr < 0.3) issues.push('Response doesn\'t address your specific question keywords')
    if (r2 < 0.1) issues.push('Low bigram overlap — answer may be off-topic')
    if (f1.precision < 0.2) issues.push('Response contains too many unrelated concepts')
    if (f1.recall < 0.3) issues.push('Response misses key topics from your question')
    const rWords = response.split(/\s+/).length
    if (rWords < 50) issues.push('Response is too brief')
    if (rWords > 600) issues.push('Response may be too verbose — ask for a summary')

    // Next prompt based on worst metric
    let next_prompt = ''
    if (cr < 0.3) next_prompt = `You didn't answer my question directly. Specifically address: ${tokenize(question).slice(0, 4).join(', ')}`
    else if (r2 < 0.1) next_prompt = `Stay focused on my original question. Don't generalize. Give me specific information about: ${question.slice(0, 60)}`
    else if (f1.recall < 0.3) next_prompt = `You missed these key aspects: ${tokenize(question).filter(w => !tokenize(response).includes(w)).slice(0, 3).join(', ')}. Please address them.`
    else if (score > 80) next_prompt = `Good answer. Now give me 3 concrete real-world examples with specific numbers or data.`
    else next_prompt = `Expand on the most important point. Be more specific.`

    return {
        score, grade,
        issues: issues.length ? issues : ['Response looks good'],
        next_prompt,
        metrics: {
            'Context Relevance': `${round(cr * 100)}%`,
            'ROUGE-1': `${round(r1 * 100)}%`,
            'ROUGE-2': `${round(r2 * 100)}%`,
            'BLEU-1': `${round(b1 * 100)}%`,
            'F1 Score': `${round(f1.f1 * 100)}%`,
            'Precision': `${round(f1.precision * 100)}%`,
            'Recall': `${round(f1.recall * 100)}%`,
        }
    }
}

const round = n => Math.round(n * 100) / 100