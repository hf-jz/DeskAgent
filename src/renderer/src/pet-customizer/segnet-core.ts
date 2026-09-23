/**
 * segnet-core.ts — U2-Net pre/post-processing. Pure functions, no
 * onnxruntime dependency → unit-testable in node (see segnet.test.ts).
 * segnet.ts wires these to the ONNX session.
 */

export const U2NET_INPUT = 320
export const THRESHOLD = 0.4

/** Nearest-neighbor resize of a 1-channel Uint8 source. */
export function resizeNearest(
  src: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh)
  const sx = sw / dw
  const sy = sh / dh
  for (let y = 0; y < dh; y++) {
    const syi = Math.min(sh - 1, Math.floor(y * sy))
    for (let x = 0; x < dw; x++) {
      out[y * dw + x] = src[syi * sw + Math.min(sw - 1, Math.floor(x * sx))]
    }
  }
  return out
}

/** RGBA → nearest-neighbor-resized RGB (drop alpha). */
export function resizeRGB(
  rgba: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 3)
  const sx = sw / dw
  const sy = sh / dh
  for (let y = 0; y < dh; y++) {
    const syi = Math.min(sh - 1, Math.floor(y * sy))
    for (let x = 0; x < dw; x++) {
      const si = (syi * sw + Math.min(sw - 1, Math.floor(x * sx))) * 4
      const di = (y * dw + x) * 3
      out[di] = rgba[si]
      out[di + 1] = rgba[si + 1]
      out[di + 2] = rgba[si + 2]
    }
  }
  return out
}

/** Image pixels → U2-Net NCHW float32 input tensor (1,3,320,320), 0..1. */
export function preprocess(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const rgb = resizeRGB(rgba, w, h, U2NET_INPUT, U2NET_INPUT)
  const n = U2NET_INPUT * U2NET_INPUT
  const out = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    out[i] = rgb[i * 3] / 255
    out[n + i] = rgb[i * 3 + 1] / 255
    out[2 * n + i] = rgb[i * 3 + 2] / 255
  }
  return out
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** Saliency logits (1,1,320,320) → binary mask at (w,h): 0/255. */
export function postprocess(logits: Float32Array, w: number, h: number): Uint8Array {
  return postprocessAvg([logits], w, h)
}

/**
 * Average over U2-Net's multi-scale side outputs (7 heads), then threshold.
 * Logits are averaged BEFORE sigmoid (fusion semantics), then binarized.
 */
export function postprocessAvg(logitsList: Float32Array[], w: number, h: number): Uint8Array {
  const n = U2NET_INPUT * U2NET_INPUT
  const acc = new Float32Array(n)
  for (const logits of logitsList) {
    for (let i = 0; i < n; i++) acc[i] += logits[i]
  }
  const small = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    small[i] = sigmoid(acc[i] / logitsList.length) >= THRESHOLD ? 255 : 0
  }
  return new Uint8Array(resizeNearest(small, U2NET_INPUT, U2NET_INPUT, w, h))
}
