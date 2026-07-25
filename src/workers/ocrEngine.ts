import type { OcrProgress, OcrResult, OcrToken } from "../types";

export interface OcrEngine {
  initialize(onProgress: (progress: OcrProgress) => void): Promise<void>;
  recognize(image: Blob, signal?: AbortSignal): Promise<OcrResult>;
  terminate(): Promise<void>;
}

/*
 * Original Tesseract.js OCR engine kept for reference:
 *
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
 */

type PaddleOcrInstance = Awaited<
  ReturnType<(typeof import("@paddleocr/paddleocr-js"))["PaddleOCR"]["create"]>
>;

function publicAssetUrl(path: string) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(path, base).href;
}

export class PaddleOcrEngine implements OcrEngine {
  private engine: PaddleOcrInstance | null = null;
  private disposed = false;

  async initialize(onProgress: (progress: OcrProgress) => void) {
    this.disposed = false;
    onProgress({ status: "PaddleOCR 엔진 불러오는 중", progress: 0.05 });

    const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
    onProgress({ status: "한국어 PP-OCRv5 모델 준비 중", progress: 0.2 });

    /*
     * Original PaddleOCR initialization:
     *
    this.engine = await PaddleOCR.create({
      worker: true,
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textDetectionModelAsset: {
        url: publicAssetUrl("models/PP-OCRv5_mobile_det_onnx_infer.tar"),
      },
      textRecognitionModelName: "korean_PP-OCRv5_mobile_rec",
      textRecognitionModelAsset: {
        url: publicAssetUrl("models/korean_PP-OCRv5_mobile_rec_onnx_infer.tar"),
      },
      textRecognitionBatchSize: 6,
      ortOptions: {
        backend: "wasm",
        wasmPaths: publicAssetUrl("ort/"),
        numThreads: 1,
        simd: true,
        proxy: false,
      },
    });
     */
    const createOptions = {
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textDetectionModelAsset: {
        url: publicAssetUrl("models/PP-OCRv5_mobile_det_onnx_infer.tar"),
      },
      textRecognitionModelName: "korean_PP-OCRv5_mobile_rec",
      textRecognitionModelAsset: {
        url: publicAssetUrl("models/korean_PP-OCRv5_mobile_rec_onnx_infer.tar"),
      },
      textRecognitionBatchSize: 6,
      ortOptions: {
        backend: "wasm" as const,
        wasmPaths: publicAssetUrl("ort/"),
        numThreads: 1,
        simd: true,
        proxy: false,
      },
    };

    try {
      this.engine = await PaddleOCR.create({ ...createOptions, worker: true });
    } catch (workerReason) {
      console.warn("PaddleOCR worker initialization failed; retrying without a worker.", workerReason);
      onProgress({ status: "브라우저 호환 모드로 다시 준비 중", progress: 0.3 });
      try {
        this.engine = await PaddleOCR.create({ ...createOptions, worker: false });
      } catch (fallbackReason) {
        throw new AggregateError(
          [workerReason, fallbackReason],
          `PaddleOCR 초기화 실패: ${errorMessage(fallbackReason)}`,
        );
      }
    }

    if (this.disposed) {
      await this.engine.dispose();
      this.engine = null;
      throw new DOMException("OCR이 취소되었습니다.", "AbortError");
    }
    onProgress({ status: "한국어 PP-OCRv5 준비 완료", progress: 1 });
  }

  async recognize(image: Blob, signal?: AbortSignal): Promise<OcrResult> {
    if (!this.engine) throw new Error("OCR 엔진이 준비되지 않았습니다.");
    if (signal?.aborted) throw new DOMException("OCR이 취소되었습니다.", "AbortError");

    const activeEngine = this.engine;
    const abort = () => {
      this.disposed = true;
      void activeEngine.dispose();
    };
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const [result] = await activeEngine.predict(image, {
        textDetLimitSideLen: 1920,
        textDetLimitType: "max",
        textDetMaxSideLimit: 2400,
        textRecScoreThresh: 0.25,
      });
      if (signal?.aborted || this.disposed) {
        throw new DOMException("OCR이 취소되었습니다.", "AbortError");
      }

      const tokens: OcrToken[] = result.items.map((item) => {
        const xs = item.poly.map(([x]) => x);
        const ys = item.poly.map(([, y]) => y);
        return {
          text: item.text.normalize("NFC"),
          confidence: item.score,
          box: {
            x0: Math.min(...xs),
            y0: Math.min(...ys),
            x1: Math.max(...xs),
            y1: Math.max(...ys),
          },
        };
      });
      const confidence =
        tokens.length > 0
          ? tokens.reduce((sum, token) => sum + token.confidence, 0) / tokens.length
          : 0;

      return {
        text: tokens.map((token) => token.text).join("\n"),
        confidence,
        tokens,
      };
    } catch (reason) {
      if (signal?.aborted || this.disposed) {
        throw new DOMException("OCR이 취소되었습니다.", "AbortError");
      }
      throw reason;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async terminate() {
    this.disposed = true;
    await this.engine?.dispose();
    this.engine = null;
  }
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  return String(reason);
}
