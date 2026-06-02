import React from 'react'
import { createRoot } from 'react-dom/client'
import PetWidget from './pet/PetWidget'
import { detectPlatform } from './detectors/platform'

const platform = detectPlatform()
let root = null

function mount() {
    if (document.getElementById('pet-root')) return

    const container = document.createElement('div')
    container.id = 'pet-root'
    container.style.cssText = 'position: static; z-index: 2147483647;'
    document.body.appendChild(container)

    // No shadow DOM – Rnd and styles will work normally
    root = createRoot(container)
    root.render(<PetWidget platform={platform} />)
}

function keepAlive() {
    const observer = new MutationObserver(() => {
        if (!document.getElementById('pet-root')) {
            setTimeout(mount, 300) // small delay lets SPA finish render
        }
    })
    observer.observe(document.body, { childList: true, subtree: false })
    // Also observe documentElement for full page swaps
    observer.observe(document.documentElement, { childList: true })
}

mount()
keepAlive()