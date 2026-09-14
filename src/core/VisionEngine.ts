import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import type { Detection } from './types';

export const CLASSES =
  'person,bicycle,car,motorcycle,airplane,bus,train,truck,boat,traffic light,fire hydrant,stop sign,parking meter,bench,bird,cat,dog,horse,sheep,cow,elephant,bear,zebra,giraffe,backpack,umbrella,handbag,tie,suitcase,frisbee,skis,snowboard,sports ball,kite,baseball bat,baseball glove,skateboard,surfboard,tennis racket,bottle,wine glass,cup,fork,knife,spoon,bowl,banana,apple,sandwich,orange,broccoli,carrot,hot dog,pizza,donut,cake,chair,couch,potted plant,bed,dining table,toilet,tv,laptop,mouse,remote,keyboard,cell phone,microwave,oven,toaster,sink,refrigerator,book,clock,vase,scissors,teddy bear,hair drier,toothbrush'.split(
    ',',
  );
export interface VisionEngine {
  getClasses(): readonly string[];
  load(model: string | Uint8Array): Promise<string>;
  detect(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    threshold: number,
  ): Promise<Detection[]>;
  dispose(): Promise<void>;
}
const iou = (a: Detection, b: Detection) => {
  const overlap =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlap / (a.width * a.height + b.width * b.height - overlap);
};
export function decodeYolo(
  data: Float32Array,
  dims: readonly number[],
  threshold: number,
  scale: number,
  padX: number,
  padY: number,
  width: number,
  height: number,
): Detection[] {
  if (dims.length !== 3 || dims[0] !== 1 || dims[1] !== 84)
    throw new Error('Use a YOLOv8 COCO detection model exported without NMS.');
  const count = dims[2],
    detections: Detection[] = [];
  for (let i = 0; i < count; i++) {
    let score = 0,
      cls = 0;
    for (let c = 0; c < 80; c++) {
      const value = data[(c + 4) * count + i];
      if (value > score) {
        score = value;
        cls = c;
      }
    }
    if (score < threshold) continue;
    const cx = data[i],
      cy = data[count + i],
      w = data[2 * count + i],
      h = data[3 * count + i];
    const x = Math.max(0, (cx - w / 2 - padX) / scale),
      y = Math.max(0, (cy - h / 2 - padY) / scale);
    const right = Math.min(width, (cx + w / 2 - padX) / scale),
      bottom = Math.min(height, (cy + h / 2 - padY) / scale);
    if (right <= x || bottom <= y) continue;
    detections.push({
      className: CLASSES[cls],
      confidence: score,
      x,
      y,
      width: right - x,
      height: bottom - y,
      centerX: (x + right) / 2,
      centerY: (y + bottom) / 2,
    });
  }
  detections.sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const d of detections) {
    if (!kept.some((k) => k.className === d.className && iou(k, d) > 0.45)) kept.push(d);
    if (kept.length >= 100) break;
  }
  return kept;
}
export class YoloVisionEngine implements VisionEngine {
  getClasses(): readonly string[] { return CLASSES; }
  private session: ort.InferenceSession | null = null;
  private canvas = document.createElement('canvas');
  private createSession(model: string | Uint8Array, executionProviders: string[]) {
    return typeof model === 'string'
      ? ort.InferenceSession.create(model, { executionProviders })
      : ort.InferenceSession.create(model, { executionProviders });
  }
  async load(model: string | Uint8Array) {
    await this.dispose();
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
      wasm: new URL(wasmUrl, document.baseURI).href,
      mjs: new URL(wasmModuleUrl, document.baseURI).href,
    };
    ort.env.wasm.proxy = true;
    const backend = 'WASM worker';
    this.session = await this.createSession(model, ['wasm']);
    const metadata = this.session.inputMetadata[0];
    const shape = metadata?.isTensor ? metadata.shape : undefined;
    if (
      !shape ||
      shape.length !== 4 ||
      shape[0] !== 1 ||
      shape[1] !== 3 ||
      shape[2] !== 640 ||
      shape[3] !== 640
    ) {
      await this.dispose();
      throw new Error('Expected a static 640 × 640 YOLOv8 model.');
    }
    return backend;
  }
  async detect(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, threshold: number) {
    if (!this.session) throw new Error('Load a model first.');
    const width =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source instanceof HTMLImageElement
          ? source.naturalWidth
          : source.width;
    const height =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source instanceof HTMLImageElement
          ? source.naturalHeight
          : source.height;
    if (!width || !height) return [];
    const size = 640,
      scale = Math.min(size / width, size / height),
      drawW = Math.round(width * scale),
      drawH = Math.round(height * scale),
      padX = Math.floor((size - drawW) / 2),
      padY = Math.floor((size - drawH) / 2);
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, padX, padY, drawW, drawH);
    const pixels = ctx.getImageData(0, 0, size, size).data,
      input = new Float32Array(3 * size * size);
    for (let i = 0; i < size * size; i++) {
      input[i] = pixels[i * 4] / 255;
      input[i + size * size] = pixels[i * 4 + 1] / 255;
      input[i + 2 * size * size] = pixels[i * 4 + 2] / 255;
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, size, size]);
    let outputs: ort.InferenceSession.ReturnType | undefined;
    try {
      outputs = await this.session.run({ [this.session.inputNames[0]]: tensor });
      const output = outputs[this.session.outputNames[0]];
      return decodeYolo(
        output.data as Float32Array,
        output.dims,
        threshold,
        scale,
        padX,
        padY,
        width,
        height,
      );
    } finally {
      tensor.dispose();
      if (outputs) Object.values(outputs).forEach((t) => t.dispose());
    }
  }
  async dispose() {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }
}


