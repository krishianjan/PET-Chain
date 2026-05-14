import selectorsConfig from '../../../selectors.config.json'

export function watchTextarea(platform, onPromptReady) {
    const sel = selectorsConfig.platforms[platform]?.textarea
    if (!sel) return

    let debounce = null
    let lastText = ''

    const check = () => {
        const el = document.querySelector(sel)
        if (!el) return
        const text = (el.value || el.textContent || '').trim()
        if (text === lastText || text.split(/\s+/).length < 8) return
        lastText = text
        clearTimeout(debounce)
        debounce = setTimeout(() => onPromptReady(text), 800)
    }

    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    // Also poll — some platforms don't fire mutations on every keystroke
    const interval = setInterval(check, 1200)

    return () => { observer.disconnect(); clearInterval(interval) }
}