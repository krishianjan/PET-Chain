import { useEffect, useRef, useState } from 'react'
import SpritePlayer, { SPRITE_CONFIG } from './SpritePlayer'

// ── CSS animations driven by data-state on the wrapper ────────────────────
const CSS = `
@keyframes _pet_bob  {0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-10px) scale(1.04)}}
@keyframes _pet_walk {0%,100%{transform:translateX(0) rotate(0deg)}25%{transform:translateX(-7px) rotate(-4deg)}75%{transform:translateX(7px) rotate(4deg)}}
@keyframes _pet_head {0%,100%{transform:scale(1) rotate(0deg)}33%{transform:scale(1.25) rotate(-10deg)}66%{transform:scale(1.25) rotate(10deg)}}
@keyframes _pet_spin {0%{transform:rotate(0deg) scale(1)}40%{transform:rotate(180deg) scale(.88)}70%{transform:rotate(340deg) scale(.95)}100%{transform:rotate(360deg) scale(1)}}
@keyframes _pet_jump {0%,100%{transform:translateY(0) scale(1,1)}20%{transform:translateY(4px) scale(1.1,.92)}40%{transform:translateY(-18px) scale(.95,1.1)}65%{transform:translateY(-5px) scale(1,1)}80%{transform:translateY(2px) scale(1.05,.96)}}
@keyframes _pet_err  {0%,100%{transform:translateX(0) rotate(0)}15%,55%{transform:translateX(-9px) rotate(-5deg)}35%,75%{transform:translateX(9px) rotate(5deg)}}
@keyframes _pet_fade {0%,100%{opacity:1;transform:scale(1)}40%,60%{opacity:.35;transform:scale(.96)}}
@keyframes _pet_float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.02)}}
@keyframes _pet_tilt {0%,100%{transform:rotate(-8deg) scale(1)}50%{transform:rotate(8deg) scale(1.05)}}

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

/* ── Bird: visual differentiation per state via CSS speed ── */
[data-lp][data-pet=bird][data-state=idle]        .pet-lottie{animation:_pet_float 3s ease-in-out infinite}
[data-lp][data-pet=bird][data-state=thinking]    .pet-lottie{animation:_pet_tilt  .6s ease-in-out infinite}
[data-lp][data-pet=bird][data-state=analyzing]   .pet-lottie{animation:_pet_spin  2.5s linear infinite}
[data-lp][data-pet=bird][data-state=happy]       .pet-lottie{animation:_pet_bob   .9s ease-in-out infinite;filter:drop-shadow(0 0 8px rgba(250,204,21,.7))}
[data-lp][data-pet=bird][data-state=celebrating] .pet-lottie{animation:_pet_jump  .5s ease 8;filter:drop-shadow(0 0 12px rgba(74,222,128,.7))}
[data-lp][data-pet=bird][data-state=playing]     .pet-lottie{animation:_pet_walk  .55s ease-in-out infinite}
[data-lp][data-pet=bird][data-state=sleeping]    .pet-lottie{opacity:.45;filter:brightness(.6)}
[data-lp][data-pet=bird][data-state=error]       .pet-lottie{animation:_pet_err   .4s ease 5;filter:drop-shadow(0 0 8px rgba(248,113,113,.7))}
`

const PET_EMOJI = { dog: '🐕', cat: '🐈', bird: '🦜', rabbit: '🐇', human: '🧑' }

// Pets that use CSS spritesheets instead of Lottie
const SPRITE_PETS = new Set(Object.keys(SPRITE_CONFIG))

let cssInjected = false
function injectCSS() {
  if (cssInjected || typeof document === 'undefined') return
  document.getElementById('_pet_lp_css')?.remove()
  const s = document.createElement('style')
  s.id = '_pet_lp_css'
  s.textContent = CSS
  document.head?.appendChild(s)
  cssInjected = true
}

export default function LottiePlayer({ controllerRef, petType }) {
  const lottieRef  = useRef(null)
  const wrapperRef = useRef(null)

  // Start as null (unknown) so we can show emoji immediately, then hide once Lottie confirms
  const [lottieState, setLottieState] = useState('pending') // 'pending' | 'ok' | 'failed'
  const [animState,   setAnimState]   = useState('idle')

  const isSpritePet = SPRITE_PETS.has(petType)

  // Inject CSS once globally
  useEffect(() => { injectCSS() }, [])

  // Wire up controller when pet type changes
  useEffect(() => {
    const ctrl = controllerRef?.current
    if (!ctrl || !wrapperRef.current) return

    // Reset so emoji shows immediately for new pet while Lottie loads
    setLottieState('pending')

    ctrl.onLottieReady = (ok) => setLottieState(ok ? 'ok' : 'failed')
    ctrl.onStateChange = (state) => setAnimState(state)

    if (isSpritePet) {
      ctrl.init(null, wrapperRef.current, petType).catch(() => {})
    } else {
      // lottieRef might not be set yet on first render — retry via rAF
      const tryInit = () => {
        if (lottieRef.current) {
          ctrl.init(lottieRef.current, wrapperRef.current, petType || 'dog').catch(() => {
            setLottieState('failed')
          })
        } else {
          // Ref not attached yet — wait one frame
          requestAnimationFrame(tryInit)
        }
      }
      tryInit()
    }

    return () => {
      ctrl.onLottieReady = null
      ctrl.onStateChange = null
      ctrl.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petType])

  // Emoji is shown when: sprite pet has no sprite, OR lottie hasn't loaded yet / failed
  // For sprite pets, SpritePlayer handles rendering; emoji is purely the non-sprite fallback
  const showEmoji = !isSpritePet && lottieState !== 'ok'
  // Lottie canvas visible only once confirmed loaded (avoids blank canvas flash)
  const lottiVisible = !isSpritePet && lottieState === 'ok'

  return (
    <div
      ref={wrapperRef}
      data-lp="1"
      data-state="idle"
      data-pet={petType}
      style={{ width: 80, height: 80, position: 'relative', userSelect: 'none', overflow: 'hidden', contain: 'layout' }}
    >
      {/* Sprite renderer for rabbit/human */}
      {isSpritePet && (
        <SpritePlayer petType={petType} animState={animState} />
      )}

      {/* Lottie canvas — always mounted for non-sprite pets so ref attaches */}
      {!isSpritePet && (
        <div
          ref={lottieRef}
          className="pet-lottie"
          style={{
            width: '100%', height: '100%',
            position: 'absolute', inset: 0,
            // Invisible until Lottie confirms it loaded — prevents blank canvas over emoji
            opacity: lottiVisible ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        />
      )}

      {/* Emoji fallback — shows immediately until Lottie loads; stays if Lottie fails */}
      {showEmoji && (
        <div
          className="pet-emoji"
          style={{
            position:       'absolute',
            inset:          0,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       44,
            lineHeight:     1,
            pointerEvents:  'none',
            // Always visible when mounted — showEmoji is only true for 'pending' and 'failed'
            opacity:        1,
            transition:     'opacity 0.3s ease',
          }}
        >
          {PET_EMOJI[petType] || '🐕'}
        </div>
      )}
    </div>
  )
}
