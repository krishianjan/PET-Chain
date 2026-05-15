import { useEffect, useRef, useState } from 'react'
import SpritePlayer, { SPRITE_CONFIG } from './SpritePlayer'

// ── CSS animations driven by data-state on the wrapper ────────────────────
// These fire only when Lottie fails (emoji fallback mode)
const CSS = `
@keyframes _pet_bob  {0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-10px) scale(1.04)}}
@keyframes _pet_walk {0%,100%{transform:translateX(0) rotate(0deg)}25%{transform:translateX(-7px) rotate(-4deg)}75%{transform:translateX(7px) rotate(4deg)}}
@keyframes _pet_head {0%,100%{transform:scale(1) rotate(0deg)}33%{transform:scale(1.25) rotate(-10deg)}66%{transform:scale(1.25) rotate(10deg)}}
@keyframes _pet_spin {0%{transform:rotate(0deg) scale(1)}40%{transform:rotate(180deg) scale(.88)}70%{transform:rotate(340deg) scale(.95)}100%{transform:rotate(360deg) scale(1)}}
@keyframes _pet_jump {0%,100%{transform:translateY(0) scale(1,1)}20%{transform:translateY(4px) scale(1.1,.92)}40%{transform:translateY(-18px) scale(.95,1.1)}65%{transform:translateY(-5px) scale(1,1)}80%{transform:translateY(2px) scale(1.05,.96)}}
@keyframes _pet_err  {0%,100%{transform:translateX(0) rotate(0)}15%,55%{transform:translateX(-9px) rotate(-5deg)}35%,75%{transform:translateX(9px) rotate(5deg)}}
@keyframes _pet_fade {0%,100%{opacity:1;transform:scale(1)}40%,60%{opacity:.35;transform:scale(.96)}}
@keyframes _pet_float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.02)}}

[data-lp] .pet-emoji { transition: filter .3s ease; }
[data-lp][data-state=idle]         .pet-emoji{animation:_pet_float 2.6s cubic-bezier(.45,.05,.55,.95) infinite}
[data-lp][data-state=playing]      .pet-emoji{animation:_pet_bob   1.3s cubic-bezier(.36,.07,.19,.97) infinite}
[data-lp][data-state=sleeping]     .pet-emoji{animation:_pet_fade  3.2s ease-in-out infinite}
[data-lp][data-state=loading]      .pet-emoji{animation:_pet_bob   1.7s ease-in-out infinite}
[data-lp][data-state=thinking]     .pet-emoji{animation:_pet_walk   .75s ease-in-out infinite}
[data-lp][data-state=analyzing]    .pet-emoji{animation:_pet_spin  2.1s cubic-bezier(.4,0,.6,1) infinite}
[data-lp][data-state=happy]        .pet-emoji{animation:_pet_head   .42s cubic-bezier(.36,.07,.19,.97) 6;filter:drop-shadow(0 0 8px rgba(250,204,21,.7))}
[data-lp][data-state=celebrating]  .pet-emoji{animation:_pet_jump   .52s cubic-bezier(.36,.07,.19,.97) 8;filter:drop-shadow(0 0 12px rgba(74,222,128,.7))}
[data-lp][data-state=error]        .pet-emoji{animation:_pet_err    .35s cubic-bezier(.36,.07,.19,.97) 5;filter:drop-shadow(0 0 8px rgba(248,113,113,.7))}
`

const PET_EMOJI = { dog: '🐕', cat: '🐈', bird: '🦜', rabbit: '🐇', human: '🧑' }

// Pets that use CSS spritesheets instead of Lottie
const SPRITE_PETS = new Set(Object.keys(SPRITE_CONFIG))

let cssInjected = false
function injectCSS() {
  if (cssInjected || typeof document === 'undefined') return
  // Remove old style if present (hot reload / re-mount)
  document.getElementById('_pet_lp_css')?.remove()
  const s = document.createElement('style')
  s.id = '_pet_lp_css'
  s.textContent = CSS
  document.head?.appendChild(s)
  cssInjected = true
}

export default function LottiePlayer({ controllerRef, petType }) {
  const lottieRef  = useRef(null)   // inner div — Lottie renders into this
  const wrapperRef = useRef(null)   // outer div — holds data-state for CSS

  // true once Lottie/sprite successfully renders
  const [hasLottie, setHasLottie] = useState(false)
  // current animation state (for sprite pets)
  const [animState, setAnimState] = useState('idle')

  const isSpritePet = SPRITE_PETS.has(petType)

  // Inject CSS once globally
  useEffect(() => { injectCSS() }, [])

  // Wire up controller when pet type changes
  useEffect(() => {
    const ctrl = controllerRef?.current
    if (!ctrl || !wrapperRef.current) return

    // Subscribe to lottie-ready and state-change callbacks
    ctrl.onLottieReady = (ok) => setHasLottie(ok)
    ctrl.onStateChange = (state) => setAnimState(state)

    if (isSpritePet) {
      // Sprite pets: skip Lottie entirely, signal ready immediately
      ctrl.init(null, wrapperRef.current, petType).catch(() => {})
    } else {
      if (!lottieRef.current) return
      ctrl.init(lottieRef.current, wrapperRef.current, petType || 'dog').catch(() => {})
    }

    return () => {
      ctrl.onLottieReady = null
      ctrl.onStateChange = null
      ctrl.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petType])

  return (
    <div
      ref={wrapperRef}
      data-lp="1"
      data-state="idle"
      data-pet={petType}
      style={{ width: 80, height: 80, position: 'relative', userSelect: 'none', overflow: 'hidden', contain: 'layout' }}
    >
      {/* Sprite renderer for rabbit/human — shown instead of Lottie */}
      {isSpritePet && (
        <SpritePlayer petType={petType} animState={animState} />
      )}

      {/* Lottie canvas — only mounted for non-sprite pets */}
      {!isSpritePet && (
        <div
          ref={lottieRef}
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
        />
      )}

      {/* Emoji fallback — visible when no Lottie AND no sprite */}
      {!isSpritePet && (
        <div
          className="pet-emoji"
          style={{
            position:       'absolute',
            inset:          0,
            display:        hasLottie ? 'none' : 'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       44,
            lineHeight:     1,
            pointerEvents:  'none',
          }}
        >
          {PET_EMOJI[petType] || '🐕'}
        </div>
      )}
    </div>
  )
}
