import React from 'react'
import { createRoot } from 'react-dom/client'
import PetWidget from './pet/PetWidget'
import { detectPlatform } from './detectors/platform'
import { recordSession } from '../engines/metrics_store'

let _root = null   // React root — kept to avoid creating multiple roots

function mount() {
  if (document.getElementById('pet-root')) return
  const platform = detectPlatform()
  if (!platform) return
  recordSession().catch(() => {})

  const host = document.createElement('div')
  host.id    = 'pet-root'
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;pointer-events:none;overflow:visible;'
  // Mount directly on <html> element — survives SPA body replacements
  ;(document.body || document.documentElement).appendChild(host)
  _root = createRoot(host)
  _root.render(<PetWidget />)
}

// Watch both documentElement and body for DOM changes that might remove pet-root
const _obs = new MutationObserver(() => {
  if (!document.getElementById('pet-root')) setTimeout(mount, 300)
})
_obs.observe(document.documentElement, { childList: true, subtree: false })
if (document.body) {
  _obs.observe(document.body, { childList: true, subtree: false })
}

mount()