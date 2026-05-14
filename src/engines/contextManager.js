import browser from 'webextension-polyfill'

const CHAIN_TTL_MS = 30 * 60 * 1000  // 30 min auto-expire

export class ContextManager {
    constructor() {
        this.variables = {}
        this.createdAt = {}
        this.topic = null
    }

    // Detect if new prompt is same topic as chain
    isRelevant(newPrompt) {
        if (!this.topic || Object.keys(this.variables).length === 0) return true

        const topicWords = this.topic.toLowerCase().split(/\s+/).filter(w => w.length > 3)
        const newWords = newPrompt.toLowerCase()
        const overlap = topicWords.filter(w => newWords.includes(w)).length
        const score = overlap / Math.max(topicWords.length, 1)

        return score > 0.2  // at least 20% keyword overlap
    }

    addVariable(name, response, sourceTopic) {
        // Clean name
        const varName = name.startsWith('$') ? name : `$${name}`

        // If this is first variable, lock the topic
        if (!this.topic) this.topic = sourceTopic

        this.variables[varName] = {
            content: response.slice(0, 1200),  // cap context size
            topic: sourceTopic,
            addedAt: Date.now(),
        }
        this.createdAt[varName] = Date.now()
        return varName
    }

    buildContext(newPrompt) {
        this.pruneExpired()

        if (Object.keys(this.variables).length === 0) return newPrompt

        // CRITICAL: relevance check before injecting
        if (!this.isRelevant(newPrompt)) {
            return {
                prompt: newPrompt,
                warning: `Chain context (${this.topic}) may not be relevant to this question. Clear chain?`,
                injected: false,
            }
        }

        const contextBlock = Object.entries(this.variables)
            .map(([k, v]) => `[${k}]:\n${v.content}`)
            .join('\n\n---\n\n')

        return {
            prompt: `${contextBlock}\n\n---\nBuilding on the above, answer this new question:\n${newPrompt}`,
            warning: null,
            injected: true,
        }
    }

    pruneExpired() {
        const now = Date.now()
        for (const [key, time] of Object.entries(this.createdAt)) {
            if (now - time > CHAIN_TTL_MS) {
                delete this.variables[key]
                delete this.createdAt[key]
            }
        }
        if (Object.keys(this.variables).length === 0) this.topic = null
    }

    clear() {
        this.variables = {}
        this.createdAt = {}
        this.topic = null
    }

    get count() { return Object.keys(this.variables).length }
    get vars() { return Object.entries(this.variables).map(([k, v]) => ({ name: k, preview: v.content.slice(0, 60), topic: v.topic })) }
}