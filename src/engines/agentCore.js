import { classify, detectUserLevel } from '../classifier/intent'
import { preprocessPrompt } from './preprocessor'
import { evaluate } from './metrics'
import browser from 'webextension-polyfill'

// Agent step 1: Understand the prompt
function understand(rawPrompt) {
    const prompt = preprocessPrompt(rawPrompt)
    const task = classify(prompt)
    const level = detectUserLevel(prompt)
    const corrected = prompt !== rawPrompt
    return { prompt, task, level, corrected, original: rawPrompt }
}

// Agent step 2: Rewrite using Groq (dynamic, not template)
async function rewrite(understood, apiKey, provider = 'groq') {
    const { prompt, task, level } = understood

    const taskDescriptions = {
        code_debug: 'debugging code',
        code_build: 'building software',
        code_explain: 'explaining technical concepts',
        math_explain: 'explaining math concepts',
        math_solve: 'solving math problems',
        cooking: 'cooking and recipes',
        beauty: 'beauty and skincare advice',
        shopping: 'shopping decisions',
        decide: 'making decisions',
        research: 'research and analysis',
        study: 'studying and learning',
        planning: 'planning and organization',
        write_content: 'writing content',
        health: 'health and wellness',
    }

    const taskDesc = taskDescriptions[task] || 'answering questions'

    const system = `You are a prompt engineer expert in ${taskDesc}.
The user is a ${level} person. Their original prompt may have typos or be vague.
Generate 3 rewrites that are SPECIFIC to their actual content.
Each rewrite uses a different technique best suited for ${taskDesc}.
Output ONLY valid JSON. No markdown.`

    const user = `Original prompt: "${prompt}"
Task type: ${taskDesc}
User level: ${level}

Rules for rewrites:
- Use the actual content, not generic placeholders
- Technique 1: Best technique for THIS specific task type
- Technique 2: Second best technique
- Technique 3: Alternative approach
- Each must be meaningfully different
- For ${level} users: ${level === 'technical' ? 'use domain terminology' : 'use plain language'}

Output:
{"rewrites":[
  {"id":"r1","label":"emoji + technique","prompt":"full specific rewrite","why":"why this technique"},
  {"id":"r2","label":"emoji + technique","prompt":"full specific rewrite","why":"why this technique"},
  {"id":"r3","label":"emoji + technique","prompt":"full specific rewrite","why":"why this technique"}
]}`

    try {
        const r = await browser.runtime.sendMessage({ type: 'LLM_CALL', provider, apiKey, system, user })
        if (r?.ok && r.text) {
            const clean = r.text.replace(/```json|```/g, '').trim()
            const data = JSON.parse(clean)
            if (data?.rewrites?.length >= 3) return { ok: true, rewrites: data.rewrites }
        }
    } catch { }

    return { ok: false, rewrites: null }
}

// Agent step 3: Evaluate response quality with ML metrics
function evaluateResponse(question, response) {
    return evaluate(question, response)
}

// Main agent entry point
export async function runAgent(rawPrompt, apiKey, provider = 'groq') {
    // Step 1: Understand
    const understood = understand(rawPrompt)

    // Step 2: Rewrite (Groq if key, smart fallback if not)
    let rewrites = null
    if (apiKey) {
        const result = await rewrite(understood, apiKey, provider)
        if (result.ok) rewrites = result.rewrites
    }

    // Fallback rewrites if no key or Groq failed
    if (!rewrites) {
        rewrites = buildFallbackRewrites(understood)
    }

    return { understood, rewrites: rankRewrites(rewrites, understood.task) }
}

export { evaluateResponse }

function buildFallbackRewrites({ prompt, task, level }) {
    const isSimple = level === 'homemaker' || level === 'general'

    const r1 = isSimple
        ? `${prompt}\n\nPlease explain this simply, step by step, with real-world examples. Assume I have no technical background.`
        : `You are an expert in this field. ${prompt}\n\nThink step by step. Give me a specific, actionable answer with examples.`

    const r2 = `Help me with: ${prompt}\n\nFormat your response:\n**Direct Answer** (1-2 sentences)\n**Why** (the reasoning)\n**How** (step-by-step if applicable)\n**Example** (concrete real-world case)`

    const r3 = `${prompt}\n\nGive me your top recommendation only. Be direct. No generic advice. What would you specifically do in this situation?`

    return [
        { id: 'r1', label: '🎯 Direct Expert', prompt: r1 },
        { id: 'r2', label: '📋 Structured Format', prompt: r2 },
        { id: 'r3', label: '⚡ Quick Answer', prompt: r3 },
    ]
}

function rankRewrites(rewrites, task) {
    return rewrites.map((r, i) => ({ ...r, recommended: i === 0 }))
}