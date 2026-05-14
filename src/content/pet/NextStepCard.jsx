import React from 'react'

export default function NextStepCard({ result, petPosition, onUse, onDismiss }) {
  // Position card above the pet
  const cardX = Math.max(8, Math.min(window.innerWidth - 360, petPosition.x - 140))
  const cardY = Math.max(8, petPosition.y - 240)

  const handleCopy = () => {
    navigator.clipboard.writeText(result.next_prompt)
    alert('Prompt copied to clipboard!')
  }

  return (
    <div style={{
      position:  'fixed',
      left:      cardX,
      top:       cardY,
      width:     340,
      zIndex:    2147483646,
      background: 'rgba(255,255,255,0.98)',
      backdropFilter: 'blur(16px)',
      border:    '1px solid rgba(83,74,183,0.3)',
      borderRadius: 18,
      padding:   '14px 16px',
      boxShadow: '0 12px 48px rgba(83,74,183,0.2)',
      fontFamily:'system-ui,sans-serif',
      animation: 'petSlide 0.25s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <style>{`@keyframes petSlide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Header with Progress */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#534ab7' }}>Evolved Suggestion</div>
        <div style={{ fontSize:11, fontWeight:700, color: result.goal_progress>=70?'#16a34a':'#d97706' }}>
          {result.goal_progress || 0}% toward goal
        </div>
      </div>

      <div style={{ background:'#e5e7eb', borderRadius:99, height:5, marginBottom:12 }}>
        <div style={{
          background: result.goal_progress>=70?'#16a34a':'#d97706',
          width: `${result.goal_progress || 0}%`, height:5, borderRadius:99,
          transition: 'width 0.8s ease'
        }}/>
      </div>

      {/* Next prompt — Scrollable and more detailed */}
      <div style={{ 
        fontSize:12, 
        color:'#111', 
        lineHeight:1.6, 
        marginBottom:14, 
        padding:'10px',
        background:'#f9fafb',
        borderRadius:10,
        maxHeight: 120,
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        border: '1px solid #f3f4f6'
      }}>
        {result.next_prompt}
      </div>

      <div style={{ display:'flex', gap:6 }}>
        <button onClick={() => onUse(result.next_prompt)} style={{
          flex:2, padding:'9px 0', background:'#534ab7', color:'#fff',
          border:'none', borderRadius:10, cursor:'pointer', fontSize:12, fontWeight:600,
          boxShadow: '0 4px 12px rgba(83,74,183,0.2)'
        }}>
          ↗ Use this
        </button>
        <button onClick={handleCopy} title="Copy to clipboard" style={{
          flex:0.5, padding:'9px 0', background:'#fff', color:'#534ab7',
          border:'1px solid #534ab7', borderRadius:10, cursor:'pointer', fontSize:14,
        }}>
          📋
        </button>
        <button onClick={onDismiss} style={{
          flex:0.5, padding:'9px 0', background:'#f3f4f6', color:'#6b7280',
          border:'none', borderRadius:10, cursor:'pointer', fontSize:12,
        }}>
          ✕
        </button>
      </div>
    </div>
  )
}
