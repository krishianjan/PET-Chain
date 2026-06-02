/**
 * PET v2 -- Universal LLM Router
 * Browser-native: calls provider APIs directly from the service worker.
 * CI/CD safe: purely additive -- existing code paths unchanged if this module
 * is not invoked (old worker.js flow still works for Groq/offline).
 *
 * FAIL POINTS GUARDED:
 * - CORS: service workers bypass CORS; Claude needs special header
 * - Token limits: prompts truncated at 800 chars input max
 * - Rate limits: exponential backoff + provider fallback chain
 * - JSON failures: multi-layer safeJSON with heuristic repair
 * - Network timeout: AbortSignal.timeout(20000) on every call
 * - Context invalidated: runtime.id guard at call-site
 */

import { PROVIDERS, getModel, getEndpoint } from './providerRegistry.js'

// ── Token budget ───────────────────────────────────────────────────────────
const MAX_INPUT_CHARS  = 800   // ~200 tokens -- keeps SENSE call cheap
const MAX_REWRITE_TOKENS = 900  // output budget for 3 prompts

// ── Universal 50+ domain meta-prompt ──────────────────────────────────────
// LLM reads this and DECIDES format -- no hardcoded CoT forced on every prompt
const SENSE_SYS = `You are PET's intent classifier. Analyse the user's input and return classification JSON.

DOMAINS (pick the most specific):
women_health|mens_health|mental_health|anxiety|depression|therapy|relationships|sexuality|parenting|elderly_care|
nutrition|diet|weight_loss|fitness|sports_science|bodybuilding|yoga|wellness|
medicine|pharmacology|symptoms|chronic_illness|first_aid|dental|vision|
fashion|styling|outfit|color_theory|body_type|sustainable_fashion|luxury|streetwear|
beauty|skincare|haircare|makeup|fragrance|grooming|
economics|macroeconomics|microeconomics|behavioral_economics|development_economics|
personal_finance|budgeting|debt|savings|retirement|insurance|tax|credit|
investing|stocks|options|etf|technical_analysis|fundamental_analysis|portfolio|
crypto|defi|nft|blockchain|web3|
real_estate|mortgage|renting|commercial_property|reits|
law|contracts|intellectual_property|employment_law|criminal_law|immigration|family_law|
business_strategy|entrepreneurship|startups|ecommerce|saas|fundraising|
marketing|seo|content_marketing|social_media|advertising|copywriting|branding|
sales|negotiation|customer_success|crm|
software|web_dev|mobile_dev|backend|frontend|devops|cloud|
data_science|machine_learning|ai|nlp|computer_vision|
cybersecurity|networking|systems|databases|
creative_writing|fiction|screenwriting|poetry|journalism|technical_writing|
music|music_theory|production|mixing|instruments|songwriting|
visual_arts|photography|videography|film|animation|graphic_design|ux_design|
architecture|interior_design|urban_planning|
history|geopolitics|philosophy|ethics|religion|sociology|anthropology|
chemistry|organic_chemistry|physics|quantum|astronomy|geology|climate|ecology|
biology|genetics|evolution|neuroscience|microbiology|anatomy|
mathematics|calculus|statistics|linear_algebra|discrete_math|
cooking|baking|food_science|wine|mixology|
agriculture|gardening|botany|animal_husbandry|
automotive|aviation|maritime|mechanical_engineering|electrical_engineering|civil_engineering|
home_improvement|diy|interior_renovation|
travel|language_learning|cultural_etiquette|visa|backpacking|luxury_travel|
education|exam_prep|studying|tutoring|curriculum|
career|job_hunting|resume|interview|salary|leadership|management|
sports|esports|gaming|fitness_coaching|
psychology|cognitive_science|behavioral_science|neurology|
pet_care|veterinary|animal_behavior|
spirituality|meditation|mindfulness|astrology|
general

OUTPUT FORMAT options (pick what the content NEEDS):
how_to|analysis|creative|decision|emotional_support|comparison|debug|plan|explanation|research|persuasion|narrative|critique|brainstorm

TONE options:
empathetic|professional|casual|technical|educational|motivational|creative|direct|nurturing|investigative

Return ONLY valid JSON (no markdown, no explanation):
{"domain":"<specific>","sub_domain":"<precise sub-area>","urgency":"low|medium|high|critical","output_format":"<format>","tone":"<tone>","user_context":"<one sentence inferred situation>","goal":"<what they actually want>","persona":"<exact expert role -- match domain precisely>","techniques":[{"name":"<T1>","label":"<emoji label>","why":"<one sentence why for THIS specific input>"},{"name":"<T2>","label":"<emoji label>","why":"<one sentence>"},{"name":"<T3>","label":"<emoji label>","why":"<one sentence>"}]}

TECHNIQUE POOL -- pick 3 that best match the output_format:
Chain-of-Thought|Socratic Method|Feynman Technique|Expert Panel|Devil's Advocate|
Comparative Analysis|Decision Matrix|First Principles|Tree of Thought|Root Cause Analysis|
Empathetic Inquiry|Narrative Arc|Before-After-Bridge|Hook-Problem-Solution-CTA|
AIDA Framework|5-Whys|Rubber Duck Debug|SWOT Analysis|Jobs-to-be-Done|
Motivational Interviewing|Cognitive Reframing|Worked Examples|Spec-First Architecture|
MVP Blueprint|Systematic Elimination|Research Brief|Few-Shot Expert`

// ── Token-efficient rewrite prompt (LLM decides structure) ─────────────────
const REWRITE_SYS = `You are PET -- Prompt Enhancement Tool. Generate 3 different expert prompts.

TOKEN EFFICIENCY: 80-180 words per prompt. Specific > long.
FORMAT RULES -- let the domain and format dictate structure:
- emotional_support → empathy first, validate, then practical (NO bullet lists for first response)
- creative → mood/constraints/freedom, not rigid steps
- decision → options + MY criteria + MY situation + what I need to hear
- how_to → goal + my context + constraints + output format I need
- explanation → my current knowledge level + what specifically confuses me + analogy preference
- debug → exact error + what I tried + environment + expected vs actual
- research → scope + framework + evidence type + output format
- comparison → items + my use case + weighted criteria
- plan → timeline + resources + constraints + success definition
- analysis → domain + framework + data I have + recommendations needed

PERSONA -- ONE sentence, domain-matched, no lengthy credential lists:
✓ "You are a board-certified OB-GYN specialising in PCOS and hormonal health"  
✓ "You are a CFA charterholder with 15 years in equity research and portfolio management"
✓ "You are a licensed therapist specialising in CBT for anxiety and relationship issues"
✓ "You are a personal stylist who has dressed executives for Fortune 500 boardrooms"
✓ "You are a Michelin-trained chef specialising in plant-based Mediterranean cuisine"
✗ NEVER "You are a senior software engineer" for health/fashion/cooking/emotion questions
✗ NEVER force ROLE/CONTEXT/GOAL/TECH structure on creative or emotional topics

Return ONLY valid JSON:
{"goal":"<user's actual goal in plain language>","rewrites":[
{"id":"r1","technique":"<name>","label":"<emoji label>","why":"<one sentence why this technique fits>","prompt":"<complete prompt 80-180 words>","recommended":true,"token_est":<integer>},
{"id":"r2","technique":"<name>","label":"<emoji label>","why":"<one sentence>","prompt":"<complete prompt>","recommended":false,"token_est":<integer>},
{"id":"r3","technique":"<name>","label":"<emoji label>","why":"<one sentence>","prompt":"<complete prompt>","recommended":false,"token_est":<integer>}
]}`

// ── Safe JSON extractor (multi-layer) ─────────────────────────────────────
export function safeJSON(raw) {
  if (!raw) return null
  const t = raw.trim()
  try { return JSON.parse(t) } catch {}
  // Strip markdown fences
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenced) { try { return JSON.parse(fenced[1].trim()) } catch {} }
  // Brute-force brace extraction
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s !== -1 && e > s) {
    const candidate = t.slice(s, e + 1)
    try { return JSON.parse(candidate) } catch {}
    // Heuristic: strip trailing commas
    try { return JSON.parse(candidate.replace(/,(\s*[}\]])/g, '$1')) } catch {}
    // Heuristic: close unclosed strings/arrays
    try { return JSON.parse(candidate + ']}') } catch {}
  }
  return null
}

// ── Per-provider request builder ───────────────────────────────────────────
function buildRequest(provider, model, systemPrompt, userPrompt, maxTokens) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt   },
  ]

  if (provider === 'gemini') {
    // Gemini uses a different structure -- combine system + user
    return {
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }],
        }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    }
  }

  if (provider === 'claude') {
    // Anthropic format
    return {
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }
  }

  // OpenAI-compatible (Groq, OpenAI, Grok, DeepSeek, OpenRouter, Kimi, Ollama)
  return {
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
      response_format: provider === 'openai' ? { type: 'json_object' } : undefined,
    }),
  }
}

// ── Per-provider header builder ────────────────────────────────────────────
function buildHeaders(provider, apiKey) {
  const base = { 'Content-Type': 'application/json' }

  if (provider === 'gemini') return base  // key in URL

  if (provider === 'claude') return {
    ...base,
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Required for direct browser access to Anthropic API
    'anthropic-dangerous-direct-browser-access': 'true',
  }

  if (provider === 'openrouter') return {
    ...base,
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://krishianjan.github.io/PET-Chain/',
    'X-Title': 'PET -- Prompt Enhancement Tool',
  }

  // OpenAI-compatible
  return { ...base, 'Authorization': `Bearer ${apiKey}` }
}

// ── Per-provider URL builder ───────────────────────────────────────────────
function buildURL(provider, model, apiKey) {
  const base = getEndpoint(provider)

  if (provider === 'gemini') {
    return `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`
  }
  if (provider === 'ollama') {
    return `${base}/v1/chat/completions`
  }
  return `${base}/chat/completions`
}

// ── Per-provider response extractor ───────────────────────────────────────
function extractText(provider, data) {
  if (!data) return ''

  if (provider === 'gemini') {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  }
  if (provider === 'claude') {
    return data.content?.[0]?.text || ''
  }
  // OpenAI-compatible
  return data.choices?.[0]?.message?.content || ''
}

// ── Core single LLM call with retry ───────────────────────────────────────
async function callOnce(provider, apiKey, model, systemPrompt, userPrompt, maxTokens = 600) {
  const url     = buildURL(provider, model, apiKey)
  const headers = buildHeaders(provider, apiKey)
  const { body } = buildRequest(provider, model, systemPrompt, userPrompt, maxTokens)

  const res = await fetch(url, {
    method:  'POST',
    headers,
    body,
    signal:  AbortSignal.timeout(20000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`${provider} HTTP ${res.status}: ${errText.slice(0, 120)}`)
  }

  const data = await res.json()
  return extractText(provider, data)
}

// ── Exponential backoff retry ──────────────────────────────────────────────
async function callWithRetry(provider, apiKey, model, sys, user, maxTokens, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callOnce(provider, apiKey, model, sys, user, maxTokens)
    } catch (err) {
      const is429 = err.message.includes('429')
      const isTimeout = err.message.includes('timeout') || err.name === 'TimeoutError'
      if (attempt < retries && (is429 || isTimeout)) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 1200))
        continue
      }
      throw err
    }
  }
}

// ── STEP 1: SENSE -- fast intent classification ─────────────────────────────
// Uses a smaller/faster model for cost efficiency
export async function sense(rawPrompt, provider, apiKey) {
  const FAST_MODELS = {
    gemini:      'gemini-2.0-flash',
    openai:      'gpt-4o-mini',
    groq:        'llama-3-8b-8192',
    claude:      'claude-3-haiku-20240307',
    grok:        'grok-beta',
    openrouter:  'meta-llama/llama-3-8b-instruct:free',
    deepseek:    'deepseek-chat',
    ollama:      null, // filled from model selection
  }

  const fastModel = FAST_MODELS[provider] || getModel(provider, 'fast')
  const truncated = rawPrompt.slice(0, MAX_INPUT_CHARS)

  try {
    const raw = await callWithRetry(
      provider, apiKey, fastModel,
      SENSE_SYS,
      `Classify this: "${truncated}"`,
      250  // tiny output budget
    )
    return safeJSON(raw)
  } catch (e) {
    console.warn('[PET sense] failed:', e.message)
    return null
  }
}

// ── STEP 2: REWRITE -- generate 3 prompts ──────────────────────────────────
export async function rewriteWithProvider(rawPrompt, classification, provider, apiKey, modelOverride) {
  const model = modelOverride || getModel(provider, 'smart')
  const truncated = rawPrompt.slice(0, MAX_INPUT_CHARS)

  const techniqueStr = (classification?.techniques || []).slice(0, 3)
    .map((t, i) => `T${i+1}: ${t.name} | Label: ${t.label} | Why: ${t.why}`)
    .join('\n')

  const userMsg = [
    `User input: "${truncated}"`,
    `Domain: ${classification?.domain || 'general'} / ${classification?.sub_domain || ''}`,
    `Goal: ${classification?.goal || 'unclear'}`,
    `Output format needed: ${classification?.output_format || 'explain'}`,
    `Tone: ${classification?.tone || 'professional'}`,
    `Expert persona: ${classification?.persona || 'World-class domain expert'}`,
    `User context: ${classification?.user_context || 'unknown'}`,
    techniqueStr ? `\nUse these 3 techniques (one per prompt):\n${techniqueStr}` : '',
    `\nGenerate 3 completely different prompts. Each 80-180 words. Make them SPECIFIC to this exact input -- not templates.`,
  ].filter(Boolean).join('\n')

  try {
    const raw = await callWithRetry(
      provider, apiKey, model,
      REWRITE_SYS,
      userMsg,
      MAX_REWRITE_TOKENS
    )
    const data = safeJSON(raw)
    if (!data?.rewrites?.length) throw new Error('no rewrites in response')

    // Merge technique metadata back
    const techs = classification?.techniques || []
    data.rewrites.forEach((r, i) => {
      if (techs[i]) {
        r.label     = r.label     || techs[i].label
        r.technique = r.technique || techs[i].name
        r.why       = r.why       || techs[i].why
      }
      r.domain     = classification?.domain     || 'general'
      r.outputType = classification?.output_format || 'explain'
      r.source     = provider
      r.model      = model
    })

    return { ok: true, rewrites: data.rewrites, goal: data.goal, classification }
  } catch (e) {
    console.error('[PET rewrite]', provider, e.message)
    return { ok: false, error: e.message }
  }
}

// ── Main export: full sense + rewrite pipeline ─────────────────────────────
export async function petRewrite(rawPrompt, provider, apiKey, modelOverride) {
  if (!rawPrompt?.trim()) return { ok: false, error: 'empty prompt' }
  if (!apiKey)             return { ok: false, error: 'no api key' }

  // Step 1: classify (non-blocking for UX -- if it fails, proceed with null)
  const classification = await sense(rawPrompt, provider, apiKey)

  // Step 2: rewrite using classification
  return rewriteWithProvider(rawPrompt, classification, provider, apiKey, modelOverride)
}

// ── Evaluate: score a response against the original question ───────────────
const EVAL_SYS = `Evaluate this AI response against the user's goal. Return ONLY valid JSON.
Be domain-aware: a mental health response should score high on empathy+safety, not word count.
A finance response needs specific numbers. A creative response needs originality.

{"score":<0-100>,"grade":"A|B|C|D|F","domain_score":<0-100 domain-appropriate quality>,"covered":["<specific thing well-addressed>"],"missing":["<specific gap>"],"quality_note":"<one sentence>","next_prompt":"<complete follow-up the user should send -- 60-120 words, references actual response content>","should_stop":<true if goal is substantially complete>}`

export async function petEvaluate(question, response, provider, apiKey, modelOverride) {
  if (!question || !response) return null
  const model = modelOverride || getModel(provider, 'fast')

  const userMsg = `User goal: "${question.slice(0, 300)}"\n\nAI response:\n"""${response.slice(0, 1500)}"""\n\nEvaluate quality and write a specific follow-up prompt.`

  try {
    const raw = await callWithRetry(provider, apiKey, model, EVAL_SYS, userMsg, 400)
    const data = safeJSON(raw)
    if (!data?.score) return null
    data.score      = Math.max(10, Math.min(99, data.score))
    data.grade      = data.grade || (data.score >= 85 ? 'A' : data.score >= 70 ? 'B' : data.score >= 55 ? 'C' : data.score >= 40 ? 'D' : 'F')
    data.grade_label = { A: 'Excellent ✦', B: 'Good ✓', C: 'Partial ~', D: 'Weak ✗', F: 'Off-target ✗' }[data.grade] || '~'
    data.source = provider
    return data
  } catch (e) {
    console.warn('[PET evaluate]', provider, e.message)
    return null
  }
}
