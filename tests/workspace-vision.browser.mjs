import { openSetup } from './setup-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { writeFile, mkdir, access } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
try {
  await access('test-results/bus.jpg');
} catch {
  const r = await fetch('https://raw.githubusercontent.com/ultralytics/assets/main/im/bus.jpg');
  if (!r.ok) throw new Error('Test fixture download failed');
  await writeFile('test-results/bus.jpg', Buffer.from(await r.arrayBuffer()));
}
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
await page.route('**/test-fixtures/bus.jpg', route => route.fulfill({path:'test-results/bus.jpg',contentType:'image/jpeg'}));
const errors = [];
const robotCommands = [];
await page.route('http://127.0.0.1:30061/**', route => {
  const path = new URL(route.request().url()).pathname;
  robotCommands.push(path);
  return route.fulfill({ body: path.includes('/in/') ? 'true' : '200', headers: { 'access-control-allow-origin': '*' } });
});
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  // Exercise the required CPU fallback, independently of the host's GPU.
  Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => {
      const img = new Image();
      img.src = '/test-fixtures/bus.jpg';
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      setInterval(() => ctx.drawImage(img, 0, 0), 125);
      return canvas.captureStream(8);
    },
  });
});
try {
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5174');
  await page.getByRole('button', { name: 'Start Camera', exact: true }).click();
  await expect(page.locator('.status').first()).toContainText('Camera live', { timeout: 20000 });
  await openSetup(page, 'AI model');
  await page.getByRole('button', { name: 'Load local model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload model', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await openSetup(page, 'Your robot');
  await page.getByRole('button', { name: 'Connect Finch 2 A', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect from app', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Play rules', exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.getByRole('button', { name: 'Play rules', exact: true }).click();
  await expect.poll(() => robotCommands.includes('/hummingbird/out/triled/1/81/214/145/A'), { timeout: 60000 }).toBe(true);
  await expect(page.locator('.detection-chip').filter({ hasText: 'person' }).first()).toBeVisible();
  const liveVideo = await page.locator('video').elementHandle();
  await page.getByRole('button', { name: 'Expand camera', exact: true }).click();
  await expect(page.locator('.status').first()).toContainText('Camera live');
  await page.getByRole('button', { name: 'Collapse camera', exact: true }).click();
  expect(await liveVideo.evaluate(el => el === document.querySelector('video') && !!el.srcObject)).toBe(true);
  const detections = await page.locator('.detection-chip').allTextContents();
  const backend = await page.locator('.backend').textContent();
  await page.screenshot({ path: 'test-results/actual-inference.png', fullPage: true });
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play rules', exact: true })).toBeEnabled();
  await page.getByLabel('Project name', { exact: true }).fill('Classroom test');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  if(errors.length) throw new Error(errors.join('\n'));
  console.log('Camera, actual YOLO inference, detections, mocked Finch rule output, STOP and Save passed.');
} finally { await browser.close(); }
