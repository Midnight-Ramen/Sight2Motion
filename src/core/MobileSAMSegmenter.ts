import type { SelectedSegment } from './SegmentationGeometry';
import type { SAMPrompts } from './SAMPrompts';
export class MobileSAMSegmenter {
  selected: SelectedSegment | null = null;
  private worker?: Worker;
  private loaded = false;
  private pending?: { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private request(kind: string, payload: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<any> {
    if (this.pending) return Promise.reject(new Error('Segmentation is already running.'));
    this.worker ??= new Worker(new URL('./MobileSAM.worker.ts', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose('Segmentation timed out. Try again or use a browser with WebGPU.'), 180000);
      this.pending = { resolve, reject, timer };
      this.worker!.onmessage = ({ data }) => {
        clearTimeout(timer); this.pending = undefined;
        if (data.error) reject(new Error(data.error)); else resolve(data.result);
      };
      this.worker!.onerror = () => this.dispose('Segmentation worker failed. Camera and detection remain available.');
      this.worker!.postMessage({ kind, ...payload }, transfer);
    });
  }
  async load() {
    if (this.loaded) return;
    await this.request('load', {
      encoderUrl: new URL('./models/mobilesam/encoder.onnx', document.baseURI).href,
      decoderUrl: new URL('./models/mobilesam/decoder.onnx', document.baseURI).href,
    });
    this.loaded = true;
  }
  async capture(canvas: HTMLCanvasElement) {
    this.selected = null;
    const bitmap = await createImageBitmap(canvas);
    try { await this.request('encode', { bitmap }, [bitmap]); }
    finally { bitmap.close(); }
  }
  async select(x: number, y: number) {
    return this.refine({ points: [{ x, y, label: 1 }] });
  }
  async refine(prompts: SAMPrompts) {
    const selected: SelectedSegment = await this.request('decode', { prompts });
    this.selected = selected;
    return selected;
  }
  clearSelection() { this.selected = null; }
  async clear() { this.selected = null; if (this.loaded) await this.request('clear'); }
  dispose(message = 'Selection cancelled.') {
    this.worker?.terminate(); this.worker = undefined; this.loaded = false; this.selected = null;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error(message)); this.pending = undefined; }
  }
}
