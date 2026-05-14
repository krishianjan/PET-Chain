const SID = `pet_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
let _q = ''
export const setQ   = q  => { if (q?.trim()) _q = q.trim() }
export const getQ   = () => _q
export const getSID = () => SID

function send(type, body, timeoutMs = 8000) {
  return new Promise(resolve => {
    // Timeout — never hang forever
    const timer = setTimeout(() => {
      console.warn('[PET] sendMessage timeout:', type)
      resolve(null)
    }, timeoutMs)

    try {
      if (!chrome?.runtime?.id) { clearTimeout(timer); resolve(null); return }

      chrome.runtime.sendMessage({ type, ...body }, r => {
        clearTimeout(timer)
        if (chrome.runtime.lastError) {
          console.warn('[PET]', chrome.runtime.lastError.message)
          resolve(null)
          return
        }
        resolve(r ?? null)
      })
    } catch (e) {
      clearTimeout(timer)
      console.error('[PET send]', e.message)
      resolve(null)
    }
  })
}

export const rewrite  = (prompt, key) =>
  send('REWRITE', { prompt, api_key: key, session_id: SID })

export const evaluate = (response, key) => {
  if (!response?.trim()) return Promise.resolve(null)
  // Use stored question if available, otherwise use first 150 chars of response as context
  const question = _q || response.slice(0, 150)
  return send('EVALUATE', { question, response: response.slice(0, 2000), api_key: key, session_id: SID })
}