/**
 * segnet.ts — local U2-Net salient-object segmentation (onnxruntime-web).
 *
 * Replaces the flood-fill heuristic for photos: a 320×320 pass through
 * u2netp.onnx (2MB, bundled into dist/renderer/models/) yields a saliency
 * mask that survives complex backgrounds (grass, furniture, gradients).
 * The Segmenter lazily loads once and returns null on failure — the caller
 * falls back to flood-fill.
 *
 * onnxruntime-web is loaded at runtime from dist/renderer/assets/ort/
 * (ort.wasm.min.mjs — the self-contained wasm-only build, copied verbatim
 * by the vite copy plugin). The @vite-ignore guards keep vite from rewriting
 * its internal dynamic imports into hashed chunk paths that don't exist.
 */

import type * as ortTypes from 'onnxruntime-web'
import { preprocess, postprocessAvg, U2NET_INPUT } from './segnet-core'

export const MODEL_PATH = './models/u2netp.onnx'

type OrtModule = typeof import('onnxruntime-web')

let ortPromise: Promise<OrtModule> | null = null
async function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    // Variable-form dynamic import: rollup can't statically resolve it and
    // leaves the runtime path alone → resolves relative to this chunk (assets/)
    const url = './ort/ort.wasm.min.mjs'
    ortPromise = import(url) as Promise<OrtModule>
  }
  return ortPromise
}

/** Singleton segmenter — lazily loads the model once, never throws. */
class Segmenter {
  private session: ortTypes.InferenceSession | null = null

  async load(): Promise<boolean> {
    if (this.session) return true
    try {
      const ort = await getOrt()
      // wasm files sit in dist/renderer/assets/ort/; wasmPaths must be an
      // ABSOLUTE URL — ort treats it as a base for its own relative imports
      // (relative './assets/ort/' would double-resolve against this module)
      ort.env.wasm.wasmPaths = new URL('./assets/ort/', document.baseURI).href
      this.session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['wasm'] })
      return true
    } catch (err) {
      console.warn('[segnet] model load failed:', (err as Error).message || err)
      return false
    }
  }

  /** Full-image subject mask (0/255, original size), or null on failure. */
  async segment(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array | null> {
    if (!this.session) return null
    try {
      const ort = await getOrt()
      const input = preprocess(rgba, w, h)
      const feeds: Record<string, ortTypes.Tensor> = {
        [this.session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, U2NET_INPUT, U2NET_INPUT]),
      }
      const out = await this.session.run(feeds)
      // u2netp has 7 saliency side-outputs — average them for a robust mask
      const logitsList: Float32Array[] = this.session.outputNames.map((name) => out[name].data as Float32Array)
      return postprocessAvg(logitsList, w, h)
    } catch (err) {
      console.warn('[segnet] inference failed:', (err as Error).message || err)
      return null
    }
  }

  get ready(): boolean {
    return this.session !== null
  }
}

export const segmenter = new Segmenter()
