import { useState, useRef, useEffect } from 'react'
import { setQ, getQ, rewrite, evaluate, getOllamaModels, setKey as apiSetKey } from '../../engines/api'
import lottie from 'lottie-web'
import { recordRewrite, recordScore, recordInject } from '../../engines/metrics_store'
import { signalPositive, signalNegative, signalCopy } from '../../engines/selfLearner.js'
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
  const [rewriteMeta,    setRewriteMeta]    = useState(null)
  const [providerConfig, setProviderConfig] = useState(null)
  const [modelMenuOpen,  setModelMenuOpen]  = useState(false)

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

  // ── Active provider label for model selector ──────────────────────────────
  const activeProvider = providerConfig?.activeProvider || null
  const PROVIDER_ICONS = { gemini:'✨', openai:'🤖', groq:'⚡', claude:'🧠', grok:'𝕏', openrouter:'🌐', deepseek:'🔍', ollama:'🦙' }
  const activeIcon     = activeProvider ? (PROVIDER_ICONS[activeProvider] || '⚡') : '⚡'
  const activeModel    = activeProvider ? (providerConfig?.selectedModels?.[activeProvider] || '') : ''
  const activeLabel    = activeProvider
    ? `${activeIcon} ${activeProvider}${activeModel ? ` · ${activeModel.split('/').pop()?.split('-').slice(0,3).join('-')}` : ''}`
    : '⚡ Offline'

  function switchProvider(provider) {
    chrome.storage.local.set({ pet_active_provider: provider })
    chrome.runtime.sendMessage({ type: 'GET_PROVIDER_CONFIG' })
      .then(cfg => { if (cfg?.ok) setProviderConfig(cfg) })
      .catch(() => {})
    setModelMenuOpen(false)
  }

  // ── Restore persisted state on mount (survives minimize + page refresh) ───
  useEffect(() => {
    chrome.storage.local.get(PERSIST_KEY, r => {
      const saved = r[PERSIST_KEY]
      if (!saved) return
      if (saved.rewrites?.length) { setRewrites(saved.rewrites); setStatus(`✓ ${saved.rewrites.length} prompts restored`) }
      if (saved.score)              setScore(saved.score)
      if (saved.originalQ)          originalQ.current = saved.originalQ
    })
    // Load provider config for the model selector
    chrome.runtime.sendMessage({ type: 'GET_PROVIDER_CONFIG' })
      .then(cfg => { if (cfg?.ok) setProviderConfig(cfg) })
      .catch(() => {})

    // Close model menu on outside click
    const closeMenu = () => setModelMenuOpen(false)
    document.addEventListener('click', closeMenu, true)
    return () => document.removeEventListener('click', closeMenu, true)
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

  // ── Dynamic follow-up builder — uses actual gaps + question, not templates ──
  function buildFollowUp(domain, gaps, score, originalQ = '') {
    const g = gaps.filter(Boolean).slice(0, 3)
    const hasGaps = g.length > 0
    const qSnippet = originalQ ? originalQ.slice(0, 100) : ''

    // Format gap list naturally
    const gapList = g.length === 0 ? ''
      : g.length === 1 ? `"${g[0]}"`
      : g.length === 2 ? `"${g[0]}" and "${g[1]}"`
      : `"${g[0]}", "${g[1]}", and "${g[2]}"`

    if (score >= 82) {
      // Strong response — push for depth and real specifics
      if (hasGaps) {
        return `The main points are covered. Now go deeper: "You mentioned ${gapList} but didn't fully explore ${g.length > 1 ? 'them' : 'it'}. For each: give a concrete real-world example with specific numbers or working code, show the edge case where it fails or behaves unexpectedly, and explain how an expert handles that edge case differently from a beginner."`
      }
      return `Good answer. Make it concrete: "Take what you just explained and apply it to a real scenario with actual names, numbers, and measurable outcomes. Show the single thing that separates an expert's approach from a technically correct but average answer."`
    }

    if (score >= 60 && hasGaps) {
      // Medium quality with specific gaps — request targeted fill
      const intro = qSnippet
        ? `Your response to "${qSnippet}${qSnippet.length >= 100 ? '…' : ''}" skipped`
        : 'Your response skipped'
      return `The answer left gaps. Follow up: "${intro} ${gapList}. For ${g.length > 1 ? 'each one' : 'it'}: what exactly is it?, how does it apply in this specific context?, and give a concrete example with real details — actual numbers, working code, or a named real-world case. Don't give a general overview."`
    }

    if (score >= 60) {
      // Medium quality, no clear gaps — ask for specifics
      return `The answer needs more depth. Ask: "Can you be more concrete? Pick the most important concept from your answer and show it in action — use a real example with specific numbers or code, walk through the mechanism step by step, and show what would go wrong if someone applied this incorrectly."`
    }

    if (hasGaps) {
      // Low score with known gaps — request focused redo
      const context = qSnippet ? ` in the context of "${qSnippet}${qSnippet.length >= 100 ? '…' : ''}"` : ''
      return `The response was incomplete. Ask: "Your answer missed ${gapList}${context}. Please address the question again — specifically: define ${g[0]} precisely, show how it applies with a concrete example using real numbers or working code, and explain the step-by-step mechanism. Avoid general statements."`
    }

    // Low score, no clear keywords missed — ask for a complete redo
    return `The response was too vague. Ask: "Please answer again with more precision. Instead of general statements, give me: (1) a specific real-world example with actual numbers or working code, (2) the step-by-step mechanism showing how it works, and (3) the one thing that would make your answer immediately actionable for someone starting right now."`
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

    const next_prompt = buildFollowUp(domain, missWords, sc, originalQuestion)

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

        {/* Right: model selector + size controls + window actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {/* Compact model/provider selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setModelMenuOpen(o => !o)}
              title="Switch AI provider"
              style={{ fontSize: 8, padding: '2px 6px', background: '#f5f3ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 4, cursor: 'pointer', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeLabel} ▾
            </button>
            {modelMenuOpen && providerConfig && (
              <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 2147483647, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,.15)', minWidth: 160, marginTop: 3 }}>
                <div style={{ padding: '5px 8px', fontSize: 9, color: '#9ca3af', borderBottom: '1px solid #f3f4f6', fontWeight: 600 }}>SWITCH ENGINE</div>
                {Object.entries(providerConfig.connectedProviders || {})
                  .filter(([, connected]) => connected)
                  .map(([prov]) => (
                    <button key={prov} onClick={() => switchProvider(prov)}
                      style={{ width: '100%', textAlign: 'left', padding: '6px 10px', background: providerConfig.activeProvider === prov ? '#f5f3ff' : '#fff', border: 'none', cursor: 'pointer', fontSize: 10, color: '#374151', display: 'flex', alignItems: 'center', gap: 5, borderBottom: '1px solid #f9fafb' }}>
                      <span>{PROVIDER_ICONS[prov] || '⚡'}</span>
                      <span style={{ fontWeight: providerConfig.activeProvider === prov ? 700 : 400 }}>{prov}</span>
                      {providerConfig.activeProvider === prov && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#16a34a' }}>✓</span>}
                    </button>
                  ))
                }
                {!Object.values(providerConfig.connectedProviders || {}).some(Boolean) && (
                  <div style={{ padding: '8px 10px', fontSize: 10, color: '#9ca3af' }}>No providers connected</div>
                )}
              </div>
            )}
          </div>
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

          {/* Context / source banner — only shown when there's something meaningful to surface */}
          {rewriteMeta && rewrites.length > 0 && (rewriteMeta.contextUsed || rewriteMeta.domain) && (
            <div style={{ background: rewriteMeta.contextUsed ? '#eff6ff' : '#f9fafb', border: `1px solid ${rewriteMeta.contextUsed ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 8, padding: '5px 10px', fontSize: 10, color: rewriteMeta.contextUsed ? '#1d4ed8' : '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
              {rewriteMeta.contextUsed && <span>🧠</span>}
              <div style={{ lineHeight: 1.5 }}>
                {rewriteMeta.contextUsed && <span style={{ fontWeight: 700 }}>Prior session context used · </span>}
                {rewriteMeta.domain && <span>{rewriteMeta.domain}</span>}
                {rewriteMeta.outputType && <span style={{ opacity: 0.7 }}> · {rewriteMeta.outputType}</span>}
                {rewriteMeta.source === 'ollama' && <span style={{ color: '#166534', marginLeft: 4 }}>· 🦙 Ollama</span>}
                {rewriteMeta.source === 'groq'   && <span style={{ color: '#0891b2', marginLeft: 4 }}>· ⚡ Cloud AI</span>}
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
                  <div style={{ flexWrap: 'wrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#534ab7' }}>{r.label}</span>
                    {r.recommended && <span style={{ fontSize: 9, background: '#f0f0ff', color: '#534ab7', borderRadius: 99, padding: '1px 5px', border: '1px solid #c4b5fd' }}>Recommended</span>}
                    {r.technique && <span style={{ fontSize: 9, background: '#f0fdf4', color: '#166534', borderRadius: 99, padding: '1px 5px', border: '1px solid #bbf7d0' }}>{r.technique}</span>}
                    {r.hasContext && <span style={{ fontSize: 9, background: '#eff6ff', color: '#1d4ed8', borderRadius: 99, padding: '1px 5px', border: '1px solid #bfdbfe' }}>🧠 ctx</span>}
                    {r.source && r.source !== 'instant' && (
                      <span style={{ fontSize: 8, background: '#fafafa', color: '#9ca3af', borderRadius: 99, padding: '1px 5px', border: '1px solid #e5e7eb' }}>
                        {PROVIDER_ICONS[r.source] || '⚡'} {r.source}{r.model ? ` · ${r.model.split('/').pop()?.split('-').slice(0,3).join('-')}` : ''}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 9, color: '#9ca3af', flexShrink: 0 }}>#{idx + 1}</span>
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
                        onClick={() => {
                          inject(r.prompt)
                          try { signalPositive(r, originalQ.current, r.source || activeProvider) } catch {}
                        }}
                        style={{ flex: 2, padding: '5px 0', background: '#f0f0ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}
                      >↗ Use</button>
                      <button
                        onClick={() => {
                          handleRewriteCard(r.prompt)
                          try { signalNegative(r, originalQ.current, r.source || activeProvider) } catch {}
                        }}
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
                        onClick={() => {
                          copyToClipboard(r.id, r.prompt)
                          try { signalCopy(r, originalQ.current, r.source || activeProvider) } catch {}
                        }}
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
