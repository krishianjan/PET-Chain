import { useState, useEffect } from 'react'
import { getContextUsage } from '../../engines/tokens'

export default function TokenBar({ platform }) {
  const [usage, setUsage] = useState(null)

  useEffect(() => {
    const update = () => setUsage(getContextUsage(platform))
    update()
    const t = setInterval(update, 8000)
    return () => clearInterval(t)
  }, [platform])

  if (!usage || usage.pct < 2) return null

  const color = usage.pct < 50 ? '#16a34a' : usage.pct < 75 ? '#d97706' : '#dc2626'
  const warn  = usage.pct >= 75

  return (
    <div style={{ padding:'8px 0', borderTop:'1px solid #f3f4f6', marginTop: 12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:4 }}>
        <span style={{ color:'#9ca3af', fontWeight: 500 }}>Context usage · {usage.model}</span>
        <span style={{ fontWeight:700, color }}>{usage.pct}%</span>
      </div>
      <div style={{ background:'#e5e7eb', borderRadius:99, height:4, overflow: 'hidden' }}>
        <div style={{ background:color, width:`${usage.pct}%`, height:4, borderRadius:99, transition:'width 1s ease' }}/>
      </div>
      {warn && (
        <div style={{ fontSize:9, color:'#d97706', marginTop:4, lineHeight: 1.3 }}>
          ⚠ ~{usage.used.toLocaleString()} tokens used. Consider starting a new thread to keep the AI sharp.
        </div>
      )}
    </div>
  )
}
