import lottie from 'lottie-web';
import selectorsConfig from './selectors.config.json';

const PET_STATES = {
  idle: { file: 'assets/lottie/cat_hanging.json', loop: true, speed: 1 },
  thinking: { file: 'assets/lottie/cat_walk_loader.json', loop: true, speed: 1 },
  writing: { file: 'assets/lottie/cat_walk_loader.json', loop: true, speed: 1.2 },
  analyzing: { file: 'assets/lottie/cat_playing_wool.json', loop: true, speed: 1 },
  happy: { file: 'assets/lottie/dog_tail_shake.json', loop: false, speed: 1, then: 'idle' },
  celebrating: { file: 'assets/lottie/lovebirds_fly.json', loop: false, speed: 1, then: 'idle' },
  error: { file: 'assets/lottie/cat_404.json', loop: false, speed: 1, holdLastFrame: true },
  transitioning: { file: 'assets/lottie/dog_walking.json', loop: false, speed: 1, then: 'thinking' },
  sleeping: { file: 'assets/lottie/cat_hanging.json', loop: true, speed: 0.3 },
};

class PetController {
  constructor(container) {
    this.container = container;
    this.current = 'idle';
    this.timer = null;
    this.animation = null;
    this.loadState('idle');
  }

  loadState(state) {
    if (this.animation) {
      this.animation.destroy();
    }

    const s = PET_STATES[state];
    this.animation = lottie.loadAnimation({
      container: this.container,
      renderer: 'svg',
      loop: s.loop,
      autoplay: true,
      path: chrome.runtime.getURL(s.file)
    });

    this.animation.setSpeed(s.speed);

    if (!s.loop && s.then) {
      this.animation.onComplete = () => this.setState(s.then);
    }

    if (s.holdLastFrame) {
      this.animation.onComplete = () => this.animation.pause();
    }
  }

  setState(state) {
    if (this.current === state) return;
    console.log(`Pet state transition: ${this.current} -> ${state}`);
    this.loadState(state);
    this.current = state;
    this.resetIdleTimer();
  }

  resetIdleTimer() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setState('sleeping'), 120000);
  }
}

// Initialize Pet Overlay
const init = () => {
  const overlay = document.createElement('div');
  overlay.id = 'pet-chains-container';
  overlay.style.position = 'fixed';
  overlay.style.bottom = '20px';
  overlay.style.right = '20px';
  overlay.style.width = '150px';
  overlay.style.height = '150px';
  overlay.style.zIndex = '10000';
  overlay.style.pointerEvents = 'none';
  document.body.appendChild(overlay);

  const controller = new PetController(overlay);

  // Example: Listen for input changes
  const hostname = window.location.hostname.replace('www.', '');
  const config = selectorsConfig.selectors[hostname];

  if (config) {
    // Tab ID namespacing
    let tabId = 'default';
    chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
      if (response && response.tabId) {
        tabId = response.tabId;
      }
      const storageKey = `tab_${tabId}_chains`;
      console.log(`Using storage key: ${storageKey}`);
    });

    const textarea = document.querySelector(config.prompt_textarea);
    if (textarea) {
      textarea.addEventListener('input', (e) => {
        const words = e.target.value.trim().split(/\s+/).length;
        if (words >= 15) {
          controller.setState('thinking');
        } else if (words === 0) {
          controller.setState('idle');
        }
      });
    }

    // MutationObserver for response scraping with 1.5s settle
    let settleTimer = null;
    const observer = new MutationObserver((mutations) => {
      const sendButton = document.querySelector(config.send_button);
      const isButtonEnabled = sendButton && !sendButton.disabled;

      if (settleTimer) clearTimeout(settleTimer);

      settleTimer = setTimeout(() => {
        if (isButtonEnabled) {
          console.log('Response settled and send button re-enabled. Scraping...');
          controller.setState('analyzing');
          // Scrape logic here...
          setTimeout(() => controller.setState('happy'), 1500);
        }
      }, 1500);
    });

    const responseContainer = document.querySelector(config.response_container);
    if (responseContainer) {
      observer.observe(responseContainer, { childList: true, subtree: true });
    }
  }
};

if (document.readyState === 'complete') {
  init();
} else {
  window.addEventListener('load', init);
}
