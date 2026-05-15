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

  // Use exact float scale — no Math.round() accumulation errors
  const scale   = Math.min(80 / frameW, 80 / frameH)
  const scaledW = frameW * scale
  const scaledH = frameH * scale
  const offsetX = (80 - scaledW) / 2
  const offsetY = (80 - scaledH) / 2

  // Full sheet display dimensions
  const sheetW = cols * frameW * scale
  const sheetH = rows * frameH * scale

  // Offset the img so the correct frame is visible through the clip box
  // Uses same scale factor as sheetW/sheetH — no rounding drift
  const imgLeft = -(frame * frameW * scale)
  const imgTop  = -(row   * frameH * scale)

  return (
    // Clip box — exactly one frame wide/tall. overflow:hidden clips the img.
    <div style={{
      position:   'absolute',
      left:       offsetX,
      top:        offsetY,
      width:      scaledW,
      height:     scaledH,
      overflow:   'hidden',
      flexShrink: 0,
    }}>
      {/*
        The full spritesheet image is positioned so that the target frame
        appears at (0,0) within the clip box.
        Using <img> with absolute positioning avoids background-repeat issues
        where host-page CSS can override background-repeat: no-repeat.
      */}
      <img
        src={sheetURL}
        alt=""
        draggable={false}
        style={{
          position:       'absolute',
          left:           imgLeft,
          top:            imgTop,
          width:          sheetW,
          height:         sheetH,
          imageRendering: 'pixelated',
          willChange:     'left, top',
          userSelect:     'none',
          pointerEvents:  'none',
          display:        'block',
        }}
      />
    </div>
  )
}
