import { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { getMetrics } from '../engines/metrics_store'
import lottie from 'lottie-web'

const PET_EMOJI = { dog: '🐕', cat: '🐈', bird: '🦜', rabbit: '🐇', human: '🧑' }

// Animated logo using loadinganimation.json
function LogoAnimation() {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    const url = chrome.runtime.getURL('assets/lottie/loadinganimation.json')
    let inst = null
    fetch(url).then(r => r.json()).then(data => {
      if (!ref.current) return
      inst = lottie.loadAnimation({
        container: ref.current,
        animationData: data,
        renderer: 'svg',
        loop: true,
        autoplay: true,
      })
    }).catch(() => {})
    return () => inst?.destroy()
  }, [])
  return <div ref={ref} style={{ width: 44, height: 44, flexShrink: 0 }} />
}

// Simple sparkline bar chart for score history
function ScoreHistory({ history }) {
  if (!history?.length) return null
  const recent = history.slice(-20)
  const max = 100
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32, marginTop: 8 }}>
      {recent.map((s, i) => (
        <div
          key={i}
          title={`${s}%`}
          style={{
            flex: 1,
            height: `${Math.round((s / max) * 100)}%`,
            minHeight: 3,
            background: s >= 75 ? '#16a34a' : s >= 55 ? '#f59e0b' : '#ef4444',
            borderRadius: 2,
            opacity: 0.7 + (i / recent.length) * 0.3,
          }}
        />
      ))}
    </div>
  )
}

function KeyRow({ provider, label, value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')

  if (!editing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{label}</span>
          {value
            ? <span style={{ marginLeft: 6, fontSize: 9, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 99, padding: '1px 5px' }}>Connected ✓</span>
            : <span style={{ marginLeft: 6, fontSize: 9, color: '#9ca3af' }}>Not connected</span>}
        </div>
        <button
          onClick={() => { setDraft(''); setEditing(true) }}
          style={{ fontSize: 10, padding: '3px 8px', border: '1px solid #e5e7eb', borderRadius: 5, background: value ? '#f9fafb' : '#534ab7', color: value ? '#374151' : '#fff', cursor: 'pointer' }}
        >{value ? 'Change' : '+ Add'}</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
        {label} key {provider === 'groq' ? '— free at console.groq.com' : ''}
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        <input
          autoFocus
          type="password"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={`Paste ${label} key…`}
          style={{ flex: 1, fontSize: 11, padding: '5px 8px', border: '1px solid #c4b5fd', borderRadius: 6, outline: 'none' }}
          onKeyDown={e => { if (e.key === 'Enter') { onSave(provider, draft.trim()); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
        />
        <button
          onClick={() => { onSave(provider, draft.trim()); setEditing(false) }}
          style={{ fontSize: 10, padding: '5px 10px', background: '#534ab7', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >Save</button>
        <button
          onClick={() => setEditing(false)}
          style={{ fontSize: 10, padding: '5px 8px', background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >✕</button>
      </div>
    </div>
  )
}

const WEBSITE = 'https://krishianjan.github.io/PET-Chain/'

function Dashboard() {
  const [m,     setM]    = useState(null)
  const [keys,  setKeys] = useState({})
  const [pet,   setPet]  = useState('dog')
  const [tab,   setTab]  = useState('stats')  // 'stats' | 'keys' | 'about'

  // Ollama detection state
  const [ollamaModels,  setOllamaModels]  = useState(null)
  const [ollamaStatus,  setOllamaStatus]  = useState('')
  const [detectingOll,  setDetectingOll]  = useState(false)

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
        setOllamaStatus('Not running — start with: ollama serve')
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: '#9ca3af', fontSize: 12, fontFamily: 'system-ui' }}>
      Loading…
    </div>
  )

  const connected    = Object.entries(keys).filter(([k, v]) => v && k !== 'ollama_model').map(([k]) => k)
  const topTech      = Object.entries(m.technique_counts || {}).sort((a, b) => b[1] - a[1])[0]
  const topTask      = Object.entries(m.task_type_counts || {}).sort((a, b) => b[1] - a[1])[0]
  const recentScore  = m.score_history?.slice(-1)[0]
  const scoreColor   = (s) => s >= 75 ? '#16a34a' : s >= 55 ? '#d97706' : '#dc2626'
  const noActivity   = m.prompts_rewritten === 0

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#fff', width: 340, minHeight: 320 }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg,#534ab7,#7c3aed)', padding: '14px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoAnimation />
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '-.2px' }}>PET Dashboard</div>
            <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 1 }}>
              {keys.ollama_model ? `🦙 ${keys.ollama_model}` : connected.length ? `${connected.join(' · ')} connected` : 'No engine — offline mode'}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 20, color: 'rgba(255,255,255,.25)' }}>v4.0</div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
        {[['stats', '📊 Stats'], ['keys', '⚡ Engines'], ['about', '🌐 Website']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: '9px 0', fontSize: 10, fontWeight: tab === id ? 700 : 400, color: tab === id ? '#534ab7' : '#9ca3af', background: 'none', border: 'none', borderBottom: tab === id ? '2px solid #534ab7' : '2px solid transparent', cursor: 'pointer', transition: 'all .15s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Stats tab ── */}
      {tab === 'stats' && (
        <div style={{ padding: 14 }}>
          {noActivity ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{PET_EMOJI[pet]}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>No activity yet</div>
              <div style={{ fontSize: 11 }}>Go to ChatGPT, Claude or Gemini,<br/>type a prompt and click <b>▶ Rewrite</b></div>
            </div>
          ) : (
            <>
              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                {[
                  { label: 'Prompts Rewritten', value: m.prompts_rewritten, icon: '✏️', color: '#534ab7' },
                  { label: 'Times Injected',    value: m.inject_count || 0,  icon: '↗',  color: '#0891b2' },
                  { label: 'Avg Score',         value: m.avg_score ? `${m.avg_score}%` : '—', icon: '◎', color: scoreColor(m.avg_score) },
                  { label: 'Sessions',          value: m.sessions, icon: '📅', color: '#7c3aed' },
                ].map(({ label, value, icon, color }) => (
                  <div key={label} style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color }}>{icon} {value}</div>
                    <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Tokens saved — wide card */}
              <div style={{ background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, border: '1px solid #ddd6fe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#7c3aed', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>Estimated Tokens Saved</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#534ab7', marginTop: 2 }}>~{m.tokens_saved.toLocaleString()}</div>
                  <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>by front-loading context in rewrites</div>
                </div>
                <div style={{ fontSize: 36 }}>💾</div>
              </div>

              {/* Score history sparkline */}
              {m.score_history?.length > 1 && (
                <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px', marginBottom: 12, border: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>Score History</span>
                    {recentScore != null && <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(recentScore) }}>Latest: {recentScore}%</span>}
                  </div>
                  <ScoreHistory history={m.score_history} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ fontSize: 9, color: '#9ca3af' }}>oldest</span>
                    <span style={{ fontSize: 9, color: '#9ca3af' }}>newest →</span>
                  </div>
                </div>
              )}

              {/* Technique & task badges */}
              {(topTech || topTask) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {topTech && (
                    <div style={{ background: '#f0f0ff', borderRadius: 99, padding: '4px 10px', fontSize: 10, color: '#534ab7', border: '1px solid #c4b5fd' }}>
                      🧠 {topTech[0]} × {topTech[1]}
                    </div>
                  )}
                  {topTask && (
                    <div style={{ background: '#f0fdf4', borderRadius: 99, padding: '4px 10px', fontSize: 10, color: '#166534', border: '1px solid #bbf7d0' }}>
                      📌 {topTask[0]}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Engines tab ── */}
      {tab === 'keys' && (
        <div style={{ padding: 14, maxHeight: 380, overflowY: 'auto' }}>

          {/* Priority indicator */}
          <div style={{ fontSize: 10, background: '#f9fafb', borderRadius: 8, padding: '7px 10px', marginBottom: 12, lineHeight: 1.8, color: '#6b7280' }}>
            <b style={{ color: '#374151' }}>Engine priority</b><br />
            {keys.ollama_model ? '🟢' : '⚪'} 1. Ollama — local, free, private<br />
            {keys.groq ? '🟢' : '⚪'} 2. Groq — cloud, free tier<br />
            ⚪ 3. Offline templates — always available
          </div>

          {/* Ollama section */}
          <div style={{ marginBottom: 14, padding: 10, background: keys.ollama_model ? '#f0fdf4' : '#f9fafb', border: `1px solid ${keys.ollama_model ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>🦙 Ollama <span style={{ fontSize: 9, fontWeight: 400, color: '#9ca3af' }}>local · no key needed</span></span>
              {keys.ollama_model && <button onClick={() => saveKey('ollama_model', '')} style={{ fontSize: 9, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>}
            </div>
            {keys.ollama_model ? (
              <div style={{ fontSize: 10, color: '#166534' }}>✓ Active: <b>{keys.ollama_model}</b></div>
            ) : (
              <>
                <button onClick={detectOllama} disabled={detectingOll} style={{ width: '100%', padding: '6px 0', background: '#f0f0ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
                  {detectingOll ? 'Detecting…' : '⟳ Detect Ollama Models'}
                </button>
                {ollamaStatus && <div style={{ fontSize: 10, color: ollamaModels?.length ? '#166534' : '#b45309', marginBottom: 5 }}>{ollamaStatus}</div>}
                {ollamaModels?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {ollamaModels.map(m => (
                      <button key={m.name} onClick={() => selectOllamaModel(m.name)} style={{ padding: '5px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', fontSize: 10, textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <b>{m.name}</b><span style={{ color: '#9ca3af' }}>{m.size}</span>
                      </button>
                    ))}
                  </div>
                )}
                {ollamaModels?.length === 0 && (
                  <div style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1.6 }}>
                    brew install ollama → ollama pull llama3.2 → ollama serve
                  </div>
                )}
              </>
            )}
          </div>

          {/* Cloud keys */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.4px' }}>Cloud Keys</div>
          <KeyRow provider="groq"     label="Groq (Free — llama-3.3-70b)" value={keys.groq}     onSave={saveKey} />
          <KeyRow provider="openai"   label="OpenAI"                       value={keys.openai}   onSave={saveKey} />
          <KeyRow provider="deepseek" label="DeepSeek"                     value={keys.deepseek} onSave={saveKey} />

          <div style={{ marginTop: 10, fontSize: 10, color: '#9ca3af', lineHeight: 1.5 }}>
            Keys stored locally in your browser only — never shared.
          </div>

          {/* Supported platforms */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>Works on</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Perplexity'].map(p => (
                <div key={p} style={{ fontSize: 10, padding: '3px 9px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 99, color: '#374151' }}>{p}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Website tab ── */}
      {tab === 'about' && (
        <div style={{ padding: 14 }}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 4 }}>PET — Prompt Enhancement Tool</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>v4.0 · Your AI prompt co-pilot</div>
          </div>

          {/* Website links */}
          {[
            { label: '🏠 Home Page', sub: 'About PET, features, install guide', url: WEBSITE },
            { label: '📊 Dashboard', sub: 'Full insights — GPT, Claude, Gemini', url: WEBSITE + 'dashboard.html' },
          ].map(({ label, sub, url }) => (
            <button
              key={url}
              onClick={() => chrome.tabs.create({ url })}
              style={{ width: '100%', padding: '10px 12px', marginBottom: 8, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{label}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{sub}</div>
              </div>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>↗</span>
            </button>
          ))}

          {/* Note about data */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 10, fontSize: 10, color: '#1e40af', lineHeight: 1.6, marginTop: 4 }}>
            <b>Your activity data</b> lives in this popup (Stats tab) — stored privately in your browser. The website shows a demo dashboard; your real data is always here.
          </div>

          {/* Coming soon */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>Coming Soon</div>
            {['Token usage tracker', 'Auto form-fill agent', 'What you learned + what to learn next', 'Claude Code terminal agent'].map(f => (
              <div key={f} style={{ fontSize: 10, color: '#6b7280', padding: '4px 0', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 6 }}>
                <span style={{ color: '#c4b5fd' }}>◈</span> {f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => chrome.tabs.create({ url: WEBSITE })}
          style={{ fontSize: 9, padding: '2px 7px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, color: '#534ab7', cursor: 'pointer' }}
        >🌐 petchain.ai</button>
        <button
          onClick={() => chrome.storage.local.remove('pet_metrics_v1', () => getMetrics().then(setM))}
          style={{ fontSize: 9, padding: '2px 7px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, color: '#9ca3af', cursor: 'pointer' }}
          title="Reset all stats"
        >Reset stats</button>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Dashboard />)
