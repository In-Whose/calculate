import { copyFile, mkdir, rename, stat, writeFile } from "node:fs/promises";

const assets = [
  {
    url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar",
    destination: new URL("../public/models/PP-OCRv5_mobile_det_onnx_infer.tar", import.meta.url),
    bytes: 4_843_520,
  },
  {
    url: "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/korean_PP-OCRv5_mobile_rec_onnx_infer.tar",
    destination: new URL("../public/models/korean_PP-OCRv5_mobile_rec_onnx_infer.tar", import.meta.url),
    bytes: 13_537_280,
  },
];

async function hasExpectedSize(destination, bytes) {
  try {
    return (await stat(destination)).size === bytes;
  } catch {
    return false;
  }
}

for (const asset of assets) {
  if (await hasExpectedSize(asset.destination, asset.bytes)) continue;
  await mkdir(new URL(".", asset.destination), { recursive: true });
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`OCR 모델 다운로드 실패: ${response.status}`);
  const temporary = new URL(`${asset.destination.pathname}.download`, asset.destination);
  await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
  if (!(await hasExpectedSize(temporary, asset.bytes))) {
    throw new Error("OCR 모델 파일 크기가 예상과 다릅니다.");
  }
  await rename(temporary, asset.destination);
}

const wasmSource = new URL(
  "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  import.meta.url,
);
const wasmDestination = new URL(
  "../public/ort/ort-wasm-simd-threaded.wasm",
  import.meta.url,
);
await mkdir(new URL(".", wasmDestination), { recursive: true });
await copyFile(wasmSource, wasmDestination);
