import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const url = 'https://huggingface.co/webnn/yolo11n/resolve/9c5acfdd74aaff2d0f47c51b878506361039a51f/onnx/yolo11n.onnx';
const expected = '7d8fd1717d9d5bbab6986cd134afb620649c7a394303d55b1e09fc00804cc5c1';
const target = new URL('../public/models/yolo11n.onnx', import.meta.url);
const hash = (data) => createHash('sha256').update(data).digest('hex');
let existing;
try {
  existing = await readFile(target);
} catch {}
if (existing && hash(existing) === expected) {
  console.log('Verified YOLO11n model is already installed.');
  process.exit(0);
}
console.log('Downloading YOLO11n for local browser inference…');
const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
const data = Buffer.from(await response.arrayBuffer());
if (hash(data) !== expected)
  throw new Error(
    'Model checksum changed. Verify the upstream model before updating the expected hash.',
  );
await mkdir(new URL('../public/models/', import.meta.url), { recursive: true });
await writeFile(target, data);
console.log('Installed and verified public/models/yolo11n.onnx. See README for model licensing.');
