import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import gpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import gpuModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { summarizeMask } from './SegmentationGeometry';
import { promptInputs } from './SAMPrompts';
let encoder: ort.InferenceSession | undefined, decoder: ort.InferenceSession | undefined;
let embedding: ort.Tensor | undefined;
let width = 0, height = 0, resizedWidth = 0, resizedHeight = 0;
let busy = false;
const backends: Record<string, string> = {};
const urls: Record<string, string> = {};
const canvas = new OffscreenCanvas(1, 1);
async function create(kind: string, wasmOnly = false) {
  if (!wasmOnly && 'gpu' in navigator && navigator.gpu) {
    try { const s = await ort.InferenceSession.create(urls[kind], { executionProviders: ['webgpu', 'wasm'] }); backends[kind] = 'WebGPU'; return s; }
    catch (e) { console.warn(`MobileSAM ${kind}: WebGPU unavailable, using WASM`, e); }
  }
  const s = await ort.InferenceSession.create(urls[kind], { executionProviders: ['wasm'] });
  backends[kind] = 'WASM'; return s;
}
async function run(kind: 'encoder' | 'decoder', feeds: Record<string, ort.Tensor>) {
  const session = kind === 'encoder' ? encoder! : decoder!;
  try { return await session.run(feeds); }
  catch (e) {
    if (backends[kind] !== 'WebGPU') throw e;
    console.warn(`MobileSAM ${kind} execution failed on WebGPU; retrying WASM`, e);
    await session.release();
    const replacement = await create(kind, true);
    if (kind === 'encoder') encoder = replacement; else decoder = replacement;
    return replacement.run(feeds);
  }
}
self.onmessage = async ({ data }) => {
  if (busy) { self.postMessage({ error: 'Segmentation is already running.' }); return; }
  busy = true;
  try {
    if (data.kind === 'load') {
      const started = performance.now();
      const gpu = !!('gpu' in navigator && navigator.gpu);
      ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { wasm: new URL(gpu ? gpuWasmUrl : wasmUrl, self.location.href).href,
        mjs: new URL(gpu ? gpuModuleUrl : wasmModuleUrl, self.location.href).href };
      urls.encoder = data.encoderUrl; urls.decoder = data.decoderUrl;
      try { encoder ??= await create('encoder'); decoder ??= await create('decoder'); }
      catch (e) { await encoder?.release(); await decoder?.release(); encoder = decoder = undefined; throw e; }
      console.info('MobileSAM loaded', backends, 'ms', performance.now() - started,
        'encoder', encoder.inputMetadata, 'decoder', decoder.inputMetadata);
      self.postMessage({ result: backends });
    } else if (data.kind === 'encode') {
      const started = performance.now();
      embedding?.dispose(); embedding = undefined;
      const bitmap: ImageBitmap = data.bitmap;
      width = bitmap.width; height = bitmap.height;
      const scale = 1024 / Math.max(width, height);
      resizedWidth = Math.round(width * scale); resizedHeight = Math.round(height * scale);
      canvas.width = resizedWidth; canvas.height = resizedHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, resizedWidth, resizedHeight); bitmap.close();
      const rgba = ctx.getImageData(0, 0, resizedWidth, resizedHeight).data;
      const meta = encoder!.inputMetadata[0];
      if (!meta.isTensor) throw new Error('Unsupported MobileSAM encoder input.');
      const hwc = meta.shape.length === 3;
      const input = new Float32Array(hwc ? resizedWidth * resizedHeight * 3 : 3 * 1024 * 1024);
      const mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375];
      for (let y = 0; y < resizedHeight; y++) for (let x = 0; x < resizedWidth; x++) for (let c = 0; c < 3; c++) {
        const value = rgba[(y * resizedWidth + x) * 4 + c];
        input[hwc ? (y * resizedWidth + x) * 3 + c : c * 1024 * 1024 + y * 1024 + x] = hwc ? value : (value - mean[c]) / std[c];
      }
      const tensor = new ort.Tensor('float32', input, hwc ? [resizedHeight, resizedWidth, 3] : [1, 3, 1024, 1024]);
      try {
        const outputs = await run('encoder', { [encoder!.inputNames[0]]: tensor });
        embedding = outputs[encoder!.outputNames[0]];
        for (const value of Object.values(outputs)) if (value !== embedding) value.dispose();
      } finally { tensor.dispose(); }
      console.info('MobileSAM embedding ms', performance.now() - started, backends.encoder);
      self.postMessage({ result: true });
    } else if (data.kind === 'decode') {
      if (!embedding) throw new Error('Capture a frame first.');
      const started = performance.now();
      const prompt = promptInputs(data.prompts, resizedWidth / width, resizedHeight / height);
      const feeds: Record<string, ort.Tensor> = {
        image_embeddings: embedding,
        point_coords: new ort.Tensor('float32', prompt.coords, [1, prompt.count, 2]),
        point_labels: new ort.Tensor('float32', prompt.labels, [1, prompt.count]),
        mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
        has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
        orig_im_size: new ort.Tensor('float32', new Float32Array([height, width]), [2]),
      };
      let outputs: ort.InferenceSession.ReturnType | undefined;
      try {
        outputs = await run('decoder', feeds);
        const masks = outputs.masks;
        if (!masks || masks.dims.at(-1) !== width || masks.dims.at(-2) !== height) throw new Error('Unexpected MobileSAM mask size.');
        const mask = new Uint8Array(width * height), values = masks.data as Float32Array;
        for (let i = 0; i < mask.length; i++) mask[i] = values[i] > 0 ? 1 : 0;
        const result = summarizeMask(mask, width, height);
        console.info('MobileSAM decode ms', performance.now() - started, backends.decoder);
        self.postMessage({ result }, { transfer: [mask.buffer] });
      } finally {
        Object.values(feeds).forEach(t => { if (t !== embedding) t.dispose(); });
        if (outputs) Object.values(outputs).forEach(t => t.dispose());
      }
    } else if (data.kind === 'clear') { embedding?.dispose(); embedding = undefined; self.postMessage({ result: true }); }
  } catch (error) { self.postMessage({ error: `MobileSAM: ${String(error)}` }); }
  finally { busy = false; }
};
