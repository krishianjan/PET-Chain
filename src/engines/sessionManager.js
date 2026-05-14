// Each session is independent. Chain is explicit opt-in only.
export class SessionManager {
    constructor() {
        this.sessions = {}    // threadId → { prompts, responses, chain }
        this.activeId = null
    }

    // Call this when user sends a new prompt
    newSession() {
        const id = `s_${Date.now()}`
        this.activeId = id
        this.sessions[id] = { prompts: [], responses: [], chain: [], topic: null }
        // Keep only last 5 sessions in memory
        const keys = Object.keys(this.sessions)
        if (keys.length > 5) delete this.sessions[keys[0]]
        return id
    }

    get current() {
        return this.sessions[this.activeId] || null
    }

    addPrompt(text) {
        if (!this.current) this.newSession()
        this.current.prompts.push(text)
        if (!this.current.topic) this.current.topic = text.slice(0, 60)
    }

    addResponse(text) {
        if (!this.current) return
        this.current.responses.push(text)
    }

    // EXPLICIT chain add — user clicks button, not automatic
    addToChain(varName, response, sourceTopic) {
        if (!this.current) this.newSession()
        // Relevance check
        if (this.current.topic) {
            const topicWords = this.current.topic.toLowerCase().split(/\s+/).filter(w => w.length > 3)
            const overlap = topicWords.filter(w => sourceTopic.toLowerCase().includes(w)).length
            const score = overlap / Math.max(topicWords.length, 1)
            if (score < 0.15 && this.current.chain.length > 0) {
                return { ok: false, warning: `"${sourceTopic.slice(0, 40)}" seems off-topic from "${this.current.topic}". Add anyway?` }
            }
        }
        this.current.chain.push({ varName, content: response.slice(0, 1000), topic: sourceTopic })
        return { ok: true }
    }

    // Only called when user explicitly clicks "Use Chain"
    buildChainedPrompt(newPrompt) {
        const sess = this.current
        if (!sess || !sess.chain.length) return { prompt: newPrompt, chained: false }
        const ctx = sess.chain.map(v => `[${v.varName}]:\n${v.content}`).join('\n\n')
        return {
            prompt: `${ctx}\n\n---\nNew question (use above context only if relevant):\n${newPrompt}`,
            chained: true,
            vars: sess.chain.map(v => v.varName),
        }
    }

    clearChain() {
        if (this.current) this.current.chain = []
    }

    clearAll() {
        this.sessions = {}
        this.activeId = null
    }

    get chainVars() {
        return this.current?.chain || []
    }
}

export const session = new SessionManager()