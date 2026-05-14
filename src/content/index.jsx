import React from 'react'
import { createRoot } from 'react-dom/client'
import PetWidget from './pet/PetWidget'
import { detectPlatform } from './detectors/platform'
import { recordSession } from '../engines/metrics_store'

function mount() {
  if (document.getElementById('pet-root')) return
  const platform = detectPlatform()
  if (!platform) return
  recordSession().catch(() => {})

  const host = document.createElement('div')
  host.id    = 'pet-root'
  // Removed pointer-events:none — host is 0x0 so it won't block page clicks
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;'
  document.body.appendChild(host)
  createRoot(host).render(<PetWidget platform={platform} />)
}

new MutationObserver(() => {
  if (!document.getElementById('pet-root')) setTimeout(mount, 400)
}).observe(document.documentElement, { childList: true, subtree: false })

mount()