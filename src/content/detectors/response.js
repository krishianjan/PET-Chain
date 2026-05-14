import selectorsConfig from '../../../selectors.config.json'

export function watchResponse(platform, onResponseComplete) {
    const sel = selectorsConfig.platforms[platform]
    if (!sel) return

    let debounce = null
    let lastLen = 0
    let active = false

    const observer = new MutationObserver(() => {
        const el = document.querySelector(sel.response)
        if (!el) return

        const len = el.textContent.length
        if (len === lastLen) return
        lastLen = len
        active = true

        clearTimeout(debounce)
        debounce = setTimeout(() => {
            if (!active) return
            const sendBtn = document.querySelector(sel.sendBtn)
            const done = !sendBtn || sendBtn.disabled === false
            if (done && el.textContent.length > 30) {
                active = false
                onResponseComplete(el.textContent)
            }
        }, 1500)
    })

    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
}