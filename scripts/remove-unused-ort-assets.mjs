import { readdir, unlink } from "node:fs/promises";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const generatedAssets = await readdir(assetsDirectory);

for (const name of generatedAssets) {
  if (/^ort-wasm-simd-threaded\.jsep-.*\.wasm$/.test(name)) {
    // Original: PaddleOCR is configured with proxy disabled and loads the smaller, single-thread WASM binary from public/ort instead of this WebGPU fallback.
    // PaddleOCR loads the stable-named JSEP runtime files from public/ort, so this hashed duplicate is unnecessary.
    await unlink(new URL(name, assetsDirectory));
  }
}
