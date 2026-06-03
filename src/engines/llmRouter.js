/**
 * PET v3 -- Intelligent Prompt Architecture Engine
 *
 * Pipeline (3 steps, all LLM-driven, zero hardcoded templates):
 *   Step 0  CORRECT   -- spell/grammar fix (50 tokens, fast model)
 *   Step 1  EXPAND    -- intent architect: infers the FULL scope the user implied
 *   Step 2  ARCHITECT -- generates 3 complete, specific, ready-to-use expert prompts
 *
 * Temperature is dynamic per domain (code=0.28, creative=0.92, emotional=0.78).
 * No DPB templates. No hardcoded technique lists. Everything is prompt-driven.
 */

import { PROVIDERS, getModel, getEndpoint } from './providerRegistry.js'

// ── Token budgets ──────────────────────────────────────────────────────────
const MAX_INPUT_CHARS   = 1000
const CORRECT_TOKENS    = 80
const EXPAND_TOKENS     = 500
const ARCHITECT_TOKENS  = 1800
const EVAL_TOKENS       = 500

// ── Dynamic temperature map -- low for precision, high for creativity ──────
const TEMPERATURE_MAP = {
  // Technical -- precision required
  software: 0.30, web_dev: 0.30, frontend: 0.28, backend: 0.25,
  mobile_dev: 0.30, databases: 0.22, cybersecurity: 0.20,
  systems: 0.22, networking: 0.25, devops: 0.28, cloud: 0.28,
  data_science: 0.32, machine_learning: 0.30, ai: 0.32, nlp: 0.30,
  // Math/Science -- highest precision
  mathematics: 0.15, calculus: 0.15, statistics: 0.18,
  chemistry: 0.20, physics: 0.20, biology: 0.25, genetics: 0.20,
  // Analysis -- medium-low
  finance: 0.32, economics: 0.35, investing: 0.30, research: 0.35,
  law: 0.25, medicine: 0.28, pharmacology: 0.22,
  // Education -- medium
  education: 0.55, explanation: 0.50, learning: 0.58,
  // Health/Nutrition -- medium
  health: 0.42, nutrition: 0.45, fitness: 0.50,
  // Personal/Emotional -- warm but not chaotic
  mental_health: 0.72, anxiety: 0.70, therapy: 0.75,
  relationships: 0.75, emotional_support: 0.78, parenting: 0.68,
  // Creative -- maximum variety
  creative_writing: 0.92, fiction: 0.93, poetry: 0.95, screenwriting: 0.90,
  music: 0.88, visual_arts: 0.90, fashion: 0.85, styling: 0.88,
  beauty: 0.82, cooking: 0.78, brainstorm: 0.92,
  // Business/Marketing -- medium
  marketing: 0.62, copywriting: 0.68, branding: 0.65,
  business_strategy: 0.45, entrepreneurship: 0.55,
}

function getDomainTemperature(domain) {
  if (!domain) return 0.65
  const key = domain.toLowerCase().replace(/[-\s]+/g, '_')
  // Exact match first
  if (TEMPERATURE_MAP[key] !== undefined) return TEMPERATURE_MAP[key]
  // Partial match
  for (const [k, v] of Object.entries(TEMPERATURE_MAP)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return 0.65
}

// ── STEP 0: CORRECT -- grammar + spell fix ────────────────────────────────
// Tiny call. Returns the corrected text string (not JSON).
// "i want to build wmotion website" → "I want to build an emotion detection website"
const CORRECT_SYS = `Fix spelling, grammar, and obvious word errors in the user's input.
Infer the most likely intended word for typos (e.g. "wmotion" → "emotion", "nvabar" → "navbar").
ONLY fix errors -- do not add words, do not change intent, do not explain.
Return ONLY the corrected text. No quotes. No explanation.`

// ── STEP 1: EXPAND -- intent architect ────────────────────────────────────
// Core innovation: goes far beyond what the user typed.
// Infers the FULL scope, tech stack, all implied requirements, correct domain.
// "build emotion website" → full spec with MediaPipe, auth, animations, DB.
const EXPAND_SYS = `You are an expert intent architect. Your job: read the user's input and infer everything they ACTUALLY NEED, not just what they typed.

Think like the world's best domain expert who has built this 100 times.
Go BEYOND the literal words. Infer the complete requirements, the right tools, the hardest parts.

Examples of intent expansion:
- "build emotion website" → needs: real-time webcam ML (MediaPipe), navbar, auth (SSO), UI animations, dashboard
- "fashion outfit for interview" → needs: industry context, body type considerations, color theory, specific brands
- "explain supply elasticity" → needs: level calibration (student/professional), worked example with real numbers, visual analogy
- "PCOS diet plan" → needs: insulin sensitivity, hormonal balance foods, anti-inflammatory approach, cycle-aware eating

Return ONLY valid JSON:
{
  "corrected": "<clean, grammatically correct version of the input>",
  "true_intent": "<one sentence: what the user actually wants to accomplish>",
  "inferred_requirements": ["<requirement 1 -- specific>", "<req 2>", "<req 3>", "<req 4>", "<req 5>"],
  "domain": "<primary domain from the full domain taxonomy>",
  "sub_domain": "<specific sub-area>",
  "user_level": "beginner|intermediate|advanced|expert",
  "complexity": "low|medium|high|expert",
  "output_format": "how_to|plan|explanation|analysis|creative|debug|emotional_support|research|brainstorm",
  "persona": "<exact expert role -- specific, not generic>",
  "tone": "technical|educational|empathetic|direct|creative|professional|motivational",
  "tech_stack": {<only if technical domain -- specific tools with versions, null otherwise>},
  "key_concepts": ["<concept the expert knows that the user forgot to mention>"],
  "hardest_part": "<the single hardest thing to get right in this domain/task>",
  "recommended_temperature": <0.15-0.95 -- use domain knowledge to set this>
}

RULES:
- inferred_requirements: 4-7 items, each specific (not "good UI" but "smooth scroll navbar with blur backdrop + active link highlighting")
- persona: domain-matched precisely ("Senior frontend engineer specialising in ML web apps" not "expert")
- output_format "how_to": any build/create/implement/develop/make request -- NEVER use "decision" for these
- output_format "decision": ONLY when user names 2+ explicit choices to compare
- tech_stack: include specific versions when possible (Next.js 14, not just Next.js)`

// ── STEP 2: ARCHITECT -- fully free-form prompt engineering ──────────────
// The LLM decides everything: angle, structure, framing, depth, format.
// Zero predefined frames. Zero "Prompt 1 = MVP, Prompt 2 = Deep-dive" labels.
// Think of it as hiring 3 different senior prompt engineers who each approach
// the problem from a completely different perspective they chose themselves.
const ARCHITECT_SYS = `You are the world's best prompt engineer. You have deep expertise across every domain.

A user needs help. You have already received their expanded intent -- what they truly want,
their full inferred requirements, tech stack, domain, persona, and complexity level.

YOUR JOB: Write 3 completely different expert prompts that will get the best possible AI response.

CRITICAL RULES:
1. YOU decide everything about each prompt -- angle, structure, format, framing, length, technique
2. The 3 prompts must take genuinely DIFFERENT approaches. Not "approach A with more detail" but
   fundamentally different framings of the same problem (different expert, different method, different lens)
3. Every prompt must be IMMEDIATELY SENDABLE -- complete, specific, no blanks to fill in
4. Cover the FULL inferred scope -- all requirements, not just what the user literally typed
5. Use real names: real libraries, real commands, real numbers, real examples -- no placeholders
6. Persona must be in each prompt -- it changes how the LLM responds
7. Address the hardest part explicitly -- that is what generic prompts always skip

HOW TO PICK THE 3 APPROACHES (you decide, these are examples not rules):
For a web app: maybe (1) full architecture + build order, (2) start with the core ML feature first, (3) focus on the UI/UX animations + performance
For health: maybe (1) evidence-based clinical protocol, (2) lifestyle/holistic approach, (3) diagnostic questions to ask a doctor
For fashion: maybe (1) capsule wardrobe investment pieces, (2) styling rules for the specific occasion, (3) specific current pieces to buy
For math: maybe (1) intuition-first then proof, (2) worked examples step by step, (3) common mistakes and why they fail

The approach depends entirely on what THIS SPECIFIC REQUEST needs. Not on a template.

DOMAIN SIGNALS (use your knowledge of the domain to decide structure, not a formula):
- Code/tech: what goes first matters (auth before features), dependencies matter, the hard part is usually state/auth/deployment
- Creative: mood and constraint matter more than steps; show not tell
- Health/medical: safety and evidence quality matter most; be specific about doses/timing/contraindications
- Emotional: validate before advising; do not rush to solutions; one step at a time
- Science: mechanism matters; what experiment would prove/disprove this
- Finance: specific numbers > general advice; always mention risk; show the math

Return ONLY valid JSON (no markdown):
{"corrected_prompt":"<spell-corrected version>","true_intent":"<one sentence>","domain":"<domain>","rewrites":[
{"id":"r1","technique":"<name YOU chose for this approach>","label":"<emoji + label YOU picked>","why":"<one sentence: why THIS angle for THIS specific request>","prompt":"<COMPLETE expert prompt, 150-450 words, immediately sendable>","recommended":true,"token_est":<integer>},
{"id":"r2","technique":"<different approach name>","label":"<emoji label>","why":"<one sentence>","prompt":"<complete prompt, genuinely different angle>","recommended":false,"token_est":<integer>},
{"id":"r3","technique":"<third approach name>","label":"<emoji label>","why":"<one sentence>","prompt":"<complete prompt, third distinct angle>","recommended":false,"token_est":<integer>}
]}`

// ── Safe JSON extractor ────────────────────────────────────────────────────
export function safeJSON(raw) {
  if (!raw) return null
  const t = raw.trim()
  try { return JSON.parse(t) } catch {}
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenced) { try { return JSON.parse(fenced[1].trim()) } catch {} }
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s !== -1 && e > s) {
    const candidate = t.slice(s, e + 1)
    try { return JSON.parse(candidate) } catch {}
    try { return JSON.parse(candidate.replace(/,(\s*[}\]])/g, '$1')) } catch {}
    try { return JSON.parse(candidate + ']}') } catch {}
  }
  return null
}

// ── Per-provider request builder (temperature-aware) ──────────────────────
function buildRequest(provider, model, systemPrompt, userPrompt, maxTokens, temperature = 0.65) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt   },
  ]

  if (provider === 'gemini') {
    return {
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }],
        }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
          responseMimeType: 'application/json',
        },
      }),
    }
  }

  if (provider === 'claude') {
    return {
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }
  }

  // OpenAI-compatible (Groq, OpenAI, Grok, DeepSeek, OpenRouter, Ollama)
  return {
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      response_format: provider === 'openai' ? { type: 'json_object' } : undefined,
    }),
  }
}

// ── Per-provider header builder ────────────────────────────────────────────
function buildHeaders(provider, apiKey) {
  const base = { 'Content-Type': 'application/json' }
  if (provider === 'gemini')     return base
  if (provider === 'claude')     return {
    ...base,
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  if (provider === 'openrouter') return {
    ...base,
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://krishianjan.github.io/PET-Chain/',
    'X-Title': 'PET -- Prompt Enhancement Tool',
  }
  return { ...base, 'Authorization': `Bearer ${apiKey}` }
}

// ── Per-provider URL builder ───────────────────────────────────────────────
function buildURL(provider, model, apiKey) {
  const base = getEndpoint(provider)
  if (provider === 'gemini') return `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`
  if (provider === 'ollama') return `${base}/v1/chat/completions`
  return `${base}/chat/completions`
}

// ── Per-provider response extractor ───────────────────────────────────────
function extractText(provider, data) {
  if (!data) return ''
  if (provider === 'gemini') return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (provider === 'claude') return data.content?.[0]?.text || ''
  return data.choices?.[0]?.message?.content || ''
}

// ── Core call with temperature ─────────────────────────────────────────────
async function callOnce(provider, apiKey, model, systemPrompt, userPrompt, maxTokens = 600, temperature = 0.65) {
  const url     = buildURL(provider, model, apiKey)
  const headers = buildHeaders(provider, apiKey)
  const { body } = buildRequest(provider, model, systemPrompt, userPrompt, maxTokens, temperature)

  const res = await fetch(url, {
    method:  'POST',
    headers,
    body,
    signal:  AbortSignal.timeout(25000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`${provider} HTTP ${res.status}: ${errText.slice(0, 120)}`)
  }

  const data = await res.json()
  return extractText(provider, data)
}

// ── Exponential backoff retry ──────────────────────────────────────────────
async function callWithRetry(provider, apiKey, model, sys, user, maxTokens, temperature = 0.65, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callOnce(provider, apiKey, model, sys, user, maxTokens, temperature)
    } catch (err) {
      const is429    = err.message.includes('429')
      const isTimeout = err.message.includes('timeout') || err.name === 'TimeoutError'
      if (attempt < retries && (is429 || isTimeout)) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 1200))
        continue
      }
      throw err
    }
  }
}

// ── Fast model map (used for CORRECT + EXPAND -- cheap calls) ──────────────
const FAST_MODELS = {
  gemini:     'gemini-2.0-flash',
  openai:     'gpt-4o-mini',
  groq:       'llama-3-8b-8192',
  claude:     'claude-3-5-haiku-20241022',
  grok:       'grok-3-mini',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  deepseek:   'deepseek-chat',
  ollama:     null,
}

// ── STEP 0: CORRECT -- spell/grammar fix ─────────────────────────────────
export async function correctInput(rawPrompt, provider, apiKey) {
  const fastModel = FAST_MODELS[provider] || getModel(provider, 'fast')
  if (!fastModel) return rawPrompt

  try {
    const corrected = await callOnce(
      provider, apiKey, fastModel,
      CORRECT_SYS,
      rawPrompt.slice(0, 600),
      CORRECT_TOKENS,
      0.1   // very low temperature -- deterministic correction
    )
    const clean = corrected?.trim()
    // Only use if it looks like a real correction (not empty, not much longer)
    if (clean && clean.length > 3 && clean.length < rawPrompt.length * 2.5) {
      return clean
    }
    return rawPrompt
  } catch {
    return rawPrompt  // correction is optional -- never block the pipeline
  }
}

// ── STEP 1: EXPAND -- intent architect ───────────────────────────────────
export async function expandIntent(correctedPrompt, provider, apiKey) {
  const fastModel = FAST_MODELS[provider] || getModel(provider, 'fast')
  if (!fastModel) return null

  try {
    const raw = await callWithRetry(
      provider, apiKey, fastModel,
      EXPAND_SYS,
      `Expand the intent of this input: "${correctedPrompt.slice(0, MAX_INPUT_CHARS)}"`,
      EXPAND_TOKENS,
      0.4   // slight creativity for inference, but structured
    )
    return safeJSON(raw)
  } catch (e) {
    console.warn('[PET expand] failed:', e.message)
    return null
  }
}

// ── STEP 2: ARCHITECT -- generate 3 complete prompts ─────────────────────
export async function architectPrompts(rawPrompt, expansion, provider, apiKey, modelOverride) {
  const model       = modelOverride || getModel(provider, 'smart')
  const temperature = expansion?.recommended_temperature || getDomainTemperature(expansion?.domain)

  // Build the context block from expansion
  const reqList = (expansion?.inferred_requirements || []).map((r, i) => `  ${i+1}. ${r}`).join('\n')
  const stackStr = expansion?.tech_stack
    ? Object.entries(expansion.tech_stack).map(([k, v]) => `  ${k}: ${v}`).join('\n')
    : ''

  const userMsg = [
    `ORIGINAL INPUT: "${rawPrompt.slice(0, MAX_INPUT_CHARS)}"`,
    `CORRECTED: "${expansion?.corrected || rawPrompt}"`,
    `TRUE INTENT: ${expansion?.true_intent || 'unclear'}`,
    `DOMAIN: ${expansion?.domain || 'general'} / ${expansion?.sub_domain || ''}`,
    `USER LEVEL: ${expansion?.user_level || 'intermediate'}`,
    `COMPLEXITY: ${expansion?.complexity || 'medium'}`,
    `OUTPUT FORMAT: ${expansion?.output_format || 'how_to'}`,
    `PERSONA: ${expansion?.persona || 'World-class domain expert'}`,
    `TONE: ${expansion?.tone || 'professional'}`,
    reqList ? `\nINFERRED REQUIREMENTS (cover ALL of these):\n${reqList}` : '',
    stackStr ? `\nRECOMMENDED TECH STACK:\n${stackStr}` : '',
    expansion?.hardest_part ? `\nHARDEST PART TO GET RIGHT: ${expansion.hardest_part}` : '',
    expansion?.key_concepts?.length ? `\nKEY CONCEPTS TO INCLUDE: ${expansion.key_concepts.join(', ')}` : '',
    `\nGenerate 3 complete, ready-to-use expert prompts. Cover the FULL inferred scope. Be specific. No placeholders.`,
  ].filter(Boolean).join('\n')

  try {
    const raw = await callWithRetry(
      provider, apiKey, model,
      ARCHITECT_SYS,
      userMsg,
      ARCHITECT_TOKENS,
      temperature
    )
    const data = safeJSON(raw)
    if (!data?.rewrites?.length) throw new Error('no rewrites in response')

    // Enrich each rewrite with metadata
    data.rewrites.forEach(r => {
      r.domain     = expansion?.domain     || 'general'
      r.outputType = expansion?.output_format || 'how_to'
      r.source     = provider
      r.model      = model
      r.temperature = temperature
    })

    return {
      ok:             true,
      rewrites:       data.rewrites,
      goal:           data.true_intent || expansion?.true_intent || rawPrompt.slice(0, 80),
      corrected:      data.corrected_prompt || expansion?.corrected || rawPrompt,
      domain:         expansion?.domain || 'general',
      expansion,
    }
  } catch (e) {
    console.error('[PET architect]', provider, e.message)
    return { ok: false, error: e.message }
  }
}

// ── Main export: full intelligent pipeline ────────────────────────────────
// correct → expand → architect
export async function petRewrite(rawPrompt, provider, apiKey, modelOverride) {
  if (!rawPrompt?.trim()) return { ok: false, error: 'empty prompt' }
  if (!apiKey)             return { ok: false, error: 'no api key' }

  // Step 0: correct grammar/spelling (non-blocking -- if it fails use raw)
  const corrected = await correctInput(rawPrompt, provider, apiKey)

  // Step 1: expand intent (infer full scope -- if it fails, proceed with null)
  const expansion = await expandIntent(corrected, provider, apiKey)

  // Step 2: architect 3 complete prompts using full expansion
  return architectPrompts(corrected, expansion, provider, apiKey, modelOverride)
}

// ── Legacy export: sense() -- kept for backward compat ────────────────────
// Returns expansion result shaped like the old sense() output
export async function sense(rawPrompt, provider, apiKey) {
  const corrected = await correctInput(rawPrompt, provider, apiKey)
  return expandIntent(corrected, provider, apiKey)
}

// ── Evaluate: domain-aware response scorer with targeted follow-up ─────────
const EVAL_SYS = `Evaluate this AI response against the user's goal. Return ONLY valid JSON.

SCORING (domain-aware, not just word count):
- code/tech: high score requires working code snippets, specific commands, no placeholder text, correct syntax
- health/medical: high score requires evidence-based specifics, safety awareness, actionable protocols
- finance: high score requires specific numbers, risk disclosure, real examples with actual % or $
- creative: high score requires originality, vivid specific details, emotional resonance
- emotional: high score requires validation-first, empathy, not rushing to solutions
- education: high score requires clear analogy, worked example, builds from known to unknown

next_prompt RULES (this is the most important field):
1. Quote or directly reference SPECIFIC content from the response (actual words, tech names, numbers mentioned)
2. Target the SINGLE most important gap or next depth level -- be surgical
3. 60-120 words, immediately sendable as-is
4. If response mentioned React -- follow-up must mention React specifically
5. If response gave a framework -- ask to apply it with real numbers from the domain
6. If response was vague -- name exactly what implementation detail is missing
7. NEVER write "can you elaborate" -- always name the specific thing to elaborate on
8. For code: ask for the specific function/component/hook that is missing
9. For creative: ask for the specific scene/section that needs more depth

{"score":<0-100>,"grade":"A|B|C|D|F","domain_score":<0-100>,"covered":["<specific strength>"],"missing":["<specific gap -- name it precisely>"],"quality_note":"<one sentence naming what was strongest or weakest>","next_prompt":"<complete ready-to-send follow-up citing actual response content>","should_stop":<true if goal substantially complete>}`

export async function petEvaluate(question, response, provider, apiKey, modelOverride) {
  if (!question || !response) return null
  const model       = modelOverride || getModel(provider, 'fast')
  const temperature = 0.2   // evaluation needs precision, not creativity

  // Extract tech names from response to inject into evaluation context
  const techMentioned = (response.match(/\b(React|Vue|Next\.js|Angular|Svelte|Tailwind|Node|Express|FastAPI|Django|Python|TypeScript|Docker|Postgres|MongoDB|Redis|AWS|Vercel|Supabase|Firebase|MediaPipe|Framer Motion|GSAP|GraphQL|Prisma|JWT|OAuth)\b/g) || [])
  const uniqueTech = [...new Set(techMentioned)].slice(0, 5).join(', ')

  const userMsg = [
    `User goal: "${question.slice(0, 300)}"`,
    uniqueTech ? `Technologies mentioned in response: ${uniqueTech}` : '',
    `\nAI response:\n"""${response.slice(0, 2000)}"""`,
    `\nEvaluate quality. Write a specific follow-up that references the actual content above.`,
  ].filter(Boolean).join('\n')

  try {
    const raw = await callWithRetry(provider, apiKey, model, EVAL_SYS, userMsg, EVAL_TOKENS, temperature)
    const data = safeJSON(raw)
    if (!data?.score) return null
    data.score       = Math.max(10, Math.min(99, data.score))
    data.grade       = data.grade || (data.score >= 85 ? 'A' : data.score >= 70 ? 'B' : data.score >= 55 ? 'C' : data.score >= 40 ? 'D' : 'F')
    data.grade_label = { A: 'Excellent', B: 'Good', C: 'Partial', D: 'Weak', F: 'Off-target' }[data.grade] || '~'
    data.source      = provider
    return data
  } catch (e) {
    console.warn('[PET evaluate]', provider, e.message)
    return null
  }
}
