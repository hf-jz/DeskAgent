import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'

function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, '../src/renderer/hit.html'),
        resolve(__dirname, '../dist/renderer/hit.html')
      )
      const iconsDir = resolve(__dirname, '../dist/renderer/icons')
      mkdirSync(iconsDir, { recursive: true })
      const svgFiles = ['browser.svg', 'external-link.svg', 'reasoning-dot.svg', 'search.svg']
      for (const f of svgFiles) {
        copyFileSync(
          resolve(__dirname, '../icons/icons_svg', f),
          resolve(iconsDir, f)
        )
      }
      // U2-Net segmentation model + onnxruntime-web standalone wasm build.
      // ort.wasm.min.mjs is self-contained (internal vite-ignore guards its own
      // dynamic imports); it lives in assets/ort/ next to the compiled chunks
      // so the runtime relative import resolves, and its wasm sibling files
      // follow (wasmPaths = './assets/ort/' relative to the page).
      const modelsDir = resolve(__dirname, '../dist/renderer/models')
      mkdirSync(modelsDir, { recursive: true })
      copyFileSync(
        resolve(__dirname, '../resources/models/u2netp.onnx'),
        resolve(modelsDir, 'u2netp.onnx')
      )
      const ortDir = resolve(__dirname, '../dist/renderer/assets/ort')
      mkdirSync(ortDir, { recursive: true })
      const ortFiles = [
        'ort.wasm.min.mjs',
        'ort-wasm-simd-threaded.mjs',
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd-threaded.jsep.mjs',
        'ort-wasm-simd-threaded.jsep.wasm',
      ]
      for (const f of ortFiles) {
        copyFileSync(
          resolve(__dirname, '../node_modules/onnxruntime-web/dist', f),
          resolve(ortDir, f)
        )
      }
      console.log('  ✓ hit.html + icons + model + ort wasm copied to dist/renderer/')
    }
  }
}

export default defineConfig({
  plugins: [react(), copyStaticAssets()],
  root: resolve(__dirname, '../src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, '../dist/renderer'),
    emptyOutDir: true
  },
  server: { port: 5173 }
})
