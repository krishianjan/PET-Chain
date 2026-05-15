import { useEffect, useRef, useState } from 'react'

// ── Sprite config — rows = total rows in that spritesheet file ────────────────
export const SPRITE_CONFIG = {
  rabbit: {
    frameW: 256, frameH: 312, cols: 6, fps: 8,
    states: {
      idle:        { file: 'spritesheet.webp',  row: 0, frames: 6, rows: 6 },
      thinking:    { file: 'spritesheet.webp',  row: 1, frames: 6, rows: 6 },
      analyzing:   { file: 'spritesheet.webp',  row: 3, frames: 6, rows: 6 },
      happy:       { file: 'spritesheet.webp',  row: 2, frames: 6, rows: 6 },
      celebrating: { file: 'spritesheet1.webp', row: 0, frames: 6, rows: 1 },
      playing:     { file: 'spritesheet.webp',  row: 2, frames: 6, rows: 6 },
      loading:     { file: 'spritesheet.webp',  row: 1, frames: 6, rows: 6 },
      sleeping:    { file: 'spritesheet.webp',  row: 3, frames: 6, rows: 6 },
      error:       { file: 'spritesheet.webp',  row: 5, frames: 6, rows: 6 },
    },
  },
  human: {
    frameW: 256, frameH: 312, cols: 6, fps: 8,
    states: {
      idle:        { file: 'spritesheet2.webp', row: 0, frames: 6, rows: 1 },
      thinking:    { file: 'spritesheet3.webp', row: 0, frames: 6, rows: 1 },
      analyzing:   { file: 'spritesheet6.webp', row: 0, frames: 6, rows: 1 },
      happy:       { file: 'spritesheet4.webp', row: 0, frames: 6, rows: 1 },
      celebrating: { file: 'spritesheet8.webp', row: 0, frames: 6, rows: 1 },
      playing:     { file: 'spritesheet4.webp', row: 0, frames: 6, rows: 1 },
      loading:     { file: 'spritesheet3.webp', row: 0, frames: 6, rows: 1 },
      sleeping:    { file: 'spritesheet5.webp', row: 0, frames: 6, rows: 1 },
      error:       { file: 'spritesheet7.webp', row: 0, frames: 6, rows: 1 },
    },
  },
}

export default function SpritePlayer({ petType, animState }) {
  const cfg      = SPRITE_CONFIG[petType]
  const stateCfg = cfg?.states[animState] ?? cfg?.states.idle
  const frameRef = useRef(0)
  const [frame, setFrame] = useState(0)

  // Resolve URL via chrome extension API
  const sheetFile = stateCfg?.file || 'spritesheet.webp'
  const sheetURL  = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('assets/lottie/' + sheetFile)
    : sheetFile

  useEffect(() => {
    frameRef.current = 0
    setFrame(0)
    if (!cfg || !stateCfg) return
    const totalFrames = stateCfg.frames ?? cfg.cols
    const id = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % totalFrames
      setFrame(frameRef.current)
    }, 1000 / (cfg.fps || 8))
    return () => clearInterval(id)
  }, [petType, animState, sheetFile, stateCfg?.row])

  if (!cfg || !stateCfg) return null

  const { frameW, frameH, cols } = cfg
  const { row = 0, rows = 1 }   = stateCfg

  // Scale to fit within 80×80 container
  const scale   = Math.min(80 / frameW, 80 / frameH)
  const scaledW = Math.round(frameW * scale)
  const scaledH = Math.round(frameH * scale)
  const offsetX = Math.round((80 - scaledW) / 2)
  const offsetY = Math.round((80 - scaledH) / 2)

  // Explicit sheet dimensions — critical for correct clipping
  const sheetW = Math.round(cols * frameW * scale)
  const sheetH = Math.round(rows * frameH * scale)

  // Background position selects the correct frame from the sheet
  const bgX = -Math.round(frame * frameW * scale)
  const bgY = -Math.round(row   * frameH * scale)

  return (
    // Outer clip box — hard clips to exactly one frame. Prevents any bleed.
    <div style={{
      position:   'absolute',
      left:       offsetX,
      top:        offsetY,
      width:      scaledW,
      height:     scaledH,
      overflow:   'hidden',       // clips the background to frame bounds
      contain:    'strict',       // isolates from host page CSS
      flexShrink: 0,
    }}>
      {/* Inner div carries the full spritesheet as background */}
      <div style={{
        width:              scaledW,
        height:             scaledH,
        backgroundImage:    `url("${sheetURL}")`,
        backgroundRepeat:   'no-repeat',
        backgroundSize:     `${sheetW}px ${sheetH}px`,   // explicit both dims
        backgroundPosition: `${bgX}px ${bgY}px`,
        imageRendering:     'pixelated',
        willChange:         'background-position',
      }} />
    </div>
  )
}
