/**
 * RAG Engine — Retrieval-Augmented Generation for PET
 *
 * Stores conversation turns, retrieves relevant context by semantic similarity,
 * and builds fully dynamic prompts (zero hardcoded templates).
 */

const MAX_TURNS   = 12   // rolling window per session
const MAX_CTX_LEN = 900  // chars per retrieved chunk
const SESSION_KEY = 'pet_rag_session_v1'

// ── In-memory store (survives minimize; chrome.storage for page refresh) ──
let _turns   = []   // [{ prompt, response, domain, score, ts }]
let _topic   = null // dominant topic of current session

// ── Persist / restore ─────────────────────────────────────────────────────
export async function ragLoad() {
  try {
    const r = await chrome.storage.session.get(SESSION_KEY).catch(() =>
      chrome.storage.local.get(SESSION_KEY))
    const d = r[SESSION_KEY]
    if (d?.turns) { _turns = d.turns; _topic = d.topic || null }
  } catch { /* graceful */ }
}

function ragSave() {
  try {
    const payload = { turns: _turns.slice(-MAX_TURNS), topic: _topic, savedAt: Date.now() }
    chrome.storage.local.set({ [SESSION_KEY]: payload })
  } catch { /* never block */ }
}

// ── Add a completed turn ──────────────────────────────────────────────────
export function ragAddTurn({ prompt, response = '', domain = 'general', score = null }) {
  if (!prompt?.trim()) return
  if (!_topic) _topic = prompt.slice(0, 80)
  _turns.push({ prompt: prompt.slice(0, 400), response: response.slice(0, MAX_CTX_LEN), domain, score, ts: Date.now() })
  if (_turns.length > MAX_TURNS) _turns = _turns.slice(-MAX_TURNS)
  ragSave()
}

export function ragClear() { _turns = []; _topic = null; ragSave() }

// ── Semantic similarity (TF-IDF-lite keyword overlap) ────────────────────
const STOP = new Set(['what','that','this','with','from','have','will','when','where','which','your','their','some','also','into','more','very','just','like','than','then','them','they','been','were','does','make','find','tell','give','show','need','help','about','please','could','would','should'])

function keywords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 3 && !STOP.has(w))
}

function similarity(a, b) {
  const sa = new Set(keywords(a))
  const sb = new Set(keywords(b))
  const inter = [...sa].filter(w => sb.has(w)).length
  return inter / Math.max(sa.size + sb.size - inter, 1)
}

// ── Retrieve top-k relevant turns ─────────────────────────────────────────
export function ragRetrieve(query, topK = 3) {
  if (!_turns.length) return []
  return _turns
    .map(t => ({ ...t, sim: similarity(query, t.prompt + ' ' + t.response) }))
    .filter(t => t.sim > 0.08)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
}

// ── Build context block for prompt injection ──────────────────────────────
export function ragBuildContext(query) {
  const hits = ragRetrieve(query)
  if (!hits.length) return null
  return hits.map((t, i) =>
    `[Prior context ${i + 1} — relevance: ${Math.round(t.sim * 100)}%]\n` +
    `User asked: "${t.prompt}"\n` +
    (t.response ? `Response summary: ${t.response.slice(0, 300)}` : '') +
    (t.score != null ? `\nQuality score: ${t.score}%` : '')
  ).join('\n\n---\n\n')
}

// ── Dynamic prompt analysis (replaces hardcoded domain templates) ─────────

// Extract what kind of OUTPUT the user needs
function detectOutputType(prompt) {
  const t = prompt.toLowerCase()
  if (/\b(step[- ]by[- ]step|how to|tutorial|guide|walkthrough)\b/.test(t)) return 'steps'
  if (/\b(compare|vs|versus|difference|pros.?cons|better)\b/.test(t)) return 'comparison'
  if (/\b(write|draft|generate|create)\b.*\b(email|essay|post|caption|letter|message|story|poem)\b/.test(t)) return 'creation'
  if (/\b(fix|debug|error|bug|broken|not working|fails)\b/.test(t)) return 'debug'
  if (/\b(build|implement|develop|code|script|app|api)\b/.test(t)) return 'build'
  if (/\b(explain|what is|how does|understand|why)\b/.test(t)) return 'explain'
  if (/\b(analyze|review|evaluate|assess|critique)\b/.test(t)) return 'analysis'
  if (/\b(plan|strategy|roadmap|schedule|organize)\b/.test(t)) return 'plan'
  if (/\b(calculate|solve|compute|find|math|equation)\b/.test(t)) return 'solve'
  if (/\b(should i|recommend|best|pick|choose|worth it)\b/.test(t)) return 'decide'
  return 'explore'
}

// Detect domain more precisely
function detectDomain(prompt) {
  const t = prompt.toLowerCase()
  const rules = [
    [/\b(react|vue|angular|nextjs|python|javascript|typescript|rust|golang|java|kotlin|swift|sql|api|backend|frontend|docker|kubernetes|git|npm|webpack|vite)\b/, 'software'],
    [/\b(machine learning|neural|deep learning|llm|gpt|model|dataset|training|inference|embedding|vector|rag|fine.?tun)\b/, 'ai_ml'],
    [/\b(stock|invest|portfolio|crypto|bitcoin|etf|roi|dividend|equity|fund|forex|recession|inflation|budget|saving)\b/, 'finance'],
    [/\b(chemistry|biology|physics|quantum|genetics|evolution|organism|molecule|atom|reaction|experiment|hypothesis)\b/, 'science'],
    [/\b(calculus|derivative|integral|matrix|algebra|geometry|probability|statistics|theorem|proof)\b/, 'mathematics'],
    [/\b(health|fitness|diet|exercise|medical|symptom|treatment|nutrition|sleep|therapy|mental health)\b/, 'health'],
    [/\b(marketing|brand|launch|campaign|gtm|growth|saas|startup|pitch|positioning|audience)\b/, 'business'],
    [/\b(write|essay|blog|email|letter|story|poem|caption|newsletter|script|copy)\b/, 'writing'],
    [/\b(recipe|cook|bake|ingredient|meal|food|dish)\b/, 'cooking'],
    [/\b(law|legal|contract|regulation|compliance|rights|court|clause)\b/, 'legal'],
    [/\b(history|historical|war|civilization|century|empire|revolution|culture)\b/, 'history'],
    [/\b(philosophy|ethics|moral|meaning|consciousness|existential|logic|argument)\b/, 'philosophy'],
    [/\b(learn|study|explain|understand|concept|tutorial|course|education)\b/, 'education'],
  ]
  for (const [re, domain] of rules) {
    if (re.test(t)) return domain
  }
  return 'general'
}

// Best expert persona for domain
function expertPersona(domain, outputType) {
  const personas = {
    software:    'Senior Software Engineer (12 years, ex-FAANG)',
    ai_ml:       'Machine Learning Engineer and AI Researcher',
    finance:     'Chartered Financial Analyst with 15 years in equity markets',
    science:     'Research Scientist with PhD and 10 years lab experience',
    mathematics: 'Mathematics Professor who teaches by making reasoning fully visible',
    health:      'Board-certified physician and evidence-based health coach',
    business:    'Strategy consultant who has advised 50+ startups and Fortune 500s',
    writing:     'Senior Content Strategist with 15 years at top-tier publications',
    cooking:     'Professional chef with culinary school background',
    legal:       'Experienced attorney — note: for informational purposes only',
    history:     'Historian and Professor specializing in this period',
    philosophy:  'Philosophy Professor and published ethicist',
    education:   'Expert educator with 20 years teaching across all levels',
    general:     'World-class expert in the relevant field',
  }
  return personas[domain] || personas.general
}

// Determine best techniques for this prompt type
function selectTechniques(domain, outputType, userLevel) {
  // Technique pool by output type
  const byOutput = {
    steps:      ['Chain-of-Thought', 'First Principles', 'Feynman Technique'],
    debug:      ['Root Cause Analysis', 'Systematic Elimination', 'Tree of Thought'],
    build:      ['Spec-First Architecture', 'Few-Shot Expert', 'MVP Blueprint'],
    explain:    ['Feynman Technique', 'Socratic Method', 'Chain-of-Thought'],
    analysis:   ['Expert Panel', "Devil's Advocate", 'Comparative Analysis'],
    comparison: ['Comparative Analysis', 'Decision Matrix', "Devil's Advocate"],
    creation:   ['Few-Shot Matching', 'Expert Persona', 'Iterative Refinement'],
    plan:       ['First Principles', 'Tree of Thought', 'Systematic Decomposition'],
    solve:      ['Chain-of-Thought', 'Worked Examples', 'Socratic Method'],
    decide:     ['Decision Matrix', 'Expert Panel', "Devil's Advocate"],
    explore:    ['Expert Panel', 'Chain-of-Thought', 'Socratic Method'],
  }
  // Domain overrides
  const domainBoost = {
    software:    ['Chain-of-Thought', 'Root Cause Analysis', 'Spec-First Architecture'],
    ai_ml:       ['First Principles', 'Comparative Analysis', 'Expert Panel'],
    finance:     ['Chain-of-Thought', 'Few-Shot Expert', 'Socratic Method'],
    mathematics: ['Chain-of-Thought', 'Worked Examples', 'Feynman Technique'],
    education:   ['Feynman Technique', 'Socratic Method', 'Chain-of-Thought'],
  }
  const pool = [...new Set([
    ...(byOutput[outputType] || byOutput.explore),
    ...(domainBoost[domain] || []),
  ])].slice(0, 5)
  // Pick 3 randomly for variety
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 3)
}

// ── Core dynamic prompt builder ────────────────────────────────────────────
// Generates prompt sections based on what the task actually needs — not templates.
function buildSection(technique, prompt, domain, outputType, persona, contextBlock) {
  const ctx = contextBlock ? `\n\n[RELEVANT CONTEXT FROM THIS SESSION]\n${contextBlock}\n[Use this context only where directly relevant]\n` : ''

  const t = technique

  if (t === 'Chain-of-Thought') return {
    label: '⛓ Chain-of-Thought',
    why: 'Makes every reasoning step explicit — you see exactly how the answer is derived',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Task: "${prompt}"`,
      '',
      'Think through this step by step — show your complete reasoning:',
      '',
      'STEP 1 — UNDERSTAND THE REQUEST',
      '  Restate exactly what is being asked. Surface any hidden assumptions.',
      '',
      `STEP 2 — ${outputType === 'debug' ? 'IDENTIFY ROOT CAUSE' : outputType === 'build' ? 'DESIGN DECISIONS' : outputType === 'solve' ? 'CHOOSE METHOD' : 'CORE ANALYSIS'}`,
      '  What are the key factors? Why this approach over alternatives?',
      '',
      'STEP 3 — EXECUTE WITH FULL DETAIL',
      outputType === 'debug' ? '  Trace the exact execution path. Show before/after.' :
      outputType === 'build' ? '  Show the complete implementation — no placeholders.' :
      outputType === 'solve' ? '  Work through every line. Show each transformation.' :
      '  Use real examples, specific numbers, concrete names.',
      '',
      'STEP 4 — VERIFY',
      '  How do we confirm this is correct? What would disprove it?',
      '',
      'STEP 5 — PRACTICAL NEXT STEP',
      '  The single most important action based on everything above.',
    ].join('\n'),
  }

  if (t === 'Feynman Technique') return {
    label: '🧠 Feynman Technique',
    why: 'If you cannot explain it simply, you do not understand it — forces genuine clarity',
    technique: t,
    prompt: [
      `Apply the Feynman Technique to: "${prompt}"`,
      ctx,
      '',
      'LEVEL 1 — SIMPLE EXPLANATION (no jargon)',
      '  Explain as if talking to a curious 14-year-old. Use a real-world analogy.',
      '',
      'LEVEL 2 — SPOT THE GAPS',
      '  What parts of that simple explanation were imprecise or hand-wavy?',
      '  List the 3 things that require deeper understanding.',
      '',
      'LEVEL 3 — PRECISE VERSION',
      '  Explain those gaps rigorously with correct terminology and evidence.',
      '',
      'LEVEL 4 — THE STICKY ANALOGY',
      '  One analogy so vivid it cannot be forgotten. Say where it breaks down.',
      '',
      'LEVEL 5 — VERIFY UNDERSTANDING',
      '  Pose one question whose correct answer proves genuine comprehension.',
    ].join('\n'),
  }

  if (t === 'Socratic Method') return {
    label: '🔬 Socratic Method',
    why: 'Guided questions surface your current understanding and fill only the real gaps',
    technique: t,
    prompt: [
      `Act as a Socratic guide for: "${prompt}"`,
      ctx,
      '',
      'PHASE 1 — DIAGNOSE',
      '  Ask 3 targeted questions to find exactly where understanding breaks down.',
      '  (Pause and wait for my answers before continuing.)',
      '',
      'PHASE 2 — TARGETED EXPLANATION',
      '  Based on my Phase 1 answers, address only what I actually need.',
      '  Use the simplest language possible, then add precision.',
      '',
      'PHASE 3 — APPLY',
      '  Give me a specific problem or scenario that proves understanding.',
      '',
      'PHASE 4 — EDGE CASES',
      '  What is the counterintuitive case experts know but beginners miss?',
      '',
      'PHASE 5 — CONNECTIONS',
      '  How does this connect to 3 related concepts I should explore next?',
    ].join('\n'),
  }

  if (t === 'Expert Panel') return {
    label: '🎓 Expert Panel',
    why: 'Multiple expert angles expose blind spots any single perspective misses',
    technique: t,
    prompt: [
      `Simulate a 3-expert panel on: "${prompt}"`,
      ctx,
      '',
      'EXPERT 1 — THE PRACTITIONER (works with this daily):',
      '  Practical take: what real-world experience actually teaches',
      '  Most critical insight: what only daily work reveals',
      '  #1 mistake they see people make:',
      '',
      'EXPERT 2 — THE RESEARCHER (rigorous evidence):',
      '  Evidence-based take: what the data and studies actually show',
      '  Most important finding people ignore:',
      '  Where conventional wisdom is wrong:',
      '',
      'EXPERT 3 — THE SKEPTIC (challenges both):',
      '  What both experts are missing:',
      '  Most overlooked consideration:',
      '  The question nobody asks but should:',
      '',
      'PANEL VERDICT:',
      '  Where all three agree:',
      '  Key disagreement and why it matters for you:',
      '  Single most actionable takeaway:',
    ].join('\n'),
  }

  if (t === "Devil's Advocate") return {
    label: "😈 Devil's Advocate",
    why: 'Challenging your assumptions forces you to defend or refine your thinking',
    technique: t,
    prompt: [
      `You are a brilliant contrarian expert. Question: "${prompt}"`,
      ctx,
      '',
      'STANDARD VIEW: Give the conventional expert answer in 2-3 sentences.',
      '',
      'CHALLENGE IT:',
      '  Assumption 1 everyone makes → why it might be wrong',
      '  Assumption 2 everyone makes → why it might be wrong',
      '  Assumption 3 everyone makes → why it might be wrong',
      '',
      'CONTRARIAN VIEW:',
      '  What would the top 1% say that contradicts conventional wisdom?',
      '  What specific evidence supports the contrarian position?',
      '',
      'SYNTHESIS:',
      '  Where is conventional wisdom right?',
      '  Where is the contrarian view right?',
      '  Most defensible nuanced position in one sentence:',
    ].join('\n'),
  }

  if (t === 'Root Cause Analysis') return {
    label: '🔍 Root Cause Analysis',
    why: 'Finds the real cause, not just symptoms — prevents recurrence',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Issue: "${prompt}"`,
      '',
      'STEP 1 — READ THE SYMPTOMS',
      '  Quote the exact error/problem. Parse what each part means.',
      '',
      'STEP 2 — REPRODUCE',
      '  Minimum case that triggers this. Conditions where it does NOT occur.',
      '',
      'STEP 3 — ROOT CAUSE CANDIDATES (rank by likelihood)',
      '  Candidate 1: [hypothesis] → evidence for / against',
      '  Candidate 2: [hypothesis] → evidence for / against',
      '',
      'STEP 4 — VERIFY',
      '  Exact command/log to confirm the real cause.',
      '',
      'STEP 5 — FIX',
      '  BEFORE (broken): [code/config]',
      '  AFTER  (fixed):  [code/config]',
      '  Why this works: [mechanism]',
      '',
      'STEP 6 — PREVENT RECURRENCE',
      '  One guardrail that stops this entire class of problem permanently.',
    ].join('\n'),
  }

  if (t === 'Comparative Analysis') return {
    label: '⚖️ Comparative Analysis',
    why: 'Structured comparison surfaces trade-offs a simple answer would miss',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Compare / analyze: "${prompt}"`,
      '',
      'DIMENSION 1 — CORE DIFFERENCES',
      '  What fundamentally distinguishes each option/approach?',
      '',
      'DIMENSION 2 — TRADE-OFFS',
      '  What does each optimize for? What does each sacrifice?',
      '',
      'DIMENSION 3 — REAL-WORLD PERFORMANCE',
      '  Use specific examples, benchmarks, or case studies with actual numbers.',
      '',
      'DIMENSION 4 — WHEN TO CHOOSE EACH',
      '  Decision criteria — the exact conditions that make each the right choice.',
      '',
      'DIMENSION 5 — VERDICT',
      '  Given no extra information, which is stronger and why?',
      '  What single piece of information would flip this recommendation?',
    ].join('\n'),
  }

  if (t === 'Decision Matrix') return {
    label: '📊 Decision Matrix',
    why: 'Scores options against weighted criteria — removes gut-feel bias',
    technique: t,
    prompt: [
      `Help me decide: "${prompt}"`,
      ctx,
      '',
      'STEP 1 — DEFINE WHAT MATTERS',
      '  List the 4-5 criteria most important for this decision.',
      '  Assign each a weight (must total 100%).',
      '',
      'STEP 2 — SCORE EACH OPTION',
      '  For each option × criterion: score 1-10 with a one-line reason.',
      '  Show a weighted score table.',
      '',
      'STEP 3 — SENSITIVITY CHECK',
      '  Which criterion is the decision most sensitive to?',
      '  What if that criterion weight changed?',
      '',
      'STEP 4 — HIDDEN COSTS / RISKS',
      '  What does the matrix NOT capture that could override the numbers?',
      '',
      'STEP 5 — RECOMMENDATION',
      '  The clearest choice and the one condition that would change it.',
    ].join('\n'),
  }

  if (t === 'Few-Shot Expert') return {
    label: '🎯 Few-Shot Expert',
    why: 'Shows the exact quality standard via examples before applying it to your case',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Task: "${prompt}"`,
      '',
      'First, show me ONE worked example of expert-level output for a similar task.',
      '(Choose your own similar example — make it concrete and high quality.)',
      '',
      '--- EXAMPLE START ---',
      '[Your chosen similar example with full expert treatment]',
      '--- EXAMPLE END ---',
      '',
      'Now apply that same depth and quality to my actual task above.',
      '',
      'After completing the task, add:',
      '  WHAT MAKES THIS EXPERT-LEVEL: [the 2-3 key moves]',
      '  COMMON MISTAKE: [what a beginner would have done instead]',
      '  NEXT STEP: [most logical follow-on]',
    ].join('\n'),
  }

  if (t === 'First Principles') return {
    label: '🧱 First Principles',
    why: 'Strips away assumptions — rebuilds from what is fundamentally true',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Question: "${prompt}"`,
      '',
      'Apply first-principles thinking:',
      '',
      'STEP 1 — WHAT DO WE KNOW FOR CERTAIN?',
      '  List the facts that cannot be disputed. Label assumptions clearly.',
      '',
      'STEP 2 — BREAK DOWN THE COMPONENTS',
      '  What are the fundamental building blocks of this problem/topic?',
      '',
      'STEP 3 — REBUILD FROM SCRATCH',
      '  If you knew only the facts from Step 1, how would you construct the answer?',
      '  Show the reasoning chain.',
      '',
      'STEP 4 — CONTRAST WITH CONVENTIONAL THINKING',
      '  Where does this first-principles view differ from common assumptions?',
      '',
      'STEP 5 — PRACTICAL IMPLICATION',
      '  What can you do differently because of this view that others cannot?',
    ].join('\n'),
  }

  if (t === 'Tree of Thought') return {
    label: '🌳 Tree of Thought',
    why: 'Explores multiple solution paths simultaneously — picks the strongest branch',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Problem: "${prompt}"`,
      '',
      'Explore 3 distinct approaches before committing:',
      '',
      'BRANCH A — [Most obvious / conventional approach]',
      '  How it works. Pros. Fatal flaw or limitation.',
      '',
      'BRANCH B — [Alternative / less common approach]',
      '  How it works. What it does better than A. What it sacrifices.',
      '',
      'BRANCH C — [Creative / unconventional approach]',
      '  How it works. Why most people overlook it. When it dominates.',
      '',
      'EVALUATION:',
      '  Score each branch: Speed / Robustness / Simplicity (1-10 each).',
      '',
      'RECOMMENDATION:',
      '  Which branch wins for this specific context and why.',
      '  Exact next steps to execute the winning branch.',
    ].join('\n'),
  }

  if (t === 'Worked Examples') return {
    label: '📐 Worked Examples',
    why: 'Seeing solved examples first builds pattern recognition before tackling yours',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Topic/Problem: "${prompt}"`,
      '',
      'EXAMPLE 1 — SIMPLE CASE',
      '  [Choose a simpler version of the same type]',
      '  Walk through every step with full reasoning.',
      '',
      'EXAMPLE 2 — REALISTIC CASE',
      '  [A typical real-world instance with real numbers/names]',
      '  Full solution with visible reasoning.',
      '',
      'NOW SOLVE THE ORIGINAL:',
      '  Apply the same method to: "' + prompt + '"',
      '  Show every step.',
      '',
      'GENERAL PATTERN:',
      '  The rule or formula this problem illustrates.',
      '',
      'COMMON MISTAKES:',
      '  Top 2 errors. Show wrong → right.',
    ].join('\n'),
  }

  if (t === 'Spec-First Architecture') return {
    label: '⚙️ Spec-First Architecture',
    why: 'Thinks through the full system before writing a single line of code',
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Project: "${prompt}"`,
      '',
      'REQUIREMENTS',
      '  Core features (must-have vs nice-to-have).',
      '  User flows: [action] → [system response] → [data changed]',
      '  Edge cases and error states.',
      '',
      'TECH DECISIONS',
      '  For each choice: name + version + why this over the top alternative.',
      '',
      'DATA MODEL',
      '  Every entity, field, type, relationship. Show as schema or table.',
      '',
      'FILE STRUCTURE',
      '  Every file and folder with a one-line purpose.',
      '',
      'IMPLEMENTATION ORDER',
      '  Step-by-step from blank machine to deployed product.',
      '',
      'SETUP COMMANDS',
      '  Copy-paste ready. Every command.',
      '',
      'TOP 3 PITFALLS',
      '  What breaks first. How to prevent each before it happens.',
    ].join('\n'),
  }

  // Generic fallback for any unlisted technique
  return {
    label: `✦ ${t}`,
    why: `Applying ${t} to maximize response quality for this specific task`,
    technique: t,
    prompt: [
      `You are a ${persona}.`,
      ctx,
      `Task: "${prompt}"`,
      '',
      `Apply the ${t} approach:`,
      '',
      '1. Fully understand what is being asked — restate it precisely.',
      '2. Break it into its core components.',
      '3. Address each component with specific, concrete detail.',
      '4. Use real examples, actual numbers, and verifiable facts.',
      '5. End with the single most actionable next step.',
    ].join('\n'),
  }
}

// ── Main export: build 3 dynamic rewrites for any prompt ──────────────────
export function ragBuildRewrites(rawPrompt) {
  const domain     = detectDomain(rawPrompt)
  const outputType = detectOutputType(rawPrompt)
  const userLevel  = 'general'   // could extend with detectUserLevel
  const persona    = expertPersona(domain, outputType)
  const techniques = selectTechniques(domain, outputType, userLevel)
  const ctxBlock   = ragBuildContext(rawPrompt)

  const rewrites = techniques.map((tech, i) => {
    const built = buildSection(tech, rawPrompt, domain, outputType, persona, i === 0 ? ctxBlock : null)
    return {
      id:          `r${i + 1}`,
      label:       built.label,
      technique:   built.technique,
      why:         built.why,
      prompt:      built.prompt,
      recommended: i === 0,
      domain,
      outputType,
      hasContext:  i === 0 && !!ctxBlock,
    }
  })

  return { rewrites, domain, outputType, contextUsed: !!ctxBlock }
}

export { detectDomain, detectOutputType }
