import { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { getMetrics } from '../engines/metrics_store'
import lottie from 'lottie-web'

const WEBSITE = 'https://krishianjan.github.io/PET-Chain/'

const LLM_LINKS = [
  { name: 'ChatGPT',    url: 'https://chatgpt.com',            icon: '🤖' },
  { name: 'Claude',     url: 'https://claude.ai',              icon: '🧠' },
  { name: 'Gemini',     url: 'https://gemini.google.com',      icon: '✨' },
  { name: 'DeepSeek',   url: 'https://chat.deepseek.com',      icon: '🔍' },
  { name: 'Perplexity', url: 'https://perplexity.ai',          icon: '🌐' },
]

function LogoAnimation() {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    const url = chrome.runtime.getURL('assets/lottie/loadinganimation.json')
    let inst = null
    fetch(url).then(r => r.json()).then(data => {
      if (!ref.current) return
      inst = lottie.loadAnimation({ container: ref.current, animationData: data, renderer: 'svg', loop: true, autoplay: true })
    }).catch(() => {})
    return () => inst?.destroy()
  }, [])
  return <div ref={ref} style={{ width: 38, height: 38, flexShrink: 0 }} />
}

function ScoreBar({ history }) {
  if (!history?.length) return null
  const recent = history.slice(-20)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28 }}>
      {recent.map((s, i) => (
        <div key={i} title={`${s}%`} style={{
          flex: 1, minHeight: 3,
          height: `${Math.round((s / 100) * 100)}%`,
          background: s >= 75 ? '#16a34a' : s >= 55 ? '#f59e0b' : '#ef4444',
          borderRadius: 2,
          opacity: 0.65 + (i / recent.length) * 0.35,
        }} />
      ))}
    </div>
  )
}

function KeyRow({ provider, label, value, onSave, hint }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  return editing ? (
    <div style={{ padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>{hint || label}</div>
      <div style={{ display: 'flex', gap: 5 }}>
        <input autoFocus type="password" value={draft} onChange={e => setDraft(e.target.value)}
          placeholder={`Paste ${label} key…`}
          style={{ flex: 1, fontSize: 11, padding: '5px 8px', border: '1px solid #c4b5fd', borderRadius: 6, outline: 'none' }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onSave(provider, draft.trim()); setEditing(false) }
            if (e.key === 'Escape') setEditing(false)
          }} />
        <button onClick={() => { onSave(provider, draft.trim()); setEditing(false) }}
          style={{ fontSize: 10, padding: '5px 10px', background: '#534ab7', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Save</button>
        <button onClick={() => setEditing(false)}
          style={{ fontSize: 10, padding: '5px 8px', background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✕</button>
      </div>
    </div>
  ) : (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{label}</span>
        {value
          ? <span style={{ marginLeft: 6, fontSize: 9, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 99, padding: '1px 5px' }}>Connected ✓</span>
          : <span style={{ marginLeft: 6, fontSize: 9, color: '#9ca3af' }}>Not connected</span>}
      </div>
      <button onClick={() => { setDraft(''); setEditing(true) }}
        style={{ fontSize: 10, padding: '3px 8px', border: '1px solid #e5e7eb', borderRadius: 5, background: value ? '#f9fafb' : '#534ab7', color: value ? '#374151' : '#fff', cursor: 'pointer' }}>
        {value ? 'Change' : '+ Add'}
      </button>
    </div>
  )
}

function Dashboard() {
  const [m,    setM]    = useState(null)
  const [keys, setKeys] = useState({})
  const [pet,  setPet]  = useState('dog')
  const [tab,  setTab]  = useState('stats')

  const [ollamaModels, setOllamaModels] = useState(null)
  const [ollamaStatus, setOllamaStatus] = useState('')
  const [detectingOll, setDetectingOll] = useState(false)

  useEffect(() => {
    getMetrics().then(setM)
    chrome.runtime.sendMessage({ type: 'GET_ALL_KEYS' }).then(k => setKeys(k || {})).catch(() => {})
    chrome.storage.local.get('pet_type', r => setPet(r.pet_type || 'dog'))
  }, [])

  function saveKey(provider, key) {
    chrome.runtime.sendMessage({ type: 'SET_KEY', provider, key })
    setKeys(k => ({ ...k, [provider]: key || null }))
  }

  async function detectOllama() {
    setDetectingOll(true)
    setOllamaStatus('Checking localhost:11434…')
    try {
      const res = await chrome.runtime.sendMessage({ type: 'OLLAMA_MODELS' })
      if (res?.ok && res.models?.length) {
        setOllamaModels(res.models)
        setOllamaStatus(`Found ${res.models.length} model${res.models.length > 1 ? 's' : ''}`)
      } else {
        setOllamaModels([])
        setOllamaStatus('Not running — start: ollama serve')
      }
    } catch { setOllamaStatus('Could not reach Ollama') }
    setDetectingOll(false)
  }

  function selectOllamaModel(name) {
    saveKey('ollama_model', name)
    setOllamaStatus(`✓ Active: ${name}`)
    setOllamaModels(null)
  }

  if (!m) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: '#9ca3af', fontSize: 12, fontFamily: 'system-ui' }}>Loading…</div>
  )

  const hasOllama   = !!keys.ollama_model
  const cloudKeys   = [keys.groq, keys.openai, keys.deepseek, keys.claude].filter(Boolean)
  const engineLabel = hasOllama ? `🦙 ${keys.ollama_model}` : cloudKeys.length ? `${cloudKeys.length} key${cloudKeys.length > 1 ? 's' : ''} connected` : 'Offline mode'
  const noActivity  = m.prompts_rewritten === 0
  const topTech     = Object.entries(m.technique_counts || {}).sort((a, b) => b[1] - a[1])[0]
  const sc          = s => s >= 75 ? '#16a34a' : s >= 55 ? '#d97706' : '#dc2626'

  const TABS = [['stats', '📊 Stats'], ['engines', '⚡ Engines'], ['launch', '🚀 Launch']]

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#fff', width: 340 }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#534ab7,#7c3aed)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoAnimation />
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>PET Dashboard</div>
            <div style={{ color: 'rgba(255,255,255,.65)', fontSize: 10, marginTop: 1 }}>{engineLabel}</div>
          </div>
        </div>
        <button onClick={() => chrome.tabs.create({ url: WEBSITE })}
          style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 5, cursor: 'pointer' }}>
          🌐 Website ↗
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: '8px 0', fontSize: 10, fontWeight: tab === id ? 700 : 400,
            color: tab === id ? '#534ab7' : '#9ca3af', background: 'none', border: 'none',
            borderBottom: tab === id ? '2px solid #534ab7' : '2px solid transparent',
            cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>

      {/* ── Stats tab ── */}
      {tab === 'stats' && (
        <div style={{ padding: 14 }}>
          {noActivity ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🐾</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>No activity yet</div>
              <div style={{ fontSize: 10, lineHeight: 1.6 }}>Open ChatGPT, Claude or Gemini,<br/>type a prompt and click <b>▶ Rewrite</b></div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 10 }}>
                {[
                  { label: 'Rewrites',      value: m.prompts_rewritten,                              color: '#534ab7' },
                  { label: 'Injected',       value: m.inject_count || 0,                              color: '#0891b2' },
                  { label: 'Avg Score',      value: m.avg_score ? `${m.avg_score}%` : '—',           color: sc(m.avg_score) },
                  { label: 'Sessions',       value: m.sessions,                                       color: '#7c3aed' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 10px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
                    <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', borderRadius: 8, padding: '9px 12px', marginBottom: 10, border: '1px solid #ddd6fe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#7c3aed', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>Tokens Saved</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#534ab7' }}>~{m.tokens_saved.toLocaleString()}</div>
                </div>
                <div style={{ fontSize: 28 }}>💾</div>
              </div>

              {m.score_history?.length > 1 && (
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 10px', marginBottom: 10, border: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Score History</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sc(m.score_history.slice(-1)[0]) }}>{m.score_history.slice(-1)[0]}%</span>
                  </div>
                  <ScoreBar history={m.score_history} />
                </div>
              )}

              {topTech && (
                <div style={{ fontSize: 10, color: '#534ab7', background: '#f0f0ff', borderRadius: 99, padding: '3px 10px', border: '1px solid #c4b5fd', display: 'inline-block' }}>
                  🧠 Top technique: {topTech[0]} × {topTech[1]}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Engines tab ── */}
      {tab === 'engines' && (
        <div style={{ padding: 14, maxHeight: 400, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, background: '#f9fafb', borderRadius: 7, padding: '6px 10px', marginBottom: 10, lineHeight: 1.7, color: '#6b7280' }}>
            {hasOllama ? '🟢' : '⚪'} Ollama (local) → {keys.groq ? '🟢' : '⚪'} Groq → ⚪ Offline
          </div>

          {/* Ollama */}
          <div style={{ marginBottom: 12, padding: 10, background: hasOllama ? '#f0fdf4' : '#f9fafb', border: `1px solid ${hasOllama ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>🦙 Ollama <span style={{ fontSize: 9, fontWeight: 400, color: '#9ca3af' }}>local · free · private</span></span>
              {hasOllama && <button onClick={() => saveKey('ollama_model', '')} style={{ fontSize: 9, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>}
            </div>
            {hasOllama ? (
              <div style={{ fontSize: 10, color: '#166534' }}>✓ {keys.ollama_model}</div>
            ) : (
              <>
                <button onClick={detectOllama} disabled={detectingOll}
                  style={{ width: '100%', padding: '6px 0', background: '#f0f0ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
                  {detectingOll ? 'Detecting…' : '⟳ Detect Models'}
                </button>
                {ollamaStatus && <div style={{ fontSize: 10, color: ollamaModels?.length ? '#166534' : '#b45309', marginBottom: 4 }}>{ollamaStatus}</div>}
                {ollamaModels?.length > 0 && ollamaModels.map(m => (
                  <button key={m.name} onClick={() => selectOllamaModel(m.name)}
                    style={{ width: '100%', padding: '5px 8px', marginBottom: 3, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', fontSize: 10, textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                    <b>{m.name}</b><span style={{ color: '#9ca3af' }}>{m.size}</span>
                  </button>
                ))}
                {ollamaModels?.length === 0 && <div style={{ fontSize: 9, color: '#9ca3af' }}>brew install ollama → ollama pull llama3.2 → ollama serve</div>}
              </>
            )}
          </div>

          {/* Cloud API Keys */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.4px' }}>Cloud API Keys</div>
          <KeyRow provider="groq"    label="Groq"    value={keys.groq}    onSave={saveKey} hint="Free at console.groq.com — llama-3.3-70b" />
          <KeyRow provider="claude"  label="Claude"  value={keys.claude}  onSave={saveKey} hint="Anthropic API key — console.anthropic.com" />
          <KeyRow provider="openai"  label="OpenAI"  value={keys.openai}  onSave={saveKey} hint="platform.openai.com/api-keys" />
          <KeyRow provider="deepseek"label="DeepSeek"value={keys.deepseek}onSave={saveKey} hint="platform.deepseek.com" />

          <div style={{ marginTop: 10, fontSize: 10, color: '#9ca3af' }}>Keys stored locally — never shared.</div>
        </div>
      )}

      {/* ── Launch tab ── */}
      {tab === 'launch' && (
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Open LLM in new tab</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {LLM_LINKS.map(({ name, url, icon }) => (
              <button key={name} onClick={() => chrome.tabs.create({ url })}
                style={{ padding: '9px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontWeight: 600, color: '#374151' }}>
                <span>{icon} {name}</span>
                <span style={{ fontSize: 10, color: '#9ca3af' }}>↗</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14, borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Coming Soon</div>
            {['Token usage tracker', 'Auto form-fill agent', 'What you learned today', 'Claude Code terminal agent'].map(f => (
              <div key={f} style={{ fontSize: 10, color: '#6b7280', padding: '3px 0', display: 'flex', gap: 6 }}>
                <span style={{ color: '#c4b5fd' }}>◈</span>{f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px solid #f3f4f6', padding: '7px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#9ca3af' }}>PET v4.0</span>
        <button onClick={() => chrome.storage.local.remove('pet_metrics_v1', () => getMetrics().then(setM))}
          style={{ fontSize: 9, padding: '2px 7px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, color: '#9ca3af', cursor: 'pointer' }}>
          Reset stats
        </button>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Dashboard />)
