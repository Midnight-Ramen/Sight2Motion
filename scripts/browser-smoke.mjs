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
  await page.getByRole('button', { name: 'Connect camera', exact: true }).click();
  await expect(page.locator('.status').first()).toContainText('Camera live', { timeout: 20000 });
  await page.getByRole('button', { name: 'Load local model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload model', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Connect mock Finch', exact: true }).click();
  await page
    .getByRole('button', { name: 'Play rules', exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.getByRole('button', { name: 'Play rules', exact: true }).click();
  await expect(page.getByTestId('finch-beak')).toHaveAttribute('fill', '#51d691', {
    timeout: 60000,
  });
  await expect(page.locator('.detection-chip').filter({ hasText: 'person' }).first()).toBeVisible();
  const detections = await page.locator('.detection-chip').allTextContents();
  const backend = await page.locator('.backend').textContent();
  await page.screenshot({ path: 'test-results/actual-inference.png', fullPage: true });
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play rules', exact: true })).toBeEnabled();
  await page.getByLabel('Project name', { exact: true }).fill('Classroom test');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Classroom test 1 rules' }).click();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Classroom test');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByLabel('Action 2 type', { exact: true }).selectOption('tail');
  await page.getByRole('button', { name: 'Move action 2 up', exact: true }).click();
  await expect(page.getByLabel('Action 1 type', { exact: true })).toHaveValue('tail');
  await page.getByRole('button', { name: 'Delete action 1', exact: true }).click();
  await expect(page.getByLabel('Action 1 type', { exact: true })).toHaveValue('beak');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Mobile page overflows horizontally');
  if (errors.length) throw new Error(errors.join('\n'));
  const report = {
    passed: true,
    backend,
    detections,
    checks: [
      'Local YOLO model loads',
      'Prerecorded camera stream renders',
      'Person detection triggers green beak',
      'Spacebar disables AI',
      'Save/new/load round trip',
      'Action add/reorder/remove',
      '390px mobile no horizontal overflow',
      'No uncaught page errors',
    ],
  };
  await writeFile('test-results/browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/browser-failure.png', fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}


