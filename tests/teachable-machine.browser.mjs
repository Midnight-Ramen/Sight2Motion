// Local acceptance fixture: real TM/TFJS inference, synthetic camera, intercepted robot transport.
// No requests to Google's servers and no physical webcam or robot access.
import { chromium, expect } from '@playwright/test';
import * as tf from '@tensorflow/tfjs';
import { mkdir, writeFile } from 'node:fs/promises';

await tf.setBackend('cpu');
const model = tf.sequential();
model.add(tf.layers.globalAveragePooling2d({ inputShape: [224, 224, 3] }));
model.add(tf.layers.dense({ units: 3, activation: 'softmax' }));
const weights = [tf.eye(3).mul(3), tf.zeros([3])];
model.setWeights(weights);
weights.forEach(w => w.dispose());
let artifacts;
await model.save(tf.io.withSaveHandler(async value => {
  artifacts = value;
  return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
}));
model.dispose();
const modelJson = { modelTopology: artifacts.modelTopology, format: artifacts.format,
  generatedBy: artifacts.generatedBy, convertedBy: null,
  weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }] };
const metadata = { labels: ['Eraser', 'Marker', 'Nothing'], imageSize: 224,
  packageName: '@teachablemachine/image', packageVersion: '0.8.5', tfjsVersion: '4.22.0' };
const base = 'https://teachablemachine.withgoogle.com/models/LocalFixture/';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [], requests = [];
const robotCommands = [];
await page.route('http://127.0.0.1:30061/**', route => {
  const path = new URL(route.request().url()).pathname;
  robotCommands.push(path);
  return route.fulfill({ body: path.includes('/in/') ? 'true' : '200', headers: { 'access-control-allow-origin': '*' } });
});
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
await page.route('https://teachablemachine.withgoogle.com/**', async route => {
  const url = route.request().url();
  const headers = { 'access-control-allow-origin': '*' };
  if (url === `${base}model.json`) await route.fulfill({ json: modelJson, headers });
  else if (url === `${base}metadata.json`) await route.fulfill({ json: metadata, headers });
  else if (url === `${base}weights.bin`) await route.fulfill({ body: Buffer.from(artifacts.weightData), contentType: 'application/octet-stream', headers });
  else await route.fulfill({ status: 404, headers });
});
await page.addInitScript(() => {
  window.__cameraStreams = 0;
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
    window.__cameraStreams++;
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    let color = '#ff0000';
    window.__setFrameColor = next => { color = next; };
    const paint = () => { ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 480); };
    paint(); setInterval(paint, 100);
    return canvas.captureStream(10);
  } });
});
try {
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5174');
  await expect(page.getByLabel('AI model', { exact: true })).toHaveValue('yolo');
  expect(requests.some(url => /tensorflow|teachablemachine_image/.test(url))).toBe(false);
  await page.getByLabel('Location', { exact: true }).selectOption('center');
  await page.getByRole('button', { name: 'Connect camera', exact: true }).click();
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4);
  await page.getByLabel('AI model', { exact: true }).selectOption('teachable-machine');
  await page.getByLabel('Model URL', { exact: true }).fill(base.slice(0, -1));
  await page.getByRole('button', { name: 'Load Model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload model', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.model-body')).toContainText('3 classes');
  await expect(page.locator('.top-prediction')).toContainText('Eraser', { timeout: 30000 });
  await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Distance', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Needs update', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Convert to classification rule', exact: true }).click();
  await page.getByLabel('Class', { exact: true }).selectOption('Eraser');
  await page.getByLabel('Rule confidence', { exact: true }).fill('80');
  await page.getByLabel('Action 1 color', { exact: true }).fill('#00ff00');
  await page.getByRole('button', { name: 'Attach to Finch 2 A', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect from app', exact: true })).toBeVisible();
  robotCommands.length = 0;
  await page.getByRole('button', { name: 'Play rules', exact: true }).click();
  await expect.poll(() => robotCommands.includes('/hummingbird/out/triled/1/0/255/0/A'), { timeout: 15000 }).toBe(true);
  await page.evaluate(() => window.__setFrameColor('#00ff00'));
  await expect(page.locator('.top-prediction')).toContainText('Marker', { timeout: 15000 });
  expect(await page.evaluate(() => window.__cameraStreams)).toBe(1);
  expect(await page.locator('canvas').first().evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return data.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(false);
  await page.getByRole('button', { name: /STOP ROBOT/ }).click();
  await expect(page.getByRole('button', { name: 'Play rules', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vision-robot-studio.projects.v1'))[0]);
  expect(saved.visionProvider).toBe('teachable-machine');
  expect(saved.teachableMachineUrl).toBe(base);
  expect(saved.selectedClasses).toEqual(['Eraser', 'Marker', 'Nothing']);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/teachable-machine.png', fullPage: true });
  await page.getByLabel('AI model', { exact: true }).selectOption('yolo');
  await expect(page.getByLabel('Location', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Distance', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile('test-results/teachable-machine.json', JSON.stringify({
    tfjs: tf.version.tfjs, passed: true, cameraStreams: 1, model: 'local synthetic image model', robot: 'intercepted Finch transport', errors,
  }, null, 2));
  console.log('TM acceptance fixture passed: TFJS 4.22.0, real loader/inference, one stream, classes, rules, STOP, persistence and YOLO switch-back.');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error(await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
