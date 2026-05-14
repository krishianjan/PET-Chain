import lottie from 'lottie-web'

// ── Per-pet animation file mapping ────────────────────────────────────────
// Every pet has its OWN set of files — no cross-pet sharing
const PET_ANIMS = {
  dog: {
    idle:        'dog_tail_shake.json',   // relaxed tail wag = default idle
    thinking:    'dog_walking.json',       // walking = rewriting / pondering
    analyzing:   'dog_walking.json',       // walking = scoring / analyzing
    happy:       'happy_dog.json',          // happy bounce = prompt injected / good result
    celebrating: 'happy_dog.json',          // happy bounce = great score (A/B)
    playing:     'doggyplaying.json',      // dog plays = follow-up suggestion shown
    loading:     'doggyplaying.json',      // dog plays = periodic break animation
    sleeping:    'dog_tail_shake.json',    // slow tail = extended idle
    error:       'dog_walking.json',       // walks away confused = poor score / error
  },
  cat: {
    idle:        'cat_hanging.json',       // hanging = relaxed idle
    thinking:    'cat_walk_loader.json',   // Harry Potter cat walking = thinking
    analyzing:   'cat_walk_loader.json',   // HP cat walking = analyzing/scoring
    happy:       'cat_playing_wool.json',  // playing wool = success / injected
    celebrating: 'cat_playing_wool.json',  // playing wool = great score
    playing:     'cat_playing_wool.json',  // playing wool = follow-up shown
    loading:     'cat_walk_loader.json',   // HP cat on periodic break (special!)
    sleeping:    'cat_hanging.json',       // hanging = resting
    error:       'cat_404.json',           // 404 cat = poor score / error
  },
  bird: {
    idle:        'lovebirds_fly.json',    // peaceful slow flight
    thinking:    'lovebirds_fly.json',    // excited quick flutter
    analyzing:   'lovebirds_fly.json',    // steady flight
    happy:       'lovebirds_fly.json',    // fast excited
    celebrating: 'lovebirds_fly.json',    // very fast
    playing:     'lovebirds_fly.json',    // playful flutter
    loading:     'lovebirds_fly.json',    // slow graceful
    sleeping:    'lovebirds_fly.json',    // very slow drift
    error:       'lovebirds_fly.json',    // slow dejected
  },
  // Rabbit — emoji fallback until Lottie files are added.
  // Drop rabbit_*.json files in src/assets/lottie/ and update paths below.
  rabbit: {
    idle:        null,   // add: 'rabbit_idle.json'
    thinking:    null,   // add: 'rabbit_thinking.json'
    analyzing:   null,   // add: 'rabbit_thinking.json'
    happy:       null,   // add: 'rabbit_happy.json'
    celebrating: null,   // add: 'rabbit_jump.json'
    playing:     null,   // add: 'rabbit_play.json'
    loading:     null,   // add: 'rabbit_hop.json'
    sleeping:    null,   // add: 'rabbit_sleep.json'
    error:       null,   // add: 'rabbit_sad.json'
  },
}

// Speed multiplier per pet per state (bird differentiates via speed only)
const PET_SPEEDS = {
  dog:    { idle:.7,  thinking:1.1, analyzing:1.0, happy:1.3, celebrating:1.5, playing:1.0, loading:.9,  sleeping:.35, error:.8  },
  cat:    { idle:.8,  thinking:.9,  analyzing:1.0, happy:1.2, celebrating:1.4, playing:1.1, loading:.75, sleeping:.4,  error:.9  },
  bird:   { idle:.65, thinking:1.4, analyzing:1.0, happy:1.6, celebrating:1.9, playing:1.2, loading:.75, sleeping:.35, error:.45 },
  rabbit: { idle:1.0, thinking:1.0, analyzing:1.0, happy:1.0, celebrating:1.0, playing:1.0, loading:1.0, sleeping:1.0, error:1.0 },
}

// States that loop vs play once
const LOOP_STATES = new Set(['idle','thinking','analyzing','playing','loading','sleeping'])

// After a one-shot animation completes, transition to this state
const AFTER = { happy:'idle', celebrating:'idle', error:'idle' }

// Pets that use CSS spritesheets — no Lottie loading needed
const SPRITE_PETS = new Set(['rabbit', 'human'])

const CACHE = {}

async function loadAnim(file) {
  if (CACHE[file]) return CACHE[file]
  try {
    const url  = chrome.runtime.getURL('assets/lottie/' + file)
    const data = await fetch(url).then(r => r.json())
    CACHE[file] = data
    return data
  } catch {
    return null
  }
}

export class PetController {
  constructor() {
    this.inst       = null   // lottie instance
    this.el         = null   // lottie container element
    this.stateEl    = null   // outer wrapper — holds data-state for CSS
    this.type       = 'dog'
    this.cur        = null   // current state name
    this._sleepTimer  = null
    this._loadTimer   = null
    this._loadEndTimer= null
    this._isBreak     = false  // true while periodic loading break is active

    // Callbacks — set by LottiePlayer
    this.onLottieReady = null  // (hasLottie: bool) => void
    this.onStateChange = null  // (stateName: string) => void
  }

  // Called by LottiePlayer once refs are ready
  // lottieEl is null for sprite pets
  async init(lottieEl, wrapperEl, type = 'dog') {
    this.el      = lottieEl
    this.stateEl = wrapperEl
    this.type    = type
    await this.setState('idle')
    this._scheduleBreak()
  }

  setPetType(t) {
    this.type = t
    this.cur  = null
    this.setState('idle')
  }

  // ── Core state machine ──────────────────────────────────────────────────
  async setState(name) {
    // Sprite pets have no lottie el (null) — only require stateEl
    if (!this.stateEl) return
    if (!SPRITE_PETS.has(this.type) && !this.el) return

    // If a user action fires during the periodic break, cancel it cleanly
    if (name !== 'loading' && this._isBreak) {
      this._isBreak = false
      clearTimeout(this._loadEndTimer)
      this._scheduleBreak()          // reschedule for later
    }

    // Update state on the CSS wrapper so our keyframe rules fire
    if (this.stateEl) {
      this.stateEl.dataset.state = name
      this.stateEl.dataset.pet   = this.type
    }
    this.cur = name

    // Notify LottiePlayer of state change (sprite pets use this to re-render)
    this.onStateChange?.(name)

    // Sprite pets: no Lottie needed — signal ready and return
    if (SPRITE_PETS.has(this.type)) {
      this.onLottieReady?.(true)
      this._resetSleepTimer()
      return
    }

    const pet   = PET_ANIMS[this.type] || PET_ANIMS.dog
    const file  = pet[name] ?? pet.idle ?? null   // null = no Lottie → emoji fallback
    const speed = (PET_SPEEDS[this.type] || PET_SPEEDS.dog)[name] || 1
    const loop  = LOOP_STATES.has(name)

    // No file for this pet/state — gracefully fall back to emoji
    if (!file) {
      this.inst?.destroy(); this.inst = null
      this.onLottieReady?.(false)
      this._resetSleepTimer()
      return
    }

    const data = await loadAnim(file)
    if (!this.el) return   // destroyed while loading

    if (data) {
      try {
        this.inst?.destroy()
        this.inst = null
        this.inst = lottie.loadAnimation({
          container:     this.el,
          animationData: data,
          renderer:      'svg',
          loop,
          autoplay:      true,
        })
        this.inst.setSpeed(speed)

        // Tell LottiePlayer Lottie is alive — hides emoji fallback
        this.onLottieReady?.(true)

        // Chain one-shot animations back to idle
        const nextState = AFTER[name]
        if (nextState !== undefined) {
          this.inst.addEventListener('complete', () => this.setState(nextState ?? 'idle'))
        }
      } catch (e) {
        console.warn('[PET anim]', e.message)
        this.onLottieReady?.(false)
      }
    } else {
      // File missing — use emoji fallback
      this.onLottieReady?.(false)
    }

    this._resetSleepTimer()
  }

  // ── Periodic loading break ─────────────────────────────────────────────
  // Every 2–3 min: play loading anim for ~60s, then resume idle
  _scheduleBreak() {
    clearTimeout(this._loadTimer)
    const delay = (120 + Math.random() * 60) * 1000   // 2–3 minutes
    this._loadTimer = setTimeout(() => {
      // Only interrupt idle / sleeping states
      if (!['idle', 'sleeping', null].includes(this.cur)) {
        this._scheduleBreak()   // user is active — try again later
        return
      }
      this._isBreak = true
      this.setState('loading')

      // Return to idle after 60 seconds
      clearTimeout(this._loadEndTimer)
      this._loadEndTimer = setTimeout(() => {
        if (this._isBreak) {
          this._isBreak = false
          this.setState('idle')
          this._scheduleBreak()
        }
      }, 60000)
    }, delay)
  }

  // ── Sleep timer (after 3 min of NO interaction, go sleeping) ──────────
  _resetSleepTimer() {
    clearTimeout(this._sleepTimer)
    if (this.cur !== 'sleeping') {
      this._sleepTimer = setTimeout(() => this.setState('sleeping'), 180000)
    }
  }

  destroy() {
    this.inst?.destroy()
    clearTimeout(this._sleepTimer)
    clearTimeout(this._loadTimer)
    clearTimeout(this._loadEndTimer)
    this.el = null
    this.stateEl = null
  }
}
