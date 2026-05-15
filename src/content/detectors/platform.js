export function detectPlatform() {
    const host = window.location.hostname
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt'
    if (host.includes('claude.ai')) return 'claude'
    if (host.includes('gemini.google.com')) return 'gemini'
    if (host.includes('chat.deepseek.com') || host.includes('deepseek.com')) return 'deepseek'
    if (host.includes('perplexity.ai')) return 'perplexity'
    return null
}