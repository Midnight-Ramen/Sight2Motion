import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const url = 'https://huggingface.co/webml/yolov8n/resolve/main/onnx/yolov8n.onnx';
const expected = '190ba5f1e61411a001683e349d6b2cdb0804c0dc67a5e34cd8ff6fd00ee54b4d';
const target = new URL('../public/models/yolov8n.onnx', import.meta.url);
const hash = (data) => createHash('sha256').update(data).digest('hex');
let existing;
try {
  existing = await readFile(target);
} catch {}
if (existing && hash(existing) === expected) {
  console.log('Verified YOLOv8n model is already installed.');
  process.exit(0);
}
console.log('Downloading YOLOv8n for local browser inference…');
const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
const data = Buffer.from(await response.arrayBuffer());
if (hash(data) !== expected)
  throw new Error(
    'Model checksum changed. Verify the upstream model before updating the expected hash.',
  );
await mkdir(new URL('../public/models/', import.meta.url), { recursive: true });
await writeFile(target, data);
console.log('Installed and verified public/models/yolov8n.onnx. See README for model licensing.');
