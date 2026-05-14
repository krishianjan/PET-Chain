import React from 'react'

const pets = [
  { id: 'dog', label: 'Dog', emoji: '🐕', desc: 'Loyal and energetic' },
  { id: 'cat', label: 'Cat', emoji: '🐈', desc: 'Chill and curious' },
  { id: 'bird', label: 'Bird', emoji: '🦜', desc: 'Fast and talkative' },
  { id: 'fox', label: 'Fox', emoji: '🦊', desc: 'Smart and sneaky' },
]

export default function Onboarding({ onSelect }) {
  return (
    <div style={{
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 320, background: '#fff', borderRadius: 24, padding: 24,
      boxShadow: '0 20px 50px rgba(83,74,183,0.3)', zIndex: 2147483647,
      fontFamily: 'system-ui, sans-serif', textAlign: 'center'
    }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
      <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#111' }}>Pick your Pet</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#6b7280' }}>
        Your prompt companion will help you write better AI requests.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {pets.map(p => (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              padding: 16, border: '1px solid #e5e7eb', borderRadius: 16,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#534ab7'
              e.currentTarget.style.background = '#f5f3ff'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#e5e7eb'
              e.currentTarget.style.background = '#fff'
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 4 }}>{p.emoji}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{p.label}</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>{p.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}