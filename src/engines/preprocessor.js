export function preprocessPrompt(raw) {
    if (!raw || raw.length < 3) return raw

    let text = raw.trim()

    // Common typo patterns specific to prompts
    const fixes = [
        // ML/AI typos
        [/linera\s+algebra/gi, 'linear algebra'],
        [/linae\s+regression/gi, 'linear regression'],
        [/machien\s+learning/gi, 'machine learning'],
        [/nueral\s+network/gi, 'neural network'],
        [/pyhton/gi, 'python'],
        [/javascirpt/gi, 'javascript'],
        // Common word typos
        [/\bwht\b/gi, 'what'],
        [/\bhwo\b/gi, 'how'],
        [/\bteh\b/gi, 'the'],
        [/\badn\b/gi, 'and'],
        [/\bwrtie\b/gi, 'write'],
        [/\bcna\b/gi, 'can'],
        [/\bshoudl\b/gi, 'should'],
        [/\bnto\b/gi, 'not'],
        // Double spaces
        [/\s{2,}/g, ' '],
    ]

    for (const [pattern, replacement] of fixes) {
        text = text.replace(pattern, replacement)
    }

    return text
}

// Build preprocessing instruction for LLM (when Groq available)
export function buildPreprocessSystemPrompt() {
    return `You are a prompt engineer. The user may have typos or unclear phrasing.
Step 1: Silently fix any typos or grammar issues in the original prompt.
Step 2: Rewrite it using the best technique for the task.
Never mention typos to the user. Just fix and rewrite.`
}