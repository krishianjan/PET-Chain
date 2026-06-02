import { preprocessPrompt } from './preprocessor'
import { classify, detectUserLevel } from '../classifier/intent'
const TECHNIQUE_LIBRARY = {
  eli5: {
    label: '🎓 Simple Explanation',
    for: ['math_explain', 'code_explain', 'study'],
    generate: (p) => `Explain this like I'm completely new to this topic:\n"${p}"\n\nUse:\n1. A simple real-world analogy first\n2. Break it into 3 key ideas (plain language only)\n3. One concrete example showing how it works\n4. One sentence summary at the end`
  },
  math_structured: {
    label: '📐 Math Breakdown',
    for: ['math_explain', 'math_solve'],
    generate: (p) => `${p}\n\nBreak this down:\n1. State the core concept\n2. Show visual intuition\n3. Formal definition\n4. Worked example`
  },
  code_debug_xml: {
    label: '🔧 Debug Structure',
    for: ['code_debug'],
    generate: (p) => `<task>Debug and fix this issue</task>\n<problem>${p}</problem>\n<process>\n1. Root cause\n2. Why it happens\n3. Corrected code\n</process>`
  },
  code_build_spec: {
    label: '⚙️ Build Specification',
    for: ['code_build'],
    generate: (p) => `You are a senior engineer. I need you to help me:\n${p}\n\nProvide Decision, Plan, Code, and Testing steps.`
  },
  cot_expert: {
    label: '🧠 Expert Analysis',
    for: ['research', 'code_explain', 'math_explain', 'study', 'decide'],
    generate: (p, domain) => `You are a world-class ${domain} expert.\n${p}\n\nThink step by step:\n1. What is actually being asked?\n2. Key principles?\n3. Nuanced answer?`
  },
  simple_plain: {
    label: '💬 Plain Language',
    for: ['writing', 'general', 'research'],
    generate: (p) => `${p}\n\nExplain this simply using everyday language and real examples.`
  }
}

const DOMAIN_MAP = {
  code_debug: 'software', code_build: 'software', code_explain: 'software',
  math_explain: 'mathematics', math_solve: 'mathematics',
  study: 'education', research: 'research',
  decide: 'strategy', planning: 'productivity',
}

export function smartRewrite(prompt) {
  const task = classify(prompt)
  const domain = DOMAIN_MAP[task] || 'general knowledge'

  // Filter library for matches
  const relevant = Object.entries(TECHNIQUE_LIBRARY)
    .filter(([, t]) => t.for && t.for.includes(task))

  // Define fallbacks as [id, object] pairs
  const fallbacks = [
    ['cot', { label: '🧠 Expert Analysis', generate: (p) => `You are a world-class ${domain} expert. ${p}\n\nThink step by step.` }],
    ['struct', { label: '📋 Structured Output', generate: (p) => `${p}\n\nFormat: Direct Answer → Explanation → Examples` }],
    ['simple', { label: '💬 Plain Language', generate: (p) => `${p}\n\nExplain this simply for a beginner.` }],
  ]

  // Combine and ensure we have at least 3
  const combined = [...relevant, ...fallbacks]

  // Take first 3 and transform into the expected UI format
  return combined.slice(0, 3).map(([id, t]) => ({
    id,
    label: t.label || 'Rewrite',
    prompt: typeof t.generate === 'function' ? t.generate(prompt, domain) : prompt,
    technique: task,
  }))
}

export function buildGroqRewritePrompt(prompt) {
  const task = classify(prompt)
  const level = detectUserLevel(prompt)
  const domain = DOMAIN_MAP[task] || 'general'

  return {
    system: `You are an expert prompt engineer. Output ONLY valid JSON.`,
    user: `Original: "${prompt}"\nTask: ${task}\nLevel: ${level}\n\nGenerate 3 rewrites in this JSON format: {"rewrites":[{"id":"t1","label":"...","prompt":"...","why":"..."}]}`
  }
}

export function parseJSON(raw) {
  if (!raw) return null
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch (e) {
    console.error('JSON Parse Error:', e)
    return null
  }
}

// Add chain as a technique option based on task
export function shouldSuggestChain(task) {
  const chainTasks = ['research', 'code_build', 'decide', 'math_explain', 'study']
  return chainTasks.includes(task)
}

// Rank rewrites — first is always the recommended one
export function rankRewrites(rewrites, task, userLevel) {
  // Scoring heuristic: technique match quality for task+level
  const priority = {
    math_explain: ['math_structured', 'eli5', 'cot_expert'],
    code_debug: ['code_debug_xml', 'cot_expert', 'struct'],
    code_build: ['code_build_spec', 'chain_starter', 'struct'],
    cooking: ['cooking_steps', 'struct', 'simple'],
    beauty: ['beauty_personal', 'struct', 'simple'],
    shopping: ['shopping_compare', 'decision_matrix', 'struct'],
    decide: ['decision_matrix', 'shopping_compare', 'cot_expert'],
    study: ['study_breakdown', 'eli5', 'math_structured'],
    research: ['cot_expert', 'decision_matrix', 'chain_starter'],
    planning: ['planning_structured', 'struct', 'cot_expert'],
  }

  const order = priority[task] || []
  const sorted = [...rewrites].sort((a, b) => {
    const ai = order.indexOf(a.id)
    const bi = order.indexOf(b.id)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return sorted.map((r, i) => ({ ...r, recommended: i === 0 }))
}

// Main export — replaces existing smartRewrite
export function smartRewrite(rawPrompt) {
  const prompt = preprocessPrompt(rawPrompt)  // fix typos first
  const task = classify(prompt)
  const level = detectUserLevel(prompt)
  const domain = DOMAIN_MAP[task] || 'general knowledge'

  const relevant = Object.entries(TECHNIQUE_LIBRARY)
    .filter(([, t]) => t.for.includes(task))
    .slice(0, 3)

  const fallbacks = [
    { id: 'cot_expert', label: '🧠 Expert Analysis', generate: (p) => `You are a world-class ${domain} expert.\n${p}\n\nThink step by step. Be specific.` },
    { id: 'struct', label: '📋 Structured Output', generate: (p) => `${p}\n\n**Direct Answer**, **Key Points**, **Examples**, **Next Steps**` },
    { id: 'simple', label: '💬 Plain Language', generate: (p) => `${p}\n\nExplain simply. Use everyday language and real examples.` },
  ]

  const techniques = relevant.length >= 3
    ? relevant
    : [...relevant, ...fallbacks.slice(0, 3 - relevant.length)]

  const rewrites = techniques.slice(0, 3).map(([id, t]) => ({
    id,
    label: t.label,
    prompt: t.generate(prompt, domain),
    task,
  }))

  return rankRewrites(rewrites, task, level)
}