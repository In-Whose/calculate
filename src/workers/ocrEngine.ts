import type { OcrProgress, OcrResult, OcrToken } from "../types";

export interface OcrEngine {
  initialize(onProgress: (progress: OcrProgress) => void): Promise<void>;
  recognize(image: Blob, signal?: AbortSignal): Promise<OcrResult>;
  terminate(): Promise<void>;
}

export class TesseractOcrEngine implements OcrEngine {
  private worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;
  private onProgress: (progress: OcrProgress) => void = () => undefined;

  async initialize(onProgress: (progress: OcrProgress) => void) {
    this.onProgress = onProgress;
    const { createWorker } = await import("tesseract.js");
    const langPath = new URL("tessdata", `${window.location.origin}${import.meta.env.BASE_URL}`).href;
    this.worker = await createWorker(["kor", "eng"], 1, {
      langPath,
      logger: (message) => this.onProgress({ status: message.status, progress: message.progress }),
      cacheMethod: "write",
    });
  }

  async recognize(image: Blob, signal?: AbortSignal): Promise<OcrResult> {
    if (!this.worker) throw new Error("OCR 엔진이 준비되지 않았습니다.");
    if (signal?.aborted) throw new DOMException("OCR이 취소되었습니다.", "AbortError");
    const abort = () => void this.worker?.terminate();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const { data } = await this.worker.recognize(image);
      const words = "words" in data ? (data.words as any[]) : [];
      const tokens: OcrToken[] = words.map((word) => ({
        text: String(word.text),
        confidence: Number(word.confidence) / 100,
        box: word.bbox,
      }));
      return { text: data.text, confidence: data.confidence / 100, tokens };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async terminate() {
    await this.worker?.terminate();
    this.worker = null;
  }
}
