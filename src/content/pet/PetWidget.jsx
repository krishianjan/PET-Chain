import { useRef, useState, useEffect } from 'react'
import LottiePlayer      from './LottiePlayer'
import Sidebar           from './Sidebar'
import { PetController } from './petController'
import { detectPlatform }  from '../detectors/platform'
import { setQ, evaluate }  from '../../engines/api'
import selectorsConfig     from '../../../selectors.config.json'

const platform = detectPlatform()
const S = { CLOSED: 'c', MINI: 'm', OPEN: 'o' }

// Pets available for selection — add new pets here when files are ready
const PETS = [
  { id: 'dog',    emoji: '🐕', label: 'Dog'    },
  { id: 'cat',    emoji: '🐈', label: 'Cat'    },
  { id: 'bird',   emoji: '🦜', label: 'Bird'   },
  { id: 'rabbit', emoji: '🐇', label: 'Rabbit' },
  { id: 'human',  emoji: '🧑', label: 'Gopal'  },
]
const PET_EMOJI = Object.fromEntries(PETS.map(p => [p.id, p.emoji]))

export default function PetWidget() {
  const ctrl   = useRef(new PetController())
  const [panel, setPanel] = useState(S.CLOSED)
  const [ptype, setPtype] = useState('dog')
  const [keys,  setKeys]  = useState({})
  const [next,  setNext]  = useState(null)
  const [ready, setReady] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  const posRef   = useRef({ x: window.innerWidth - 96, y: window.innerHeight - 110 })
  const [pos, setPos]   = useState(posRef.current)
  const drag            = useRef({ on: false, moved: false, ox: 0, oy: 0 })
  const clickCount      = useRef(0)
  // Click reaction cycle — different state per tap
  const CLICK_STATES    = ['happy', 'celebrating', 'playing', 'thinking', 'happy', 'analyzing']

  // ── Load saved prefs ────────────────────────────────────────────────────
  useEffect(() => {
    chrome.storage.local.get(['pet_type','pet_pos','pet_key_groq','pet_key_openai','pet_key_deepseek'], r => {
      const t = r.pet_type || 'dog'
      const p = r.pet_pos  || posRef.current
      setPtype(t)
      posRef.current = p
      setPos(p)
      setKeys({ groq: r.pet_key_groq, openai: r.pet_key_openai, deepseek: r.pet_key_deepseek })
      setReady(true)
      if (!r.pet_type) setPanel(S.OPEN)   // first launch → open sidebar
    })
  }, [])

  // ── Auto-evaluate when LLM response changes ────────────────────────────
  useEffect(() => {
    if (!platform) return
    const sel = selectorsConfig.platforms[platform]
    if (!sel?.response) return

    let deb = null, lastLen = 0

    const obs = new MutationObserver(() => {
      const els = document.querySelectorAll(sel.response)
      const el  = els.length ? els[els.length - 1] : null
      if (!el) return
      const len = el.textContent.length
      if (len === lastLen || len < 40) return
      lastLen = len
      clearTimeout(deb)
      deb = setTimeout(async () => {
        // Capture original prompt from textarea for scoring context
        const txEl  = sel.textarea ? document.querySelector(sel.textarea) : null
        const prompt = txEl ? (txEl.value || txEl.textContent || '').trim() : ''
        if (prompt) setQ(prompt)

        const key = keys.groq || keys.openai || keys.deepseek
        const r   = await evaluate(el.textContent, key)
        if (r?.score != null) {
          setNext(r)
          ctrl.current?.setState(r.score >= 75 ? 'celebrating' : 'playing')
        }
      }, 2200)   // wait for response to stabilise
    })

    obs.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { obs.disconnect(); clearTimeout(deb) }
  }, [keys])

  // ── Drag handling ───────────────────────────────────────────────────────
  useEffect(() => {
    let walkDebounce = null
    const mv = (e) => {
      if (!drag.current.on) return
      drag.current.moved = true
      const np = {
        x: Math.max(0, Math.min(window.innerWidth  - 80, e.clientX - drag.current.ox)),
        y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - drag.current.oy)),
      }
      posRef.current = np
      setPos({ ...np })
      // Walk while being dragged — debounce so it doesn't spam state changes
      clearTimeout(walkDebounce)
      walkDebounce = setTimeout(() => {
        if (drag.current.on) ctrl.current?.setState('thinking')  // walking anim
      }, 60)
    }
    const up = () => {
      if (!drag.current.on) return
      clearTimeout(walkDebounce)
      drag.current.on = false
      if (drag.current.moved) {
        chrome.storage.local.set({ pet_pos: posRef.current })
        ctrl.current?.setState('happy')   // arrive with happy bounce
      } else {
        // Tap — cycle through different reactions then open/close panel
        const state = CLICK_STATES[clickCount.current % CLICK_STATES.length]
        clickCount.current += 1
        ctrl.current?.setState(state)
        setPanel(p => p === S.CLOSED ? S.OPEN : p === S.OPEN ? S.MINI : S.OPEN)
      }
    }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup',   up)
    return () => {
      clearTimeout(walkDebounce)
      window.removeEventListener('mousemove', mv)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // ── Pet switcher ─────────────────────────────────────────────────────────
  function selectPet(t) {
    chrome.storage.local.set({ pet_type: t })
    setPtype(t)
    ctrl.current?.setPetType(t)
    setShowPicker(false)
  }

  if (!ready) return null

  return (
    <>
      {/* ── Pet icon (draggable) ── */}
      <div
        onMouseDown={e => {
          drag.current = { on: true, moved: false, ox: e.clientX - posRef.current.x, oy: e.clientY - posRef.current.y }
          e.preventDefault()
        }}
        style={{
          position: 'fixed', left: pos.x, top: pos.y,
          width: 80, height: 80,
          zIndex: 2147483647,
          cursor: drag.current.on ? 'grabbing' : 'grab',
          pointerEvents: 'auto', userSelect: 'none',
          filter: 'drop-shadow(0 4px 20px rgba(0,0,0,.22))',
          transition: drag.current.on ? 'none' : 'filter 0.25s ease',
          willChange: 'left, top',
          borderRadius: '50%',
        }}
      >
        <LottiePlayer controllerRef={ctrl} petType={ptype} />
      </div>

      {/* ── Pet switcher button (top-left of pet) ── */}
      <div
        onClick={e => { e.stopPropagation(); setShowPicker(v => !v) }}
        style={{
          position: 'fixed',
          left: pos.x - 2,
          top:  pos.y - 2,
          width: 18, height: 18,
          zIndex: 2147483647,
          background: '#534ab7',
          borderRadius: '50%',
          cursor: 'pointer',
          pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: '#fff', fontWeight: 700,
          boxShadow: '0 2px 6px rgba(83,74,183,.4)',
          userSelect: 'none',
        }}
        title="Switch pet"
      >✦</div>

      {/* ── Pet picker popup ── */}
      {showPicker && (
        <div style={{
          position: 'fixed',
          left: Math.max(8, Math.min(window.innerWidth - 160, pos.x - 40)),
          top:  pos.y - 70,
          zIndex: 2147483647,
          background: 'rgba(255,255,255,.97)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(83,74,183,.2)',
          borderRadius: 12,
          padding: '8px 10px',
          display: 'flex', gap: 8,
          boxShadow: '0 8px 24px rgba(83,74,183,.18)',
          pointerEvents: 'auto',
          userSelect: 'none',
        }}>
          {PETS.map(p => (
            <div
              key={p.id}
              onClick={() => selectPet(p.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '4px 8px', borderRadius: 8, cursor: 'pointer',
                background: ptype === p.id ? '#f0f0ff' : 'transparent',
                border: ptype === p.id ? '1.5px solid #c4b5fd' : '1.5px solid transparent',
              }}
            >
              <span style={{ fontSize: 22 }}>{p.emoji}</span>
              <span style={{ fontSize: 8, color: '#6b7280', fontFamily: 'system-ui' }}>{p.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Mini bar ── */}
      {panel === S.MINI && (
        <div style={{
          position: 'fixed', bottom: 0, right: 92,
          zIndex: 2147483646, pointerEvents: 'auto',
          background: '#534ab7', borderRadius: '10px 10px 0 0',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 12px', height: 36,
          boxShadow: '0 -2px 10px rgba(83,74,183,.3)',
          userSelect: 'none', fontFamily: 'system-ui,sans-serif',
        }}>
          <span>{PET_EMOJI[ptype]}</span>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>PET</span>
          {next && (
            <span style={{ background: 'rgba(255,255,255,.2)', color: '#fff', borderRadius: 99, padding: '1px 7px', fontSize: 10 }}>
              {next.score}%
            </span>
          )}
          <button onClick={() => setPanel(S.OPEN)}   style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', marginLeft: 8 }}>▲</button>
          <button onClick={() => setPanel(S.CLOSED)} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: 4, width: 22, height: 22, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* ── Full sidebar ── */}
      {panel === S.OPEN && (
        <div style={{ pointerEvents: 'auto' }}>
          <Sidebar
            onClose={()    => setPanel(S.CLOSED)}
            onMinimize={()  => setPanel(S.MINI)}
            petCtrl={ctrl.current}
            platform={platform}
            petType={ptype}
            keys={keys}
            setKeys={setKeys}
            nextStep={next}
            clearNext={() => setNext(null)}
            onPetSelect={selectPet}
          />
        </div>
      )}

      {/* ── Floating next-step card (when sidebar closed) ── */}
      {next && panel === S.CLOSED && (
        <div style={{
          position: 'fixed',
          left: Math.max(8, Math.min(window.innerWidth - 360, pos.x - 140)),
          top:  Math.max(8, pos.y - 210),
          width: 340, zIndex: 2147483646, pointerEvents: 'auto',
          background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(83,74,183,.3)', borderRadius: 14,
          padding: '12px 14px', boxShadow: '0 8px 32px rgba(83,74,183,.2)',
          fontFamily: 'system-ui,sans-serif',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#534ab7' }}>{PET_EMOJI[ptype]} Next Step</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: next.score >= 70 ? '#16a34a' : '#d97706' }}>{next.score}%</span>
          </div>
          <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.6, marginBottom: 9, maxHeight: 80, overflowY: 'auto' }}>
            {next.next_prompt}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { setPanel(S.OPEN); ctrl.current?.setState('playing') }}
              style={{ flex: 1, padding: '6px 0', background: '#f0f0ff', color: '#534ab7', border: '1px solid #c4b5fd', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >Open PET</button>
            <button
              onClick={() => setNext(null)}
              style={{ padding: '6px 10px', background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 11 }}
            >✕</button>
          </div>
        </div>
      )}
    </>
  )
}
