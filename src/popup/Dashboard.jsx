import { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { getMetrics } from '../engines/metrics_store'
import { getProviderList, getModelsForProvider } from '../engines/providerRegistry.js'
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

const TIER_BADGE = {
  fast:  { label: '⚡ Fast',   bg: '#fef9c3', color: '#854d0e', border: '#fde68a' },
  smart: { label: '🧠 Smart',  bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
}

function ModelDropdown({ provider, pData, selectedModel, onSelectModel }) {
  const [open, setOpen] = useState(false)
  const models = pData.models || []
  if (!models.length) return null
  const current = models.find(m => m.id === selectedModel) || models[0]
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 9, padding: '2px 7px', border: '1px solid #e5e7eb', borderRadius: 5, background: '#f9fafb', color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{current?.label || selectedModel || 'Select model'}</span>
        <span style={{ color: '#9ca3af' }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', minWidth: 220, marginTop: 3 }}>
          {models.map(m => {
            const tier = TIER_BADGE[m.tier] || TIER_BADGE.smart
            return (
              <button key={m.id} onClick={() => { onSelectModel(provider, m.id); setOpen(false) }}
                style={{ width: '100%', textAlign: 'left', padding: '7px 10px', background: selectedModel === m.id ? '#f5f3ff' : '#fff', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#374151' }}>{m.label}</span>
                  <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 99, background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}>{tier.label}</span>
                </div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span style={{ fontSize: 8, color: '#9ca3af' }}>{m.note}</span>
                  {m.ctx && <span style={{ fontSize: 8, color: '#d1d5db' }}>·</span>}
                  {m.ctx && <span style={{ fontSize: 8, color: '#9ca3af' }}>{m.ctx >= 1000000 ? `${(m.ctx/1000000).toFixed(1)}M` : `${Math.round(m.ctx/1000)}K`} ctx</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function KeyRow({ provider, pData, value, onSave, onSetActive, isActive, selectedModel, onSelectModel }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')

  if (editing) {
    return (
      <div style={{ padding: '8px 10px', background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#534ab7', marginBottom: 4 }}>{pData.name} Key</div>
        <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 6 }}>{pData.keyHint} <a href={pData.keyLink} target="_blank" style={{ color: '#7c3aed' }}>Get key ↗</a></div>
        <div style={{ display: 'flex', gap: 5 }}>
          <input autoFocus type="password" value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={pData.keyPlaceholder || 'Paste key…'}
            style={{ flex: 1, fontSize: 11, padding: '5px 8px', border: '1px solid #c4b5fd', borderRadius: 6, outline: 'none' }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onSave(provider, draft.trim()); setEditing(false) }
              if (e.key === 'Escape') setEditing(false)
            }} />
          <button onClick={() => { onSave(provider, draft.trim()); setEditing(false) }}
            style={{ fontSize: 10, padding: '5px 10px', background: '#534ab7', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Save</button>
          <button onClick={() => setEditing(false)}
            style={{ fontSize: 10, padding: '5px 8px', background: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>✕</button>
        </div>
      </div>
    )
  }

  const models = pData.models || []
  const curModel = models.find(m => m.id === selectedModel) || models[0]
  const tierBadge = curModel ? (TIER_BADGE[curModel.tier] || TIER_BADGE.smart) : null

  return (
    <div style={{ padding: '8px 10px', background: isActive ? '#f0fdf4' : '#fff', border: `1px solid ${isActive ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>{pData.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{pData.name}</span>
          {value && <span style={{ fontSize: 9, background: '#dcfce7', color: '#166534', borderRadius: 99, padding: '1px 5px', border: '1px solid #86efac' }}>Connected</span>}
          {pData.free_tier && !value && <span style={{ fontSize: 8, color: '#059669', background: '#d1fae5', borderRadius: 99, padding: '1px 4px', border: '1px solid #a7f3d0' }}>Free tier</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {value && !isActive && (
            <button onClick={() => onSetActive(provider)} style={{ fontSize: 9, padding: '2px 8px', background: '#534ab7', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}>Set Active</button>
          )}
          {isActive && (
            <span style={{ fontSize: 9, padding: '2px 8px', background: '#16a34a', color: '#fff', borderRadius: 5, fontWeight: 600 }}>Active ✓</span>
          )}
          <button onClick={() => { setDraft(''); setEditing(true) }}
            style={{ fontSize: 9, padding: '2px 6px', border: '1px solid #e5e7eb', borderRadius: 5, background: '#f9fafb', color: '#6b7280', cursor: 'pointer' }}>
            {value ? '✎' : '+ Add'}
          </button>
        </div>
      </div>
      {/* Model selector row — only show when key is connected */}
      {value && models.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {tierBadge && (
              <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 99, background: tierBadge.bg, color: tierBadge.color, border: `1px solid ${tierBadge.border}` }}>
                {tierBadge.label}
              </span>
            )}
            {curModel && (
              <span style={{ fontSize: 9, color: '#6b7280' }}>{curModel.note}</span>
            )}
          </div>
          <ModelDropdown
            provider={provider}
            pData={pData}
            selectedModel={selectedModel || pData.default_smart}
            onSelectModel={onSelectModel}
          />
        </div>
      )}
    </div>
  )
}

function Dashboard() {
  const [m,        setM]        = useState(null)
  const [keys,     setKeys]     = useState({})
  const [activeProv, setActiveProv] = useState(null)
  const [pet,      setPet]      = useState('dog')
  const [tab,      setTab]      = useState('stats')
  const [petName,  setPetName]  = useState('')
  const [editName, setEditName] = useState(false)
  const [nameDraft,setNameDraft]= useState('')

  const [ollamaModels,    setOllamaModels]    = useState(null)
  const [ollamaStatus,    setOllamaStatus]    = useState('')
  const [detectingOll,    setDetectingOll]    = useState(false)
  const [selectedModels,  setSelectedModels]  = useState({})

  const providers = getProviderList()

  useEffect(() => {
    getMetrics().then(setM)
    chrome.runtime.sendMessage({ type: 'GET_ALL_KEYS' }).then(k => setKeys(k || {})).catch(() => {})
    chrome.storage.local.get(['pet_type','pet_name', 'pet_active_provider', 'pet_provider_models'], r => {
      setPet(r.pet_type || 'dog')
      if (r.pet_name)             setPetName(r.pet_name)
      if (r.pet_active_provider)  setActiveProv(r.pet_active_provider)
      if (r.pet_provider_models)  setSelectedModels(r.pet_provider_models)
    })
  }, [])

  function savePetName(name) {
    const n = name.trim()
    setPetName(n)
    chrome.storage.local.set({ pet_name: n })
    setEditName(false)
  }

  function saveKey(provider, key) {
    chrome.runtime.sendMessage({ type: 'SET_KEY', provider, key })
    setKeys(k => ({ ...k, [provider]: key || null }))
    if (key && !activeProv) setActive(provider) // Auto-activate if it's the first key
  }

  function setActive(provider) {
    setActiveProv(provider)
    chrome.storage.local.set({ pet_active_provider: provider })
  }

  function selectModel(provider, modelId) {
    const updated = { ...selectedModels, [provider]: modelId }
    setSelectedModels(updated)
    chrome.runtime.sendMessage({ type: 'SET_PROVIDER_MODEL', provider, model: modelId }).catch(() => {})
    chrome.storage.local.set({ pet_provider_models: updated })
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
    setOllamaStatus(`✓ Selected: ${name}`)
    setOllamaModels(null)
    setActive('ollama')
  }

  if (!m) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: '#9ca3af', fontSize: 12, fontFamily: 'system-ui' }}>Loading…</div>
  )

  const hasOllama   = !!keys.ollama_model
  const cloudKeys   = Object.keys(keys).filter(k => k !== 'ollama_model' && keys[k])
  const activeLabel = activeProv ? providers.find(p => p.id === activeProv)?.name : 'Offline mode'
  
  const noActivity  = m.prompts_rewritten === 0
  const topTech     = Object.entries(m.technique_counts || {}).sort((a, b) => b[1] - a[1])[0]
  const sc          = s => s >= 75 ? '#16a34a' : s >= 55 ? '#d97706' : '#dc2626'

  const TABS = [['stats', '📊 Stats'], ['engines', '⚡ Engines'], ['launch', '🚀 Launch']]

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#fff', width: 340 }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#534ab7,#7c3aed)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LogoAnimation />
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>PET v2.0</div>
              <div style={{ color: 'rgba(255,255,255,.8)', fontSize: 10, marginTop: 1, fontWeight: 600 }}>Active: {activeLabel}</div>
            </div>
          </div>
          <button onClick={() => chrome.tabs.create({ url: WEBSITE })}
            style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 5, cursor: 'pointer' }}>
            🌐 Website ↗
          </button>
        </div>
        {/* Pet name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 18 }}>
            {pet === 'dog' ? '🐕' : pet === 'cat' ? '🐈' : pet === 'bird' ? '🦜' : pet === 'rabbit' ? '🐇' : '🧑'}
          </span>
          {editName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePetName(nameDraft); if (e.key === 'Escape') setEditName(false) }}
              onBlur={() => savePetName(nameDraft)}
              placeholder="Name your pet…"
              style={{ fontSize: 13, fontWeight: 700, background: 'rgba(255,255,255,.2)', color: '#fff', border: '1px solid rgba(255,255,255,.5)', borderRadius: 5, padding: '2px 8px', outline: 'none', width: 140 }}
            />
          ) : (
            <span
              onClick={() => { setNameDraft(petName); setEditName(true) }}
              title="Click to name your pet"
              style={{ fontSize: 13, fontWeight: 700, color: petName ? '#fff' : 'rgba(255,255,255,.45)', cursor: 'text', borderBottom: '1px dashed rgba(255,255,255,.4)' }}
            >
              {petName || 'Name your pet…'}
            </span>
          )}
          {petName && <span style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', marginLeft: 2 }}>✎ click to rename</span>}
        </div>
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
          <div style={{ fontSize: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px', marginBottom: 12, color: '#1d4ed8', lineHeight: 1.5 }}>
            <b>Direct Browser Routing</b><br />
            API keys are saved locally and sent straight to the provider. No backend required.
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.4px' }}>Provider Control Panel</div>
          
          {providers.map(p => {
            if (p.id === 'ollama') return null // Handle separately below
            return (
              <KeyRow
                key={p.id}
                provider={p.id}
                pData={p}
                value={keys[p.id]}
                onSave={saveKey}
                onSetActive={setActive}
                isActive={activeProv === p.id}
                selectedModel={selectedModels[p.id] || p.default_smart}
                onSelectModel={selectModel}
              />
            )
          })}

          <div style={{ marginTop: 12, marginBottom: 8, fontSize: 10, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '.4px' }}>Local Models</div>
          
          {/* Ollama */}
          <div style={{ marginBottom: 12, padding: 10, background: (activeProv === 'ollama') ? '#f0fdf4' : '#fff', border: `1px solid ${(activeProv === 'ollama') ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>🦙</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>Ollama</span>
                <span style={{ fontSize: 9, fontWeight: 400, color: '#9ca3af' }}>local · free</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {hasOllama && activeProv !== 'ollama' && <button onClick={() => setActive('ollama')} style={{ fontSize: 9, padding: '2px 8px', background: '#534ab7', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}>Set Active</button>}
                {hasOllama && activeProv === 'ollama' && <span style={{ fontSize: 9, padding: '2px 8px', background: '#16a34a', color: '#fff', borderRadius: 5, fontWeight: 600 }}>Active ✓</span>}
                {hasOllama && <button onClick={() => saveKey('ollama_model', '')} style={{ fontSize: 9, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>}
              </div>
            </div>
            {hasOllama ? (
              <div style={{ fontSize: 10, color: '#166534', marginTop: 6 }}>✓ {keys.ollama_model}</div>
            ) : (
              <>
                <button onClick={detectOllama} disabled={detectingOll}
                  style={{ width: '100%', padding: '6px 0', marginTop: 6, background: '#f0f0ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
                  {detectingOll ? 'Detecting…' : '⟳ Detect Models'}
                </button>
                {ollamaStatus && <div style={{ fontSize: 10, color: ollamaModels?.length ? '#166534' : '#b45309', marginBottom: 4 }}>{ollamaStatus}</div>}
                {ollamaModels?.length > 0 && ollamaModels.map(m => (
                  <button key={m.name} onClick={() => selectOllamaModel(m.name)}
                    style={{ width: '100%', padding: '5px 8px', marginBottom: 3, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', fontSize: 10, textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                    <b>{m.name}</b><span style={{ color: '#9ca3af' }}>{m.size}</span>
                  </button>
                ))}
              </>
            )}
          </div>
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
            <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Coming in v2.1</div>
            {['Auto form-fill agent', 'What you learned today', 'Import API key from env'].map(f => (
              <div key={f} style={{ fontSize: 10, color: '#6b7280', padding: '3px 0', display: 'flex', gap: 6 }}>
                <span style={{ color: '#c4b5fd' }}>◈</span>{f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px solid #f3f4f6', padding: '7px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#9ca3af' }}>PET v2.0 · Universal Engine</span>
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
