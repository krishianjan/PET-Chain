import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'
import path from 'path'

// Force-copies ALL lottie JSON files to dist on every build.
// CRX plugin sometimes misses files added after initial setup or files with spaces.
const copyLottie = {
  name: 'copy-lottie-all',
  closeBundle() {
    const src = path.resolve('src/assets/lottie')
    const dst = path.resolve('dist/assets/lottie')
    mkdirSync(dst, { recursive: true })
    readdirSync(src)
      .filter(f => f.endsWith('.json') || f.endsWith('.webp'))
      .forEach(f => copyFileSync(path.join(src, f), path.join(dst, f)))
    console.log('[copy-lottie] ✓ all lottie + webp files copied to dist')
  },
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    copyLottie,
  ],
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
})
