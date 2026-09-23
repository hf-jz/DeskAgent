/**
 * Runtime-only module: onnxruntime-web's standalone wasm build, copied to
 * dist/renderer/assets/ort/ by the vite copy plugin and imported with a
 * vite-ignore guard. Types come from the real package.
 */
declare module '*/ort.wasm.min.mjs' {
  export * from 'onnxruntime-web'
}
