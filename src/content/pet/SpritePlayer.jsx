import { useEffect, useRef, useState } from 'react'

// ── Sprite animation config ───────────────────────────────────────────────
// Each pet maps states to { file, row, frames }
// frameW/frameH = single frame size in the spritesheet
// cols = frames per row, fps = playback speed
//
// Rabbit (Pebbit): all states live in ONE spritesheet as separate rows
// Human (Gopal):   each state uses a SEPARATE numbered spritesheet (row 0)
//
// Adjust row indices here after testing if frames don't match visually.

export const SPRITE_CONFIG = {
  rabbit: {
    frameW: 256, frameH: 312, cols: 6, fps: 8,
    states: {
      idle:        { file: 'spritesheet.webp',   row: 0, frames: 6 },
      thinking:    { file: 'spritesheet.webp',   row: 1, frames: 6 },
      analyzing:   { file: 'spritesheet.webp',   row: 3, frames: 6 },
      happy:       { file: 'spritesheet.webp',   row: 2, frames: 6 },
      celebrating: { file: 'spritesheet1.webp',  row: 0, frames: 6 }, // waving hi
      playing:     { file: 'spritesheet.webp',   row: 2, frames: 6 },
      loading:     { file: 'spritesheet.webp',   row: 1, frames: 6 },
      sleeping:    { file: 'spritesheet.webp',   row: 3, frames: 6 }, // waiting = sleep
      error:       { file: 'spritesheet.webp',   row: 5, frames: 6 }, // failed
    },
  },
  human: {
    frameW: 256, frameH: 312, cols: 6, fps: 8,
    // Each state = separate spritesheet (row 0 of each)
    states: {
      idle:        { file: 'spritesheet2.webp',  row: 0, frames: 6 }, // humanchar
      thinking:    { file: 'spritesheet3.webp',  row: 0, frames: 6 }, // humanrunning
      analyzing:   { file: 'spritesheet6.webp',  row: 0, frames: 6 }, // humanreview
      happy:       { file: 'spritesheet4.webp',  row: 0, frames: 6 }, // humanjumping
      celebrating: { file: 'spritesheet8.webp',  row: 0, frames: 6 }, // humanwaving
      playing:     { file: 'spritesheet4.webp',  row: 0, frames: 6 }, // humanjumping
      loading:     { file: 'spritesheet3.webp',  row: 0, frames: 6 }, // humanrunning
      sleeping:    { file: 'spritesheet5.webp',  row: 0, frames: 6 }, // humanwaiitng
      error:       { file: 'spritesheet7.webp',  row: 0, frames: 6 }, // humanfailed
    },
  },
}

// ── Component ─────────────────────────────────────────────────────────────
export default function SpritePlayer({ petType, animState }) {
  const cfg     = SPRITE_CONFIG[petType]
  const stateCfg = cfg?.states[animState] ?? cfg?.states.idle
  const frameRef = useRef(0)
  const [frame, setFrame] = useState(0)

  // Resolve URL — chrome.runtime.getURL works in content scripts
  const sheetFile = stateCfg?.file || 'spritesheet.webp'
  const sheetURL  = typeof chrome !== 'undefined'
    ? chrome.runtime.getURL('assets/lottie/' + encodeURIComponent(sheetFile).replace(/%20/g, '%20'))
    : sheetFile

  useEffect(() => {
    frameRef.current = 0
    setFrame(0)
    if (!cfg || !stateCfg) return
    const id = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % (stateCfg.frames ?? cfg.cols)
      setFrame(frameRef.current)
    }, 1000 / (cfg.fps || 8))
    return () => clearInterval(id)
  }, [petType, animState, stateCfg?.file, stateCfg?.row])

  if (!cfg || !stateCfg) return null

  const { frameW, frameH, cols } = cfg
  const { row = 0 }              = stateCfg

  // Scale so the sprite fits neatly in the 80×80 pet container
  const scale  = Math.min(80 / frameW, 80 / frameH)
  const scaledW = Math.round(frameW * scale)
  const scaledH = Math.round(frameH * scale)
  const offsetX = Math.round((80 - scaledW) / 2)
  const offsetY = Math.round((80 - scaledH) / 2)

  // CSS background-position to show the correct frame
  const bgX = -Math.round(frame * frameW * scale)
  const bgY = -Math.round(row   * frameH * scale)

  return (
    <div style={{
      position:         'absolute',
      left:             offsetX,
      top:              offsetY,
      width:            scaledW,
      height:           scaledH,
      backgroundImage:  `url("${sheetURL}")`,
      backgroundRepeat: 'no-repeat',
      backgroundSize:   `${Math.round(cols * frameW * scale)}px auto`,
      backgroundPosition:`${bgX}px ${bgY}px`,
      imageRendering:   'pixelated',
    }} />
  )
}
