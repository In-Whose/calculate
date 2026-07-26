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

function tokenRegionsOverlap(first: OcrToken, second: OcrToken) {
  const firstHeight = Math.max(1, first.box.y1 - first.box.y0);
  const secondHeight = Math.max(1, second.box.y1 - second.box.y0);
  const firstCenterY = (first.box.y0 + first.box.y1) / 2;
  const secondCenterY = (second.box.y0 + second.box.y1) / 2;
  const horizontalOverlap = Math.max(
    0,
    Math.min(first.box.x1, second.box.x1) - Math.max(first.box.x0, second.box.x0),
  );
  const minimumWidth = Math.max(
    1,
    Math.min(first.box.x1 - first.box.x0, second.box.x1 - second.box.x0),
  );
  return Math.abs(firstCenterY - secondCenterY) <= Math.max(firstHeight, secondHeight) * 0.7
    && horizontalOverlap / minimumWidth >= 0.55;
}

function deduplicateOverlappingTokens(tokens: OcrToken[]) {
  const selected: OcrToken[] = [];
  for (const token of [...tokens].sort((a, b) => b.confidence - a.confidence)) {
    if (!selected.some((item) => tokenRegionsOverlap(item, token))) selected.push(token);
  }
  return selected.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
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

  /*
   * Original single-pass PaddleOCR recognition:
   *
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
   */

  private async predictTokens(image: Blob, yOffset = 0) {
    if (!this.engine) throw new Error("OCR 엔진이 준비되지 않았습니다.");
    const [result] = await this.engine.predict(image, {
      textDetLimitSideLen: 2600,
      textDetLimitType: "max",
      textDetMaxSideLimit: 3000,
      textRecScoreThresh: 0.25,
    });
    return result.items.map((item): OcrToken => {
      const xs = item.poly.map(([x]) => x);
      const ys = item.poly.map(([, y]) => y);
      return {
        text: item.text.normalize("NFC"),
        confidence: item.score,
        box: {
          x0: Math.min(...xs),
          y0: Math.min(...ys) + yOffset,
          x1: Math.max(...xs),
          y1: Math.max(...ys) + yOffset,
        },
      };
    });
  }

  private async cropImage(bitmap: ImageBitmap, y: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("긴 이미지를 나눌 캔버스를 만들지 못했습니다.");
    context.drawImage(bitmap, 0, y, bitmap.width, height, 0, 0, bitmap.width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("긴 이미지 조각을 만들지 못했습니다."));
      }, "image/png");
    });
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
      const bitmap = await createImageBitmap(image);
      let tokens: OcrToken[] = [];
      try {
        if (bitmap.height <= 2600) {
          tokens = await this.predictTokens(image);
        } else {
          const tileHeight = 2200;
          const overlap = 200;
          for (let y = 0; y < bitmap.height; y += tileHeight - overlap) {
            if (signal?.aborted || this.disposed) {
              throw new DOMException("OCR이 취소되었습니다.", "AbortError");
            }
            const height = Math.min(tileHeight, bitmap.height - y);
            const tile = await this.cropImage(bitmap, y, height);
            tokens.push(...await this.predictTokens(tile, y));
            if (y + height >= bitmap.height) break;
          }
          tokens = deduplicateOverlappingTokens(tokens);
        }
      } finally {
        bitmap.close();
      }

      if (signal?.aborted || this.disposed) {
        throw new DOMException("OCR이 취소되었습니다.", "AbortError");
      }
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
