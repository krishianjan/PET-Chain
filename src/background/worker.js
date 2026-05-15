const BACKEND      = 'http://localhost:8000'
const OLLAMA       = 'http://localhost:11434'
// When you deploy backend publicly, change this to your hosted URL:
// const TRACK_URL = 'https://your-app.railway.app'
const TRACK_URL    = BACKEND

// ── Install / lifecycle tracking ──────────────────────────────────────────────
// Generates a random anonymous ID once and reuses it — no PII collected.
async function getCID() {
  const r = await chrome.storage.local.get('pet_cid')
  if (r.pet_cid) return r.pet_cid
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ pet_cid: id })
  return id
}

async function ping(event) {
  try {
    const cid     = await getCID()
    const version = chrome.runtime.getManifest().version
    await fetch(`${TRACK_URL}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, version, cid }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* tracking never blocks anything */ }
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') ping('install')
  else if (details.reason === 'update') ping('update')
})

chrome.runtime.onStartup.addListener(() => ping('active'))

// Keep service worker alive
chrome.alarms.create('pet_alive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener(() => {})

// ── Message handler ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    try {
      sendResponse(await route(msg))
    } catch (e) {
      console.error('[PET worker]', e.message)
      sendResponse({ ok: false, error: e.message, rewrites: instant(msg.prompt || '') })
    }
  })()
  return true
})

async function route(msg) {
  if (msg.type === 'GET_ALL_KEYS')     return getKeys()
  if (msg.type === 'SET_KEY')          return setKey(msg.provider, msg.key)
  if (msg.type === 'OLLAMA_MODELS')    return getOllamaModels()

  if (msg.type === 'REWRITE') {
    const prompt = (msg.prompt || '').trim()
    if (!prompt) return { ok: true, rewrites: [] }

    const keys = await getKeys()

    // Tier 1: Ollama (local, free, private) — no key needed
    if (keys.ollama_model) {
      try {
        const data = await ollamaRewrite(prompt, keys.ollama_model, msg.session_id)
        if (data?.rewrites?.length) return { ok: true, ...data, source: 'ollama' }
      } catch (e) { console.warn('[PET] Ollama unavailable:', e.message) }
    }

    // Tier 2: Groq/OpenAI backend
    const key = msg.api_key || keys.groq || keys.openai || keys.deepseek
    if (key) {
      try {
        const data = await post('/rewrite', { prompt, api_key: key, session_id: msg.session_id })
        if (data?.rewrites?.length) return { ok: true, ...data, source: 'groq' }
      } catch (e) { console.warn('[PET] backend unavailable') }
    }

    // Tier 3: offline static templates
    return { ok: true, rewrites: instant(prompt), source: 'instant' }
  }

  if (msg.type === 'EVALUATE') {
    if (!msg.question || !msg.response) return { ok: false, error: 'missing fields' }

    const keys = await getKeys()

    // Tier 1: Ollama
    if (keys.ollama_model) {
      try {
        const data = await ollamaEvaluate(msg.question, msg.response, keys.ollama_model, msg.session_id)
        if (data?.score !== undefined) return { ok: true, ...data, source: 'ollama' }
      } catch (e) { console.warn('[PET] Ollama eval unavailable:', e.message) }
    }

    // Tier 2: Groq/OpenAI backend
    const key = msg.api_key || keys.groq || keys.openai || keys.deepseek
    if (key) {
      try {
        const data = await post('/evaluate', { question: msg.question, response: msg.response, api_key: key, session_id: msg.session_id })
        if (data?.score !== undefined) return { ok: true, ...data }
      } catch (e) { console.warn('[PET] eval backend unavailable') }
    }

    // Tier 3: rule-based scorer
    return ruleScore(msg.question, msg.response)
  }

  return { ok: false, error: 'unknown type' }
}

// ── Ollama helpers ────────────────────────────────────────────────────────

async function getOllamaModels() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { ok: false, models: [] }
    const data = await r.json()
    const models = (data.models || []).map(m => ({
      name: m.name,
      size: m.size ? `${(m.size / 1e9).toFixed(1)}GB` : '',
      family: m.details?.family || '',
    }))
    return { ok: true, models }
  } catch {
    return { ok: false, models: [] }
  }
}

// Single Ollama chat call — OpenAI-compatible endpoint
async function ollamaChat(model, system, user, maxTokens = 2000) {
  const r = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
      temperature: 0.75,
      stream: false,
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`)
  const data = await r.json()
  return data.choices?.[0]?.message?.content || ''
}

function safeJSON(raw) {
  if (!raw) return null
  const t = raw.trim()
  try { return JSON.parse(t) } catch {}
  const m = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (m) { try { return JSON.parse(m[1].trim()) } catch {} }
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s !== -1 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)) } catch {}
    try { return JSON.parse(t.slice(s, e + 1).replace(/,(\s*[}\]])/g, '$1')) } catch {}
  }
  return null
}

const OLLAMA_CLASSIFY_SYS = `You are a prompt engineering expert. Classify the user's question and choose 3 different techniques.

Return ONLY valid JSON (no explanation):
{
  "domain": "<specific domain like 'organic chemistry', 'machine learning', 'personal finance'>",
  "task": "<learn|debug|build|analyze|write|calculate|compare|create>",
  "techniques": [
    {"name": "<Technique1>", "label": "<emoji + short name>", "why": "<one sentence why for THIS question>", "persona": "<expert role>"},
    {"name": "<Technique2>", "label": "<emoji + short name>", "why": "<one sentence why for THIS question>", "persona": "<expert role>"},
    {"name": "<Technique3>", "label": "<emoji + short name>", "why": "<one sentence why for THIS question>", "persona": "<expert role>"}
  ]
}

Pick 3 DIFFERENT techniques from: Chain-of-Thought, Socratic Method, Feynman Technique, Few-Shot Examples, Tree of Thought, Devil's Advocate, Expert Panel, Comparative Analysis, First Principles, Role Reversal`

const OLLAMA_REWRITE_SYS = `You are a master prompt engineer. Generate 3 DIFFERENT expert prompts for the user's question.

RULES:
- Each prompt uses a DIFFERENT technique (assigned in the request)
- Each prompt is tailored to THIS specific question — not a generic template
- NEVER apply software/tech templates (MVP, architecture, tech stack) to non-tech questions
- Each prompt: 150-250 words, starts with expert role, uses clear structured sections
- Make each prompt meaningfully different in structure, angle, and depth

Return ONLY valid JSON:
{"goal":"<what user wants>","rewrites":[{"id":"r1","technique":"<name>","label":"<emoji label>","why":"<why this technique>","prompt":"<full prompt>","recommended":true},{"id":"r2","technique":"<name>","label":"<emoji label>","why":"<why>","prompt":"<full prompt>","recommended":false},{"id":"r3","technique":"<name>","label":"<emoji label>","why":"<why>","prompt":"<full prompt>","recommended":false}]}`

const OLLAMA_EVAL_SYS = `Evaluate this LLM response quality. Return ONLY valid JSON:
{"score":<0-100>,"grade":"<A|B|C|D|F>","covered":["<what was addressed well>"],"missing":["<specific gaps>"],"next_prompt":"<complete follow-up prompt the user can send — 80-150 words, specific to this response>"}`

async function ollamaRewrite(prompt, model, sessionId) {
  // Step 1: classify intent (fast — small response)
  const classifyRaw = await ollamaChat(model, OLLAMA_CLASSIFY_SYS,
    `Classify this question: "${prompt}"`, 400)
  const intent = safeJSON(classifyRaw)

  // Step 2: generate 3 different prompts
  const techniqueStr = (intent?.techniques || []).slice(0, 3).map((t, i) =>
    `Technique ${i+1}: ${t.name} | Label: ${t.label} | Persona: ${t.persona} | Why: ${t.why}`
  ).join('\n')

  const userMsg = `User question: "${prompt}"\nDomain: ${intent?.domain || 'general'}\nTask: ${intent?.task || 'explore'}\n\nUse these 3 different techniques (one per prompt):\n${techniqueStr || 'Chain-of-Thought, Socratic Method, First Principles'}\n\nGenerate 3 completely different prompts.`

  const rewriteRaw = await ollamaChat(model, OLLAMA_REWRITE_SYS, userMsg, 2000)
  const data = safeJSON(rewriteRaw)
  if (!data?.rewrites?.length) return null

  // Merge technique labels from intent
  const techniques = intent?.techniques || []
  data.rewrites.forEach((r, i) => {
    if (techniques[i]) {
      r.label     = r.label     || techniques[i].label
      r.technique = r.technique || techniques[i].name
      r.why       = r.why       || techniques[i].why
    }
  })
  return data
}

async function ollamaEvaluate(question, response, model, sessionId) {
  const userMsg = `User goal: "${question}"\n\nLLM response:\n"""\n${response.slice(0, 1500)}\n"""\n\nEvaluate quality and write a follow-up prompt.`
  const raw = await ollamaChat(model, OLLAMA_EVAL_SYS, userMsg, 600)
  const data = safeJSON(raw)
  if (!data?.score) return null
  data.setdefault = undefined  // ensure clean object
  data.score    = data.score    ?? 50
  data.grade    = data.grade    ?? 'C'
  data.covered  = data.covered  ?? []
  data.missing  = data.missing  ?? []
  const gradeMap = { A: 'Excellent ✦', B: 'Good ✓', C: 'Partial ~', D: 'Weak ✗', F: 'Off-target ✗' }
  data.grade_label = gradeMap[data.grade] || '~'
  return data
}

async function post(path, body) {
  const ctrl = new AbortController()
  const tid  = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(BACKEND + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  } finally { clearTimeout(tid) }
}

// ── Domain detection ──────────────────────────────────────────────────────
// Order: specific STEM/science domains FIRST, generic "build/make" LAST
// This prevents "make a reaction chain" from matching code_build
function detectDomain(p) {
  const t = p.toLowerCase()
  if (/\b(stock|invest|market|finance|money|crypto|bitcoin|return|profit|loss|portfolio|dividend|equity|fund|trade|roi|bond|etf|share|wealth|budget|saving|bank|interest rate|compound interest|asset|forex|inflation|recession)\b/.test(t)) return 'finance'
  if (/\b(fix|debug|error|bug|crash|exception|traceback|broken|not working|fails|undefined|null pointer|stack trace|segfault|memory leak)\b/.test(t)) return 'code_debug'
  // Science checked BEFORE code_build — "make a reaction" is science, not coding
  if (/\b(chemistry|chemical|compound|reaction|molecule|atom|periodic table|organic|biochem|lab test|experiment|titration|bond|enzyme|protein|dna|rna|genetics|biology|cell|evolution|ecology|physics|quantum|mechanics|thermodynamics|astronomy|astrophysics|geology|compound|element|valence|isotope)\b/.test(t)) return 'science'
  if (/\b(math|calculate|equation|algebra|calculus|geometry|probability|statistics|proof|solve|integral|derivative|matrix|formula|arithmetic|linear algebra|differential|topology|number theory)\b/.test(t)) return 'math'
  if (/\b(health|diet|exercise|medical|disease|symptom|treatment|nutrition|fitness|mental health|therapy|medicine|workout|calories|sleep|supplement|medication|dosage|chronic|vaccine)\b/.test(t)) return 'health'
  if (/\b(write|essay|blog|email|letter|content|article|draft|copywrite|story|poem|script|copy|caption|headline|newsletter|proposal|resume|cover letter)\b/.test(t)) return 'writing'
  // code_build last among specific domains — "make" is too generic a word
  if (/\b(build|develop|implement|code|app|website|api|database|backend|frontend|scaffold|deploy|program|script|function|algorithm|microservice|architecture|framework)\b/.test(t)) return 'code_build'
  if (/\b(learn|teach|explain|what is|how does|how do|understand|tutorial|concept|beginner|study|course|guide|introduction|overview)\b/.test(t)) return 'learn'
  return 'general'
}

// ── Prompt Engineering Technique Engine ───────────────────────────────────
// Returns 3 randomly-selected techniques from a pool of 5 per domain
function pickThree(pool) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 3).map((r, i) => ({ ...r, id: `r${i+1}`, recommended: i === 0 }))
}

// Two universal techniques that work across all domains — added to every pool
function UNIVERSAL_EXTRAS(prompt) {
  return [
    {
      technique: "Devil's Advocate",
      label: "😈 Devil's Advocate",
      why: "Challenges hidden assumptions — forces you to defend or refine your thinking",
      prompt: [
        "You are a brilliant contrarian expert. Question: " + prompt,
        "",
        "First give the STANDARD answer most experts give (2-3 sentences).",
        "",
        "Now CHALLENGE IT completely:",
        "ASSUMPTION 1 everyone makes: [assumption] → why it might be wrong",
        "ASSUMPTION 2 everyone makes: [assumption] → why it might be wrong",
        "ASSUMPTION 3 everyone makes: [assumption] → why it might be wrong",
        "",
        "THE CONTRARIAN VIEW:",
        "What would the top 1% of experts say that contradicts conventional wisdom?",
        "What specific evidence supports the contrarian position?",
        "",
        "SYNTHESIS:",
        "Where is conventional wisdom actually right?",
        "Where is the contrarian view right?",
        "Most defensible nuanced position, in one sentence:",
      ].join('\n'),
    },
    {
      technique: "Expert Panel",
      label: "🎓 Expert Panel",
      why: "Multiple expert angles expose blind spots any single perspective misses",
      prompt: [
        "Simulate a 3-expert panel discussion about: " + prompt,
        "",
        "EXPERT 1 — THE PRACTITIONER (works with this daily):",
        "  Practical take: [what real experience teaches]",
        "  Most important insight: [what only daily work reveals]",
        "  #1 mistake they see people make:",
        "",
        "EXPERT 2 — THE RESEARCHER (studies this rigorously):",
        "  Evidence-based take: [what research actually shows]",
        "  Most important finding: [what the data says]",
        "  Where conventional wisdom is wrong:",
        "",
        "EXPERT 3 — THE SKEPTIC (questions both of the above):",
        "  Critical take: [what both experts are missing]",
        "  Most overlooked consideration:",
        "  The question nobody asks but should:",
        "",
        "PANEL VERDICT:",
        "  Where all three agree:",
        "  Key disagreement and why it matters:",
        "  Single most actionable takeaway:",
      ].join('\n'),
    },
  ]
}

function instant(prompt) {
  const domain = detectDomain(prompt)

  if (domain === 'finance') return pickThree([
    {
      id: 'r1', technique: 'Chain of Thought', recommended: true,
      label: '⛓ Chain-of-Thought Analysis',
      why: 'Forces step-by-step financial reasoning — no skipped logic',
      prompt: [
        'You are a Chartered Financial Analyst (CFA) with 15 years managing equity portfolios.',
        '',
        'My question: ' + prompt,
        '',
        'Walk through this STEP BY STEP — show your complete reasoning at each stage:',
        '',
        'STEP 1 — DEFINE THE CORE CONCEPT',
        '  What exactly is this? Define every key term before using it.',
        '  What problem does it solve? Why do people use it?',
        '',
        'STEP 2 — THE MATH (show all formulas before applying them)',
        '  List each relevant formula: name → formula → what each variable means.',
        '  Example: ROI = (Gain − Cost) / Cost × 100',
        '  Work through a calculation with real numbers (e.g. Apple, S&P 500).',
        '',
        'STEP 3 — HOW IT WORKS IN PRACTICE',
        '  Walk through a realistic scenario step by step.',
        '  Use specific values — no vague placeholders.',
        '',
        'STEP 4 — DECISION CRITERIA',
        '  What numbers signal "good"? What signals "avoid"?',
        '  Concrete thresholds (e.g. P/E < 20, ROI > 15% annually).',
        '',
        'STEP 5 — RISK MANAGEMENT',
        '  What can go wrong? Quantify the downside.',
        '  How do experts protect against this specific risk?',
        '',
        'STEP 6 — FIRST ACTION',
        '  Given everything above, what is the single most important thing',
        '  someone should do in the next 24 hours? Be specific.',
        '',
        'Show every calculation. Use real company examples. No vague advice.',
      ].join('\n'),
    },
    {
      id: 'r2', technique: 'Few-Shot Expert', recommended: false,
      label: '🎯 Few-Shot Expert Format',
      why: 'Anchors the model to expert-level answer depth via examples',
      prompt: [
        'I want expert-level answers about finance. Here is the format I need:',
        '',
        '--- EXAMPLE OF CORRECT EXPERT RESPONSE ---',
        'Q: How do I calculate return on a stock?',
        'A: If you bought 10 shares of Apple at $150 and sold at $185 after 1.5 years:',
        '   • Capital gain = ($185 − $150) × 10 = $350',
        '   • Simple ROI = ($350 / $1,500) × 100 = 23.3%',
        '   • Annualised CAGR = (185/150)^(1/1.5) − 1 = 14.9% per year',
        '   • Compare: S&P 500 averages ~10.5%/year historically',
        '   • Verdict: Strong outperformance. Key risk: single stock concentration.',
        '--- END EXAMPLE ---',
        '',
        'Now match that exact depth and format to answer ALL aspects of my question:',
        '',
        prompt,
        '',
        'For every concept:',
        '  1. State the formula clearly',
        '  2. Plug in real numbers (use Apple, Tesla, S&P 500 as examples)',
        '  3. Interpret the result — what does this number tell me?',
        '  4. Flag the top risk / mistake people make with this metric',
        '',
        'End with: "Your concrete first step this week: [specific action]"',
      ].join('\n'),
    },
    {
      id: 'r3', technique: 'Socratic Method', recommended: false,
      label: '🔬 Socratic Mentor Session',
      why: 'Builds lasting understanding by diagnosing your gaps first',
      prompt: [
        'Act as my personal finance mentor. I want to genuinely understand, not just copy answers.',
        '',
        'My goal: ' + prompt,
        '',
        'PHASE 1 — DIAGNOSE (ask me these 3 questions, wait for answers):',
        '  1. Have you ever bought/sold any investments (stocks, crypto, property)?',
        '  2. What is your timeline — learning for knowledge, or planning to invest soon?',
        '  3. What amount are you thinking of starting with?',
        '',
        'PHASE 2 — TAILORED FOUNDATION',
        '  Based on my Phase 1 answers, teach me only the 3 most important things I actually need.',
        '  Use real-world analogies. Define every term you use.',
        '  Show one worked example with my specific situation as the numbers.',
        '',
        'PHASE 3 — LIVE CALCULATION TOGETHER',
        '  Pick one real publicly-traded stock right now.',
        '  Walk me through: current price → fair value estimate → expected return → risk.',
        '  Show every step and explain WHY.',
        '',
        'PHASE 4 — MISTAKE PREVENTION',
        '  What are the 3 most common mistakes people with my background make?',
        '  For each: what they do → what happens → what to do instead.',
        '',
        'PHASE 5 — PERSONAL ACTION PLAN',
        '  Given my Phase 1 answers, give me exactly 3 next steps in priority order.',
        '  Each step: what to do, why, how long it takes.',
        '',
        'Adjust your depth based on my Phase 1 answers. Be honest if I have unrealistic expectations.',
      ].join('\n'),
    },
    ...UNIVERSAL_EXTRAS(prompt)
  ])

  if (domain === 'code_debug') return pickThree([
    {
      id: 'r1', technique: 'Chain of Thought', recommended: true,
      label: '⛓ Systematic Root Cause Analysis',
      why: 'Step-by-step elimination — finds the real cause, not symptoms',
      prompt: [
        'You are a Staff Engineer with 10+ years debugging production systems.',
        '',
        'Bug/issue: ' + prompt,
        '',
        'Diagnose systematically — show your reasoning at every step:',
        '',
        'STEP 1 — READ THE ERROR',
        '  Quote the exact error message.',
        '  Parse the stack trace: what does each frame mean?',
        '  File + line number where it originates.',
        '',
        'STEP 2 — REPRODUCE IT',
        '  Minimum code that triggers this bug (strip everything unrelated).',
        '  Under what conditions does it NOT happen?',
        '',
        'STEP 3 — ROOT CAUSE CANDIDATES (rank by likelihood)',
        '  Candidate 1: [hypothesis] — evidence for / evidence against',
        '  Candidate 2: [hypothesis] — evidence for / evidence against',
        '  Candidate 3: [hypothesis] — evidence for / evidence against',
        '',
        'STEP 4 — VERIFY THE MOST LIKELY CAUSE',
        '  Exact command or log statement to confirm.',
        '  Expected output if this hypothesis is correct.',
        '',
        'STEP 5 — THE FIX',
        '  BEFORE (broken):',
        '  [code]',
        '  AFTER (fixed):',
        '  [code]',
        '  Why this works: [mechanism]',
        '',
        'STEP 6 — VERIFY + PREVENT',
        '  Test input → expected output that confirms the fix.',
        '  One guardrail to prevent this whole class of bug permanently.',
        '',
        'Do not guess. Show all reasoning.',
      ].join('\n'),
    },
    {
      id: 'r2', technique: 'Zero-Shot Expert', recommended: false,
      label: '⚡ Zero-Shot Quick Fix',
      why: 'Direct answer — fastest path to working code',
      prompt: [
        'You are a senior engineer. Fix this immediately: ' + prompt,
        '',
        'Respond in exactly this structure:',
        '',
        'ONE-LINE DIAGNOSIS: [what is wrong, in plain English]',
        '',
        'THE FIX:',
        'BEFORE:',
        '[broken code]',
        '',
        'AFTER:',
        '[fixed code]',
        '',
        'WHY IT WORKS: [one sentence — the mechanism]',
        '',
        'VERIFY WITH: [the exact input/command that proves it is fixed]',
        '',
        'ALSO CHECK: [one related thing that commonly breaks alongside this]',
        '',
        'No preamble. Start with "ONE-LINE DIAGNOSIS:"',
      ].join('\n'),
    },
    {
      id: 'r3', technique: 'Tree of Thought', recommended: false,
      label: '🌳 Tree of Thought — Fix + Harden',
      why: 'Explores multiple fix paths, then eliminates this class of bug permanently',
      prompt: [
        'Senior engineer: fix AND harden against this entire bug class.',
        '',
        'Issue: ' + prompt,
        '',
        'BRANCH A — Immediate Fix',
        '  The fastest change that stops the problem right now.',
        '  Show the code diff (BEFORE / AFTER).',
        '',
        'BRANCH B — Root Cause Fix',
        '  Why did this really happen? (Not the surface error — the underlying design issue.)',
        '  A deeper fix that prevents recurrence without band-aids.',
        '',
        'BRANCH C — Systemic Hardening',
        '  What other code in this codebase likely has the same pattern?',
        '  Give me a grep/search query to find all instances.',
        '  One lint rule or type annotation that catches this at compile time.',
        '',
        'FINAL RECOMMENDATION:',
        '  Which branch to apply first, second, third — and why.',
        '  One test that would have caught this bug before it reached production.',
      ].join('\n'),
    },
    ...UNIVERSAL_EXTRAS(prompt)
  ])

  if (domain === 'code_build') return pickThree([
    {
      id: 'r1', technique: 'Chain of Thought', recommended: true,
      label: '⛓ Spec-First Architecture',
      why: 'Thinks through the full system before writing a single line',
      prompt: [
        'You are a Senior Software Architect (12 years experience).',
        '',
        'Project: ' + prompt,
        '',
        'Design this completely before any implementation:',
        '',
        'STEP 1 — REQUIREMENTS ANALYSIS',
        '  Core features (must-have vs nice-to-have).',
        '  User flows: [User action] → [System response] → [Data changed]',
        '  Edge cases and error states.',
        '',
        'STEP 2 — TECH STACK DECISION',
        '  For each choice, give: name + version + why this over the top alternative.',
        '  Framework / DB / Auth / Hosting / State management',
        '',
        'STEP 3 — DATA MODEL',
        '  Every entity, field, type, relationship, and index.',
        '  Show as a schema or table.',
        '',
        'STEP 4 — FILE STRUCTURE',
        '  Every file and folder with a one-line purpose comment.',
        '',
        'STEP 5 — IMPLEMENTATION ORDER',
        '  Step 1: [what + why first]',
        '  Step 2: [what + why second] ... through deployment.',
        '',
        'STEP 6 — SETUP COMMANDS',
        '  Every command from a blank machine to running locally. Copy-paste ready.',
        '',
        'STEP 7 — TOP 3 PITFALLS',
        '  What will break first. How to prevent each before it happens.',
        '',
        'Be specific. No placeholders. Start with the file structure.',
      ].join('\n'),
    },
    {
      id: 'r2', technique: 'Few-Shot Expert', recommended: false,
      label: '🎯 Pattern-First (Few-Shot)',
      why: 'Shows you the pattern, then applies it to your exact case',
      prompt: [
        'Senior engineer teaching by example. Task: ' + prompt,
        '',
        '--- EXAMPLE OF HOW I WANT THIS EXPLAINED ---',
        'Task: "Build a user authentication API with JWT"',
        'Answer:',
        '  Tech: Node.js + Express + bcrypt + jsonwebtoken',
        '  Key pattern: POST /login → verify password → sign JWT → return token',
        '  Core file (auth.js):',
        '    router.post("/login", async (req, res) => {',
        '      const user = await User.findOne({ email: req.body.email })',
        '      if (!user || !bcrypt.compareSync(req.body.password, user.hash))',
        '        return res.status(401).json({ error: "Invalid credentials" })',
        '      res.json({ token: jwt.sign({ id: user._id }, process.env.JWT_SECRET) })',
        '    })',
        '  Gotcha: Always hash passwords with bcrypt. Never store plain text.',
        '--- END EXAMPLE ---',
        '',
        'Now apply that same teaching depth to: ' + prompt,
        '',
        'Show me:',
        '  1. The core pattern / key architectural decision',
        '  2. The most important file — complete working code',
        '  3. The setup commands from scratch',
        '  4. The #1 mistake beginners make and how to avoid it',
      ].join('\n'),
    },
    {
      id: 'r3', technique: 'Zero-Shot Expert', recommended: false,
      label: '⚡ MVP Blueprint',
      why: 'Fastest path from zero to something working',
      prompt: [
        'You are a startup engineer (8 years) who ships fast. Task: ' + prompt,
        '',
        'Give me the MVP blueprint — working in hours, not weeks:',
        '',
        'MVP SCOPE',
        '  Include ONLY: [3 features that prove core value]',
        '  Defer to v2: [everything else]',
        '',
        'TECH (simplest stack that works):',
        '  [one framework] + [one database] + [one hosting platform]',
        '',
        'COPY-PASTE SETUP:',
        '  [every command from blank terminal to running app]',
        '',
        'THE FIRST FILE TO CREATE:',
        '  [complete file content — no placeholders]',
        '',
        'DONE WHEN:',
        '  [exact test that proves the MVP works end-to-end]',
        '',
        'No over-engineering. Solve the problem first.',
      ].join('\n'),
    },
    ...UNIVERSAL_EXTRAS(prompt)
  ])

  if (domain === 'math') return pickThree([
    {
      id: 'r1', technique: 'Chain of Thought', recommended: true,
      label: '⛓ Show-Every-Step Solution',
      why: 'Visible reasoning at each step — understand, not just memorise',
      prompt: [
        'You are a Mathematics Professor who teaches by making reasoning fully visible.',
        '',
        'Problem: ' + prompt,
        '',
        'Solve this step by step — never skip a step:',
        '',
        'STEP 1 — UNDERSTAND THE PROBLEM',
        '  What type of problem is this? (e.g. optimization, integration, probability)',
        '  What are we given? What are we solving for?',
        '  Restate it in the simplest possible words.',
        '',
        'STEP 2 — CHOOSE THE METHOD',
        '  Which approach? Why this one over alternatives?',
        '  State any theorems or formulas we will use.',
        '',
        'STEP 3 — SOLVE (show every line)',
        '  Line 1: [expression] — because [reason]',
        '  Line 2: [expression] — because [reason]',
        '  ... (do not skip any algebra)',
        '',
        'STEP 4 — VERIFY',
        '  Plug the answer back in. Confirm it satisfies the original equation/condition.',
        '  Order-of-magnitude check: does this answer make intuitive sense?',
        '',
        'STEP 5 — GENERALISE',
        '  What is the pattern here?',
        '  What would change if [one variable] were different?',
        '  One similar problem type I should practice next.',
      ].join('\n'),
    },
    {
      id: 'r2', technique: 'Few-Shot Expert', recommended: false,
      label: '🎯 Worked Examples First',
      why: 'See two solved examples, then solve yours with full guidance',
      prompt: [
        'Mathematics tutor using the worked-example method.',
        'Topic/problem: ' + prompt,
        '',
        'First, show me TWO similar solved examples with full working:',
        '',
        'EXAMPLE 1 (simpler): [choose a simpler version of the same problem type]',
        '  [complete solution with every step visible]',
        '',
        'EXAMPLE 2 (realistic): [a typical real-world instance]',
        '  [complete solution with every step visible]',
        '',
        'Now solve MY problem using the same method:',
        '  [full solution to the original problem]',
        '',
        'PATTERN: State the general rule or formula this problem illustrates.',
        '',
        'COMMON MISTAKES: Top 2 errors students make on this type. Show wrong → right.',
        '',
        'PRACTICE: Give me one more problem of the same type (do not solve it yet).',
      ].join('\n'),
    },
    {
      id: 'r3', technique: 'Socratic Method', recommended: false,
      label: '🔬 Build Intuition First (Socratic)',
      why: 'Understand WHY before HOW — builds permanent mathematical thinking',
      prompt: [
        'Mathematics Socratic tutor. Topic: ' + prompt,
        '',
        'Do NOT solve it immediately. Build my understanding first:',
        '',
        'PHASE 1 — INTUITION',
        '  Explain the core idea using only a real-world analogy (no math yet).',
        '  Why does this concept exist? What problem does it solve?',
        '',
        'PHASE 2 — GUIDED DISCOVERY',
        '  Ask me: "What do you think happens when ___?" (wait for my answer)',
        '  Guide me toward the insight rather than stating it.',
        '',
        'PHASE 3 — FORMAL DEFINITION',
        '  Now introduce the formula/theorem with precise notation.',
        '  Show how it connects to the intuition from Phase 1.',
        '',
        'PHASE 4 — WORKED SOLUTION',
        '  Solve the original problem step by step.',
        '  Narrate what you are thinking as you write each line.',
        '',
        'PHASE 5 — TEST MY UNDERSTANDING',
        '  Give me a variation and ask what I predict the answer will be.',
      ].join('\n'),
    },
    ...UNIVERSAL_EXTRAS(prompt)
  ])

  if (domain === 'learn') return pickThree([
    {
      id: 'r1', technique: 'Chain of Thought', recommended: true,
      label: '⛓ Expert Educator (Full Walkthrough)',
      why: 'Zero to confident — builds complete mental model systematically',
      prompt: [
        'You are an expert educator with 20 years teaching this subject to complete beginners.',
        '',
        'Topic: ' + prompt,
        '',
        'Build my understanding systematically:',
        '',
        'STEP 1 — PLAIN LANGUAGE CORE',
        '  Explain in one sentence. Add a real-world analogy.',
        '  Why does this exist? What problem does it solve?',
        '',
        'STEP 2 — FORMAL DEFINITION',
        '  Precise definition. Define every key term you use.',
        '',
        'STEP 3 — WORKED EXAMPLE 1 (simplest case)',
        '  Walk through every step.',
        '  Explain WHY each step is taken — not just what.',
        '',
        'STEP 4 — WORKED EXAMPLE 2 (realistic scenario)',
        '  Use real names, numbers, and context.',
        '  Full solution with visible reasoning.',
        '',
        'STEP 5 — COMMON MISTAKES',
        '  Top 3 errors beginners make.',
        '  Show: wrong approach → consequence → correct approach.',
        '',
        'STEP 6 — MENTAL MODEL',
        '  A framework or visual I can use to remember this permanently.',
        '',
        'STEP 7 — PRACTICE PROBLEMS',
        '  Easy / Medium / Hard — do NOT solve them yet.',
        '',
        'STEP 8 — WHAT TO LEARN NEXT',
        '  The 2-3 concepts that build on this. Why each matters.',
        '',
        'Use real values throughout. No vague placeholders.',
      ].join('\n'),
    },
    {
      id: 'r2', technique: 'Feynman Technique', recommended: false,
      label: '🎯 Feynman Technique',
      why: 'If you can\'t explain it simply, you don\'t understand it yet',
      prompt: [
        'Apply the Feynman Technique to teach: ' + prompt,
        '',
        'LEVEL 1 — 12-YEAR-OLD EXPLANATION',
        '  Explain using only simple words and a relatable story.',
        '  No jargon. If you must use a technical word, define it immediately.',
        '',
        'LEVEL 2 — IDENTIFY THE GAPS',
        '  What parts of the Level 1 explanation were hand-wavy or imprecise?',
        '  List 3 things that require deeper understanding.',
        '',
        'LEVEL 3 — PRECISE EXPLANATION',
        '  Now explain those gaps rigorously.',
        '  Use exact definitions, examples, and correct terminology.',
        '',
        'LEVEL 4 — ANALOGY THAT STICKS',
        '  Create one analogy so good I will never forget this concept.',
        '  Explain why the analogy works AND where it breaks down.',
        '',
        'LEVEL 5 — TEST ME',
        '  Ask me a question whose correct answer proves I understood.',
        '  Tell me what a correct answer looks like.',
      ].join('\n'),
    },
    {
      id: 'r3', technique: 'Socratic Method', recommended: false,
      label: '🔬 Socratic Deep-Dive',
      why: 'Guided questions build genuine understanding — not just memorised answers',
      prompt: [
        'Act as a Socratic tutor for: ' + prompt,
        '',
        'PHASE 1 — DIAGNOSE MY GAPS',
        '  Ask me 3 probing questions to find exactly where my understanding breaks down.',
        '  (Wait for my answers before continuing.)',
        '',
        'PHASE 2 — TARGETED EXPLANATION',
        '  Based on my answers, explain only what I actually need.',
        '  Use the simplest language possible, then add precision.',
        '',
        'PHASE 3 — VERIFY WITH APPLICATION',
        '  Give me a specific problem that proves I understood.',
        '  Tell me what a correct answer looks like before I attempt it.',
        '',
        'PHASE 4 — EDGE CASES',
        '  What is the counterintuitive case that makes this concept click?',
        '  What do experts know about this that beginners consistently miss?',
        '',
        'PHASE 5 — CONNECTIONS',
        '  How does this connect to 3 related concepts?',
        '  Where would I use this in real work or life today?',
        '',
        'Be direct if I am wrong. Do not validate incorrect thinking.',
      ].join('\n'),
    },
    ...UNIVERSAL_EXTRAS(prompt)
  ])

  if (domain === 'writing') return pickThree([
    {
      id: 'r1', technique: 'Chain of Thought', recommended: true,
      label: '⛓ Structure-First Writing',
      why: 'Professional writers outline before they write — this forces that',
      prompt: [
        'You are a Senior Content Strategist with 15 years writing for top publications.',
        '',
        'Writing task: ' + prompt,
        '',
        'Approach this like a professional:',
        '',
        'STEP 1 — AUDIENCE & GOAL',
        '  Who is reading this? What do they already know?',
        '  What action or belief should they have after reading?',
        '',
        'STEP 2 — HOOK (first 30 words)',
        '  Write 3 alternative opening lines. Rank them. Explain why #1 wins.',
        '',
        'STEP 3 — OUTLINE',
        '  Section by section: [heading] → [point] → [evidence/example]',
        '',
        'STEP 4 — FULL DRAFT',
        '  Write the complete piece.',
        '  Every paragraph: one clear idea, specific evidence, short sentences.',
        '',
        'STEP 5 — SELF-EDIT',
        '  Cut every word that does not earn its place.',
        '  Replace every vague word with a specific one.',
        '  Flag any section that is weak and explain why.',
        '',
        'STEP 6 — HEADLINE/SUBJECT OPTIONS',
        '  5 alternative headlines, ranked by likely click-through rate.',
      ].join('\n'),
    },
    {
      id: 'r2', technique: 'Few-Shot Expert', recommended: false,
      label: '🎯 Style-Matched (Few-Shot)',
      why: 'Gives the model the exact tone and style to match before writing',
      prompt: [
        'Senior writer. Task: ' + prompt,
        '',
        '--- EXAMPLE OF THE QUALITY AND STYLE I WANT ---',
        '[Write a 3-sentence example of excellent writing in the target style/tone]',
        '--- END EXAMPLE ---',
        '',
        'Match that voice exactly. Write the full piece:',
        '',
        '  • Active verbs, not passive',
        '  • Specific details, not generalities',
        '  • Short sentences for impact, longer for flow',
        '  • No filler phrases ("In conclusion", "It is important to note")',
        '',
        'After the draft:',
        '  WHAT WORKS: [2-3 strongest elements]',
        '  WHAT TO CUT: [anything that weakens the piece]',
        '  ALTERNATIVE HEADLINE: [3 options]',
      ].join('\n'),
    },
    {
      id: 'r3', technique: 'Zero-Shot Expert', recommended: false,
      label: '⚡ Direct Expert Draft',
      why: 'No warmup — straight to the best possible draft',
      prompt: [
        'World-class writer. Task: ' + prompt,
        '',
        'Rules:',
        '  • First sentence must hook the reader immediately',
        '  • Every claim backed by a specific example or number',
        '  • No corporate jargon, no passive voice',
        '  • End with a clear call to action or memorable final line',
        '',
        'Write the complete piece now. Then provide:',
        '  WORD COUNT: [n]',
        '  READING TIME: [n] minutes',
        '  TONE: [professional / conversational / persuasive]',
        '  STRONGEST LINE: [quote the best sentence]',
        '  ONE THING TO IMPROVE: [honest critique]',
      ].join('\n'),
    },
    ...UNIVERSAL_EXTRAS(prompt)
  ])

  // science, health, or general — all use the same 3 universal techniques
  const domainLabel = { science: 'Science', health: 'Health', general: 'Expert' }[domain] || 'Expert'

  return pickThree([
    {
      id: 'r1', technique: 'Chain of Thought', recommended: true,
      label: '⛓ Chain-of-Thought Analysis',
      why: 'Forces complete systematic reasoning — no hand-waving',
      prompt: [
        'You are a world-class ' + domainLabel + ' with 15+ years of hands-on experience.',
        '',
        'My question: ' + prompt,
        '',
        'Reason through this completely — show every step:',
        '',
        'STEP 1 — FRAME THE PROBLEM',
        '  What exactly is being asked? What are the key variables?',
        '  What do I need to know before I can answer this properly?',
        '',
        'STEP 2 — CORE ANSWER',
        '  Direct answer first — the most important thing to understand.',
        '  State any relevant principles, formulas, or frameworks.',
        '',
        'STEP 3 — EXPLAIN WITH REAL EXAMPLES',
        '  At least 2 concrete examples with real values or names.',
        '  Walk through each one step by step.',
        '',
        'STEP 4 — NUANCE AND EDGE CASES',
        '  Where does the simple answer break down?',
        '  What conditions change the answer?',
        '',
        'STEP 5 — COMMON MISTAKES',
        '  Top 3 errors people make on this topic. Show: wrong → consequence → correct.',
        '',
        'STEP 6 — VERIFY',
        '  How would I know if I have this right?',
        '  What is the test or signal that confirms correct understanding?',
        '',
        'STEP 7 — FIRST ACTION',
        '  The single most useful thing to do in the next 24 hours. Be specific.',
        '',
        'Use real values throughout. No vague placeholders.',
      ].join('\n'),
    },
    {
      id: 'r2', technique: 'Few-Shot Expert', recommended: false,
      label: '🎯 Expert Format (Few-Shot)',
      why: 'Example-anchored response — sets the depth bar before answering',
      prompt: [
        'I want expert-depth answers. Here is the format:',
        '',
        '--- EXAMPLE OF CORRECT DEPTH ---',
        'Q: [similar type of question]',
        'A: [Direct answer in 1-2 sentences.]',
        '   REASONING: [the why, in 3 steps]',
        '   EXAMPLE: [specific case with real numbers/names]',
        '   CAVEAT: [when this does NOT apply]',
        '--- END EXAMPLE ---',
        '',
        'Match that exact depth and structure to answer:',
        '',
        prompt,
        '',
        'Requirements:',
        '  • Direct answer first — no preamble',
        '  • Every claim backed by a specific example',
        '  • Flag the most important caveat or exception',
        '  • End with: "The one thing most people get wrong here is: ___"',
      ].join('\n'),
    },
    {
      id: 'r3', technique: 'Tree of Thought', recommended: false,
      label: '🌳 Tree of Thought — Multi-Angle',
      why: 'Explores 3 expert perspectives, then synthesises the best answer',
      prompt: [
        'Use Tree of Thought to answer: ' + prompt,
        '',
        'Explore THREE different expert perspectives:',
        '',
        'PERSPECTIVE A — [most conventional / mainstream view]',
        '  Core argument:',
        '  Best evidence for this view:',
        '  Where it falls short:',
        '',
        'PERSPECTIVE B — [contrarian or nuanced view]',
        '  Core argument:',
        '  Best evidence for this view:',
        '  Where it falls short:',
        '',
        'PERSPECTIVE C — [practical / applied view]',
        '  Core argument:',
        '  Best evidence for this view:',
        '  Where it falls short:',
        '',
        'SYNTHESIS',
        '  Which perspective is most defensible and why?',
        '  What does the truth look like when you combine all three?',
        '  One concrete action or decision this analysis leads to.',
      ].join('\n'),
    },
    ...UNIVERSAL_EXTRAS(prompt)
  ])
}

// ── Domain-aware follow-up prompt generator ────────────────────────────────
function buildFollowUp(domain, gaps, covered, score) {
  const g0 = gaps[0] || ''
  const g1 = gaps[1] || ''
  const gapPhrase = gaps.slice(0, 2).map(w => `"${w}"`).join(' and ')

  if (score >= 78) {
    const deepeners = {
      finance:    `The explanation covered the basics well. Push it further now: "Using everything you just explained, walk me through a complete real decision. Pick one specific asset available in today's market, apply each concept you described with the actual current price, show the full calculation, and give a concrete buy/hold/sell recommendation with a specific dollar amount and timeline. Flag the biggest risk to this position."`,
      code_debug: `The fix looks solid. Now harden it: "You identified the root cause — next: (1) write a unit test that would have caught this bug before it reached production, (2) give me a grep pattern to find similar patterns in the rest of the codebase, and (3) add the minimal type annotation or assertion that prevents this whole class of error at the function boundary."`,
      code_build: `Architecture is clear. Now ship it: "Generate the complete, working code for the single most critical file you described. Include real error handling (not just try/catch with a log), one passing test, and the exact terminal commands to run it from a blank directory."`,
      math:       `Solution verified — now build intuition: "Give me three variations of this exact problem where one variable changes. Show how the answer shifts each time and explain WHY the relationship behaves that way. Then give me a harder problem of the same type without solving it yet."`,
      science:    `Good explanation. Now make it concrete: "Describe a specific real-world experiment or observation that directly proves the mechanism you explained. Walk through it step by step — what we measure, what we see, why that confirms the theory, and what would disprove it."`,
      health:     `Solid overview. Now personalise it: "Walk me through how this applies to someone who is 30 years old, moderately active, and has no pre-existing conditions. Give specific numbers — target ranges, optimal timings, measurable outcomes — not just general advice."`,
      learn:      `Good explanation. Now test my understanding: "Ask me three progressively harder questions — easy, medium, hard — about what you just explained. After I answer each, tell me exactly what a correct answer looks like and what misconception my answer reveals (if any). Do not give me the answers yet."`,
      writing:    `Strong draft. Now sharpen it: "Apply three specific edits to what you wrote: (1) rewrite the opening sentence so it creates immediate tension or curiosity, (2) replace the three most generic adjectives with precise, specific ones, (3) cut every sentence over 25 words in half. Show me before and after for each change."`,
      general:    `Good answer. Now push the edge: "Give me a specific real-world scenario where this analysis breaks down or produces the opposite result. Use actual names and numbers. Then tell me what an expert who has seen that failure would do differently."`,
    }
    return deepeners[domain] || deepeners.general
  }

  if (gaps.length) {
    const fillers = {
      finance:    `The response left gaps on ${gapPhrase}. Follow up precisely: "Your answer was incomplete on ${g0}. Please add: (1) the exact formula or definition with every variable labelled, (2) a worked example using real 2024 data — actual ticker symbols and prices — and (3) the most common situation where this metric gives a false signal and why."`,
      code_debug: `Missing detail on ${gapPhrase}. Dig deeper: "The diagnosis skipped ${g0}. Show me the exact execution path that triggers the failure — trace it line by line through the call stack. Then confirm the fix by showing the specific input that previously caused the crash and the output after your change."`,
      code_build: `Implementation skipped ${gapPhrase}. Fill the gap: "The design is missing ${g0}. Write the complete code for that part specifically — full function signature, real error handling, edge cases handled, and one working test. No placeholders."`,
      math:       `The solution skipped steps around ${gapPhrase}. Request: "The working jumped over the ${g0} step. Show that part in full — write every algebraic manipulation as a numbered line and explain the rule or theorem applied at each transformation."`,
      science:    `Incomplete on ${gapPhrase}. Ask: "You skipped ${g0}. Explain it precisely: what is the mechanism, what evidence supports it, and what experiment would falsify it?"`,
      health:     `Didn't address ${gapPhrase}. Ask: "You left out ${g0}. Give me specific, evidence-based guidance: recommended ranges, how to measure it, and what deviation from normal looks like in practice."`,
      learn:      `Didn't explain ${gapPhrase} adequately. Request: "You mentioned ${g0} but didn't explain it. Give me: (1) a plain-English definition using a real-world analogy, (2) a concrete example with specific names or numbers, and (3) how it connects to what you explained just before it."`,
      writing:    `Response missed ${gapPhrase}. Improve it: "The piece is missing ${g0}. Rewrite the section where it should appear — and show me the before and after side by side so I can see exactly what changed and understand why it is stronger."`,
      general:    `The response didn't fully cover ${gapPhrase}. Follow up: "You skipped ${g0} entirely. Please explain it with: a clear one-sentence definition, a concrete real example using specific numbers or names, and the single most common mistake people make when dealing with it."`,
    }
    return fillers[domain] || fillers.general
  }

  const generic = {
    finance:    `Go further: "Apply what you explained to a real portfolio. Use $50,000, select 4 specific ETFs or stocks trading today, show exact allocation percentages and projected returns over 3 and 5 years, and identify the single biggest risk to this portfolio right now."`,
    code_debug: `Go further: "Show the fully fixed version of the code with all your changes applied, add a test that passes only when the bug is truly fixed, and name one related bug that frequently appears alongside this type of error."`,
    code_build: `Go further: "Build the first working feature — complete code, zero placeholders. Include the commands to run it from scratch and the exact output that proves it works end-to-end."`,
    math:       `Go further: "Give me a harder version of this problem where the answer is not immediately obvious, work through it fully, then explain what makes this problem type conceptually tricky for most students."`,
    learn:      `Go further: "Teach me the next level up — assume I completely understood your explanation. What is the adjacent concept I need to learn next, and how does it connect to what you just taught?"`,
    writing:    `Go further: "Identify the weakest paragraph in your draft. Rewrite it so the first sentence hooks the reader, every claim is backed by a specific detail, and the paragraph ends with a memorable line."`,
    general:    `Go further: "Give me a specific, concrete example that makes this immediately practical — use real names, real numbers, and a scenario I might face in the next 30 days. No hypotheticals."`,
  }
  return generic[domain] || generic.general
}

// ── Session store for offline goal-completion tracking ───────────────────────
// Mirrors backend/memory_store.py but in-memory for service worker
const _sessions = {}
function getSession(sid) {
  if (!_sessions[sid]) _sessions[sid] = { goal:'', required:[], covered:[], turn:0, bestScore:0 }
  return _sessions[sid]
}

// ── Offline scorer — goal-completion based, session-aware ─────────────────────
// No static domain buckets. No if-else per topic.
// Works by: extract goal words → check coverage → accumulate across turns → stop when done.
function ruleScore(question, response, sessionId = 'default') {
  const STOP = new Set(['want','know','about','that','this','with','from','have','will',
    'what','when','where','which','your','their','some','also','into','more','very','just',
    'like','than','then','them','they','been','were','does','make','find','tell','give',
    'show','need','help','please','could','would','should','explain','describe','create'])

  const sess = getSession(sessionId)
  if (!sess.goal) sess.goal = question

  // Extract meaningful goal keywords (these form the implicit checklist)
  const goalWords = question.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w))

  if (!sess.required.length) sess.required = goalWords

  const rt = response.toLowerCase()

  // Check what this response covers
  const newlyCovered = goalWords.filter(w => rt.includes(w) && !sess.covered.includes(w))
  const allCovered   = [...new Set([...sess.covered, ...newlyCovered])]
  const stillMissing = sess.required.filter(w => !allCovered.includes(w))

  const coveragePct  = Math.round(allCovered.length / Math.max(sess.required.length, 1) * 100)

  // Quality signals (domain-agnostic, content-based)
  const wc      = response.split(/\s+/).length
  const hasCode  = /```[\s\S]*?```/.test(response)
  const hasList  = /\n[\-\*•]|\n\d+\./.test(response)
  const hasHead  = /\n#{1,3}\s|\*\*[^*]+\*\*/.test(response)
  const hasNums  = /\d+/.test(response)
  const hasExmpl = /\b(example|instance|such as|e\.g\.|for instance|specifically|consider)\b/i.test(response)
  const hasSteps = /step\s+\d|first[,\s]|then[,\s]|finally[,\s]/i.test(response)

  let quality = 30
  if (wc > 400) quality += 20; else if (wc > 200) quality += 12; else if (wc > 80) quality += 6
  if (hasCode)  quality += 15
  if (hasList)  quality += 8
  if (hasHead)  quality += 6
  if (hasNums)  quality += 6
  if (hasExmpl) quality += 8
  if (hasSteps) quality += 7
  quality = Math.min(100, quality)

  // Final score = 60% goal coverage + 40% response quality
  const sc = Math.min(95, Math.max(20, Math.round(coveragePct * 0.6 + quality * 0.4)))

  // Update session
  sess.covered   = allCovered
  sess.turn     += 1
  sess.bestScore = Math.max(sess.bestScore, sc)

  // Stop conditions
  const shouldStop = coveragePct >= 85 || (sess.turn >= 4 && coveragePct >= 65)

  // Follow-up: target the single most important missing element
  let next_prompt
  if (shouldStop) {
    next_prompt = `✓ Goal complete (${coveragePct}% coverage). The response covers: ${allCovered.slice(0, 5).join(', ')}.`
  } else if (stillMissing.length) {
    const topGap = stillMissing[0]
    const prevWork = newlyCovered.length
      ? `Your response addressed ${newlyCovered.slice(0, 2).join(' and ')} well. `
      : ''
    next_prompt = `${prevWork}The response still hasn't covered "${topGap}" adequately. Please add: (1) a clear definition or explanation of ${topGap} as it relates to ${sess.goal.slice(0, 60)}, (2) a concrete example with specific values or steps, and (3) how it connects to what you already explained.`
  } else {
    next_prompt = `Good coverage. Now go deeper: pick the most complex aspect you mentioned and walk through it with a complete real-world example — specific names, actual numbers, and every step shown.`
  }

  const grade      = sc >= 85 ? 'A' : sc >= 70 ? 'B' : sc >= 55 ? 'C' : 'D'
  const grade_label= sc >= 85 ? 'Excellent ✦' : sc >= 70 ? 'Good ✓' : sc >= 55 ? 'Partial ~' : 'Weak ✗'

  return {
    ok: true, score: sc, grade, grade_label,
    newly_covered:  newlyCovered.slice(0, 4),
    still_missing:  stillMissing.slice(0, 4),
    completion_pct: coveragePct,
    should_stop:    shouldStop,
    stop_reason:    shouldStop ? (coveragePct >= 85 ? 'Coverage threshold reached' : 'Substantial coverage after multiple turns') : '',
    next_prompt,
  }
}

function getKeys() {
  return new Promise(res =>
    chrome.storage.local.get(['pet_key_groq','pet_key_openai','pet_key_deepseek','pet_key_claude','pet_ollama_model'], r =>
      res({
        groq:         r.pet_key_groq         || null,
        openai:       r.pet_key_openai        || null,
        deepseek:     r.pet_key_deepseek      || null,
        claude:       r.pet_key_claude        || null,
        ollama_model: r.pet_ollama_model      || null,
      })
    )
  )
}
function setKey(p, k) {
  const storageKey = p === 'ollama_model' ? 'pet_ollama_model' : `pet_key_${p}`
  return new Promise(res => chrome.storage.local.set({ [storageKey]: k }, () => res({ ok: true })))
}
