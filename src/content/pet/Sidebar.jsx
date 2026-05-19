import { useState, useRef, useEffect } from 'react'
import { setQ, getQ, rewrite, evaluate, getOllamaModels, setKey as apiSetKey } from '../../engines/api'
import lottie from 'lottie-web'
import { recordRewrite, recordScore, recordInject } from '../../engines/metrics_store'
import selectorsConfig from '../../../selectors.config.json'

const PERSIST_KEY = 'pet_sidebar_state_v1'

export default function Sidebar({ onClose, onMinimize, petCtrl, platform, petType, keys, setKeys, nextStep, clearNext, onPetSelect, petName, onPetName }) {
  const [view,        setView]      = useState('main')
  const [rewrites,    setRewrites]  = useState([])
  const [score,       setScore]     = useState(null)
  const [loading,     setLoading]   = useState(false)
  const [status,      setStatus]    = useState('Ready')
  const [copied,      setCopied]    = useState(null)
  const [editing,     setEditing]   = useState(null)
  const [editTexts,   setEditTexts] = useState({})
  const [editingName, setEditingName] = useState(false)
  const [nameDraft,   setNameDraft]   = useState('')
  const [rewriteMeta, setRewriteMeta] = useState(null)

  const posRef    = useRef({ x: window.innerWidth - 366, y: 60 })
  const sizeRef   = useRef({ w: 340, h: 520 })
  const [pos, setPos] = useState(posRef.current)
  const [sz,  setSz]  = useState(sizeRef.current)
  const dragging  = useRef(false), resizing = useRef(false)
  const doff      = useRef({ x:0, y:0 })
  const rstart    = useRef({ x:0, y:0, w:0, h:0 })

  const originalQ = useRef('')

  const apiKey    = keys.groq || keys.openai || keys.deepseek
  const hasEngine = !!(keys.ollama_model || apiKey)

  // ── Restore persisted state on mount (survives minimize + page refresh) ───
  useEffect(() => {
    chrome.storage.local.get(PERSIST_KEY, r => {
      const saved = r[PERSIST_KEY]
      if (!saved) return
      if (saved.rewrites?.length) { setRewrites(saved.rewrites); setStatus(`✓ ${saved.rewrites.length} prompts restored`) }
      if (saved.score)              setScore(saved.score)
      if (saved.originalQ)          originalQ.current = saved.originalQ
    })
  }, [])

  // ── Persist rewrites + score whenever they change ─────────────────────────
  useEffect(() => {
    if (!rewrites.length && !score) return
    chrome.storage.local.set({
      [PERSIST_KEY]: {
        rewrites,
        score,
        originalQ: originalQ.current,
        savedAt:   Date.now(),
      }
    })
  }, [rewrites, score])

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getPrompt() {
    const sel = selectorsConfig.platforms[platform]?.textarea
    if (!sel) return ''
    const el = document.querySelector(sel)
    if (!el) return ''
    return (el.value || el.textContent || el.innerText || '').trim()
  }

  function inject(text) {
    const sel = selectorsConfig.platforms[platform]?.textarea
    if (!sel) return
    const el = document.querySelector(sel)
    if (!el) { setStatus('Could not find textarea on this page'); return }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      el.focus()
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, text)
    }
    petCtrl?.setState('happy')
    setStatus('✓ Injected into textarea')
    setEditing(null)
    el.focus?.()
    try { recordInject() } catch { /* metrics never block UX */ }
  }

  function copyToClipboard(id, text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 1800)
    }).catch(() => {
      // Fallback for restricted contexts
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
      setCopied(id); setTimeout(() => setCopied(null), 1800)
    })
  }

  function startRefine(r) {
    setEditTexts(prev => ({ ...prev, [r.id]: prev[r.id] ?? r.prompt }))
    setEditing(r.id)
  }

  // ── Domain detection (mirrors worker.js detectDomain) ────────────────────
  function detectDomain(q) {
    const t = q.toLowerCase()
    if (/\b(stock|invest|market|finance|money|crypto|bitcoin|return|profit|portfolio|dividend|equity|fund|trade|roi|bond|etf|share|wealth|budget|saving|bank|interest rate|compound|asset)\b/.test(t)) return 'finance'
    if (/\b(fix|debug|error|bug|crash|exception|traceback|broken|not working|fails|undefined|null pointer)\b/.test(t)) return 'code_debug'
    if (/\b(science|biology|chemistry|physics|quantum|atom|molecule|cell|evolution|climate|astronomy|genetics|experiment|hypothesis|reaction|compound|element)\b/.test(t)) return 'science'
    if (/\b(math|calculate|equation|algebra|calculus|geometry|probability|statistics|proof|solve|integral|derivative|matrix|formula|arithmetic)\b/.test(t)) return 'math'
    if (/\b(health|diet|exercise|medical|disease|symptom|treatment|nutrition|fitness|mental|therapy|medicine|workout|calories|sleep)\b/.test(t)) return 'health'
    if (/\b(build|create|make|develop|implement|code|app|website|api|database|backend|frontend|scaffold|deploy|program|script|function|algorithm)\b/.test(t)) return 'code_build'
    if (/\b(write|essay|blog|email|letter|content|article|draft|copywrite|story|poem|script|copy|caption|headline)\b/.test(t)) return 'writing'
    if (/\b(learn|teach|explain|what is|how does|how do|understand|tutorial|concept|beginner|study|course)\b/.test(t)) return 'learn'
    return 'general'
  }

  // ── Domain-aware follow-up prompt builder ─────────────────────────────────
  function buildFollowUp(domain, gaps, score) {
    const g0 = gaps[0] || ''
    const gapPhrase = gaps.slice(0, 2).map(w => `"${w}"`).join(' and ')

    if (score >= 78) {
      const deepeners = {
        finance:    `The explanation covered the basics well. Push it further: "Walk me through a complete real decision using what you just explained. Pick one specific asset available in today's market, apply each concept with actual current prices, show the full calculation, and give a concrete buy/hold/sell recommendation with a specific dollar amount and timeline. Flag the biggest risk to this position."`,
        code_debug: `The fix looks solid. Now harden it: "You identified the root cause — next: (1) write a unit test that would have caught this bug before production, (2) give me a grep pattern to find similar patterns elsewhere in the codebase, and (3) add the minimal type annotation or assertion that prevents this entire class of error at the function boundary."`,
        code_build: `Architecture is clear. Now ship it: "Generate the complete, working code for the single most critical file you described. Include real error handling, one passing test, and the exact terminal commands to run it from a blank directory. No placeholders."`,
        math:       `Solution verified — now build intuition: "Give me three variations of this exact problem where one variable changes each time. Show how the answer shifts and explain WHY the relationship behaves that way. Then give me a harder problem of the same type without solving it yet."`,
        science:    `Good explanation. Now make it concrete: "Describe a specific real experiment or observation that directly proves the mechanism you explained. Walk through it step by step — what is measured, what is observed, why it confirms the theory, and what result would falsify it."`,
        health:     `Solid overview. Now personalise it: "Walk me through how this applies to someone who is 30 years old, moderately active, with no pre-existing conditions. Give specific numbers — target ranges, optimal timings, measurable outcomes — not general advice."`,
        learn:      `Good explanation. Now test my understanding: "Ask me three progressively harder questions — easy, medium, hard — about what you explained. After each answer from me, tell me exactly what a correct answer looks like and what misconception my answer reveals. Don't give me the answers yet."`,
        writing:    `Strong draft. Now sharpen it: "Apply three specific edits to what you wrote: (1) rewrite the opening sentence so it creates immediate tension or curiosity, (2) replace the three most generic adjectives with precise, specific ones, (3) cut every sentence over 25 words in half. Show before and after for each change."`,
        general:    `Good answer. Now push the edge: "Give me a specific real-world scenario where this analysis breaks down or produces the opposite result. Use actual names and numbers. Then tell me what an expert who has seen that failure would do differently."`,
      }
      return deepeners[domain] || deepeners.general
    }

    if (gaps.length) {
      const fillers = {
        finance:    `The response left gaps on ${gapPhrase}. Follow up precisely: "Your answer was incomplete on ${g0}. Please add: (1) the exact formula with every variable labelled, (2) a worked example using real 2024 data — actual tickers and prices — and (3) the most common situation where this metric gives a false signal and why."`,
        code_debug: `Missing detail on ${gapPhrase}. Dig deeper: "The diagnosis skipped ${g0}. Show me the exact execution path that triggers the failure — trace it line by line through the call stack. Then confirm the fix by showing the specific input that previously caused the crash and the output after your change."`,
        code_build: `Implementation skipped ${gapPhrase}. Fill the gap: "The design is missing ${g0}. Write the complete code for that part — full function signature, real error handling, edge cases handled, and one working test. No placeholders."`,
        math:       `The solution skipped steps around ${gapPhrase}. Request: "The working jumped over the ${g0} step. Show that part in full — write every algebraic manipulation as a numbered line and explain the rule applied at each transformation."`,
        science:    `Incomplete on ${gapPhrase}. Ask: "You skipped ${g0}. Explain it precisely: what is the mechanism, what evidence supports it, and what experiment would falsify it?"`,
        health:     `Didn't address ${gapPhrase}. Ask: "You left out ${g0}. Give me specific, evidence-based guidance: recommended ranges, how to measure it, and what deviation from normal looks like in practice."`,
        learn:      `Didn't explain ${gapPhrase} adequately. Request: "You mentioned ${g0} but didn't explain it. Give me: (1) a plain-English definition with a real-world analogy, (2) a concrete example with specific names or numbers, and (3) how it connects to what you explained just before it."`,
        writing:    `Response missed ${gapPhrase}. Improve it: "The piece is missing ${g0}. Rewrite the section where it should appear and show me before and after side by side so I can see exactly what changed and why it is stronger."`,
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
      general:    `Go further: "Give me a specific, concrete example that makes this immediately practical — use real names, real numbers, and a scenario I might actually face in the next 30 days."`,
    }
    return generic[domain] || generic.general
  }

  // ── Smart local scorer ────────────────────────────────────────────────────
  function smartLocalScore(originalQuestion, responseText) {
    const STOP = new Set(['want','know','about','that','this','with','from','have','will','what','when','where','which','your','their','some','also','into','more','very','just','like','than','then','them','they','been','were','does','make','find','tell','give','show','need','help','please','could','would','should','explain','describe'])
    const domain  = detectDomain(originalQuestion)
    const qWords  = originalQuestion.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w))
    const rt      = responseText.toLowerCase()

    const hitWords  = qWords.filter(w => rt.includes(w))
    const missWords = qWords.filter(w => !rt.includes(w)).slice(0, 4)
    const hitRate   = hitWords.length / Math.max(qWords.length, 1)

    const wordCount  = responseText.split(/\s+/).length
    const hasNums    = /\d+[.,]?\d*/.test(responseText)
    const hasLists   = /^[\-\*•]|\n\d+\./m.test(responseText)
    const hasHeaders = /\n#{1,3}\s|\n[A-Z][A-Z\s]{3,}:\n/.test(responseText)
    const hasExamples= /\b(example|instance|such as|e\.g\.|for instance|consider)\b/i.test(responseText)

    let sc = Math.round(hitRate * 55) + 15
    if (wordCount > 400) sc += 12
    else if (wordCount > 200) sc += 7
    else if (wordCount > 80)  sc += 3
    if (hasNums)     sc += 7
    if (hasLists)    sc += 6
    if (hasHeaders)  sc += 5
    if (hasExamples) sc += 5

    // Domain-specific quality signals
    if (domain === 'finance') {
      if (/\d+[%％]/.test(responseText)) sc += 6
      if (/\$\d|USD|\bROI\b|\bCAGR\b|\bP\/E\b/.test(responseText)) sc += 5
      if (/\b(risk|downside|diversif|volatility)\b/i.test(responseText)) sc += 4
    } else if (domain === 'code_debug' || domain === 'code_build') {
      if (/```[\s\S]*?```/.test(responseText)) sc += 8
      if (/\b(function|class|import|const|def |return)\b/.test(responseText)) sc += 4
      if (/\b(test|assert|expect|verify)\b/i.test(responseText)) sc += 3
    } else if (domain === 'math') {
      if (/[=≈∫∑√±]/u.test(responseText)) sc += 6
      if (/step\s+\d|^\d+\.\s/im.test(responseText)) sc += 5
      if (/therefore|hence|thus/i.test(responseText)) sc += 3
    } else if (domain === 'learn') {
      if (/\b(analogy|think of|imagine|like a)\b/i.test(responseText)) sc += 5
      if (/\b(common mistake|avoid|careful)\b/i.test(responseText)) sc += 4
    }

    sc = Math.max(20, Math.min(96, sc))

    const grade       = sc >= 85 ? 'A' : sc >= 70 ? 'B' : sc >= 55 ? 'C' : 'D'
    const grade_label = sc >= 85 ? 'Excellent ✦' : sc >= 70 ? 'Good ✓' : sc >= 55 ? 'Partial ~' : 'Weak ✗'

    const covered = hitWords.slice(0, 3).map(w => `"${w}" addressed`)
    if (covered.length === 0) covered.push('Response was provided')
    const missing = missWords.map(w => `"${w}" needs more depth`)

    const next_prompt = buildFollowUp(domain, missWords, sc)

    return { score: sc, grade, grade_label, covered, missing, next_prompt }
  }

  // ── Shared rewrite core ───────────────────────────────────────────────────
  async function runRewrite(raw) {
    originalQ.current = raw
    setQ(raw)
    setLoading(true)
    setRewrites([])
    setScore(null)
    setEditing(null)
    petCtrl?.setState('thinking')
    setStatus('Crafting prompts…')

    let result = null
    try { result = await rewrite(raw, apiKey) } catch (e) { console.error('[PET rewrite]', e) }

    if (!result?.rewrites?.length) {
      setStatus('Could not generate prompts — try again')
      petCtrl?.setState('error')
      setLoading(false)
      return
    }
    setRewrites(result.rewrites)
    const src = result.source === 'ollama' ? 'Ollama' : result.source === 'groq' ? 'Cloud AI' : 'Dynamic AI'
    const ctxNote = result.contextUsed ? ' · 🧠 context' : ''
    setStatus(`✓ ${result.rewrites.length} prompts · ${src}${ctxNote}`)
    setRewriteMeta({
      domain:      result.rewrites[0]?.domain     || null,
      outputType:  result.rewrites[0]?.outputType || null,
      contextUsed: result.contextUsed || false,
      source:      result.source || 'instant',
    })
    petCtrl?.setState('happy')
    setLoading(false)
    try {
      const fp = result.rewrites[0]
      const origW = raw.split(/\s+/).length
      const rewriteW = fp?.prompt?.split(/\s+/).length || 0
      await recordRewrite({ tokensSaved: Math.max(0, rewriteW - origW) * 2, technique: fp?.technique || 'Expert', taskType: fp?.label || 'general' })
    } catch { /* metrics never block UX */ }
  }

  // ── Rewrite from textarea ──────────────────────────────────────────────────
  async function handleRewrite() {
    const raw = getPrompt()
    if (!raw) { setStatus('Type something in the chat textarea, then click Rewrite'); return }
    await runRewrite(raw)
  }

  // ── Rewrite a specific card's prompt (generate new variations of it) ───────
  async function handleRewriteCard(promptText) {
    await runRewrite(promptText)
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  async function handleScore() {
    const sel     = selectorsConfig.platforms[platform]?.response
    const els     = sel ? document.querySelectorAll(sel) : []
    const resEl   = els.length ? els[els.length - 1] : null
    const resText = resEl?.textContent?.trim() || ''

    if (!resText) {
      setStatus('No LLM response visible yet — send a prompt first')
      return
    }

    petCtrl?.setState('analyzing')
    setLoading(true)
    setScore(null)
    setStatus('Evaluating response…')

    // Use the ORIGINAL question (before injection) — never the rewritten/injected text
    const origQuestion = originalQ.current || getQ()

    let result = null
    try {
      // If origQuestion is set, pass it directly so worker uses it (not the injected prompt)
      result = await evaluate(resText, apiKey)
    } catch (e) {
      console.error('[PET handleScore]', e)
    }

    // Always run smart local scorer to validate/override if score seems wrong
    const localResult = smartLocalScore(origQuestion || resText.slice(0, 200), resText)

    // Use backend result if it has a valid score, otherwise use local
    const final = (result?.score != null && origQuestion)
      ? { ...result, next_prompt: result.next_prompt || localResult.next_prompt }
      : localResult

    setScore(final)
    petCtrl?.setState(final.score >= 75 ? 'celebrating' : final.score >= 50 ? 'happy' : 'error')
    setStatus(`${final.score}% · Grade ${final.grade}`)
    setLoading(false)
    try { await recordScore(final.score) } catch { /* metrics never block UX */ }
  }

  // ── Drag + resize handlers — attached once via useEffect ─────────────────
  useEffect(() => {
    const mv = (e) => {
      if (dragging.current) {
        const np = {
          x: Math.max(0, Math.min(window.innerWidth  - sizeRef.current.w - 8, e.clientX - doff.current.x)),
          y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - doff.current.y)),
        }
        posRef.current = np
        setPos({ ...np })
      }
      if (resizing.current) {
        const ns = {
          w: Math.max(300, Math.min(680, rstart.current.w + e.clientX - rstart.current.x)),
          h: Math.max(360, Math.min(window.innerHeight - 20, rstart.current.h + e.clientY - rstart.current.y)),
        }
        sizeRef.current = ns
        setSz({ ...ns })
      }
    }
    const up = () => { dragging.current = false; resizing.current = false }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup',   up)
    return () => {
      window.removeEventListener('mousemove', mv)
      window.removeEventListener('mouseup',   up)
    }
  }, [])

  // ── Sidebar logo animation ────────────────────────────────────────────────
  function LogoAnim() {
    const ref = useRef(null)
    useEffect(() => {
      if (!ref.current) return
      const url = typeof chrome !== 'undefined'
        ? chrome.runtime.getURL('assets/lottie/loadinganimation.json')
        : 'loadinganimation.json'
      let inst = null
      fetch(url).then(r => r.json()).then(data => {
        if (!ref.current) return
        inst = lottie.loadAnimation({ container: ref.current, animationData: data, renderer: 'svg', loop: true, autoplay: true })
      }).catch(() => {})
      return () => inst?.destroy()
    }, [])
    return <div ref={ref} style={{ width: 28, height: 28, flexShrink: 0 }} />
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: sz.w, height: sz.h,
      zIndex: 2147483646, pointerEvents: 'auto',
      background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(83,74,183,.18)', borderRadius: 18,
      boxShadow: '0 8px 40px rgba(83,74,183,.14)',
      fontFamily: 'system-ui,-apple-system,sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header — drag handle */}
      <div
        onMouseDown={e => {
          // Don't start drag from interactive elements inside header
          if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return
          dragging.current = true
          doff.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
          e.preventDefault()
        }}
        style={{ padding: '8px 10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'move', background: '#f8f8ff', userSelect: 'none', gap: 6 }}
      >
        {/* Left: logo + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <LogoAnim />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: '#534ab7' }}>PET</span>
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onPetName?.(nameDraft.trim()); setEditingName(false) }
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  onBlur={() => { onPetName?.(nameDraft.trim()); setEditingName(false) }}
                  placeholder="Name your pet…"
                  style={{ fontSize: 11, fontWeight: 600, color: '#374151', border: '1px solid #c4b5fd', borderRadius: 4, padding: '1px 5px', width: 90, outline: 'none', background: '#fff' }}
                />
              ) : (
                <span
                  onClick={() => { setNameDraft(petName || ''); setEditingName(true) }}
                  title="Click to name your pet"
                  style={{ fontSize: 11, fontWeight: 600, color: petName ? '#374151' : '#c4b5fd', cursor: 'text', borderBottom: '1px dashed #c4b5fd', lineHeight: 1.2 }}
                >
                  {petName || 'Name me…'}
                </span>
              )}
            </div>
            <div style={{ fontSize: 9, color: '#9ca3af' }}>{loading ? '…' : status}</div>
          </div>
        </div>

        {/* Right: size controls + window actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {!apiKey && (
            <button onClick={() => setView(v => v === 'setup' ? 'main' : 'setup')}
              style={{ fontSize: 9, padding: '2px 6px', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 4, cursor: 'pointer' }}>
              + Key
            </button>
          )}
          {/* Size – */}
          <button
            title="Shrink"
            onClick={() => {
              const ns = { w: Math.max(300, sizeRef.current.w - 40), h: Math.max(360, sizeRef.current.h - 40) }
              sizeRef.current = ns; setSz({ ...ns })
            }}
            style={{ border: '1px solid #e5e7eb', background: '#f9fafb', color: '#6b7280', borderRadius: 4, width: 20, height: 20, cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            −
          </button>
          {/* Size + */}
          <button
            title="Expand"
            onClick={() => {
              const ns = { w: Math.min(720, sizeRef.current.w + 40), h: Math.min(window.innerHeight - 20, sizeRef.current.h + 40) }
              sizeRef.current = ns; setSz({ ...ns })
            }}
            style={{ border: '1px solid #e5e7eb', background: '#f9fafb', color: '#6b7280', borderRadius: 4, width: 20, height: 20, cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            +
          </button>
          <button onClick={onMinimize} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af', width: 20, height: 20 }}>─</button>
          <button onClick={onClose}    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af', width: 20, height: 20 }}>✕</button>
        </div>
      </div>

      {/* Body */}
      {view === 'setup' ? (
        <SetupView keys={keys} setKeys={setKeys} setView={setView} setStatus={setStatus} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRewrite}
              disabled={loading}
              style={{ flex: 1, padding: 10, background: loading ? '#a5b4fc' : '#534ab7', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', fontSize: 12 }}
            >
              {loading ? '…' : '▶ Rewrite'}
            </button>
            <button
              onClick={handleScore}
              disabled={loading}
              style={{ flex: 1, padding: 10, background: loading ? '#7dd3fc' : '#0891b2', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', fontSize: 12 }}
            >
              {loading ? '…' : '◎ Score'}
            </button>
          </div>

          {/* RAG context + technique intelligence banner */}
          {rewriteMeta && rewrites.length > 0 && (
            <div style={{ background: rewriteMeta.contextUsed ? '#eff6ff' : '#f5f3ff', border: `1px solid ${rewriteMeta.contextUsed ? '#bfdbfe' : '#ddd6fe'}`, borderRadius: 8, padding: '6px 10px', fontSize: 10, color: rewriteMeta.contextUsed ? '#1d4ed8' : '#534ab7', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{rewriteMeta.contextUsed ? '🧠' : '✦'}</span>
              <div style={{ lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700 }}>{rewriteMeta.contextUsed ? 'Session context injected' : 'Dynamic technique selection'}</span>
                {rewriteMeta.domain && <span style={{ opacity: 0.75 }}> · {rewriteMeta.domain}</span>}
                {rewriteMeta.outputType && <span style={{ opacity: 0.6 }}> · {rewriteMeta.outputType}</span>}
                {rewriteMeta.source === 'ollama' && <span style={{ color: '#166534', marginLeft: 4 }}>· 🦙 Ollama</span>}
                {rewriteMeta.source === 'groq'   && <span style={{ color: '#0891b2', marginLeft: 4 }}>· ⚡ Cloud</span>}
              </div>
            </div>
          )}

          {/* No engine notice */}
          {!hasEngine && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: 8, fontSize: 10, color: '#92400e' }}>
              ⚡ Using offline templates. <span onClick={() => setView('setup')} style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>Connect Ollama or Groq</span> for AI-powered prompts.
            </div>
          )}
          {keys.ollama_model && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '5px 8px', fontSize: 10, color: '#166534' }}>
              🦙 Ollama: <b>{keys.ollama_model}</b> · <span onClick={() => setView('setup')} style={{ textDecoration: 'underline', cursor: 'pointer' }}>change</span>
            </div>
          )}

          {/* Rewrite Cards */}
          {rewrites.map((r, idx) => {
            const isEditing = editing === r.id
            const promptText = editTexts[r.id] ?? r.prompt
            return (
              <div key={r.id} style={{ background: '#fff', border: `1px solid ${r.recommended ? '#c4b5fd' : '#e5e7eb'}`, borderRadius: 12, padding: 10, position: 'relative' }}>
                {/* Card header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#534ab7' }}>{r.label}</span>
                    {r.recommended && <span style={{ marginLeft: 5, fontSize: 9, background: '#f0f0ff', color: '#534ab7', borderRadius: 99, padding: '1px 5px', border: '1px solid #c4b5fd' }}>Recommended</span>}
                    {r.technique && <span style={{ marginLeft: 5, fontSize: 9, background: '#f0fdf4', color: '#166534', borderRadius: 99, padding: '1px 5px', border: '1px solid #bbf7d0' }}>{r.technique}</span>}
                    {r.hasContext && <span style={{ marginLeft: 5, fontSize: 9, background: '#eff6ff', color: '#1d4ed8', borderRadius: 99, padding: '1px 5px', border: '1px solid #bfdbfe' }}>🧠 ctx</span>}
                  </div>
                  <span style={{ fontSize: 9, color: '#9ca3af' }}>#{idx + 1}</span>
                </div>
                {r.why && <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 5, fontStyle: 'italic' }}>{r.why}</div>}

                {/* Prompt preview OR edit textarea */}
                {isEditing ? (
                  <textarea
                    value={promptText}
                    onChange={e => setEditTexts(prev => ({ ...prev, [r.id]: e.target.value }))}
                    style={{ width: '100%', height: 180, fontSize: 10, fontFamily: 'monospace', border: '1px solid #c4b5fd', borderRadius: 6, padding: 6, resize: 'vertical', boxSizing: 'border-box', color: '#374151', lineHeight: 1.5 }}
                  />
                ) : (
                  <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5, maxHeight: 90, overflow: 'hidden', position: 'relative' }}>
                    {promptText.slice(0, 280)}{promptText.length > 280 ? '…' : ''}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => inject(promptText)}
                        style={{ flex: 2, padding: '5px 0', background: '#534ab7', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}
                      >↗ Inject Refined</button>
                      <button
                        onClick={() => setEditing(null)}
                        style={{ flex: 1, padding: '5px 0', background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 10 }}
                      >← Back</button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => inject(r.prompt)}
                        style={{ flex: 2, padding: '5px 0', background: '#f0f0ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}
                      >↗ Use</button>
                      <button
                        onClick={() => handleRewriteCard(r.prompt)}
                        title="Generate new variations of this prompt"
                        disabled={loading}
                        style={{ flex: 1, padding: '5px 0', background: loading ? '#f3f4f6' : '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 6, cursor: loading ? 'wait' : 'pointer', fontSize: 10, fontWeight: 600 }}
                      >↺ Vary</button>
                      <button
                        onClick={() => startRefine(r)}
                        title="Edit before injecting"
                        style={{ padding: '5px 7px', background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 10 }}
                      >✏</button>
                      <button
                        onClick={() => copyToClipboard(r.id, r.prompt)}
                        title="Copy to clipboard"
                        style={{ padding: '5px 8px', background: copied === r.id ? '#f0fdf4' : '#f9fafb', color: copied === r.id ? '#16a34a' : '#6b7280', border: `1px solid ${copied === r.id ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 6, cursor: 'pointer', fontSize: 10 }}
                      >{copied === r.id ? '✓' : '⎘'}</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Score Card — goal-completion aware */}
          {score && (() => {
            const done       = score.should_stop
            const completion = score.completion_pct ?? score.score
            const covered    = score.newly_covered  || score.covered  || []
            const missing    = score.still_missing  || score.missing  || []
            const scoreColor = score.score >= 75 ? '#16a34a' : score.score >= 55 ? '#d97706' : '#dc2626'
            const compColor  = completion >= 80 ? '#16a34a' : completion >= 55 ? '#f59e0b' : '#ef4444'

            return (
              <div style={{ background: done ? '#f0fdf4' : '#f9fafb', border: `1px solid ${done ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 12, padding: 12 }}>

                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor }}>{score.score}%</div>
                    <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>response quality</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: compColor }}>{completion}%</div>
                    <div style={{ fontSize: 9, color: '#9ca3af' }}>goal complete</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Grade {score.grade}</div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{score.grade_label}</div>
                  </div>
                </div>

                {/* Goal completion bar */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 3 }}>Goal completion</div>
                  <div style={{ height: 7, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${completion}%`, background: compColor, borderRadius: 4, transition: 'width 0.6s ease' }} />
                  </div>
                </div>

                {/* Done state */}
                {done ? (
                  <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: 10, marginBottom: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', marginBottom: 4 }}>✓ Goal Complete</div>
                    <div style={{ fontSize: 10, color: '#15803d', lineHeight: 1.55 }}>{score.stop_reason || 'All required elements have been addressed.'}</div>
                    {covered.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 9, color: '#166534' }}>
                        Covered: {covered.slice(0, 5).join(' · ')}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Covered */}
                    {covered.length > 0 && (
                      <div style={{ marginBottom: 7 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', marginBottom: 3 }}>✓ This response covered</div>
                        {covered.slice(0, 4).map((c, i) => <div key={i} style={{ fontSize: 10, color: '#374151', marginBottom: 2, paddingLeft: 8 }}>• {c}</div>)}
                      </div>
                    )}

                    {/* Missing */}
                    {missing.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', marginBottom: 3 }}>✗ Still missing</div>
                        {missing.slice(0, 3).map((m, i) => <div key={i} style={{ fontSize: 10, color: '#374151', marginBottom: 2, paddingLeft: 8 }}>• {m}</div>)}
                      </div>
                    )}

                    {/* Next prompt — targeted at the actual gap */}
                    {score.next_prompt && (
                      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 9 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>→ Next: fill the gap</div>
                        <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.55, marginBottom: 6 }}>{score.next_prompt}</div>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button onClick={() => inject(score.next_prompt)}
                            style={{ flex: 2, padding: '4px 0', background: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 5, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
                            ↗ Use
                          </button>
                          <button onClick={() => copyToClipboard('next', score.next_prompt)}
                            style={{ padding: '4px 8px', background: copied === 'next' ? '#f0fdf4' : '#f9fafb', color: copied === 'next' ? '#16a34a' : '#6b7280', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', fontSize: 10 }}>
                            {copied === 'next' ? '✓' : '⎘'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={e => { resizing.current = true; rstart.current = { x: e.clientX, y: e.clientY, w: sizeRef.current.w, h: sizeRef.current.h }; e.preventDefault() }}
        style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'se-resize', opacity: 0.4 }}
      >▗</div>
    </div>
  )
}

// ── Setup view — Ollama + Groq configuration ──────────────────────────────
function SetupView({ keys, setKeys, setView, setStatus }) {
  const [ollamaModels,  setOllamaModels]  = useState(null)   // null = not checked yet
  const [ollamaStatus,  setOllamaStatus]  = useState('')
  const [detecting,     setDetecting]     = useState(false)
  const [groqInput,     setGroqInput]     = useState('')
  const [saved,         setSaved]         = useState('')

  const activeOllama = keys.ollama_model
  const activeGroq   = keys.groq

  async function detectOllama() {
    setDetecting(true)
    setOllamaStatus('Checking localhost:11434…')
    try {
      const res = await chrome.runtime.sendMessage({ type: 'OLLAMA_MODELS' })
      if (res?.ok && res.models?.length) {
        setOllamaModels(res.models)
        setOllamaStatus(`✓ Found ${res.models.length} model${res.models.length > 1 ? 's' : ''}`)
      } else {
        setOllamaModels([])
        setOllamaStatus('Ollama not running — start it with: ollama serve')
      }
    } catch {
      setOllamaModels([])
      setOllamaStatus('Could not reach Ollama')
    }
    setDetecting(false)
  }

  async function selectOllamaModel(model) {
    await chrome.runtime.sendMessage({ type: 'SET_KEY', provider: 'ollama_model', key: model })
    setKeys(k => ({ ...k, ollama_model: model }))
    setSaved('ollama')
    setStatus(`✓ Ollama: ${model}`)
    setTimeout(() => setSaved(''), 2000)
  }

  async function clearOllama() {
    await chrome.runtime.sendMessage({ type: 'SET_KEY', provider: 'ollama_model', key: '' })
    setKeys(k => ({ ...k, ollama_model: null }))
    setStatus('Ollama removed')
  }

  async function saveGroqKey(key) {
    await chrome.runtime.sendMessage({ type: 'SET_KEY', provider: 'groq', key })
    setKeys(k => ({ ...k, groq: key }))
    setSaved('groq')
    setStatus('✓ Groq key saved!')
    setTimeout(() => setSaved(''), 2000)
  }

  const cardStyle = (active) => ({
    border: `1.5px solid ${active ? '#c4b5fd' : '#e5e7eb'}`,
    borderRadius: 10, padding: 12, marginBottom: 10,
    background: active ? '#f5f3ff' : '#fff',
  })

  return (
    <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#534ab7', marginBottom: 12 }}>
        AI Engine Setup
      </div>

      {/* Priority indicator */}
      <div style={{ fontSize: 10, color: '#6b7280', background: '#f9fafb', borderRadius: 8, padding: '6px 10px', marginBottom: 12, lineHeight: 1.7 }}>
        <b>Priority order:</b><br />
        {activeOllama ? '🟢' : '⚪'} 1. Ollama (local, free, private)<br />
        {activeGroq   ? '🟢' : '⚪'} 2. Groq cloud (fast, free tier)<br />
        ⚪ 3. Offline templates (always available)
      </div>

      {/* ── Ollama section ── */}
      <div style={cardStyle(!!activeOllama)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>
            🦙 Ollama <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 400 }}>local · no key needed</span>
          </div>
          {activeOllama && (
            <button onClick={clearOllama} style={{ fontSize: 9, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>
          )}
        </div>

        {activeOllama ? (
          <div style={{ fontSize: 10, color: '#166534', background: '#f0fdf4', padding: '5px 8px', borderRadius: 6 }}>
            ✓ Active: <b>{activeOllama}</b>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 8 }}>
              Run any model locally — llama3, mistral, qwen2.5, gemma2. 100% private.
            </div>
            <button
              onClick={detectOllama}
              disabled={detecting}
              style={{ width: '100%', padding: '7px 0', background: detecting ? '#e5e7eb' : '#f0f0ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 7, cursor: detecting ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              {detecting ? 'Detecting…' : '⟳ Detect Ollama Models'}
            </button>
            {ollamaStatus && (
              <div style={{ fontSize: 10, color: ollamaModels?.length ? '#166534' : '#dc2626', marginTop: 6 }}>{ollamaStatus}</div>
            )}
            {ollamaModels?.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {ollamaModels.map(m => (
                  <button
                    key={m.name}
                    onClick={() => selectOllamaModel(m.name)}
                    style={{
                      padding: '6px 10px', background: '#fff', border: '1px solid #e5e7eb',
                      borderRadius: 6, cursor: 'pointer', fontSize: 10, textAlign: 'left',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#374151' }}>{m.name}</span>
                    <span style={{ color: '#9ca3af' }}>{m.size}</span>
                  </button>
                ))}
              </div>
            )}
            {ollamaModels?.length === 0 && ollamaStatus && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#6b7280', background: '#f9fafb', padding: 8, borderRadius: 6 }}>
                Install: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>brew install ollama</code><br />
                Pull model: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>ollama pull llama3.2</code><br />
                Start: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>ollama serve</code>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Groq section ── */}
      <div style={cardStyle(!!activeGroq)}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
          ⚡ Groq <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 400 }}>cloud · free tier · llama-3.3-70b</span>
        </div>
        {activeGroq ? (
          <div style={{ fontSize: 10, color: '#166534', background: '#f0fdf4', padding: '5px 8px', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>✓ Key saved (gsk_…{activeGroq.slice(-4)})</span>
            <button onClick={async () => { await chrome.runtime.sendMessage({ type:'SET_KEY', provider:'groq', key:'' }); setKeys(k=>({...k,groq:null})) }} style={{ fontSize: 9, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>
              Free at <b>console.groq.com</b> — uses llama-3.3-70b, fastest cloud option.
            </div>
            <input
              type="password"
              placeholder="Paste Groq key (gsk_…) then Enter"
              value={groqInput}
              onChange={e => setGroqInput(e.target.value)}
              style={{ width: '100%', padding: 7, border: '1px solid #ddd', borderRadius: 6, fontSize: 11, boxSizing: 'border-box' }}
              onKeyDown={e => { if (e.key === 'Enter' && groqInput.trim()) { saveGroqKey(groqInput.trim()); setGroqInput('') } }}
            />
            {saved === 'groq' && <div style={{ fontSize: 10, color: '#166534', marginTop: 4 }}>✓ Saved!</div>}
          </>
        )}
      </div>

      <button
        onClick={() => setView('main')}
        style={{ width: '100%', padding: 7, background: '#f3f4f6', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 11, color: '#6b7280' }}
      >
        ← Back (offline mode works without any setup)
      </button>
    </div>
  )
}
